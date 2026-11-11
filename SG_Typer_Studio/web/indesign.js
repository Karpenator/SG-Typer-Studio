// InDesign in SG Typer Studio. An .idml opens as one tab per page: the placed images and the
// shapes become the page's picture, each text frame a text layer. Saving writes the same
// .idml back, where only what changed in TypeR is rewritten: the rest of the file stays as
// InDesign wrote it. An .indd is first turned into IDML by indd-utils (MIT or Apache-2.0),
// built for the web in vendor/indd.wasm; InDesign's own format can't be written, so its
// pages are saved as an .idml, which InDesign opens. Pages made from PSD or pictures can be
// exported as a new .idml, their picture embedded in it.
//
// TypeR's sizes are in points and its pages in pixels: a page of the .idml is set at the
// resolution of its picture, so that one point of InDesign is one point here.

(function () {
  "use strict";

  const PS = () => window.TypeRPhotoshop;
  const Fonts = window.TypeRFonts;
  const Kit = () => window.TypeRKit;

  const IDPKG = "http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging";
  const MIMETYPE = "application/vnd.adobe.indesign-idml-package";
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const LINE_BREAK = "\u2028";
  const PAGE_ITEMS = new Set(["Rectangle", "Oval", "Polygon", "GraphicLine", "TextFrame", "Group"]);
  const GRAPHICS = new Set(["Image", "PDF", "EPS", "ImportedPage", "SVG", "WMF", "PICT"]);

  const isInDesignName = (name) => /\.(idml|indd|indt)$/i.test(name);

  /* ------------------------------- loading ------------------------------- */

  const scripts = new Map();
  const loadScript = (src) => {
    if (!scripts.has(src)) {
      scripts.set(src, new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`${src} did not load.`));
        document.head.appendChild(script);
      }));
    }
    return scripts.get(src);
  };

  // indd-utils: the .indd in, the .idml out, with InDesign's previews of the linked pictures
  let converter = null;
  const inddConverter = () => {
    if (!converter) {
      converter = fetch("vendor/indd.wasm")
        .then((response) => {
          if (!response.ok) throw new Error("vendor/indd.wasm did not load.");
          return response.arrayBuffer();
        })
        .then((bytes) => WebAssembly.instantiate(bytes, {}))
        .then(({ instance }) => instance.exports)
        .catch((error) => {
          converter = null;
          throw error;
        });
    }
    return converter;
  };

  const convertIndd = async (bytes) => {
    const x = await inddConverter();
    const at = x.alloc(bytes.length);
    new Uint8Array(x.memory.buffer, at, bytes.length).set(bytes);
    const length = x.convert(at, bytes.length);
    const out = new Uint8Array(x.memory.buffer, x.result_ptr(), length).slice();
    x.result_free();
    const view = new DataView(out.buffer);
    let read = 0;
    const u32 = () => {
      const value = view.getUint32(read, true);
      read += 4;
      return value;
    };
    const take = () => {
      const size = u32();
      const part = out.subarray(read, read + size);
      read += size;
      return part;
    };
    const text = (part) => new TextDecoder().decode(part);
    if (u32() !== 0) throw new Error(text(out.subarray(4)));
    const idml = take();
    const warnings = text(take()).split("\n").filter(Boolean);
    const previews = new Map();
    for (let count = u32(), i = 0; i < count; i++) {
      const graphics = text(take()).split("\n");
      const data = take();
      graphics.forEach((self) => previews.set(self, data));
    }
    return { idml, warnings, previews };
  };

  /* --------------------------------- XML --------------------------------- */

  const parseXml = (bytes) => {
    const doc = new DOMParser().parseFromString(typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes), "application/xml");
    const error = doc.getElementsByTagName("parsererror")[0];
    if (error) throw Object.assign(new Error("This InDesign file is damaged."), { detail: error.textContent });
    return doc;
  };
  // Some browsers keep the declaration, others drop it: it is written once, as InDesign does
  const serializeXml = (doc) => new TextEncoder().encode(XML_HEAD + new XMLSerializer().serializeToString(doc).replace(/^\s*<\?xml[^?]*\?>\s*/, ""));

  const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  // What XML can't hold, and what InDesign keeps for itself
  const cleanText = (value) => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
  const num = (value) => String(Math.round(value * 10000) / 10000);

  const children = (el, name) => Array.from(el ? el.children : []).filter((child) => !name || child.localName === name);
  const child = (el, name) => children(el, name)[0] || null;
  const descendant = (el, path) => path.reduce((at, name) => child(at, name), el);

  // An attribute, or the same value under Properties, as IDML puts the longer ones
  const valueOf = (el, name) => {
    if (!el) return undefined;
    if (el.hasAttribute(name)) return el.getAttribute(name);
    const prop = child(child(el, "Properties"), name);
    if (!prop) return undefined;
    const items = children(prop, "ListItem");
    return items.length ? items.map((item) => item.textContent) : prop.textContent;
  };

  /* ------------------------------- matrices ------------------------------- */

  const IDENTITY = [1, 0, 0, 1, 0, 0];
  const matrixOf = (text) => {
    const values = String(text || "").trim().split(/\s+/).map(Number);
    return values.length === 6 && values.every(Number.isFinite) ? values : IDENTITY.slice();
  };
  const compose = (m, n) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const invert = (m) => {
    const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  };
  const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const matrixText = (m) => m.map(num).join(" ");

  const pathsOf = (el) => {
    const geometry = descendant(el, ["Properties", "PathGeometry"]);
    return children(geometry, "GeometryPathType").map((path) => ({
      open: path.getAttribute("PathOpen") === "true",
      points: children(child(path, "PathPointArray"), "PathPointType").map((point) => {
        const pair = (name) => (point.getAttribute(name) || point.getAttribute("Anchor") || "0 0").split(/\s+/).map(Number);
        return { anchor: pair("Anchor"), left: pair("LeftDirection"), right: pair("RightDirection") };
      }),
    })).filter((path) => path.points.length);
  };
  const boundsOf = (points) => {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  };
  const pathBounds = (paths) => {
    const points = [];
    paths.forEach((path) => path.points.forEach((point) => points.push(point.anchor)));
    return points.length ? boundsOf(points) : { left: 0, top: 0, right: 0, bottom: 0 };
  };
  const rectPath = (width, height) =>
    `<PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${[[0, 0], [0, height], [width, height], [width, 0]]
      .map(([x, y]) => `<PathPointType Anchor="${num(x)} ${num(y)}" LeftDirection="${num(x)} ${num(y)}" RightDirection="${num(x)} ${num(y)}"/>`).join("")}</PathPointArray></GeometryPathType></PathGeometry>`;

  /* ------------------------------- the package ------------------------------ */

  const readZip = async (bytes) => {
    const zip = Kit().zipEntries(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const files = {};
    for (const entry of zip.entries) files[entry.name] = new Uint8Array(await zip.read(entry));
    if (!files["designmap.xml"]) throw new Error("This file isn't an InDesign package.");
    return files;
  };

  // The parts of a package TypeR works with, read anew each time from its files
  const readModel = (files) => {
    const xml = new Map();
    const get = (path) => {
      if (!xml.has(path)) xml.set(path, files[path] ? parseXml(files[path]) : null);
      return xml.get(path);
    };
    const designmap = get("designmap.xml");
    const root = designmap.documentElement;
    const srcOf = (name) => Array.from(root.getElementsByTagNameNS(IDPKG, name)).map((el) => el.getAttribute("src"));
    const layers = children(root, "Layer").map((el, index, all) => ({
      self: el.getAttribute("Self"),
      name: el.getAttribute("Name"),
      visible: el.getAttribute("Visible") !== "false",
      locked: el.getAttribute("Locked") === "true",
      // Listed from the top down
      rank: all.length - index,
    }));
    const layerRank = new Map(layers.map((layer) => [layer.self, layer]));

    const styles = new Map();
    const stylesDoc = get(srcOf("Styles")[0] || "Resources/Styles.xml");
    if (stylesDoc) {
      ["ParagraphStyle", "CharacterStyle", "ObjectStyle"].forEach((tag) => {
        Array.from(stylesDoc.getElementsByTagName(tag)).forEach((el) => styles.set(el.getAttribute("Self"), el));
      });
    }
    const colors = new Map();
    const graphicPath = srcOf("Graphic")[0] || "Resources/Graphic.xml";
    const graphicDoc = get(graphicPath);
    if (graphicDoc) {
      ["Color", "Tint", "Swatch", "MixedInk", "Gradient"].forEach((tag) => {
        Array.from(graphicDoc.getElementsByTagName(tag)).forEach((el) => colors.set(el.getAttribute("Self"), el));
      });
    }
    const fontsPath = srcOf("Fonts")[0] || "Resources/Fonts.xml";
    const fontsDoc = get(fontsPath);
    const fontNames = new Map();
    if (fontsDoc) {
      Array.from(fontsDoc.getElementsByTagName("Font")).forEach((el) => {
        fontNames.set(`${el.getAttribute("FontFamily")}\u0000${el.getAttribute("FontStyleName")}`, el.getAttribute("PostScriptName"));
      });
    }

    const spreads = [];
    const pages = new Map();
    const items = new Map();
    srcOf("Spread").forEach((path) => {
      const doc = get(path);
      const el = doc && child(doc.documentElement, "Spread");
      if (!el) return;
      const spread = { path, doc, el, pages: [], items: [] };
      children(el, "Page").forEach((pageEl) => {
        const [top, left, bottom, right] = (pageEl.getAttribute("GeometricBounds") || "0 0 792 612").split(/\s+/).map(Number);
        const page = { self: pageEl.getAttribute("Self"), name: pageEl.getAttribute("Name") || String(pages.size + 1), el: pageEl, spread, transform: matrixOf(pageEl.getAttribute("ItemTransform")), bounds: { top, left, bottom, right } };
        spread.pages.push(page);
        pages.set(page.self, page);
      });
      // Back to front, as listed; a group's items carry its transform
      const walk = (parentEl, parentT, groupLayer, hidden) => {
        children(parentEl).forEach((itemEl) => {
          if (!PAGE_ITEMS.has(itemEl.localName)) return;
          const own = matrixOf(itemEl.getAttribute("ItemTransform"));
          const transform = compose(parentT, own);
          const layer = itemEl.getAttribute("ItemLayer") || groupLayer;
          const off = hidden || itemEl.getAttribute("Visible") === "false";
          const item = { self: itemEl.getAttribute("Self"), el: itemEl, tag: itemEl.localName, transform, parentT, spread, layer, hidden: off, order: spread.items.length };
          items.set(item.self, item);
          if (item.tag === "Group") walk(itemEl, transform, layer, off);
          else spread.items.push(item);
        });
      };
      walk(el, IDENTITY, null, false);
      spreads.push(spread);
    });

    const stories = new Map();
    srcOf("Story").forEach((path) => {
      const doc = get(path);
      const el = doc && child(doc.documentElement, "Story");
      if (el) stories.set(el.getAttribute("Self"), { path, doc, el });
    });

    return { files, xml, get, designmap, root, layers, layerRank, styles, colors, graphicPath, graphicDoc, fontsPath, fontsDoc, fontNames, spreads, pages, items, stories, domVersion: root.getAttribute("DOMVersion") || "8.0" };
  };

  /* -------------------------------- styles -------------------------------- */

  const DEFAULTS = {
    PointSize: "12", Leading: "Auto", AutoLeading: "120", Tracking: "0", HorizontalScale: "100", VerticalScale: "100", BaselineShift: "0",
    Capitalization: "Normal", Position: "Normal", FillColor: "Color/Black", FillTint: "-1", Skew: "0", Justification: "LeftAlign", AppliedFont: "Minion Pro",
    FontStyle: "Regular", StrokeWeight: "1", StrokeColor: "Swatch/None", StrokeTint: "-1", Underline: "false", StrikeThru: "false", Ligatures: "true", KerningMethod: "$ID/Metric",
  };

  // A style's value, from the style itself up the ones it is based on
  const fromStyle = (model, self, prefix, name) => {
    let el = self ? model.styles.get(self) || model.styles.get(prefix + self) : null;
    for (let depth = 0; el && depth < 30; depth++) {
      const value = valueOf(el, name);
      if (value !== undefined) return value;
      const based = valueOf(el, "BasedOn");
      el = based ? model.styles.get(based) || model.styles.get(prefix + based) : null;
    }
    return undefined;
  };

  // A run's value: its own, its character style's, its paragraph's, its paragraph style's
  const textValue = (model, psr, csr, name) => {
    let value = valueOf(csr, name);
    if (value !== undefined) return value;
    const characterStyle = csr && csr.getAttribute("AppliedCharacterStyle");
    if (characterStyle && !/\[No character style\]$/.test(characterStyle)) {
      value = fromStyle(model, characterStyle, "CharacterStyle/", name);
      if (value !== undefined) return value;
    }
    value = valueOf(psr, name);
    if (value !== undefined) return value;
    value = fromStyle(model, psr && psr.getAttribute("AppliedParagraphStyle"), "ParagraphStyle/", name);
    return value !== undefined ? value : DEFAULTS[name];
  };

  const itemValue = (model, el, name) => {
    const value = valueOf(el, name);
    if (value !== undefined) return value;
    return fromStyle(model, el.getAttribute("AppliedObjectStyle"), "ObjectStyle/", name);
  };

  const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));
  // A swatch as RGB, or null for None. Print colours are only approximated on screen.
  const colorOf = (model, self, tint) => {
    if (!self || /^Swatch\/None$/.test(self) || self === "n") return null;
    let el = model.colors.get(self);
    let amount = Number(tint);
    if (el && el.localName === "Tint") {
      if (!(amount >= 0)) amount = Number(el.getAttribute("TintValue"));
      el = model.colors.get(el.getAttribute("BaseColor"));
    }
    if (!el || el.localName !== "Color") {
      if (/Paper/.test(self)) return { red: 255, green: 255, blue: 255 };
      return el && el.localName === "Swatch" ? null : { red: 0, green: 0, blue: 0 };
    }
    const values = (el.getAttribute("ColorValue") || "").split(/\s+/).map(Number);
    const space = el.getAttribute("Space");
    let rgb;
    if (space === "RGB") rgb = [values[0], values[1], values[2]];
    else if (space === "LAB") {
      const [l, a, b] = values;
      const fy = (l + 16) / 116;
      const f = (t) => (t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787);
      const [x, y, z] = [0.95047 * f(fy + a / 500), f(fy), 1.08883 * f(fy - b / 200)];
      const gamma = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
      rgb = [gamma(3.2406 * x - 1.5372 * y - 0.4986 * z), gamma(-0.9689 * x + 1.8758 * y + 0.0415 * z), gamma(0.0557 * x - 0.204 * y + 1.057 * z)];
    } else {
      const [c, m, y, k] = values.map((v) => (v || 0) / 100);
      rgb = [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)];
    }
    if (amount >= 0 && amount < 100) rgb = rgb.map((v) => 255 - (255 - v) * (amount / 100));
    return { red: clampByte(rgb[0]), green: clampByte(rgb[1]), blue: clampByte(rgb[2]) };
  };
  const cssOf = (color) => `rgb(${color.red},${color.green},${color.blue})`;

  const ALIGN_IN = { LeftAlign: "left", LeftJustified: "left", ToBindingSide: "left", CenterAlign: "center", CenterJustified: "center", FullyJustified: "center", RightAlign: "right", RightJustified: "right", AwayFromBindingSide: "right" };
  const ALIGN_OUT = { left: "LeftAlign", center: "CenterAlign", right: "RightAlign" };

  const postScriptOf = (model, family, style) => {
    const key = `${family}\u0000${style}`;
    const listed = model.fontNames.get(key);
    if (listed) return listed;
    if (!model.fontsHere) model.fontsHere = new Map(Fonts.list().map((font) => [`${font.family}\u0000${font.style}`, font.postScriptName]));
    return model.fontsHere.get(key) || `${family}-${style}`.replace(/\s+/g, "");
  };

  // A run of a story as one of TypeR's text styles. `scale`: what the frame's transform does to
  // its text, 1 for a frame at its own size.
  const textStyleOf = (model, psr, csr, scale) => {
    const value = (name) => textValue(model, psr, csr, name);
    // InDesign's own fonts are named "$ID/Times"
    const family = String(value("AppliedFont")).replace(/^\$ID\//, "");
    const style = String(value("FontStyle")).replace(/^\$ID\//, "");
    const size = Number(value("PointSize")) * scale;
    const leading = value("Leading");
    const out = {
      fontPostScriptName: postScriptOf(model, family, style),
      fontName: family,
      fontStyleName: style,
      size,
      impliedFontSize: size,
      autoLeading: !(Number(leading) > 0),
      tracking: Number(value("Tracking")) || 0,
      horizontalScale: Number(value("HorizontalScale")) || 100,
      verticalScale: Number(value("VerticalScale")) || 100,
      syntheticBold: false,
      // Photoshop's faux italic is a slant, InDesign's skew
      syntheticItalic: Number(value("Skew")) > 0,
      fontCaps: { AllCaps: "allCaps", SmallCaps: "smallCaps", CapToSmallCap: "smallCaps" }[value("Capitalization")] || "normal",
      baselineShift: (Number(value("BaselineShift")) || 0) * scale,
      baseline: /Superscript/.test(value("Position")) ? "superScript" : /Subscript/.test(value("Position")) ? "subScript" : "normal",
      underline: value("Underline") === "true" ? "underlineOnLeftInVertical" : "underlineOff",
      strikethrough: value("StrikeThru") === "true" ? "xHeightStrikethroughOn" : "strikethroughOff",
      ligature: value("Ligatures") !== "false",
      altligature: false,
      color: colorOf(model, value("FillColor"), value("FillTint")) || { red: 0, green: 0, blue: 0 },
    };
    if (!out.autoLeading) out.leading = Number(leading) * scale;
    if (/Manual|None/.test(value("KerningMethod"))) out.autoKern = "manual";
    return out;
  };

  /* -------------------------------- stories -------------------------------- */

  const SKIPPED_IN_TEXT = new Set(["Properties", "Note", "Footnote", "Endnote", "EndnoteRange", "Table", "Rectangle", "Oval", "Polygon", "GraphicLine", "TextFrame", "Group", "Button", "HiddenText"]);

  // A story's text and its runs, as TypeR keeps them: one paragraph style, line breaks as \r
  const readStory = (model, storyEl, scale) => {
    const pieces = [];
    let firstParagraph = null;
    const visit = (el, psr, csr) => {
      children(el).forEach((node) => {
        const tag = node.localName;
        if (tag === "ParagraphStyleRange") {
          if (!firstParagraph) firstParagraph = node;
          visit(node, node, null);
        } else if (tag === "CharacterStyleRange") visit(node, psr, node);
        else if (tag === "Content") pieces.push({ text: node.textContent, psr, csr });
        else if (tag === "Br") pieces.push({ text: "\r", psr, csr });
        else if (tag === "TextVariableInstance") pieces.push({ text: node.getAttribute("ResultText") || "", psr, csr });
        else if (tag === "Change" && node.getAttribute("ChangeType") === "DeletedText") return;
        else if (!SKIPPED_IN_TEXT.has(tag)) visit(node, psr, csr);
      });
    };
    visit(storyEl, null, null);
    const styleCache = new Map();
    const styleFor = (psr, csr) => {
      const key = [psr, csr];
      for (const [k, style] of styleCache) if (k[0] === psr && k[1] === csr) return style;
      const style = textStyleOf(model, psr, csr, scale);
      styleCache.set(key, style);
      return style;
    };
    let text = "";
    const styles = [];
    let stroke = null;
    pieces.forEach(({ text: raw, psr, csr }) => {
      const clean = raw.replace(/[\u2028\u2029\n]/g, "\r").replace(/\t/g, " ").replace(/[\uFEFF\u00AD\u200B]/g, "");
      if (!clean) return;
      const style = styleFor(psr, csr);
      if (!stroke) {
        const color = colorOf(model, textValue(model, psr, csr, "StrokeColor"), textValue(model, psr, csr, "StrokeTint"));
        const weight = Number(textValue(model, psr, csr, "StrokeWeight")) || 0;
        if (color && weight > 0 && /\S/.test(clean) && JSON.stringify(color) !== JSON.stringify(style.color)) stroke = { weight: weight * scale, color };
      }
      // A stroke the colour of the letters is how TypeR writes faux bold
      const strokeColor = colorOf(model, textValue(model, psr, csr, "StrokeColor"), textValue(model, psr, csr, "StrokeTint"));
      const sameColor = strokeColor && JSON.stringify(strokeColor) === JSON.stringify(style.color);
      if (sameColor && Number(textValue(model, psr, csr, "StrokeWeight")) > 0 && !style.syntheticBold) style.syntheticBold = true;
      text += clean;
      for (let i = 0; i < clean.length; i++) styles.push(style);
    });
    while (text.endsWith("\r")) {
      text = text.slice(0, -1);
      styles.pop();
    }
    const ranges = [];
    styles.forEach((style, at) => {
      const last = ranges[ranges.length - 1];
      if (last && last.textStyle === style) last.to = at + 1;
      else ranges.push({ from: at, to: at + 1, textStyle: style });
    });
    if (!ranges.length) ranges.push({ from: 0, to: 0, textStyle: textStyleOf(model, firstParagraph, null, scale) });
    const value = (name) => textValue(model, firstParagraph, null, name);
    const paragraph = { alignment: ALIGN_IN[value("Justification")] || "left", autoLeadingPercentage: (Number(value("AutoLeading")) || 120) / 100 };
    // InDesign's Optical Margin Alignment is the nearest thing to Photoshop's Roman Hanging Punctuation
    const preference = child(storyEl, "StoryPreference");
    if (preference && preference.getAttribute("OpticalMarginAlignment") === "true") paragraph.hangingRoman = true;
    return { text, ranges, paragraph, stroke, firstParagraph };
  };

  /* -------------------------------- pictures -------------------------------- */

  const canvasOf = (width, height) => PS().newCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));

  const decodeTiff = async (bytes) => {
    if (!window.pako) await loadScript("vendor/pako_inflate.min.js");
    if (!window.UTIF) await loadScript("vendor/utif.js");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const ifds = window.UTIF.decode(buffer);
    const ifd = ifds.find((entry) => entry.t256 && entry.t257) || ifds[0];
    window.UTIF.decodeImage(buffer, ifd, ifds);
    const rgba = window.UTIF.toRGBA8(ifd);
    const canvas = canvasOf(ifd.width, ifd.height);
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, ifd.width * ifd.height * 4), ifd.width, ifd.height), 0, 0);
    return canvas;
  };

  const decodePsd = async (bytes) => {
    const lib = await window.TypeRPSD.library();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    let psd = lib.readPsd(buffer, { skipLayerImageData: true, skipThumbnail: true });
    if (psd.canvas) return psd.canvas;
    // Saved without a composite: the layers, one on the other
    psd = lib.readPsd(buffer, { skipThumbnail: true });
    const canvas = canvasOf(psd.width, psd.height);
    const ctx = canvas.getContext("2d");
    const draw = (nodes) => (nodes || []).forEach((node) => {
      if (node.hidden) return;
      if (node.children) draw(node.children);
      else if (node.canvas) {
        ctx.globalAlpha = node.opacity === undefined ? 1 : node.opacity;
        ctx.drawImage(node.canvas, node.left || 0, node.top || 0);
      }
    });
    draw(psd.children);
    return canvas;
  };

  // The pixels of a placed file, or null for what a browser can't draw (PDF, AI, EPS)
  const decodePicture = async (bytes) => {
    if (!bytes || bytes.length < 8) return null;
    if (bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53) return decodePsd(bytes);
    if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 42)) return decodeTiff(bytes);
    if (bytes[0] === 0x25 && bytes[1] === 0x50) return null; // %PDF, %!PS
    try {
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const canvas = canvasOf(bitmap.width, bitmap.height);
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      if (bitmap.close) bitmap.close();
      return canvas;
    } catch (error) {
      return null;
    }
  };

  const linkName = (uri) => {
    const last = String(uri || "").split(/[\\/:]/).pop();
    try {
      return decodeURIComponent(last);
    } catch (error) {
      return last;
    }
  };
  const stem = (name) => name.replace(/\.[^.]+$/, "").toLowerCase();

  // A folder's pictures, by name: the one InDesign links, or one with the same name in
  // another format (a .tif turned into a .psd)
  const indexFolder = async (folder, into = new Map(), depth = 0) => {
    for await (const handle of folder.values()) {
      if (handle.kind === "directory" && depth < 3 && !/^\./.test(handle.name)) await indexFolder(handle, into, depth + 1);
      else if (handle.kind === "file") {
        const name = handle.name.toLowerCase();
        if (!into.has(name)) into.set(name, handle);
        if (!into.has("\u0000" + stem(name))) into.set("\u0000" + stem(name), handle);
      }
    }
    return into;
  };
  const indexFiles = (files) => {
    const into = new Map();
    files.forEach((file) => {
      const name = file.name.toLowerCase();
      if (!into.has(name)) into.set(name, file);
      if (!into.has("\u0000" + stem(name))) into.set("\u0000" + stem(name), file);
    });
    return into;
  };
  const findLinked = async (folder, uri) => {
    if (!folder) return null;
    const name = linkName(uri).toLowerCase();
    const found = folder.get(name) || folder.get("\u0000" + stem(name));
    if (!found) return null;
    const file = found.getFile ? await found.getFile() : found;
    return new Uint8Array(await file.arrayBuffer());
  };

  const base64ToBytes = (text) => {
    const binary = atob(text.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };
  const bytesToBase64 = (bytes) => {
    let out = "";
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out).replace(/.{76}(?=.)/g, "$&\n");
  };

  /* ---------------------------------- pages --------------------------------- */

  const graphicOf = (el) => children(el).find((node) => GRAPHICS.has(node.localName)) || null;

  const tracePaths = (ctx, paths, m) => {
    ctx.beginPath();
    paths.forEach(({ points, open }) => {
      const at = (p) => apply(m, p);
      ctx.moveTo(...at(points[0].anchor));
      for (let i = 1; i < points.length; i++) ctx.bezierCurveTo(...at(points[i - 1].right), ...at(points[i].left), ...at(points[i].anchor));
      if (!open && points.length > 1) {
        const last = points[points.length - 1];
        ctx.bezierCurveTo(...at(last.right), ...at(points[0].left), ...at(points[0].anchor));
        ctx.closePath();
      }
    });
  };

  const insetsOf = (model, el) => {
    const pref = child(el, "TextFramePreference");
    let inset = valueOf(pref, "InsetSpacing");
    if (inset === undefined) {
      const style = el.getAttribute("AppliedObjectStyle");
      let styleEl = style && model.styles.get(style);
      for (let depth = 0; styleEl && depth < 30 && inset === undefined; depth++) {
        inset = valueOf(child(styleEl, "TextFramePreference"), "InsetSpacing");
        const based = valueOf(styleEl, "BasedOn");
        styleEl = based ? model.styles.get(based) : null;
      }
    }
    const list = Array.isArray(inset) ? inset.map(Number) : [Number(inset) || 0];
    const [top, left = top, bottom = top, right = left] = list;
    return { top: top || 0, left: left || 0, bottom: bottom || 0, right: right || 0 };
  };
  const framePrefOf = (model, el, name) => {
    const own = child(el, "TextFramePreference");
    if (own && own.hasAttribute(name)) return own.getAttribute(name);
    let styleEl = model.styles.get(el.getAttribute("AppliedObjectStyle"));
    for (let depth = 0; styleEl && depth < 30; depth++) {
      const pref = child(styleEl, "TextFramePreference");
      if (pref && pref.hasAttribute(name)) return pref.getAttribute(name);
      const based = valueOf(styleEl, "BasedOn");
      styleEl = based ? model.styles.get(based) : null;
    }
    return undefined;
  };

  // From a page's own coordinates, in points, to its pixels
  const pixelsOf = (page, k) => [k, 0, 0, k, -page.bounds.left * k, -page.bounds.top * k];

  // The items of a spread that belong to a page: their middle is on it
  // The items of a spread that belong to a page: their middle is on it, or nearer to it than
  // to the spread's other pages. What lies far out on the pasteboard is left out.
  const distanceTo = (page, spreadPoint) => {
    const [x, y] = apply(invert(page.transform), spreadPoint);
    const b = page.bounds;
    return Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
  };
  const itemsOfPage = (model, page) => page.spread.items.filter((item) => {
    const anchors = [];
    pathsOf(item.el).forEach((path) => path.points.forEach((point) => anchors.push(apply(item.transform, point.anchor))));
    if (!anchors.length) return false;
    const box = boundsOf(anchors);
    const middle = [(box.left + box.right) / 2, (box.top + box.bottom) / 2];
    const mine = distanceTo(page, middle);
    return mine < 400 && page.spread.pages.every((other) => other === page || mine <= distanceTo(other, middle));
  });

  const layerOrder = (model, items) => items.slice().sort((a, b) => {
    const ra = model.layerRank.get(a.layer);
    const rb = model.layerRank.get(b.layer);
    return ((ra && ra.rank) || 0) - ((rb && rb.rank) || 0) || a.order - b.order;
  });
  const itemShown = (model, item) => {
    const layer = model.layerRank.get(item.layer);
    return !item.hidden && (!layer || layer.visible);
  };

  // Signatures of what a text layer holds, to tell later what TypeR changed
  const textSignature = (layer) => {
    const lt = layer.params.layerText;
    return JSON.stringify([lt.textKey, lt.textStyleRange, lt.paragraphStyleRange, lt.textShape, layer.stroke || null]);
  };
  const placeSignature = (layer) => JSON.stringify([layer.params.layerText.textClickPoint, layer.rotated ? layer.spin : null]);

  const pageDocument = async (model, pkg, page, assets) => {
    const toPage = invert(page.transform);
    const items = layerOrder(model, itemsOfPage(model, page));
    const wPt = page.bounds.right - page.bounds.left;
    const hPt = page.bounds.bottom - page.bounds.top;

    // The pictures first: the page takes the resolution of its largest one
    const pictures = new Map();
    let ppi = 0;
    let largest = 0;
    for (const item of items) {
      const graphic = graphicOf(item.el);
      if (!graphic || !itemShown(model, item)) continue;
      const self = graphic.getAttribute("Self");
      const link = child(graphic, "Link");
      const uri = link ? link.getAttribute("LinkResourceURI") : "";
      const contents = descendant(graphic, ["Properties", "Contents"]);
      let bytes = contents ? base64ToBytes(contents.textContent) : await findLinked(assets.folder, uri).catch(() => null);
      let picture = null;
      try {
        picture = bytes ? await decodePicture(bytes) : null;
      } catch (error) {
        console.warn("TypeR InDesign: picture not read", uri, error);
      }
      let fromPreview = false;
      if (!picture && assets.previews && assets.previews.has(self)) {
        picture = await decodePicture(assets.previews.get(self)).catch(() => null);
        fromPreview = Boolean(picture);
      }
      if (!picture) {
        if (uri) assets.missing.add(linkName(uri));
        continue;
      }
      if (fromPreview) assets.previewed.add(linkName(uri));
      const gb = child(child(graphic, "Properties"), "GraphicBounds");
      const box = gb ? ["Left", "Top", "Right", "Bottom"].map((name) => Number(gb.getAttribute(name))) : [0, 0, picture.width, picture.height];
      const graphicT = compose(item.transform, matrixOf(graphic.getAttribute("ItemTransform")));
      const onPage = compose(toPage, graphicT);
      const widthPt = (box[2] - box[0]) * Math.hypot(onPage[0], onPage[1]);
      const area = widthPt * (box[3] - box[1]) * Math.hypot(onPage[2], onPage[3]);
      // A preview says nothing of the real file's resolution
      if (!fromPreview && widthPt > 0 && area > largest) {
        largest = area;
        ppi = (picture.width / widthPt) * 72;
      }
      pictures.set(item, { picture, box, graphicT });
    }
    let resolution = Math.round(Math.min(1200, Math.max(72, ppi || 300)));
    while (resolution > 72 && !PS().canvasFits(Math.ceil((wPt * resolution) / 72), Math.ceil((hPt * resolution) / 72))) resolution = Math.round(resolution * 0.8);
    const k = resolution / 72;
    const width = Math.max(1, Math.round(wPt * k));
    const height = Math.max(1, Math.round(hPt * k));
    const toPixels = compose(pixelsOf(page, k), toPage);

    // The page's picture: white paper, the placed files, InDesign's shapes
    const canvas = canvasOf(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    const layers = [];
    const frames = [];
    const texts = [];
    for (const item of items) {
      if (!itemShown(model, item)) {
        if (item.tag === "TextFrame") texts.push(item);
        continue;
      }
      const m = compose(toPixels, item.transform);
      const paths = pathsOf(item.el);
      const blending = descendant(item.el, ["TransparencySetting", "BlendingSetting"]);
      const opacity = blending && blending.hasAttribute("Opacity") ? Math.max(0, Math.min(1, Number(blending.getAttribute("Opacity")) / 100)) : 1;
      ctx.globalAlpha = opacity;
      const fill = colorOf(model, itemValue(model, item.el, "FillColor"), itemValue(model, item.el, "FillTint"));
      if (fill && paths.length) {
        ctx.save();
        ctx.fillStyle = cssOf(fill);
        tracePaths(ctx, paths, m);
        ctx.fill("evenodd");
        ctx.restore();
      }
      const placed = pictures.get(item);
      if (placed) {
        ctx.save();
        if (paths.length) {
          tracePaths(ctx, paths, m);
          ctx.clip("evenodd");
        }
        const g = compose(toPixels, placed.graphicT);
        ctx.setTransform(g[0], g[1], g[2], g[3], g[4], g[5]);
        ctx.imageSmoothingQuality = "high";
        const [l, t, r, b] = placed.box;
        ctx.drawImage(placed.picture, l, t, r - l, b - t);
        ctx.restore();
      } else if (graphicOf(item.el) && paths.length) {
        // A picture that can't be shown: the frame stays visible, as InDesign shows it
        ctx.save();
        tracePaths(ctx, paths, m);
        ctx.fillStyle = "#e9e9e9";
        ctx.fill("evenodd");
        ctx.restore();
      }
      const strokeColor = colorOf(model, itemValue(model, item.el, "StrokeColor"), itemValue(model, item.el, "StrokeTint"));
      const weight = Number(itemValue(model, item.el, "StrokeWeight")) || 0;
      if (strokeColor && weight > 0 && paths.length) {
        ctx.save();
        ctx.strokeStyle = cssOf(strokeColor);
        ctx.lineWidth = weight * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
        ctx.lineJoin = "round";
        tracePaths(ctx, paths, m);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (item.tag === "TextFrame") texts.push(item);
    }
    const picture = PS().newRaster((PS().app.names && PS().app.names.background) || "Background", { bitmap: canvas, isBackground: true });
    layers.push(picture);

    // The texts, on top, in InDesign's order
    const fontNames = [];
    texts.forEach((item) => {
      const el = item.el;
      const previous = el.getAttribute("PreviousTextFrame");
      // A story threaded through several frames is all in its first one
      if (previous && previous !== "n") return;
      const story = model.stories.get(el.getAttribute("ParentStory"));
      if (!story) return;
      const m = compose(toPixels, item.transform);
      const sx = Math.hypot(m[0], m[1]);
      const sy = Math.hypot(m[2], m[3]);
      const scale = (sx + sy) / 2 / k;
      const read = readStory(model, story.el, scale);
      const insets = insetsOf(model, el);
      const local = pathBounds(pathsOf(el));
      const origin = apply(m, [local.left + insets.left, local.top + insets.top]);
      const box = {
        width: Math.max(1, (local.right - local.left - insets.left - insets.right) * sx),
        height: Math.max(1, (local.bottom - local.top - insets.top - insets.bottom) * sy),
        autoHeight: false,
        verticalAlign: framePrefOf(model, el, "VerticalJustification") === "CenterAlign" ? "center" : "top",
      };
      const params = {
        layerText: {
          textKey: read.text,
          antiAlias: "antiAliasSmooth",
          textClickPoint: { horizontal: (origin[0] / width) * 100, vertical: (origin[1] / height) * 100 },
          textStyleRange: read.ranges,
          paragraphStyleRange: [{ from: 0, to: read.text.length, paragraphStyle: read.paragraph }],
          textShape: [{ textType: "box", orientation: "horizontal", box }],
        },
      };
      read.ranges.forEach((range) => fontNames.push(range.textStyle.fontPostScriptName));
      let stroke = read.stroke ? { enabled: true, size: Math.max(1, (read.stroke.weight / 2) * k), opacity: 100, position: "outer", color: { r: read.stroke.color.red, g: read.stroke.color.green, b: read.stroke.color.blue } } : null;
      // The stroke TypeR writes: a precise outer glow on the text
      const glow = descendant(el, ["ContentTransparencySetting", "OuterGlowSetting"]);
      if (glow && glow.getAttribute("Applied") === "true" && glow.getAttribute("Technique") === "Precise") {
        const color = colorOf(model, glow.getAttribute("EffectColor"), -1) || { red: 255, green: 255, blue: 255 };
        stroke = { enabled: true, size: Number(glow.getAttribute("Size")) * sx, opacity: glow.hasAttribute("Opacity") ? Number(glow.getAttribute("Opacity")) : 75, position: "outer", color: { r: color.red, g: color.green, b: color.blue } };
      }
      const layer = PS().newTextLayer(null, params, stroke, el.getAttribute("Name") && !/^\$ID\//.test(el.getAttribute("Name")) ? el.getAttribute("Name") : read.text);
      if (!itemShown(model, item)) layer.visible = false;
      const turned = Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6 || m[0] < 0 || m[3] < 0;
      if (turned) {
        layer.rotated = true;
        layer.spin = [m[0] / sx, m[1] / sx, m[2] / sy, m[3] / sy];
      }
      layer.idml = { pkg: pkg.id, frame: item.self, text: textSignature(layer), place: placeSignature(layer), visible: layer.visible !== false };
      layers.push(layer);
      frames.push(item.self);
    });
    return { width, height, resolution, layers, picture, frames, fontNames };
  };

  /* ---------------------------------- open ---------------------------------- */

  let lastPackage = 0;
  const packageId = () => `idml-${Date.now().toString(36)}-${(lastPackage++).toString(36)}`;

  // The .idml or .indd, read: its pages to open, and the pictures it links
  const read = async (file) => {
    const raw = new Uint8Array(await file.arrayBuffer());
    const zipped = raw[0] === 0x50 && raw[1] === 0x4b;
    let bytes = raw;
    let previews = null;
    let warnings = [];
    if (!zipped) {
      const converted = await convertIndd(raw);
      bytes = converted.idml;
      previews = converted.previews;
      warnings = converted.warnings;
    }
    const files = await readZip(bytes);
    const model = readModel(files);
    const links = new Set();
    let embedded = 0;
    model.spreads.forEach((spread) => spread.items.forEach((item) => {
      const graphic = graphicOf(item.el);
      if (!graphic) return;
      if (descendant(graphic, ["Properties", "Contents"])) embedded++;
      else {
        const link = child(graphic, "Link");
        if (link && link.getAttribute("LinkResourceURI")) links.add(linkName(link.getAttribute("LinkResourceURI")));
      }
    }));
    const pkg = { id: packageId(), name: file.name, format: zipped ? "idml" : "indd", files, frames: {}, previews, warnings };
    return { pkg, model, links: Array.from(links), embedded, pageCount: model.pages.size };
  };

  // Each page as what TypeR's addDoc takes. `folder`: the pictures, from linkFolder() or linkFiles()
  const pages = async ({ pkg, model }, folder) => {
    const assets = { folder, previews: pkg.previews, missing: new Set(), previewed: new Set() };
    const out = [];
    const stemName = pkg.name.replace(/\.[^.]+$/, "");
    const many = model.pages.size > 1;
    for (const page of model.pages.values()) {
      const built = await pageDocument(model, pkg, page, assets);
      pkg.frames[page.self] = built.frames;
      out.push({
        name: many ? `${stemName} – ${page.name}` : stemName,
        width: built.width,
        height: built.height,
        resolution: built.resolution,
        layers: built.layers,
        fontNames: built.fontNames,
        idml: { pkg, page: page.self, picture: built.picture },
      });
    }
    // Only for the pages: the package is written back without them
    pkg.previews = null;
    return { pages: out, missing: Array.from(assets.missing), previewed: Array.from(assets.previewed) };
  };

  const linkFolder = (handle) => indexFolder(handle);
  const linkFiles = (files) => indexFiles(files);

  /* ---------------------------------- write ---------------------------------- */

  const nextIds = (files) => {
    let max = 0x100;
    const decoder = new TextDecoder();
    Object.keys(files).forEach((path) => {
      if (!/\.xml$/i.test(path)) return;
      const text = decoder.decode(files[path]);
      const pattern = /Self="u([0-9a-f]+)"/g;
      let found;
      while ((found = pattern.exec(text))) max = Math.max(max, parseInt(found[1], 16));
    });
    return () => `u${(++max).toString(16)}`;
  };

  const swatchFor = (model, color, dirty) => {
    const { red, green, blue } = color;
    if (!red && !green && !blue && model.colors.has("Color/Black")) return "Color/Black";
    if (red === 255 && green === 255 && blue === 255 && model.colors.has("Color/Paper")) return "Color/Paper";
    for (const [self, el] of model.colors) {
      if (el.localName !== "Color" || el.getAttribute("Space") !== "RGB") continue;
      const values = (el.getAttribute("ColorValue") || "").split(/\s+/).map(Number);
      if (Math.round(values[0]) === red && Math.round(values[1]) === green && Math.round(values[2]) === blue) return self;
    }
    const self = `Color/TypeR R=${red} G=${green} B=${blue}`;
    if (!model.graphicDoc) return "Color/Black";
    const el = model.graphicDoc.createElement("Color");
    [["Self", self], ["Model", "Process"], ["Space", "RGB"], ["ColorValue", `${red} ${green} ${blue}`], ["ColorOverride", "Normal"], ["AlternateSpace", "NoAlternateColor"], ["AlternateColorValue", ""], ["Name", `R=${red} G=${green} B=${blue}`], ["ColorEditable", "true"], ["ColorRemovable", "true"], ["Visible", "true"], ["SwatchCreatorID", "7937"]]
      .forEach(([name, value]) => el.setAttribute(name, value));
    const root = model.graphicDoc.documentElement;
    const lastColor = children(root, "Color").pop();
    if (lastColor) lastColor.after(el);
    else root.insertBefore(el, root.firstElementChild);
    model.colors.set(self, el);
    dirty.add(model.graphicPath);
    return self;
  };

  // InDesign names a font by its family and style. A font this computer doesn't have may only
  // be known by its PostScript name: "Sakana-Bold" is taken as Sakana, Bold.
  const fontOf = (style) => {
    const ps = style.fontPostScriptName || "";
    const known = Fonts.get(ps);
    // A font found on the computer by its PostScript name alone has no family of its own
    if (known && known.family !== ps) return { family: known.family, style: known.style, ps };
    const name = style.fontName || ps || "Minion Pro";
    if ((name === ps || !/\s/.test(name)) && /^[^-\s]+-[^-\s]+$/.test(ps) && (!style.fontStyleName || style.fontStyleName === "Regular")) {
      const [family, weight] = ps.split("-");
      return { family, style: weight, ps };
    }
    return { family: name, style: style.fontStyleName || "Regular", ps };
  };

  // Each font written gets its entry in Fonts.xml, so that InDesign and TypeR find the same one
  const registerFont = (model, font, dirty) => {
    const key = `${font.family}\u0000${font.style}`;
    if (!model.fontsDoc || !font.ps || model.fontNames.has(key)) return;
    const doc = model.fontsDoc;
    const root = doc.documentElement;
    let family = children(root, "FontFamily").find((el) => el.getAttribute("Name") === font.family);
    if (!family) {
      family = doc.createElement("FontFamily");
      family.setAttribute("Self", `diTypeR${children(root, "FontFamily").length}${font.family.replace(/[^A-Za-z0-9]/g, "")}`);
      family.setAttribute("Name", font.family);
      const composite = child(root, "CompositeFont");
      if (composite) root.insertBefore(family, composite);
      else root.appendChild(family);
    }
    const el = doc.createElement("Font");
    const full = `${font.family} ${font.style}`;
    [["Self", `${family.getAttribute("Self")}Fontn${full}`], ["FontFamily", font.family], ["Name", full], ["PostScriptName", font.ps], ["Status", "Unknown"], ["FontStyleName", font.style], ["FontType", "Unknown"], ["WritingScript", "0"], ["FullName", full], ["FullNameNative", full], ["FontStyleNameNative", font.style], ["PlatformName", "$ID/"], ["Version", ""]]
      .forEach(([name, value]) => el.setAttribute(name, value));
    family.appendChild(el);
    model.fontNames.set(key, font.ps);
    dirty.add(model.fontsPath);
  };

  const runXml = (model, style, text, dirty) => {
    const font = fontOf(style);
    registerFont(model, font, dirty);
    const color = swatchFor(model, style.color || { red: 0, green: 0, blue: 0 }, dirty);
    const attrs = {
      AppliedCharacterStyle: "CharacterStyle/$ID/[No character style]",
      FontStyle: font.style,
      PointSize: num(style.impliedFontSize || style.size || 12),
      Tracking: num(style.tracking || 0),
      HorizontalScale: num(style.horizontalScale || 100),
      VerticalScale: num(style.verticalScale || 100),
      BaselineShift: num((style.impliedBaselineShift !== undefined ? style.impliedBaselineShift : style.baselineShift) || 0),
      Capitalization: style.fontCaps === "allCaps" ? "AllCaps" : style.fontCaps === "smallCaps" ? "SmallCaps" : "Normal",
      Position: style.baseline === "superScript" ? "Superscript" : style.baseline === "subScript" ? "Subscript" : "Normal",
      Underline: String(Boolean(style.underline) && style.underline !== "underlineOff"),
      StrikeThru: String(Boolean(style.strikethrough) && style.strikethrough !== "strikethroughOff"),
      Ligatures: String(style.ligature !== false),
      KerningMethod: style.autoKern === "manual" ? "$ID/Manual" : "$ID/Metric",
      FillColor: color,
      FillTint: "-1",
      Skew: style.syntheticItalic ? "12" : "0",
      // InDesign has no faux bold: a thin stroke of the letters' own colour comes close
      StrokeColor: style.syntheticBold ? color : "Swatch/None",
      StrokeWeight: style.syntheticBold ? num((style.impliedFontSize || style.size || 12) / 40) : "0",
    };
    const leading = style.autoLeading === false && style.leading > 0 ? `<Leading type="unit">${num(style.leading)}</Leading>` : `<Leading type="enumeration">Auto</Leading>`;
    const content = text.split(LINE_BREAK).map((part) => esc(cleanText(part))).join(LINE_BREAK);
    return `<CharacterStyleRange ${Object.keys(attrs).map((name) => `${name}="${esc(attrs[name])}"`).join(" ")}><Properties><AppliedFont type="string">${esc(font.family)}</AppliedFont>${leading}</Properties><Content>${content}</Content></CharacterStyleRange>`;
  };

  // A text layer's lines as TypeR sets them, each line ended by a forced line break, so that
  // InDesign breaks them where TypeR did
  const storyContentXml = (model, layer, doc, paragraphStyle, dirty) => {
    const lt = layer.params.layerText;
    const relative = PS().layoutLayer(layer, doc).relative;
    const base = (lt.textStyleRange && lt.textStyleRange[0] && lt.textStyleRange[0].textStyle) || {};
    const runs = [];
    relative.wrapped.forEach((line, index) => {
      if (index > 0) {
        const last = runs[runs.length - 1];
        if (last) last.text += LINE_BREAK;
        else runs.push({ style: base, text: LINE_BREAK });
      }
      line.forEach((run) => {
        const last = runs[runs.length - 1];
        if (last && last.style === run.style && !last.text.endsWith(LINE_BREAK)) last.text += run.text;
        else runs.push({ style: run.style, text: run.text });
      });
    });
    if (!runs.length) runs.push({ style: base, text: "" });
    const paragraph = (lt.paragraphStyleRange && lt.paragraphStyleRange[0] && lt.paragraphStyleRange[0].paragraphStyle) || {};
    const attrs = {
      AppliedParagraphStyle: paragraphStyle || "ParagraphStyle/$ID/NormalParagraphStyle",
      Justification: ALIGN_OUT[paragraph.alignment] || "CenterAlign",
      AutoLeading: num((paragraph.autoLeadingPercentage || 1.2) * 100),
      LeftIndent: "0",
      RightIndent: "0",
      FirstLineIndent: "0",
      SpaceBefore: "0",
      SpaceAfter: "0",
      Hyphenation: "false",
    };
    return `<ParagraphStyleRange ${Object.keys(attrs).map((name) => `${name}="${esc(attrs[name])}"`).join(" ")}>${runs.map((run) => runXml(model, run.style, run.text, dirty)).join("")}</ParagraphStyleRange>`;
  };

  const fragment = (doc, xml) => {
    const parsed = parseXml(`<x>${xml}</x>`);
    return children(parsed.documentElement).map((node) => doc.importNode(node, true));
  };

  const hangsOf = (layer) => {
    const lt = layer.params.layerText;
    return Boolean(lt.paragraphStyleRange && lt.paragraphStyleRange[0] && lt.paragraphStyleRange[0].paragraphStyle && lt.paragraphStyleRange[0].paragraphStyle.hangingRoman);
  };

  const writeStory = (model, storyEl, layer, doc, dirty, path) => {
    const preference = child(storyEl, "StoryPreference");
    if (preference) preference.setAttribute("OpticalMarginAlignment", String(hangsOf(layer)));
    const first = child(storyEl, "ParagraphStyleRange");
    const paragraphStyle = first && first.getAttribute("AppliedParagraphStyle");
    children(storyEl).forEach((node) => {
      if (!["StoryPreference", "InCopyExportOption", "Properties"].includes(node.localName)) node.remove();
    });
    fragment(storyEl.ownerDocument, storyContentXml(model, layer, doc, paragraphStyle, dirty)).forEach((node) => storyEl.appendChild(node));
    dirty.add(path);
  };

  const newStoryFile = (model, self, layer, doc, dirty) => {
    const xml = `<idPkg:Story xmlns:idPkg="${IDPKG}" DOMVersion="${esc(model.domVersion)}"><Story Self="${self}" UserText="true" IsEndnoteStory="false" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n"><StoryPreference OpticalMarginAlignment="${hangsOf(layer)}" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/><InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false"/>${storyContentXml(model, layer, doc, null, dirty)}</Story></idPkg:Story>`;
    return serializeXml(parseXml(xml));
  };

  // Where a text layer sits on its page, in pixels: its frame's corner, size and turn. A point
  // text gets a frame around its lines that InDesign fits to them.
  const frameGeometry = (layer, doc) => {
    const lt = layer.params.layerText;
    const layout = PS().layoutLayer(layer, doc);
    const relative = layout.relative;
    const spin = layer.rotated && layer.spin ? layer.spin : [1, 0, 0, 1];
    const anchor = layout.anchor;
    const paragraph = (lt.paragraphStyleRange && lt.paragraphStyleRange[0] && lt.paragraphStyleRange[0].paragraphStyle) || {};
    const align = paragraph.alignment || "center";
    const shape = lt.textShape && lt.textShape[0];
    const box = shape && shape.textType === "box" && shape.box;
    // A little more room than TypeR needs: InDesign measures its letters its own way
    const room = (width) => Math.max(width * 0.03, (2 * doc.resolution) / 72);
    let left;
    let top;
    let width;
    let height;
    let auto = false;
    if (box) {
      const extra = room(box.width);
      left = align === "left" ? 0 : align === "right" ? -extra : -extra / 2;
      top = 0;
      width = box.width + extra;
      height = box.autoHeight ? relative.frame.height : box.height;
    } else {
      const widest = relative.lines.reduce((most, line) => Math.max(most, line.m.advance), 0);
      const extra = room(widest);
      width = widest + extra;
      left = align === "left" ? 0 : align === "right" ? -width : -width / 2;
      top = -relative.firstOffset;
      height = Math.max(relative.contentHeight + relative.firstOffset, 1);
      auto = true;
    }
    const origin = [anchor[0] + spin[0] * left + spin[2] * top, anchor[1] + spin[1] * left + spin[3] * top];
    return { origin, spin, width, height, auto, align, verticalAlign: box ? (box.verticalAlign === "center" ? "CenterAlign" : "TopAlign") : "TopAlign" };
  };

  const framePrefXml = (geometry) => {
    const reference = { left: "TopLeftPoint", center: "TopCenterPoint", right: "TopRightPoint" }[geometry.align] || "TopCenterPoint";
    return `<TextFramePreference TextColumnCount="1" FirstBaselineOffset="AscentOffset" VerticalJustification="${geometry.verticalAlign}" AutoSizingType="${geometry.auto ? "HeightAndWidth" : "Off"}" AutoSizingReferencePoint="${reference}" UseNoLineBreaksForAutoSizing="${geometry.auto}"><Properties><InsetSpacing type="list"><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem></InsetSpacing></Properties></TextFramePreference>`;
  };

  // TypeR's stroke goes around the letters. InDesign's is centred on them: an outer glow at
  // full spread, precise, is the stroke around them.
  const glowXml = (model, layer, k, dirty) => {
    const stroke = layer.stroke;
    if (!stroke || stroke.enabled === false || !(stroke.size > 0)) return "";
    const color = swatchFor(model, { red: stroke.color.r, green: stroke.color.g, blue: stroke.color.b }, dirty);
    const size = (stroke.size + (stroke.outer && stroke.outer.size > 0 ? stroke.outer.size : 0)) / k;
    return `<ContentTransparencySetting><OuterGlowSetting Applied="true" BlendMode="Normal" Opacity="${num(stroke.opacity === undefined ? 100 : stroke.opacity)}" Noise="0" EffectColor="${esc(color)}" Technique="Precise" Spread="100" Size="${num(Math.min(1000, size))}"/></ContentTransparencySetting>`;
  };

  // The transform that puts a frame drawn from (0, 0) in points where the layer is
  const frameTransform = (page, parentT, geometry, k) => {
    const [a, b, c, d] = geometry.spin;
    const local = [a * k, b * k, c * k, d * k, geometry.origin[0], geometry.origin[1]];
    const pageFromPixels = [1 / k, 0, 0, 1 / k, page.bounds.left, page.bounds.top];
    return compose(invert(parentT), compose(page.transform, compose(pageFromPixels, local)));
  };

  const setFrame = (model, el, page, parentT, layer, doc, dirty) => {
    const k = doc.resolution / 72;
    const geometry = frameGeometry(layer, doc);
    el.setAttribute("ItemTransform", matrixText(frameTransform(page, parentT, geometry, k)));
    let props = child(el, "Properties");
    if (!props) {
      props = el.ownerDocument.createElement("Properties");
      el.insertBefore(props, el.firstElementChild);
    }
    const oldGeometry = child(props, "PathGeometry");
    const [path] = fragment(el.ownerDocument, rectPath(geometry.width / k, geometry.height / k));
    if (oldGeometry) oldGeometry.replaceWith(path);
    else props.insertBefore(path, props.firstElementChild);
    const [pref] = fragment(el.ownerDocument, framePrefXml(geometry));
    const oldPref = child(el, "TextFramePreference");
    if (oldPref) oldPref.replaceWith(pref);
    else el.appendChild(pref);
    const oldGlow = child(el, "ContentTransparencySetting");
    const glow = glowXml(model, layer, k, dirty);
    if (oldGlow) oldGlow.remove();
    if (glow) el.appendChild(fragment(el.ownerDocument, glow)[0]);
  };

  const textLayerOf = (model, page) => {
    const frames = page.spread.items.filter((item) => item.tag === "TextFrame" && item.layer);
    if (frames.length) return frames[frames.length - 1].layer;
    const open = model.layers.find((layer) => !layer.locked && layer.visible) || model.layers[0];
    return open ? open.self : null;
  };

  const addStoryToMap = (model, self, path) => {
    const root = model.root;
    const entry = model.designmap.createElementNS(IDPKG, "idPkg:Story");
    entry.setAttribute("src", path);
    const stories = Array.from(root.getElementsByTagNameNS(IDPKG, "Story"));
    if (stories.length) stories[stories.length - 1].after(entry);
    else {
      // The first story: after what the schema puts before stories
      const before = new Set(["Layer", "MasterSpread", "Spread", "Section", "DocumentUser", "CrossReferenceFormat", "Index", "BackingStory"]);
      const last = children(root).filter((node) => before.has(node.localName)).pop();
      if (last) last.after(entry);
      else root.appendChild(entry);
    }
    const list = (root.getAttribute("StoryList") || "").split(/\s+/).filter(Boolean);
    list.push(self);
    root.setAttribute("StoryList", list.join(" "));
  };
  const removeStoryFromMap = (model, self, path) => {
    const root = model.root;
    Array.from(root.getElementsByTagNameNS(IDPKG, "Story")).forEach((entry) => {
      if (entry.getAttribute("src") === path) entry.remove();
    });
    root.setAttribute("StoryList", (root.getAttribute("StoryList") || "").split(/\s+/).filter((id) => id && id !== self).join(" "));
  };

  // The package with the pages' texts as they are now. `docs`: its open pages.
  const build = async (pkg, docs) => {
    const files = Object.assign({}, pkg.files);
    const model = readModel(files);
    const dirty = new Set();
    const newId = nextIds(files);
    const added = {};
    const removed = new Set();
    const frames = {};
    const updates = [];
    for (const doc of docs) {
      const page = model.pages.get(doc.idml.page);
      if (!page) continue;
      const k = doc.resolution / 72;
      const seen = new Set();
      const kept = [];
      for (const layer of doc.state.layers) {
        if (layer.kind !== "text") continue;
        const info = layer.idml && layer.idml.pkg === pkg.id ? layer.idml : null;
        const item = info && !seen.has(info.frame) ? model.items.get(info.frame) : null;
        const visible = layer.visible !== false;
        if (item && item.tag === "TextFrame") {
          seen.add(info.frame);
          kept.push(info.frame);
          const el = item.el;
          const textChanged = textSignature(layer) !== info.text;
          const placeChanged = placeSignature(layer) !== info.place;
          if (textChanged) {
            const story = model.stories.get(el.getAttribute("ParentStory"));
            if (story) writeStory(model, story.el, layer, doc, dirty, story.path);
          }
          if (textChanged || placeChanged) setFrame(model, el, page, item.parentT, layer, doc, dirty);
          // Shown or hidden in TypeR: a frame hidden by its InDesign layer stays as it was
          const shownChanged = info.visible !== undefined && info.visible !== visible;
          if (shownChanged) el.setAttribute("Visible", String(visible));
          if (textChanged || placeChanged || shownChanged) dirty.add(item.spread.path);
          updates.push({ layer, frame: info.frame });
          continue;
        }
        // New in TypeR: a new frame on top of the page, with its own story
        const frameSelf = newId();
        const storySelf = newId();
        const storyPath = `Stories/Story_${storySelf}.xml`;
        added[storyPath] = newStoryFile(model, storySelf, layer, doc, dirty);
        addStoryToMap(model, storySelf, storyPath);
        dirty.add("designmap.xml");
        const itemLayer = textLayerOf(model, page);
        const name = esc(cleanText(layer.name || "").slice(0, 60)) || "$ID/";
        const [el] = fragment(page.spread.doc, `<TextFrame Self="${frameSelf}" ParentStory="${storySelf}" PreviousTextFrame="n" NextTextFrame="n" ContentType="TextType"${itemLayer ? ` ItemLayer="${esc(itemLayer)}"` : ""} Visible="${visible}" Name="${name}" AppliedObjectStyle="ObjectStyle/$ID/[None]" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0" ItemTransform="1 0 0 1 0 0"><Properties>${rectPath(1, 1)}</Properties></TextFrame>`);
        page.spread.el.appendChild(el);
        setFrame(model, el, page, IDENTITY, layer, doc, dirty);
        dirty.add(page.spread.path);
        seen.add(frameSelf);
        kept.push(frameSelf);
        updates.push({ layer, frame: frameSelf });
      }
      // Deleted in TypeR: the frame goes, and its story with it unless other frames share it
      (pkg.frames[page.self] || []).forEach((self) => {
        if (seen.has(self)) return;
        const item = model.items.get(self);
        if (!item || item.tag !== "TextFrame") return;
        const el = item.el;
        const threaded = ["PreviousTextFrame", "NextTextFrame"].some((name) => el.getAttribute(name) && el.getAttribute(name) !== "n");
        if (threaded) {
          kept.push(self);
          return;
        }
        const storySelf = el.getAttribute("ParentStory");
        el.remove();
        dirty.add(item.spread.path);
        const story = model.stories.get(storySelf);
        if (story) {
          removed.add(story.path);
          removeStoryFromMap(model, storySelf, story.path);
          dirty.add("designmap.xml");
        }
      });
      frames[page.self] = kept;
      void k;
    }
    dirty.forEach((path) => {
      const doc = model.xml.get(path);
      if (doc) files[path] = serializeXml(doc);
    });
    removed.forEach((path) => delete files[path]);
    Object.assign(files, added);
    // The mimetype first and as it is, as a package must start
    files.mimetype = new TextEncoder().encode(MIMETYPE);
    const order = ["mimetype"].concat(Object.keys(files).filter((path) => path !== "mimetype"));
    const blob = await Kit().writeArchive(order.map((path) => ({ name: path, data: files[path], store: path === "mimetype" })));
    // Called once the file is written: the package and its layers now match it
    const commit = () => {
      pkg.files = files;
      pkg.format = "idml";
      pkg.saves = (pkg.saves || 0) + 1;
      Object.assign(pkg.frames, frames);
      updates.forEach(({ layer, frame }) => {
        layer.idml = { pkg: pkg.id, frame, text: textSignature(layer), place: placeSignature(layer), visible: layer.visible !== false };
      });
    };
    return { blob, commit };
  };

  /* ------------------------------ a new package ------------------------------ */

  // Pages made elsewhere, as a new .idml: each page's picture embedded as a PNG, its texts as
  // frames. `docs` with their pictures: [{ doc, picture: PNG bytes }]
  const exportPackage = async (name, entries) => {
    const ids = { next: 0x200 };
    const id = () => `u${(ids.next++).toString(16)}`;
    const dom = "8.0";
    const first = entries[0].doc;
    const pt = (px, doc) => (px * 72) / doc.resolution;
    const textLayer = id();
    const artLayer = id();
    const files = {};
    const encode = (text) => new TextEncoder().encode(XML_HEAD + text);
    files["META-INF/container.xml"] = encode(`<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles></container>`);
    files["Resources/Graphic.xml"] = encode(`<idPkg:Graphic xmlns:idPkg="${IDPKG}" DOMVersion="${dom}">
<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Specialblack" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Black" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>
<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Specialpaper" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Paper" ColorEditable="true" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>
<Color Self="Color/Registration" Model="Registration" Space="CMYK" ColorValue="100 100 100 100" ColorOverride="Specialregistration" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Registration" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>
<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>
</idPkg:Graphic>`);
    files["Resources/Fonts.xml"] = encode(`<idPkg:Fonts xmlns:idPkg="${IDPKG}" DOMVersion="${dom}"></idPkg:Fonts>`);
    files["Resources/Styles.xml"] = encode(`<idPkg:Styles xmlns:idPkg="${IDPKG}" DOMVersion="${dom}">
<RootCharacterStyleGroup Self="u79"><CharacterStyle Self="CharacterStyle/$ID/[No character style]" Imported="false" Name="$ID/[No character style]"/></RootCharacterStyleGroup>
<RootParagraphStyleGroup Self="u78">
<ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" Imported="false" FillColor="Color/Black" FontStyle="Regular" PointSize="12" HorizontalScale="100" KerningMethod="$ID/Metric" Ligatures="true" Tracking="0" Capitalization="Normal" Position="Normal" Underline="false" StrikeThru="false" VerticalScale="100" BaselineShift="0" StrokeWeight="1" StrokeColor="Swatch/None" Justification="LeftAlign" AutoLeading="120" Hyphenation="true"><Properties><Leading type="enumeration">Auto</Leading><AppliedFont type="string">Minion Pro</AppliedFont></Properties></ParagraphStyle>
<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" Imported="false" NextStyle="ParagraphStyle/$ID/NormalParagraphStyle"><Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn></Properties></ParagraphStyle>
</RootParagraphStyleGroup>
<RootCellStyleGroup Self="u8a"><CellStyle Self="CellStyle/$ID/[None]" Name="$ID/[None]"/></RootCellStyleGroup>
<RootTableStyleGroup Self="u8b"><TableStyle Self="TableStyle/$ID/[No table style]" Name="$ID/[No table style]"/></RootTableStyleGroup>
<RootObjectStyleGroup Self="u8c"><ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]" FillColor="Swatch/None" StrokeWeight="0" StrokeColor="Swatch/None"/></RootObjectStyleGroup>
</idPkg:Styles>`);
    const wPt = pt(first.width, first);
    const hPt = pt(first.height, first);
    files["Resources/Preferences.xml"] = encode(`<idPkg:Preferences xmlns:idPkg="${IDPKG}" DOMVersion="${dom}">
<DocumentPreference PageHeight="${num(hPt)}" PageWidth="${num(wPt)}" PagesPerDocument="${entries.length}" FacingPages="false" DocumentBleedTopOffset="0" DocumentBleedBottomOffset="0" DocumentBleedInsideOrLeftOffset="0" DocumentBleedOutsideOrRightOffset="0" DocumentBleedUniformSize="true" AllowPageShuffle="true" PageBinding="LeftToRight"/>
<ViewPreference HorizontalMeasurementUnits="Millimeters" VerticalMeasurementUnits="Millimeters" TypographicMeasurementUnits="Points" TextSizeMeasurementUnits="Points"/>
</idPkg:Preferences>`);
    const spreads = [];
    entries.forEach(({ doc, picture }, index) => {
      const spreadSelf = id();
      const pageSelf = id();
      const pw = pt(doc.width, doc);
      const ph = pt(doc.height, doc);
      const path = `Spreads/Spread_${spreadSelf}.xml`;
      let image = "";
      if (picture) {
        const frame = id();
        const graphic = id();
        const link = id();
        const ppi = num(doc.resolution);
        image = `<Rectangle Self="${frame}" ContentType="GraphicType" ItemLayer="${artLayer}" Locked="false" Visible="true" Name="$ID/" AppliedObjectStyle="ObjectStyle/$ID/[None]" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0" ItemTransform="1 0 0 1 0 0"><Properties>${rectPath(pw, ph)}</Properties><Image Self="${graphic}" ItemTransform="1 0 0 1 0 0" ActualPpi="${ppi} ${ppi}" EffectivePpi="${ppi} ${ppi}" ImageRenderingIntent="UseColorSettings" Space="$ID/RGB" ImageTypeName="$ID/Portable Network Graphics (PNG)" Visible="true" Name="$ID/"><Properties><Contents><![CDATA[${bytesToBase64(picture)}]]></Contents><GraphicBounds Left="0" Top="0" Right="${num(pw)}" Bottom="${num(ph)}"/></Properties><Link Self="${link}" AssetURL="$ID/" AssetID="$ID/" LinkResourceURI="file:${esc(encodeURIComponent(doc.name.replace(/\.[^.]+$/, "") + ".png"))}" LinkResourceFormat="$ID/Portable Network Graphics (PNG)" StoredState="Embedded" LinkClassID="35906" LinkClientID="257" LinkObjectModified="false" ShowInUI="true" ExportPolicy="NoAutoExport" ImportPolicy="NoAutoImport" CanEmbed="true" CanUnembed="true" CanPackage="true" LinkImportStamp="" LinkImportModificationTime="1970-01-01T00:00:00" LinkImportTime="1970-01-01T00:00:00" LinkResourceModified="false"/></Image></Rectangle>`;
      }
      files[path] = encode(`<idPkg:Spread xmlns:idPkg="${IDPKG}" DOMVersion="${dom}"><Spread Self="${spreadSelf}" PageCount="1" BindingLocation="0" AllowPageShuffle="true" ItemTransform="1 0 0 1 0 0" ShowMasterItems="true"><Page Self="${pageSelf}" Name="${index + 1}" AppliedMaster="n" GeometricBounds="0 0 ${num(ph)} ${num(pw)}" ItemTransform="1 0 0 1 0 0" MasterPageTransform="1 0 0 1 0 0" OverrideList=""/>${image}</Spread></idPkg:Spread>`);
      spreads.push({ path, pageSelf });
    });
    files["designmap.xml"] = encode(`<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="8.0(370)" ?><Document xmlns:idPkg="${IDPKG}" DOMVersion="${dom}" Self="d" StoryList="" Name="${esc(name)}" ZeroPoint="0 0" ActiveLayer="${textLayer}" CMYKProfile="U.S. Web Coated (SWOP) v2" RGBProfile="sRGB IEC61966-2.1" SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" DefaultImageIntent="UseColorSettings" RGBPolicy="PreserveEmbeddedProfiles" CMYKPolicy="CombinationOfPreserveAndSafeCmyk" AccurateLABSpots="false">
<Language Self="Language/$ID/English%3a USA" Name="$ID/English: USA" SingleQuotes="‘’" DoubleQuotes="“”" PrimaryLanguageName="$ID/English" SublanguageName="$ID/USA" Id="269" HyphenationVendor="Hunspell" SpellingVendor="Hunspell"/>
<idPkg:Graphic src="Resources/Graphic.xml"/>
<idPkg:Fonts src="Resources/Fonts.xml"/>
<idPkg:Styles src="Resources/Styles.xml"/>
<idPkg:Preferences src="Resources/Preferences.xml"/>
<Layer Self="${textLayer}" Name="${esc(T("Text"))}" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"><Properties><LayerColor type="enumeration">Red</LayerColor></Properties></Layer>
<Layer Self="${artLayer}" Name="${esc(T("Artwork"))}" Visible="true" Locked="true" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"><Properties><LayerColor type="enumeration">LightBlue</LayerColor></Properties></Layer>
${spreads.map((spread) => `<idPkg:Spread src="${spread.path}"/>`).join("\n")}
</Document>`);
    // The texts go in as new frames, as TypeR writes any frame
    const pkg = { id: packageId(), name, format: "idml", files, frames: {} };
    const docs = entries.map(({ doc }, index) => ({ resolution: doc.resolution, width: doc.width, height: doc.height, state: doc.state, idml: { pkg, page: spreads[index].pageSelf } }));
    // Layers of another .idml are new here
    const fresh = docs.map((doc) => Object.assign({}, doc, { state: Object.assign({}, doc.state, { layers: doc.state.layers.map((layer) => (layer.kind === "text" && layer.idml ? Object.assign({}, layer, { idml: null }) : layer)) }) }));
    const { blob } = await build(pkg, fresh);
    return blob;
  };

  const T = (english) => {
    const strings = window.TYPER_WEB_STRINGS && window.TYPER_I18N && window.TYPER_WEB_STRINGS[window.TYPER_I18N.lang];
    return (strings && strings[english]) || english;
  };

  // What the .idml can't take from a page: its picture changed (cleaned, painted), or
  // layers of pixels added. Those stay in TypeR, and in a PSD if the page is saved as one.
  const unsavedPixels = (doc) => {
    const picture = doc.idml && doc.idml.picture;
    return !doc.state.layers.includes(picture) || doc.state.layers.some((layer) => layer.kind === "raster" && layer !== picture);
  };

  // Pages of one file are kept as separate records when the session is saved: back from it,
  // they share one package again, the most recently saved
  const packages = new Map();
  const adopt = (doc) => {
    const pkg = doc.idml && doc.idml.pkg;
    if (!pkg) return;
    const known = packages.get(pkg.id);
    if (!known || (pkg.saves || 0) > (known.saves || 0)) {
      if (known) Object.assign(known, pkg);
      else packages.set(pkg.id, pkg);
    }
    doc.idml.pkg = packages.get(pkg.id);
  };

  window.TypeRInDesign = { isInDesignName, read, pages, linkFolder, linkFiles, build, exportPackage, unsavedPixels, adopt, convertIndd };
})();
