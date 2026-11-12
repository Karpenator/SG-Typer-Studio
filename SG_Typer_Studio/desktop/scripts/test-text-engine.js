const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const Optical = require(path.join(root, "web", "optical-kerning.js"));
const Txt2 = require(path.join(root, "web", "txt2.js"));

// A tiny deterministic glyph rasteriser. Profiles go through the same Canvas path as production,
// but the shapes are explicit so this regression doesn't depend on fonts installed on the host.
function glyphCanvasFactory() {
  return (width, height) => {
    const pixels = new Uint8ClampedArray(width * height * 4);
    const ctx = {
      font: "400 256px Test",
      textAlign: "left",
      textBaseline: "alphabetic",
      fillStyle: "#fff",
      measureText(text) {
        const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)[1]);
        return { width: Array.from(text).length * size * 0.6 };
      },
      fillText(text, x, baseline) {
        const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)[1]);
        for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
          const nx = (px - x) / size;
          const ny = (baseline - py) / size;
          if (ny < 0 || ny > 0.7) continue;
          let ink = false;
          if (text === "o" || text === "O") ink = nx >= 0.05 && nx <= 0.55 && ny >= 0.05 && ny <= 0.65;
          else if (text === "A") ink = nx >= 0.05 + ny * 0.35 && nx <= 0.55 - ny * 0.35;
          else if (text === "V") ink = nx >= 0.4 - ny * 0.35 && nx <= 0.2 + ny * 0.35;
          if (ink) pixels[(py * width + px) * 4 + 3] = 255;
        }
      },
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
          const from = ((y + row) * width + x + col) * 4;
          data.set(pixels.subarray(from, from + 4), (row * w + col) * 4);
        }
        return { data, width: w, height: h };
      },
    };
    return { width, height, getContext: () => ctx };
  };
}

test("Optical kerning uses glyph profiles and really changes pair positions", () => {
  Optical.setCanvasFactory(glyphCanvasFactory());
  const temp = Optical.spacing({ font: "400 100px Test", measureText: (s) => ({ width: s.length * 60 }) }, "test", "regular", "AV", 100, 100);
  const round = Optical.spacing({ font: "400 100px Test", measureText: (s) => ({ width: s.length * 60 }) }, "test", "regular", "oo", 100, 100);
  assert.ok(temp.total < -1, `AV must tighten, got ${temp.total}`);
  assert.ok(Math.abs(round.total) <= 0.33 + 1e-6, `the oo reference keeps only the fitted intercept at 100 pt, got ${round.total}`);
  assert.equal(temp.starts[1], temp.total);
  assert.equal(temp.starts[0], 0);
  const small = Optical.spacing({ font: "400 12px Test", measureText: (s) => ({ width: s.length * 7.2 }) }, "test", "regular", "oo", 12, 12);
  assert.ok(small.total > 0, "Photoshop Optical opens small type");
  Optical.clear();
});

test("Txt2 preserves exact Optical/manual/metrics runs and unknown resource fields", () => {
  const nodes = [{ text: {
    text: "AV",
    index: 0,
    style: { autoKerning: true },
    styleRuns: [
      { length: 1, style: { kerningMode: "opticalKern", autoKerning: true } },
      { length: 1, style: { kerningMode: "manual", autoKerning: false } },
    ],
  } }];
  const encoded = Txt2.build(null, nodes);
  const parsed = Txt2.parse(encoded);
  parsed.Custom = { Keep: 42 };
  const preserved = Txt2.base64FromBytes(Txt2.serialize(parsed));
  const params = { layerText: { textKey: "AV", textStyleRange: [{ from: 0, to: 2, textStyle: { fontPostScriptName: "Test" } }] } };
  Txt2.apply(nodes[0].text, preserved, params);
  assert.equal(params.layerText.textStyleRange.length, 2);
  assert.equal(params.layerText.textStyleRange[0].textStyle.autoKern, "opticalKern");
  assert.equal(params.layerText.textStyleRange[1].textStyle.autoKern, "manual");
  const round = Txt2.parse(Txt2.build(preserved, nodes));
  assert.equal(round.Custom.Keep, 42);
  assert.equal(round["1"]["1"][0]["0"]["0"].value, "AV\r");
});

test("Optical survives a real ag-psd write/read round-trip", () => {
  const agPsd = require(path.join(root, "web", "vendor", "ag-psd.js"));
  const makeCanvas = (width, height) => {
    const ctx = {
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData() {}, drawImage() {}, fillRect() {},
    };
    return { width, height, getContext: () => ctx };
  };
  agPsd.initializeCanvas(makeCanvas, (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }));
  const style = { font: { name: "ArialMT" }, fontSize: 20, fillColor: { r: 0, g: 0, b: 0 }, kerningMode: "opticalKern", autoKerning: true };
  const children = [{ name: "Optical", text: { text: "AV", index: 0, style, styleRuns: [{ length: 2, style }], transform: [1, 0, 0, 1, 0, 0] }, canvas: makeCanvas(20, 20), top: 0, left: 0, right: 20, bottom: 20 }];
  const psd = { width: 20, height: 20, bitsPerChannel: 8, colorMode: 3, canvas: makeCanvas(20, 20), children, imageResources: { resolutionInfo: { horizontalResolution: 72, verticalResolution: 72 } } };
  psd.engineData = Txt2.build(null, children);
  const bytes = agPsd.writePsdUint8Array(psd, { generateThumbnail: false, logMissingFeatures: false });
  const reopened = agPsd.readPsd(bytes, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true, logMissingFeatures: false });
  const params = { layerText: { textKey: "AV", textStyleRange: [{ from: 0, to: 2, textStyle: {} }] } };
  Txt2.apply(reopened.children[0].text, reopened.engineData, params);
  assert.equal(params.layerText.textStyleRange[0].textStyle.autoKern, "opticalKern");
});

test("Txt2 refuses a stale object's text and round-trips Unicode", () => {
  const nodes = [{ text: { text: "Привет AV", style: { kerningMode: "opticalKern" } } }];
  const encoded = Txt2.build(null, nodes);
  const text = nodes[0].text;
  const params = { layerText: { textKey: "Другое", textStyleRange: [{ from: 0, to: 6, textStyle: { autoKern: "metricsKern" } }] } };
  Txt2.apply(Object.assign({}, text, { text: "Другое" }), encoded, params);
  assert.equal(params.layerText.textStyleRange[0].textStyle.autoKern, "metricsKern");
  assert.equal(Txt2.parse(encoded)["1"]["1"][0]["0"]["0"].value, "Привет AV\r");
});

function engineInternals() {
  const contexts = [];
  const context2d = new Proxy({ _pixels: new Uint8ClampedArray(4), fontKerning: "normal" }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return (text) => {
        const width = String(text).length * 10;
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 };
      };
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
      if (key === "getImageData") return (x, y, width = 1, height = 1) => ({ data: target._pixels.slice(0, width * height * 4), width, height });
      if (key === "putImageData") return (image) => { target._pixels = image.data; };
      return target[key] || (() => {});
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const fonts = new Proxy({ BUILTIN: [], generation: 0 }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "resolve") return () => ({ css: "Test", weight: 400 });
      if (key === "withoutLigatures") return () => null;
      if (key === "list") return () => [];
      return () => {};
    },
  });
  const optical = { spacing(ctx, font, style, text, sizePt, sizePx) {
    const chars = Array.from(text);
    const starts = chars.map((_, i) => i * -0.02 * sizePx);
    return { chars, starts, deltas: chars.map(() => 0), total: chars.length > 1 ? (chars.length - 1) * -0.02 * sizePx : 0 };
  } };
  const window = { TypeRFonts: fonts, TypeROpticalKerning: optical, TYPER_I18N: { lang: "en" }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage: { getItem: () => null, setItem: () => {} } };
  const document = { createElement: () => { contexts.push(context2d); return { getContext: () => context2d, width: 0, height: 0 }; }, addEventListener() {}, removeEventListener() {} };
  const sandbox = { window, document, console, localStorage: window.localStorage, ImageData: class {}, Image: class {}, Path2D: class {}, DOMMatrixReadOnly: class {}, OffscreenCanvas: class {}, URL, TextEncoder, TextDecoder, Uint8Array, Uint8ClampedArray, ArrayBuffer, Blob, Intl, requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout, clearTimeout };
  const source = read("web/photoshop.js").replace("window.TypeRPhotoshop = {", "window.TypeRPhotoshop = { __test: { antiAliasTable, applyAntiAlias, openedBubbleBounds, relativeLayout, measureRuns, setRunFont },");
  vm.runInNewContext(source, sandbox);
  return { api: window.TypeRPhotoshop.__test, context2d };
}

test("the layout engine applies Optical shifts to placed glyphs instead of only relabelling the style", () => {
  const { api, context2d } = engineInternals();
  const metrics = api.measureRuns([{ text: "AV", style: { size: 10, autoKern: "metricsKern" } }], 72);
  const optical = api.measureRuns([{ text: "AV", style: { size: 10, autoKern: "opticalKern" } }], 72);
  assert.equal(metrics.placed.length, 1);
  assert.equal(optical.placed.length, 2);
  assert.ok(optical.advance < metrics.advance);
  assert.equal(optical.placed[1].x, 9.8);
  api.setRunFont(context2d, { autoKern: "opticalKern" }, 10);
  assert.equal(context2d.fontKerning, "none");
  const app = read("web/app.js");
  assert.ok(app.includes('["opticalKern", T("Optical")]'));
  assert.ok(read("web/strings/ru.js").includes('"Optical": "Оптический"'));
  assert.ok(read("web/strings/ru.js").includes('"Smooth": "Плавное"'));
});

test("all five anti-alias switches map the same coverage to Photoshop mode curves", () => {
  const { api, context2d } = engineInternals();
  const expected = { antiAliasNone: 0, antiAliasSharp: 12, antiAliasCrisp: 39, antiAliasStrong: 119, antiAliasSmooth: 64 };
  for (const [mode, alpha] of Object.entries(expected)) {
    context2d._pixels = new Uint8ClampedArray([255, 255, 255, 64]);
    api.applyAntiAlias({ width: 1, height: 1 }, context2d, mode);
    assert.equal(context2d._pixels[3], alpha, mode);
  }
  assert.equal(api.antiAliasTable("antiAliasNone")[128], 255);
  assert.ok(api.antiAliasTable("antiAliasStrong")[64] > api.antiAliasTable("antiAliasSmooth")[64]);
  assert.ok(api.antiAliasTable("antiAliasSmooth")[64] > api.antiAliasTable("antiAliasCrisp")[64]);
  assert.ok(api.antiAliasTable("antiAliasCrisp")[64] > api.antiAliasTable("antiAliasSharp")[64]);
});

test("adaptive morphological opening removes a thin tail before bubble centring", () => {
  const { api } = engineInternals();
  const width = 100;
  const height = 50;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    mask.fill(1, y * width, y * width + 60);
    if (y === 25) mask[y * width + 99] = 1;
    if (y === 25) mask.fill(1, y * width + 60, y * width + 100);
  }
  const selection = { bounds: { left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50, xMid: 50, yMid: 25 }, mask: { data: mask, width, height, left: 0, top: 0 } };
  const textBox = { xMid: 30, yMid: 25 };
  const bounds = api.openedBubbleBounds({ width, height }, selection, textBox);
  assert.equal(bounds.left, 0);
  assert.equal(bounds.right, 60);
  assert.equal(bounds.xMid, 30);
  assert.equal(selection.bounds.right, 100, "the real selection must not be modified");
  assert.equal(mask[25 * width + 99], 1, "the real mask must not be modified");
});

test("Roman hanging punctuation is excluded from optical centring, not from ink bounds", () => {
  const { api } = engineInternals();
  const lt = {
    textKey: "“WORD",
    textStyleRange: [{ from: 0, to: 5, textStyle: { size: 10, impliedFontSize: 10 } }],
    paragraphStyleRange: [{ from: 0, to: 5, paragraphStyle: { alignment: "center", hangingRoman: true } }],
    textShape: [{ textType: "point" }],
  };
  const layout = api.relativeLayout(lt, 72);
  assert.equal(layout.box.xMid, -5);
  assert.equal(layout.opticalBox.xMid, 0);
  assert.ok(layout.box.left < layout.opticalBox.left);
  assert.equal(layout.box.right, layout.opticalBox.right);
});
