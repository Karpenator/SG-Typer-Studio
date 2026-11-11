// The SG Typer Studio document engine, a small Photoshop. The real TypeR panel
// runs in an iframe (web/panel, a copy of TypeR's own build) and calls this file
// exactly like it calls Photoshop through ExtendScript: same function names, same
// JSON. The smart paste engine itself runs inside the panel, untouched. What lives
// here is what Photoshop does for it: documents, real layers, selections, a Magic
// Wand, a work path, text measuring, painting and a history.

(function () {
  "use strict";

  const EVENT_SET = 1936028772; // 'setd'
  const EVENT_SELECT = 1936483188; // 'slct'
  const EVENT_MOVE = 1836021349; // 'move'
  const EVENT_HISTORY = 1751737445; // any other event: the panel checks the history
  const EXTENSION_ID = "com.typer.web";

  const Fonts = window.TypeRFonts;
  const FONTS = Fonts.BUILTIN;
  const MAX_HISTORY = 150;

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const rectFrom = (left, top, right, bottom) => ({
    left, top, right, bottom,
    width: right - left,
    height: bottom - top,
    xMid: (left + right) / 2,
    yMid: (top + bottom) / 2,
  });

  /* ============================== text ============================== */

  const cssFont = (textStyle, sizePx) => {
    const font = Fonts.resolve(textStyle);
    const italic = font.italic || textStyle.syntheticItalic;
    const weight = textStyle.syntheticBold ? 700 : font.weight;
    const family = (textStyle.ligature === false && Fonts.withoutLigatures(font)) || font.css;
    return `${italic ? "italic " : ""}${weight} ${sizePx}px "${family}", "Wildjess", sans-serif`;
  };

  const setRunFont = (ctx, textStyle, sizePx) => {
    ctx.font = cssFont(textStyle, sizePx);
    if ("letterSpacing" in ctx) ctx.letterSpacing = textStyle.tracking ? `${(textStyle.tracking / 1000) * sizePx}px` : "0px";
    if ("fontKerning" in ctx) ctx.fontKerning = textStyle.autoKern === "manual" ? "none" : "normal";
    if ("fontVariantCaps" in ctx) ctx.fontVariantCaps = textStyle.fontCaps === "smallCaps" ? "small-caps" : "normal";
    if ("lang" in ctx) ctx.lang = languageTagOf(textStyle);
  };

  const sizePxOf = (textStyle, resolution) => ((textStyle.impliedFontSize || textStyle.size || 14) * resolution) / 72;

  // Photoshop's text languages: the name a layer gives them, the number a PSD file gives
  // them (both read back from Photoshop) and how the language writes itself
  const TEXT_LANGUAGES = [
    ["englishLanguage", 0, "English (US)"], ["ukenglishLanguage", 14, "English (UK)"], ["standardFrenchLanguage", 2, "Français"], ["canadianFrenchLanguage", 3, "Français (Canada)"],
    ["spanishLanguage", 12, "Español"], ["italianLanguage", 7, "Italiano"], ["germanLanguageReformed1996", 4, "Deutsch"], ["oldGermanLanguage", 5, "Deutsch (1901)"], ["swissGermanLanguageOldRules", 6, "Deutsch (Schweiz)"],
    ["standardPortugueseLanguage", 10, "Português"], ["brazilianPortugueseLanguage", 11, "Português (Brasil)"], ["kdutchLanguageOldRules", 15, "Nederlands"], ["catalanLanguage", 17, "Català"],
    ["danishLanguage", 16, "Dansk"], ["swedishLanguage", 13, "Svenska"], ["bokmalNorwegianLanguage", 8, "Norsk bokmål"], ["nynorskNorwegianLanguage", 9, "Norsk nynorsk"], ["finnishLanguage", 1, "Suomi"], ["icelandicLanguage", 27, "Íslenska"],
    ["polishLanguage", 23, "Polski"], ["czechLanguage", 22, "Čeština"], ["slovakLanguage", 36, "Slovenčina"], ["hungarianLanguage", 28, "Magyar"], ["romanianLanguage", 24, "Română"], ["croatianLanguage", 29, "Hrvatski"], ["slovenianLanguage", 31, "Slovenščina"],
    ["lithuanianLanguage", 34, "Lietuvių"], ["latvianLanguage", 35, "Latviešu"], ["turkishLanguage", 26, "Türkçe"], ["greekLanguage", 25, "Ελληνικά"], ["russianLanguage", 18, "Русский"], ["ukranianLanguage", 19, "Українська"], ["bulgarianLanguage", 20, "Български"], ["serbianLanguage", 21, "Српски"],
    ["arabicLanguage", 37, "العربية"], ["hebrewLanguage", 30, "עברית"],
  ];
  const INTERFACE_TEXT_LANGUAGE = { fr: "standardFrenchLanguage", es: "spanishLanguage", it: "italianLanguage", de: "germanLanguageReformed1996", pt: "brazilianPortugueseLanguage", ru: "russianLanguage", uk: "ukranianLanguage", pl: "polishLanguage", nl: "kdutchLanguageOldRules", tr: "turkishLanguage", ar: "arabicLanguage" };
  const DEFAULT_TEXT_LANGUAGE = INTERFACE_TEXT_LANGUAGE[window.TYPER_I18N.lang] || "englishLanguage";
  // Other names Photoshop gives the same languages, in styles made by the plugin
  // The same languages as the browser names them. A font made for several languages draws some
  // letters its own way in one of them, as a Turkish i that keeps its dot in a capitals-only
  // font: the text's language tells it which.
  const LANGUAGE_TAGS = {
    englishLanguage: "en-US", ukenglishLanguage: "en-GB", standardFrenchLanguage: "fr", canadianFrenchLanguage: "fr-CA", spanishLanguage: "es", italianLanguage: "it",
    germanLanguageReformed1996: "de", oldGermanLanguage: "de", swissGermanLanguageOldRules: "de-CH", standardGermanLanguage: "de", swissGermanLanguage: "de-CH",
    standardPortugueseLanguage: "pt-PT", brazilianPortugueseLanguage: "pt-BR", kdutchLanguageOldRules: "nl", dutchLanguage: "nl", catalanLanguage: "ca", danishLanguage: "da",
    swedishLanguage: "sv", bokmalNorwegianLanguage: "nb", nynorskNorwegianLanguage: "nn", finnishLanguage: "fi", icelandicLanguage: "is", polishLanguage: "pl", czechLanguage: "cs",
    slovakLanguage: "sk", hungarianLanguage: "hu", romanianLanguage: "ro", croatianLanguage: "hr", slovenianLanguage: "sl", lithuanianLanguage: "lt", latvianLanguage: "lv",
    turkishLanguage: "tr", greekLanguage: "el", russianLanguage: "ru", ukranianLanguage: "uk", bulgarianLanguage: "bg", serbianLanguage: "sr", arabicLanguage: "ar", hebrewLanguage: "he",
  };
  // A text with no language is drawn as English, whatever the interface's language
  const languageTagOf = (textStyle) => LANGUAGE_TAGS[textStyle.textLanguage] || "en";
  const TEXT_LANGUAGE_NUMBERS = TEXT_LANGUAGES.reduce((numbers, [name, number]) => Object.assign(numbers, { [name]: number }), { standardGermanLanguage: 4, swissGermanLanguage: 6, dutchLanguage: 15 });
  const textLanguageNumber = (name) => {
    const number = TEXT_LANGUAGE_NUMBERS[name];
    return number === undefined ? TEXT_LANGUAGE_NUMBERS[app.textDefaults.language] : number;
  };
  const textLanguageName = (number) => {
    const language = TEXT_LANGUAGES.find((item) => item[1] === number);
    return language ? language[0] : undefined;
  };

  // A zero-width non-joiner between two letters also stops ligatures, where the browser can't
  // turn a font's off (see withoutLigatures in fonts.js), and leaves their kerning alone.
  // It doesn't stop the letter variants a font keeps with its ligatures. Other scripts need
  // their letters joined.
  // All Caps follows the text language, as in Photoshop: in Turkish, i becomes İ, not I
  const CASE_LOCALES = { turkishLanguage: "tr" };
  const shownText = ({ text, style }) => {
    const locale = CASE_LOCALES[style.textLanguage];
    const cased = style.fontCaps === "allCaps" ? (locale ? text.toLocaleUpperCase(locale) : text.toUpperCase()) : text;
    return style.ligature === false ? cased.replace(/(\p{Script=Latin})(?=\p{Script=Latin})/gu, "$1‌") : cased;
  };

  // textKey -> lines, each with its runs (a run: text and the style of its range)
  const splitLines = (layerText) => {
    const text = layerText.textKey || "";
    const ranges = layerText.textStyleRange || [];
    const styleAt = (index) => {
      for (let i = 0; i < ranges.length; i++) {
        if (index >= ranges[i].from && index < ranges[i].to) return ranges[i].textStyle;
      }
      return ranges.length ? ranges[ranges.length - 1].textStyle : {};
    };
    const lines = [];
    let current = [];
    let run = null;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        lines.push(current);
        current = [];
        run = null;
        continue;
      }
      const style = styleAt(i);
      if (run && run.style === style) run.text += ch;
      else {
        run = { text: ch, style };
        current.push(run);
      }
    }
    lines.push(current);
    return lines;
  };

  const measureRuns = (runs, resolution) => {
    let advance = 0;
    let ascent = 0;
    let descent = 0;
    let inkLeft = Infinity;
    let inkRight = -Infinity;
    let fontAscent = 0;
    let fontDescent = 0;
    const placed = [];
    runs.forEach((run) => {
      const size = sizePxOf(run.style, resolution);
      setRunFont(measureCtx, run.style, size);
      measureCtx.textAlign = "left";
      const shown = shownText(run);
      const m = measureCtx.measureText(shown);
      const scaleX = (run.style.horizontalScale || 100) / 100;
      const scaleY = (run.style.verticalScale || 100) / 100;
      const shift = ((run.style.impliedBaselineShift !== undefined ? run.style.impliedBaselineShift : run.style.baselineShift) || 0) * (resolution / 72);
      placed.push({ run, shown, x: advance, size, scaleX, scaleY, shift });
      inkLeft = Math.min(inkLeft, advance - m.actualBoundingBoxLeft * scaleX);
      inkRight = Math.max(inkRight, advance + m.actualBoundingBoxRight * scaleX);
      advance += m.width * scaleX;
      ascent = Math.max(ascent, m.actualBoundingBoxAscent * scaleY + shift);
      descent = Math.max(descent, m.actualBoundingBoxDescent * scaleY - shift);
      fontAscent = Math.max(fontAscent, (m.fontBoundingBoxAscent || m.actualBoundingBoxAscent) * scaleY);
      fontDescent = Math.max(fontDescent, (m.fontBoundingBoxDescent || m.actualBoundingBoxDescent) * scaleY);
    });
    if (!runs.length) return { advance: 0, ascent: 0, descent: 0, inkLeft: 0, inkRight: 0, fontAscent: 0, fontDescent: 0, placed };
    return { advance, ascent, descent, inkLeft, inkRight, fontAscent, fontDescent, placed };
  };

  // Paragraph text: the size of its box is in the shape, its top left in the click point
  const boxShape = (lt) => {
    const shape = lt.textShape && lt.textShape[0];
    return shape && shape.textType === "box" && shape.box ? shape : null;
  };

  const sliceRuns = (runs, from, to) => {
    const out = [];
    let at = 0;
    runs.forEach((run) => {
      const start = Math.max(from, at);
      const end = Math.min(to, at + run.text.length);
      if (end > start) out.push({ text: run.text.slice(start - at, end - at), style: run.style });
      at += run.text.length;
    });
    return out;
  };

  // Auto hyphenation, as Photoshop's Hyphenate option of a paragraph: the patterns of the
  // text's language, loaded on first use (the page is drawn again once they are there)
  const HYPHEN_LANGUAGES = {
    englishLanguage: "en", ukenglishLanguage: "en", standardFrenchLanguage: "fr", canadianFrenchLanguage: "fr",
    germanLanguageReformed1996: "de", standardGermanLanguage: "de", oldGermanLanguage: "de", swissGermanLanguage: "de", swissGermanLanguageOldRules: "de",
    spanishLanguage: "es", italianLanguage: "it", standardPortugueseLanguage: "pt", brazilianPortugueseLanguage: "pt",
    russianLanguage: "ru", turkishLanguage: "tr", ukranianLanguage: "uk",
  };
  const hyphenLoads = new Set();
  const hyphenLanguage = (style) => {
    const Hyphenation = window.TypeRHyphenation;
    const language = Hyphenation && HYPHEN_LANGUAGES[(style && style.textLanguage) || app.textDefaults.language];
    if (!language) return null;
    if (Hyphenation.isLoaded(language)) return language;
    if (!hyphenLoads.has(language)) {
      hyphenLoads.add(language);
      Hyphenation.load(language).then(() => Fonts.refresh && Fonts.refresh(), () => {});
    }
    return null;
  };
  // Photoshop's defaults: words of 6 letters or more, 2 letters at least on each side
  const hyphenRulesOf = (paragraph) => (paragraph && paragraph.hyphenate === true ? {
    wordSize: paragraph.hyphenateWordSize || 6,
    pre: paragraph.hyphenatePreLength || 2,
    post: paragraph.hyphenatePostLength || 2,
    capitalized: paragraph.hyphenateCapitalized !== false,
  } : null);

  // One line of a paragraph into lines that fit: at spaces and after hyphens, at a
  // syllable with a hyphen when the paragraph hyphenates, and inside a word only when
  // the word alone is wider than the box
  const wrapRuns = (runs, width, resolution, hyphenRules) => {
    const text = runs.map((run) => run.text).join("");
    const tooWide = (from, to) => measureRuns(sliceRuns(runs, from, to), resolution).advance > width;
    const withHyphen = (from, to) => {
      const out = sliceRuns(runs, from, to);
      const last = out[out.length - 1];
      if (last) out[out.length - 1] = { text: last.text + "-", style: last.style };
      // The hyphen is drawn, but isn't in the text
      out.hyphenated = true;
      return out;
    };
    const lines = [];
    const pushLine = (from, to) => {
      let end = to;
      while (end > from && text[end - 1] === " ") end--;
      lines.push(sliceRuns(runs, from, end));
    };
    // Where the word from `start` to `end` can be cut with a hyphen so that the line from
    // `lineStart` fits, the latest such place; -1 when none
    const hyphenCut = (lineStart, start, end) => {
      if (!hyphenRules) return -1;
      const word = text.slice(start, end);
      const lead = /^[^\p{L}]*/u.exec(word)[0].length;
      const core = /^[\p{L}'’]+/u.exec(word.slice(lead));
      if (!core || core[0].length < hyphenRules.wordSize) return -1;
      if (!hyphenRules.capitalized && /^\p{Lu}/u.test(core[0])) return -1;
      const style = sliceRuns(runs, start + lead, start + lead + 1)[0];
      const language = hyphenLanguage(style && style.style);
      if (!language) return -1;
      const points = window.TypeRHyphenation.breakPoints(core[0], language)
        .filter((point) => point >= hyphenRules.pre && core[0].length - point >= hyphenRules.post)
        .sort((a, b) => b - a);
      for (const point of points) {
        const cut = start + lead + point;
        if (measureRuns(withHyphen(lineStart, cut), resolution).advance <= width) return cut;
      }
      return -1;
    };
    let lineStart = 0;
    let i = 0;
    while (i < text.length) {
      let end = i;
      for (;;) {
        while (end < text.length && text[end] !== " " && !(text[end] === "-" && text[end + 1] && text[end + 1] !== " ")) end++;
        if (text[end] === "-") {
          end++;
          break;
        }
        // French punctuation has a space before it, but never starts a line
        const next = /^ +[?!:;»…%)\]]/.exec(text.slice(end));
        if (!next) break;
        end += next[0].length;
      }
      if (end > lineStart && tooWide(lineStart, end)) {
        const cut = hyphenCut(lineStart, i, end);
        if (cut > 0) {
          lines.push(withHyphen(lineStart, cut));
          lineStart = cut;
          i = cut;
          continue;
        }
        if (i > lineStart) {
          pushLine(lineStart, i);
          lineStart = i;
          // The word starts the next line: a hyphen may fit it there before any cut
          if (hyphenRules) continue;
        }
        while (end - lineStart > 1 && tooWide(lineStart, end)) {
          let cut = lineStart + 1;
          while (cut + 1 < end && !tooWide(lineStart, cut + 1)) cut++;
          pushLine(lineStart, cut);
          lineStart = cut;
        }
      }
      i = end;
      while (text[i] === " ") i++;
    }
    pushLine(lineStart, text.length);
    return lines;
  };

  // Photoshop's Roman Hanging Punctuation puts these outside the margins, wholly or by half
  const HANG_FULL = new Set([".", ",", "-", "\u2010", "'", "\"", "\u2018", "\u2019", "\u201C", "\u201D"]);
  const HANG_HALF = new Set(["*", "~", "\u2026", "\u2013", "\u2014", ":", ";"]);
  const hangShare = (ch) => (HANG_FULL.has(ch) ? 1 : HANG_HALF.has(ch) ? 0.5 : 0);
  // How far a line's first and last characters hang out
  const hangsOf = (m) => {
    const ends = [];
    [m.placed[0], m.placed[m.placed.length - 1]].forEach((item, end) => {
      const ch = item && (end ? item.shown.slice(-1) : item.shown[0]);
      const share = ch ? hangShare(ch) : 0;
      if (!share) return ends.push(0);
      setRunFont(measureCtx, item.run.style, item.size);
      ends.push(measureCtx.measureText(ch).width * item.scaleX * share);
    });
    return ends;
  };

  // Whether a font draws a character itself, or the browser takes it from another font:
  // the character comes out the same width whichever font follows it
  const glyphsSeen = new Map();
  const ownGlyph = (textStyle, ch) => {
    const css = Fonts.resolve(textStyle).css;
    const key = Fonts.generation + "|" + css + "|" + ch;
    if (!glyphsSeen.has(key)) {
      const widthWith = (next) => {
        measureCtx.font = `100px "${css}", ${next}`;
        return measureCtx.measureText(ch).width;
      };
      glyphsSeen.set(key, widthWith("monospace") === widthWith("serif"));
    }
    return glyphsSeen.get(key);
  };
  // How high a letter rises above the baseline, as a share of the size. Read on the letter
  // drawn at 1024 px, which the browser draws from its outline the same on every system:
  // what it measures instead comes out up to 1.5% higher on Windows, rounded up to pixels.
  const INK_SIZE = 1024;
  const inkTops = new Map();
  const inkTopOf = (textStyle, ch) => {
    const key = Fonts.generation + "|" + cssFont(textStyle, INK_SIZE) + "|" + languageTagOf(textStyle) + "|" + ch;
    if (!inkTops.has(key)) {
      setRunFont(measureCtx, textStyle, INK_SIZE);
      const m = measureCtx.measureText(ch);
      const left = Math.ceil(m.actualBoundingBoxLeft) + 8;
      const baseline = Math.ceil(m.actualBoundingBoxAscent) + 8;
      const canvas = newCanvas(left + Math.ceil(m.actualBoundingBoxRight) + 8, baseline + 8);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      setRunFont(ctx, textStyle, INK_SIZE);
      ctx.textBaseline = "alphabetic";
      ctx.fillText(ch, left, baseline);
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let top = baseline;
      for (let y = 0, found = false; y < baseline && !found; y++) {
        let most = 0;
        for (let i = y * canvas.width * 4 + 3; i < (y + 1) * canvas.width * 4; i += 4) most = Math.max(most, px[i]);
        // The first row with ink, less what that row's edge leaves uncovered
        if (most) {
          top = y + 1 - most / 255;
          found = true;
        }
      }
      inkTops.set(key, (baseline - top) / INK_SIZE);
    }
    return inkTops.get(key);
  };

  // Where each line goes and the box of its ink, measured once per text and style.
  // Everything here is relative to the layer's anchor: moving a layer costs nothing.
  const layoutCache = new Map();
  // The same text object asks again on every frame: answered without writing its key out
  const layoutByText = new WeakMap();
  const relativeLayout = (lt, resolution) => {
    const shape = boxShape(lt);
    const box = shape && shape.box;
    const known = layoutByText.get(lt);
    if (known && known.generation === Fonts.generation && known.resolution === resolution && known.textKey === lt.textKey && known.ranges === lt.textStyleRange && known.paragraphs === lt.paragraphStyleRange && known.box === box) return known.layout;
    const key = Fonts.generation + "|" + resolution + "|" + JSON.stringify([lt.textKey, lt.textStyleRange, lt.paragraphStyleRange, box]);
    const remember = (layout) => {
      layoutByText.set(lt, { generation: Fonts.generation, resolution, textKey: lt.textKey, ranges: lt.textStyleRange, paragraphs: lt.paragraphStyleRange, box, layout });
      return layout;
    };
    const cached = layoutCache.get(key);
    if (cached) return remember(cached);
    if (layoutCache.size > 4000) layoutCache.clear();
    const paragraph = (lt.paragraphStyleRange && lt.paragraphStyleRange[0] && lt.paragraphStyleRange[0].paragraphStyle) || {};
    const align = paragraph.alignment || "center";
    const frame = shape ? shape.box : null;
    let lines = splitLines(lt);
    if (frame) {
      const wrapped = [];
      lines.forEach((runs) => {
        if (runs.length) wrapped.push(...wrapRuns(runs, frame.width, resolution, hyphenRulesOf(paragraph)));
        else wrapped.push(runs);
      });
      lines = wrapped;
    }
    // Photoshop's first baseline in a box is its Ascent: as low as the top of the font's
    // "d". Measured on 730 lines of real PSDs: 0.86 of the size in Sakana, 0.75 in
    // Victory Speech, where a fixed 0.75 put Sakana's lines 2 px too high
    const firstRuns = lines[0] && lines[0].length ? lines[0] : null;
    const firstStyle = firstRuns ? firstRuns[0].style : (lt.textStyleRange && lt.textStyleRange[0] && lt.textStyleRange[0].textStyle) || {};
    const firstSize = sizePxOf(firstStyle, resolution);
    // Vertical scale stretches the letters, not this
    const ascent = ownGlyph(firstStyle, "d") ? inkTopOf(firstStyle, "d") * firstSize : 0;
    // A font of capitals only has no "d" of its own: 0.75 is what Photoshop comes close to
    const firstOffset = ascent > 0 ? ascent : firstSize * 0.75;
    let baseline = 0;
    const out = [];
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    let overflow = false;
    let contentBottom = 0;
    lines.forEach((runs, index) => {
      const m = measureRuns(runs, resolution);
      let lead = 0;
      let largest = 0;
      runs.forEach((run) => {
        const size = sizePxOf(run.style, resolution);
        largest = Math.max(largest, size);
        lead = Math.max(lead, run.style.autoLeading === false && run.style.leading > 0 ? (run.style.leading * resolution) / 72 : size * (paragraph.autoLeadingPercentage || 1.2));
      });
      if (!runs.length) {
        const base = (lt.textStyleRange && lt.textStyleRange[0] && lt.textStyleRange[0].textStyle) || {};
        lead = out.length ? out[out.length - 1].lead : sizePxOf(base, resolution) * (paragraph.autoLeadingPercentage || 1.2);
      }
      if (index > 0) baseline += lead;
      else if (frame) baseline = firstOffset;
      contentBottom = baseline + Math.max(m.fontDescent, lead * 0.2);
      // As in Photoshop, a line that doesn't fit in a fixed box isn't drawn. It wants 0.075 of
      // its size below the baseline, whatever its letters: on real PSDs it hid the lines with
      // 0.069 or less, and kept the ones with 0.082 or more
      if (frame && !frame.autoHeight && index > 0 && baseline + Math.max(m.descent, largest * 0.075) > frame.height) {
        overflow = true;
        return;
      }
      // As in Photoshop, the spaces that end a line are left out of its width: in "Un \rcygne ?",
      // centred, "Un" is centred on its letters (measured on real PSDs)
      const lineText = runs.map((run) => run.text).join("");
      const spaces = /[ \t]*$/.exec(lineText)[0].length;
      const shown = spaces ? measureRuns(sliceRuns(runs, 0, lineText.length - spaces), resolution) : m;
      // Roman Hanging Punctuation: what hangs is left out of the line's width
      const [hangLeft, hangRight] = paragraph.hangingRoman ? hangsOf(shown) : [0, 0];
      const set = shown.advance - hangLeft - hangRight;
      let x;
      if (frame) x = align === "left" ? 0 : align === "right" ? frame.width - set : (frame.width - set) / 2;
      else x = align === "left" ? 0 : align === "right" ? -set : -set / 2;
      x -= hangLeft;
      out.push({ runs, m, x, baseline, lead });
      if (runs.length) {
        left = Math.min(left, x + m.inkLeft);
        right = Math.max(right, x + m.inkRight);
        top = Math.min(top, baseline - m.ascent);
        bottom = Math.max(bottom, baseline + m.descent);
      }
    });
    const hasInk = isFinite(left);
    if (!hasInk) {
      left = right = 0;
      top = bottom = 0;
    }
    // Centred in its box: what shows, or the line an empty text starts on. Text that
    // doesn't fit stays at the top, where Photoshop cuts it.
    let shift = 0;
    if (frame && frame.verticalAlign === "center" && !frame.autoHeight && !overflow) {
      const height = hasInk ? bottom - top : contentBottom;
      shift = Math.max(0, (frame.height - height) / 2 - top);
      out.forEach((line) => { line.baseline += shift; });
      top += shift;
      bottom += shift;
    }
    const result = { lines: out, box: rectFrom(left, top, right, bottom), frame: frame ? { width: frame.width, height: frame.autoHeight ? contentBottom : frame.height } : null, overflow, contentHeight: contentBottom, firstOffset, shift, wrapped: lines };
    layoutCache.set(key, result);
    return remember(result);
  };

  const anchorOf = (lt, doc) => [(lt.textClickPoint.horizontal / 100) * doc.width, (lt.textClickPoint.vertical / 100) * doc.height];

  const layoutLayer = (layer, doc) => {
    const lt = layer.params.layerText;
    const relative = relativeLayout(lt, doc.resolution);
    const [ax, ay] = anchorOf(lt, doc);
    const b = relative.box;
    return {
      relative,
      anchor: [ax, ay],
      lines: relative.lines.map((line) => Object.assign({}, line, { x: line.x + ax, baseline: line.baseline + ay })),
      box: rectFrom(b.left + ax, b.top + ay, b.right + ax, b.bottom + ay),
      frame: relative.frame ? rectFrom(ax, ay, ax + relative.frame.width, ay + relative.frame.height) : null,
      overflow: relative.overflow,
      contentHeight: relative.contentHeight,
    };
  };

  // Where the caret can go in a text, line by line as the canvas sets them: the part of the
  // text each line holds, and the x after each of its letters. The editor's own lines don't
  // break or measure the same, so its caret and selection are drawn from these.
  const caretCache = new WeakMap();
  const caretLines = (layer, doc) => {
    const lt = layer.params.layerText;
    const relative = relativeLayout(lt, doc.resolution);
    let rel = caretCache.get(relative);
    if (!rel) {
      const text = lt.textKey || "";
      const base = (lt.textStyleRange && lt.textStyleRange[0] && lt.textStyleRange[0].textStyle) || {};
      const size = sizePxOf(base, doc.resolution);
      const shown = new Map(relative.lines.map((line) => [line.runs, line]));
      rel = [];
      let w = 0;
      let lineStart = 0;
      // Indices are the text's own, as the editor holds it: "\r\n" is one break of two letters
      text.split(/(\r\n|[\r\n])/).forEach((hard, part) => {
        if (part % 2) {
          lineStart += hard.length;
          return;
        }
        const lineEnd = lineStart + hard.length;
        let at = lineStart;
        do {
          const runs = relative.wrapped[w++];
          if (!runs) break;
          const drawn = runs.map((run) => run.text).join("");
          const piece = runs.hyphenated ? drawn.slice(0, -1) : drawn;
          const found = piece ? text.indexOf(piece, at) : -1;
          const start = found >= at && found <= lineEnd ? found : at;
          const end = Math.min(lineEnd, start + piece.length);
          at = end;
          while (at < lineEnd && text[at] === " ") at++;
          const line = shown.get(runs);
          // A line that doesn't fit in its box isn't drawn: the caret has nowhere to go there
          if (!line) continue;
          const xs = [line.x];
          for (let k = 1; k <= end - start; k++) xs.push(line.x + measureRuns(sliceRuns(runs, 0, k), doc.resolution).advance);
          const ascent = line.m.fontAscent || size * 0.8;
          const descent = line.m.fontDescent || size * 0.2;
          rel.push({ start, end, xs, baseline: line.baseline, top: line.baseline - ascent, bottom: line.baseline + descent, size });
        } while (at < lineEnd);
        lineStart = lineEnd;
      });
      caretCache.set(relative, rel);
    }
    const [ax, ay] = anchorOf(lt, doc);
    return rel.map((line) => Object.assign({}, line, { xs: line.xs.map((x) => x + ax), baseline: line.baseline + ay, top: line.top + ay, bottom: line.bottom + ay }));
  };

  /* ------------------------------ text on a surface ----------------------------- */

  // A text in perspective, or around a can or a page, stays a text: `warp` says where its
  // rectangle (`source`, around its anchor) lands on the page. The four corners give the
  // perspective. The bends push the middle of the top and bottom edges, which turns them
  // into curves. `wrap` is the angle the text covers on a cylinder: the letters get
  // narrower towards its sides. At 0 the formulas below are a plain curve on a flat plane.
  const surfaceOf = (warp) => {
    const [a, b, c, d] = warp.corners;
    const dx1 = b[0] - c[0];
    const dx2 = d[0] - c[0];
    const sx = a[0] - b[0] + c[0] - d[0];
    const dy1 = b[1] - c[1];
    const dy2 = d[1] - c[1];
    const sy = a[1] - b[1] + c[1] - d[1];
    const den = dx1 * dy2 - dx2 * dy1;
    const g = den ? (sx * dy2 - dx2 * sy) / den : 0;
    const h = den ? (dx1 * sy - sx * dy1) / den : 0;
    const a11 = b[0] - a[0] + g * b[0];
    const a12 = d[0] - a[0] + h * d[0];
    const a21 = b[1] - a[1] + g * b[1];
    const a22 = d[1] - a[1] + h * d[1];
    const wrap = ((warp.wrap || 0) * Math.PI) / 180;
    const flat = (x, v) => {
      const w = Math.max(0.001, g * x + h * v + 1);
      return [(a11 * x + a12 * v + a[0]) / w, (a21 * x + a22 * v + a[1]) / w];
    };
    const at = (u, v) => {
      let x = u;
      let bump = 4 * u * (1 - u);
      if (wrap > 0.001) {
        const theta = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, (2 * u - 1) * wrap));
        x = (Math.sin(theta) / Math.sin(wrap) + 1) / 2;
        bump = (Math.cos(theta) - Math.cos(wrap)) / (1 - Math.cos(wrap));
      }
      const p = flat(x, v);
      return [p[0] + ((1 - v) * warp.bendTop[0] + v * warp.bendBottom[0]) * bump, p[1] + ((1 - v) * warp.bendTop[1] + v * warp.bendBottom[1]) * bump];
    };
    return { at, flat };
  };

  const boundsOfPoints = (points) => {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    points.forEach(([x, y]) => {
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    });
    return rectFrom(left, top, right, bottom);
  };

  // The edge of a part of the surface, in parts of the text's rectangle
  const surfaceEdge = (warp, u0, v0, u1, v1) => {
    const { at } = surfaceOf(warp);
    const points = [];
    for (let i = 0; i <= 24; i++) {
      const u = u0 + ((u1 - u0) * i) / 24;
      points.push(at(u, v0), at(u, v1));
    }
    for (let i = 1; i < 8; i++) {
      const v = v0 + ((v1 - v0) * i) / 8;
      points.push(at(u0, v), at(u1, v));
    }
    return points;
  };

  // A text turned in Photoshop stays turned when it's edited, around its anchor
  const spinOf = (layer) => (layer.rotated && layer.spin && !layer.warp ? layer.spin : null);
  const spunBounds = (box, [a, b, c, d]) => {
    const xs = [];
    const ys = [];
    [[box.left, box.top], [box.right, box.top], [box.left, box.bottom], [box.right, box.bottom]].forEach(([x, y]) => {
      xs.push(a * x + c * y);
      ys.push(b * x + d * y);
    });
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  };

  // A text layer read from a PSD shows Photoshop's own pixels until its text changes
  const boxOf = (layer, doc) => {
    if (layer.kind === "text") {
      if (layer.raster) return rectFrom(layer.raster.left, layer.raster.top, layer.raster.left + layer.raster.bitmap.width, layer.raster.top + layer.raster.bitmap.height);
      if (layer.warp) {
        const { source } = layer.warp;
        const b = relativeLayout(layer.params.layerText, doc.resolution).box;
        return boundsOfPoints(surfaceEdge(layer.warp, (b.left - source.left) / source.width, (b.top - source.top) / source.height, (b.right - source.left) / source.width, (b.bottom - source.top) / source.height));
      }
      const layout = layoutLayer(layer, doc);
      if (!spinOf(layer)) return layout.box;
      const { minX, minY, maxX, maxY } = spunBounds(layout.relative.box, spinOf(layer));
      return rectFrom(layout.anchor[0] + minX, layout.anchor[1] + minY, layout.anchor[0] + maxX, layout.anchor[1] + maxY);
    }
    const visual = visualOf(layer, doc);
    if (!visual) return rectFrom(0, 0, 0, 0);
    return rectFrom(visual.x, visual.y, visual.x + visual.canvas.width, visual.y + visual.canvas.height);
  };

  const rgbCss = (color) => (color ? `rgb(${color.red},${color.green},${color.blue})` : "#000");

  // Photoshop's Fill: how much of a layer's own pixels show, its stroke left whole. 0 is the
  // hollow text of an SFX (`knockout`); a value between, `fill`.
  const fillOf = (layer) => (!layer ? 1 : layer.knockout ? 0 : layer.fill === undefined ? 1 : Math.max(0, Math.min(1, layer.fill)));

  // A text layer's effects, as Photoshop's layer style: `layer.effects`, one of each at most,
  // drawn only when `enabled`. Opacities, spread and choke in percent, sizes and distances in
  // pixels, angles in degrees as Photoshop's (where the light comes from), blends by the
  // names of BLENDS. A gradient's stops are the Gradient tool's: { at, r, g, b, a }.
  const FX_ORDER = ["dropShadow", "outerGlow", "innerShadow", "innerGlow", "colorOverlay", "gradientOverlay"];
  const FX_DEFAULTS = {
    dropShadow: { enabled: true, blend: "normal", color: { r: 0, g: 0, b: 0 }, opacity: 75, angle: 120, distance: 5, spread: 0, size: 5 },
    outerGlow: { enabled: true, blend: "normal", color: { r: 255, g: 255, b: 255 }, opacity: 100, spread: 0, size: 8 },
    innerShadow: { enabled: true, blend: "normal", color: { r: 0, g: 0, b: 0 }, opacity: 75, angle: 120, distance: 5, choke: 0, size: 5 },
    innerGlow: { enabled: true, blend: "normal", color: { r: 255, g: 255, b: 255 }, opacity: 75, choke: 0, size: 5 },
    colorOverlay: { enabled: true, blend: "normal", color: { r: 255, g: 0, b: 0 }, opacity: 100 },
    gradientOverlay: { enabled: true, blend: "normal", opacity: 100, stops: [{ at: 0, r: 0, g: 0, b: 0, a: 1 }, { at: 1, r: 255, g: 255, b: 255, a: 1 }], style: "linear", angle: 90, scale: 100, reverse: false },
  };
  const fxDefault = (name) => JSON.parse(JSON.stringify(FX_DEFAULTS[name]));
  // The effects of a layer that are drawn, or null
  const effectsOn = (layer) => {
    const effects = layer && layer.kind === "text" && layer.effects;
    if (!effects) return null;
    return FX_ORDER.some((name) => effects[name] && effects[name].enabled !== false) ? effects : null;
  };
  // A stroke's Position, as Photoshop's: outside the letters (TypeR's and Photoshop's default),
  // inside them, or centred on their edge. How much of it lies outside them:
  const strokeOutside = (stroke) => (!stroke ? 0 : stroke.position === "inner" ? 0 : stroke.position === "center" ? stroke.size / 2 : stroke.size);
  // How far a stroke reaches past the letters: its part outside them, plus the stroke around it
  // if any, which goes around its outer edge
  const strokeReach = (stroke) => (stroke ? strokeOutside(stroke) + (stroke.outer && stroke.outer.size > 0 ? stroke.outer.size : 0) : 0);

  const drawLines = (ctx, lines, stroke, layer) => {
    const paragraph = layer.params.layerText.paragraphStyleRange && layer.params.layerText.paragraphStyleRange[0];
    const bolder = EMBOLDEN;
    const direction = paragraph && paragraph.paragraphStyle && paragraph.paragraphStyle.directionType;
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    if ("direction" in ctx) ctx.direction = direction === "dirRightToLeft" ? "rtl" : "ltr";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    // One run at its own width, height and baseline shift, as Photoshop draws it
    const place = (g, line, item, draw) => {
      setRunFont(g, item.run.style, item.size);
      g.save();
      g.translate(line.x + item.x, line.baseline - item.shift);
      g.scale(item.scaleX, item.scaleY);
      draw();
      g.restore();
    };
    // Every letter's outline, `reach` pixels each side of it
    const outline = (g, color, reach) => {
      g.strokeStyle = colorCss(color);
      lines.forEach((line) => {
        line.m.placed.forEach((item) => {
          place(g, line, item, () => {
            g.lineWidth = reach * 2;
            g.strokeText(item.shown, 0, 0);
          });
        });
      });
    };
    // The stroke's part outside the letters is drawn under them, its part inside over them
    const outside = strokeOutside(stroke);
    const inside = stroke ? stroke.size - outside : 0;
    // The stroke around the stroke first, as wide as both, then the stroke over it
    if (stroke && stroke.outer && stroke.outer.size > 0) outline(ctx, stroke.outer.color, strokeReach(stroke) + bolder);
    if (outside > 0) outline(ctx, stroke.color, outside + bolder);
    const letters = (g, hollow) => lines.forEach((line) => {
      line.m.placed.forEach((item) => {
        place(g, line, item, () => {
          g.fillStyle = hollow ? "#000" : rgbCss(item.run.style.color);
          g.fillText(item.shown, 0, 0);
          if (bolder) {
            // In the run's own units, which its width and height scale
            g.strokeStyle = g.fillStyle;
            g.lineWidth = (bolder * 2) / Math.max(item.scaleX, item.scaleY);
            g.strokeText(item.shown, 0, 0);
          }
        });
      });
    });
    // Photoshop's Fill: the letters at that much, their stroke whole. At 0% (a hollow text)
    // the letters let the page through the stroke.
    const fill = fillOf(layer);
    if (fill < 1 && stroke) {
      ctx.globalCompositeOperation = "destination-out";
      letters(ctx, true);
      ctx.globalCompositeOperation = "source-over";
    }
    if (fill > 0) {
      ctx.globalAlpha = fill;
      letters(ctx, false);
      ctx.globalAlpha = 1;
    }
    // The part inside: the outline, kept where the letters are, over them. Canvas can't clip
    // to text: the outline and the letters are drawn apart, with the same transform, the
    // letters cut the outline all at once, and it is laid on.
    if (inside > 0 && ctx.canvas && ctx.canvas.width && ctx.canvas.height) {
      const apart = () => {
        const g = newCanvas(ctx.canvas.width, ctx.canvas.height).getContext("2d");
        g.setTransform(ctx.getTransform());
        g.textBaseline = ctx.textBaseline;
        g.textAlign = ctx.textAlign;
        if ("direction" in g) g.direction = ctx.direction;
        g.lineJoin = "round";
        g.miterLimit = 2;
        return g;
      };
      const ring = apart();
      outline(ring, stroke.color, Math.max(0.05, inside - bolder));
      const shape = apart();
      letters(shape, true);
      ring.setTransform(1, 0, 0, 1, 0, 0);
      ring.globalCompositeOperation = "destination-in";
      ring.drawImage(shape.canvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(ring.canvas, 0, 0);
    }
    ctx.restore();
  };

  // Vector drawing, at any scale
  const drawTextLayer = (ctx, layer, doc) => {
    const layout = layoutLayer(layer, doc);
    const stroke = layer.stroke && layer.stroke.enabled && layer.stroke.size > 0 ? layer.stroke : null;
    drawLines(ctx, layout.lines, stroke, layer);
    return layout.box;
  };

  // The box the handles sit on: a paragraph's own box, the room a point text takes
  const frameOf = (layer, doc) => {
    if (layer.kind !== "text" || layer.rotated) return boxOf(layer, doc);
    if (layer.warp) return boundsOfPoints(surfaceEdge(layer.warp, 0, 0, 1, 1));
    const layout = layoutLayer(layer, doc);
    if (layout.frame) return layout.frame;
    if (layer.raster) return boxOf(layer, doc);
    const b = layout.box;
    return rectFrom(b.left, layout.anchor[1] - layout.relative.firstOffset, b.right, Math.max(b.bottom, layout.anchor[1] - layout.relative.firstOffset + 1));
  };

  // How far a text is turned, in radians: 0 for a straight one. One in perspective, as far
  // as the top edge of its surface.
  const turnOf = (layer) => {
    if (layer.warp) {
      const [a, b] = layer.warp.corners;
      return Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
    const spin = spinOf(layer);
    return spin ? Math.atan2(spin[1], spin[0]) : 0;
  };
  // A text's frame as it shows: the box its handles sit on, turned with it around its anchor.
  // The corners go clockwise from the top left.
  const turnedFrame = (layer, doc) => {
    const f = frameOf(Object.assign({}, layer, { rotated: false, spin: null, raster: null }), doc);
    const spin = spinOf(layer) || [1, 0, 0, 1];
    const [ax, ay] = anchorOf(layer.params.layerText, doc);
    const at = (x, y) => [ax + spin[0] * (x - ax) + spin[2] * (y - ay), ay + spin[1] * (x - ax) + spin[3] * (y - ay)];
    return {
      corners: [at(f.left, f.top), at(f.right, f.top), at(f.right, f.bottom), at(f.left, f.bottom)],
      center: at(f.left + f.width / 2, f.top + f.height / 2),
      angle: turnOf(layer),
      width: f.width,
      height: f.height,
    };
  };

  /* ========================== outlines, wand ========================= */

  // Follows the cracks between selected and unselected pixels: closed rings
  const traceMask = (mask, w, h, offsetX, offsetY) => {
    const stride = w + 1;
    // The cracks leaving each corner: 1 right, 2 down, 4 left, 8 up. Two leave a corner only
    // where the selection touches itself (a saddle): then left or up (the crack of the pixel
    // met first) comes before right or down.
    const edges = new Uint8Array(stride * (h + 1));
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const corner = y * stride;
      const first = y === 0;
      const last = y === h - 1;
      for (let x = 0; x < w; x++) {
        if (!mask[row + x]) continue;
        // A run of selected pixels: a crack up its left side, one down its right side, and
        // one over or under each pixel that has none selected above or below
        const from = x;
        while (x < w && mask[row + x]) x++;
        edges[corner + stride + from] |= 8;
        edges[corner + x] |= 2;
        for (let k = from; k < x; k++) {
          if (first || !mask[row + k - w]) edges[corner + k] |= 1;
          if (last || !mask[row + k + w]) edges[corner + stride + k + 1] |= 4;
        }
      }
    }
    const step = (at, bit) => (bit === 1 ? at + 1 : bit === 2 ? at + stride : bit === 4 ? at - 1 : at - stride);
    const rings = [];
    for (let start = 0; start < edges.length; start++) {
      while (edges[start]) {
        const ring = [];
        let at = start;
        let previous = -1;
        do {
          const x = at % stride;
          const y = (at - x) / stride;
          ring.push([x + offsetX, y + offsetY]);
          const bits = edges[at];
          const saddle = bits & (bits - 1);
          const a = saddle ? bits & 12 : bits;
          let to = step(at, a);
          if (saddle && previous !== -1) {
            // A saddle: keep turning the same way so rings stay simple
            const dx = x - (previous % stride);
            const dy = y - (previous - (previous % stride)) / stride;
            const ax = (to % stride) - x;
            const ay = (to - (to % stride)) / stride - y;
            const cross = dx * ay - dy * ax;
            if (cross < 0) {
              to = step(at, bits & 3);
              edges[at] = a;
            } else edges[at] = bits & 3;
          } else if (saddle) edges[at] = bits & 3;
          else edges[at] = 0;
          previous = at;
          at = to;
        } while (at !== start && edges[at]);
        if (ring.length >= 4) rings.push(ring);
      }
    }
    return rings;
  };

  const ringArea = (ring) => {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    return Math.abs(sum) / 2;
  };

  const perpendicular = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    if (!length) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / Math.sqrt(length);
  };

  const simplifyOpen = (points, tolerance) => {
    if (points.length < 3) return points.slice();
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [first, last] = stack.pop();
      let worst = 0;
      let at = -1;
      for (let i = first + 1; i < last; i++) {
        const d = perpendicular(points[i], points[first], points[last]);
        if (d > worst) {
          worst = d;
          at = i;
        }
      }
      if (worst > tolerance && at > 0) {
        keep[at] = 1;
        stack.push([first, at], [at, last]);
      }
    }
    return points.filter((_, i) => keep[i]);
  };

  // Photoshop's "make work path" with a 2 px tolerance, as straight segments
  const simplifyRing = (ring, tolerance) => {
    let far = 0;
    let best = -1;
    for (let i = 1; i < ring.length; i++) {
      const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
      if (d > best) {
        best = d;
        far = i;
      }
    }
    const a = simplifyOpen(ring.slice(0, far + 1), tolerance);
    const b = simplifyOpen(ring.slice(far).concat([ring[0]]), tolerance);
    return a.slice(0, -1).concat(b.slice(0, -1));
  };

  const ringsToPath = (rings) => {
    const px = (value) => ({ _unit: "pixelsUnit", _value: value });
    return {
      pathContents: {
        pathComponents: [{
          subpathListKey: rings.map((ring) => ({
            closedSubpath: true,
            points: ring.map((p) => ({ anchor: { horizontal: px(p[0]), vertical: px(p[1]) } })),
          })),
        }],
      },
    };
  };

  /* ============================== painting ============================= */

  const NONE = [];
  const newCanvas = (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    return canvas;
  };
  const colorCss = (color) => {
    if (!color) return "#000";
    if (color.red !== undefined) return `rgb(${color.red},${color.green},${color.blue})`;
    return `rgb(${color.r},${color.g},${color.b})`;
  };

  const tracePolygon = (ctx, polygon) => {
    ctx.beginPath();
    polygon.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
  };

  const traceStroke = (ctx, op, points) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = op.size;
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if (points.length === 1) ctx.lineTo(points[0][0] + 0.01, points[0][1]);
  };

  // A selection as an alpha picture, in the document's coordinates
  // A rectangle is four numbers: a whole page selected costs nothing to paint through
  const clipOf = (selection, dx, dy) => {
    const b = selection.bounds;
    if (selection.source === "rectangle" && !selection.mask) return { x: b.left - dx, y: b.top - dy, width: b.width, height: b.height };
    return { canvas: selectionCanvas(selection), x: b.left - dx, y: b.top - dy };
  };
  const selectionCanvases = new WeakMap();
  const selectionCanvas = (selection) => {
    let canvas = selectionCanvases.get(selection);
    if (canvas) return canvas;
    const b = selection.bounds;
    canvas = newCanvas(b.width, b.height);
    const ctx = canvas.getContext("2d");
    if (selection.mask) {
      const m = selection.mask;
      const image = ctx.createImageData(m.width, m.height);
      for (let i = 0; i < m.data.length; i++) {
        if (m.data[i]) image.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
    } else {
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    selectionCanvases.set(selection, canvas);
    return canvas;
  };

  // A soft brush can't be a line: it's stamped along the way, every tenth of its size, and the
  // stamps build up as in Photoshop. The spacing carries over from one segment to the next.
  const softStrokes = new WeakMap();
  const softStroke = (ctx, op, points) => {
    let state = softStrokes.get(op);
    if (!state) {
      const radius = op.size / 2;
      const side = Math.ceil(op.size) + 2;
      const dab = newCanvas(side, side);
      const c = dab.getContext("2d");
      const fade = c.createRadialGradient(side / 2, side / 2, radius * (op.hardness / 100), side / 2, side / 2, radius);
      for (let i = 0; i <= 8; i++) fade.addColorStop(i / 8, `rgba(0,0,0,${(Math.cos((i / 8) * Math.PI) + 1) / 2})`);
      c.fillStyle = fade;
      c.fillRect(0, 0, side, side);
      if (!op.erase) {
        c.globalCompositeOperation = "source-in";
        c.fillStyle = colorCss(op.color);
        c.fillRect(0, 0, side, side);
      }
      state = { dab, side, spacing: Math.max(1, op.size / 10), rest: 0 };
      softStrokes.set(op, state);
    }
    const stamp = (x, y) => ctx.drawImage(state.dab, x - state.side / 2, y - state.side / 2);
    if (points.length === 1) {
      state.rest = 0;
      stamp(points[0][0], points[0][1]);
      return;
    }
    const [a, b] = points;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let at = state.spacing - state.rest;
    while (at <= length) {
      stamp(a[0] + ((b[0] - a[0]) * at) / length, a[1] + ((b[1] - a[1]) * at) / length);
      at += state.spacing;
    }
    state.rest = length - (at - state.spacing);
  };
  // ABR presets stamp either their sampled alpha tip or a computed ellipse. The dab is cached
  // per operation (including its colour), while spacing carries across pointer events exactly
  // like the original soft brush. No canvas or typed alpha is added to the serializable op.
  const shapedStrokes = new WeakMap();
  const shapedStroke = (ctx, op, points) => {
    let state = shapedStrokes.get(op);
    if (!state) {
      const size = Math.max(1, op.size || 1);
      const roundness = Math.max(0.01, Math.min(1, op.roundness === undefined ? 1 : op.roundness));
      const angle = (op.angle || 0) * Math.PI / 180;
      const tip = op.tip && op.tip.alpha ? op.tip : null;
      const largest = tip ? Math.max(tip.width, tip.height) : 1;
      const width = Math.max(1, size * (tip ? tip.width / largest : 1) * roundness);
      const height = Math.max(1, size * (tip ? tip.height / largest : 1));
      const rx = (Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle))) / 2 + 1;
      const ry = (Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle))) / 2 + 1;
      const dab = newCanvas(Math.max(2, Math.ceil(rx * 2)), Math.max(2, Math.ceil(ry * 2)));
      const c = dab.getContext("2d");
      c.translate(dab.width / 2, dab.height / 2);
      c.rotate(angle);
      c.scale(op.flipX ? -1 : 1, op.flipY ? -1 : 1);
      if (tip) {
        const source = newCanvas(tip.width, tip.height);
        const sc = source.getContext("2d");
        const image = sc.createImageData(tip.width, tip.height);
        const hardness = Math.max(0, Math.min(100, op.hardness === undefined ? 100 : op.hardness)) / 100;
        for (let i = 0; i < tip.alpha.length; i++) {
          const alpha = tip.alpha[i] / 255;
          // Keep a hard sampled tip exact; softer settings spread its alpha transition.
          const adjusted = hardness >= 1 ? alpha : Math.max(0, Math.min(1, (alpha - (1 - hardness) * 0.45) / Math.max(0.08, hardness + 0.12)));
          image.data[i * 4 + 3] = Math.round(adjusted * 255);
        }
        sc.putImageData(image, 0, 0);
        c.drawImage(source, -width / 2, -height / 2, width, height);
      } else {
        c.scale(roundness, 1);
        const radius = size / 2;
        const hardness = Math.max(0, Math.min(100, op.hardness === undefined ? 100 : op.hardness)) / 100;
        if (hardness >= 1) {
          c.fillStyle = "#000";
          c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.fill();
        } else {
          const fade = c.createRadialGradient(0, 0, radius * hardness, 0, 0, radius);
          for (let i = 0; i <= 8; i++) fade.addColorStop(i / 8, `rgba(0,0,0,${(Math.cos(i / 8 * Math.PI) + 1) / 2})`);
          c.fillStyle = fade;
          c.fillRect(-radius, -radius, size, size);
        }
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = "source-in";
      c.fillStyle = op.erase ? "#000" : colorCss(op.color || { red: 0, green: 0, blue: 0 });
      c.fillRect(0, 0, dab.width, dab.height);
      state = { dab, rx: dab.width / 2, ry: dab.height / 2, spacing: Math.max(1, size * (op.spacing || 0.1)), rest: 0 };
      shapedStrokes.set(op, state);
    }
    const stamp = (x, y) => ctx.drawImage(state.dab, x - state.rx, y - state.ry);
    if (points.length === 1) {
      state.rest = 0;
      stamp(points[0][0], points[0][1]);
      return;
    }
    const [a, b] = points;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!length) return;
    let at = state.spacing - state.rest;
    while (at <= length) {
      stamp(a[0] + (b[0] - a[0]) * at / length, a[1] + (b[1] - a[1]) * at / length);
      at += state.spacing;
    }
    state.rest = length - (at - state.spacing);
  };
  const paintStroke = (ctx, op, points) => {
    if (op.tip || op.stamped) shapedStroke(ctx, op, points);
    else if (op.hardness < 100) softStroke(ctx, op, points);
    else {
      traceStroke(ctx, op, points);
      ctx.stroke();
    }
  };

  /* ---- gradients ---- */

  // The Gradient tool's colours, mixed as Photoshop's methods mix them: Classic in the file's
  // own values, Linear in light, Perceptual in Oklab, where halfway looks halfway to the eye
  const toLight = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const fromLight = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
  const toOklab = ([r, g, b]) => {
    const [R, G, B] = [toLight(r), toLight(g), toLight(b)];
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const fromOklab = ([L, a, b]) => {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [fromLight(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), fromLight(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), fromLight(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
  };
  const GRADIENT_METHODS = {
    classic: [(c) => c, (c) => c],
    linear: [(c) => c.map(toLight), (c) => c.map(fromLight)],
    perceptual: [toOklab, fromOklab],
  };
  // Red, green, blue (0 to 255) and alpha (0 to 1) along the gradient, in 1024 steps.
  // `stops`: { at (0 to 1), r, g, b, a }.
  const GRADIENT_STEPS = 1024;
  const gradientTable = (stops, method) => {
    const [into, back] = GRADIENT_METHODS[method] || GRADIENT_METHODS.perceptual;
    const list = stops.slice().sort((a, b) => a.at - b.at).map((stop) => ({ at: stop.at, c: into([stop.r, stop.g, stop.b]), a: stop.a === undefined ? 1 : stop.a }));
    const table = new Float32Array((GRADIENT_STEPS + 1) * 4);
    let k = 0;
    for (let i = 0; i <= GRADIENT_STEPS; i++) {
      const t = i / GRADIENT_STEPS;
      while (k < list.length - 2 && t > list[k + 1].at) k++;
      const s0 = list[k];
      const s1 = list[Math.min(k + 1, list.length - 1)];
      const f = s1.at > s0.at ? Math.max(0, Math.min(1, (t - s0.at) / (s1.at - s0.at))) : t >= s1.at ? 1 : 0;
      const mixed = back([0, 1, 2].map((n) => s0.c[n] + (s1.c[n] - s0.c[n]) * f));
      table[i * 4] = Math.max(0, Math.min(255, mixed[0]));
      table[i * 4 + 1] = Math.max(0, Math.min(255, mixed[1]));
      table[i * 4 + 2] = Math.max(0, Math.min(255, mixed[2]));
      table[i * 4 + 3] = s0.a + (s1.a - s0.a) * f;
    }
    return table;
  };
  // Where a point of the page falls along the gradient, 0 at its start and 1 at its end.
  // Linear runs from the start to the end; the others are centred on the start.
  const gradientPlace = (spec) => {
    const [sx, sy] = spec.start;
    const dx = spec.end[0] - sx;
    const dy = spec.end[1] - sy;
    const length2 = dx * dx + dy * dy || 1;
    const length = Math.sqrt(length2);
    const turn = Math.atan2(dy, dx);
    switch (spec.type) {
      case "radial": return (x, y) => Math.hypot(x - sx, y - sy) / length;
      case "reflected": return (x, y) => Math.abs((x - sx) * dx + (y - sy) * dy) / length2;
      case "diamond": return (x, y) => (Math.abs((x - sx) * dx + (y - sy) * dy) + Math.abs((y - sy) * dx - (x - sx) * dy)) / length2;
      case "angle": return (x, y) => {
        const t = (turn - Math.atan2(y - sy, x - sx)) / (Math.PI * 2);
        return t - Math.floor(t);
      };
      default: return (x, y) => ((x - sx) * dx + (y - sy) * dy) / length2;
    }
  };
  // The gradient over `box` (page pixels), `scale` times its size. Dithered: half a level of
  // noise hides the bands a long, soft gradient shows in 8 bits. `gray`: for a mask, its grey
  // in the alpha of `canvas` and how much it covers in the alpha of `cover`.
  const renderGradient = (spec, box, scale = 1, gray = false) => {
    const w = Math.max(1, Math.round(box.width * scale));
    const h = Math.max(1, Math.round(box.height * scale));
    const table = gradientTable(spec.stops, spec.method);
    const place = gradientPlace(spec);
    const opacity = spec.opacity === undefined ? 1 : spec.opacity;
    const dither = spec.dither !== false;
    const image = new ImageData(w, h);
    const px = image.data;
    const covered = gray ? new ImageData(w, h) : null;
    const grays = gray ? new Float32Array(GRADIENT_STEPS + 1) : null;
    if (gray) for (let i = 0; i <= GRADIENT_STEPS; i++) grays[i] = 0.299 * table[i * 4] + 0.587 * table[i * 4 + 1] + 0.114 * table[i * 4 + 2];
    for (let y = 0; y < h; y++) {
      const py = box.top + (y + 0.5) / scale;
      for (let x = 0; x < w; x++) {
        let t = place(box.left + (x + 0.5) / scale, py);
        if (!(t > 0)) t = 0;
        else if (t > 1) t = 1;
        if (spec.reverse) t = 1 - t;
        const i = Math.round(t * GRADIENT_STEPS);
        const n = dither ? (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1 - 0.5 : 0;
        const a = table[i * 4 + 3] * opacity;
        const o = (y * w + x) * 4;
        if (gray) {
          px[o + 3] = grays[i] * a + n;
          covered.data[o + 3] = a * 255 + n;
        } else {
          px[o] = table[i * 4] + n;
          px[o + 1] = table[i * 4 + 1] + n;
          px[o + 2] = table[i * 4 + 2] + n;
          px[o + 3] = a * 255 + n;
        }
      }
    }
    const toCanvas = (data) => {
      const canvas = newCanvas(w, h);
      canvas.getContext("2d").putImageData(data, 0, 0);
      return canvas;
    };
    return gray ? { canvas: toCanvas(image), cover: toCanvas(covered) } : { canvas: toCanvas(image) };
  };
  // A gradient's picture over its box (drawn smaller while it was dragged), cut by its clip
  const gradientShape = (op, picture) => {
    if (!op.clip && picture.width === op.width && picture.height === op.height) return picture;
    const shape = newCanvas(op.width, op.height);
    const c = shape.getContext("2d");
    c.imageSmoothingQuality = "high";
    c.drawImage(picture, 0, 0, op.width, op.height);
    if (op.clip) {
      c.globalCompositeOperation = "destination-in";
      c.translate(-op.x, -op.y);
      if (op.clip.canvas) c.drawImage(op.clip.canvas, op.clip.x, op.clip.y);
      else c.fillRect(op.clip.x, op.clip.y, op.clip.width, op.clip.height);
    }
    return shape;
  };

  // What part of a layer a piece of stroke can touch, in whole pixels
  const strokeBox = (points, size) => {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const left = Math.floor(Math.min(...xs) - size);
    const top = Math.floor(Math.min(...ys) - size);
    return { left, top, width: Math.ceil(Math.max(...xs) + size - left + 2), height: Math.ceil(Math.max(...ys) + size - top + 2) };
  };
  // A Clone Stamp stroke over `box`: where it passed, filled with the source, pixel for pixel
  const clonedPixels = (op, box, drawCoverage) => {
    const shape = newCanvas(box.width, box.height);
    const c = shape.getContext("2d");
    c.translate(-box.left, -box.top);
    drawCoverage(c);
    if (op.clip) {
      c.globalCompositeOperation = "destination-in";
      if (op.clip.canvas) c.drawImage(op.clip.canvas, op.clip.x, op.clip.y);
      else c.fillRect(op.clip.x, op.clip.y, op.clip.width, op.clip.height);
    }
    c.globalCompositeOperation = "source-in";
    c.drawImage(op.source.canvas, op.source.x, op.source.y);
    return shape;
  };
  // A stroke lays its source on the layer once. Segment by segment, each one over the last, a
  // half-transparent source would turn opaque: every segment starts again from the layer as it
  // was, with all the stroke so far.
  const cloneSegment = (entry, live, points) => {
    const { op } = live;
    if (!live.base) {
      live.base = newCanvas(entry.canvas.width, entry.canvas.height);
      live.base.getContext("2d").drawImage(entry.canvas, 0, 0);
      live.coverage = newCanvas(entry.canvas.width, entry.canvas.height);
      const c = live.coverage.getContext("2d");
      c.translate(-entry.cx0, -entry.cy0);
      c.strokeStyle = "#000";
    }
    paintStroke(live.coverage.getContext("2d"), op, points);
    const box = strokeBox(points, op.size);
    const pixels = clonedPixels(op, box, (c) => c.drawImage(live.coverage, entry.cx0, entry.cy0));
    entry.ctx.clearRect(box.left, box.top, box.width, box.height);
    entry.ctx.drawImage(live.base, box.left - entry.cx0, box.top - entry.cy0, box.width, box.height, box.left, box.top, box.width, box.height);
    entry.ctx.globalCompositeOperation = op.atop ? "source-atop" : "source-over";
    entry.ctx.drawImage(pixels, box.left, box.top);
    entry.ctx.globalCompositeOperation = "source-over";
  };

  // The source and destination are two offsets into one immutable snapshot. The synchronous
  // path is also the fallback for engines without Worker; browsers use the same full-stroke
  // mathematics off the UI thread below.
  const healedPixels = (op, box) => {
    const source = op.healingSource;
    const destination = op.healingDestination;
    const sourceAt = op.healingSourceAt;
    const destinationAt = op.healingDestinationAt;
    const shape = clonedPixels(Object.assign({}, op, { source: { canvas: source, x: sourceAt.x, y: sourceAt.y } }), box, (c) => {
      c.strokeStyle = "#000";
      op.points.forEach((point, index) => paintStroke(c, op, index ? [op.points[index - 1], point] : [point]));
    });
    const left = Math.max(box.left, sourceAt.x, destinationAt.x);
    const top = Math.max(box.top, sourceAt.y, destinationAt.y);
    const width = Math.max(0, Math.min(box.left + box.width, sourceAt.x + source.width, destinationAt.x + destination.width) - left);
    const height = Math.max(0, Math.min(box.top + box.height, sourceAt.y + source.height, destinationAt.y + destination.height) - top);
    if (!width || !height || typeof window.TypeRHealing === "undefined") return shape;
    const dst = destination.getContext("2d").getImageData(left - destinationAt.x, top - destinationAt.y, width, height);
    const src = source.getContext("2d").getImageData(left - sourceAt.x, top - sourceAt.y, width, height);
    const coverage = shape.getContext("2d").getImageData(left - box.left, top - box.top, width, height);
    const mask = new Uint8Array(width * height);
    const strength = new Float32Array(width * height);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = coverage.data[i * 4 + 3] ? 1 : 0;
      strength[i] = coverage.data[i * 4 + 3] / 255;
    }
    const output = window.TypeRHealing.seamlessClone(width, height, src.data, dst.data, mask, 4);
    const blended = shape.getContext("2d").createImageData(width, height);
    for (let i = 0; i < mask.length; i++) {
      const at = i * 4;
      const amount = strength[i];
      blended.data[at] = dst.data[at] + (output[at] - dst.data[at]) * amount;
      blended.data[at + 1] = dst.data[at + 1] + (output[at + 1] - dst.data[at + 1]) * amount;
      blended.data[at + 2] = dst.data[at + 2] + (output[at + 2] - dst.data[at + 2]) * amount;
      blended.data[at + 3] = dst.data[at + 3] + (output[at + 3] - dst.data[at + 3]) * amount;
    }
    shape.getContext("2d").putImageData(blended, left - box.left, top - box.top);
    return shape;
  };

  const paintHealing = (entry, live, shape, box) => {
    const clear = strokeBox(live.op.points, live.op.size);
    entry.ctx.save();
    entry.ctx.clearRect(clear.left, clear.top, clear.width, clear.height);
    entry.ctx.drawImage(live.base, clear.left - entry.cx0, clear.top - entry.cy0, clear.width, clear.height, clear.left, clear.top, clear.width, clear.height);
    entry.ctx.globalCompositeOperation = live.op.atop ? "source-atop" : "source-over";
    entry.ctx.drawImage(shape, box.left, box.top);
    entry.ctx.restore();
    entry.version++;
  };
  const healingStroke = (entry, live) => {
    const box = strokeBox(live.op.points, live.op.size);
    paintHealing(entry, live, healedPixels(live.op, box), box);
  };

  // Replay the complete original stroke on HTMLCanvas, then transfer immutable bitmap samples.
  // Main-canvas coverage preserves the fallback's exact joins, soft dabs and antialiased edges.
  const healingData = (live) => {
    const op = live.op;
    const box = strokeBox(op.points, op.size);
    const sourceAt = op.healingSourceAt;
    const destinationAt = op.healingDestinationAt;
    const left = Math.max(box.left, sourceAt.x, destinationAt.x);
    const top = Math.max(box.top, sourceAt.y, destinationAt.y);
    const width = Math.max(0, Math.min(box.left + box.width, sourceAt.x + op.healingSource.width, destinationAt.x + op.healingDestination.width) - left);
    const height = Math.max(0, Math.min(box.top + box.height, sourceAt.y + op.healingSource.height, destinationAt.y + op.healingDestination.height) - top);
    if (!width || !height) return null;
    const coverage = newCanvas(box.width, box.height);
    const c = coverage.getContext("2d");
    c.translate(-box.left, -box.top);
    c.strokeStyle = "#000";
    // A fresh operation resets soft-dab spacing, then replays the complete original polyline.
    // HTMLCanvas is intentional: its edge rasterization is the reference for the fallback too.
    const coverageOp = Object.assign({}, op);
    op.points.forEach((point, index) => paintStroke(c, coverageOp, index ? [op.points[index - 1], point] : [point]));
    if (op.clip) {
      c.globalCompositeOperation = "destination-in";
      if (op.clip.canvas) c.drawImage(op.clip.canvas, op.clip.x, op.clip.y);
      else c.fillRect(op.clip.x, op.clip.y, op.clip.width, op.clip.height);
    }
    return { box, left, top, width, height, source: op.healingSource, destination: op.healingDestination, sourceAt, destinationAt, coverage };
  };
  let sharedHealingWorker = null;
  let healingWorkerFailed = false;
  let healingJobId = 0;
  const healingJobs = new Map();
  const startHealingJob = (doc, entry, live, frame) => {
    if (!frame) {
      live.healingReady = true;
      if (live.finish) ops.endStroke();
      return;
    }
    live.preparing = true;
    live.healingReady = false;
    // ImageBitmap extraction is asynchronous; all actual getImageData calls happen in the worker.
    const bitmaps = [
      createImageBitmap(frame.source, frame.left - frame.sourceAt.x, frame.top - frame.sourceAt.y, frame.width, frame.height),
      createImageBitmap(frame.destination, frame.left - frame.destinationAt.x, frame.top - frame.destinationAt.y, frame.width, frame.height),
      createImageBitmap(frame.coverage, frame.left - frame.box.left, frame.top - frame.box.top, frame.width, frame.height),
    ];
    Promise.all(bitmaps).then(([sourceBitmap, destinationBitmap, coverageBitmap]) => {
      live.preparing = false;
      const close = () => {
        sourceBitmap.close();
        destinationBitmap.close();
        coverageBitmap.close();
      };
      if (app.doc !== doc || doc.liveStroke !== live) {
        close();
        return;
      }
      if (live.needsJob) {
        close();
        live.needsJob = false;
        startHealingJob(doc, entry, live, healingData(live));
        return;
      }
      const data = { box: frame.box, left: frame.left, top: frame.top, width: frame.width, height: frame.height, sourceBitmap, destinationBitmap, coverageBitmap };
      live.busy = true;
      data.id = ++healingJobId;
      healingJobs.set(data.id, { doc, live });
      sharedHealingWorker.postMessage(data, [sourceBitmap, destinationBitmap, coverageBitmap]);
    }).catch(() => {
      live.preparing = false;
      live.worker = null;
      live.needsJob = false;
      live.busy = false;
      healingStroke(entry, live);
      live.healingReady = true;
      if (live.finish) ops.endStroke();
    });
  };
  const applyHealingData = (entry, live, data) => {
    const shape = newCanvas(data.box.width, data.box.height);
    const image = shape.getContext("2d").createImageData(data.width, data.height);
    image.data.set(data.blended);
    shape.getContext("2d").putImageData(image, data.left - data.box.left, data.top - data.box.top);
    paintHealing(entry, live, shape, data.box);
    const clear = strokeBox(live.op.points, live.op.size);
    emit("render", pageRect(app.doc, clear.left + live.dx, clear.top + live.dy, clear.left + clear.width + live.dx, clear.top + clear.height + live.dy));
  };
  const healingWorkerMessage = (doc, live, data) => {
    if (app.doc !== doc || doc.liveStroke !== live) return;
    live.busy = false;
    const layer = doc.state.layers.find((item) => item.id === live.layerId);
    // Show every completed exact frame, even when the pointer has already queued more points.
    // Otherwise continuous motion keeps discarding results and no healing is visible until a pause.
    // The following job still replaces this with the latest complete full-stroke solution.
    if (layer) applyHealingData(rasterEntry(layer, doc), live, data);
    const rerun = live.needsJob;
    live.needsJob = false;
    const latest = rerun && layer ? healingData(live) : null;
    if (latest) startHealingJob(doc, rasterEntry(layer, doc), live, latest);
    else {
      live.healingReady = true;
      if (live.finish) ops.endStroke();
    }
  };
  const getHealingWorker = () => {
    if (sharedHealingWorker || healingWorkerFailed || typeof Worker === "undefined") return sharedHealingWorker;
    try {
      sharedHealingWorker = new Worker("healing-worker.js");
    } catch (error) {
      healingWorkerFailed = true;
      return null;
    }
    sharedHealingWorker.onmessage = (event) => {
      const job = healingJobs.get(event.data.id);
      healingJobs.delete(event.data.id);
      if (job) healingWorkerMessage(job.doc, job.live, event.data);
    };
    sharedHealingWorker.onerror = (event) => {
      event.preventDefault();
      const jobs = Array.from(healingJobs.values());
      healingJobs.clear();
      sharedHealingWorker.terminate();
      sharedHealingWorker = null;
      healingWorkerFailed = true;
      const handled = new Set();
      jobs.forEach(({ doc, live }) => {
        if (handled.has(live) || app.doc !== doc || doc.liveStroke !== live) return;
        handled.add(live);
        live.worker = null;
        live.needsJob = false;
        live.preparing = false;
        live.busy = false;
        const layer = doc.state.layers.find((item) => item.id === live.layerId);
        if (layer) healingStroke(rasterEntry(layer, doc), live);
        live.healingReady = true;
        if (live.finish) ops.endStroke();
      });
    };
    return sharedHealingWorker;
  };
  // Start the one shared worker during idle time, not inside the first pointerdown/move.
  const prewarmHealing = () => getHealingWorker();
  if (typeof requestIdleCallback === "function") requestIdleCallback(prewarmHealing, { timeout: 1500 });
  else setTimeout(prewarmHealing, 0);
  const prepareHealing = (doc, entry, live) => {
    if (live.base) return;
    live.base = newCanvas(entry.canvas.width, entry.canvas.height);
    live.base.getContext("2d").drawImage(entry.canvas, 0, 0);
    live.needsJob = false;
    live.preparing = false;
    live.busy = false;
    live.healingReady = false;
    live.worker = getHealingWorker();
  };
  const queueHealing = (doc, entry, live) => {
    prepareHealing(doc, entry, live);
    if (!live.worker || typeof createImageBitmap === "undefined") {
      healingStroke(entry, live);
      live.healingReady = true;
      return;
    }
    if (live.busy || live.preparing) {
      live.needsJob = true;
      return;
    }
    startHealingJob(doc, entry, live, healingData(live));
  };

  /* ---- Smudge: colour carried from one sequential dab to the next ---- */
  // The buffer and the working layer are premultiplied while they mix. This matters at a
  // transparent edge: the unused RGB of a transparent pixel must not become a dark fringe.
  const makeSmudgeState = (ctx, op) => {
    const radius = Math.ceil(op.size / 2) + 1;
    const side = radius * 2 + 1;
    const transform = ctx.getTransform();
    return {
      radius, side, carry: null, cx0: -transform.e, cy0: -transform.f,
      sample: newCanvas(side, side), clip: op.clip ? newCanvas(side, side) : null,
    };
  };
  const smudgeSegment = (ctx, op, points, state) => {
    const { side, radius } = state;
    const sampleCtx = state.sample.getContext("2d", { willReadFrequently: true });
    const clipCtx = state.clip && state.clip.getContext("2d", { willReadFrequently: true });
    const readSquare = (left, top, target = null) => {
      // The dab's ImageData is already the current layer after putImageData. Reusing it avoids
      // a second synchronous GPU readback for every stamp (the common Current Layer path).
      if (target && !op.smudge.sampleAll) return target.data;
      sampleCtx.clearRect(0, 0, side, side);
      if (op.smudge.sampleAll && op.source) sampleCtx.drawImage(op.source.canvas, op.source.x - left, op.source.y - top);
      if (target) {
        if (!state.targetSample) state.targetSample = newCanvas(side, side);
        state.targetSample.getContext("2d").putImageData(target, 0, 0);
        sampleCtx.drawImage(state.targetSample, 0, 0);
      } else {
        // In Sample All Layers the changing active layer replaces its old pixels in the merged
        // snapshot. With Current Layer this is the only source.
        sampleCtx.drawImage(ctx.canvas, state.cx0 - left, state.cy0 - top);
      }
      return sampleCtx.getImageData(0, 0, side, side).data;
    };
    const clipSquare = (left, top) => {
      if (!op.clip) return null;
      clipCtx.clearRect(0, 0, side, side);
      if (op.clip.canvas) clipCtx.drawImage(op.clip.canvas, op.clip.x - left, op.clip.y - top);
      else {
        clipCtx.fillStyle = "#fff";
        clipCtx.fillRect(op.clip.x - left, op.clip.y - top, op.clip.width, op.clip.height);
      }
      return clipCtx.getImageData(0, 0, side, side).data;
    };
    const dab = (x, y) => {
      const cx = Math.floor(x), cy = Math.floor(y);
      const left = cx - radius, top = cy - radius;
      const target = ctx.getImageData(left - state.cx0, top - state.cy0, side, side);
      if (!state.carry) {
        state.carry = new Float32Array(side * side * 4);
        const finger = op.smudge.finger;
        if (finger) {
          // Finger Painting needs no pickup read on the first dab: its entire carry is known.
          for (let i = 0; i < state.carry.length; i += 4) {
            state.carry[i] = finger.red;
            state.carry[i + 1] = finger.green;
            state.carry[i + 2] = finger.blue;
            state.carry[i + 3] = 255;
          }
        } else {
          const picked = readSquare(left, top, target);
          for (let i = 0; i < state.carry.length; i += 4) {
            const a = picked[i + 3] / 255;
            state.carry[i] = picked[i] * a;
            state.carry[i + 1] = picked[i + 1] * a;
            state.carry[i + 2] = picked[i + 2] * a;
            state.carry[i + 3] = picked[i + 3];
          }
        }
      }
      const pixels = target.data;
      const clipped = clipSquare(left, top);
      const strength = op.smudge.strength;
      const brushRadius = op.size / 2;
      const radiusSquared = brushRadius * brushRadius;
      const hard = brushRadius * (op.hardness === undefined ? 100 : op.hardness) / 100;
      const hardSquared = hard * hard;
      const feather = Math.max(0.001, brushRadius - hard);
      for (let py = 0; py < side; py++) {
        for (let px = 0; px < side; px++) {
          const dx = left + px + 0.5 - x, dy = top + py + 0.5 - y;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared >= radiusSquared) continue;
          let coverage = distanceSquared <= hardSquared ? 1 : Math.max(0, Math.min(1, (brushRadius - Math.sqrt(distanceSquared)) / feather));
          if (clipped) coverage *= clipped[(py * side + px) * 4 + 3] / 255;
          const i = (py * side + px) * 4;
          if (op.atop && !pixels[i + 3]) continue;
          const amount = coverage * strength * (op.atop ? state.carry[i + 3] / 255 : 1);
          if (amount <= 0) continue;
          const alpha = pixels[i + 3] / 255;
          const outA = op.atop ? pixels[i + 3] : pixels[i + 3] + (state.carry[i + 3] - pixels[i + 3]) * amount;
          for (let channel = 0; channel < 3; channel++) {
            const destination = pixels[i + channel] * alpha;
            const mixed = destination + (state.carry[i + channel] - destination) * amount;
            pixels[i + channel] = outA > 0.001 ? Math.max(0, Math.min(255, mixed * 255 / outA)) : 0;
          }
          pixels[i + 3] = Math.max(0, Math.min(255, outA));
        }
      }
      ctx.putImageData(target, left - state.cx0, top - state.cy0);
      // Pick up after laying down. Strength is also how much of the previous carried colour
      // survives this pickup, matching PhotoCraft's Smudge rather than repeatedly blurring.
      const picked = readSquare(left, top, target);
      for (let i = 0; i < state.carry.length; i += 4) {
        const a = picked[i + 3] / 255;
        state.carry[i] = state.carry[i] * strength + picked[i] * a * (1 - strength);
        state.carry[i + 1] = state.carry[i + 1] * strength + picked[i + 1] * a * (1 - strength);
        state.carry[i + 2] = state.carry[i + 2] * strength + picked[i + 2] * a * (1 - strength);
        state.carry[i + 3] = state.carry[i + 3] * strength + picked[i + 3] * (1 - strength);
      }
    };
    if (points.length === 1) { dab(points[0][0], points[0][1]); return; }
    const [a, b] = points;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(length / Math.max(1, op.size * 0.2)));
    for (let i = 1; i <= count; i++) {
      const at = i / count;
      dab(a[0] + (b[0] - a[0]) * at, a[1] + (b[1] - a[1]) * at);
    }
  };

  // One painted thing on a layer, in the layer's own coordinates
  const drawOp = (ctx, op, points) => {
    ctx.save();
    // On a layer whose transparent pixels are locked, paint goes only where there are pixels
    const over = op.atop ? "source-atop" : "source-over";
    ctx.globalCompositeOperation = over;
    if (op.t === "poly") {
      const xs = op.polygon.map((p) => p[0]);
      const ys = op.polygon.map((p) => p[1]);
      const left = Math.floor(Math.min(...xs)) - 2;
      const top = Math.floor(Math.min(...ys)) - 2;
      const shape = newCanvas(Math.max(...xs) - left + 4, Math.max(...ys) - top + 4);
      const c = shape.getContext("2d");
      c.translate(-left, -top);
      tracePolygon(c, op.polygon);
      c.fillStyle = colorCss(op.color);
      c.fill();
      if (op.inset > 0) {
        c.globalCompositeOperation = "destination-out";
        c.lineWidth = op.inset * 2;
        c.lineJoin = "round";
        c.stroke();
      }
      ctx.drawImage(shape, left, top);
    } else if (op.t === "image") {
      ctx.drawImage(op.canvas, op.x, op.y);
    } else if (op.t === "gradient") {
      ctx.drawImage(gradientShape(op, op.canvas), op.x, op.y);
    } else if (op.t === "stroke" && op.smudge) {
      const state = makeSmudgeState(ctx, op);
      if (points) smudgeSegment(ctx, op, points, state);
      else op.points.forEach((point, index) => smudgeSegment(ctx, op, index ? [op.points[index - 1], point] : [point], state));
    } else if (op.t === "stroke" && op.healingResult) {
      // The live segments already produced the final pixels. Replaying this small patch is
      // immediate and exact; solving the whole stroke again would only make History slow.
      ctx.globalCompositeOperation = "copy";
      ctx.drawImage(op.healingResult, op.healingBox.left, op.healingBox.top);
    } else if (op.t === "stroke" && op.source) {
      const box = strokeBox(op.points, op.size);
      const pixels = clonedPixels(op, box, (c) => {
        c.strokeStyle = "#000";
        op.points.forEach((point, index) => paintStroke(c, op, index ? [op.points[index - 1], point] : [point]));
      });
      ctx.drawImage(pixels, box.left, box.top);
    } else if (op.t === "stroke" && !points) {
      // Redrawn the way it was painted, segment by segment: its edges come out the same
      op.points.forEach((point, index) => drawOp(ctx, op, index ? [op.points[index - 1], point] : [point]));
    } else if (op.t === "stroke") {
      const list = points;
      if (op.clip) {
        const { left, top, width, height } = strokeBox(list, op.size);
        const shape = newCanvas(width, height);
        const c = shape.getContext("2d");
        c.translate(-left, -top);
        c.strokeStyle = "#000";
        paintStroke(c, op, list);
        c.globalCompositeOperation = "destination-in";
        if (op.clip.canvas) c.drawImage(op.clip.canvas, op.clip.x, op.clip.y);
        else c.fillRect(op.clip.x, op.clip.y, op.clip.width, op.clip.height);
        c.setTransform(1, 0, 0, 1, 0, 0);
        if (!op.erase) {
          c.globalCompositeOperation = "source-in";
          c.fillStyle = colorCss(op.color);
          c.fillRect(0, 0, shape.width, shape.height);
        }
        ctx.globalCompositeOperation = op.erase ? "destination-out" : over;
        ctx.drawImage(shape, left, top);
      } else {
        ctx.globalCompositeOperation = op.erase ? "destination-out" : over;
        ctx.strokeStyle = op.erase ? "#000" : colorCss(op.color);
        paintStroke(ctx, op, list);
      }
    } else if (op.t === "patch") {
      // Pixels made elsewhere (a Content-Aware Fill), laid within the selection they filled
      const shape = newCanvas(op.source.canvas.width, op.source.canvas.height);
      const c = shape.getContext("2d");
      c.drawImage(op.source.canvas, 0, 0);
      if (op.clip) {
        c.globalCompositeOperation = "destination-in";
        c.translate(-op.source.x, -op.source.y);
        if (op.clip.canvas) c.drawImage(op.clip.canvas, op.clip.x, op.clip.y);
        else c.fillRect(op.clip.x, op.clip.y, op.clip.width, op.clip.height);
      }
      ctx.drawImage(shape, op.source.x, op.source.y);
    } else if (op.t === "fill" && !op.clip.canvas) {
      ctx.globalCompositeOperation = op.erase ? "destination-out" : over;
      ctx.fillStyle = op.erase ? "#000" : colorCss(op.color);
      ctx.fillRect(op.clip.x, op.clip.y, op.clip.width, op.clip.height);
    } else if (op.t === "fill") {
      if (op.erase) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(op.clip.canvas, op.clip.x, op.clip.y);
      } else {
        const shape = newCanvas(op.clip.canvas.width, op.clip.canvas.height);
        const c = shape.getContext("2d");
        c.drawImage(op.clip.canvas, 0, 0);
        c.globalCompositeOperation = "source-in";
        c.fillStyle = colorCss(op.color);
        c.fillRect(0, 0, shape.width, shape.height);
        ctx.drawImage(shape, op.clip.x, op.clip.y);
      }
    }
    ctx.restore();
  };

  // Layer masks read from a PSD hold their value in the colour channels: as alpha, a canvas
  // can cut a picture with them. Kept by picture, which a moved mask still shares.
  const maskAlphas = new WeakMap();
  const maskAlpha = (mask) => {
    const source = mask.canvas;
    let canvas = maskAlphas.get(source);
    if (canvas) return canvas;
    canvas = newCanvas(source.width, source.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < image.data.length; i += 4) image.data[i + 3] = image.data[i];
    ctx.putImageData(image, 0, 0);
    maskAlphas.set(source, canvas);
    return canvas;
  };

  // What a pixel layer looks like: its picture, what was painted on it, its mask.
  // A painted layer keeps one canvas and only draws what is new.
  // Rebuilt from the layer when needed again, so what isn't on screen can go: the oldest pages
  // first when the budget is spent, and all of a page when it closes.
  const RASTER_BUDGET = 512 * 1024 * 1024;
  const rasterCache = new Map();
  let rasterBytes = 0;
  const forgetRaster = (id, entry) => {
    rasterBytes -= entry.bytes;
    rasterCache.delete(id);
  };
  const keepRasterInBudget = () => {
    for (const [id, entry] of rasterCache) {
      if (rasterBytes <= RASTER_BUDGET) return;
      if (!app.doc || entry.docId !== app.doc.id) forgetRaster(id, entry);
    }
    if (rasterBytes <= RASTER_BUDGET || !app.doc) return;
    // The page on screen alone is over the budget: first the layers it no longer has (undone,
    // deleted: drawn again if they come back), then the pictures undo starts from
    const present = new Set(app.doc.state.layers.map((layer) => layer.id));
    for (const [id, entry] of rasterCache) {
      if (rasterBytes <= RASTER_BUDGET) return;
      if (!present.has(id)) forgetRaster(id, entry);
    }
    for (const entry of rasterCache.values()) {
      if (rasterBytes <= RASTER_BUDGET) return;
      while (entry.marks.length) {
        const gone = entry.marks.shift();
        const bytes = gone.canvas.width * gone.canvas.height * 4;
        entry.bytes -= bytes;
        rasterBytes -= bytes;
      }
    }
  };
  const forgetDocPixels = (doc) => {
    for (const [id, entry] of rasterCache) {
      if (entry.docId === doc.id) forgetRaster(id, entry);
    }
    doc.sampleCache = null;
    doc.sampleKey = null;
  };
  // A picture of the layer every so many strokes, the last two: undoing replays a few of them
  const MARK_EVERY = 16;
  const markRaster = (entry, ops) => {
    if (entry.marks.some((item) => item.count === ops.length)) return;
    const canvas = newCanvas(entry.canvas.width, entry.canvas.height);
    canvas.getContext("2d").drawImage(entry.canvas, 0, 0);
    entry.marks.push({ canvas, ops, count: ops.length, bitmap: entry.bitmap, cx0: entry.cx0, cy0: entry.cy0 });
    let change = canvas.width * canvas.height * 4;
    if (entry.marks.length > 2) {
      const gone = entry.marks.shift();
      change -= gone.canvas.width * gone.canvas.height * 4;
    }
    entry.bytes += change;
    rasterBytes += change;
    keepRasterInBudget();
  };
  const rasterEntry = (layer, doc) => {
    const paint = layer.paint || NONE;
    const dx = layer.dx || 0;
    const dy = layer.dy || 0;
    const left = layer.left || 0;
    const top = layer.top || 0;
    let entry = rasterCache.get(layer.id);
    const covers = entry && entry.cx0 <= Math.min(0, -dx) && entry.cy0 <= Math.min(0, -dy) && entry.cx1 >= Math.max(doc.width, doc.width - dx) && entry.cy1 >= Math.max(doc.height, doc.height - dy);
    const usable = entry && covers && entry.bitmap === layer.bitmap && entry.paint.length <= paint.length && entry.paint.every((op, i) => op === paint[i]);
    if (!usable) {
      const w = layer.bitmap ? layer.bitmap.width : 0;
      const h = layer.bitmap ? layer.bitmap.height : 0;
      const cx0 = Math.min(0, -dx, layer.bitmap ? left : 0);
      const cy0 = Math.min(0, -dy, layer.bitmap ? top : 0);
      const cx1 = Math.max(doc.width, doc.width - dx, left + w);
      const cy1 = Math.max(doc.height, doc.height - dy, top + h);
      const canvas = newCanvas(cx1 - cx0, cy1 - cy0);
      const ctx = canvas.getContext("2d");
      // Undo starts from the nearest picture saved along the way, not from the first stroke
      const mark = entry && entry.marks.filter((item) => item.bitmap === layer.bitmap && item.count <= paint.length && item.cx0 === cx0 && item.cy0 === cy0 && item.canvas.width === canvas.width && item.canvas.height === canvas.height && item.ops.every((op, i) => op === paint[i])).pop();
      if (mark) ctx.drawImage(mark.canvas, 0, 0);
      ctx.translate(-cx0, -cy0);
      if (layer.bitmap && !mark) ctx.drawImage(layer.bitmap, left, top);
      const previous = rasterCache.get(layer.id);
      if (previous) forgetRaster(layer.id, previous);
      const marks = entry ? entry.marks.filter((item) => item.bitmap === layer.bitmap && item.count <= paint.length && item.ops.every((op, i) => op === paint[i])) : [];
      entry = { canvas, ctx, cx0, cy0, cx1, cy1, bitmap: layer.bitmap, paint: mark ? paint.slice(0, mark.count) : NONE, version: 0, docId: doc.id, marks, bytes: canvas.width * canvas.height * 4 * (1 + marks.length) };
      rasterCache.set(layer.id, entry);
      rasterBytes += entry.bytes;
      keepRasterInBudget();
    }
    if (entry.paint.length < paint.length) {
      for (let i = entry.paint.length; i < paint.length; i++) {
        drawOp(entry.ctx, paint[i]);
        if ((i + 1) % MARK_EVERY === 0) markRaster(entry, paint.slice(0, i + 1));
      }
      entry.paint = paint;
      entry.version++;
    }
    return entry;
  };

  // Its mask is laid on it by visualOf, as on any layer. `version` tells a canvas painted on in
  // place from the one it was.
  const rasterVisual = (layer, doc) => {
    const paint = layer.paint || NONE;
    const dx = layer.dx || 0;
    const dy = layer.dy || 0;
    const live = doc.liveStroke && doc.liveStroke.layerId === layer.id && !doc.liveStroke.target;
    if (!paint.length && !live) {
      return layer.bitmap ? { canvas: layer.bitmap, x: (layer.left || 0) + dx, y: (layer.top || 0) + dy } : null;
    }
    const entry = rasterEntry(layer, doc);
    return { canvas: entry.canvas, x: entry.cx0 + dx, y: entry.cy0 + dy, version: entry.version };
  };

  // Photoshop's anti-aliasing methods, as curves on the coverage the browser draws.
  // Strong and Smooth were fitted on real PSDs (54 and 3 text layers); Sharp and Crisp
  // raise the contrast of the same edge, None keeps it on or off.
  const edgeCurve = (a, c) => Math.max(0, Math.min(1, (a - 0.6) * c + 0.5));
  const ANTI_ALIAS = {
    antiAliasNone: (a) => (a >= 0.6 ? 1 : 0),
    antiAliasSharp: (a) => edgeCurve(a, 2.4),
    antiAliasCrisp: (a) => edgeCurve(a, 1.6),
    antiAliasStrong: (a) => a ** 1.25,
    antiAliasSmooth: (a) => a ** 1.8,
    antiAliasPlatformGray: (a) => a ** 1.8,
    antiAliasPlatformLCD: (a) => a ** 1.8,
  };
  // The letters drawn from their outlines come out lighter and greyer than Photoshop's: 0.2 px
  // around each one brings them level, in every mode (54 Strong layers, 3 Smooth, 1 Sharp)
  const EMBOLDEN = 0.2;
  const antiAliasTables = new Map();
  const antiAliasTable = (mode) => {
    const name = ANTI_ALIAS[mode] ? mode : "antiAliasSmooth";
    let table = antiAliasTables.get(name);
    if (!table) {
      table = new Uint8Array(256);
      for (let i = 0; i < 256; i++) table[i] = Math.round(ANTI_ALIAS[name](i / 255) * 255);
      antiAliasTables.set(name, table);
    }
    return table;
  };
  const applyAntiAlias = (canvas, ctx, mode) => {
    const table = antiAliasTable(mode);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = image.data;
    for (let i = 3; i < px.length; i += 4) px[i] = table[px[i]];
    ctx.putImageData(image, 0, 0);
  };

  // Below 256 px the browser asks the system for each letter, and Windows draws them heavier
  // than the Mac. Above, it draws them from their outlines itself, the same everywhere: the
  // text is drawn that large, then brought back down. By a power of two it comes down
  // exactly, through the halved copies the browser keeps of a picture it shrinks.
  const OUTLINE_SIZE = 260;
  const outlineScale = (lines, matrixScale) => {
    let smallest = Infinity;
    lines.forEach((line) => line.m.placed.forEach((item) => { smallest = Math.min(smallest, item.size * Math.min(item.scaleX, item.scaleY)); }));
    smallest *= matrixScale;
    if (!(smallest > 0 && smallest < Infinity)) return 1;
    let k = 1;
    while (k < 64 && smallest * k < OUTLINE_SIZE) k *= 2;
    return k;
  };
  // Draws on the canvas what draw() traces, with `transform` from the text to the canvas,
  // tile by tile to keep the large copy within a few dozen megabytes
  const TILE_PIXELS = 16 * 1024 * 1024;
  const drawFromOutlines = (canvas, ctx, transform, k, draw) => {
    const [a, b, c, d, e, f] = transform;
    if (k === 1) {
      ctx.setTransform(a, b, c, d, e, f);
      draw(ctx);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    const tileW = Math.min(canvas.width, Math.floor(16384 / k));
    const tileH = Math.max(1, Math.min(canvas.height, Math.floor(TILE_PIXELS / (tileW * k * k))));
    const tile = newCanvas(tileW * k, tileH * k);
    const g = tile.getContext("2d", { willReadFrequently: true });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
    for (let y0 = 0; y0 < canvas.height; y0 += tileH) {
      for (let x0 = 0; x0 < canvas.width; x0 += tileW) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, tile.width, tile.height);
        g.setTransform(a * k, b * k, c * k, d * k, (e - x0) * k, (f - y0) * k);
        draw(g);
        ctx.drawImage(tile, x0, y0, tileW, tileH);
      }
    }
    ctx.restore();
  };

  const textBitmaps = new WeakMap();
  // The text drawn again at the size it lands at, so it stays sharp, then laid on the surface
  // triangle by triangle, at twice the resolution for clean edges. Canvas can't do this:
  // it only knows parallelograms. `quick`, while the surface is dragged: at the page's own
  // resolution, four times less work, and drawn again finely once the drag stops.
  const warpedBitmap = (layer, doc, relative, stroke, antiAlias, quick = false) => {
    const { warp } = layer;
    const { at } = surfaceOf(warp);
    const [p0, p1, p2, p3] = warp.corners;
    const length = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const across = Math.max(length(p0, p1), length(p3, p2));
    const down = Math.max(length(p0, p3), length(p1, p2));
    let largest = 0;
    relative.lines.forEach((line) => line.m.placed.forEach((item) => { largest = Math.max(largest, item.size); }));
    const pad = Math.ceil(6 + largest * 0.2 + strokeReach(stroke) * 1.5);
    const b = relative.box;
    const sourceW = b.width + pad * 2;
    const sourceH = b.height + pad * 2;
    const scale = Math.min(4096 / sourceW, 4096 / sourceH, Math.max(0.5, 2 * Math.max(across / warp.source.width, down / warp.source.height)));
    const source = newCanvas(sourceW * scale, sourceH * scale);
    const sourceCtx = source.getContext("2d", { willReadFrequently: true });
    sourceCtx.scale(scale, scale);
    sourceCtx.translate(pad - b.left, pad - b.top);
    drawLines(sourceCtx, relative.lines, stroke, layer);
    const pixels = sourceCtx.getImageData(0, 0, source.width, source.height).data;
    const sw = source.width;
    const sh = source.height;

    const cols = Math.max(8, Math.min(120, Math.ceil(across / 8)));
    const rows = Math.max(4, Math.min(60, Math.ceil(down / 8)));
    const mesh = new Float64Array((cols + 1) * (rows + 1) * 2);
    let at_ = 0;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const x = b.left - pad + (sourceW * c) / cols;
        const y = b.top - pad + (sourceH * r) / rows;
        const point = at((x - warp.source.left) / warp.source.width, (y - warp.source.top) / warp.source.height);
        mesh[at_++] = point[0];
        mesh[at_++] = point[1];
      }
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < mesh.length; i += 2) {
      left = Math.min(left, mesh[i]);
      right = Math.max(right, mesh[i]);
      top = Math.min(top, mesh[i + 1]);
      bottom = Math.max(bottom, mesh[i + 1]);
    }
    // Only what can show on the page
    left = Math.floor(Math.max(left, -64)) - 1;
    top = Math.floor(Math.max(top, -64)) - 1;
    right = Math.ceil(Math.min(right, doc.width + 64)) + 1;
    bottom = Math.ceil(Math.min(bottom, doc.height + 64)) + 1;
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const over = quick || width * height > 6000000 ? 1 : 2;
    const W = width * over;
    const H = height * over;
    const big = new ImageData(W, H);
    const out = big.data;

    const triangle = (x0, y0, s0, t0, x1, y1, s1, t1, x2, y2, s2, t2) => {
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-6) return;
      const inv = 1 / area;
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const stepA = (y1 - y2) * inv;
      const stepB = (y2 - y0) * inv;
      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5;
        const px = minX + 0.5;
        let wa = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv;
        let wb = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv;
        for (let x = minX; x <= maxX; x++, wa += stepA, wb += stepB) {
          const wc = 1 - wa - wb;
          if (wa < -1e-4 || wb < -1e-4 || wc < -1e-4) continue;
          const sx = wa * s0 + wb * s1 + wc * s2 - 0.5;
          const sy = wa * t0 + wb * t1 + wc * t2 - 0.5;
          const ix = Math.floor(sx);
          const iy = Math.floor(sy);
          if (ix < 0 || iy < 0 || ix + 1 >= sw || iy + 1 >= sh) continue;
          const a00 = (iy * sw + ix) * 4;
          const a10 = a00 + 4;
          const a01 = a00 + sw * 4;
          const a11 = a01 + 4;
          if (!(pixels[a00 + 3] | pixels[a10 + 3] | pixels[a01 + 3] | pixels[a11 + 3])) continue;
          const fx = sx - ix;
          const fy = sy - iy;
          // Weighed by alpha: a transparent pixel has no colour to give
          const w00 = (1 - fx) * (1 - fy) * pixels[a00 + 3];
          const w10 = fx * (1 - fy) * pixels[a10 + 3];
          const w01 = (1 - fx) * fy * pixels[a01 + 3];
          const w11 = fx * fy * pixels[a11 + 3];
          const sum = w00 + w10 + w01 + w11;
          if (sum <= 0) continue;
          const to = (y * W + x) * 4;
          out[to] = (w00 * pixels[a00] + w10 * pixels[a10] + w01 * pixels[a01] + w11 * pixels[a11]) / sum;
          out[to + 1] = (w00 * pixels[a00 + 1] + w10 * pixels[a10 + 1] + w01 * pixels[a01 + 1] + w11 * pixels[a11 + 1]) / sum;
          out[to + 2] = (w00 * pixels[a00 + 2] + w10 * pixels[a10 + 2] + w01 * pixels[a01 + 2] + w11 * pixels[a11 + 2]) / sum;
          out[to + 3] = sum;
        }
      }
    };
    const destX = (i) => (mesh[i * 2] - left) * over;
    const destY = (i) => (mesh[i * 2 + 1] - top) * over;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i00 = r * (cols + 1) + c;
        const i10 = i00 + 1;
        const i01 = i00 + cols + 1;
        const i11 = i01 + 1;
        const s0 = (c / cols) * sw;
        const s1 = ((c + 1) / cols) * sw;
        const t0 = (r / rows) * sh;
        const t1 = ((r + 1) / rows) * sh;
        triangle(destX(i00), destY(i00), s0, t0, destX(i10), destY(i10), s1, t0, destX(i11), destY(i11), s1, t1);
        triangle(destX(i00), destY(i00), s0, t0, destX(i11), destY(i11), s1, t1, destX(i01), destY(i01), s0, t1);
      }
    }
    const canvas = newCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (quick) {
      // The anti-aliasing on the pixels before they're put down: no reading them back
      const table = antiAliasTable(antiAlias);
      for (let i = 3; i < out.length; i += 4) out[i] = table[out[i]];
      ctx.putImageData(big, 0, 0);
      return { canvas, x: left, y: top, quick: true };
    }
    if (over === 1) ctx.putImageData(big, 0, 0);
    else {
      const large = newCanvas(W, H);
      large.getContext("2d").putImageData(big, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(large, 0, 0, width, height);
    }
    applyAntiAlias(canvas, ctx, antiAlias);
    return { canvas, x: left, y: top };
  };

  // A surface being dragged asks for a new picture at every step: the second one on is drawn
  // quickly, and the one the drag stops on is drawn again finely a moment later, in its place
  const WARP_STEP_GAP = 250;
  const WARP_SETTLE = 120;
  let warpLast = null;
  let warpRefine = 0;
  // A text with effects draws two pictures at each step (with its stroke, its letters alone):
  // the latest quick one of each is drawn again, and of a plain text only its latest one
  let warpPending = [];
  const warpQuickly = (forLayout, key) => {
    const now = Date.now();
    const quick = Boolean(warpLast && warpLast.forLayout === forLayout && warpLast.key !== key && now - warpLast.time < WARP_STEP_GAP);
    warpLast = { forLayout, key, time: now };
    return quick;
  };
  const refineWarpLater = (layer, doc, relative, stroke, antiAlias, forLayout, key, variant) => {
    clearTimeout(warpRefine);
    warpPending = warpPending.filter((item) => item.forLayout === forLayout && item.variant !== variant);
    warpPending.push({ layer, doc, relative, stroke, antiAlias, forLayout, key, variant });
    warpRefine = setTimeout(() => {
      warpRefine = 0;
      const pending = warpPending;
      warpPending = [];
      let drawn = null;
      pending.forEach(({ layer, doc, relative, stroke, antiAlias, forLayout, key }) => {
        const shown = forLayout.get(key);
        if (!shown || !shown.quick) return;
        keepText(forLayout, key, warpedBitmap(layer, doc, relative, stroke, antiAlias));
        if (app.doc === doc) drawn = doc;
      });
      if (drawn) emit("render");
    }, WARP_SETTLE);
  };

  // A drag draws hundreds of sizes of a text: only the latest bitmaps stay, whatever their number
  const TEXT_BUDGET = 128 * 1024 * 1024;
  const textKept = [];
  let textBytes = 0;
  const keepText = (forLayout, key, entry) => {
    forLayout.set(key, entry);
    const bytes = entry.canvas.width * entry.canvas.height * 4;
    textKept.push({ forLayout, key, entry, bytes });
    textBytes += bytes;
    while (textBytes > TEXT_BUDGET && textKept.length > 1) {
      const oldest = textKept.shift();
      textBytes -= oldest.bytes;
      if (oldest.forLayout.get(oldest.key) === oldest.entry) oldest.forLayout.delete(oldest.key);
    }
  };

  const mixedTexts = new WeakMap();
  const textVisual = (layer, doc) => {
    if (layer.raster) return { canvas: layer.raster.display || layer.raster.bitmap, x: layer.raster.displayLeft !== undefined ? layer.raster.left + layer.raster.displayLeft : layer.raster.left, y: layer.raster.displayTop !== undefined ? layer.raster.top + layer.raster.displayTop : layer.raster.top };
    // Fill between 0 and 100 %: the hollow text, then its letters at that much. Mixed after
    // the anti-aliasing, which would bend a faded edge.
    const amount = fillOf(layer);
    if (amount > 0 && amount < 1) {
      const hollow = textVisual(Object.assign({}, layer, { knockout: true, fill: undefined }), doc);
      const solid = textVisual(Object.assign({}, layer, { knockout: false, fill: undefined, stroke: null }), doc);
      const kept = mixedTexts.get(solid.canvas);
      if (kept && kept.hollow === hollow.canvas && kept.amount === amount && kept.dx === solid.x - hollow.x && kept.dy === solid.y - hollow.y) return { canvas: kept.canvas, x: Math.min(hollow.x, solid.x), y: Math.min(hollow.y, solid.y) };
      const x = Math.min(hollow.x, solid.x);
      const y = Math.min(hollow.y, solid.y);
      const canvas = newCanvas(Math.max(hollow.x + hollow.canvas.width, solid.x + solid.canvas.width) - x, Math.max(hollow.y + hollow.canvas.height, solid.y + solid.canvas.height) - y);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(hollow.canvas, hollow.x - x, hollow.y - y);
      ctx.globalAlpha = amount;
      ctx.drawImage(solid.canvas, solid.x - x, solid.y - y);
      mixedTexts.set(solid.canvas, { hollow: hollow.canvas, amount, dx: solid.x - hollow.x, dy: solid.y - hollow.y, canvas });
      return { canvas, x, y };
    }
    const layout = layoutLayer(layer, doc);
    const relative = layout.relative;
    const stroke = layer.stroke && layer.stroke.enabled && layer.stroke.size > 0 ? layer.stroke : null;
    const antiAlias = layer.params.layerText.antiAlias || "antiAliasSmooth";
    // Hollow at Fill 0%, whether an SFX's (`knockout`) or set to 0
    const strokeKey = (stroke ? strokeKeyOf(stroke) : "") + "|" + antiAlias + (fillOf(layer) === 0 ? "|hollow" : "");
    let forLayout = textBitmaps.get(relative);
    if (!forLayout) {
      forLayout = new Map();
      textBitmaps.set(relative, forLayout);
    }
    if (layer.warp) {
      const warpKey = strokeKey + "|" + JSON.stringify(layer.warp);
      // A drag draws hundreds of these: only the latest ones are worth keeping
      if (!forLayout.has(warpKey) && forLayout.size > 6) forLayout.clear();
      if (!forLayout.has(warpKey)) {
        const quick = warpQuickly(forLayout, warpKey);
        keepText(forLayout, warpKey, warpedBitmap(layer, doc, relative, stroke, antiAlias, quick));
        if (quick) refineWarpLater(layer, doc, relative, stroke, antiAlias, forLayout, warpKey, strokeKey);
      }
      return forLayout.get(warpKey);
    }
    const spin = spinOf(layer);
    const entryKey = spin ? strokeKey + "|" + spin.join(",") : strokeKey;
    let entry = forLayout.get(entryKey);
    if (!entry) {
      let largest = 0;
      relative.lines.forEach((line) => line.m.placed.forEach((item) => { largest = Math.max(largest, item.size); }));
      const pad = Math.ceil(6 + largest * 0.2 + strokeReach(stroke) * 1.5);
      const b = relative.box;
      if (spin) {
        const { minX, minY, maxX, maxY } = spunBounds({ left: b.left - pad, top: b.top - pad, right: b.right + pad, bottom: b.bottom + pad }, spin);
        const canvas = newCanvas(Math.ceil(maxX - minX), Math.ceil(maxY - minY));
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const x = Math.floor(minX);
        const y = Math.floor(minY);
        const k = outlineScale(relative.lines, Math.min(Math.hypot(spin[0], spin[1]), Math.hypot(spin[2], spin[3])));
        drawFromOutlines(canvas, ctx, [spin[0], spin[1], spin[2], spin[3], -x, -y], k, (g) => drawLines(g, relative.lines, stroke, layer));
        applyAntiAlias(canvas, ctx, antiAlias);
        entry = { canvas, x, y };
      } else {
        // On whole pixels, as the turned text above: a picture laid between two pixels is
        // resampled, which blurs every letter by half a pixel
        const x = Math.floor(b.left - pad);
        const y = Math.floor(b.top - pad);
        const canvas = newCanvas(Math.ceil(b.right + pad) - x, Math.ceil(b.bottom + pad) - y);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        drawFromOutlines(canvas, ctx, [1, 0, 0, 1, -x, -y], outlineScale(relative.lines, 1), (g) => drawLines(g, relative.lines, stroke, layer));
        applyAntiAlias(canvas, ctx, antiAlias);
        entry = { canvas, x, y };
      }
      keepText(forLayout, entryKey, entry);
    }
    return { canvas: entry.canvas, x: Math.round(layout.anchor[0]) + entry.x, y: Math.round(layout.anchor[1]) + entry.y };
  };

  /* ============================ layer effects ============================ */

  // A text's layer style as Photoshop draws it (see FX_DEFAULTS). Under the layer, each in its
  // own blend mode: Drop Shadow, then Outer Glow, then the stroke and the letters at their
  // Fill. On the letters only, each in its own blend mode: Gradient Overlay, Colour Overlay,
  // Inner Glow, Inner Shadow. Fill fades the letters, never the effects; the layer's opacity
  // fades everything. Every effect is worked out from how much of each pixel the letters
  // cover, without their stroke, colour coming last. The maths follow photocraft's (an open
  // editor whose effects were fitted against Photoshop's own files): spread and choke grow
  // the shape, the size blurs it with two box blurs, which match Photoshop better than a
  // Gaussian, and a glow's range is Photoshop's 50%.
  const FX_MAX_SIZE = 250;
  const FX_MAX_BLUR = 512;
  const FX_MAX_DISTANCE = 2000;
  const FX_INSIDE = ["gradientOverlay", "colorOverlay", "innerGlow", "innerShadow"];
  const fxNumber = (value, low, high, fallback) => (Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback);
  // An effect that shows: on, and above 0%
  const fxShown = (effect) => Boolean(effect) && effect.enabled !== false && fxNumber(effect.opacity, 0, 100, 100) > 0;
  const fxBlendOf = (effect) => BLENDS[effect.blend] || "source-over";
  // A shadow or a glow drawn around the letters
  const outerEffectsOn = (layer) => Boolean(layer.kind === "text" && layer.effects && (fxShown(layer.effects.dropShadow) || fxShown(layer.effects.outerGlow)));
  // The effects that go on the letters only, kept as one object per layer style
  const insideKept = new WeakMap();
  const insideEffects = (effects) => {
    if (!effects) return effects;
    if (insideKept.has(effects)) return insideKept.get(effects);
    const out = {};
    FX_INSIDE.forEach((name) => { if (effects[name]) out[name] = effects[name]; });
    const kept = Object.keys(out).length ? out : undefined;
    insideKept.set(effects, kept);
    return kept;
  };
  const fxKeys = new WeakMap();
  const fxKeyOf = (effects) => {
    let key = fxKeys.get(effects);
    if (key === undefined) {
      key = JSON.stringify(effects);
      fxKeys.set(effects, key);
    }
    return key;
  };
  // Where the light comes from, as Photoshop's angle: at 120° the shadow falls right and down
  const fxOffset = (effect) => {
    const angle = (fxNumber(effect.angle, -36000, 36000, 120) * Math.PI) / 180;
    const distance = fxNumber(effect.distance, 0, FX_MAX_DISTANCE, 0);
    // Halves round away from 0, as Photoshop's: cos 120° × 5 is 2.4999… in floating point, and
    // is 3 there; cos 60° × 5 is -3
    const snap = (value) => {
      const even = Math.round(value * 1e6) / 1e6;
      return Math.sign(even) * Math.round(Math.abs(even));
    };
    return [snap(-Math.cos(angle) * distance), snap(Math.sin(angle) * distance)];
  };
  const fxSize = (effect) => fxNumber(effect.size, 0, FX_MAX_SIZE, 0);

  // `from` moved by dx, dy into `to`, W × H. What comes in from past the edge is empty, or, for
  // the inner effects (`invert`: they start from where the letters aren't), full.
  const fxShift = (from, to, W, H, dx, dy, invert) => {
    const outside = invert ? 1 : 0;
    const x0 = Math.min(W, Math.max(0, dx));
    const x1 = Math.max(x0, Math.min(W, W + dx));
    for (let y = 0; y < H; y++) {
      const row = y * W;
      const sy = y - dy;
      if (sy < 0 || sy >= H || x1 <= x0) {
        to.fill(outside, row, row + W);
        continue;
      }
      to.fill(outside, row, row + x0);
      to.fill(outside, row + x1, row + W);
      const at = sy * W - dx;
      if (invert) for (let x = x0; x < x1; x++) to[row + x] = 1 - from[at + x];
      else to.set(from.subarray(at + x0, at + x1), row + x0);
    }
  };

  // Spread and choke: the shape grown by r pixels, from how far each pixel's centre is from its
  // edge (a 5 × 5 chamfer: steps of 1, √2 and √5). A pixel the shape covers by `a` has its edge
  // 0.5 - a from its centre, as Photoshop measures it: the grown edge keeps the letters' own
  // anti-aliasing instead of growing every faint pixel into a whole one.
  const FX_R2 = Math.SQRT2;
  const FX_R5 = Math.sqrt(5);
  const fxGrow = (map, W, H, r, dist) => {
    if (r <= 0) return;
    for (let i = 0; i < map.length; i++) dist[i] = map[i] > 0 ? 0.5 - map[i] : 1e6;
    for (let y = 0; y < H; y++) {
      for (let x = 0, i = y * W; x < W; x++, i++) {
        let d = dist[i];
        if (d <= 0) continue;
        let n;
        if (x > 0 && (n = dist[i - 1] + 1) < d) d = n;
        if (y > 0) {
          const up = i - W;
          if ((n = dist[up] + 1) < d) d = n;
          if (x > 0 && (n = dist[up - 1] + FX_R2) < d) d = n;
          if (x < W - 1 && (n = dist[up + 1] + FX_R2) < d) d = n;
          if (x > 1 && (n = dist[up - 2] + FX_R5) < d) d = n;
          if (x < W - 2 && (n = dist[up + 2] + FX_R5) < d) d = n;
          if (y > 1) {
            if (x > 0 && (n = dist[up - W - 1] + FX_R5) < d) d = n;
            if (x < W - 1 && (n = dist[up - W + 1] + FX_R5) < d) d = n;
          }
        }
        dist[i] = d;
      }
    }
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1, i = y * W + W - 1; x >= 0; x--, i--) {
        let d = dist[i];
        if (d <= 0) continue;
        let n;
        if (x < W - 1 && (n = dist[i + 1] + 1) < d) d = n;
        if (y < H - 1) {
          const down = i + W;
          if ((n = dist[down] + 1) < d) d = n;
          if (x < W - 1 && (n = dist[down + 1] + FX_R2) < d) d = n;
          if (x > 0 && (n = dist[down - 1] + FX_R2) < d) d = n;
          if (x < W - 2 && (n = dist[down + 2] + FX_R5) < d) d = n;
          if (x > 1 && (n = dist[down - 2] + FX_R5) < d) d = n;
          if (y < H - 2) {
            if (x < W - 1 && (n = dist[down + W + 1] + FX_R5) < d) d = n;
            if (x > 0 && (n = dist[down + W - 1] + FX_R5) < d) d = n;
          }
        }
        dist[i] = d;
      }
    }
    for (let i = 0; i < map.length; i++) {
      const v = r + 0.5 - dist[i];
      map[i] = v <= 0 ? 0 : v >= 1 ? 1 : v;
    }
  };

  // One box blur of width w along a line of n values, from `src` into `dst`. A width that isn't
  // whole counts the two outermost pixels for the fraction. The ends carry on past the line.
  const fxBox = (src, dst, n, w) => {
    const h = Math.floor((w - 1) / 2);
    const f = (w - 1 - 2 * h) / 2;
    const scale = 1 / w;
    const last = n - 1;
    let sum = 0;
    for (let i = -h; i <= h; i++) sum += src[i < 0 ? 0 : i > last ? last : i];
    for (let x = 0; x < n; x++) {
      const l = x - h - 1;
      const r = x + h + 1;
      const vr = src[r > last ? last : r];
      dst[x] = (sum + f * (src[l < 0 ? 0 : l] + vr)) * scale;
      const gone = x - h;
      sum += vr - src[gone < 0 ? 0 : gone > last ? last : gone];
    }
  };
  // The size: two box blurs one after the other (a tent), across then down
  const fxBlur = (map, W, H, w) => {
    if (!(w > 1)) return;
    const n = Math.max(W, H);
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      a.set(map.subarray(row, row + W));
      fxBox(a, b, W, w);
      fxBox(b, a, W, w);
      map.set(a.subarray(0, W), row);
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0, i = x; y < H; y++, i += W) a[y] = map[i];
      fxBox(a, b, H, w);
      fxBox(b, a, H, w);
      for (let y = 0, i = x; y < H; y++, i += W) map[i] = a[y];
    }
  };

  // A colour at `a` (0 to 1) over a pixel of an ImageData, as Normal lays it
  const fxOver = (px, o, r, g, b, a) => {
    const below = px[o + 3] / 255;
    if (below <= 0) {
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = a * 255;
      return;
    }
    const keep = below * (1 - a);
    const out = a + keep;
    px[o] = (r * a + px[o] * keep) / out;
    px[o + 1] = (g * a + px[o + 1] * keep) / out;
    px[o + 2] = (b * a + px[o + 2] * keep) / out;
    px[o + 3] = out * 255;
  };
  // An effect's colour over `px` (w × h), as much as `map` says (read from ox, oy in a map W
  // wide; no map: everywhere) times the opacity. `only`: the letters, for an effect that stays
  // on them, painted where they touch a pixel at all (how much they cover comes after).
  // `ranged`: a glow, at full strength from half of it on.
  const fxPaint = (px, w, h, map, W, ox, oy, only, ranged, opacity, color) => {
    const r = fxNumber(color && color.r, 0, 255, 0);
    const g = fxNumber(color && color.g, 0, 255, 0);
    const b = fxNumber(color && color.b, 0, 255, 0);
    for (let y = 0; y < h; y++) {
      let m = (y + oy) * W + ox;
      let o = y * w * 4;
      for (let x = 0; x < w; x++, m++, o += 4) {
        if (only && !(only[m] > 0)) continue;
        let v = map ? map[m] : 1;
        if (ranged) v = v >= 0.5 ? 1 : v * 2;
        v *= opacity;
        if (v > 0.0005) fxOver(px, o, r, g, b, v > 1 ? 1 : v);
      }
    }
  };
  // Gradient Overlay over the letters (w × h, at ox, oy in the map), spanning their own bounds
  const fxGradient = (px, w, h, shape, W, ox, oy, effect, box) => {
    const stops = Array.isArray(effect.stops) && effect.stops.length ? effect.stops : FX_DEFAULTS.gradientOverlay.stops;
    const table = gradientTable(stops, "classic");
    const opacity = fxNumber(effect.opacity, 0, 100, 100) / 100;
    const scale = fxNumber(effect.scale, 10, 150, 100) / 100;
    const turn = (fxNumber(effect.angle, -36000, 36000, 90) * Math.PI) / 180;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const bw = box.right - box.left;
    const bh = box.bottom - box.top;
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    // Linear and reflected: as long as the line through the centre at that angle inside the
    // bounds. Radial and diamond: half the bounds' extent along that angle.
    const chord = Math.max(1, Math.min(Math.abs(c) > 1e-6 ? bw / Math.abs(c) : Infinity, Math.abs(s) > 1e-6 ? bh / Math.abs(s) : Infinity) * scale);
    const half = Math.max(0.5, (Math.hypot(c * bw, s * bh) * scale) / 2);
    const style = effect.style || "linear";
    const reverse = Boolean(effect.reverse);
    for (let y = 0; y < h; y++) {
      let m = (y + oy) * W + ox;
      let o = y * w * 4;
      const dy = y + 0.5 - cy;
      for (let x = 0; x < w; x++, m++, o += 4) {
        if (!(shape[m] > 0)) continue;
        const v = opacity;
        const dx = x + 0.5 - cx;
        const along = dx * c - dy * s;
        let t;
        if (style === "radial") t = Math.hypot(dx, dy) / half;
        else if (style === "diamond") t = (Math.abs(along) + Math.abs(dx * s + dy * c)) / half;
        else if (style === "reflected") t = Math.abs(along / (chord / 2));
        else if (style === "angle") {
          t = (turn - Math.atan2(-dy, dx)) / (Math.PI * 2);
          t -= Math.floor(t);
        } else t = along / chord + 0.5;
        if (!(t > 0)) t = 0;
        else if (t > 1) t = 1;
        if (reverse) t = 1 - t;
        const i = Math.round(t * GRADIENT_STEPS) * 4;
        const a = v * table[i + 3];
        if (a > 0.0005) fxOver(px, o, table[i], table[i + 1], table[i + 2], a > 1 ? 1 : a);
      }
    }
  };

  // The effects' pictures for letters drawn in `letters`, with the layer as it shows (stroke,
  // letters at their Fill) in `base` at bx, by from them. One picture holding all when the
  // layer and what goes under it blend in Normal (the layer's opacity then fades them as one,
  // as in Photoshop); else the layer with its inner effects, and what goes under it apart, in
  // its own blend mode. Places are from the letters' top left. Null when there are no letters.
  const buildEffects = (effects, letters, base, bx, by, fill, normal) => {
    const sw = letters.width;
    const sh = letters.height;
    const alpha = letters.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
    const box = { left: sw, top: sh, right: 0, bottom: 0 };
    for (let y = 0, o = 3; y < sh; y++) {
      for (let x = 0; x < sw; x++, o += 4) {
        if (!alpha[o]) continue;
        if (x < box.left) box.left = x;
        if (x >= box.right) box.right = x + 1;
        if (y < box.top) box.top = y;
        if (y >= box.bottom) box.bottom = y + 1;
      }
    }
    if (box.right <= box.left) return null;
    const shown = (name) => (fxShown(effects[name]) ? effects[name] : null);
    const shadow = shown("dropShadow");
    const glow = shown("outerGlow");
    const innerShadow = shown("innerShadow");
    const innerGlow = shown("innerGlow");
    const overlay = shown("colorOverlay");
    const gradient = shown("gradientOverlay");
    // Room around the letters for what reaches past them
    const shadowAt = shadow ? fxOffset(shadow) : [0, 0];
    const innerAt = innerShadow ? fxOffset(innerShadow) : [0, 0];
    let mL = 0;
    let mR = 0;
    let mT = 0;
    let mB = 0;
    const room = (effect, dx, dy) => {
      const reach = Math.ceil(fxSize(effect)) + 2;
      mL = Math.max(mL, reach + Math.max(0, -dx));
      mR = Math.max(mR, reach + Math.max(0, dx));
      mT = Math.max(mT, reach + Math.max(0, -dy));
      mB = Math.max(mB, reach + Math.max(0, dy));
    };
    if (shadow) room(shadow, shadowAt[0], shadowAt[1]);
    if (glow) room(glow, 0, 0);
    if (innerShadow) room(innerShadow, 0, 0);
    if (innerGlow) room(innerGlow, 0, 0);
    const W = sw + mL + mR;
    const H = sh + mT + mB;
    const N = W * H;
    const shape = new Float32Array(N);
    for (let y = 0, o = 3; y < sh; y++) {
      for (let x = 0, m = (y + mT) * W + mL; x < sw; x++, m++, o += 4) shape[m] = alpha[o] / 255;
    }
    const work = shadow || glow || innerShadow || innerGlow ? new Float32Array(N) : null;
    let dist = null;
    // Shift, grow, blur: the effect's own shape in `work`
    const spread = (effect, amount, dx, dy, invert) => {
      const size = fxSize(effect);
      const s = fxNumber(amount, 0, 100, 0) / 100;
      fxShift(shape, work, W, H, dx, dy, invert);
      const grow = Math.round(size * s);
      if (grow > 0) {
        if (!dist) dist = new Float32Array(N);
        fxGrow(work, W, H, grow, dist);
      }
      fxBlur(work, W, H, Math.min(FX_MAX_BLUR, size - grow));
    };
    // Under the layer. The letters knock it out: in Normal, as much as they let the page
    // through; in another mode, entirely.
    const outside = [];
    const merged = !shadow || !glow || (fxBlendOf(shadow) === "source-over" && fxBlendOf(glow) === "source-over");
    const around = (effect, amount, dx, dy, ranged) => {
      spread(effect, amount, dx, dy, false);
      const keep = normal ? 1 - fill : 1;
      for (let i = 0; i < N; i++) {
        let v = work[i];
        if (ranged) v = v >= 0.5 ? 1 : v * 2;
        work[i] = v * (1 - shape[i] * keep);
      }
      if (!outside.length || !merged) outside.push({ image: new ImageData(W, H), blend: fxBlendOf(effect) });
      fxPaint(outside[outside.length - 1].image.data, W, H, work, W, 0, 0, null, false, fxNumber(effect.opacity, 0, 100, 100) / 100, effect.color);
    };
    if (shadow) around(shadow, shadow.spread, shadowAt[0], shadowAt[1], false);
    if (glow) around(glow, glow.spread, 0, 0, true);
    // On the letters, bottom to top; those in Normal one after the other on the same picture
    const inside = [];
    const onLetters = (effect) => {
      const blend = fxBlendOf(effect);
      const last = inside[inside.length - 1];
      if (last && last.blend === "source-over" && blend === "source-over") return last.image.data;
      const image = new ImageData(sw, sh);
      inside.push({ image, blend });
      return image.data;
    };
    if (gradient) fxGradient(onLetters(gradient), sw, sh, shape, W, mL, mT, gradient, box);
    if (overlay) fxPaint(onLetters(overlay), sw, sh, null, W, mL, mT, shape, false, fxNumber(overlay.opacity, 0, 100, 100) / 100, overlay.color);
    if (innerGlow) {
      spread(innerGlow, innerGlow.choke, 0, 0, true);
      fxPaint(onLetters(innerGlow), sw, sh, work, W, mL, mT, shape, true, fxNumber(innerGlow.opacity, 0, 100, 100) / 100, innerGlow.color);
    }
    if (innerShadow) {
      spread(innerShadow, innerShadow.choke, innerAt[0], innerAt[1], true);
      fxPaint(onLetters(innerShadow), sw, sh, work, W, mL, mT, shape, false, fxNumber(innerShadow.opacity, 0, 100, 100) / 100, innerShadow.color);
    }
    // One picture, or the layer and what goes under it
    const together = normal && outside.length > 0 && outside.every((item) => item.blend === "source-over");
    let left = Math.min(0, bx);
    let top = Math.min(0, by);
    let right = Math.max(sw, bx + base.width);
    let bottom = Math.max(sh, by + base.height);
    if (together) {
      left = Math.min(left, -mL);
      top = Math.min(top, -mT);
      right = Math.max(right, sw + mR);
      bottom = Math.max(bottom, sh + mB);
    }
    const canvas = newCanvas(right - left, bottom - top);
    const ctx = canvas.getContext("2d");
    if (together) outside.forEach(({ image }) => {
      const picture = newCanvas(W, H);
      picture.getContext("2d").putImageData(image, 0, 0);
      ctx.drawImage(picture, -mL - left, -mT - top);
    });
    ctx.drawImage(base, bx - left, by - top);
    if (inside.length) {
      // The inner effects as Photoshop lays them: on the letters' own colours at their Fill,
      // as if each pixel the letters touch were whole, then cut to how much they cover it. A
      // pixel half covered gets half of the result, not half of each effect over half of the
      // letters, which would leave its edge thicker than the letters.
      const own = new ImageData(sw, sh);
      const o4 = own.data;
      for (let o = 0; o < o4.length; o += 4) {
        if (!alpha[o + 3]) continue;
        o4[o] = alpha[o];
        o4[o + 1] = alpha[o + 1];
        o4[o + 2] = alpha[o + 2];
        o4[o + 3] = fill * 255;
      }
      const letters = newCanvas(sw, sh);
      const l = letters.getContext("2d", { willReadFrequently: true });
      l.putImageData(own, 0, 0);
      const picture = newCanvas(sw, sh);
      const p = picture.getContext("2d");
      inside.forEach(({ image, blend }) => {
        p.putImageData(image, 0, 0);
        l.globalCompositeOperation = blend;
        l.drawImage(picture, 0, 0);
      });
      const done = l.getImageData(0, 0, sw, sh).data;
      // In place of the letters: what is under them (their stroke, their shadow) stays
      const region = ctx.getImageData(-left, -top, sw, sh);
      const px = region.data;
      for (let o = 0; o < px.length; o += 4) {
        const a = alpha[o + 3] / 255;
        if (!a) continue;
        const lettersA = a * fill;
        const shownA = px[o + 3] / 255;
        let belowA = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        if (lettersA < 0.999) {
          const k = 1 / (1 - lettersA);
          belowA = Math.max(0, (shownA - lettersA) * k);
          r = Math.max(0, (px[o] * shownA - alpha[o] * lettersA) * k);
          g = Math.max(0, (px[o + 1] * shownA - alpha[o + 1] * lettersA) * k);
          b = Math.max(0, (px[o + 2] * shownA - alpha[o + 2] * lettersA) * k);
        }
        const topA = (done[o + 3] / 255) * a;
        const outA = topA + belowA * (1 - topA);
        if (outA <= 0) {
          px[o + 3] = 0;
          continue;
        }
        px[o] = (done[o] * topA + r * (1 - topA)) / outA;
        px[o + 1] = (done[o + 1] * topA + g * (1 - topA)) / outA;
        px[o + 2] = (done[o + 2] * topA + b * (1 - topA)) / outA;
        px[o + 3] = outA * 255;
      }
      ctx.putImageData(region, -left, -top);
    }
    const under = together ? null : outside.map(({ image, blend }) => {
      const picture = newCanvas(W, H);
      picture.getContext("2d").putImageData(image, 0, 0);
      return { canvas: picture, dx: -mL, dy: -mT, blend };
    });
    return { canvas, dx: left, dy: top, under: under && under.length ? under : null };
  };

  // A text with its effects. Built once for its letters and settings: moving it, its opacity,
  // scrolling and zooming build nothing again. Kept by letters, then by layer: copies of a text
  // share their letters, each with its own effects, and identical ones share the picture.
  const fxBuilt = new WeakMap();
  const FX_KEPT_LAYERS = 64;
  const styledTextVisual = (layer, doc) => {
    const base = textVisual(layer, doc);
    const effects = layer.effects;
    if (!base || !FX_ORDER.some((name) => fxShown(effects[name]))) return base;
    const shape = textVisual(Object.assign(withoutStroke(layer), { fill: undefined, knockout: false, effects: undefined }), doc);
    if (!shape || !shape.canvas.width || !shape.canvas.height) return base;
    const fill = fillOf(layer);
    // The blend mode the list shows while hovered: the picture it gives once picked
    const blend = doc.blendPreview && doc.blendPreview.ids.has(layer.id) ? doc.blendPreview.blend : layer.blend;
    const normal = (BLENDS[blend] || "source-over") === "source-over";
    const bx = base.x - shape.x;
    const by = base.y - shape.y;
    const key = [fxKeyOf(effects), fill, normal, identity(base.canvas), bx, by].join("|");
    let kept = fxBuilt.get(shape.canvas);
    if (!kept) {
      kept = new Map();
      fxBuilt.set(shape.canvas, kept);
    }
    // A slider dragged builds one at each step: a layer keeps only its latest
    let entry = kept.get(layer.id);
    if (!entry || entry.key !== key) {
      entry = null;
      kept.forEach((other) => { if (!entry && other.key === key) entry = other; });
      if (!entry) entry = { key, built: buildEffects(effects, shape.canvas, base.canvas, bx, by, fill, normal) };
      kept.delete(layer.id);
      kept.set(layer.id, entry);
      if (kept.size > FX_KEPT_LAYERS) kept.delete(kept.keys().next().value);
    }
    const built = entry.built;
    if (!built) return base;
    const visual = { canvas: built.canvas, x: shape.x + built.dx, y: shape.y + built.dy };
    if (built.under) visual.under = built.under.map((item) => ({ canvas: item.canvas, x: shape.x + item.dx, y: shape.y + item.dy, blend: item.blend }));
    return visual;
  };

  // What a visual covers on the page, what goes under it included
  const visualRect = (visual) => {
    let left = visual.x;
    let top = visual.y;
    let right = visual.x + visual.canvas.width;
    let bottom = visual.y + visual.canvas.height;
    (visual.under || NONE).forEach((item) => {
      left = Math.min(left, item.x);
      top = Math.min(top, item.y);
      right = Math.max(right, item.x + item.canvas.width);
      bottom = Math.max(bottom, item.y + item.canvas.height);
    });
    return { left, top, right, bottom };
  };
  // What goes under a layer (its shadow, its glow), each in its own blend mode, moved by ox, oy.
  // Faded with a half-transparent layer, it is cut where the layer is, so as not to show
  // through it.
  const underCuts = new WeakMap();
  const underCut = (item, visual) => {
    const dx = visual.x - item.x;
    const dy = visual.y - item.y;
    const kept = underCuts.get(item.canvas);
    if (kept && kept.main === visual.canvas && kept.dx === dx && kept.dy === dy) return kept.canvas;
    const canvas = newCanvas(item.canvas.width, item.canvas.height);
    const c = canvas.getContext("2d");
    c.drawImage(item.canvas, 0, 0);
    c.globalCompositeOperation = "destination-out";
    c.drawImage(visual.canvas, dx, dy);
    underCuts.set(item.canvas, { main: visual.canvas, dx, dy, canvas });
    return canvas;
  };
  // `clip`: for a clipped text, the base's shape ({ canvas, x, y }, where `target` has it), which
  // its shadow and glow stay inside, whatever their blend mode
  const confinedTo = (picture, x, y, clip) => {
    const canvas = newCanvas(picture.width, picture.height);
    const c = canvas.getContext("2d");
    c.drawImage(picture, 0, 0);
    c.globalCompositeOperation = "destination-in";
    c.drawImage(clip.canvas, clip.x - x, clip.y - y);
    return canvas;
  };
  const drawUnder = (target, visual, ox, oy, alpha, matrix, clip) => {
    target.save();
    if (matrix) {
      target.transform(...matrix);
      target.imageSmoothingQuality = "high";
    }
    target.globalAlpha = alpha;
    visual.under.forEach((item) => {
      const picture = alpha < 1 ? underCut(item, visual) : item.canvas;
      target.globalCompositeOperation = item.blend;
      target.drawImage(clip ? confinedTo(picture, item.x + ox, item.y + oy, clip) : picture, item.x + ox, item.y + oy);
    });
    target.restore();
  };
  // One picture of a visual, what goes under it included, as a pixel layer keeps it
  const flatVisual = (visual) => {
    if (!visual || !visual.under) return visual;
    const { left, top, right, bottom } = visualRect(visual);
    const canvas = newCanvas(right - left, bottom - top);
    const ctx = canvas.getContext("2d");
    drawUnder(ctx, visual, -left, -top, 1);
    ctx.drawImage(visual.canvas, visual.x - left, visual.y - top);
    return { canvas, x: left, y: top };
  };

  /* ================================ masks ================================ */

  // A layer mask shows a layer where it is white and hides it where it is black, as in
  // Photoshop. It is kept as the file has it: grey in `canvas` (or no picture at all), with its
  // top left at `left`, `top` and `defaultColor` all round it, `disabled`, `userMaskDensity`
  // and `userMaskFeather`. What is painted on it since is in `paint`, in its own coordinates,
  // so that moving it moves the strokes too. `unlinked`: it stays put when the layer moves.
  // A vector mask (`layer.vectorMask`) is Photoshop's own, paths in page pixels.
  const maskOn = (layer) => Boolean(layer && layer.mask && !layer.mask.disabled);
  const vectorOn = (layer) => Boolean(layer && layer.vectorMask && !layer.vectorMask.disable && Array.isArray(layer.vectorMask.paths));
  // A pixel layer carries its masks along when it moves by dx, dy
  const maskShift = (layer) => (layer.kind === "raster" ? [layer.dx || 0, layer.dy || 0] : [0, 0]);
  const maskOrigin = (layer, mask = layer.mask) => {
    const [sx, sy] = maskShift(layer);
    return [(mask.left || 0) + sx, (mask.top || 0) + sy];
  };
  // A grey as Photoshop paints it on a mask, from a colour
  const grayOf = (color) => {
    if (!color) return 0;
    const r = color.red !== undefined ? color.red : color.r;
    const g = color.green !== undefined ? color.green : color.g;
    const b = color.blue !== undefined ? color.blue : color.b;
    return Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
  };

  // A stroke or a fill on a mask, held as alpha: where it passes, the alpha goes towards the
  // grey it paints, as far as the brush covers. Nothing is ever just erased from a mask.
  const maskDrawOp = (ctx, op, points) => {
    let shape = null;
    let x = 0;
    let y = 0;
    if (op.t === "stroke") {
      if (!points) {
        op.points.forEach((point, index) => maskDrawOp(ctx, op, index ? [op.points[index - 1], point] : [point]));
        return;
      }
      const box = strokeBox(points, op.size);
      shape = newCanvas(box.width, box.height);
      const c = shape.getContext("2d");
      c.translate(-box.left, -box.top);
      c.strokeStyle = "#000";
      paintStroke(c, op, points);
      if (op.clip) {
        c.globalCompositeOperation = "destination-in";
        if (op.clip.canvas) c.drawImage(op.clip.canvas, op.clip.x, op.clip.y);
        else c.fillRect(op.clip.x, op.clip.y, op.clip.width, op.clip.height);
      }
      x = box.left;
      y = box.top;
    } else if (op.t === "gradient") {
      // As far as it covers, the mask goes towards the gradient's grey
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(gradientShape(op, op.cover), op.x, op.y);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(gradientShape(op, op.canvas), op.x, op.y);
      ctx.restore();
      return;
    } else if (op.t === "fill" && op.clip && op.clip.canvas) {
      shape = op.clip.canvas;
      x = op.clip.x;
      y = op.clip.y;
    } else if (op.t === "fill") {
      ctx.save();
      const r = op.clip;
      const rect = r ? [r.x, r.y, r.width, r.height] : null;
      if (!rect) ctx.setTransform(1, 0, 0, 1, 0, 0);
      const area = rect || [0, 0, ctx.canvas.width, ctx.canvas.height];
      ctx.clearRect(...area);
      ctx.globalAlpha = op.gray / 255;
      ctx.fillStyle = "#000";
      ctx.fillRect(...area);
      ctx.restore();
      return;
    } else return;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(shape, x, y);
    if (op.gray > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = op.gray / 255;
      ctx.drawImage(shape, x, y);
    }
    ctx.restore();
  };

  // Something that holds a mask: a layer, or the Quick Mask (a page's own, at 0, 0)
  const maskHolder = (doc, target, layerId) => {
    if (target === "quick") return doc.state.quickMask ? { id: `quick:${doc.id}`, kind: "quick", mask: doc.state.quickMask } : null;
    const layer = doc.state.layers.find((item) => item.id === layerId);
    return layer && layer.mask ? layer : null;
  };

  // A painted mask keeps one canvas of alpha, over the page and its picture, and only draws
  // what is new, as a painted layer does
  const maskCache = new Map();
  const maskEntry = (holder, doc) => {
    const mask = holder.mask;
    const paint = mask.paint || NONE;
    const [ox, oy] = maskOrigin(holder);
    const base = mask.canvas || null;
    let entry = maskCache.get(holder.id);
    const x0 = Math.floor(Math.min(-ox, base ? 0 : Infinity));
    const y0 = Math.floor(Math.min(-oy, base ? 0 : Infinity));
    const x1 = Math.ceil(Math.max(doc.width - ox, base ? base.width : -Infinity));
    const y1 = Math.ceil(Math.max(doc.height - oy, base ? base.height : -Infinity));
    const covers = entry && entry.x0 <= x0 && entry.y0 <= y0 && entry.x1 >= x1 && entry.y1 >= y1;
    const usable = covers && entry.docId === doc.id && entry.base === base && entry.defaultColor === Boolean(mask.defaultColor) && entry.paint.length <= paint.length && entry.paint.every((op, i) => op === paint[i]);
    if (!usable) {
      const canvas = newCanvas(x1 - x0, y1 - y0);
      const ctx = canvas.getContext("2d");
      if (mask.defaultColor) ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate(-x0, -y0);
      if (base) {
        ctx.clearRect(0, 0, base.width, base.height);
        ctx.drawImage(maskAlpha(mask), 0, 0);
      }
      entry = { canvas, ctx, x0, y0, x1, y1, base, defaultColor: Boolean(mask.defaultColor), paint: NONE, version: 0, docId: doc.id };
      maskCache.set(holder.id, entry);
      if (maskCache.size > 24) maskCache.delete(maskCache.keys().next().value);
    }
    if (entry.paint.length < paint.length) {
      for (let i = entry.paint.length; i < paint.length; i++) maskDrawOp(entry.ctx, paint[i]);
      entry.paint = paint;
      entry.version++;
    }
    return entry;
  };

  // A Gaussian blur of `sigma` px on an alpha picture: the canvas's own filter where the
  // browser has one, three box blurs otherwise
  const canFilter = (() => {
    try {
      return typeof document.createElement("canvas").getContext("2d").filter === "string";
    } catch (error) {
      return false;
    }
  })();
  const blurAlpha = (canvas, sigma) => {
    const out = newCanvas(canvas.width, canvas.height);
    const ctx = out.getContext("2d", { willReadFrequently: !canFilter });
    if (canFilter) {
      ctx.filter = `blur(${sigma}px)`;
      ctx.drawImage(canvas, 0, 0);
      ctx.filter = "none";
      return out;
    }
    ctx.drawImage(canvas, 0, 0);
    const w = out.width;
    const h = out.height;
    const image = ctx.getImageData(0, 0, w, h);
    let a = new Float32Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = image.data[i * 4 + 3];
    let b = new Float32Array(w * h);
    const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
    const pass = (from, to, horizontal) => {
      const n = horizontal ? w : h;
      const lines = horizontal ? h : w;
      for (let line = 0; line < lines; line++) {
        const at = (k) => (horizontal ? line * w + k : k * w + line);
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += from[at(Math.max(0, Math.min(n - 1, k)))];
        for (let k = 0; k < n; k++) {
          to[at(k)] = sum / (2 * r + 1);
          sum += from[at(Math.min(n - 1, k + r + 1))] - from[at(Math.max(0, k - r))];
        }
      }
    };
    for (let i = 0; i < 3; i++) {
      pass(a, b, true);
      pass(b, a, false);
    }
    for (let i = 0; i < a.length; i++) {
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = 0;
      image.data[i * 4 + 3] = Math.round(a[i]);
    }
    ctx.putImageData(image, 0, 0);
    b = null;
    a = null;
    return out;
  };

  // Density and Feather (Properties > Masks): black lets 100 - density % through, and the
  // edges blur by the feather's width. `outside` is what the mask is all round its picture.
  const softened = new WeakMap();
  const softenedMask = (picture, density, feather) => {
    if (density >= 1 && !(feather > 0)) return picture;
    const key = [picture.version || 0, picture.x, picture.y, picture.outside, density, feather].join(",");
    const kept = softened.get(picture.canvas || softened);
    if (kept && kept.key === key) return kept.picture;
    const outside = 1 - density * (1 - picture.outside);
    let result;
    if (!picture.canvas) result = { canvas: null, x: 0, y: 0, outside };
    else {
      const pad = feather > 0 ? Math.ceil(feather * 3) + 2 : 0;
      const canvas = newCanvas(picture.canvas.width + pad * 2, picture.canvas.height + pad * 2);
      const c = canvas.getContext("2d");
      c.globalAlpha = 1 - density;
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.globalAlpha = 1;
      if (pad) {
        // The edge of the picture blurs into what is round it, not into nothing
        const ring = newCanvas(canvas.width, canvas.height);
        const r = ring.getContext("2d");
        r.globalAlpha = picture.outside;
        r.fillRect(0, 0, ring.width, ring.height);
        r.globalAlpha = 1;
        r.clearRect(pad, pad, picture.canvas.width, picture.canvas.height);
        r.drawImage(picture.canvas, pad, pad);
        c.drawImage(ring, 0, 0);
      } else c.drawImage(picture.canvas, 0, 0);
      result = { canvas: feather > 0 ? blurAlpha(canvas, feather) : canvas, x: picture.x - pad, y: picture.y - pad, outside };
    }
    softened.set(picture.canvas || softened, { key, picture: result });
    return result;
  };

  // A pixel mask as alpha on the page: { canvas, x, y, outside, version }
  const maskPicture = (holder, doc, raw) => {
    const mask = holder.mask;
    const [ox, oy] = maskOrigin(holder);
    const live = doc.liveStroke && doc.liveStroke.target && doc.liveStroke.holderId === holder.id;
    let picture;
    if ((mask.paint && mask.paint.length) || live) {
      const entry = maskEntry(holder, doc);
      picture = { canvas: entry.canvas, x: ox + entry.x0, y: oy + entry.y0, outside: mask.defaultColor ? 1 : 0, version: entry.version };
    } else if (mask.canvas && mask.canvas.width && mask.canvas.height) picture = { canvas: maskAlpha(mask), x: ox, y: oy, outside: mask.defaultColor ? 1 : 0, version: 0 };
    else picture = { canvas: null, x: 0, y: 0, outside: mask.defaultColor ? 1 : 0, version: 0 };
    if (raw) return picture;
    const density = mask.userMaskDensity === undefined ? 1 : mask.userMaskDensity;
    return softenedMask(picture, density, mask.userMaskFeather || 0);
  };

  // A vector mask's paths, each a Bézier outline. Components follow one another as Photoshop's
  // path operations: combine, subtract, intersect, exclude.
  const tracePaths = (target, paths, dx, dy) => {
    paths.forEach((path) => {
      const knots = path.knots || [];
      if (!knots.length) return;
      const point = (k, i) => [k.points[i] + dx, k.points[i + 1] + dy];
      target.moveTo(...point(knots[0], 2));
      for (let i = 1; i <= knots.length; i++) {
        if (i === knots.length && path.open) break;
        const a = knots[i - 1];
        const b = knots[i % knots.length];
        target.bezierCurveTo(...point(a, 4), ...point(b, 0), ...point(b, 2));
      }
      if (!path.open) target.closePath();
    });
  };
  const vectorComponents = (vm) => {
    const out = [];
    (vm.paths || []).forEach((path) => {
      if (path.operation || !out.length) out.push({ operation: path.operation || "combine", paths: [path] });
      else out[out.length - 1].paths.push(path);
    });
    return out;
  };
  const vectorBounds = (vm, dx, dy) => {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    (vm.paths || []).forEach((path) => (path.knots || []).forEach((knot) => {
      for (let i = 0; i < 6; i += 2) {
        left = Math.min(left, knot.points[i] + dx);
        right = Math.max(right, knot.points[i] + dx);
        top = Math.min(top, knot.points[i + 1] + dy);
        bottom = Math.max(bottom, knot.points[i + 1] + dy);
      }
    }));
    return left > right ? null : { left: Math.floor(left) - 2, top: Math.floor(top) - 2, right: Math.ceil(right) + 2, bottom: Math.ceil(bottom) + 2 };
  };
  const vectorPictures = new WeakMap();
  const vectorPicture = (layer) => {
    const vm = layer.vectorMask;
    const [dx, dy] = maskShift(layer);
    const kept = vectorPictures.get(vm);
    if (kept && kept.dx === dx && kept.dy === dy) return kept.picture;
    // What the paths make far from them: the page is all there at the start, or nothing
    let outside = vm.fillStartsWithAllPixels ? 1 : 0;
    const parts = vectorComponents(vm);
    parts.forEach(({ operation }) => { if (operation === "intersect") outside = 0; });
    const box = vectorBounds(vm, dx, dy);
    let picture;
    if (!box) picture = { canvas: null, x: 0, y: 0, outside: vm.invert ? 1 - outside : outside, version: 0 };
    else {
      const canvas = newCanvas(box.right - box.left, box.bottom - box.top);
      const c = canvas.getContext("2d");
      if (vm.fillStartsWithAllPixels) c.fillRect(0, 0, canvas.width, canvas.height);
      parts.forEach(({ operation, paths }) => {
        const shape = new Path2D();
        tracePaths(shape, paths, dx - box.left, dy - box.top);
        const rule = paths[0].fillRule === "non-zero" ? "nonzero" : "evenodd";
        c.globalCompositeOperation = operation === "subtract" ? "destination-out" : operation === "intersect" ? "destination-in" : operation === "exclude" ? "xor" : "source-over";
        c.fill(shape, rule);
      });
      if (vm.invert) {
        c.globalCompositeOperation = "xor";
        c.fillRect(0, 0, canvas.width, canvas.height);
      }
      picture = { canvas, x: box.left, y: box.top, outside: vm.invert ? 1 - outside : outside, version: 0 };
    }
    const density = vm.density === undefined ? 1 : vm.density;
    picture = softenedMask(picture, density, vm.feather || 0);
    vectorPictures.set(vm, { dx, dy, picture });
    return picture;
  };

  // A layer with a mask that stays put when the layer moves
  const looseMasks = (layer) => Boolean((maskOn(layer) && layer.mask.unlinked) || (vectorOn(layer) && layer.vectorMask.notLink));
  // Cuts a picture that sits at (x, y) of the page with a mask
  const cutWith = (ctx, width, height, x, y, picture) => {
    if (picture.outside >= 1 && !picture.canvas) return;
    const alpha = newCanvas(width, height);
    const a = alpha.getContext("2d");
    if (picture.outside > 0) {
      a.globalAlpha = picture.outside;
      a.fillRect(0, 0, width, height);
      a.globalAlpha = 1;
    }
    if (picture.canvas) {
      a.clearRect(picture.x - x, picture.y - y, picture.canvas.width, picture.canvas.height);
      a.drawImage(picture.canvas, picture.x - x, picture.y - y);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(alpha, 0, 0);
    ctx.restore();
  };
  // A stroke's settings written out once per settings object, not on every frame
  const strokeKeys = new WeakMap();
  const strokeKeyOf = (stroke) => {
    let key = strokeKeys.get(stroke);
    if (key === undefined) {
      key = JSON.stringify(stroke);
      strokeKeys.set(stroke, key);
    }
    return key;
  };
  const masksKey = (layer, doc) => {
    const parts = [];
    if (maskOn(layer)) {
      const p = maskPicture(layer, doc);
      parts.push("m", identity(p.canvas || NONE), p.x, p.y, p.outside, p.version || 0);
    }
    if (vectorOn(layer)) {
      const p = vectorPicture(layer);
      parts.push("v", identity(p.canvas || NONE), p.x, p.y, p.outside);
    }
    return parts.join(",");
  };
  // What a layer shows through its masks. The last pictures are kept, keyed by what made them.
  const maskedVisuals = new Map();
  const applyMasks = (visual, layer, doc) => {
    if (!visual || !visual.canvas || (!maskOn(layer) && !vectorOn(layer))) return visual;
    const key = [identity(visual.canvas), visual.version || 0, visual.x, visual.y, masksKey(layer, doc)].join("|");
    const kept = maskedVisuals.get(layer.id);
    if (kept && kept.key === key) return kept.visual;
    // A text's shadow and glow are hidden by its masks too, as Photoshop's "Layer Mask Hides
    // Effects": they come from the whole letters
    const cut = (picture, x, y) => {
      const canvas = newCanvas(picture.width, picture.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(picture, 0, 0);
      if (maskOn(layer)) cutWith(ctx, canvas.width, canvas.height, x, y, maskPicture(layer, doc));
      if (vectorOn(layer)) cutWith(ctx, canvas.width, canvas.height, x, y, vectorPicture(layer));
      return canvas;
    };
    const masked = { canvas: cut(visual.canvas, visual.x, visual.y), x: visual.x, y: visual.y };
    if (visual.under) masked.under = visual.under.map((item) => Object.assign({}, item, { canvas: cut(item.canvas, item.x, item.y) }));
    maskedVisuals.delete(layer.id);
    maskedVisuals.set(layer.id, { key, visual: masked });
    if (maskedVisuals.size > 32) maskedVisuals.delete(maskedVisuals.keys().next().value);
    return masked;
  };

  // A mask's alpha over a part of the page, as a canvas of the part's size
  const maskOverPage = (picture, left, top, width, height) => {
    const canvas = newCanvas(width, height);
    const c = canvas.getContext("2d");
    if (picture.outside > 0) {
      c.globalAlpha = picture.outside;
      c.fillRect(0, 0, width, height);
      c.globalAlpha = 1;
    }
    if (picture.canvas) {
      c.clearRect(picture.x - left, picture.y - top, picture.canvas.width, picture.canvas.height);
      c.drawImage(picture.canvas, picture.x - left, picture.y - top);
    }
    return canvas;
  };
  // Grey, as the Layers panel and Alt + click show a mask: white where it shows the layer
  const maskAsGray = (alpha) => {
    const canvas = newCanvas(alpha.width, alpha.height);
    const c = canvas.getContext("2d");
    c.drawImage(alpha, 0, 0);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = "#fff";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.globalCompositeOperation = "destination-over";
    c.fillStyle = "#000";
    c.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  };
  // The grey picture a PSD keeps of a mask, cut to where it differs from its colour all round
  const maskForFile = (picture, defaultColor) => {
    if (!picture.canvas) return null;
    const { width, height } = picture.canvas;
    const data = picture.canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    const around = defaultColor ? 255 : 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] === around) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const canvas = newCanvas(w, h);
    const c = canvas.getContext("2d");
    const image = c.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = data[((y + y0) * width + x + x0) * 4 + 3];
        const i = (y * w + x) * 4;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
        image.data[i + 3] = 255;
      }
    }
    c.putImageData(image, 0, 0);
    return { canvas, left: picture.x + x0, top: picture.y + y0 };
  };
  // A mask with everything painted on it made part of its picture, on the page at (0, 0) of a
  // layer that hasn't moved. Undo keeps the old one.
  const settledMask = (layer, doc) => {
    const mask = layer.mask;
    if (!mask) return null;
    const [sx, sy] = maskShift(layer);
    const picture = maskPicture(layer, doc, true);
    const file = maskForFile(picture, mask.defaultColor);
    const out = Object.assign({}, mask, { paint: NONE, canvas: file ? file.canvas : null, left: file ? file.left - sx : 0, top: file ? file.top - sy : 0 });
    out.right = out.left + (file ? file.canvas.width : 0);
    out.bottom = out.top + (file ? file.canvas.height : 0);
    return out;
  };
  // The same, in page coordinates: for a pixel layer whose pictures start again at dx = dy = 0
  const pageMask = (layer, doc) => {
    if (!layer.mask) return null;
    const m = layer.mask.paint && layer.mask.paint.length ? settledMask(layer, doc) : layer.mask;
    const [sx, sy] = maskShift(layer);
    if (!sx && !sy) return m;
    return Object.assign({}, m, { left: (m.left || 0) + sx, top: (m.top || 0) + sy, right: (m.right || 0) + sx, bottom: (m.bottom || 0) + sy });
  };
  // A vector mask with each point of its paths moved by `f`
  const mappedVector = (vm, f) => Object.assign({}, vm, {
    paths: (vm.paths || []).map((path) => Object.assign({}, path, {
      knots: (path.knots || []).map((knot) => {
        const points = knot.points.slice();
        for (let i = 0; i < 6; i += 2) [points[i], points[i + 1]] = f(points[i], points[i + 1]);
        return Object.assign({}, knot, { points });
      }),
    })),
  });
  const shiftedVector = (vm, dx, dy) => (dx || dy ? mappedVector(vm, (x, y) => [x + dx, y + dy]) : vm);
  // A layer's masks moved by dx, dy with it, or with the whole page (`all`): unlinked, a mask
  // stays where it is when only its layer moves
  const movedMasks = (layer, dx, dy, all) => {
    const out = {};
    const raster = layer.kind === "raster";
    const mask = layer.mask;
    if (mask && (raster ? !all && mask.unlinked : all || !mask.unlinked)) {
      const k = raster ? -1 : 1;
      out.mask = Object.assign({}, mask, { left: (mask.left || 0) + dx * k, top: (mask.top || 0) + dy * k, right: (mask.right || 0) + dx * k, bottom: (mask.bottom || 0) + dy * k });
    }
    const vm = layer.vectorMask;
    if (vm && (raster ? !all && vm.notLink : all || !vm.notLink)) out.vectorMask = raster ? shiftedVector(vm, -dx, -dy) : shiftedVector(vm, dx, dy);
    return out;
  };
  // Both masks at a new size of the page, for a layer drawn again at dx = dy = 0
  const scaledMasks = (layer, doc, sx, sy) => {
    const out = {};
    if (layer.mask) {
      const m = pageMask(layer, doc);
      if (m.canvas) {
        const p = scaledPixels(m.canvas, m.left || 0, m.top || 0, sx, sy);
        out.mask = Object.assign({}, m, { canvas: p.canvas, left: p.left, top: p.top, right: p.left + p.canvas.width, bottom: p.top + p.canvas.height });
      } else out.mask = Object.assign({}, m, { left: 0, top: 0 });
    }
    if (layer.vectorMask) {
      const [ax, ay] = maskShift(layer);
      out.vectorMask = mappedVector(layer.vectorMask, (x, y) => [(x + ax) * sx, (y + ay) * sy]);
    }
    return out;
  };

  const visualOf = (layer, doc) => {
    const visual = layer.kind === "text" ? (layer.effects ? styledTextVisual(layer, doc) : textVisual(layer, doc)) : layer.kind === "raster" ? fadedVisual(rasterVisual(layer, doc), fillOf(layer)) : null;
    return applyMasks(visual, layer, doc);
  };
  // A pixel layer has no stroke here: its Fill fades its pixels, kept by picture
  const faded = new WeakMap();
  const fadedVisual = (visual, fill) => {
    if (!visual || fill >= 1) return visual;
    const kept = faded.get(visual.canvas);
    if (kept && kept.version === (visual.version || 0) && kept.fill === fill) return Object.assign({}, visual, { canvas: kept.canvas });
    const canvas = newCanvas(visual.canvas.width, visual.canvas.height);
    const ctx = canvas.getContext("2d");
    ctx.globalAlpha = fill;
    ctx.drawImage(visual.canvas, 0, 0);
    faded.set(visual.canvas, { version: visual.version || 0, fill, canvas });
    return Object.assign({}, visual, { canvas });
  };

  const BLENDS = { normal: "source-over", "pass through": "source-over", dissolve: "source-over", multiply: "multiply", screen: "screen", overlay: "overlay", darken: "darken", lighten: "lighten", "color dodge": "color-dodge", "color burn": "color-burn", "linear dodge": "lighter", "hard light": "hard-light", "soft light": "soft-light", difference: "difference", exclusion: "exclusion", hue: "hue", saturation: "saturation", color: "color", luminosity: "luminosity" };

  // A text's lines as they show, for TextShapeR to learn from: a point text's own returns, a
  // paragraph's lines as its box sets them (Photoshop turns it into point text for this), once
  // its fonts are in, since they decide where its lines end
  const linesReady = (layers) => Fonts.ready(layers.flatMap(({ params }) => params.layerText.textStyleRange.map((range) => range.textStyle.fontPostScriptName)));
  const shownLines = (lt, resolution) => {
    if (!boxShape(lt)) return lt.textKey || "";
    return relativeLayout(lt, resolution).wrapped.map((runs) => runs.map((run) => run.text).join("").replace(/\s+$/, "")).join("\r");
  };

  // A layer is shown only if all its folders are, and takes their opacity
  const chainOf = (layer, byId) => {
    let opacity = 1;
    for (let id = layer.group; id; ) {
      const parent = byId.get(id);
      if (!parent) break;
      if (parent.visible === false) return { visible: false, opacity: 0 };
      opacity *= parent.opacity === undefined ? 1 : parent.opacity;
      id = parent.group;
    }
    return { visible: layer.visible !== false, opacity };
  };

  // Clipping masks: a layer marked `clipping` shows only where the layer under it in the same
  // folder shows (its base), as do the clipped layers between them. A folder can be a base,
  // and is then drawn as one picture; a folder itself is never clipped here. A clipped layer
  // with nothing under it in its folder is drawn as any other, as Photoshop would release it.
  const clipInfos = new WeakMap();
  const clippingOf = (layers) => {
    let info = clipInfos.get(layers);
    if (info) return info;
    info = { clipped: new Set(), bases: new Set(), baseOf: new Map() };
    for (let i = 1; i < layers.length; i++) {
      const layer = layers[i];
      const below = layers[i - 1];
      if (!layer.clipping || layer.kind === "group" || (below.group || null) !== (layer.group || null)) continue;
      const base = info.clipped.has(below.id) ? info.baseOf.get(below.id) : below;
      info.clipped.add(layer.id);
      info.baseOf.set(layer.id, base);
      if (base.kind === "group") info.bases.add(base.id);
    }
    clipInfos.set(layers, info);
    return info;
  };

  // A folder with a layer style of its own, as an SFX gets: its stroke goes around everything
  // inside it at once, so letters that overlap make one shape. Such a folder is drawn as one
  // picture, its layers first, then its stroke, its Fill at 0% and its masks. So is a folder
  // that is a clipping base.
  const groupStroke = (layer) => (layer.stroke && layer.stroke.enabled && layer.stroke.size > 0 ? layer.stroke : null);
  const isStyledGroup = (layer, layers) => layer.kind === "group" && Boolean(groupStroke(layer) || fillOf(layer) < 1 || maskOn(layer) || vectorOn(layer) || (layers && clippingOf(layers).bases.has(layer.id)));
  // The outermost styled folder a layer is in, if any
  const styledParentOf = (layer, byId, layers) => {
    let found = null;
    for (let id = layer.group; id; ) {
      const parent = byId.get(id);
      if (!parent) break;
      if (isStyledGroup(parent, layers)) found = parent;
      id = parent.group;
    }
    return found;
  };
  // A shape grown by `size` pixels all round, onto `c`
  const spread = (c, source, pad, size) => {
    const steps = Math.min(48, Math.max(12, Math.round(size * 4)));
    // The inner circle fills what a small dot would leave open inside the outer one
    for (const r of size > 3 ? [size, size / 2] : [size]) {
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        c.drawImage(source, pad + Math.cos(angle) * r, pad + Math.sin(angle) * r);
      }
    }
  };
  // Grows a shape by `size` pixels all round, in `color`: the same rings as a PSD's strokes
  const ringOf = (source, pad, size, color, into) => {
    const ring = newCanvas(into.width, into.height);
    const c = ring.getContext("2d");
    spread(c, source, pad, size);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = colorCss(color);
    c.fillRect(0, 0, ring.width, ring.height);
    into.getContext("2d").drawImage(ring, 0, 0);
  };
  // A stroke inside a shape, `size` pixels in from its edge, in `color`, over it: what is
  // around the shape, grown, then kept where the shape is. `source` is laid at `pad` in `into`.
  const innerRingOf = (source, pad, size, color, into) => {
    const around = newCanvas(into.width, into.height);
    const a = around.getContext("2d");
    a.fillRect(0, 0, around.width, around.height);
    a.globalCompositeOperation = "destination-out";
    a.drawImage(source, pad, pad);
    const ring = newCanvas(into.width, into.height);
    const c = ring.getContext("2d");
    spread(c, around, 0, size);
    c.globalCompositeOperation = "destination-in";
    c.drawImage(source, pad, pad);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = colorCss(color);
    c.fillRect(0, 0, ring.width, ring.height);
    into.getContext("2d").drawImage(ring, 0, 0);
  };
  // A base with its clipped layers on it, as one picture of the base's size. A clipped layer
  // in Normal mode lands on the base's pixels only; in another mode it blends, then what went
  // past the base is cut off.
  const withClipped = (base, clips) => {
    const canvas = newCanvas(base.canvas.width, base.canvas.height);
    const c = canvas.getContext("2d");
    c.drawImage(base.canvas, 0, 0);
    let shape = null;
    clips.forEach(({ visual, alpha, blend }) => {
      if (visual.under) drawUnder(c, visual, -base.x, -base.y, alpha, null, { canvas: base.canvas, x: 0, y: 0 });
      c.globalAlpha = alpha;
      if (blend === "source-over") {
        c.globalCompositeOperation = "source-atop";
        c.drawImage(visual.canvas, visual.x - base.x, visual.y - base.y);
        return;
      }
      if (!shape) {
        shape = newCanvas(canvas.width, canvas.height);
        shape.getContext("2d").drawImage(base.canvas, 0, 0);
      }
      c.globalCompositeOperation = blend;
      c.drawImage(visual.canvas, visual.x - base.x, visual.y - base.y);
      c.globalAlpha = 1;
      c.globalCompositeOperation = "destination-in";
      c.drawImage(shape, 0, 0);
    });
    return { canvas, x: base.x, y: base.y };
  };

  // Curves is an operation on the picture already composed below its row, not a picture of
  // its own. Taking a snapshot also makes it work over several layers and over the Background.
  const curveTables = new WeakMap();
  const tablesForCurves = (params) => {
    const Curves = window.TypeRCurves;
    if (!params || !Curves) return null;
    let tables = curveTables.get(params);
    if (!tables) {
      tables = Curves.tables(params.pencil ? params.maps : params.points, params.pencil);
      curveTables.set(params, tables);
    }
    return tables;
  };
  const applyCurves = (target, layer, opacity = 1) => {
    const tables = tablesForCurves(layer.curves);
    if (!tables || !window.TypeRCurves) return;
    const width = target.canvas.width;
    const height = target.canvas.height;
    if (!width || !height) return;
    const snapshot = newCanvas(width, height);
    const source = snapshot.getContext("2d", { willReadFrequently: true });
    source.drawImage(target.canvas, 0, 0);
    const image = source.getImageData(0, 0, width, height);
    if (!window.TypeRCurves.apply(image, tables, opacity)) return;
    source.putImageData(image, 0, 0);
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    target.globalCompositeOperation = "source-over";
    target.clearRect(0, 0, width, height);
    target.drawImage(snapshot, 0, 0);
    target.restore();
  };

  const groupVisuals = new Map();
  // `still`: the folder moves as a whole, so its picture is the one it has at rest
  // `skip`: layers to leave out (the Magic Wand reads the page without its text)
  const groupVisual = (group, doc, still, skip) => {
    const layers = doc.orderPreview || doc.state.layers;
    const blendOf = (layer) => BLENDS[doc.blendPreview && doc.blendPreview.ids.has(layer.id) ? doc.blendPreview.blend : layer.blend] || "source-over";
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    const members = familyOf(layers, group.id);
    const clip = clippingOf(layers);
    const live = !still && doc.live ? doc.live : null;
    const parts = [];
    const partOf = new Map();
    // Its visibility inside the folder: the folder's own opacity is applied to the whole
    const inside = (layer) => {
      let visible = layer.visible !== false;
      let opacity = layer.opacity === undefined ? 1 : layer.opacity;
      for (let id = layer.group; id && id !== group.id; ) {
        const parent = byId.get(id);
        if (!parent) break;
        if (parent.visible === false) visible = false;
        opacity *= parent.opacity === undefined ? 1 : parent.opacity;
        id = parent.group;
      }
      return { visible, opacity };
    };
    // `bare`: without its stroke, shadow and glow, for what is clipped to it to land on its letters
    const shown = (layer, bare) => {
      const moving = live && live.ids.has(layer.id);
      const loose = moving && looseMasks(layer);
      const source = loose ? shifted(layer, Math.round(live.dx), Math.round(live.dy), doc) : doc.preview && doc.preview.id === layer.id ? doc.preview : layer;
      const visual = visualOf(bare ? withoutStroke(source) : source, doc);
      if (!visual || !visual.canvas || !visual.canvas.width) return null;
      const dx = moving && !loose ? Math.round(live.dx) : 0;
      const dy = moving && !loose ? Math.round(live.dy) : 0;
      const out = { canvas: visual.canvas, x: visual.x + dx, y: visual.y + dy, key: identity(visual.canvas) + "." + (visual.version || 0) };
      if (visual.under) out.under = visual.under.map((item) => Object.assign({}, item, { x: item.x + dx, y: item.y + dy }));
      return out;
    };
    layers.forEach((layer) => {
      if (layer.id === group.id || !members.has(layer.id)) return;
      const styled = styledParentOf(layer, byId, layers);
      if (layer.kind === "group") {
        if (styled === group && isStyledGroup(layer, layers) && chainOf(layer, byId).visible && inside(layer).visible) {
          const visual = groupVisual(layer, doc, still, skip);
          if (visual) {
            const part = { visual, alpha: layer.opacity === undefined ? 1 : layer.opacity, blend: blendOf(layer), key: "g" + layer.id + "." + identity(visual.canvas), clips: [] };
            parts.push(part);
            partOf.set(layer.id, part);
          }
        }
        return;
      }
      if (styled !== group || (skip && skip(layer))) return;
      const { visible, opacity } = inside(layer);
      if (!visible) return;
      const blend = blendOf(layer);
      if (layer.kind === "curves") {
        const part = { adjustment: layer, alpha: opacity, blend, key: `c${layer.id}.${identity(layer.curves)}.${Boolean(layer.curvesBypass)}`, clips: [], layer };
        parts.push(part);
        partOf.set(layer.id, part);
        return;
      }
      const visual = shown(layer);
      if (!visual) return;
      if (clip.clipped.has(layer.id)) {
        const base = partOf.get(clip.baseOf.get(layer.id).id);
        if (base) base.clips.push({ visual, alpha: layer.opacity === undefined ? 1 : layer.opacity, blend });
        return;
      }
      const part = { visual, alpha: opacity, blend, key: visual.key, clips: [], layer };
      parts.push(part);
      partOf.set(layer.id, part);
    });
    if (!parts.some((part) => !part.adjustment)) return null;
    const stroke = groupStroke(group);
    const key = parts.map((part) => part.adjustment ? [part.key, part.alpha, part.blend].join(",") : [part.key, part.visual.x, part.visual.y, part.alpha, part.blend, part.clips.map((item) => [item.visual.key, item.visual.x, item.visual.y, item.alpha, item.blend].join(":")).join("/")].join(",")).join(";") + "|" + JSON.stringify(stroke) + "|" + fillOf(group) + "|" + masksKey(group, doc);
    // Kept apart without its stroke: a gradient clipped to an SFX asks for both
    const keptId = stroke ? group.id : `${group.id}:bare`;
    const kept = skip ? null : groupVisuals.get(keptId);
    if (kept && kept.key === key) return kept.visual;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    parts.forEach(({ visual }) => {
      if (!visual) return;
      const area = visualRect(visual);
      left = Math.min(left, area.left);
      top = Math.min(top, area.top);
      right = Math.max(right, area.right);
      bottom = Math.max(bottom, area.bottom);
    });
    const pad = Math.ceil(strokeReach(stroke)) + 2;
    const fill = newCanvas(right - left + pad * 2, bottom - top + pad * 2);
    const f = fill.getContext("2d");
    parts.forEach(({ visual, alpha, blend, clips, layer, adjustment }) => {
      if (adjustment) {
        if (!adjustment.curvesBypass) applyCurves(f, adjustment, alpha);
        return;
      }
      let drawn = visual;
      // As on the page: a text's stroke, shadow and glow stay whole around its letters, and
      // what is clipped to it lands on the letters
      const ringed = layer && layer.kind === "text" && ((layer.stroke && layer.stroke.enabled && layer.stroke.size > 0) || outerEffectsOn(layer));
      const bare = clips.length && ringed ? shown(layer, true) : null;
      if (bare) {
        const glued = withClipped(bare, clips);
        const x = Math.min(visual.x, glued.x);
        const y = Math.min(visual.y, glued.y);
        const canvas = newCanvas(Math.max(visual.x + visual.canvas.width, glued.x + glued.canvas.width) - x, Math.max(visual.y + visual.canvas.height, glued.y + glued.canvas.height) - y);
        const g = canvas.getContext("2d");
        g.drawImage(visual.canvas, visual.x - x, visual.y - y);
        g.drawImage(glued.canvas, glued.x - x, glued.y - y);
        drawn = { canvas, x, y };
      } else if (clips.length) drawn = withClipped(visual, clips);
      if (visual.under) drawUnder(f, visual, pad - left, pad - top, alpha);
      f.globalAlpha = alpha;
      f.globalCompositeOperation = blend;
      f.drawImage(drawn.canvas, drawn.x - left + pad, drawn.y - top + pad);
    });
    f.globalAlpha = 1;
    f.globalCompositeOperation = "source-over";
    let out = fill;
    const amount = fillOf(group);
    if (stroke || amount < 1) {
      out = newCanvas(fill.width, fill.height);
      const o = out.getContext("2d");
      if (stroke) {
        if (stroke.outer && stroke.outer.size > 0) ringOf(fill, 0, strokeReach(stroke), stroke.outer.color, out);
        if (strokeOutside(stroke) > 0) ringOf(fill, 0, strokeOutside(stroke), stroke.color, out);
      }
      // Fill: what the folder holds at that much over its stroke, which stays whole
      if (amount < 1 && stroke) {
        o.globalCompositeOperation = "destination-out";
        o.drawImage(fill, 0, 0);
        o.globalCompositeOperation = "source-over";
      }
      if (amount > 0) {
        o.globalAlpha = amount;
        o.drawImage(fill, 0, 0);
        o.globalAlpha = 1;
      }
      // Its part inside, over what the folder holds
      if (stroke && stroke.size > strokeOutside(stroke)) innerRingOf(fill, 0, stroke.size - strokeOutside(stroke), stroke.color, out);
    }
    const o = out.getContext("2d");
    if (maskOn(group)) cutWith(o, out.width, out.height, left - pad, top - pad, maskPicture(group, doc));
    if (vectorOn(group)) cutWith(o, out.width, out.height, left - pad, top - pad, vectorPicture(group));
    const visual = { canvas: out, x: left - pad, y: top - pad };
    if (skip) return visual;
    if (groupVisuals.size > 200) groupVisuals.clear();
    groupVisuals.set(keptId, { key, visual });
    return visual;
  };

  // On screen only: a mask shown alone in grey (Alt + click on it), or in red over the page
  // (\), and the Quick Mask in red where the selection isn't
  const MASK_RED = "rgb(255,0,0)";
  const drawMaskViews = (doc, ctx, rect) => {
    const area = rect ? { left: Math.max(0, Math.floor(rect.left)), top: Math.max(0, Math.floor(rect.top)), right: Math.min(doc.width, Math.ceil(rect.right)), bottom: Math.min(doc.height, Math.ceil(rect.bottom)) } : { left: 0, top: 0, right: doc.width, bottom: doc.height };
    const width = area.right - area.left;
    const height = area.bottom - area.top;
    if (width <= 0 || height <= 0) return;
    const red = (picture) => {
      const alpha = maskOverPage(picture, area.left, area.top, width, height);
      const tint = newCanvas(width, height);
      const t = tint.getContext("2d");
      t.fillStyle = MASK_RED;
      t.fillRect(0, 0, width, height);
      t.globalCompositeOperation = "destination-out";
      t.drawImage(alpha, 0, 0);
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(tint, area.left, area.top);
      ctx.globalAlpha = 1;
    };
    // Shown while its mask stays the one the brushes work on
    const target = ops.maskTarget(doc);
    const view = doc.maskView && target && target.id === doc.maskView.id && target.part === doc.maskView.part ? doc.maskView : null;
    const layer = view && target.layer;
    if (layer && (view.part === "vector" ? layer.vectorMask : layer.mask)) {
      const picture = view.part === "vector" ? vectorPicture(Object.assign({}, layer, { vectorMask: Object.assign({}, layer.vectorMask, { disable: false }) })) : maskPicture(layer, doc, true);
      if (view.mode === "alone") {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(maskAsGray(maskOverPage(picture, area.left, area.top, width, height)), area.left, area.top);
      } else red(picture);
    }
    const quick = maskHolder(doc, "quick");
    if (quick) red(maskPicture(quick, doc, true));
  };

  // On screen only: a layer that isn't one yet, such as the Bubble Reshaper's bubble being
  // shaped. It goes in place of the layer it `replaces`, or under the layer `before`.
  const withExtra = (doc) => {
    const { layer, before, replaces } = doc.extra;
    const list = doc.state.layers.slice();
    let at = replaces ? list.findIndex((item) => item.id === replaces) : -1;
    if (at >= 0) list.splice(at, 1);
    else at = before ? list.findIndex((item) => item.id === before) : -1;
    list.splice(at < 0 ? list.length : at, 0, layer);
    return list;
  };

  let scratch = null;
  let scratchShape = null;
  let scratchRing = null;
  // Where a layer's picture last went: during a stroke, the layers away from it cost nothing
  const visualBoxes = new WeakMap();
  // `rect` redoes only that part of a canvas that already shows this document: what a drag
  // changes on a page 10000 pixels tall is small, and the rest of the page costs nothing.
  // `screen`: the canvas the user sees, with the mask views on it.
  // A base without its stroke, for what is clipped to it to go on its letters alone. A text
  // opened from a PSD shows Photoshop's own pixels, the stroke drawn around them: its letters
  // alone are those pixels. Where an older TypeR drew the stroke into them, TypeR draws the
  // letters again.
  // Its shadow and glow go too: what is clipped lands on the letters and their inner effects.
  const withoutStroke = (layer) => {
    const raster = layer.kind === "text" ? layer.raster : null;
    const effects = insideEffects(layer.effects);
    if (!raster) return Object.assign({}, layer, { stroke: null, effects });
    if (raster.strokeDrawnIn) return Object.assign({}, layer, { stroke: null, effects, raster: null });
    return Object.assign({}, layer, { stroke: null, effects, raster: { bitmap: raster.bitmap, left: raster.left, top: raster.top } });
  };
  const paintDoc = (doc, ctx, options = {}) => {
    // On screen, layers being dragged in the panel show where they would land
    const layers = options.screen && doc.orderPreview ? doc.orderPreview : options.screen && doc.extra ? withExtra(doc) : doc.state.layers;
    const blendOf = (layer) => BLENDS[doc.blendPreview && doc.blendPreview.ids.has(layer.id) ? doc.blendPreview.blend : layer.blend] || "source-over";
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    const live = doc.live;
    const rect = options.rect || null;
    const clip = clippingOf(layers);
    // `extra.underTo`: where the shadow and glow go instead, at `extra.underAlpha` (a clipping
    // base's, against the page). `extra.clip`: the base's shape, for a clipped layer's.
    const place = (layer, target, alpha, blend, extra) => {
      // A layer whose mask isn't linked moves under its mask, which stays
      const moving = live && live.ids.has(layer.id);
      const loose = moving && looseMasks(layer);
      const shown = loose ? shifted(layer, Math.round(live.dx), Math.round(live.dy), doc) : doc.preview && doc.preview.id === layer.id ? doc.preview : layer;
      const still = rect && shown === layer && !moving && !(doc.liveTransform && doc.liveTransform.ids.has(layer.id));
      if (still) {
        const known = visualBoxes.get(layer);
        if (known && (known.x >= rect.right || known.y >= rect.bottom || known.x + known.width <= rect.left || known.y + known.height <= rect.top)) return;
      }
      const visual = visualOf(shown, doc);
      if (!visual || !visual.canvas || !visual.canvas.width) return;
      // A text's shadow and glow reach past its letters
      const area = visual.under ? visualRect(visual) : null;
      if (shown === layer) visualBoxes.set(layer, area ? { x: area.left, y: area.top, width: area.right - area.left, height: area.bottom - area.top } : { x: visual.x, y: visual.y, width: visual.canvas.width, height: visual.canvas.height });
      let { x, y } = visual;
      if (moving && !loose) {
        x += Math.round(live.dx);
        y += Math.round(live.dy);
      }
      const turning = doc.liveTransform && doc.liveTransform.ids.has(layer.id) ? doc.liveTransform.matrix : null;
      if (area) {
        const ox = x - visual.x;
        const oy = y - visual.y;
        if (rect && !turning && (area.left + ox >= rect.right || area.top + oy >= rect.bottom || area.right + ox <= rect.left || area.bottom + oy <= rect.top)) return;
        if (extra && extra.underTo) drawUnder(extra.underTo, visual, ox, oy, extra.underAlpha, turning);
        else drawUnder(target, visual, ox, oy, alpha, turning, extra && extra.clip ? { canvas: extra.clip(), x: 0, y: 0 } : null);
      } else if (rect && !turning && (x >= rect.right || y >= rect.bottom || x + visual.canvas.width <= rect.left || y + visual.canvas.height <= rect.top)) return;
      target.globalAlpha = alpha;
      target.globalCompositeOperation = blend;
      if (!turning) {
        if (rect && Number.isInteger(x) && Number.isInteger(y)) {
          const left = Math.max(x, rect.left);
          const top = Math.max(y, rect.top);
          const width = Math.min(x + visual.canvas.width, rect.right) - left;
          const height = Math.min(y + visual.canvas.height, rect.bottom) - top;
          if (width > 0 && height > 0) target.drawImage(visual.canvas, left - x, top - y, width, height, left, top, width, height);
        } else target.drawImage(visual.canvas, x, y);
        return;
      }
      target.save();
      target.transform(...turning);
      target.imageSmoothingQuality = "high";
      target.drawImage(visual.canvas, x, y);
      target.restore();
    };
    // A styled folder, drawn as one picture
    const placeGroup = (layer, target, alpha, blend) => {
      // Moved whole, it keeps its picture: the stroke isn't drawn again at every step
      const family = Array.from(familyOf(layers, layer.id)).filter((id) => byId.get(id).kind !== "group");
      const whole = (set) => set && family.length && family.every((id) => set.has(id));
      const moving = whole(live && live.ids);
      const turning = whole(doc.liveTransform && doc.liveTransform.ids);
      const visual = groupVisual(layer, doc, moving, options.skip);
      if (!visual) return;
      const x = visual.x + (moving ? Math.round(live.dx) : 0);
      const y = visual.y + (moving ? Math.round(live.dy) : 0);
      if (rect && !turning && (x >= rect.right || y >= rect.bottom || x + visual.canvas.width <= rect.left || y + visual.canvas.height <= rect.top)) return;
      target.globalAlpha = alpha;
      target.globalCompositeOperation = blend;
      if (turning) {
        target.save();
        target.transform(...doc.liveTransform.matrix);
        target.drawImage(visual.canvas, x, y);
        target.restore();
      } else target.drawImage(visual.canvas, x, y);
    };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, options.x || 0, options.y || 0);
    if (rect) {
      ctx.beginPath();
      ctx.rect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      ctx.clip();
      if (!options.keep) ctx.clearRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    } else if (!options.keep) ctx.clearRect(0, 0, doc.width, doc.height);
    const anyStyled = layers.some((layer) => isStyledGroup(layer, layers));
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const styledTop = anyStyled && layer.kind === "group" && isStyledGroup(layer, layers) && !styledParentOf(layer, byId, layers);
      if (!styledTop) {
        if (layer.kind === "group" || clip.clipped.has(layer.id)) continue;
        if (options.skip && options.skip(layer)) continue;
        if (anyStyled && styledParentOf(layer, byId, layers)) continue;
      }
      const chain = chainOf(layer, byId);
      if (!chain.visible) continue;
      const alpha = (layer.opacity === undefined ? 1 : layer.opacity) * chain.opacity;
      const blend = blendOf(layer);
      if (layer.kind === "curves") {
        if (!layer.curvesBypass) applyCurves(ctx, layer, alpha);
        continue;
      }
      // A base with a stroke keeps it, as in Photoshop: what is clipped to it (a gradient on a
      // text or an SFX) goes on its letters, and the stroke stays around them in its colour. So
      // do a text's shadow and glow, under them.
      const ringed = layer.kind === "text" ? Boolean(layer.stroke && layer.stroke.enabled && layer.stroke.size > 0) || outerEffectsOn(layer) : styledTop && Boolean(groupStroke(layer));
      const drawBase = (target, a, b, which = layer, extra) => (styledTop ? placeGroup(which, target, a, b) : place(which, target, a, b, extra));
      const clipped = [];
      for (let j = i + 1; j < layers.length && clip.clipped.has(layers[j].id) && clip.baseOf.get(layers[j].id) === layer; j++) {
        if (!(options.skip && options.skip(layers[j])) && chainOf(layers[j], byId).visible) clipped.push(layers[j]);
      }
      if (!clipped.length) {
        drawBase(ctx, alpha, blend);
        continue;
      }
      if (!scratch || scratch.width !== doc.width || scratch.height !== doc.height) scratch = newCanvas(doc.width, doc.height);
      const c = scratch.getContext("2d");
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";
      if (rect) c.clearRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      else c.clearRect(0, 0, doc.width, doc.height);
      drawBase(c, 1, "source-over", ringed ? withoutStroke(layer) : layer);
      let shaped = false;
      // The base's shape, taken once something needs it
      const baseShape = () => {
        if (!shaped) {
          if (!scratchShape || scratchShape.width !== doc.width || scratchShape.height !== doc.height) scratchShape = newCanvas(doc.width, doc.height);
          const s = scratchShape.getContext("2d");
          s.globalCompositeOperation = "copy";
          s.drawImage(scratch, 0, 0);
          s.globalCompositeOperation = "source-over";
          shaped = true;
        }
        return scratchShape;
      };
      clipped.forEach((item) => {
        const itemAlpha = item.opacity === undefined ? 1 : item.opacity;
        const itemBlend = blendOf(item);
        // A clipped text's shadow and glow stay inside the base too, in their own blend mode
        if (itemBlend === "source-over") {
          place(item, c, itemAlpha, "source-atop", { clip: baseShape });
          return;
        }
        // Another mode blends over the base, then what went past its pixels is cut off
        baseShape();
        place(item, c, itemAlpha, itemBlend, { clip: baseShape });
        c.globalAlpha = 1;
        c.globalCompositeOperation = "destination-in";
        c.drawImage(scratchShape, 0, 0);
      });
      let composed = scratch;
      if (ringed) {
        // The base with its stroke, and its letters with what is clipped to them over it
        if (!scratchRing || scratchRing.width !== doc.width || scratchRing.height !== doc.height) scratchRing = newCanvas(doc.width, doc.height);
        const r = scratchRing.getContext("2d");
        r.globalAlpha = 1;
        r.globalCompositeOperation = "source-over";
        if (rect) r.clearRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
        else r.clearRect(0, 0, doc.width, doc.height);
        // Its shadow and glow straight onto the page, in their own blend mode
        drawBase(r, 1, "source-over", layer, { underTo: ctx, underAlpha: alpha });
        r.globalAlpha = 1;
        r.globalCompositeOperation = "source-over";
        r.drawImage(scratch, 0, 0);
        composed = scratchRing;
      }
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = blend;
      ctx.drawImage(composed, 0, 0);
    }
    if (options.screen) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      drawMaskViews(doc, ctx, rect);
    }
    ctx.restore();
  };

  /* ===================== a picture's resolution, in ppi ===================== */

  // What Photoshop finds in a PNG, a JPEG or a WebP: the size in points of a text depends on
  // it. Without it, 72 ppi, as in Photoshop.
  // A PNG says it in pixels per metre: 300 ppi comes back as 299.9994
  const sensiblePpi = (ppi) => {
    if (!Number.isFinite(ppi) || ppi < 1 || ppi > 10000) return null;
    return Math.abs(ppi - Math.round(ppi)) < 0.05 ? Math.round(ppi) : Math.round(ppi * 100) / 100;
  };
  const ppiOfTiff = (bytes) => {
    if (bytes.length < 8) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const little = bytes[0] === 0x49;
    if (!little && bytes[0] !== 0x4d) return null;
    const u16 = (at) => view.getUint16(at, little);
    const u32 = (at) => view.getUint32(at, little);
    const ifd = u32(4);
    if (ifd + 2 > bytes.length) return null;
    let x = null;
    let unit = 2;
    for (let i = 0, count = u16(ifd); i < count; i++) {
      const at = ifd + 2 + i * 12;
      if (at + 12 > bytes.length) break;
      const tag = u16(at);
      if (tag === 0x011a) {
        const value = u32(at + 8);
        if (value + 8 <= bytes.length && u32(value + 4)) x = u32(value) / u32(value + 4);
      } else if (tag === 0x0128) unit = u16(at + 8);
    }
    if (x === null || unit === 1) return null;
    return sensiblePpi(unit === 3 ? x * 2.54 : x);
  };
  const ppiOfXmp = (text) => {
    const field = (name) => {
      const found = text.match(new RegExp(`tiff:${name}\\s*=\\s*"([^"]+)"`)) || text.match(new RegExp(`<tiff:${name}>([^<]+)<`));
      return found ? found[1].trim() : null;
    };
    const x = field("XResolution");
    if (!x) return null;
    const [top, bottom = "1"] = x.split("/");
    const ppi = Number(top) / Number(bottom);
    return sensiblePpi(field("ResolutionUnit") === "3" ? ppi * 2.54 : ppi);
  };
  const latin1 = (bytes) => {
    let out = "";
    for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return out;
  };
  const ppiOfPng = (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let exif = null;
    let xmp = null;
    for (let at = 8; at + 8 <= bytes.length; ) {
      const length = view.getUint32(at);
      const type = latin1(bytes.subarray(at + 4, at + 8));
      const data = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + length));
      // Pixels per metre
      if (type === "pHYs" && data.length >= 9 && data[8] === 1) return sensiblePpi(new DataView(data.buffer, data.byteOffset, 9).getUint32(0) * 0.0254);
      if (type === "eXIf") exif = data;
      if (type === "iTXt" && latin1(data.subarray(0, 18)) === "XML:com.adobe.xmp\0") xmp = data;
      if (type === "IEND") break;
      at += 12 + length;
    }
    return (exif && ppiOfTiff(exif)) || (xmp && ppiOfXmp(latin1(xmp))) || null;
  };
  const ppiOfJpeg = (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let photoshop = null;
    let exif = null;
    let xmp = null;
    let jfif = null;
    for (let at = 2; at + 4 <= bytes.length; ) {
      if (bytes[at] !== 0xff) break;
      const marker = bytes[at + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      // The image data starts: everything worth reading came before
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(at + 2);
      const data = bytes.subarray(at + 4, Math.min(bytes.length, at + 2 + length));
      const head = latin1(data.subarray(0, 29));
      if (marker === 0xe0 && head.startsWith("JFIF\0") && data.length >= 12 && (data[7] === 1 || data[7] === 2)) {
        const density = (data[8] << 8) | data[9];
        jfif = sensiblePpi(data[7] === 2 ? density * 2.54 : density);
      } else if (marker === 0xe1 && head.startsWith("Exif\0")) exif = ppiOfTiff(data.subarray(6));
      else if (marker === 0xe1 && head.startsWith("http://ns.adobe.com/xap/1.0/\0")) xmp = ppiOfXmp(latin1(data));
      else if (marker === 0xed && head.startsWith("Photoshop 3.0\0")) {
        // The 8BIM resources, ResolutionInfo (1005) among them, in 16.16 fixed point
        const res = new DataView(data.buffer, data.byteOffset, data.byteLength);
        for (let i = 14; i + 12 <= data.length; ) {
          if (latin1(data.subarray(i, i + 4)) !== "8BIM") break;
          const id = res.getUint16(i + 4);
          const nameLength = data[i + 6];
          const start = i + 6 + ((nameLength + 2) & ~1);
          if (start + 4 > data.length) break;
          const size = res.getUint32(start);
          if (id === 0x03ed && size >= 8 && start + 12 <= data.length) photoshop = sensiblePpi(res.getUint32(start + 4) / 65536);
          i = start + 4 + size + (size & 1);
        }
      }
      at += 2 + length;
    }
    return photoshop || exif || xmp || jfif || null;
  };
  const ppiOfWebp = (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let xmp = null;
    for (let at = 12; at + 8 <= bytes.length; ) {
      const type = latin1(bytes.subarray(at, at + 4));
      const length = view.getUint32(at + 4, true);
      const data = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + length));
      if (type === "EXIF") {
        const ppi = ppiOfTiff(latin1(data.subarray(0, 6)) === "Exif\0\0" ? data.subarray(6) : data);
        if (ppi) return ppi;
      }
      if (type === "XMP ") xmp = ppiOfXmp(latin1(data));
      at += 8 + length + (length & 1);
    }
    return xmp;
  };
  const imageResolution = async (blob) => {
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return ppiOfPng(bytes);
      if (bytes[0] === 0xff && bytes[1] === 0xd8) return ppiOfJpeg(bytes);
      if (latin1(bytes.subarray(0, 4)) === "RIFF" && latin1(bytes.subarray(8, 12)) === "WEBP") return ppiOfWebp(bytes);
    } catch (error) {
      console.warn("Could not read the resolution", error);
    }
    return null;
  };

  // A PNG or a JPEG from canvas.toBlob, which says nothing of the resolution, made to say it
  const PNG_CRC = Int32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const pngCrc = (bytes) => {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ PNG_CRC[(crc ^ bytes[i]) & 0xff];
    return (crc ^ -1) >>> 0;
  };
  const withResolution = async (blob, ppi) => {
    if (!blob || !(ppi > 0)) return blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      const ppm = Math.round(ppi / 0.0254);
      const chunk = new Uint8Array(21);
      const view = new DataView(chunk.buffer);
      view.setUint32(0, 9);
      chunk.set([0x70, 0x48, 0x59, 0x73], 4);
      view.setUint32(8, ppm);
      view.setUint32(12, ppm);
      chunk[16] = 1;
      view.setUint32(17, pngCrc(chunk.subarray(4, 17)));
      // Right after the header, which is always 8 + 25 bytes
      const parts = [];
      let at = 33;
      parts.push(bytes.subarray(0, 33), chunk);
      const source = new DataView(bytes.buffer);
      while (at + 8 <= bytes.length) {
        const length = source.getUint32(at);
        const end = at + 12 + length;
        if (latin1(bytes.subarray(at + 4, at + 8)) !== "pHYs") parts.push(bytes.subarray(at, end));
        at = end;
      }
      return new Blob(parts, { type: blob.type });
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const density = Math.min(65535, Math.round(ppi));
      if (bytes[2] === 0xff && bytes[3] === 0xe0 && latin1(bytes.subarray(6, 11)) === "JFIF\0") {
        const out = bytes.slice();
        out[13] = 1;
        out.set([density >> 8, density & 255, density >> 8, density & 255], 14);
        return new Blob([out], { type: blob.type });
      }
      const app0 = Uint8Array.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, density >> 8, density & 255, density >> 8, density & 255, 0, 0]);
      return new Blob([bytes.subarray(0, 2), app0, bytes.subarray(2)], { type: blob.type });
    }
    return blob;
  };

  /* ============================ documents ============================ */

  let nextId = 100;
  const newId = () => nextId++;

  const newRaster = (name, fields) => Object.assign({ id: newId(), kind: "raster", name, visible: true, opacity: 1, blend: "normal", bitmap: null, left: 0, top: 0, dx: 0, dy: 0, paint: NONE, group: null }, fields);
  const newCurves = (name, fields) => Object.assign({
    id: newId(), kind: "curves", name, visible: true, opacity: 1, blend: "normal", group: null,
    curves: window.TypeRCurves ? window.TypeRCurves.identityParams() : null,
  }, fields);

  const createDoc = ({ name, path, width, height, resolution, layers, handle, psd, stamp, idml }) => {
    const doc = {
      id: newId(),
      name,
      path,
      stamp: stamp || null,
      handle: handle || null,
      width,
      height,
      resolution: resolution || 72,
      psd: psd || null,
      // A page of an InDesign file: the file's package, shared by its pages (indesign.js)
      idml: idml || null,
      sampleCache: null,
      sampleKey: "",
      state: { layers: layers || [], selection: null, lastSelection: null, activeIds: [] },
      history: [],
      historyIndex: -1,
      savedId: null,
      view: { zoom: 1, x: 0, y: 0, fitted: true },
    };
    const top = doc.state.layers[doc.state.layers.length - 1];
    if (top) doc.state.activeIds = [top.id];
    pushHistory(doc, "Open");
    doc.savedId = doc.history[0].id;
    return doc;
  };

  const sizeOf = (doc) => ({ width: doc.width, height: doc.height, resolution: doc.resolution });

  const pushHistory = (doc, name, coalesce) => {
    doc.history.length = doc.historyIndex + 1;
    doc.history.push({ id: newId(), name, state: doc.state, size: sizeOf(doc), coalesce: coalesce || null, time: Date.now() });
    if (doc.history.length > MAX_HISTORY) doc.history.shift();
    doc.historyIndex = doc.history.length - 1;
    const before = doc.history[doc.historyIndex - 1];
    if (before && (before.state.layers !== doc.state.layers || before.state.selection !== doc.state.selection)) trimHistory(doc);
  };

  // Steps are cheap, as they share what didn't change, unless each brings pixels of its own: a
  // merge, a transform, a big selection. Past this budget the oldest steps go, as in Photoshop.
  const HISTORY_BUDGET = 256 * 1024 * 1024;
  const MIN_STEPS = 10;
  const pixelsOfLayer = (layer, found) => {
    [layer.bitmap, layer.raster && layer.raster.bitmap, layer.raster && layer.raster.display, layer.mask && layer.mask.canvas].forEach((canvas) => { if (canvas) found.add(canvas); });
    (layer.paint || NONE).forEach((op) => {
      if (op.clip && op.clip.canvas) found.add(op.clip.canvas);
      if (op.source && op.source.canvas) found.add(op.source.canvas);
      if (op.canvas) found.add(op.canvas);
    });
  };
  const pixelsOfState = (state, found, seen) => {
    state.layers.forEach((layer) => {
      if (seen.has(layer)) return;
      seen.add(layer);
      pixelsOfLayer(layer, found);
    });
    if (state.selection && state.selection.mask) found.add(state.selection.mask.data);
    if (state.lastSelection && state.lastSelection.mask) found.add(state.lastSelection.mask.data);
  };
  const bytesOf = (item) => (ArrayBuffer.isView(item) ? item.byteLength : item.width * item.height * 4);
  const historyOnlyBytes = (doc) => {
    const now = new Set();
    pixelsOfState(doc.state, now, new Set());
    const held = new Set();
    const seen = new Set();
    doc.history.forEach((entry) => pixelsOfState(entry.state, held, seen));
    let bytes = 0;
    held.forEach((item) => { if (!now.has(item)) bytes += bytesOf(item); });
    return bytes;
  };
  const trimHistory = (doc) => {
    while (doc.history.length > MIN_STEPS && historyOnlyBytes(doc) > HISTORY_BUDGET) {
      doc.history.shift();
      doc.historyIndex--;
    }
  };

  const isDirty = (doc) => doc.history[doc.historyIndex].id !== doc.savedId;

  const fileStamp = (file) => `${file.size}:${file.lastModified}`;

  // The file on disk behind a file the panel picked (bridge.js): Save writes over it. Told
  // by name, size and date, since the panel's input may hand on a copy of the File
  const fileHandles = new Map();
  const handleKey = (file) => `${file.name}|${fileStamp(file)}`;

  // Browsers limit a canvas's size and don't say so: past it, it stays blank. iPhones and
  // iPads stop at about 16.7 million pixels. A pixel in its far corner tells.
  const fitting = new Map();
  const canvasFits = (width, height) => {
    const key = `${width}x${height}`;
    if (!fitting.has(key)) {
      const canvas = document.createElement("canvas");
      let fits = false;
      try {
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.width === width && canvas.height === height && canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.fillRect(width - 1, height - 1, 1, 1);
          fits = ctx.getImageData(width - 1, height - 1, 1, 1).data[3] === 255;
        }
      } catch (error) {
        fits = false;
      }
      canvas.width = 0;
      canvas.height = 0;
      fitting.set(key, fits);
    }
    return fitting.get(key);
  };
  const refuseIfTooLarge = (width, height) => {
    if (!canvasFits(width, height)) throw Object.assign(new Error(`The page is too large for this browser: ${width} x ${height}`), { tooLarge: { width, height } });
  };

  const identities = new WeakMap();
  let lastIdentity = 0;
  const identity = (object) => {
    if (!object) return 0;
    if (!identities.has(object)) identities.set(object, ++lastIdentity);
    return identities.get(object);
  };

  // What the Magic Wand reads: the pixel layers on white, never the text
  const sampleData = (doc, everyLayer) => {
    const onlyActive = !everyLayer && !app.sampleAll && activeRaster(doc);
    // Pixels are never drawn on again once made: the same objects are the same picture
    const key = doc.state.layers.filter((layer) => layer.kind !== "text").map((layer) => [layer.id, layer.visible, layer.opacity, layer.blend, layer.group, layer.clipping, layer.dx, layer.dy, layer.left, layer.top, identity(layer.bitmap), identity(layer.mask), identity(layer.vectorMask), identity((layer.paint || NONE)[(layer.paint || NONE).length - 1]), (layer.paint || NONE).length].join(",")).join(";") + "|" + (onlyActive ? onlyActive.id : "all");
    if (doc.sampleCache && doc.sampleKey === key) return doc.sampleCache;
    const canvas = newCanvas(doc.width, doc.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, doc.width, doc.height);
    paintDoc(doc, ctx, { keep: true, skip: (layer) => layer.kind === "text" || (onlyActive && layer.id !== onlyActive.id) });
    doc.sampleCache = ctx.getImageData(0, 0, doc.width, doc.height).data;
    doc.sampleKey = key;
    return doc.sampleCache;
  };

  const activeRaster = (doc) => {
    const id = doc.state.activeIds[doc.state.activeIds.length - 1];
    return doc.state.layers.find((layer) => layer.id === id && layer.kind === "raster") || null;
  };

  // The pixels a click takes, as the Magic Wand finds them: the ones `similar` to the clicked
  // one, joined to it, or anywhere on the page when not contiguous. A byte per pixel, and the box
  // they fill (right < 0 when none).
  const floodMarks = (w, h, sx, sy, similar, contiguous) => {
    const seen = new Uint8Array(w * h);
    let left = w;
    let right = -1;
    let top = h;
    let bottom = -1;
    if (!contiguous) {
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          if (!similar(py * w + px)) continue;
          seen[py * w + px] = 1;
          if (px < left) left = px;
          if (px > right) right = px;
          if (py < top) top = py;
          if (py > bottom) bottom = py;
        }
      }
      return { seen, left, top, right, bottom };
    }
    const stack = [sx, sy];
    while (stack.length) {
      const py = stack.pop();
      let px = stack.pop();
      while (px >= 0 && !seen[py * w + px] && similar(py * w + px)) px--;
      px++;
      let up = false;
      let down = false;
      for (; px < w; px++) {
        const index = py * w + px;
        if (seen[index] || !similar(index)) break;
        seen[index] = 1;
        if (px < left) left = px;
        if (px > right) right = px;
        if (py < top) top = py;
        if (py > bottom) bottom = py;
        if (py > 0) {
          const above = index - w;
          if (!seen[above] && similar(above)) {
            if (!up) {
              stack.push(px, py - 1);
              up = true;
            }
          } else up = false;
        }
        if (py < h - 1) {
          const below = index + w;
          if (!seen[below] && similar(below)) {
            if (!down) {
              stack.push(px, py + 1);
              down = true;
            }
          } else down = false;
        }
      }
    }
    return { seen, left, top, right, bottom };
  };

  // Flood fill from a click, as the Magic Wand: within the tolerance of the
  // clicked pixel, on the page and the clean layer (never on the text layers,
  // so a bubble can be clicked again after it got its text)
  const floodSelect = (doc, x, y, tolerance) => {
    const data = sampleData(doc);
    const w = doc.width;
    const h = doc.height;
    const sx = Math.max(0, Math.min(w - 1, Math.round(x)));
    const sy = Math.max(0, Math.min(h - 1, Math.round(y)));
    const start = (sy * w + sx) * 4;
    const r0 = data[start];
    const g0 = data[start + 1];
    const b0 = data[start + 2];
    const similar = (p) => {
      const i = p * 4;
      return Math.abs(data[i] - r0) <= tolerance && Math.abs(data[i + 1] - g0) <= tolerance && Math.abs(data[i + 2] - b0) <= tolerance;
    };
    const { seen, left, top, right, bottom } = floodMarks(w, h, sx, sy, similar, app.contiguous !== false);
    const boxW = right - left + 1;
    const boxH = bottom - top + 1;
    const mask = new Uint8Array(boxW * boxH);
    for (let yy = 0; yy < boxH; yy++) {
      for (let xx = 0; xx < boxW; xx++) mask[yy * boxW + xx] = seen[(top + yy) * w + left + xx];
    }
    return makeSelection({ source: "wand", mask, boxW, boxH, left, top });
  };

  // A bubble, or what's around it? The page's margins and gutters run to its edges, and a panel's
  // background holds what's drawn on it: the bubbles, black or white inside, even those touching
  // the panel's border, and the faces. A bubble only holds its letters, small strokes around
  // small counters, and the white around it runs out of its box. Shares of the page.
  const BUBBLE_AT_EDGE = 0.08;
  const BUBBLE_MOST = 0.15;
  const BUBBLE_HOLE = 0.004;
  const BUBBLE_INNER_WHITE = 0.0015;
  const looksLikeBubble = (doc, selection) => {
    if (!selection.mask) return true;
    const { data: mask, width: w, height: h, left, top } = selection.mask;
    const page = doc.width * doc.height;
    let area = 0;
    for (let i = 0; i < mask.length; i++) area += mask[i];
    if (!area) return true;
    if (area > page * BUBBLE_MOST) return false;
    const atEdge = left <= 0 || top <= 0 || left + w >= doc.width || top + h >= doc.height;
    if (atEdge && area > page * BUBBLE_AT_EDGE) return false;
    const data = sampleData(doc);
    const white = new Uint8Array(w * h);
    for (let i = 0; i < white.length; i++) {
      if (mask[i]) continue;
      const p = ((top + Math.floor(i / w)) * doc.width + left + (i % w)) * 4;
      white[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114 >= 200 ? 1 : 0;
    }
    // Each patch of what isn't the region, inside its box: how big, and whether it reaches the
    // box's sides (so goes on outside it). `within` says which pixels make up a patch.
    const seen = new Uint8Array(w * h);
    const stack = [];
    const patch = (start, within) => {
      let size = 0;
      let open = false;
      seen[start] = 1;
      stack.push(start);
      while (stack.length) {
        const i = stack.pop();
        size++;
        const x = i % w;
        if (x === 0 || x === w - 1 || i < w || i >= w * (h - 1)) open = true;
        const next = (j) => {
          if (!seen[j] && within(j)) {
            seen[j] = 1;
            stack.push(j);
          }
        };
        if (x > 0) next(i - 1);
        if (x < w - 1) next(i + 1);
        if (i >= w) next(i - w);
        if (i < w * (h - 1)) next(i + w);
      }
      return { size, open };
    };
    // Holes, whatever their colour: a black bubble on a panel's background
    const outside = (i) => !mask[i];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] || seen[i]) continue;
      const hole = patch(i, outside);
      if (!hole.open && hole.size > page * BUBBLE_HOLE) return false;
    }
    // White patches held inside the box: a bubble, or a face, on the background tapped
    seen.fill(0);
    const isWhite = (i) => white[i] === 1;
    for (let i = 0; i < mask.length; i++) {
      if (!white[i] || seen[i]) continue;
      const inner = patch(i, isWhite);
      if (!inner.open && inner.size > page * BUBBLE_INNER_WHITE) return false;
    }
    return true;
  };

  /* -------------------------------- Color Range ------------------------------- */

  // Select > Color Range, judged as Photoshop judges it (as photocraft measured it against its
  // masks): how much each pixel belongs, 0 to 255. What belongs half or more is selected, which
  // is also where Photoshop draws its marching ants.
  const LINEAR = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  const labF = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  // CIE Lab (D50), on Photoshop's 8-bit Lab grid: L in steps of 1/2.55, a and b whole
  const labOf = (r, g, b) => {
    const lr = LINEAR[r];
    const lg = LINEAR[g];
    const lb = LINEAR[b];
    const fx = labF((0.4360747 * lr + 0.3850649 * lg + 0.1430804 * lb) / 0.96422);
    const fy = labF(0.2225045 * lr + 0.7168786 * lg + 0.0606169 * lb);
    const fz = labF((0.0139322 * lr + 0.0971045 * lg + 0.7141733 * lb) / 0.82521);
    return [Math.round((116 * fy - 16) * 2.55) / 2.55, Math.round(500 * (fx - fy)), Math.round(200 * (fy - fz))];
  };
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v)));

  // Sampled Colors: the Lab box the eyedropper's colours span. "Add to Sample" grows it;
  // "Subtract from Sample" reshapes it the way Photoshop does, an axis at a time: inside, the
  // nearer edge comes onto the colour; just outside, the edge steps in, by a fifth of the
  // fuzziness's width at a time. Further than Photoshop: the colour taken away is kept, and it
  // and the colours near it are left out, even when the box still spans them (red and blue
  // sampled, then blue taken away).
  const labRange = {
    point(rgb) {
      const lab = labOf(byte(rgb[0]), byte(rgb[1]), byte(rgb[2]));
      return { lo: lab.slice(), hi: lab.slice() };
    },
    add(range, rgb) {
      if (!range) return labRange.point(rgb);
      const lab = labOf(byte(rgb[0]), byte(rgb[1]), byte(rgb[2]));
      const minus = (range.minus || []).filter((m) => Math.max(Math.abs(m[0] - lab[0]) * 2.55, Math.abs(m[1] - lab[1]), Math.abs(m[2] - lab[2])) >= 1);
      return { lo: range.lo.map((v, k) => Math.min(v, lab[k])), hi: range.hi.map((v, k) => Math.max(v, lab[k])), minus };
    },
    subtract(range, rgb, fuzziness) {
      if (!range) return range;
      const lab = labOf(byte(rgb[0]), byte(rgb[1]), byte(rgb[2]));
      const fz = Math.max(0, Number(fuzziness) || 0);
      const lo = range.lo.slice();
      const hi = range.hi.slice();
      lab.forEach((m, k) => {
        if (m > lo[k] && m < hi[k]) {
          if (m - lo[k] < hi[k] - m) lo[k] = m;
          else hi[k] = m;
          return;
        }
        const q = (k === 0 ? fz / 2.55 : (fz * 256) / 255 / 3) / 5;
        if (q <= 0) return;
        const n = Math.floor((m <= lo[k] ? lo[k] - m : m - hi[k]) / q) + 1;
        if (n > 5) return;
        if (m <= lo[k]) lo[k] = Math.min(m + n * q, hi[k]);
        else hi[k] = Math.max(m - n * q, lo[k]);
      });
      return { lo, hi, minus: (range.minus || []).concat([lab]) };
    },
  };

  const RANGE_HUES = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 };
  const RANGE_TONES = { shadows: [0, 65], midtones: [105, 150], highlights: [190, 255] };
  // How much a colour belongs, 0 to 255, for the dialog's settings
  const rangeJudge = ({ mode, fuzziness, range }) => {
    const fuzz = Math.max(0, Number(fuzziness) || 0);
    if (mode === "sampled") {
      if (!range) return () => 0;
      const { lo, hi } = range;
      const outside = (v, l, h) => Math.max(l - v, v - h, 0);
      // a and b one step above the samples count half a unit more, one below half a unit less
      const ab = (v, l, h) => (v > h ? v - h + 0.5 : v < l ? Math.max(0, l - v - 0.5) : 0);
      const width = (fuzz * 256) / 255;
      // How much `lab` belongs to the box from `l` to `h`, 0 to 1
      const belongs = (lab, l, h) => {
        if (!(fuzz > 0)) return Math.max(outside(lab[0], l[0], h[0]) * 2.55, outside(lab[1], l[1], h[1]), outside(lab[2], l[2], h[2])) < 0.5 ? 1 : 0;
        // Hue counts three times as much as lightness; the farthest axis decides
        const t = Math.max(outside(lab[0], l[0], h[0]) * 2.55, 3 * ab(lab[1], l[1], h[1]), 3 * ab(lab[2], l[2], h[2])) / width;
        return t <= 0.5 ? 1 - 2 * t * t : t < 1 ? 2 * (1 - t) * (1 - t) : 0;
      };
      const minus = range.minus || [];
      return (r, g, b) => {
        const lab = labOf(r, g, b);
        let v = belongs(lab, lo, hi);
        for (let n = 0; v > 0 && n < minus.length; n++) v *= 1 - belongs(lab, minus[n], minus[n]);
        return Math.min(255, Math.floor(v * 256));
      };
    }
    if (mode in RANGE_HUES) {
      // Full at the family's hue, none 60° away, times the colour's strength: greys never,
      // dull colours partly. Dark colours weigh a little more, as in Photoshop.
      const center = RANGE_HUES[mode];
      return (r, g, b) => {
        const max = Math.max(r, g, b);
        const span = max - Math.min(r, g, b);
        if (!span) return 0;
        let h = max === r ? ((g - b) / span + 6) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
        h = Math.abs(h * 60 - center) % 360;
        h = Math.min(h, 360 - h);
        return byte(Math.max(0, 1 - h / 60) * (span / 255) * (2 - max / 255) * 255);
      };
    }
    if (mode in RANGE_TONES) {
      const [lo, hi] = RANGE_TONES[mode];
      const ramp = Math.max(1e-3, fuzz);
      return (r, g, b) => {
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        return byte((1 - Math.max(lo - l, l - hi, 0) / ramp) * 255);
      };
    }
    if (mode === "skin") {
      // Skin of every complexion lies in an ellipse of the YCbCr chroma plane (Chai & Ngan),
      // from pale to deep; fuzziness 100 fades out over one radius. Near-black and near-white,
      // whose colour is only noise, are left out.
      const angle = (-40 * Math.PI) / 180;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const ramp = Math.max(1e-3, fuzz / 100);
      return (r, g, b) => {
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b - 104;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b - 158;
        const d = Math.hypot((cos * cb + sin * cr) / 22, (cos * cr - sin * cb) / 14);
        const chroma = Math.max(0, Math.min(1, 1 - (d - 1) / ramp));
        return byte(chroma * Math.max(0, Math.min(1, (y - 25) / 30)) * Math.max(0, Math.min(1, (250 - y) / 20)) * 255);
      };
    }
    return () => 0;
  };

  // Each pixel's share, 0 to 255, of `data` (RGBA, `w` × `h`), `scale` times the page's size.
  // `localized`: only near where the colours were picked (Localized Color Clusters), fading
  // out at that many page pixels from the nearest.
  // A page has few colours of its own: each is judged once, in a memo over every colour kept
  // from one call to the next (32 MB, allocated once). Only the colours met are wiped after,
  // or the whole when there were too many to list.
  let rangeMemo = null;
  // Kept between the previews of one dialog (32 MB), let go once it's been quiet a while
  let rangeMemoTimer = 0;
  const rangeCoverage = (data, w, h, settings, scale = 1) => {
    const judge = rangeJudge(settings);
    const memo = w * h > 1 << 18 ? rangeMemo || (rangeMemo = new Uint16Array(1 << 24)) : null;
    if (memo) {
      clearTimeout(rangeMemoTimer);
      rangeMemoTimer = setTimeout(() => { rangeMemo = null; }, 20000);
    }
    const touched = memo ? new Uint32Array(1 << 16) : null;
    let met = 0;
    const out = new Uint8Array(w * h);
    const points = settings.mode === "sampled" && settings.localized > 0 ? (settings.points || []).map(([x, y]) => [x * scale, y * scale]) : [];
    const radius = Math.max(1, (settings.localized || 0) * scale);
    try {
      for (let y = 0, p = 0; y < h; y++) {
        for (let x = 0; x < w; x++, p++) {
          const i = p * 4;
          if (!data[i + 3]) continue;
          let k;
          if (memo) {
            const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
            k = memo[key];
            if (k) k -= 1;
            else {
              k = judge(data[i], data[i + 1], data[i + 2]);
              memo[key] = k + 1;
              if (met < touched.length) touched[met] = key;
              met++;
            }
          } else k = judge(data[i], data[i + 1], data[i + 2]);
          if (k && points.length) {
            let near = 0;
            for (let n = 0; n < points.length; n++) near = Math.max(near, 1 - Math.hypot(x - points[n][0], y - points[n][1]) / radius);
            k = Math.round(k * Math.max(0, near));
          }
          out[p] = settings.invert ? 255 - k : k;
        }
      }
    } catch (error) {
      // Judged halfway: the memo can't be trusted any more
      rangeMemo = null;
      throw error;
    }
    if (met > (touched ? touched.length : 0)) memo.fill(0);
    else for (let n = 0; n < met; n++) memo[touched[n]] = 0;
    return out;
  };

  /* ------------------------------ double bubbles ----------------------------- */

  // A double (or chained) bubble, one selected text per lobe, as TypeR's panel does it in
  // Photoshop. The wand looks for bubbles on the page and the clean layer, whatever the Magic
  // Wand's own settings.
  const BUBBLE_TOLERANCE = 20;
  const MIN_BUBBLE_AREA = 200;
  const bubbleAt = (doc, x, y) => {
    const data = sampleData(doc, true);
    const w = doc.width;
    const h = doc.height;
    const sx = Math.max(0, Math.min(w - 1, Math.round(x)));
    const sy = Math.max(0, Math.min(h - 1, Math.round(y)));
    const start = (sy * w + sx) * 4;
    const [r0, g0, b0] = [data[start], data[start + 1], data[start + 2]];
    const similar = (p) => {
      const i = p * 4;
      return Math.abs(data[i] - r0) <= BUBBLE_TOLERANCE && Math.abs(data[i + 1] - g0) <= BUBBLE_TOLERANCE && Math.abs(data[i + 2] - b0) <= BUBBLE_TOLERANCE;
    };
    const { seen, left, top, right, bottom } = floodMarks(w, h, sx, sy, similar, true);
    if (right < 0) return null;
    return { seen, w, bounds: rectFrom(left, top, right + 1, bottom + 1) };
  };
  const holds = (rect, x, y) => x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1;
  // A bubble is neither a speck nor most of the page
  const usableBubble = (rect, doc) => Boolean(rect) && rect.width * rect.height >= MIN_BUBBLE_AREA && rect.width * rect.height <= doc.width * doc.height * 0.45;
  // The bubble around a text: the wand from its centre, then from just around it when the
  // centre falls on a letter of the page. `best` reaches no other text, `loose` may.
  const probeBubble = (doc, box, sizePixels, others) => {
    const margin = Math.max(4, Math.round((Number.isFinite(sizePixels) ? sizePixels : 20) * 0.6));
    const points = [[box.xMid, box.yMid], [box.xMid, box.top - margin], [box.xMid, box.bottom + margin], [box.left - margin, box.yMid], [box.right + margin, box.yMid]];
    const found = { best: null, loose: null };
    const smaller = (current, next) => (!current || next.bounds.width * next.bounds.height < current.bounds.width * current.bounds.height ? next : current);
    points.forEach(([x, y]) => {
      if (found.best && found.best.whole) return;
      const region = bubbleAt(doc, x, y);
      if (!region || !usableBubble(region.bounds, doc) || !holds(region.bounds, box.xMid, box.yMid)) return;
      // Most of the text sits inside it, not beside it
      const b = region.bounds;
      if (Math.min(b.right, box.right) - Math.max(b.left, box.left) < box.width * 0.5 || Math.min(b.bottom, box.bottom) - Math.max(b.top, box.top) < box.height * 0.5) return;
      region.whole = x === box.xMid && y === box.yMid;
      found.loose = smaller(found.loose, region);
      if (!others.some((other) => holds(region.bounds, other.xMid, other.yMid))) found.best = smaller(found.best, region);
    });
    return found;
  };
  // The texts' order along an axis, when they don't overlap on it
  const separatedOrder = (boxes, lo, hi) => {
    const order = boxes.map((box, index) => ({ box, index, sum: box[lo] + box[hi] })).sort((a, b) => a.sum - b.sum);
    return order.every((entry, k) => !k || entry.box[lo] >= order[k - 1].box[hi]) ? order : null;
  };
  const cutLimits = (rect, count, order, lo, hi, loValue, hiValue) => {
    const limits = Array.from({ length: count }, () => [rect[lo], rect[hi]]);
    for (let k = 1; k < order.length; k++) {
      const cut = (loValue(order[k - 1]) + hiValue(order[k])) / 2;
      limits[order[k - 1].index][1] = cut;
      limits[order[k].index][0] = cut;
    }
    return limits;
  };
  // Cuts a merged bubble into one part per text, only along the axes where the texts are apart,
  // in the middle of the gap between them. Overlapping texts are cut between their centres, on
  // the axis they are furthest apart. Parts come back in the order of `boxes`.
  const splitBubble = (rect, boxes) => {
    const byX = separatedOrder(boxes, "left", "right");
    const byY = separatedOrder(boxes, "top", "bottom");
    if (!byX && !byY) {
      const xs = boxes.map((box) => box.xMid);
      const ys = boxes.map((box) => box.yMid);
      const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
      const mid = horizontal ? "xMid" : "yMid";
      const order = boxes.map((box, index) => ({ box, index, centre: box[mid] })).sort((a, b) => a.centre - b.centre);
      const centre = (entry) => entry.centre;
      const limits = horizontal ? cutLimits(rect, boxes.length, order, "left", "right", centre, centre) : cutLimits(rect, boxes.length, order, "top", "bottom", centre, centre);
      return boxes.map((box, i) => (horizontal ? rectFrom(limits[i][0], rect.top, limits[i][1], rect.bottom) : rectFrom(rect.left, limits[i][0], rect.right, limits[i][1])));
    }
    const xs = byX && cutLimits(rect, boxes.length, byX, "left", "right", (entry) => entry.box.right, (entry) => entry.box.left);
    const ys = byY && cutLimits(rect, boxes.length, byY, "top", "bottom", (entry) => entry.box.bottom, (entry) => entry.box.top);
    return boxes.map((box, i) => rectFrom(xs ? xs[i][0] : rect.left, ys ? ys[i][0] : rect.top, xs ? xs[i][1] : rect.right, ys ? ys[i][1] : rect.bottom));
  };
  // A round lobe is narrower than the merged shape across the cut: the bubble's own pixels
  // inside the cut give its real extent
  const tightLobe = (region, lobe, box, doc) => {
    const x0 = Math.max(0, Math.floor(lobe.left));
    const y0 = Math.max(0, Math.floor(lobe.top));
    const x1 = Math.min(doc.width, Math.ceil(lobe.right));
    const y1 = Math.min(doc.height, Math.ceil(lobe.bottom));
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let y = y0; y < y1; y++) {
      const row = y * region.w;
      for (let x = x0; x < x1; x++) {
        if (!region.seen[row + x]) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right < left) return null;
    const tight = rectFrom(left, top, right + 1, bottom + 1);
    return usableBubble(tight, doc) && holds(tight, box.xMid, box.yMid) ? tight : null;
  };
  // Where each text goes, in their order, or an error code for the panel
  const doubleBubbleRects = (doc, layers) => {
    const items = layers.map((layer) => ({ layer, box: boxOf(layer, doc), sizePixels: sizePxOf(layer.params.layerText.textStyleRange[0].textStyle, doc.resolution) }));
    if (items.some((item) => !item.box || item.box.width <= 0 || item.box.height <= 0)) return "doubleBubbleEmpty";
    const boxes = items.map((item) => item.box);
    const selection = doc.state.selection && doc.state.selection.bounds;
    // A selection holding every text's centre is the whole bubble
    if (selection && usableBubble(selection, doc) && boxes.every((box) => holds(selection, box.xMid, box.yMid))) return splitBubble(selection, boxes);
    const probes = items.map((item, i) => probeBubble(doc, item.box, item.sizePixels, boxes.filter((_, j) => j !== i)));
    if (probes.every((found) => found.best)) return probes.map((found) => found.best.bounds);
    // The lobes are one shape: the bubble found around all the texts, cut between them
    const candidates = probes.map((found) => found.loose).filter(Boolean);
    const whole = candidates.find((region) => boxes.every((box) => holds(region.bounds, box.xMid, box.yMid)));
    if (!whole) return "doubleBubbleNotFound";
    return splitBubble(whole.bounds, boxes).map((lobe, i) => tightLobe(whole, lobe, boxes[i], doc) || lobe);
  };

  // What the Magic Eraser reads without Sample All Layers: the active layer's own pixels,
  // transparent where it has none
  const layerPixels = (doc, layer) => {
    const canvas = newCanvas(doc.width, doc.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const visual = visualOf(layer, doc);
    if (visual) ctx.drawImage(visual.canvas, visual.x, visual.y);
    return ctx.getImageData(0, 0, doc.width, doc.height).data;
  };

  // The Magic Eraser's region from a click: an alpha mask on the page, with a pixel of soft edge
  // when anti-aliased (an edge pixel takes the mean of its 3×3, inside pixels at least half,
  // outside ones at most half, as photocraft does it). Colours are compared with their alpha,
  // and every fully transparent pixel is alike, whatever colour it hides.
  const magicRegion = (doc, layer, x, y) => {
    const w = doc.width;
    const h = doc.height;
    const sx = Math.floor(x);
    const sy = Math.floor(y);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
    const data = app.magicSampleAll ? sampleData(doc, true) : layerPixels(doc, layer);
    const tolerance = app.magicTolerance;
    const start = (sy * w + sx) * 4;
    const seed = [data[start], data[start + 1], data[start + 2], data[start + 3]];
    const similar = (p) => {
      const i = p * 4;
      if (seed[3] === 0 && data[i + 3] === 0) return true;
      return Math.abs(data[i] - seed[0]) <= tolerance && Math.abs(data[i + 1] - seed[1]) <= tolerance && Math.abs(data[i + 2] - seed[2]) <= tolerance && Math.abs(data[i + 3] - seed[3]) <= tolerance;
    };
    const { seen, left, top, right, bottom } = floodMarks(w, h, sx, sy, similar, app.magicContiguous !== false);
    if (right < 0) return null;
    const soft = app.magicAntiAlias !== false;
    const pad = soft ? 1 : 0;
    const x0 = Math.max(0, left - pad);
    const y0 = Math.max(0, top - pad);
    const x1 = Math.min(w, right + 1 + pad);
    const y1 = Math.min(h, bottom + 1 + pad);
    const canvas = newCanvas(x1 - x0, y1 - y0);
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(canvas.width, canvas.height);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const v = seen[py * w + px];
        let alpha = v ? 255 : 0;
        if (soft) {
          let sum = 0;
          let edge = false;
          for (let ny = py - 1; ny <= py + 1; ny++) {
            for (let nx = px - 1; nx <= px + 1; nx++) {
              const n = nx < 0 || ny < 0 || nx >= w || ny >= h ? v : seen[ny * w + nx];
              if (n !== v) edge = true;
              sum += n;
            }
          }
          if (edge) alpha = Math.round((v ? 0.5 + sum / 18 : sum / 18) * 255);
        }
        image.data[((py - y0) * canvas.width + (px - x0)) * 4 + 3] = alpha;
      }
    }
    ctx.putImageData(image, 0, 0);
    // Only inside the selection, if there is one
    const selection = doc.state.selection;
    if (selection) {
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(selectionCanvas(selection), selection.bounds.left - x0, selection.bounds.top - y0);
    }
    return { canvas, x: x0, y: y0 };
  };

  const makeSelection = ({ source, mask, boxW, boxH, left, top, polygon, rect, trigger }) => {
    if (rect) {
      return {
        source: "rectangle",
        bounds: rectFrom(rect.left, rect.top, rect.right, rect.bottom),
        rings: [[[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]],
        mask: null,
        trigger,
      };
    }
    let rings = traceMask(mask, boxW, boxH, left, top)
      .filter((ring) => ringArea(ring) >= 9)
      .map((ring) => simplifyRing(ring, 1.1))
      .filter((ring) => ring.length >= 3);
    // Photoshop refuses too heavy a work path, and a selection of screentone
    // would be one: keep its largest outlines
    if (rings.length > 300) rings = rings.sort((a, b) => ringArea(b) - ringArea(a)).slice(0, 300);
    let sum = 0;
    rings.forEach((ring) => { sum += ring.length; });
    if (sum > 3800) {
      rings = rings.map((ring) => (ring.length > 60 ? simplifyRing(ring, 2.2) : ring));
    }
    return {
      source,
      bounds: rectFrom(left, top, left + boxW, top + boxH),
      rings,
      mask: { data: mask, width: boxW, height: boxH, left, top },
      polygon: polygon || null,
      trigger,
    };
  };

  const polygonSelection = (doc, points, trigger) => {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const left = Math.max(0, Math.floor(Math.min(...xs)));
    const top = Math.max(0, Math.floor(Math.min(...ys)));
    const right = Math.min(doc.width, Math.ceil(Math.max(...xs)));
    const bottom = Math.min(doc.height, Math.ceil(Math.max(...ys)));
    const boxW = right - left;
    const boxH = bottom - top;
    if (boxW < 2 || boxH < 2) return null;
    const c = document.createElement("canvas");
    c.width = boxW;
    c.height = boxH;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p[0] - left, p[1] - top) : ctx.moveTo(p[0] - left, p[1] - top)));
    ctx.closePath();
    ctx.fill();
    const px = ctx.getImageData(0, 0, boxW, boxH).data;
    const mask = new Uint8Array(boxW * boxH);
    for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
    return makeSelection({ source: "lasso", mask, boxW, boxH, left, top, polygon: points, trigger });
  };

  const ellipseSelection = (doc, left, top, right, bottom, trigger) => {
    const x0 = Math.max(0, Math.floor(left));
    const y0 = Math.max(0, Math.floor(top));
    const x1 = Math.min(doc.width, Math.ceil(right));
    const y1 = Math.min(doc.height, Math.ceil(bottom));
    const boxW = x1 - x0;
    const boxH = y1 - y0;
    if (boxW < 2 || boxH < 2) return null;
    const c = newCanvas(boxW, boxH);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.beginPath();
    ctx.ellipse((left + right) / 2 - x0, (top + bottom) / 2 - y0, (right - left) / 2, (bottom - top) / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    const px = ctx.getImageData(0, 0, boxW, boxH).data;
    const mask = new Uint8Array(boxW * boxH);
    for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
    const selection = makeSelection({ source: "ellipse", mask, boxW, boxH, left: x0, top: y0, trigger });
    selection.ellipse = { left: x0, top: y0, right: x1, bottom: y1 };
    return selection;
  };

  // A selection from the pixels marked in `buf`, a `bw` × `bh` box of the page from (`x0`,
  // `y0`): cut down to what is marked (the box itself when it is all used)
  const fromBoxMask = (buf, x0, y0, bw, bh, source) => {
    let left = bw;
    let top = -1;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < bh; y++) {
      const row = y * bw;
      let x = 0;
      while (x < bw && !buf[row + x]) x++;
      if (x === bw) continue;
      let end = bw - 1;
      while (!buf[row + end]) end--;
      if (x < left) left = x;
      if (end > right) right = end;
      if (top < 0) top = y;
      bottom = y;
    }
    if (right < 0) return null;
    const boxW = right - left + 1;
    const boxH = bottom - top + 1;
    let mask = buf;
    if (boxW !== bw || boxH !== bh) {
      mask = new Uint8Array(boxW * boxH);
      for (let y = 0; y < boxH; y++) {
        const row = (top + y) * bw + left;
        mask.set(buf.subarray(row, row + boxW), y * boxW);
      }
    }
    return makeSelection({ source: source || "mixed", mask, boxW, boxH, left: x0 + left, top: y0 + top });
  };
  const fromFullMask = (doc, full, source) => fromBoxMask(full, 0, 0, doc.width, doc.height, source);

  // The page pixels a selection can cover: its mask's box, or the whole pixels its rectangle
  // reaches, on the page
  const selectionBox = (doc, selection) => {
    const b = selection.bounds;
    const m = selection.mask;
    const left = Math.max(0, m ? m.left : Math.floor(b.left));
    const top = Math.max(0, m ? m.top : Math.floor(b.top));
    const right = Math.max(left, Math.min(doc.width, m ? m.left + m.width : Math.ceil(b.right)));
    const bottom = Math.max(top, Math.min(doc.height, m ? m.top + m.height : Math.ceil(b.bottom)));
    return { left, top, right, bottom };
  };
  // Marks `value` where a selection covers `buf`, a box of the page `bw` wide from (`x0`, `y0`)
  const paintSelection = (doc, selection, buf, x0, y0, bw, value) => {
    const box = selectionBox(doc, selection);
    const left = Math.max(box.left, x0);
    const right = Math.min(box.right, x0 + bw);
    const top = Math.max(box.top, y0);
    const bottom = Math.min(box.bottom, y0 + buf.length / bw);
    const m = selection.mask;
    for (let y = top; y < bottom; y++) {
      const at = (y - y0) * bw - x0;
      if (!m) {
        buf.fill(value, at + left, at + right);
        continue;
      }
      const row = (y - m.top) * m.width - m.left;
      for (let x = left; x < right; x++) if (m.data[row + x]) buf[at + x] = value;
    }
  };
  const boxMaskOf = (doc, selection, box) => {
    const buf = new Uint8Array((box.right - box.left) * (box.bottom - box.top));
    paintSelection(doc, selection, buf, box.left, box.top, box.right - box.left, 1);
    return buf;
  };

  const fullMaskOf = (doc, selection) => {
    const full = new Uint8Array(doc.width * doc.height);
    paintSelection(doc, selection, full, 0, 0, doc.width, 1);
    return full;
  };

  // Shift adds, Alt takes away, both keep what the two have in common. Only the part of the
  // page the result can reach is looked at: the two boxes together, the first, or their overlap.
  const combineSelections = (doc, current, incoming, mode) => {
    const a = selectionBox(doc, current);
    const b = selectionBox(doc, incoming);
    const box = mode === "add"
      ? { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }
      : mode === "subtract" ? a
        : { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
    const bw = box.right - box.left;
    const bh = box.bottom - box.top;
    if (bw <= 0 || bh <= 0) return null;
    const out = boxMaskOf(doc, current, box);
    if (mode === "add") paintSelection(doc, incoming, out, box.left, box.top, bw, 1);
    else if (mode === "subtract") paintSelection(doc, incoming, out, box.left, box.top, bw, 0);
    else {
      const other = boxMaskOf(doc, incoming, box);
      for (let i = 0; i < out.length; i++) out[i] &= other[i];
    }
    return fromBoxMask(out, box.left, box.top, bw, bh);
  };

  const invertSelection = (doc, selection) => {
    const full = new Uint8Array(doc.width * doc.height).fill(1);
    paintSelection(doc, selection, full, 0, 0, doc.width, 0);
    return fromFullMask(doc, full);
  };

  // Drawn around the selection only: what it grows into lies within the radius of it
  const growSelection = (doc, selection, radius) => {
    const b = selection.bounds;
    const margin = Math.ceil(Math.abs(radius)) + 2;
    const x0 = Math.max(0, Math.floor(b.left) - margin);
    const y0 = Math.max(0, Math.floor(b.top) - margin);
    const bw = Math.min(doc.width, Math.ceil(b.right) + margin) - x0;
    const bh = Math.min(doc.height, Math.ceil(b.bottom) + margin) - y0;
    if (bw <= 0 || bh <= 0) return null;
    const c = newCanvas(bw, bh);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.translate(-x0, -y0);
    const path = new Path2D();
    selection.rings.forEach((ring) => {
      ring.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
      path.closePath();
    });
    ctx.fill(path, "evenodd");
    ctx.lineWidth = Math.abs(radius) * 2;
    ctx.lineJoin = "round";
    if (radius < 0) ctx.globalCompositeOperation = "destination-out";
    ctx.stroke(path);
    const px = ctx.getImageData(0, 0, bw, bh).data;
    const full = new Uint8Array(bw * bh);
    for (let i = 0; i < full.length; i++) full[i] = px[i * 4 + 3] > 127 ? 1 : 0;
    return fromBoxMask(full, x0, y0, bw, bh);
  };

  const translateSelection = (selection, dx, dy) => {
    const b = selection.bounds;
    const moved = Object.assign({}, selection, {
      bounds: rectFrom(b.left + dx, b.top + dy, b.right + dx, b.bottom + dy),
      rings: selection.rings.map((ring) => ring.map((p) => [p[0] + dx, p[1] + dy])),
      trigger: undefined,
      moved: true,
    });
    if (selection.mask) moved.mask = Object.assign({}, selection.mask, { left: selection.mask.left + dx, top: selection.mask.top + dy });
    return moved;
  };

  const selectionContains = (selection, x, y) => {
    const b = selection.bounds;
    if (x < b.left || y < b.top || x >= b.right || y >= b.bottom) return false;
    if (!selection.mask) return true;
    const m = selection.mask;
    return Boolean(m.data[(Math.floor(y) - m.top) * m.width + Math.floor(x) - m.left]);
  };

  const rectMaskIterate = (selection, visit) => {
    const b = selection.bounds;
    if (selection.mask) {
      const m = selection.mask;
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) if (m.data[y * m.width + x]) visit(m.left + x, m.top + y);
      }
      return;
    }
    for (let y = Math.max(0, Math.floor(b.top)); y < b.bottom; y++) {
      for (let x = Math.max(0, Math.floor(b.left)); x < b.right; x++) visit(x, y);
    }
  };

  const selectionHistograms = (doc, selection) => {
    const data = sampleData(doc);
    const hist = [new Array(256).fill(0), new Array(256).fill(0), new Array(256).fill(0)];
    rectMaskIterate(selection, (x, y) => {
      if (x >= doc.width || y >= doc.height) return;
      const i = (y * doc.width + x) * 4;
      hist[0][data[i]]++;
      hist[1][data[i + 1]]++;
      hist[2][data[i + 2]]++;
    });
    return hist;
  };

  /* ============ the Bubble Cleaner: a bubble's text off, in its own colours ============ */

  // A bubble is a plain area that wraps its lettering: the letters are the holes in it. They
  // are painted over with the colours around them, carried in from every side, so a white, a
  // black, a pink or a shaded bubble all come out as they were without their text.

  // Pixels close to a seed's colour, joined to it, inside a window of the page (window
  // coordinates). They get `id` in `labels`, which several floods share.
  const cleanFlood = (data, pageW, win, sx, sy, tolerance, labels, id) => {
    const w = win.right - win.left;
    const h = win.bottom - win.top;
    const at = ((sy + win.top) * pageW + sx + win.left) * 4;
    const seed = [data[at], data[at + 1], data[at + 2]];
    const close = (x, y) => {
      const i = ((y + win.top) * pageW + x + win.left) * 4;
      return Math.abs(data[i] - seed[0]) <= tolerance && Math.abs(data[i + 1] - seed[1]) <= tolerance && Math.abs(data[i + 2] - seed[2]) <= tolerance;
    };
    const mask = labels;
    const stack = [sx, sy];
    let area = 0;
    let left = sx;
    let right = sx;
    let top = sy;
    let bottom = sy;
    while (stack.length) {
      const y = stack.pop();
      let x = stack.pop();
      while (x >= 0 && !mask[y * w + x] && close(x, y)) x--;
      x++;
      let up = false;
      let down = false;
      for (; x < w; x++) {
        const index = y * w + x;
        if (mask[index] || !close(x, y)) break;
        mask[index] = id;
        area++;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (y > 0) {
          if (!mask[index - w] && close(x, y - 1)) {
            if (!up) {
              stack.push(x, y - 1);
              up = true;
            }
          } else up = false;
        }
        if (y < h - 1) {
          if (!mask[index + w] && close(x, y + 1)) {
            if (!down) {
              stack.push(x, y + 1);
              down = true;
            }
          } else down = false;
        }
      }
    }
    return { id, area, seed, box: { left, top, right: right + 1, bottom: bottom + 1 } };
  };

  // What the region wraps: the pixels outside it that can't reach the window's edge without
  // crossing it. Each hole is measured, to tell lettering from a drawing inside the bubble.
  const cleanHoles = (region, w, h) => {
    const { mask } = region;
    const outside = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    const push = (index) => {
      if (mask[index] || outside[index]) return;
      outside[index] = 1;
      queue[tail++] = index;
    };
    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      push(y * w);
      push(y * w + w - 1);
    }
    // Past a lasso's outline is outside too, wherever the outline goes
    if (region.fence) for (let i = 0; i < w * h; i++) if (region.fence[i]) push(i);
    while (head < tail) {
      const index = queue[head++];
      const x = index % w;
      if (x > 0) push(index - 1);
      if (x < w - 1) push(index + 1);
      if (index >= w) push(index - w);
      if (index < w * (h - 1)) push(index + w);
    }
    // The holes, one by one
    const label = new Int32Array(w * h);
    const sizes = [0];
    for (let start = 0; start < w * h; start++) {
      if (mask[start] || outside[start] || label[start]) continue;
      const id = sizes.length;
      let size = 0;
      head = 0;
      tail = 0;
      label[start] = id;
      queue[tail++] = start;
      while (head < tail) {
        const index = queue[head++];
        size++;
        const x = index % w;
        const near = [x > 0 ? index - 1 : -1, x < w - 1 ? index + 1 : -1, index >= w ? index - w : -1, index < w * (h - 1) ? index + w : -1];
        for (let k = 0; k < 4; k++) {
          const n = near[k];
          if (n < 0 || mask[n] || outside[n] || label[n]) continue;
          label[n] = id;
          queue[tail++] = n;
        }
      }
      sizes.push(size);
    }
    return { outside, label, sizes };
  };

  // How far each pixel of a shape is from its edge, in pixels (0 outside it)
  const cleanDistances = (inside, w, h) => {
    const d = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      d[i] = inside[i] && x > 0 && x < w - 1 && i >= w && i < w * (h - 1) ? 1e9 : inside[i] ? 1 : 0;
    }
    const D = 1.4142;
    for (let y = 1; y < h; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (d[i] > 1) d[i] = Math.min(d[i], d[i - 1] + 1, d[i - w] + 1, d[i - w - 1] + D, d[i - w + 1] + D);
      }
    }
    for (let y = h - 2; y >= 0; y--) {
      for (let x = w - 2; x > 0; x--) {
        const i = y * w + x;
        if (d[i] > 1) d[i] = Math.min(d[i], d[i + 1] + 1, d[i + w] + 1, d[i + w + 1] + D, d[i + w - 1] + D);
      }
    }
    return d;
  };

  // How thick a flooded region is at its thickest: a letter's stroke is thin, a bubble isn't
  const cleanThickness = (labels, id, w, box) => {
    const bw = box.right - box.left;
    const bh = box.bottom - box.top;
    const inside = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) inside[y * bw + x] = labels[(y + box.top) * w + x + box.left] === id ? 1 : 0;
    }
    const d = cleanDistances(inside, bw, bh);
    let most = 0;
    for (let i = 0; i < d.length; i++) if (d[i] > most) most = d[i];
    return most;
  };

  // A shape grown by `r` pixels on every side (a square)
  const cleanGrow = (shape, w, h, r) => {
    const across = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      // From both sides: the nearest marked pixel to the left, then to the right
      let prev = -1e9;
      for (let x = 0; x < w; x++) {
        if (shape[y * w + x]) prev = x;
        if (x - prev <= r) across[y * w + x] = 1;
      }
      let nextOn = 1e9;
      for (let x = w - 1; x >= 0; x--) {
        if (shape[y * w + x]) nextOn = x;
        if (nextOn - x <= r) across[y * w + x] = 1;
      }
    }
    const out = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      let prev = -1e9;
      for (let y = 0; y < h; y++) {
        if (across[y * w + x]) prev = y;
        if (y - prev <= r) out[y * w + x] = 1;
      }
      let nextOn = 1e9;
      for (let y = h - 1; y >= 0; y--) {
        if (across[y * w + x]) nextOn = y;
        if (nextOn - y <= r) out[y * w + x] = 1;
      }
    }
    return out;
  };

  // Colours carried into the unknown pixels from the known ones around them, coarser and
  // coarser, then back down (push-pull). Smooth enough for a shaded bubble, exact on a flat one.
  const cleanInpaint = (rgb, known, w, h) => {
    const levels = [];
    let lw = w;
    let lh = h;
    let r = new Float32Array(w * h);
    let g = new Float32Array(w * h);
    let b = new Float32Array(w * h);
    let k = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!known[i]) continue;
      r[i] = rgb[i * 3];
      g[i] = rgb[i * 3 + 1];
      b[i] = rgb[i * 3 + 2];
      k[i] = 1;
    }
    levels.push({ w: lw, h: lh, r, g, b, k });
    while (lw > 1 || lh > 1) {
      const nw = Math.max(1, Math.ceil(lw / 2));
      const nh = Math.max(1, Math.ceil(lh / 2));
      const nr = new Float32Array(nw * nh);
      const ng = new Float32Array(nw * nh);
      const nb = new Float32Array(nw * nh);
      const nk = new Float32Array(nw * nh);
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const i = y * lw + x;
          if (!k[i]) continue;
          const j = (y >> 1) * nw + (x >> 1);
          nr[j] += r[i];
          ng[j] += g[i];
          nb[j] += b[i];
          nk[j] += k[i];
        }
      }
      lw = nw;
      lh = nh;
      r = nr;
      g = ng;
      b = nb;
      k = nk;
      levels.push({ w: lw, h: lh, r, g, b, k });
    }
    // Every level as plain colours, filled from the level above where nothing was known
    const top = levels[levels.length - 1];
    const colours = [];
    const flat = (level) => {
      const out = new Float32Array(level.w * level.h * 3);
      for (let i = 0; i < level.w * level.h; i++) {
        if (!level.k[i]) continue;
        out[i * 3] = level.r[i] / level.k[i];
        out[i * 3 + 1] = level.g[i] / level.k[i];
        out[i * 3 + 2] = level.b[i] / level.k[i];
      }
      return out;
    };
    colours[levels.length - 1] = flat(top);
    for (let n = levels.length - 2; n >= 0; n--) {
      const level = levels[n];
      const above = levels[n + 1];
      const coarse = colours[n + 1];
      const out = flat(level);
      for (let y = 0; y < level.h; y++) {
        for (let x = 0; x < level.w; x++) {
          const i = y * level.w + x;
          if (level.k[i]) continue;
          // Bilinear, from the coarser level's centres
          const fx = Math.max(0, Math.min(above.w - 1, (x + 0.5) / 2 - 0.5));
          const fy = Math.max(0, Math.min(above.h - 1, (y + 0.5) / 2 - 0.5));
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const x1 = Math.min(above.w - 1, x0 + 1);
          const y1 = Math.min(above.h - 1, y0 + 1);
          const ax = fx - x0;
          const ay = fy - y0;
          const a = (y0 * above.w + x0) * 3;
          const bb = (y0 * above.w + x1) * 3;
          const c = (y1 * above.w + x0) * 3;
          const d = (y1 * above.w + x1) * 3;
          for (let o = 0; o < 3; o++) out[i * 3 + o] = (coarse[a + o] * (1 - ax) + coarse[bb + o] * ax) * (1 - ay) + (coarse[c + o] * (1 - ax) + coarse[d + o] * ax) * ay;
        }
      }
      colours[n] = out;
    }
    return colours[0];
  };

  // The plan of a clean: what gets painted, in which colours. `at` is a click, `box` a dragged
  // box, `points` a lasso's outline. Returns { left, top, width, height, pixels (RGBA) } or { error }.
  const planBubbleClean = (doc, options) => {
    const data = sampleData(doc, true);
    const pageW = doc.width;
    const pageH = doc.height;
    const tolerance = Math.max(0, Math.min(255, options.tolerance));
    const margin = Math.max(0, Math.min(20, Math.round(options.margin)));
    let win;
    let region;
    let labels;
    let holeLimit;
    let fence = null;
    if (options.points) {
      // A lasso works as a box would, only what is past its outline is left out
      const xs = options.points.map((p) => p[0]);
      const ys = options.points.map((p) => p[1]);
      options = Object.assign({}, options, { box: { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) } });
    }
    if (options.box) {
      const b = options.box;
      win = { left: Math.max(0, Math.floor(b.left)), top: Math.max(0, Math.floor(b.top)), right: Math.min(pageW, Math.ceil(b.right)), bottom: Math.min(pageH, Math.ceil(b.bottom)) };
      const w = win.right - win.left;
      const h = win.bottom - win.top;
      if (w < 4 || h < 4) return { error: "nothing" };
      let inside = w * h;
      if (options.points) {
        const shape = newCanvas(w, h);
        const ctx = shape.getContext("2d", { willReadFrequently: true });
        ctx.beginPath();
        options.points.forEach((p, n) => (n ? ctx.lineTo : ctx.moveTo).call(ctx, p[0] - win.left, p[1] - win.top));
        ctx.closePath();
        ctx.fill();
        const alpha = ctx.getImageData(0, 0, w, h).data;
        fence = new Uint8Array(w * h);
        inside = 0;
        for (let i = 0; i < w * h; i++) {
          if (alpha[i * 4 + 3] < 128) fence[i] = 1;
          else inside++;
        }
        if (inside < 16) return { error: "nothing" };
      }
      // The background is the box's most common colour, and every pixel near it
      const bins = new Map();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (fence && fence[y * w + x]) continue;
          const i = ((y + win.top) * pageW + x + win.left) * 4;
          const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
          bins.set(key, (bins.get(key) || 0) + 1);
        }
      }
      let best = -1;
      let count = 0;
      bins.forEach((n, key) => {
        if (n > count) {
          count = n;
          best = key;
        }
      });
      const seed = [((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4];
      labels = new Uint8Array(w * h);
      let area = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (fence && fence[y * w + x]) continue;
          const i = ((y + win.top) * pageW + x + win.left) * 4;
          if (Math.abs(data[i] - seed[0]) <= tolerance && Math.abs(data[i + 1] - seed[1]) <= tolerance && Math.abs(data[i + 2] - seed[2]) <= tolerance) {
            labels[y * w + x] = 1;
            area++;
          }
        }
      }
      if (area < inside * 0.3) return { error: "plain" };
      region = { id: 1, area, seed, box: { left: 0, top: 0, right: w, bottom: h } };
      holeLimit = Infinity;
    } else {
      // A click: the region under it, or, on a letter, the plain area around the letter
      win = { left: 0, top: 0, right: pageW, bottom: pageH };
      const x = Math.max(0, Math.min(pageW - 1, Math.round(options.x)));
      const y = Math.max(0, Math.min(pageH - 1, Math.round(options.y)));
      const THICK = 6;
      const leaks = (r) => {
        const edges = (r.box.left <= 0 ? 1 : 0) + (r.box.top <= 0 ? 1 : 0) + (r.box.right >= pageW ? 1 : 0) + (r.box.bottom >= pageH ? 1 : 0);
        return edges >= 3 || (r.box.right - r.box.left) * (r.box.bottom - r.box.top) > pageW * pageH * 0.6;
      };
      labels = new Uint8Array(pageW * pageH);
      const first = cleanFlood(data, pageW, win, x, y, tolerance, labels, 1);
      region = first;
      if (cleanThickness(labels, 1, pageW, first.box) < THICK) {
        // Out from the click in 16 directions: past the letter, what each direction meets
        const found = new Map();
        const tried = [first];
        let next = 2;
        for (let n = 0; n < 16; n++) {
          const angle = (n * Math.PI) / 8;
          const dx = Math.cos(angle);
          const dy = Math.sin(angle);
          let past = -1;
          for (let step = 1; step < 400; step++) {
            const px = Math.round(x + dx * step);
            const py = Math.round(y + dy * step);
            if (px < 0 || py < 0 || px >= pageW || py >= pageH) break;
            const owner = labels[py * pageW + px];
            if (past < 0 && owner === 1) continue;
            if (past < 0) past = step;
            if (step - past > 6) break;
            let r = owner ? tried[owner - 1] : null;
            if (!r) {
              if (next > 255) break;
              r = cleanFlood(data, pageW, win, px, py, tolerance, labels, next++);
              r.thick = leaks(r) ? 0 : cleanThickness(labels, r.id, pageW, r.box);
              tried.push(r);
            }
            if (r === first || !(r.thick >= THICK)) continue;
            found.set(r, (found.get(r) || 0) + 1);
            break;
          }
        }
        let votes = 0;
        found.forEach((n, r) => {
          if (n > votes) {
            votes = n;
            region = r;
          }
        });
        if (region === first) return { error: "background" };
      }
      if (leaks(region)) return { error: "open" };
      holeLimit = 0.18;
    }
    const w = win.right - win.left;
    const h = win.bottom - win.top;
    // The work happens in the region's box, one pixel wider so that its edge is outside
    const rb = region.box;
    const area = { left: Math.max(0, rb.left - 1), top: Math.max(0, rb.top - 1), right: Math.min(w, rb.right + 1), bottom: Math.min(h, rb.bottom + 1) };
    const aw = area.right - area.left;
    const ah = area.bottom - area.top;
    const mask = new Uint8Array(aw * ah);
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) mask[y * aw + x] = labels[(y + area.top) * w + x + area.left] === region.id ? 1 : 0;
    }
    // A box's region is the whole box: the fence fits the area as it is
    const { outside, label, sizes } = cleanHoles({ mask, fence }, aw, ah);
    let filled = region.area;
    for (let i = 1; i < sizes.length; i++) filled += sizes[i];
    if (!options.box && filled > pageW * pageH * 0.2) return { error: "open" };
    // A hole too big or too thick for lettering is a drawing, or a bubble in a panel: it stays
    let keep = sizes.map((size, id) => id > 0 && size <= filled * holeLimit);
    if (!options.box) {
      const depth = cleanDistances(label, aw, ah);
      const thickest = new Float32Array(sizes.length);
      for (let i = 0; i < aw * ah; i++) if (label[i] && depth[i] > thickest[label[i]]) thickest[label[i]] = depth[i];
      const most = Math.max(12, Math.min(pageW, pageH) * 0.04);
      keep = keep.map((on, id) => on && thickest[id] <= most);
    }
    const unknown = new Uint8Array(aw * ah);
    let any = false;
    for (let i = 0; i < aw * ah; i++) {
      if (label[i] && keep[label[i]]) {
        unknown[i] = 1;
        any = true;
      }
    }
    if (!any) return { error: "nothing" };
    // A pixel against the outline or a drawing is partly theirs: it is left as it is, and it
    // doesn't tell the bubble's colour
    const other = (i) => outside[i] === 1 || (label[i] > 0 && !keep[label[i]]);
    const againstOther = (x, y) => {
      for (let ny = Math.max(0, y - 1); ny <= Math.min(ah - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(aw - 1, x + 1); nx++) if (other(ny * aw + nx)) return true;
      }
      return false;
    };
    // The lettering's soft edge, and the halo a JPEG leaves around it
    const grown = cleanGrow(unknown, aw, ah, margin);
    const near = cleanGrow(unknown, aw, ah, margin + 3);
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) {
        const i = y * aw + x;
        if (!unknown[i] && mask[i] && grown[i] && !againstOther(x, y)) unknown[i] = 2;
      }
    }
    // A bubble of one colour, JPEG noise aside, gets that colour all over, as TypeR's Auto
    // Clean does: no trace of the letters' halo is left. A shaded one gets its own shades.
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    const pageAt = (x, y) => ((y + area.top + win.top) * pageW + x + area.left + win.left) * 4;
    let plainCount = 0;
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) {
        const i = y * aw + x;
        if (!mask[i] || near[i] || againstOther(x, y)) continue;
        const pi = pageAt(x, y);
        hist[0][data[pi]]++;
        hist[1][data[pi + 1]]++;
        hist[2][data[pi + 2]]++;
        plainCount++;
      }
    }
    const median = hist.map((h) => {
      let seen = 0;
      for (let v = 0; v < 256; v++) {
        seen += h[v];
        if (seen * 2 >= plainCount) return v;
      }
      return 255;
    });
    let flat = false;
    if (plainCount >= 200) {
      const spread = new Uint32Array(256);
      for (let y = 0; y < ah; y++) {
        for (let x = 0; x < aw; x++) {
          const i = y * aw + x;
          if (!mask[i] || near[i] || againstOther(x, y)) continue;
          const pi = pageAt(x, y);
          spread[Math.max(Math.abs(data[pi] - median[0]), Math.abs(data[pi + 1] - median[1]), Math.abs(data[pi + 2] - median[2]))]++;
        }
      }
      let seen = 0;
      let p90 = 255;
      for (let v = 0; v < 256; v++) {
        seen += spread[v];
        if (seen >= plainCount * 0.9) {
          p90 = v;
          break;
        }
      }
      flat = p90 <= 12;
    }
    // A box only cleans what it holds: painting all of it would show its edges
    if (flat && !options.box) {
      for (let y = 0; y < ah; y++) {
        for (let x = 0; x < aw; x++) {
          const i = y * aw + x;
          if (!unknown[i] && mask[i] && !againstOther(x, y)) unknown[i] = 2;
        }
      }
    }
    // Only around what changes, with some of the bubble around it to read the colours from
    let ux0 = aw;
    let uy0 = ah;
    let ux1 = -1;
    let uy1 = -1;
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) {
        if (!unknown[y * aw + x]) continue;
        if (x < ux0) ux0 = x;
        if (x > ux1) ux1 = x;
        if (y < uy0) uy0 = y;
        if (y > uy1) uy1 = y;
      }
    }
    const pad = flat ? 0 : 12 + margin * 2;
    const cx0 = Math.max(0, ux0 - pad);
    const cy0 = Math.max(0, uy0 - pad);
    const cw = Math.min(aw, ux1 + 1 + pad) - cx0;
    const ch = Math.min(ah, uy1 + 1 + pad) - cy0;
    let colourAt;
    if (flat) colourAt = () => median;
    else {
      const rgb = new Float32Array(cw * ch * 3);
      const known = new Uint8Array(cw * ch);
      let knownCount = 0;
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const ai = (y + cy0) * aw + x + cx0;
          if (!mask[ai] || near[ai] || againstOther(x + cx0, y + cy0)) continue;
          const pi = pageAt(x + cx0, y + cy0);
          const i = y * cw + x;
          rgb[i * 3] = data[pi];
          rgb[i * 3 + 1] = data[pi + 1];
          rgb[i * 3 + 2] = data[pi + 2];
          known[i] = 1;
          knownCount++;
        }
      }
      if (!knownCount) return { error: "nothing" };
      const colours = cleanInpaint(rgb, known, cw, ch);
      colourAt = (i) => [colours[i * 3], colours[i * 3 + 1], colours[i * 3 + 2]];
    }
    const pixels = new Uint8ClampedArray(cw * ch * 4);
    let painted = 0;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (!unknown[(y + cy0) * aw + x + cx0]) continue;
        const i = y * cw + x;
        const c = colourAt(i);
        pixels[i * 4] = c[0];
        pixels[i * 4 + 1] = c[1];
        pixels[i * 4 + 2] = c[2];
        pixels[i * 4 + 3] = 255;
        painted++;
      }
    }
    return { left: cx0 + area.left + win.left, top: cy0 + area.top + win.top, width: cw, height: ch, pixels, painted, flat, colour: flat ? median : region.seed };
  };

  // The page's clean layer, "TypeR Clean", with one more thing painted on it. It's made the
  // first time, above the page and under the texts, as TypeR does in Photoshop.
  const paintOnCleanLayer = (layers, makeOp) => {
    const clean = layers.find((layer) => layer.clean);
    if (clean) return layers.map((layer) => (layer === clean ? Object.assign({}, layer, { paint: (layer.paint || NONE).concat([makeOp(layer)]) }) : layer));
    const made = newRaster("TypeR Clean", { clean: true });
    made.paint = [makeOp(made)];
    const out = layers.slice();
    out.splice(underTexts(layers), 0, made);
    return out;
  };
  // Where a layer goes to be above the page and under the texts: before the first text, or
  // before the folder holding it
  const underTexts = (layers) => {
    let firstText = layers.findIndex((layer) => layer.kind === "text");
    // A text in a folder: under the whole folder, not among its content
    const rootOf = (layer) => {
      let root = layer;
      while (root && root.group) root = layers.find((item) => item.id === root.group);
      return root;
    };
    if (firstText >= 0 && layers[firstText].group) {
      const root = rootOf(layers[firstText]);
      while (firstText > 0 && rootOf(layers[firstText - 1]) === root) firstText--;
    }
    return firstText < 0 ? layers.length : firstText;
  };

  /* ========================= the application ========================= */

  const app = {
    docs: [],
    doc: null,
    files: new Map(),
    listeners: new Set(),
    panelListeners: {},
    keys: { meta: false, ctrl: false, alt: false, shift: false, key: "" },
    keysSeen: { meta: false, ctrl: false, alt: false, shift: false, key: "" },
    keysMuted: null,
    tool: "wand",
    tolerance: 32,
    cleanTolerance: 32,
    cleanMargin: 6,
    // The Bubble Cleaner's drag: "rectangle", "lasso" or "polygon"
    cleanShape: "rectangle",
    contiguous: true,
    sampleAll: true,
    magicTolerance: 32,
    magicAntiAlias: true,
    magicContiguous: true,
    magicSampleAll: false,
    autoSelect: true,
    selectionMode: "new",
    fg: { r: 0, g: 0, b: 0 },
    bg: { r: 255, g: 255, b: 255 },
    brush: { size: 24, hardness: 100 },
    textDefaults: { font: "WildjessNormal", family: "Wildjess", style: "Normal", size: 38, verticalAlign: "center", language: DEFAULT_TEXT_LANGUAGE, ligature: true },
    lastAction: 0,
    pendingActions: 0,
    monitor: { lastBounds: null, documentKey: null },
  };

  const emit = (type, detail) => app.listeners.forEach((listener) => listener(type, detail));

  const setDoc = (doc) => {
    if (doc && !app.docs.includes(doc)) app.docs.push(doc);
    // What the Magic Wand read of a page is a whole page, and quick to read again
    if (app.doc && app.doc !== doc) {
      app.doc.sampleCache = null;
      app.doc.sampleKey = null;
    }
    app.doc = doc;
    emit("document", doc);
    emit("render");
    emit("history");
    if (doc) emit("selection", doc.state.selection);
  };

  // Gestures that repeat (arrow keys, a slider) make one step of history
  // `rect`, if given, says the part of the page the step changed, once the state is in place
  const commitState = (doc, name, change, coalesce, rect) => {
    doc.state = Object.assign({}, doc.state, change);
    const last = doc.history[doc.historyIndex];
    if (coalesce && last.coalesce === coalesce && (coalesce.indexOf("gesture:") === 0 || Date.now() - last.time < 1500) && doc.historyIndex === doc.history.length - 1) {
      last.state = doc.state;
      last.time = Date.now();
    } else pushHistory(doc, name, coalesce);
    emit("history");
    emit("render", rect ? rect() : undefined);
  };
  // The part of the page a layer's picture covers
  const visualBounds = (layer, doc) => {
    const visual = layer.kind === "group" ? null : visualOf(layer, doc);
    return visual && visual.canvas && visual.canvas.width ? visualRect(visual) : null;
  };
  const unionRect = (doc, before, after) => (before && after ? pageRect(doc, Math.min(before.left, after.left), Math.min(before.top, after.top), Math.max(before.right, after.right), Math.max(before.bottom, after.bottom)) : undefined);

  const activeTextLayer = (doc = app.doc) => {
    if (!doc) return null;
    const id = doc.state.activeIds[doc.state.activeIds.length - 1];
    return doc.state.layers.find((layer) => layer.id === id && layer.kind === "text") || null;
  };

  const selectedTextLayers = (doc = app.doc) => (doc ? doc.state.layers.filter((layer) => layer.kind === "text" && doc.state.activeIds.includes(layer.id)) : []);

  const replaceLayer = (doc, layer, changes) => doc.state.layers.map((item) => (item.id === layer.id ? Object.assign({}, item, changes) : item));

  const firePanelEvent = (eventID, eventData) => {
    const type = "com.adobe.PhotoshopJSONCallback" + EXTENSION_ID;
    const payload = { eventID };
    if (eventData) payload.eventData = eventData;
    const event = { type, data: "ver1," + JSON.stringify(payload), scope: "APPLICATION", appId: "PHXS", extensionId: EXTENSION_ID };
    (app.panelListeners[type] || []).slice().forEach((entry) => {
      try {
        entry.listener.call(entry.obj || null, event);
      } catch (error) {
        console.error("TypeR demo: panel listener", error);
      }
    });
  };

  // A click made while the panel works waits for the moment the panel listens
  // again: in Photoshop such a click is queued by the application itself
  let waitingSelectionEvent = null;
  const fireWhenIdle = (send) => {
    waitingSelectionEvent = send;
    const attempt = () => {
      if (waitingSelectionEvent !== send) return;
      if (app.pendingActions > 0 || Date.now() - app.lastAction < 460) {
        setTimeout(attempt, 60);
        return;
      }
      waitingSelectionEvent = null;
      send();
    };
    attempt();
  };
  // A paste ends the selection it filled. A click made on the next bubble meanwhile, still
  // waiting for the panel, keeps its own: the panel pastes into it once it hears of it.
  const selectionAfterPaste = (doc) => (waitingSelectionEvent ? doc.state.selection : null);

  const descriptorFor = (selection) => {
    const target = { _ref: [{ _ref: "channel", _property: "selection" }] };
    const px = (value) => ({ _unit: "pixelsUnit", _value: value });
    if (selection.source === "wand") {
      const t = selection.trigger;
      return { null: target, to: { _obj: "paint", horizontal: px(t.x), vertical: px(t.y) }, tolerance: app.tolerance, contiguous: app.contiguous, antiAlias: true, merged: app.sampleAll };
    }
    if (selection.source === "rectangle") {
      const b = selection.bounds;
      return { null: target, to: { _obj: "rectangle", top: px(b.top), left: px(b.left), bottom: px(b.bottom), right: px(b.right) } };
    }
    if (selection.source === "ellipse") {
      const b = selection.bounds;
      return { null: target, to: { _obj: "ellipse", top: px(b.top), left: px(b.left), bottom: px(b.bottom), right: px(b.right) } };
    }
    return { null: target, to: { _obj: "polygon", points: [] } };
  };

  /* ------------------------- user gestures ------------------------- */

  // Is the hyphen at the end of a line part of the word? The script says so when TypeR
  // pasted the text, whatever its case. Otherwise, or when the text no longer has that word:
  // the French words written with one, the Japanese honorifics ("Ryou-chan"), and any hyphen
  // of a text in a language whose words are never cut, as Vietnamese, or one written
  // without Latin or Cyrillic letters.
  const UNCUT_TEXT = /[ăđơưĂĐƠƯ\u1EA0-\u1EF9]/;
  const hyphenKey = (left, right) => `${left}-${(/^[^\s.,;:!?…"”»)\]]*/.exec(right) || [""])[0]}`.toLowerCase();
  const realHyphen = (left, right, source, text, cuts) => {
    // The hyphens TypeR added itself, to cut a word in the Line Breaks panel
    if (cuts && cuts.includes(hyphenKey(left, right))) return false;
    if (source) {
      const script = String(source).toLowerCase();
      const word = hyphenKey("", right).slice(1);
      if (script.indexOf(`${left.toLowerCase()}-${word}`) >= 0) return true;
      if (script.indexOf(`${left.toLowerCase()}${word}`) >= 0) return false;
    }
    if (/^(être|ce|ci|là|il|ils|elle|elles|on|je|tu|nous|vous|moi|toi|lui|leur|même|dire|t|y|en|le|la|les)$/i.test(right)) return true;
    if (/^(chan|chin|san|kun|sama|senpai|sempai|sensei|dono|tan|han|nii|nee|niichan|neechan|niisan|neesan|kouhai|kohai)(?!\p{L})/iu.test(right)) return true;
    const all = String(text || "");
    return UNCUT_TEXT.test(all) || !/[A-Za-z\u00C0-\u024F\u0400-\u04FF]/.test(all);
  };

  // The lines of a text as the Line Breaks window sees them: its characters in a row,
  // with no line break and no added hyphen, and the places it breaks
  const lineModel = (layer, doc) => {
    const lt = layer.params.layerText;
    const rows = relativeLayout(lt, doc.resolution).wrapped;
    const base = (lt.textStyleRange && lt.textStyleRange[0] && lt.textStyleRange[0].textStyle) || {};
    const chars = [];
    const breaks = [];
    rows.forEach((runs, index) => {
      runs.forEach((run) => Array.from(run.text).forEach((ch) => chars.push({ ch, style: run.style })));
      if (index === rows.length - 1) return;
      const previous = chars[chars.length - 1];
      if (!previous) return;
      if (runs.hyphenated) chars.pop();
      else if (previous.ch === "-") {
        let left = "";
        for (let at = chars.length - 2; at >= 0 && chars[at].ch !== " "; at--) left = chars[at].ch + left;
        const next = rows[index + 1].map((run) => run.text).join("");
        const right = (/^[^\s]*/.exec(next) || [""])[0];
        if (!realHyphen(left, right, layer.source, lt.textKey, layer.cuts)) chars.pop();
      } else if (previous.ch !== " ") chars.push({ ch: " ", style: previous.style || base });
      if (breaks[breaks.length - 1] !== chars.length) breaks.push(chars.length);
    });
    return { chars, breaks };
  };

  // The width of some of those characters, for the window's automatic line counts
  const lineWidth = (chars, doc) => {
    const runs = [];
    chars.forEach((item) => {
      const last = runs[runs.length - 1];
      if (last && last.style === item.style) last.text += item.ch;
      else runs.push({ text: item.ch, style: item.style });
    });
    return measureRuns(runs, doc.resolution).advance;
  };

  // The layer with these breaks. A space becomes the break; inside a word, a hyphen is
  // added. The text stays where it is in its bubble, and a box grows if a line needs it.
  const layerWithBreaks = (layer, doc, model, breaks) => {
    const set = new Set(breaks);
    const out = [];
    const cuts = [];
    const wordAround = (index, step) => {
      let word = "";
      for (let at = index; at >= 0 && at < model.chars.length && !/\s/.test(model.chars[at].ch); at += step) word = step < 0 ? model.chars[at].ch + word : word + model.chars[at].ch;
      return word;
    };
    model.chars.forEach((item, index) => {
      if (set.has(index) && index > 0) {
        const previous = model.chars[index - 1];
        if (previous.ch === " ") out.pop();
        else if (previous.ch !== "-") {
          out.push({ ch: "-", style: previous.style });
          cuts.push(hyphenKey(wordAround(index - 1, -1), wordAround(index, 1)));
        }
        out.push({ ch: "\r", style: previous.style });
      }
      out.push(item);
    });
    const params = clone(layer.params);
    const lt = params.layerText;
    const ranges = [];
    let length = 0;
    out.forEach((item) => {
      const last = ranges[ranges.length - 1];
      if (last && last.textStyle === item.style) last.to = length + item.ch.length;
      else ranges.push({ from: length, to: length + item.ch.length, textStyle: item.style });
      length += item.ch.length;
    });
    lt.textKey = out.map((item) => item.ch).join("");
    lt.textStyleRange = ranges.length ? ranges : lt.textStyleRange;
    lt.paragraphStyleRange.forEach((range) => { range.to = length; });
    const next = Object.assign({}, layer, { params, raster: null, manualBreaks: true, cuts });
    const before = boxOf(layer, doc);
    const shape = boxShape(lt);
    if (!shape) return centredOn(next, doc, before.xMid, before.yMid);
    const free = Object.assign({}, lt, { textShape: [{ textType: "point" }] });
    let widest = 0;
    relativeLayout(free, doc.resolution).lines.forEach((line) => { widest = Math.max(widest, line.m.advance); });
    if (widest + 1 > shape.box.width) {
      const grow = widest + 1 - shape.box.width;
      shape.box.width += grow;
      lt.textClickPoint.horizontal -= (grow / 2 / doc.width) * 100;
    }
    if (shape.box.autoHeight) return centredOn(next, doc, boxOf(next, doc).xMid, before.yMid);
    const needed = relativeLayout(free, doc.resolution).lines.length;
    const full = relativeLayout(Object.assign({}, lt, { textShape: [{ textType: "box", box: { width: shape.box.width, height: 1, autoHeight: true } }] }), doc.resolution);
    if (needed && full.contentHeight > shape.box.height) shape.box.height = full.contentHeight;
    return next;
  };

  // Line breaks made by TypeR go away when the text moves into a box: spaces come back,
  // and a hyphen added to break a word goes (the script tells which ones are real)
  const unwrapText = (lt, source) => {
    const text = lt.textKey || "";
    const ranges = lt.textStyleRange || [];
    const styleAt = (index) => {
      const range = ranges.find((item) => index >= item.from && index < item.to) || ranges[ranges.length - 1];
      return range ? range.textStyle : {};
    };
    const chars = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch !== "\r" && ch !== "\n") {
        chars.push({ ch, style: styleAt(i) });
        continue;
      }
      const previous = chars[chars.length - 1];
      if (previous && previous.ch === "-") {
        let left = "";
        for (let at = chars.length - 2; at >= 0 && /[^\s]/.test(chars[at].ch); at--) left = chars[at].ch + left;
        const right = (/^[^\s]*/.exec(text.slice(i + 1)) || [""])[0];
        if (!realHyphen(left, right, source, text)) chars.pop();
        continue;
      }
      chars.push({ ch: " ", style: styleAt(i) });
    }
    const out = [];
    chars.forEach((item, index) => {
      const last = out[out.length - 1];
      if (last && last.textStyle === item.style) last.to = index + 1;
      else out.push({ from: index, to: index + 1, textStyle: item.style });
    });
    lt.textKey = chars.map((item) => item.ch).join("");
    lt.textStyleRange = out.length ? out : [{ from: 0, to: 0, textStyle: ranges[0] ? ranges[0].textStyle : {} }];
    lt.paragraphStyleRange.forEach((range) => { range.to = lt.textKey.length; });
  };

  // A layer moved by (dx, dy): its anchor, and Photoshop's pixels if it still shows them
  // `all`: the whole page moved, unlinked masks with it
  const shifted = (layer, dx, dy, doc, all) => {
    if (layer.kind === "text") {
      const params = clone(layer.params);
      params.layerText.textClickPoint.horizontal += (dx / doc.width) * 100;
      params.layerText.textClickPoint.vertical += (dy / doc.height) * 100;
      const moved = Object.assign({}, layer, { params });
      if (layer.warp) moved.warp = Object.assign({}, layer.warp, { corners: layer.warp.corners.map(([x, y]) => [x + dx, y + dy]) });
      if (layer.raster) moved.raster = Object.assign({}, layer.raster, { left: layer.raster.left + dx, top: layer.raster.top + dy });
      return Object.assign(moved, movedMasks(layer, dx, dy, all));
    }
    if (layer.kind === "raster") return Object.assign({}, layer, { dx: (layer.dx || 0) + dx, dy: (layer.dy || 0) + dy }, movedMasks(layer, dx, dy, all));
    if (layer.mask || layer.vectorMask) return Object.assign({}, layer, movedMasks(layer, dx, dy, all));
    return layer;
  };

  // A text at `factor` times its size: its letters, its leading and its box. The size of the
  // last run comes with it.
  const grownText = (base, factor) => {
    const params = clone(base.params);
    const lt = params.layerText;
    let size = 0;
    lt.textStyleRange.forEach((range) => {
      const style = range.textStyle;
      style.size = Math.max(1, Math.round((style.impliedFontSize || style.size || 14) * factor * 10) / 10);
      style.impliedFontSize = style.size;
      if (style.leading) style.leading = Math.round(style.leading * factor * 10) / 10;
      if (style.impliedLeading) style.impliedLeading = style.leading;
      size = style.size;
    });
    const shape = boxShape(lt);
    if (shape) {
      shape.box.width = Math.max(1, shape.box.width * factor);
      shape.box.height = Math.max(1, shape.box.height * factor);
    }
    return { next: Object.assign({}, base, { params, raster: null }), size };
  };
  // The middle of a text's frame as it shows, turned or not
  const middleOfText = (layer, doc) => {
    if (layer.rotated && !layer.warp) return turnedFrame(layer, doc).center;
    const f = frameOf(layer, doc);
    return [f.left + f.width / 2, f.top + f.height / 2];
  };
  // A text turned by `delta` radians around `pivot`. In perspective, its surface turns: the
  // corners go round the pivot, the bends with them.
  const turnedText = (base, delta, pivot, doc) => {
    const cos = Math.cos(delta);
    const sin = Math.sin(delta);
    if (base.warp) {
      const round = ([x, y]) => [pivot[0] + cos * (x - pivot[0]) - sin * (y - pivot[1]), pivot[1] + sin * (x - pivot[0]) + cos * (y - pivot[1])];
      const spun = ([x, y]) => [cos * x - sin * y, sin * x + cos * y];
      return Object.assign({}, base, { warp: Object.assign({}, base.warp, { corners: base.warp.corners.map(round), bendTop: spun(base.warp.bendTop), bendBottom: spun(base.warp.bendBottom) }) });
    }
    const [a, b, c, d] = spinOf(base) || [1, 0, 0, 1];
    const clean = (value) => (Math.abs(value) < 1e-9 ? 0 : Math.abs(Math.abs(value) - 1) < 1e-9 ? Math.sign(value) : value);
    const spin = [cos * a - sin * b, sin * a + cos * b, cos * c - sin * d, sin * c + cos * d].map(clean);
    const straight = spin[0] === 1 && spin[1] === 0 && spin[2] === 0 && spin[3] === 1;
    // The anchor goes round the pivot: the turn is drawn around it
    const [ax, ay] = anchorOf(base.params.layerText, doc);
    const ux = ax - pivot[0];
    const uy = ay - pivot[1];
    const nx = pivot[0] + cos * ux - sin * uy;
    const ny = pivot[1] + sin * ux + cos * uy;
    const next = Object.assign({}, base, { rotated: !straight, spin: straight ? null : spin, raster: null });
    return shifted(next, nx - ax, ny - ay, doc);
  };

  // A text under Free Transform stays a text. On a surface, the surface follows the transform.
  // Otherwise it grows, stretches and turns as the frame did, and its middle goes where the frame
  // takes it. A flat text isn't mirrored: flipped, it still reads the right way.
  const transformedText = (layer, matrix, doc) => {
    const [a, b, c, d, e, f] = matrix;
    const map = ([x, y]) => [a * x + c * y + e, b * x + d * y + f];
    if (layer.warp) {
      const linear = ([x, y]) => [a * x + c * y, b * x + d * y];
      return Object.assign({}, layer, { raster: null, warp: Object.assign({}, layer.warp, { corners: layer.warp.corners.map(map), bendTop: linear(layer.warp.bendTop), bendBottom: linear(layer.warp.bendBottom) }) });
    }
    const sx = Math.hypot(a, b);
    const sy = Math.hypot(c, d);
    if (sx < 1e-6 || sy < 1e-6) return layer;
    // Flipped, the turn is the one that leaves the text the most upright
    const turns = [Math.atan2(b, a), Math.atan2(-c, d)];
    const tilt = (angle) => Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
    const turn = a * d - b * c < 0 ? (tilt(turns[1]) < tilt(turns[0]) ? turns[1] : turns[0]) : turns[0];
    const to = map(middleOfText(layer, doc));
    // Only turned or moved, its size isn't touched, not even rounded
    let next = Math.abs(sy - 1) > 1e-6 ? grownText(layer, sy).next : Object.assign({}, layer, { params: clone(layer.params), raster: null });
    const ratio = sx / sy;
    if (Math.abs(ratio - 1) > 0.005) {
      const lt = next.params.layerText;
      lt.textStyleRange.forEach(({ textStyle }) => {
        textStyle.horizontalScale = Math.round((textStyle.horizontalScale === undefined ? 100 : textStyle.horizontalScale) * ratio * 100) / 100;
      });
      const shape = boxShape(lt);
      if (shape) shape.box.width = Math.max(1, shape.box.width * ratio);
    }
    if (Math.abs(turn) > 1e-9) next = turnedText(next, turn, middleOfText(next, doc), doc);
    const now = middleOfText(next, doc);
    return shifted(next, to[0] - now[0], to[1] - now[1], doc);
  };

  const centredOn = (layer, doc, x, y) => {
    // A text on a surface stays there: the surface is what sets its place
    if (layer.warp) return layer;
    const box = boxOf(layer, doc);
    return shifted(layer, x - box.xMid, y - box.yMid, doc);
  };

  // A layer and everything inside it, if it is a folder
  const familyOf = (layers, id) => {
    const out = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      layers.forEach((layer) => {
        if (layer.group && out.has(layer.group) && !out.has(layer.id)) {
          out.add(layer.id);
          grew = true;
        }
      });
    }
    return out;
  };

  // Photoshop's locks: `locked` is Lock All, `locks` holds the others (transparency, pixels,
  // position), which Lock All takes in
  const lockOf = (layer, kind) => Boolean(layer && (layer.locked || (layer.locks && layer.locks[kind])));
  // Linked layers (Photoshop's Link Layers) move with each other
  const withLinked = (layers, ids) => {
    const links = new Set();
    layers.forEach((layer) => { if (layer.link && ids.includes(layer.id)) links.add(layer.link); });
    return links.size ? ids.concat(layers.filter((layer) => layer.link && links.has(layer.link) && !ids.includes(layer.id)).map((layer) => layer.id)) : ids;
  };
  // Where layers land when moved (or copied) beside, above, below or into another: the new
  // list and what becomes active, or null when nothing would move
  const reorderPlan = (all, ids, targetId, position, copy) => {
    const byId = new Map(all.map((layer) => [layer.id, layer]));
    const insideChosen = (layer) => {
      for (let up = layer.group; up && byId.get(up); up = byId.get(up).group) if (ids.includes(up)) return true;
      return false;
    };
    // The Background stays where it is, and a layer goes with its chosen folder
    const chosen = ids.filter((id) => byId.get(id) && (copy || !byId.get(id).isBackground) && !insideChosen(byId.get(id)));
    if (!chosen.length) return null;
    const family = new Set();
    chosen.forEach((id) => familyOf(all, id).forEach((member) => family.add(member)));
    if (!copy && family.has(targetId)) return null;
    const moved = all.filter((layer) => family.has(layer.id));
    const rest = copy ? all.slice() : all.filter((layer) => !family.has(layer.id));
    const target = rest.find((layer) => layer.id === targetId);
    if (!target) return null;
    let at = rest.indexOf(target);
    let parent = target.group || null;
    if (position === "inside" && target.kind === "group") parent = target.id;
    else if (position === "above") at += 1;
    else if (target.kind === "group") {
      // Below a folder: under everything it holds
      const members = familyOf(rest, target.id);
      at = rest.findIndex((layer) => members.has(layer.id));
    }
    // Nothing goes under the Background
    if (rest[0] && rest[0].isBackground && at < 1) {
      at = 1;
      parent = null;
    }
    // Dropped inside a clipping mask, a layer joins it; a clipped one dropped outside its
    // own is let go, as in Photoshop. A base moved with its clipped layers keeps them.
    const same = (layer) => Boolean(layer) && (layer.group || null) === parent && layer.kind !== "group";
    const above = rest[at];
    const intoClip = same(above) && Boolean(above.clipping);
    const siblingBelow = (layer) => {
      for (let index = all.indexOf(layer) - 1; index >= 0; index--) if ((all[index].group || null) === (layer.group || null)) return all[index];
      return null;
    };
    let below = rest[at - 1];
    let belowOriginal = null;
    const placed = moved.map((layer) => {
      if (family.has(layer.group)) return layer;
      const block = Boolean(belowOriginal) && siblingBelow(layer) === belowOriginal;
      const clipping = layer.kind !== "group" && (intoClip || (Boolean(layer.clipping) && (block || (same(below) && Boolean(below.clipping)))));
      const next = Object.assign({}, layer, { group: parent, isBackground: false, clipping });
      below = next;
      belowOriginal = layer;
      return next;
    });
    if (!copy) {
      const layers = rest.slice(0, at).concat(placed, rest.slice(at));
      return layers.every((layer, index) => layer === all[index]) ? null : { layers, activeIds: null };
    }
    const fresh = new Map(placed.map((layer) => [layer.id, newId()]));
    const copies = placed.map((layer) => Object.assign({}, layer, {
      id: fresh.get(layer.id),
      group: fresh.get(layer.group) || layer.group,
      name: chosen.includes(layer.id) ? `${layer.name} copy` : layer.name,
      clean: false,
      link: undefined,
      raw: layer.raw ? Object.assign({}, layer.raw) : undefined,
    }));
    return { layers: rest.slice(0, at).concat(copies, rest.slice(at)), activeIds: chosen.map((id) => fresh.get(id)) };
  };

  const movableIds = (doc, ids) => {
    const out = new Set();
    withLinked(doc.state.layers, ids).forEach((id) => familyOf(doc.state.layers, id).forEach((member) => out.add(member)));
    return Array.from(out).filter((id) => {
      const layer = doc.state.layers.find((item) => item.id === id);
      return layer && !lockOf(layer, "position") && !layer.isBackground && layer.kind !== "group";
    });
  };

  // The page changed size: what depends on it starts over, and it shows whole if it changed shape
  const sizeChanged = (doc, before) => {
    doc.sampleCache = null;
    doc.sampleKey = "";
    doc.preview = null;
    if (doc.width !== before.width || doc.height !== before.height) {
      doc.view.fitted = true;
      doc.view.seen = false;
    }
    emit("document", doc);
    emit("selection", doc.state.selection);
  };

  const resizeDoc = (doc, name, size, layers, change) => {
    const before = sizeOf(doc);
    // History from before sizes were kept, in a document from an older session
    doc.history.forEach((entry) => { if (!entry.size) entry.size = before; });
    Object.assign(doc, size);
    commitState(doc, name, Object.assign({ layers, selection: null, lastSelection: null }, change));
    sizeChanged(doc, before);
    firePanelEvent(EVENT_HISTORY);
  };

  // A layer's new pixels replace what it had, painted things included, in Photoshop's file too
  const withPixels = (layer, bitmap, left, top, mask) => {
    const next = Object.assign({}, layer, { bitmap, left, top, dx: 0, dy: 0, paint: NONE, mask });
    if (layer.vectorMask) next.vectorMask = shiftedVector(layer.vectorMask, layer.dx || 0, layer.dy || 0);
    if (layer.raw) {
      next.raw = Object.assign({}, layer.raw, { canvas: bitmap, left, top, right: left + bitmap.width, bottom: top + bitmap.height });
      if (mask) next.raw.mask = mask;
      else if (layer.mask) delete next.raw.mask;
    }
    return next;
  };

  // A picture at (x, y) of the page, as it lands on the scaled page. Its edges stay where they
  // fall, between pixels too, so that the layers keep lining up.
  const scaledPixels = (source, x, y, sx, sy) => {
    const left = Math.floor(x * sx + 1e-6);
    const top = Math.floor(y * sy + 1e-6);
    const canvas = newCanvas(Math.ceil((x + source.width) * sx - 1e-6) - left, Math.ceil((y + source.height) * sy - 1e-6) - top);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, x * sx - left, y * sy - top, source.width * sx, source.height * sy);
    return { canvas, left, top };
  };

  const scaledRaster = (layer, doc, sx, sy) => {
    const masks = scaledMasks(layer, doc, sx, sy);
    const visual = visualOf(Object.assign({}, layer, { mask: null, vectorMask: null }), doc);
    if (!visual) return layer.mask || layer.vectorMask ? Object.assign({}, layer, masks, { dx: 0, dy: 0 }) : layer;
    const p = scaledPixels(visual.canvas, visual.x, visual.y, sx, sy);
    return Object.assign(withPixels(layer, p.canvas, p.left, p.top, masks.mask || null), masks.vectorMask ? { vectorMask: masks.vectorMask } : null);
  };

  // Where a pixel layer really has pixels, without its mask. A painted layer's picture covers
  // the whole page, whatever is on it. Null for a layer with nothing on it.
  const trimmedBoxes = new WeakMap();
  const trimmedBox = (layer, doc) => {
    const visual = visualOf(Object.assign({}, layer, { mask: null }), doc);
    if (!visual) return null;
    const dx = layer.dx || 0;
    const dy = layer.dy || 0;
    const key = layer.paint && layer.paint.length ? layer.paint : layer.bitmap;
    let box = trimmedBoxes.get(key);
    if (box === undefined) {
      const { width, height } = visual.canvas;
      const { data } = visual.canvas.getContext("2d").getImageData(0, 0, width, height);
      let left = width;
      let top = height;
      let right = 0;
      let bottom = 0;
      for (let y = 0, i = 3; y < height; y++) {
        for (let x = 0; x < width; x++, i += 4) {
          if (!data[i]) continue;
          if (x < left) left = x;
          if (x >= right) right = x + 1;
          if (y < top) top = y;
          bottom = y + 1;
        }
      }
      const ox = visual.x - dx;
      const oy = visual.y - dy;
      box = right ? { left: left + ox, top: top + oy, right: right + ox, bottom: bottom + oy } : null;
      trimmedBoxes.set(key, box);
    }
    return box && rectFrom(box.left + dx, box.top + dy, box.right + dx, box.bottom + dy);
  };

  // A part of a picture at (x, y) of the page, through a matrix, on a canvas just big enough
  const transformedPixels = (source, x, y, part, matrix, fill) => {
    const [a, b, c, d, e, f] = matrix;
    const xs = [part.left, part.right, part.right, part.left].map((px, i) => a * px + c * (i < 2 ? part.top : part.bottom) + e);
    const ys = [part.left, part.right, part.right, part.left].map((px, i) => b * px + d * (i < 2 ? part.top : part.bottom) + f);
    const left = Math.floor(Math.min(...xs) + 1e-6);
    const top = Math.floor(Math.min(...ys) + 1e-6);
    const canvas = newCanvas(Math.ceil(Math.max(...xs) - 1e-6) - left, Math.ceil(Math.max(...ys) - 1e-6) - top);
    const ctx = canvas.getContext("2d");
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(a, b, c, d, e - left, f - top);
    const width = part.right - part.left;
    const height = part.bottom - part.top;
    ctx.drawImage(source, part.left - x, part.top - y, width, height, part.left, part.top, width, height);
    return { canvas, left, top };
  };

  // What a Clone Stamp stroke paints from: the page as it is when the stroke starts, so that it
  // never clones what it has just painted. Places are the page's.
  const cloneSource = (doc, layer, sample) => {
    if (sample === "current") {
      const visual = visualOf(layer, doc);
      if (!visual) return { canvas: newCanvas(1, 1), x: 0, y: 0 };
      const canvas = newCanvas(visual.canvas.width, visual.canvas.height);
      canvas.getContext("2d").drawImage(visual.canvas, 0, 0);
      return { canvas, x: visual.x, y: visual.y };
    }
    const canvas = newCanvas(doc.width, doc.height);
    const at = doc.state.layers.indexOf(layer);
    paintDoc(doc, canvas.getContext("2d"), { keep: true, skip: sample === "below" ? (item) => doc.state.layers.indexOf(item) > at : null });
    return { canvas, x: 0, y: 0 };
  };
  // A stroke only needs what is under it: a whole page for each one would fill the memory
  const cropCloneSource = (op) => {
    const reach = op.size / 2 + 2;
    const xs = op.points.map((p) => p[0]);
    const ys = op.points.map((p) => p[1]);
    const left = Math.floor(Math.min(...xs) - reach);
    const top = Math.floor(Math.min(...ys) - reach);
    const canvas = newCanvas(Math.ceil(Math.max(...xs) + reach) - left, Math.ceil(Math.max(...ys) + reach) - top);
    canvas.getContext("2d").drawImage(op.source.canvas, op.source.x - left, op.source.y - top);
    op.source = { canvas, x: left, y: top };
  };

  const TEXT_LENGTHS = ["size", "impliedFontSize", "leading", "impliedLeading", "baselineShift", "impliedBaselineShift"];

  // points: what a size in points is multiplied by, the page's resolution being part of it
  const scaledText = (layer, sx, sy, points) => {
    const params = clone(layer.params);
    const lt = params.layerText;
    const stretched = Math.abs(sx / sy - 1) > 0.005;
    lt.textStyleRange.forEach(({ textStyle }) => {
      TEXT_LENGTHS.forEach((field) => {
        if (typeof textStyle[field] === "number") textStyle[field] = Math.round(textStyle[field] * points * 1000) / 1000;
      });
      if (stretched) textStyle.horizontalScale = Math.round((textStyle.horizontalScale === undefined ? 100 : textStyle.horizontalScale) * (sx / sy) * 100) / 100;
    });
    const next = Object.assign({}, layer, { params });
    if (sx === 1 && sy === 1) return next;
    const shape = boxShape(lt);
    if (shape) {
      shape.box.width = Math.max(1, shape.box.width * sx);
      shape.box.height = Math.max(1, shape.box.height * sy);
    }
    if (layer.stroke) {
      next.stroke = Object.assign({}, layer.stroke, { size: Math.round(layer.stroke.size * sy * 100) / 100 });
      if (layer.stroke.outer) next.stroke.outer = Object.assign({}, layer.stroke.outer, { size: Math.round(layer.stroke.outer.size * sy * 100) / 100 });
    }
    // Its effects' sizes and distances, as the stroke's
    if (layer.effects) {
      next.effects = {};
      Object.keys(layer.effects).forEach((name) => {
        const effect = layer.effects[name];
        next.effects[name] = effect && typeof effect === "object" ? Object.assign({}, effect) : effect;
        ["size", "distance"].forEach((field) => {
          if (effect && typeof effect[field] === "number") next.effects[name][field] = Math.round(effect[field] * sy * 100) / 100;
        });
      });
    }
    if (layer.warp) {
      const { source, corners, bendTop, bendBottom } = layer.warp;
      const scaled = ([x, y]) => [x * sx, y * sy];
      next.warp = Object.assign({}, layer.warp, {
        source: { left: source.left * sx, top: source.top * sy, width: source.width * sx, height: source.height * sy },
        corners: corners.map(scaled),
        bendTop: scaled(bendTop),
        bendBottom: scaled(bendBottom),
      });
    }
    const { raster, raw } = layer;
    if (raster) {
      // Photoshop's pixels stay, scaled, and Photoshop's text follows them in the file
      const p = scaledPixels(raster.bitmap, raster.left, raster.top, sx, sy);
      next.raster = Object.assign({}, raster, { bitmap: p.canvas, left: p.left, top: p.top });
      if (raster.display) {
        const d = scaledPixels(raster.display, raster.left + (raster.displayLeft || 0), raster.top + (raster.displayTop || 0), sx, sy);
        Object.assign(next.raster, { display: d.canvas, displayLeft: d.left - p.left, displayTop: d.top - p.top });
      }
      if (raw && raw.text) {
        const t = raw.text.transform || [1, 0, 0, 1, 0, 0];
        const x = t[4] + raster.left - (raw.left || 0);
        const y = t[5] + raster.top - (raw.top || 0);
        next.raw = Object.assign({}, raw, { left: p.left, top: p.top, text: Object.assign({}, raw.text, { transform: [t[0] * sx, t[1] * sy, t[2] * sx, t[3] * sy, x * sx, y * sy] }) });
        if (raw.effects && raw.effects.stroke) {
          next.raw.effects = Object.assign({}, raw.effects, { stroke: raw.effects.stroke.map((stroke) => Object.assign({}, stroke, { size: Object.assign({}, stroke.size, { value: stroke.size.value * sy }) })) });
        }
      }
    }
    return next;
  };

  // The layers of a page that changes size, with what it had moved by (ox, oy). Layers keep
  // what goes off the page; the Background, which has nothing outside it, gets cut or filled.
  const onNewCanvas = (doc, width, height, ox, oy, fill) => doc.state.layers.map((layer) => {
    if (layer.isBackground) {
      const visual = visualOf(layer, doc);
      const bitmap = newCanvas(width, height);
      const ctx = bitmap.getContext("2d");
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, width, height);
      ctx.clearRect(ox, oy, doc.width, doc.height);
      if (visual) ctx.drawImage(visual.canvas, visual.x + ox, visual.y + oy);
      return withPixels(layer, bitmap, 0, 0, null);
    }
    if (layer.kind !== "text") return shifted(layer, ox, oy, doc, true);
    // An anchor is a share of the page: the same place is another share of a new page
    const params = clone(layer.params);
    params.layerText.textClickPoint.horizontal *= doc.width / width;
    params.layerText.textClickPoint.vertical *= doc.height / height;
    return shifted(Object.assign({}, layer, { params }), ox, oy, { width, height }, true);
  });

  const pageRect = (doc, left, top, right, bottom) => ({
    left: Math.max(0, Math.floor(left)),
    top: Math.max(0, Math.floor(top)),
    right: Math.min(doc.width, Math.ceil(right)),
    bottom: Math.min(doc.height, Math.ceil(bottom)),
  });
  // Where what is being dragged shows right now
  const liveBounds = (doc) => {
    const { ids, dx, dy } = doc.live;
    let box = null;
    doc.state.layers.forEach((layer) => {
      if (!ids.has(layer.id) || layer.kind === "group") return;
      const visual = visualOf(layer, doc);
      if (!visual) return;
      const area = visualRect(visual);
      const left = area.left + Math.round(dx);
      const top = area.top + Math.round(dy);
      const right = area.right + Math.round(dx);
      const bottom = area.bottom + Math.round(dy);
      box = box ? { left: Math.min(box.left, left), top: Math.min(box.top, top), right: Math.max(box.right, right), bottom: Math.max(box.bottom, bottom) } : { left, top, right, bottom };
    });
    return box;
  };

  // Levels / Curves on the selected part of the layer's picture, from the pixels it had at the start
  const levelsPaint = (session, tables) => {
    const { source, output, box, inside, ctx } = session;
    const src = source.data;
    const out = output.data;
    const width = source.width;
    const bw = box.right - box.left;
    const [red, green, blue] = tables || [];
    for (let y = box.top; y < box.bottom; y++) {
      let i = (y * width + box.left) * 4;
      let k = (y - box.top) * bw;
      for (let x = box.left; x < box.right; x++, i += 4, k++) {
        if (inside && !inside[k]) continue;
        if (tables) {
          out[i] = red[src[i]];
          out[i + 1] = green[src[i + 1]];
          out[i + 2] = blue[src[i + 2]];
        } else {
          out[i] = src[i];
          out[i + 1] = src[i + 1];
          out[i + 2] = src[i + 2];
        }
      }
    }
    ctx.putImageData(output, 0, 0, box.left, box.top, bw, box.bottom - box.top);
  };
  // A masked layer keeps a picture of itself, and this one changes in place
  const levelsForget = (session) => {
    const entry = rasterCache.get(session.id);
    if (entry && entry.bitmap === session.canvas) forgetRaster(session.id, entry);
    maskedVisuals.delete(session.id);
  };

  // Edit > Auto-Align Layers works in align-worker.js, away from the page: one worker per run
  const startAligner = () => new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker("align-worker.js");
    } catch (error) {
      reject(error);
      return;
    }
    const jobs = new Map();
    let last = 0;
    const late = setTimeout(() => reject(new Error("The alignment worker didn't start.")), 15000);
    const stop = (error) => {
      jobs.forEach((job) => job.reject(error));
      jobs.clear();
    };
    worker.onerror = (event) => {
      clearTimeout(late);
      const error = new Error((event && event.message) || "The alignment worker stopped.");
      reject(error);
      stop(error);
    };
    worker.onmessage = ({ data }) => {
      if (data.ready) {
        clearTimeout(late);
        resolve({
          ask: (type, payload, transfer, progress) => new Promise((done, fail) => {
            const id = ++last;
            jobs.set(id, { resolve: done, reject: fail, progress });
            worker.postMessage({ id, type, payload }, transfer || []);
          }),
          stop: () => {
            worker.terminate();
            stop(new Error("Stopped."));
          },
        });
        return;
      }
      const job = jobs.get(data.id);
      if (!job) return;
      if (data.progress !== undefined) {
        if (job.progress) job.progress(data.progress);
        return;
      }
      jobs.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data.result);
    };
  });
  // A part of a picture at (x, y) of the page, as bytes
  const pixelsOf = (source, x, y, part) => source.getContext("2d").getImageData(part.left - x, part.top - y, part.width, part.height);
  const canvasOfBytes = ({ data, width, height }) => {
    const canvas = newCanvas(width, height);
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    return canvas;
  };

  /* ---------------------- Generative Fill: laying it back ---------------------- */

  // 3 × 3 matrices, row by row
  const mul3 = (a, b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
  const inv3 = (m) => {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!det) return null;
    return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
  };
  // The page around a selection and a model's picture of it, made small and grey, to judge
  // where the picture goes. `m` takes the picture's page places to the page's (null: as it came).
  const fitGround = (page, picture, hole, x0, y0) => {
    const level = (longest) => {
      const k = Math.min(1, longest / Math.max(page.width, page.height));
      const w = Math.max(8, Math.round(page.width * k));
      const h = Math.max(8, Math.round(page.height * k));
      const canvas = newCanvas(w, h);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingQuality = "high";
      const grey = (source) => {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(source, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        const g = new Float32Array(w * h);
        for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        return { g, a: d };
      };
      const ref = grey(page);
      const pic = grey(picture);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(hole, 0, 0, w, h);
      const m = ctx.getImageData(0, 0, w, h).data;
      const valid = new Uint8Array(w * h);
      let count = 0;
      for (let i = 0; i < valid.length; i++) if (!m[i * 4 + 3]) {
        valid[i] = 1;
        count++;
      }
      // A small pixel's centre on the page, and back
      const kx = w / page.width;
      const ky = h / page.height;
      const toPage = [1 / kx, 0, x0 + 0.5 / kx - 0.5, 0, 1 / ky, y0 + 0.5 / ky - 0.5, 0, 0, 1];
      return { w, h, ref: ref.g, pic: pic.g, valid, count, toPage, toSmall: inv3(toPage) };
    };
    const coarse = level(96);
    const fine = level(320);
    // Mean difference where the page counts, through `h`: the page's small places to the picture's
    const errorAt = (L, h) => {
      const { w, ref, pic, valid } = L;
      const H = L.h;
      let sum = 0;
      let n = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!valid[i]) continue;
          const z = h[6] * x + h[7] * y + h[8];
          const gx = (h[0] * x + h[1] * y + h[2]) / z;
          const gy = (h[3] * x + h[4] * y + h[5]) / z;
          if (!(gx >= 0 && gy >= 0 && gx <= w - 1 && gy <= H - 1)) continue;
          const ix = Math.min(w - 2, Math.floor(gx));
          const iy = Math.min(H - 2, Math.floor(gy));
          const fx = gx - ix;
          const fy = gy - iy;
          const j = iy * w + ix;
          const value = (pic[j] * (1 - fx) + pic[j + 1] * fx) * (1 - fy) + (pic[j + w] * (1 - fx) + pic[j + w + 1] * fx) * fy;
          sum += Math.abs(value - ref[i]);
          n++;
        }
      }
      // Too little of the page left to compare: no judgement
      return n >= Math.max(40, L.count * 0.6) ? sum / n : Infinity;
    };
    const smallOf = (L, m) => (m ? mul3(L.toSmall, mul3(inv3(m), L.toPage)) : [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const pageOf = (L, h) => inv3(mul3(L.toPage, mul3(h, L.toSmall)));
    // Resized by s (sx, sy) around the middle, and moved by (tx, ty): the page's small places to the picture's
    const scaled = (L, sx, sy, tx, ty) => {
      const cx = (L.w - 1) / 2;
      const cy = (L.h - 1) / 2;
      return [1 / sx, 0, cx - (cx + tx) / sx, 0, 1 / sy, cy - (cy + ty) / sy, 0, 0, 1];
    };
    return {
      error: (m) => {
        const h = smallOf(fine, m);
        return h ? errorAt(fine, h) : Infinity;
      },
      // Coarse first, every size from 90 to 110 % and every move up to 8 %, then finer, one
      // number at a time
      search: () => {
        if (coarse.count < 40) return null;
        let best = { e: Infinity };
        const reach = Math.ceil(Math.max(coarse.w, coarse.h) * 0.08);
        for (let s = 0.9; s <= 1.1001; s += 0.02) {
          for (let ty = -reach; ty <= reach; ty++) {
            for (let tx = -reach; tx <= reach; tx++) {
              const e = errorAt(coarse, scaled(coarse, s, s, tx, ty));
              if (e < best.e) best = { e, s, tx, ty };
            }
          }
        }
        if (!Number.isFinite(best.e)) return null;
        const r = fine.w / coarse.w;
        let p = [best.s, best.s, best.tx * r, best.ty * r];
        let e = errorAt(fine, scaled(fine, ...p));
        const steps = [0.01, 0.01, r, r];
        for (let round = 0; round < 40 && steps[2] > 0.1; round++) {
          let better = false;
          for (let k = 0; k < 4; k++) {
            for (const sign of [1, -1]) {
              const q = p.slice();
              q[k] += sign * steps[k];
              const eq = errorAt(fine, scaled(fine, ...q));
              if (eq < e) {
                e = eq;
                p = q;
                better = true;
              }
            }
          }
          if (!better) for (let k = 0; k < 4; k++) steps[k] /= 2;
        }
        return pageOf(fine, scaled(fine, ...p));
      },
    };
  };
  // Match the surrounding histograms using only levels actually observed there.
  // Interpolate between those anchors: empty histogram bins carry no evidence
  // about the selected drawing, and must not crush its tones or darken white.
  const matchLevels = (picture, page, hole) => {
    for (let c = 0; c < 3; c++) {
      const from = new Float64Array(256);
      const to = new Float64Array(256);
      let n = 0;
      for (let i = 0; i < picture.length; i += 4) {
        if (hole[i + 3]) continue;
        from[picture[i + c]]++;
        to[page[i + c]]++;
        n++;
      }
      if (n < 500) return;
      for (let v = 1; v < 256; v++) {
        from[v] += from[v - 1];
        to[v] += to[v - 1];
      }
      const anchors = [];
      let u = 0;
      for (let v = 0; v < 256; v++) {
        const count = from[v] - (v ? from[v - 1] : 0);
        if (!count) continue;
        // The middle of the levels v stands for, in the page's levels
        const at = from[v] - count / 2;
        while (u < 255 && to[u] < at) u++;
        anchors.push({ from: v, to: u });
      }
      const lut = new Uint8ClampedArray(256);
      let right = 0;
      for (let v = 0; v < 256; v++) {
        while (right < anchors.length - 1 && anchors[right].from < v) right++;
        const b = anchors[right];
        if (v <= anchors[0].from || v >= anchors[anchors.length - 1].from) {
          // Outside the observed range, keep contrast with the nearest offset.
          const edge = v <= anchors[0].from ? anchors[0] : anchors[anchors.length - 1];
          lut[v] = v + edge.to - edge.from;
        } else {
          const a = anchors[Math.max(0, right - 1)];
          lut[v] = a.to + (b.to - a.to) * (v - a.from) / (b.from - a.from);
        }
      }
      for (let i = 0; i < picture.length; i += 4) picture[i + c] = lut[picture[i + c]];
    }
  };
  // Inside `hole`, `picture` brought to the brightness of the page that borders it. A model can
  // draw the inside lighter or darker than its own surroundings (FLUX smooths a screentone into
  // a paler grey), which no levels matched around the hole can see. Along the hole's edge, the
  // page's average just outside is set against the picture's just inside; each piece of the hole
  // gets the correction those differences agree on, a level and a slope (a gradient goes on
  // across it). The edge points that disagree (a balloon's outline, a line of the art next to
  // the hole) weigh nothing, so they don't stain it.
  const matchTones = (picture, page, hole, width, height) => {
    const n = width * height;
    const inside = new Uint8Array(n);
    for (let p = 0; p < n; p++) if (hole[p * 4 + 3]) inside[p] = 1;
    // Averages over a square around each point: of the page outside the hole, of the picture in it
    const r = Math.max(4, Math.min(16, Math.round(Math.sqrt(n) * 0.012)));
    const W1 = width + 1;
    const sums = (fromPicture) => {
      const table = new Float64Array(W1 * (height + 1) * 4);
      for (let y = 0; y < height; y++) {
        const row = [0, 0, 0, 0];
        for (let x = 0; x < width; x++) {
          const p = y * width + x;
          const take = fromPicture ? inside[p] : !inside[p];
          if (take) {
            const source = fromPicture ? picture : page;
            row[0] += source[p * 4];
            row[1] += source[p * 4 + 1];
            row[2] += source[p * 4 + 2];
            row[3]++;
          }
          const at = ((y + 1) * W1 + x + 1) * 4;
          const above = (y * W1 + x + 1) * 4;
          for (let k = 0; k < 4; k++) table[at + k] = table[above + k] + row[k];
        }
      }
      return table;
    };
    const outer = sums(false);
    const inner = sums(true);
    const box = (table, x, y, k) => {
      const a = Math.max(0, x - r);
      const b = Math.max(0, y - r);
      const c = Math.min(width, x + r + 1);
      const d = Math.min(height, y + r + 1);
      return table[(d * W1 + c) * 4 + k] - table[(b * W1 + c) * 4 + k] - table[(d * W1 + a) * 4 + k] + table[(b * W1 + a) * 4 + k];
    };
    const enough = (r * 2 + 1) * (r * 2 + 1) * 0.2;
    // Each piece of the hole on its own, with its edge points: where it is, and how far the
    // page's average stands from the picture's there
    const piece = new Int32Array(n).fill(-1);
    const pieces = [];
    const stack = [];
    for (let start = 0; start < n; start++) {
      if (!inside[start] || piece[start] >= 0) continue;
      const id = pieces.length;
      const one = { pixels: [], samples: [] };
      pieces.push(one);
      piece[start] = id;
      stack.push(start);
      while (stack.length) {
        const p = stack.pop();
        one.pixels.push(p);
        const x = p % width;
        const y = (p - x) / width;
        let edge = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (!inside[q]) edge = true;
          else if (piece[q] < 0) {
            piece[q] = id;
            stack.push(q);
          }
        }
        if (!edge) continue;
        const outCount = box(outer, x, y, 3);
        const inCount = box(inner, x, y, 3);
        if (outCount < enough || inCount < enough) continue;
        const gap = [0, 1, 2].map((k) => box(outer, x, y, k) / outCount - box(inner, x, y, k) / inCount);
        one.samples.push({ x, y, gap });
      }
    }
    pieces.forEach((one) => {
      const { pixels, samples } = one;
      if (samples.length < 8) return;
      let cx = 0;
      let cy = 0;
      samples.forEach((s) => { cx += s.x; cy += s.y; });
      cx /= samples.length;
      cy /= samples.length;
      let spread = 0;
      samples.forEach((s) => { spread = Math.max(spread, Math.abs(s.x - cx), Math.abs(s.y - cy)); });
      // A slope only where the piece is wide enough to show one
      const sloped = spread > r * 3 && samples.length >= 40;
      const scale = spread || 1;
      const offsets = [0, 1, 2].map((k) => {
        // Least squares, again and again, each point weighed by how well it agrees (Tukey):
        // a level, and in a wide piece a slope along x and y
        let fit = [0, 0, 0];
        const values = samples.map((s) => s.gap[k]).sort((a, b) => a - b);
        fit[0] = values[values.length >> 1];
        let cut = 24;
        for (let round = 0; round < 12; round++) {
          const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
          const v = [0, 0, 0];
          const residuals = [];
          samples.forEach((s) => {
            const u = (s.x - cx) / scale;
            const w = (s.y - cy) / scale;
            const e = s.gap[k] - (fit[0] + fit[1] * u + fit[2] * w);
            residuals.push(Math.abs(e));
            const t = e / cut;
            const weight = Math.abs(t) < 1 ? (1 - t * t) * (1 - t * t) : 0;
            if (!weight) return;
            const f = [1, u, w];
            for (let i = 0; i < 3; i++) {
              v[i] += weight * f[i] * s.gap[k];
              for (let j = 0; j < 3; j++) m[i * 3 + j] += weight * f[i] * f[j];
            }
          });
          if (m[0] < 4) break;
          if (sloped) {
            // A little held back, so that a few points can't tip it
            m[4] += m[0] * 0.02;
            m[8] += m[0] * 0.02;
            const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
            if (Math.abs(det) < 1e-9) break;
            const solve = (col) => {
              const a = m.slice();
              for (let i = 0; i < 3; i++) a[i * 3 + col] = v[i];
              return (a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6])) / det;
            };
            fit = [solve(0), solve(1), solve(2)];
          } else fit = [v[0] / m[0], 0, 0];
          // The cut follows how far the points stray: wide at first, then around the agreeing ones
          residuals.sort((a, b) => a - b);
          cut = Math.max(6, Math.min(48, residuals[residuals.length >> 1] * 4.7));
        }
        return fit;
      });
      pixels.forEach((p) => {
        const x = p % width;
        const u = (x - cx) / scale;
        const w = ((p - x) / width - cy) / scale;
        for (let k = 0; k < 3; k++) {
          const [a, b, c] = offsets[k];
          const shift = Math.max(-96, Math.min(96, a + b * u + c * w));
          picture[p * 4 + k] = picture[p * 4 + k] + shift;
        }
      });
    });
  };

  /* -------------------------- Content-Aware Fill -------------------------- */

  // inpaint.js does the long work in a worker, so the page stays alive. A browser that
  // refuses workers runs the same code here, as the script it also is.
  let inpaintWorker = null;
  let inpaintRefused = false;
  let inpaintJobs = 0;
  const inpaintWaiting = new Map();
  const startInpaintWorker = () => new Promise((resolve) => {
    if (inpaintWorker || inpaintRefused) {
      resolve(inpaintWorker);
      return;
    }
    let candidate;
    const lost = () => {
      inpaintRefused = true;
      inpaintWorker = null;
      resolve(null);
      inpaintWaiting.forEach((job) => job.reject(new Error("The fill worker stopped.")));
      inpaintWaiting.clear();
    };
    try {
      candidate = new Worker("inpaint.js");
    } catch (error) {
      lost();
      return;
    }
    const late = setTimeout(lost, 15000);
    candidate.onerror = () => {
      clearTimeout(late);
      lost();
    };
    candidate.onmessage = ({ data }) => {
      if (data.ready) {
        clearTimeout(late);
        inpaintWorker = candidate;
        resolve(candidate);
        return;
      }
      const job = inpaintWaiting.get(data.id);
      if (!job) return;
      if (data.progress !== undefined) {
        if (job.progress) job.progress(data.progress);
        return;
      }
      inpaintWaiting.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data.result);
    };
  });
  const inpaint = async (payload, options, progress) => {
    const worker = await startInpaintWorker();
    if (!worker) {
      if (!window.TypeRInpaint) throw new Error("inpaint.js isn't loaded.");
      return window.TypeRInpaint.inpaint(payload, options, progress);
    }
    return new Promise((resolve, reject) => {
      const id = ++inpaintJobs;
      inpaintWaiting.set(id, { resolve, reject, progress });
      worker.postMessage({ id, payload, options }, [payload.data.buffer, payload.mask.buffer, payload.source.buffer]);
    });
  };

  // Whether what is right around the stroke is a screentone: a pattern that repeats itself,
  // close by, in two directions. A line repeats along itself only; letters, not that closely.
  // If so, the pixels it was read on (those close to the stroke), else null.
  const TONE_RING = 10;
  const TONE_PERIOD = 14;
  const TONE_LIKE = 0.5;
  const TONE_DIP = 0.4;
  const grayAt = (data, i) => data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  const screentoned = (data, mask, width, height) => {
    const n = width * height;
    // The pixels within TONE_RING of the stroke (its steps away from it in `far`)
    const far = new Uint8Array(n);
    const walk = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      far[i] = 1;
      walk[tail++] = i;
    }
    const step = (from, to) => {
      if (far[to] || far[from] > TONE_RING) return;
      far[to] = far[from] + 1;
      walk[tail++] = to;
    };
    while (head < tail) {
      const i = walk[head++];
      const x = i % width;
      if (x > 0) step(i, i - 1);
      if (x < width - 1) step(i, i + 1);
      if (i >= width) step(i, i - width);
      if (i < n - width) step(i, i + width);
    }
    const ring = [];
    for (let k = 0; k < tail; k++) if (!mask[walk[k]] && data[walk[k] * 4 + 3] >= 128) ring.push(walk[k]);
    if (ring.length < 200) return null;
    // A long stroke: one pixel in so many is enough
    const every = Math.max(1, Math.round(ring.length / 20000));
    const tone = (i) => grayAt(data, i);
    let sum = 0;
    let count = 0;
    for (let k = 0; k < ring.length; k += every) {
      sum += tone(ring[k]);
      count++;
    }
    const mean = sum / count;
    let spread = 0;
    for (let k = 0; k < ring.length; k += every) spread += (tone(ring[k]) - mean) ** 2;
    spread /= count;
    // Flat: nothing repeats
    if (spread < 100) return null;
    // How much the tones match, moved by each step (dx, dy) up to TONE_PERIOD: 1 the same
    const likes = new Map();
    for (let dy = 0; dy <= TONE_PERIOD; dy++) {
      for (let dx = -TONE_PERIOD; dx <= TONE_PERIOD; dx++) {
        if ((dy === 0 && dx <= 0) || dx * dx + dy * dy > TONE_PERIOD * TONE_PERIOD) continue;
        let product = 0;
        let pairs = 0;
        for (let k = 0; k < ring.length; k += every) {
          const i = ring[k];
          const x = (i % width) + dx;
          const y = Math.floor(i / width) + dy;
          if (x < 0 || x >= width || y >= height) continue;
          const j = y * width + x;
          if (mask[j] || data[j * 4 + 3] < 128) continue;
          product += (tone(i) - mean) * (tone(j) - mean);
          pairs++;
        }
        if (pairs * 2 >= count) likes.set(`${dx},${dy}`, product / pairs / spread);
      }
    }
    const likeAt = (dx, dy) => (dy < 0 || (dy === 0 && dx < 0) ? likes.get(`${-dx},${-dy}`) : likes.get(`${dx},${dy}`));
    // A step at which it repeats: the same again, after something else on the way (a thick
    // stroke is the same a step further too, but all along the way)
    const repeats = [];
    likes.forEach((like, key) => {
      const [dx, dy] = key.split(",").map(Number);
      if (like < TONE_LIKE || dx * dx + dy * dy < 4) return;
      const between = [0.35, 0.5, 0.65].map((t) => likeAt(Math.round(dx * t), Math.round(dy * t))).filter((value) => value !== undefined);
      if (between.length && Math.min(...between) <= like - TONE_DIP) repeats.push({ dx, dy, like });
    });
    repeats.sort((a, b) => b.like - a.like);
    const first = repeats[0];
    if (!first) return null;
    // And in a second direction, well apart from the first
    const length = Math.hypot(first.dx, first.dy);
    return repeats.some((other) => Math.abs(first.dx * other.dy - first.dy * other.dx) >= 0.5 * length * Math.hypot(other.dx, other.dy)) ? ring : null;
  };

  // Where the Spot Healing Brush may read from: what the edge of the stroke belongs to, grown
  // from it pixel by pixel as long as the colour changes gently. Inside a bubble, that is the
  // bubble, and not its outline nor the sky beyond, which a fill would otherwise bring in; a
  // line crossing the stroke comes along, so it carries on. On a screentone, the paper between
  // the dots joins up on its own, and read alone it would heal into a blank patch: there, what
  // has the tone's look is read too. A busy picture breaks it into crumbs: then everything
  // around is read, as Content-Aware Fill does.
  const HEAL_STEP = 24;
  const healSource = (data, mask, width, height) => {
    const n = width * height;
    const all = new Uint8Array(n).fill(1);
    const reached = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    let holes = 0;
    const open = (i) => !mask[i] && data[i * 4 + 3] >= 128;
    for (let i = 0; i < n; i++) {
      if (mask[i]) {
        holes++;
        continue;
      }
      if (!open(i)) continue;
      const x = i % width;
      const edge = (x > 0 && mask[i - 1]) || (x < width - 1 && mask[i + 1]) || (i >= width && mask[i - width]) || (i < n - width && mask[i + width]);
      if (edge) {
        reached[i] = 1;
        queue[tail++] = i;
      }
    }
    if (!tail) return all;
    const near = (a, b) => Math.abs(data[a * 4] - data[b * 4]) <= HEAL_STEP && Math.abs(data[a * 4 + 1] - data[b * 4 + 1]) <= HEAL_STEP && Math.abs(data[a * 4 + 2] - data[b * 4 + 2]) <= HEAL_STEP;
    const visit = (from, to) => {
      if (reached[to] || !open(to) || !near(from, to)) return;
      reached[to] = 1;
      queue[tail++] = to;
    };
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      if (x > 0) visit(i, i - 1);
      if (x < width - 1) visit(i, i + 1);
      if (i >= width) visit(i, i - width);
      if (i < n - width) visit(i, i + width);
    }
    // Enough to draw from (as much as there is to fill), else the whole neighbourhood
    if (tail < Math.max(600, holes)) return all;
    const ring = screentoned(data, mask, width, height);
    if (!ring) return reached;
    // On a screentone, what has its grain all around (TONE_PERIOD) is read too: its dots, and
    // where the paper breaks into crumbs, with a tone between the screentone's and the paper's
    // (its edge against the plain paper). Not a letter or a dark shape amid it.
    const W = width + 1;
    const sums = new Float64Array(W * (height + 1));
    const squares = new Float64Array(W * (height + 1));
    const counts = new Int32Array(W * (height + 1));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const at = (y + 1) * W + x + 1;
        const ok = !mask[i] && data[i * 4 + 3] >= 128;
        const value = ok ? grayAt(data, i) : 0;
        sums[at] = sums[at - 1] + sums[at - W] - sums[at - W - 1] + value;
        squares[at] = squares[at - 1] + squares[at - W] - squares[at - W - 1] + value * value;
        counts[at] = counts[at - 1] + counts[at - W] - counts[at - W - 1] + (ok ? 1 : 0);
      }
    }
    // The tone and grain around (x, y), in `mean` and `spread`; false if too little is known
    const R = TONE_PERIOD >> 1;
    let mean = 0;
    let spread = 0;
    const around = (x, y) => {
      const top = Math.max(0, y - R) * W;
      const bottom = Math.min(height, y + R + 1) * W;
      const left = Math.max(0, x - R);
      const right = Math.min(width, x + R + 1);
      const box = (table) => table[bottom + right] - table[bottom + left] - table[top + right] + table[top + left];
      const count = box(counts);
      if (count < 4) return false;
      mean = box(sums) / count;
      spread = box(squares) / count - mean * mean;
      return true;
    };
    // The screentone's, read where the stroke's surroundings vary (not the plain paper beside)
    const means = [];
    const spreads = [];
    ring.forEach((i) => {
      if (!around(i % width, Math.floor(i / width)) || spread < 400) return;
      means.push(mean);
      spreads.push(spread);
    });
    if (means.length < 50) return reached;
    const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
    const toneMean = median(means);
    const toneSpread = median(spreads);
    let paper = 0;
    for (let k = 0; k < tail; k++) paper += grayAt(data, queue[k]);
    paper /= tail;
    const lightest = Math.max(toneMean, paper) + HEAL_STEP;
    const darkest = Math.min(toneMean, paper) - HEAL_STEP;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (reached[i] || mask[i] || data[i * 4 + 3] < 128 || !around(x, y)) continue;
        if (mean >= darkest && mean <= lightest && spread >= toneSpread / 4 && spread <= toneSpread * 2) reached[i] = 1;
      }
    }
    return reached;
  };

  const ops = {
    // Image > Canvas Size: the page changes around an anchor, 0 to 1 on each side
    resizeCanvas(width, height, ax, ay, fill) {
      const doc = app.doc;
      if (!doc || (width === doc.width && height === doc.height)) return;
      const ox = Math.round((width - doc.width) * ax);
      const oy = Math.round((height - doc.height) * ay);
      resizeDoc(doc, "Canvas Size", { width, height }, onNewCanvas(doc, width, height, ox, oy, fill));
    },
    // What Free Transform works on: the active pixel layers and texts, and those in the active
    // folders (an SFX's letters with it)
    transformableIds() {
      const doc = app.doc;
      if (!doc) return [];
      const out = new Set();
      withLinked(doc.state.layers, doc.state.activeIds).forEach((id) => familyOf(doc.state.layers, id).forEach((member) => out.add(member)));
      const fits = (layer) => (layer.kind === "text" ? !lockOf(layer, "position") : layer.kind === "raster" && !layer.adjustment && !lockOf(layer, "position") && !lockOf(layer, "pixels") && visualOf(layer, doc));
      return doc.state.layers.filter((layer) => out.has(layer.id) && fits(layer)).map((layer) => layer.id);
    },
    // Where a layer shows: a pixel layer's pixels, a text's letters
    pixelBox(layer) {
      if (!app.doc) return null;
      return layer.kind === "text" ? boxOf(layer, app.doc) : trimmedBox(layer, app.doc);
    },
    setLiveTransform(ids, matrix) {
      const doc = app.doc;
      if (!doc) return;
      doc.liveTransform = ids ? { ids: new Set(ids), matrix } : null;
      if (!ids) doc.sampleCache = null;
    },
    transformLayers(ids, matrix, name) {
      const doc = app.doc;
      if (!doc) return;
      const set = new Set(ids);
      const layers = doc.state.layers.map((layer) => {
        if (!set.has(layer.id)) return layer;
        if (layer.kind === "text") return transformedText(layer, matrix, doc);
        const part = trimmedBox(layer, doc);
        if (!part) return layer;
        const visual = visualOf(Object.assign({}, layer, { mask: null, vectorMask: null }), doc);
        const p = transformedPixels(visual.canvas, visual.x, visual.y, part, matrix);
        let mask = pageMask(layer, doc);
        if (mask && mask.canvas) {
          const x = mask.left || 0;
          const y = mask.top || 0;
          const m = transformedPixels(mask.canvas, x, y, rectFrom(x, y, x + mask.canvas.width, y + mask.canvas.height), matrix, mask.defaultColor ? "#fff" : "#000");
          mask = Object.assign({}, mask, { canvas: m.canvas, left: m.left, top: m.top, right: m.left + m.canvas.width, bottom: m.top + m.canvas.height });
        }
        const next = withPixels(layer, p.canvas, p.left, p.top, mask);
        if (layer.vectorMask) {
          const [a, b, c, d, e, f] = matrix;
          const ax = layer.dx || 0;
          const ay = layer.dy || 0;
          next.vectorMask = mappedVector(layer.vectorMask, (x, y) => [a * (x + ax) + c * (y + ay) + e, b * (x + ax) + d * (y + ay) + f]);
        }
        // As in Photoshop, a Background that is transformed becomes a layer like any other
        if (layer.isBackground) Object.assign(next, { isBackground: false, name: `${(app.names && app.names.layer) || "Layer"} 0` });
        return next;
      });
      commitState(doc, name, { layers });
      firePanelEvent(EVENT_HISTORY);
    },
    // Edit > Auto-Align Layers: the active pixel layers, and those in the active folders. A locked
    // one, or the Background, is the reference and stays where it is, as in Photoshop.
    alignableIds() {
      const doc = app.doc;
      if (!doc) return [];
      const out = new Set();
      doc.state.activeIds.forEach((id) => familyOf(doc.state.layers, id).forEach((member) => out.add(member)));
      return doc.state.layers.filter((layer) => out.has(layer.id) && layer.kind === "raster" && !layer.adjustment && visualOf(layer, doc)).map((layer) => layer.id);
    },
    // `projection`: auto, perspective, collage or reposition. One step in the history; null when
    // the page changed meanwhile.
    // `settle(doc)`: what to wait for before the result lands (what is under way on the page)
    async autoAlignLayers(projection, progress = () => {}, settle = null) {
      const doc = app.doc;
      if (!doc) return null;
      const before = doc.state.layers;
      const wanted = new Set(ops.alignableIds());
      const picked = before.filter((layer) => wanted.has(layer.id)).map((layer) => {
        const part = trimmedBox(layer, doc);
        const visual = part && visualOf(Object.assign({}, layer, { mask: null, vectorMask: null }), doc);
        return visual && { layer, part, visual };
      }).filter(Boolean);
      if (picked.length < 2) return { moved: 0, failed: 0, total: picked.length };
      const aligner = await startAligner();
      try {
        const transfer = [];
        const layers = picked.map(({ layer, part, visual }) => {
          const { data } = pixelsOf(visual.canvas, visual.x, visual.y, part);
          transfer.push(data.buffer);
          return { id: layer.id, x: part.left, y: part.top, width: part.width, height: part.height, data: data.buffer, fixed: Boolean(layer.locked || layer.isBackground) };
        });
        const found = await aligner.ask("analyse", { layers, projection }, transfer, (percent) => progress(Math.round(percent * 0.85)));
        const changed = new Map();
        for (let index = 0; index < found.moves.length; index++) {
          const move = found.moves[index];
          const { layer, part, visual } = picked.find((item) => item.layer.id === move.id);
          // Moved by whole pixels, the pixels stay as they are; otherwise they are drawn again, bicubic
          const shift = move.shift && [1, 0, 0, 1, move.shift[0], move.shift[1]];
          const place = async (source, x, y, rect, fill) => {
            if (shift) return transformedPixels(source, x, y, rect, shift, fill === undefined ? undefined : fill ? "#fff" : "#000");
            const { data } = pixelsOf(source, x, y, rect);
            const out = await aligner.ask("warp", { data: data.buffer, width: rect.width, height: rect.height, x: rect.left, y: rect.top, matrix: move.matrix, fill: fill === undefined ? undefined : fill ? 255 : 0 }, [data.buffer]);
            return { canvas: canvasOfBytes(out), left: out.left, top: out.top };
          };
          let p;
          let mask = pageMask(layer, doc);
          try {
            p = await place(visual.canvas, visual.x, visual.y, part);
            if (mask && mask.canvas) {
              const x = mask.left || 0;
              const y = mask.top || 0;
              const m = await place(mask.canvas, x, y, rectFrom(x, y, x + mask.canvas.width, y + mask.canvas.height), Boolean(mask.defaultColor));
              mask = Object.assign({}, mask, { canvas: m.canvas, left: m.left, top: m.top, right: m.left + m.canvas.width, bottom: m.top + m.canvas.height });
            }
          } catch (error) {
            // Taken too far to draw (past the horizon, or far too big): it stays where it was
            console.warn("SG Typer Studio: a layer could not be aligned", error);
            found.failed.push(move.id);
            continue;
          }
          const next = withPixels(layer, p.canvas, p.left, p.top, mask);
          if (layer.isBackground) Object.assign(next, { isBackground: false, name: `${(app.names && app.names.layer) || "Layer"} 0` });
          changed.set(layer.id, next);
          progress(85 + Math.round(((index + 1) / found.moves.length) * 15));
        }
        if (settle) await settle(doc);
        // The page stayed free meanwhile: the result lands as long as the layers it compared
        // are as they were. The others may have changed.
        if (!app.docs.includes(doc)) return null;
        const now = new Map(doc.state.layers.map((layer) => [layer.id, layer]));
        if (picked.some(({ layer }) => now.get(layer.id) !== layer)) return null;
        if (changed.size) {
          commitState(doc, "Auto-Align Layers", { layers: doc.state.layers.map((layer) => changed.get(layer.id) || layer) });
          firePanelEvent(EVENT_HISTORY);
        }
        return { moved: changed.size, failed: found.failed.length, resized: (found.resized || []).filter((id) => changed.has(id)).length, total: picked.length };
      } finally {
        aligner.stop();
      }
    },
    // The Crop tool: the page becomes a part of what it was, or more than it was. Cropped pixels
    // stay on their layers, as with Canvas Size, unless they are to go.
    crop(left, top, right, bottom, fill, removeHidden) {
      const doc = app.doc;
      if (!doc) return;
      const width = right - left;
      const height = bottom - top;
      if (!left && !top && width === doc.width && height === doc.height) return;
      let layers = onNewCanvas(doc, width, height, -left, -top, fill);
      if (removeHidden) {
        layers = layers.map((layer) => {
          if (layer.kind !== "raster" || layer.isBackground) return layer;
          const visual = visualOf(Object.assign({}, layer, { mask: null, vectorMask: null }), doc);
          if (!visual) return layer;
          const bitmap = newCanvas(width, height);
          bitmap.getContext("2d").drawImage(visual.canvas, visual.x, visual.y);
          return withPixels(layer, bitmap, 0, 0, pageMask(layer, doc));
        });
      }
      resizeDoc(doc, "Crop", { width, height }, layers);
    },
    // An image dropped on a side of the page, for double pages: the page grows on that side
    // and the image goes there, on a layer of its own under everything that sits on the page.
    addPage(bitmap, name, side, fill) {
      const doc = app.doc;
      if (!doc) return null;
      const width = doc.width + bitmap.width;
      const height = Math.max(doc.height, bitmap.height);
      const layers = onNewCanvas(doc, width, height, side === "left" ? bitmap.width : 0, 0, fill);
      const layer = newRaster(name, { bitmap, left: side === "left" ? 0 : doc.width, top: 0 });
      let at = layers[0] && layers[0].isBackground ? 1 : 0;
      while (layers[at] && layers[at].clipping) at++;
      layers.splice(at, 0, layer);
      resizeDoc(doc, "Add Page", { width, height }, layers, { activeIds: [layer.id] });
      firePanelEvent(EVENT_SELECT);
      return layer;
    },
    // Image > Image Size: everything scales. A new resolution alone only renames the sizes:
    // the pixels stay as they are, and a text in points stays as many pixels tall.
    resizeImage(width, height, resolution) {
      const doc = app.doc;
      if (!doc || (width === doc.width && height === doc.height && resolution === doc.resolution)) return;
      const sx = width / doc.width;
      const sy = height / doc.height;
      const points = (sy * doc.resolution) / resolution;
      const layers = doc.state.layers.map((layer) => {
        if (sx === 1 && sy === 1) return layer.kind === "text" ? scaledText(layer, sx, sy, points) : layer;
        if (layer.kind === "text") return Object.assign(scaledText(layer, sx, sy, points), scaledMasks(layer, doc, sx, sy));
        if (layer.kind === "group") return layer.mask || layer.vectorMask ? Object.assign({}, layer, scaledMasks(layer, doc, sx, sy)) : layer;
        return scaledRaster(layer, doc, sx, sy);
      });
      resizeDoc(doc, "Image Size", { width, height, resolution }, layers);
    },
    // The Magic Eraser: what a click on the active pixel layer takes, as the Magic Wand would,
    // goes transparent. A Background becomes Layer 0 first, as in Photoshop: it can't be.
    magicErase(x, y) {
      const doc = app.doc;
      const layer = doc && activeRaster(doc);
      if (!layer || layer.adjustment) return false;
      if (lockOf(layer, "pixels") || lockOf(layer, "transparency")) {
        emit("layer-locked");
        return false;
      }
      const region = magicRegion(doc, layer, x, y);
      if (!region) return false;
      const op = { t: "fill", erase: true, clip: { canvas: region.canvas, x: region.x - (layer.dx || 0), y: region.y - (layer.dy || 0) } };
      const changes = { paint: (layer.paint || NONE).concat([op]) };
      if (layer.isBackground) Object.assign(changes, { isBackground: false, name: `${(app.names && app.names.layer) || "Layer"} 0` });
      commitState(doc, "Magic Eraser", { layers: replaceLayer(doc, layer, changes) });
      return true;
    },
    // bubbleOnly: a finger's tap that pastes the script's line. What isn't a bubble is left
    // unselected, and false says so.
    wandAt(x, y, mode, bubbleOnly) {
      const doc = app.doc;
      if (!doc) return null;
      // Beside the page there is nothing to select: a click there lets go of the selection
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return !mode || mode === "new" ? ops.deselect() : null;
      const selection = floodSelect(doc, x, y, app.tolerance);
      if (bubbleOnly && !looksLikeBubble(doc, selection)) return false;
      selection.trigger = { source: "wand", x: Math.round(x), y: Math.round(y) };
      return ops.userSelection(selection, "Magic Wand", mode);
    },
    // Color Range reads what the Magic Wand reads with all layers: the page, never the text
    colorRangeSource(maxSide) {
      const doc = app.doc;
      if (!doc) return null;
      const data = sampleData(doc, true);
      const scale = Math.min(1, maxSide / Math.max(doc.width, doc.height));
      const width = Math.max(1, Math.round(doc.width * scale));
      const height = Math.max(1, Math.round(doc.height * scale));
      const full = newCanvas(doc.width, doc.height);
      full.getContext("2d").putImageData(new ImageData(data, doc.width, doc.height), 0, 0);
      const small = newCanvas(width, height);
      const ctx = small.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(full, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      // Only inside the selection, if there is one, as in Photoshop
      const selection = doc.state.selection;
      let inside = null;
      if (selection) {
        inside = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) inside[y * width + x] = selectionContains(selection, (x + 0.5) / scale, (y + 0.5) / scale) ? 1 : 0;
        }
      }
      return { image, width, height, scale, inside };
    },
    colorRangePreview(source, settings) {
      const cover = rangeCoverage(source.image.data, source.width, source.height, settings, source.scale);
      if (source.inside) for (let i = 0; i < cover.length; i++) if (!source.inside[i]) cover[i] = 0;
      return cover;
    },
    colorAt(x, y) {
      const doc = app.doc;
      if (!doc) return null;
      const px = Math.floor(x);
      const py = Math.floor(y);
      if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) return null;
      const data = sampleData(doc, true);
      const i = (py * doc.width + px) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    },
    // What belongs half or more becomes the selection, within the one there was.
    // Returns false when no pixel does, and the selection stays as it was.
    colorRange(settings) {
      const doc = app.doc;
      if (!doc) return false;
      const cover = rangeCoverage(sampleData(doc, true), doc.width, doc.height, settings);
      const inside = doc.state.selection ? fullMaskOf(doc, doc.state.selection) : null;
      const full = new Uint8Array(cover.length);
      for (let i = 0; i < full.length; i++) full[i] = cover[i] >= 128 && (!inside || inside[i]) ? 1 : 0;
      const selection = fromFullMask(doc, full, "colorRange");
      if (!selection) return false;
      ops.quietSelection(selection, "Color Range");
      return true;
    },
    rectangle(left, top, right, bottom, mode) {
      const doc = app.doc;
      if (!doc) return null;
      const b = rectFrom(Math.round(Math.max(0, left)), Math.round(Math.max(0, top)), Math.round(Math.min(doc.width, right)), Math.round(Math.min(doc.height, bottom)));
      if (b.width < 4 || b.height < 4) return mode && mode !== "new" ? null : ops.deselect();
      return ops.userSelection(makeSelection({ rect: b }), "Rectangular Marquee", mode);
    },
    ellipse(left, top, right, bottom, mode) {
      const doc = app.doc;
      if (!doc) return null;
      const selection = right - left >= 4 && bottom - top >= 4 ? ellipseSelection(doc, left, top, right, bottom) : null;
      if (!selection) return mode && mode !== "new" ? null : ops.deselect();
      return ops.userSelection(selection, "Elliptical Marquee", mode);
    },
    lasso(points, mode, name = "Lasso") {
      const doc = app.doc;
      if (!doc || points.length < 3) return mode && mode !== "new" ? null : ops.deselect();
      const selection = polygonSelection(doc, points);
      if (!selection) return ops.deselect();
      return ops.userSelection(selection, name, mode);
    },
    userSelection(selection, name, mode) {
      const doc = app.doc;
      const current = doc.state.selection;
      const combining = mode && mode !== "new" && current;
      let final = selection;
      let label = name;
      if (combining) {
        final = combineSelections(doc, current, selection, mode);
        label = { add: "Add to Selection", subtract: "Subtract from Selection", intersect: "Intersect Selection" }[mode];
        if (!final) return ops.deselect();
      }
      commitState(doc, label, { selection: final, lastSelection: final });
      emit("selection", final);
      // Only a new selection is a click TypeR can paste into
      if (combining) firePanelEvent(EVENT_HISTORY);
      else {
        const descriptor = descriptorFor(final);
        fireWhenIdle(() => firePanelEvent(EVENT_SET, descriptor));
      }
      return final;
    },
    // Selections from the menu never trigger a paste
    quietSelection(selection, name) {
      const doc = app.doc;
      if (!doc) return null;
      commitState(doc, name, { selection, lastSelection: selection || doc.state.lastSelection });
      emit("selection", selection);
      firePanelEvent(EVENT_HISTORY);
      return selection;
    },
    selectAll() {
      const doc = app.doc;
      if (doc) ops.quietSelection(makeSelection({ rect: rectFrom(0, 0, doc.width, doc.height) }), "Select All");
    },
    invert() {
      const doc = app.doc;
      if (!doc || !doc.state.selection) return;
      const inverted = invertSelection(doc, doc.state.selection);
      if (inverted) ops.quietSelection(inverted, "Inverse");
      else ops.deselect();
    },
    reselect() {
      const doc = app.doc;
      if (doc && doc.state.lastSelection && !doc.state.selection) ops.quietSelection(doc.state.lastSelection, "Reselect");
    },
    grow(radius) {
      const doc = app.doc;
      if (!doc || !doc.state.selection || !radius) return;
      const next = growSelection(doc, doc.state.selection, radius);
      if (next) ops.quietSelection(next, radius > 0 ? "Expand" : "Contract");
      else ops.deselect();
    },
    selectionContains(x, y) {
      const doc = app.doc;
      return Boolean(doc && doc.state.selection && selectionContains(doc.state.selection, x, y));
    },
    nudgeSelection(dx, dy, coalesce) {
      const doc = app.doc;
      if (!doc || !doc.state.selection) return;
      const moved = translateSelection(doc.state.selection, dx, dy);
      commitState(doc, "Move Selection", { selection: moved, lastSelection: moved }, coalesce);
      emit("selection", moved);
    },
    deselect() {
      const doc = app.doc;
      if (!doc || !doc.state.selection) return null;
      commitState(doc, "Deselect", { selection: null });
      emit("selection", null);
      return null;
    },
    selectLayer(id, additive) {
      const doc = app.doc;
      if (!doc) return;
      const ids = additive ? (doc.state.activeIds.includes(id) ? doc.state.activeIds.filter((item) => item !== id) : doc.state.activeIds.concat([id])) : [id];
      doc.state = Object.assign({}, doc.state, { activeIds: ids });
      emit("history");
      emit("active");
      firePanelEvent(EVENT_SELECT);
    },
    // No active layer: on a touch screen, what hides the handles and the text's actions
    clearActiveLayers() {
      const doc = app.doc;
      if (!doc || !doc.state.activeIds.length) return;
      doc.state = Object.assign({}, doc.state, { activeIds: [] });
      emit("history");
      emit("active");
      firePanelEvent(EVENT_SELECT);
    },
    toggleLayer(id) {
      const doc = app.doc;
      if (!doc) return;
      const layer = doc.state.layers.find((item) => item.id === id);
      if (!layer) return;
      commitState(doc, layer.visible === false ? "Show Layer" : "Hide Layer", { layers: replaceLayer(doc, layer, { visible: layer.visible === false }) });
    },
    setLayerProps(id, changes, name, coalesce) {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id);
      if (!layer) return;
      commitState(doc, name || "Layer Properties", { layers: replaceLayer(doc, layer, changes) }, coalesce);
    },
    // A whole new list of layers in one step, as an SFX lays out its letters again. `amend`
    // puts it in the step just made instead, as when a pasted line turns into an SFX.
    setLayers(layers, name, { coalesce, activeIds, amend, selection } = {}) {
      const doc = app.doc;
      if (!doc) return;
      const change = { layers };
      if (activeIds) change.activeIds = activeIds.filter((id) => layers.some((layer) => layer.id === id));
      if (selection !== undefined) change.selection = selection;
      if (amend) {
        doc.state = Object.assign({}, doc.state, change);
        doc.history[doc.historyIndex].state = doc.state;
        emit("history");
        emit("render");
      } else commitState(doc, name, change, coalesce);
      if (selection === null) emit("selection", null);
      firePanelEvent(activeIds ? EVENT_SELECT : EVENT_HISTORY);
    },
    // The live part of a move: only the picture on screen changes until it ends
    beginLiveMove(ids) {
      const doc = app.doc;
      if (!doc) return [];
      const list = movableIds(doc, ids);
      doc.live = { ids: new Set(list), dx: 0, dy: 0 };
      return list;
    },
    updateLiveMove(dx, dy) {
      const doc = app.doc;
      if (!doc || !doc.live) return;
      const before = liveBounds(doc);
      doc.live.dx = dx;
      doc.live.dy = dy;
      const after = liveBounds(doc);
      emit("render", before && after ? pageRect(doc, Math.min(before.left, after.left), Math.min(before.top, after.top), Math.max(before.right, after.right), Math.max(before.bottom, after.bottom)) : undefined);
    },
    endLiveMove(commit) {
      const doc = app.doc;
      if (!doc || !doc.live) return;
      const { ids, dx, dy } = doc.live;
      doc.live = null;
      const x = Math.round(dx);
      const y = Math.round(dy);
      if (commit && (x || y)) ops.moveLayers(Array.from(ids), x, y);
      else emit("render");
    },
    moveLayers(ids, dx, dy, coalesce) {
      const doc = app.doc;
      if (!doc || (!dx && !dy)) return;
      const list = movableIds(doc, ids);
      if (!list.length) return;
      const set = new Set(list);
      // A folder that moves whole takes its masks along
      ids.forEach((id) => familyOf(doc.state.layers, id).forEach((member) => {
        const layer = doc.state.layers.find((item) => item.id === member);
        if (layer && layer.kind === "group" && !layer.locked && (layer.mask || layer.vectorMask)) set.add(member);
      }));
      commitState(doc, "Move", { layers: doc.state.layers.map((layer) => (set.has(layer.id) ? shifted(layer, dx, dy, doc) : layer)) }, coalesce);
      firePanelEvent(EVENT_MOVE);
    },
    moveLayer(id, dx, dy) {
      ops.moveLayers([id], dx, dy);
    },
    // The top layer under a point: text by its box, pixels by what is painted there. A letter
    // of an SFX gives its SFX, unless `deep` asks for the letter itself.
    hitLayer(x, y, deep) {
      const doc = app.doc;
      if (!doc) return null;
      const layers = doc.state.layers;
      const byId = new Map(layers.map((layer) => [layer.id, layer]));
      const sfxOf = (layer) => {
        let found = null;
        for (let id = layer.group; id; ) {
          const parent = byId.get(id);
          if (!parent) break;
          if (parent.sfx) found = parent;
          id = parent.group;
        }
        return found;
      };
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (layer.kind === "group" || layer.locked || layer.isBackground || !chainOf(layer, byId).visible) continue;
        if (layer.kind === "text") {
          // A turned letter answers inside its own turned box, not the square around it
          let inside;
          if (layer.rotated && !layer.warp) {
            const f = turnedFrame(layer, doc);
            const [a, b, , d] = f.corners;
            const ux = b[0] - a[0];
            const uy = b[1] - a[1];
            const vx = d[0] - a[0];
            const vy = d[1] - a[1];
            const lu = Math.hypot(ux, uy) || 1;
            const lv = Math.hypot(vx, vy) || 1;
            const pu = ((x - a[0]) * ux + (y - a[1]) * uy) / lu;
            const pv = ((x - a[0]) * vx + (y - a[1]) * vy) / lv;
            inside = pu >= -6 && pu <= lu + 6 && pv >= -6 && pv <= lv + 6;
          } else {
            const box = frameOf(layer, doc);
            inside = x >= box.left - 6 && x <= box.right + 6 && y >= box.top - 6 && y <= box.bottom + 6;
          }
          if (inside) return (!deep && sfxOf(layer)) || layer;
          continue;
        }
        const visual = visualOf(layer, doc);
        if (!visual) continue;
        const px = Math.floor(x - visual.x);
        const py = Math.floor(y - visual.y);
        if (px < 0 || py < 0 || px >= visual.canvas.width || py >= visual.canvas.height) continue;
        const ctx = visual.canvas.getContext("2d");
        if (ctx && ctx.getImageData(px, py, 1, 1).data[3] > 24) return layer;
      }
      return null;
    },
    // A paste is a layer too: one step that also drops the selection, as in Photoshop
    newLayer(name, above, fields, pasted) {
      const doc = app.doc;
      if (!doc) return null;
      const count = doc.state.layers.filter((layer) => layer.kind === "raster" && !layer.clean).length + 1;
      const layer = newRaster(name || `${(app.names && app.names.layer) || "Layer"} ${count}`, fields);
      const anchor = above !== undefined ? above : doc.state.activeIds[doc.state.activeIds.length - 1];
      const at = doc.state.layers.findIndex((item) => item.id === anchor);
      const layers = doc.state.layers.slice();
      if (at >= 0) {
        layer.group = layers[at].kind === "group" ? layers[at].id : layers[at].group;
        const slot = layers[at].kind === "group" ? at : at + 1;
        layers.splice(slot, 0, layer);
        // Inside a clipping mask, it joins it, as in Photoshop: clipped when the layer above is
        const over = layers[slot + 1];
        if (!pasted && over && over.clipping && over.kind !== "group" && (over.group || null) === (layer.group || null)) layer.clipping = true;
      } else layers.push(layer);
      const hadSelection = Boolean(doc.state.selection);
      commitState(doc, pasted ? "Paste" : "New Layer", pasted ? { layers, activeIds: [layer.id], selection: null } : { layers, activeIds: [layer.id] });
      if (pasted && hadSelection) emit("selection", null);
      firePanelEvent(EVENT_SELECT);
      return layer;
    },
    newGroup(name) {
      const doc = app.doc;
      if (!doc) return null;
      const group = { id: newId(), kind: "group", name: name || "Group", visible: true, opacity: 1, blend: "pass through", open: true, group: null };
      commitState(doc, "New Group", { layers: doc.state.layers.concat([group]), activeIds: [group.id] });
      return group;
    },
    duplicateLayers() {
      const doc = app.doc;
      if (!doc) return;
      const layers = doc.state.layers.slice();
      const created = [];
      doc.state.activeIds.forEach((id) => {
        const at = layers.findIndex((item) => item.id === id);
        if (at < 0 || layers[at].kind === "group") return;
        const copy = Object.assign({}, layers[at], { id: newId(), name: layers[at].name + " copy", isBackground: false, raw: layers[at].raw ? Object.assign({}, layers[at].raw) : undefined });
        layers.splice(at + 1, 0, copy);
        created.push(copy.id);
      });
      if (created.length) commitState(doc, "Duplicate Layer", { layers, activeIds: created });
    },
    // Cmd+J with a selection on one pixel layer, Photoshop's Layer via Copy: only the selected
    // pixels, on a new layer just above, which looks like its source; the selection is dropped.
    // null when it doesn't apply (Cmd+J then duplicates the whole layer), "empty" when the
    // selection holds none of the layer's pixels.
    layerViaCopy(name) {
      const doc = app.doc;
      const selection = doc && doc.state.selection;
      if (!selection || doc.state.activeIds.length !== 1) return null;
      const layer = activeRaster(doc);
      if (!layer) return null;
      const visual = rasterVisual(layer, doc);
      if (!visual) return "empty";
      const b = selection.bounds;
      const left = Math.max(Math.floor(b.left), Math.floor(visual.x));
      const top = Math.max(Math.floor(b.top), Math.floor(visual.y));
      const right = Math.min(Math.ceil(b.right), Math.ceil(visual.x + visual.canvas.width));
      const bottom = Math.min(Math.ceil(b.bottom), Math.ceil(visual.y + visual.canvas.height));
      if (right <= left || bottom <= top) return "empty";
      const bitmap = newCanvas(right - left, bottom - top);
      const ctx = bitmap.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(visual.canvas, visual.x - left, visual.y - top);
      const clip = clipOf(selection, 0, 0);
      if (clip.canvas) {
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(clip.canvas, clip.x - left, clip.y - top);
        ctx.globalCompositeOperation = "source-over";
      }
      const alpha = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let any = false;
      for (let i = 3; i < alpha.length && !any; i += 4) any = alpha[i] > 0;
      if (!any) return "empty";
      const copy = newRaster(name || layer.name + " copy", { bitmap, left, top, opacity: layer.opacity, blend: layer.blend, fill: layer.fill, knockout: layer.knockout, stroke: layer.stroke ? clone(layer.stroke) : undefined, group: layer.group || null, clipping: Boolean(layer.clipping) });
      const layers = doc.state.layers.slice();
      layers.splice(layers.indexOf(layer) + 1, 0, copy);
      commitState(doc, "Duplicate Layer", { layers, activeIds: [copy.id], selection: null });
      emit("selection", null);
      firePanelEvent(EVENT_SELECT);
      return copy;
    },
    // The selected layers in a new group, where the topmost of them was
    groupLayers(name) {
      const doc = app.doc;
      if (!doc) return null;
      const layers = doc.state.layers;
      const chosen = doc.state.activeIds.filter((id) => {
        const layer = layers.find((item) => item.id === id);
        return layer && !layer.isBackground;
      });
      if (!chosen.length) return null;
      const moving = new Set();
      chosen.forEach((id) => familyOf(layers, id).forEach((member) => moving.add(member)));
      const members = layers.filter((layer) => moving.has(layer.id));
      const roots = members.filter((layer) => !moving.has(layer.group));
      const topRoot = roots[roots.length - 1];
      const group = { id: newId(), kind: "group", name: name || "Group", visible: true, opacity: 1, blend: "pass through", open: true, group: topRoot.group || null };
      const lastAt = layers.lastIndexOf(members[members.length - 1]);
      const rest = layers.filter((layer) => !moving.has(layer.id));
      const at = layers.slice(0, lastAt).filter((layer) => !moving.has(layer.id)).length;
      const moved = members.map((layer) => (roots.includes(layer) ? Object.assign({}, layer, { group: group.id }) : layer));
      commitState(doc, "Group Layers", { layers: rest.slice(0, at).concat(moved, [group], rest.slice(at)), activeIds: [group.id] });
      firePanelEvent(EVENT_SELECT);
      return group;
    },
    ungroupLayers() {
      const doc = app.doc;
      if (!doc) return;
      const groups = doc.state.layers.filter((layer) => layer.kind === "group" && doc.state.activeIds.includes(layer.id));
      if (!groups.length) return;
      const gone = new Map(groups.map((group) => [group.id, group]));
      const parentOf = (id) => {
        let parent = id;
        while (parent && gone.has(parent)) parent = gone.get(parent).group || null;
        return parent || null;
      };
      const freed = doc.state.layers.filter((layer) => gone.has(layer.group)).map((layer) => layer.id);
      const layers = doc.state.layers.filter((layer) => !gone.has(layer.id)).map((layer) => (gone.has(layer.group) ? Object.assign({}, layer, { group: parentOf(layer.group) }) : layer));
      commitState(doc, "Ungroup Layers", { layers, activeIds: freed.filter((id) => layers.some((layer) => layer.id === id)) });
      firePanelEvent(EVENT_SELECT);
    },
    // Layers carried to another page. Their pixels are never drawn on again, so they can be
    // shared; only what depends on the page's size changes when they land.
    copyLayers() {
      const doc = app.doc;
      if (!doc || !doc.state.activeIds.length) return 0;
      const chosen = new Set();
      doc.state.activeIds.forEach((id) => familyOf(doc.state.layers, id).forEach((member) => chosen.add(member)));
      const layers = doc.state.layers.filter((layer) => chosen.has(layer.id));
      app.layerClipboard = { layers, width: doc.width, height: doc.height };
      return layers.length;
    },
    pasteLayers() {
      const doc = app.doc;
      const held = app.layerClipboard;
      if (!doc || !held) return 0;
      const ids = new Map(held.layers.map((layer) => [layer.id, newId()]));
      const copies = held.layers.map((layer) => {
        const copy = Object.assign({}, layer, { id: ids.get(layer.id), group: ids.get(layer.group) || null, isBackground: false, clean: false, raw: layer.raw ? Object.assign({}, layer.raw) : undefined });
        if (layer.kind === "text") {
          copy.params = clone(layer.params);
          const point = copy.params.layerText.textClickPoint;
          point.horizontal = ((point.horizontal / 100) * held.width / doc.width) * 100;
          point.vertical = ((point.vertical / 100) * held.height / doc.height) * 100;
        }
        return copy;
      });
      commitState(doc, "Paste Layers", { layers: doc.state.layers.concat(copies), activeIds: copies.filter((layer) => !layer.group).map((layer) => layer.id) });
      firePanelEvent(EVENT_SELECT);
      return copies.length;
    },
    // A text's look without its words, from one layer to others
    copyLayerStyle() {
      const doc = app.doc;
      const id = doc && doc.state.activeIds[doc.state.activeIds.length - 1];
      const layer = doc && doc.state.layers.find((item) => item.id === id);
      if (!layer) return false;
      const lt = layer.kind === "text" ? layer.params.layerText : null;
      app.styleClipboard = {
        text: lt ? clone(lt.textStyleRange[0].textStyle) : null,
        paragraph: lt ? clone(lt.paragraphStyleRange[0].paragraphStyle) : null,
        antiAlias: lt ? lt.antiAlias : null,
        stroke: layer.stroke ? clone(layer.stroke) : null,
        effects: layer.kind === "text" && layer.effects ? clone(layer.effects) : null,
        blend: layer.blend,
        opacity: layer.opacity,
      };
      return true;
    },
    pasteLayerStyle() {
      const doc = app.doc;
      const held = app.styleClipboard;
      if (!doc || !held) return;
      const chosen = new Set(doc.state.activeIds);
      const byId = new Map(doc.state.layers.map((layer) => [layer.id, layer]));
      // An SFX's letters are drawn again from its recipe: effects on them would be lost
      const inSfx = (layer) => {
        for (let id = layer.group; id; ) {
          const parent = byId.get(id);
          if (!parent) return false;
          if (parent.sfx) return true;
          id = parent.group;
        }
        return false;
      };
      const layers = doc.state.layers.map((layer) => {
        if (!chosen.has(layer.id) || layer.kind === "group") return layer;
        const next = Object.assign({}, layer);
        if (layer.kind !== "text" || held.text) {
          next.blend = held.blend;
          next.opacity = held.opacity;
        }
        if (layer.kind !== "text" || !held.text) return next;
        const box = boxOf(layer, doc);
        next.params = clone(layer.params);
        const lt = next.params.layerText;
        lt.textStyleRange.forEach((range) => { range.textStyle = clone(held.text); });
        lt.paragraphStyleRange.forEach((range) => { range.paragraphStyle = Object.assign(range.paragraphStyle, clone(held.paragraph)); });
        if (held.antiAlias) lt.antiAlias = held.antiAlias;
        next.stroke = held.stroke ? clone(held.stroke) : null;
        if (!inSfx(layer)) next.effects = held.effects ? clone(held.effects) : undefined;
        next.raster = null;
        return boxShape(lt) ? next : centredOn(next, doc, box.xMid, box.yMid);
      });
      commitState(doc, "Paste Layer Style", { layers });
      firePanelEvent(EVENT_HISTORY);
    },
    // A layer's pixels as a selection. It's not a click: TypeR doesn't paste into it.
    selectLayerPixels(id, mode) {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id);
      // As Photoshop's: the layer's own pixels, without the shadow or the glow of its effects
      const visual = layer && visualOf(layer.effects ? Object.assign({}, layer, { effects: undefined }) : layer, doc);
      if (!visual || !visual.canvas.width || !visual.canvas.height) return null;
      const left = Math.max(0, Math.ceil(visual.x));
      const top = Math.max(0, Math.ceil(visual.y));
      const right = Math.min(doc.width, Math.floor(visual.x + visual.canvas.width));
      const bottom = Math.min(doc.height, Math.floor(visual.y + visual.canvas.height));
      if (right <= left || bottom <= top) return null;
      const pixels = visual.canvas.getContext("2d").getImageData(left - visual.x, top - visual.y, right - left, bottom - top).data;
      const width = right - left;
      const height = bottom - top;
      let x0 = width;
      let y0 = height;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (pixels[(y * width + x) * 4 + 3] < 128) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) return null;
      const boxW = x1 - x0 + 1;
      const boxH = y1 - y0 + 1;
      const mask = new Uint8Array(boxW * boxH);
      for (let y = 0; y < boxH; y++) {
        for (let x = 0; x < boxW; x++) {
          if (pixels[((y + y0) * width + x + x0) * 4 + 3] >= 128) mask[y * boxW + x] = 1;
        }
      }
      const selection = makeSelection({ source: "layer", mask, boxW, boxH, left: left + x0, top: top + y0 });
      return mode ? ops.userSelection(selection, "Load Selection", mode) : ops.quietSelection(selection, "Load Selection");
    },
    // Every open page, each with its own history
    replaceFonts(faces) {
      let count = 0;
      app.docs.forEach((doc) => {
        let touched = false;
        const layers = doc.state.layers.map((layer) => {
          if (layer.kind !== "text" || !layer.params.layerText.textStyleRange.some((range) => faces[range.textStyle.fontPostScriptName])) return layer;
          const params = clone(layer.params);
          params.layerText.textStyleRange.forEach((range) => {
            const face = faces[range.textStyle.fontPostScriptName];
            if (face) Object.assign(range.textStyle, face);
          });
          touched = true;
          count++;
          return Object.assign({}, layer, { params, raster: null });
        });
        if (touched) commitState(doc, "Replace Fonts", { layers });
      });
      return count;
    },
    // Typing after this starts a history step of its own, whatever came just before
    sealHistory() {
      const doc = app.doc;
      if (doc) doc.history[doc.historyIndex].coalesce = null;
    },
    deleteLayers() {
      const doc = app.doc;
      if (!doc || !doc.state.activeIds.length) return;
      const gone = new Set();
      let refused = false;
      doc.state.activeIds.forEach((id) => {
        const family = Array.from(familyOf(doc.state.layers, id));
        if (family.some((member) => doc.state.layers.find((layer) => layer.id === member).locked)) refused = true;
        else family.forEach((member) => gone.add(member));
      });
      if (refused) emit("layer-locked");
      if (!gone.size) return;
      const layers = doc.state.layers.filter((layer) => !gone.has(layer.id));
      const top = layers[layers.length - 1];
      commitState(doc, "Delete Layer", { layers, activeIds: top ? [top.id] : [] });
      firePanelEvent(EVENT_SELECT);
    },
    // New place in the stack: before the index in the list without the moved rows
    reorderLayer(id, targetId, position) {
      ops.reorderLayers([id], targetId, position);
    },
    // Several layers at once, as the Layers panel drags them: each with what its folder holds,
    // in their order. With `copy` (Alt in Photoshop), copies go there and the layers stay.
    reorderLayers(ids, targetId, position, copy) {
      const doc = app.doc;
      if (!doc) return;
      const plan = reorderPlan(doc.state.layers, ids, targetId, position, copy);
      if (!plan) return;
      if (!copy) {
        commitState(doc, "Reorder Layer", { layers: plan.layers });
        return;
      }
      commitState(doc, "Duplicate Layer", { layers: plan.layers, activeIds: plan.activeIds });
      firePanelEvent(EVENT_SELECT);
    },
    // While layers are dragged in the panel, the page shows them where they would land
    previewOrder(ids, targetId, position) {
      const doc = app.doc;
      if (!doc) return;
      const plan = ids ? reorderPlan(doc.state.layers, ids, targetId, position, false) : null;
      const layers = plan ? plan.layers : null;
      if (layers === doc.orderPreview || (!layers && !doc.orderPreview)) return;
      doc.orderPreview = layers;
      emit("render");
    },
    // A blend mode tried from the Layers panel's list, shown before it is picked
    previewBlend(ids, blend) {
      const doc = app.doc;
      if (!doc) return;
      const next = blend ? { ids: new Set(ids), blend } : null;
      if (!next && !doc.blendPreview) return;
      if (next && doc.blendPreview && doc.blendPreview.blend === blend) return;
      doc.blendPreview = next;
      emit("render");
    },
    // Layers dragged from another page's panel: copied here, where they were dropped, or on top
    pasteLayersFrom(source, ids, targetId, position) {
      const doc = app.doc;
      if (!doc || !source || source === doc) return 0;
      const chosen = new Set();
      ids.forEach((id) => familyOf(source.state.layers, id).forEach((member) => chosen.add(member)));
      const held = source.state.layers.filter((layer) => chosen.has(layer.id));
      if (!held.length) return 0;
      const fresh = new Map(held.map((layer) => [layer.id, newId()]));
      const copies = held.map((layer) => {
        const copy = Object.assign({}, layer, { id: fresh.get(layer.id), group: fresh.get(layer.group) || null, isBackground: false, clean: false, link: undefined, raw: layer.raw ? Object.assign({}, layer.raw) : undefined });
        if (layer.kind === "text") {
          copy.params = clone(layer.params);
          const point = copy.params.layerText.textClickPoint;
          point.horizontal = ((point.horizontal / 100) * source.width / doc.width) * 100;
          point.vertical = ((point.vertical / 100) * source.height / doc.height) * 100;
        }
        return copy;
      });
      const heads = copies.filter((layer) => !layer.group).map((layer) => layer.id);
      let layers = doc.state.layers.concat(copies);
      const target = targetId !== undefined && doc.state.layers.find((layer) => layer.id === targetId);
      if (target) {
        const plan = reorderPlan(layers, heads, target.id, position, false);
        if (plan) layers = plan.layers;
      }
      commitState(doc, "Paste Layers", { layers, activeIds: heads });
      firePanelEvent(EVENT_SELECT);
      return copies.length;
    },
    // Cmd + click on the New Layer button: under the active layer, as in Photoshop. Under a
    // clipped layer, it joins the clipping mask.
    newLayerBelow(name) {
      const doc = app.doc;
      if (!doc) return null;
      const active = doc.state.layers.find((layer) => layer.id === doc.state.activeIds[doc.state.activeIds.length - 1]);
      if (!active || active.isBackground) return ops.newLayer(name);
      const members = familyOf(doc.state.layers, active.id);
      const at = doc.state.layers.findIndex((layer) => members.has(layer.id));
      const layer = newRaster(name, { group: active.group || null, clipping: active.kind !== "group" && Boolean(active.clipping) });
      const layers = doc.state.layers.slice();
      layers.splice(at, 0, layer);
      commitState(doc, "New Layer", { layers, activeIds: [layer.id] });
      firePanelEvent(EVENT_SELECT);
      return layer;
    },
    mergeDown() {
      const doc = app.doc;
      if (!doc) return;
      const id = doc.state.activeIds[doc.state.activeIds.length - 1];
      const at = doc.state.layers.findIndex((layer) => layer.id === id);
      if (at < 1) return;
      const top = doc.state.layers[at];
      if (top.kind === "group") {
        ops.mergeGroup(top.id);
        return;
      }
      const below = doc.state.layers[at - 1];
      if (below.kind === "group") return;
      if (top.locked || below.locked) {
        emit("layer-locked");
        return;
      }
      // The merged pixels already have each layer's opacity in them. Two layers clipped to the
      // same base merge as they are, and the result stays clipped to it.
      const info = clippingOf(doc.state.layers);
      const bothClipped = info.clipped.has(top.id) && info.clipped.has(below.id);
      const merged = newRaster(below.name, { group: below.group, isBackground: below.isBackground, blend: below.blend, opacity: 1, clipping: bothClipped });
      merged.bitmap = paintAlone(doc, bothClipped ? [Object.assign({}, below, { clipping: false }), Object.assign({}, top, { clipping: false })] : [below, top]);
      const layers = doc.state.layers.slice();
      layers.splice(at - 1, 2, merged);
      commitState(doc, "Merge Layers", { layers, activeIds: [merged.id] });
    },
    // The selected layers into one, what shows of them. Alone, a layer goes into the one below.
    mergeSelected() {
      const doc = app.doc;
      if (!doc) return;
      if (doc.state.activeIds.length < 2) {
        ops.mergeDown();
        return;
      }
      const all = doc.state.layers;
      const chosen = new Set();
      doc.state.activeIds.forEach((id) => familyOf(all, id).forEach((member) => chosen.add(member)));
      const list = all.filter((layer) => chosen.has(layer.id) && layer.kind !== "group" && layer.visible !== false);
      // A folder goes into the merge whole, as in Photoshop: it and what it holds are gone after
      const folders = all.filter((layer) => layer.kind === "group" && doc.state.activeIds.includes(layer.id));
      if (list.length < 2 && !folders.length) return;
      const gone = new Set(list.map((layer) => layer.id));
      folders.forEach((folder) => familyOf(all, folder.id).forEach((member) => gone.add(member)));
      if (all.some((layer) => gone.has(layer.id) && layer.locked)) {
        emit("layer-locked");
        return;
      }
      const drawn = all.filter((layer) => gone.has(layer.id) && (layer.kind === "group" || layer.visible !== false));
      const bottom = list[0] || drawn[0];
      const top = drawn[drawn.length - 1];
      const anchor = bottom.isBackground ? bottom : top;
      const merged = newRaster(top.name, { group: bottom.isBackground ? null : outsideOf(anchor.group, gone, all), isBackground: Boolean(bottom.isBackground), blend: bottom.kind === "group" ? "normal" : bottom.blend, opacity: 1 });
      merged.bitmap = paintAlone(doc, drawn);
      const layers = all.flatMap((layer) => (layer === anchor ? [merged] : gone.has(layer.id) ? [] : [layer]));
      commitState(doc, "Merge Layers", { layers, activeIds: [merged.id] });
      firePanelEvent(EVENT_SELECT);
    },
    // A folder into one layer, in its place and with its name, opacity and blend mode, as
    // Photoshop's Merge Group. What's hidden inside it is dropped.
    mergeGroup(id) {
      const doc = app.doc;
      const all = doc ? doc.state.layers : [];
      const folder = all.find((layer) => layer.id === id && layer.kind === "group");
      if (!folder) return;
      const family = familyOf(all, id);
      if (all.some((layer) => family.has(layer.id) && layer.locked)) {
        emit("layer-locked");
        return;
      }
      // Its own opacity stays on the new layer, not in its pixels
      const whole = Object.assign({}, folder, { visible: true, opacity: 1 });
      const inside = all.filter((layer) => family.has(layer.id)).map((layer) => (layer === folder ? whole : layer));
      const merged = newRaster(folder.name, { group: folder.group || null, visible: folder.visible !== false, opacity: folder.opacity === undefined ? 1 : folder.opacity, blend: folder.blend === "pass through" ? "normal" : folder.blend || "normal" });
      merged.bitmap = paintAlone(doc, inside);
      const layers = all.flatMap((layer) => (layer === folder ? [merged] : family.has(layer.id) ? [] : [layer]));
      commitState(doc, "Merge Layers", { layers, activeIds: [merged.id] });
      firePanelEvent(EVENT_SELECT);
    },
    // All that shows into one layer, at the place of the lowest. What's hidden stays as it is.
    mergeVisible() {
      const doc = app.doc;
      if (!doc) return;
      const byId = new Map(doc.state.layers.map((layer) => [layer.id, layer]));
      const list = doc.state.layers.filter((layer) => layer.kind !== "group" && layer.visible !== false && chainOf(layer, byId).visible);
      if (list.length < 2) return;
      if (list.some((layer) => layer.locked)) {
        emit("layer-locked");
        return;
      }
      const gone = new Set(list.map((layer) => layer.id));
      const merged = newRaster(list[list.length - 1].name, { group: null, isBackground: list[0].isBackground, blend: "normal", opacity: 1 });
      const canvas = newCanvas(doc.width, doc.height);
      paintDoc(doc, canvas.getContext("2d"), { keep: true, skip: (layer) => !gone.has(layer.id) });
      merged.bitmap = canvas;
      let layers = doc.state.layers.flatMap((layer) => (layer === list[0] ? [merged] : gone.has(layer.id) ? [] : [layer]));
      // A group that held only what was merged is empty now
      for (let before = -1; before !== layers.length; ) {
        before = layers.length;
        layers = layers.filter((layer) => layer.kind !== "group" || layer.visible === false || layers.some((item) => item.group === layer.id));
      }
      commitState(doc, "Merge Visible", { layers, activeIds: [merged.id] });
      firePanelEvent(EVENT_SELECT);
    },
    flatten() {
      const doc = app.doc;
      if (!doc) return;
      const background = newRaster((app.names && app.names.background) || "Background", { isBackground: true });
      const canvas = newCanvas(doc.width, doc.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, doc.width, doc.height);
      paintDoc(doc, ctx, { keep: true });
      background.bitmap = canvas;
      commitState(doc, "Flatten Image", { layers: [background], activeIds: [background.id] });
    },
    rasterizeText(id) {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id && item.kind === "text");
      if (!layer) return;
      const raster = newRaster(layer.name, { group: layer.group, opacity: layer.opacity, blend: layer.blend, visible: layer.visible, clipping: layer.clipping, mask: layer.mask || null, vectorMask: layer.vectorMask || null, bitmap: flattenLayers(doc, [Object.assign({}, layer, { opacity: 1, blend: "normal", mask: null, vectorMask: null })]) });
      commitState(doc, "Rasterize Layer", { layers: doc.state.layers.map((item) => (item.id === id ? raster : item)), activeIds: [raster.id] });
    },
    /* ---- masks ---- */
    // What the brushes work on: the active layer's pixel or vector mask when its thumbnail is
    // targeted in the Layers panel, as in Photoshop. Not part of the history.
    maskTarget(doc = app.doc) {
      const t = doc && doc.maskTarget;
      if (!t || doc.state.activeIds.length !== 1 || doc.state.activeIds[0] !== t.id) return null;
      const layer = doc.state.layers.find((item) => item.id === t.id);
      if (!layer || !(t.part === "vector" ? layer.vectorMask : layer.mask)) return null;
      return { id: t.id, part: t.part, layer };
    },
    setMaskTarget(id, part) {
      const doc = app.doc;
      if (!doc) return;
      const before = ops.maskTarget(doc);
      doc.maskTarget = part ? { id, part } : null;
      const after = ops.maskTarget(doc);
      if (doc.maskView && (!after || after.id !== doc.maskView.id || after.part !== doc.maskView.part)) doc.maskView = null;
      if (Boolean(before) !== Boolean(after) || (before && after && (before.id !== after.id || before.part !== after.part))) {
        emit("mask-target", after);
        emit("render");
      }
    },
    // Alt + click on a mask's thumbnail shows it alone, in grey; \ shows it in red over the page
    setMaskView(mode) {
      const doc = app.doc;
      const target = ops.maskTarget(doc);
      doc.maskView = mode && target ? { id: target.id, part: target.part, mode } : null;
      emit("mask-view", doc.maskView);
      emit("render");
    },
    canHaveMask(layer) {
      return Boolean(layer) && !layer.adjustment && (layer.kind === "raster" || layer.kind === "text" || layer.kind === "group");
    },
    // Layer > Layer Mask > Reveal All, Hide All, Reveal Selection, Hide Selection, From Transparency.
    // A Background becomes Layer 0 first: it can't have a mask.
    addMask(kind, ids) {
      const doc = app.doc;
      if (!doc) return false;
      const selection = doc.state.selection;
      if (!selection && (kind === "revealSelection" || kind === "hideSelection")) kind = kind === "revealSelection" ? "revealAll" : "hideAll";
      const wanted = new Set(ids || doc.state.activeIds);
      const chosen = doc.state.layers.filter((layer) => wanted.has(layer.id) && ops.canHaveMask(layer) && !layer.mask);
      if (!chosen.length) return false;
      if (chosen.some((layer) => layer.locked)) {
        emit("layer-locked");
        return false;
      }
      const made = new Map();
      chosen.forEach((layer) => {
        const [sx, sy] = maskShift(layer);
        let mask;
        if (kind === "revealSelection" || kind === "hideSelection") {
          const b = selection.bounds;
          const left = Math.floor(b.left);
          const top = Math.floor(b.top);
          const alpha = newCanvas(Math.ceil(b.right) - left, Math.ceil(b.bottom) - top);
          const clip = clipOf(selection, 0, 0);
          const a = alpha.getContext("2d");
          if (clip.canvas) a.drawImage(clip.canvas, clip.x - left, clip.y - top);
          else a.fillRect(clip.x - left, clip.y - top, clip.width, clip.height);
          const gray = maskAsGray(alpha);
          if (kind === "hideSelection") {
            const g = gray.getContext("2d");
            g.globalCompositeOperation = "difference";
            g.fillStyle = "#fff";
            g.fillRect(0, 0, gray.width, gray.height);
          }
          mask = { canvas: gray, left: left - sx, top: top - sy, defaultColor: kind === "hideSelection" ? 255 : 0 };
        } else if (kind === "transparency") {
          const visual = visualOf(Object.assign({}, layer, { mask: null, vectorMask: null }), doc);
          if (!visual) mask = { canvas: null, left: -sx, top: -sy, defaultColor: 0 };
          else mask = { canvas: maskAsGray(visual.canvas), left: visual.x - sx, top: visual.y - sy, defaultColor: 0 };
        } else mask = { canvas: null, left: -sx, top: -sy, defaultColor: kind === "hideAll" ? 0 : 255 };
        mask.right = mask.left + (mask.canvas ? mask.canvas.width : 0);
        mask.bottom = mask.top + (mask.canvas ? mask.canvas.height : 0);
        mask.paint = NONE;
        const next = Object.assign({}, layer, { mask });
        if (layer.isBackground) Object.assign(next, { isBackground: false, name: `${(app.names && app.names.layer) || "Layer"} 0` });
        made.set(layer.id, next);
      });
      const change = { layers: doc.state.layers.map((layer) => made.get(layer.id) || layer) };
      if (kind === "revealSelection" || kind === "hideSelection") change.selection = null;
      commitState(doc, "Add Layer Mask", change);
      if (change.selection === null) emit("selection", null);
      const last = chosen[chosen.length - 1];
      if (doc.state.activeIds.length === 1) ops.setMaskTarget(last.id, "mask");
      firePanelEvent(EVENT_HISTORY);
      return true;
    },
    // Layer > Vector Mask > Reveal All, Hide All, Current Selection (its outline, as paths)
    addVectorMask(kind, ids) {
      const doc = app.doc;
      if (!doc) return false;
      const selection = doc.state.selection;
      if (kind === "selection" && !selection) return false;
      const wanted = new Set(ids || doc.state.activeIds);
      const chosen = doc.state.layers.filter((layer) => wanted.has(layer.id) && ops.canHaveMask(layer) && !layer.vectorMask);
      if (!chosen.length) return false;
      if (chosen.some((layer) => layer.locked)) {
        emit("layer-locked");
        return false;
      }
      const corner = (x, y) => ({ linked: false, points: [x, y, x, y, x, y] });
      let paths = [];
      if (kind === "selection" && selection.ellipse) {
        // An ellipse is four curves, as Photoshop draws it
        const { left, top, right, bottom } = selection.ellipse;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        const rx = (right - left) / 2;
        const ry = (bottom - top) / 2;
        const k = 0.5522847498;
        const smooth = (x, y, hx, hy) => ({ linked: true, points: [x - hx, y - hy, x, y, x + hx, y + hy] });
        paths = [{ open: false, operation: "combine", fillRule: "even-odd", knots: [smooth(cx, top, -rx * k, 0), smooth(right, cy, 0, -ry * k), smooth(cx, bottom, rx * k, 0), smooth(left, cy, 0, ry * k)] }];
      } else if (kind === "selection") {
        paths = selection.rings.map((ring, index) => ({ open: false, operation: index ? undefined : "combine", fillRule: "even-odd", knots: ring.map(([x, y]) => corner(x, y)) }));
      }
      const made = new Map();
      chosen.forEach((layer) => {
        const [sx, sy] = maskShift(layer);
        const vectorMask = shiftedVector({ paths, fillStartsWithAllPixels: kind === "revealAll" }, -sx, -sy);
        const next = Object.assign({}, layer, { vectorMask });
        if (layer.isBackground) Object.assign(next, { isBackground: false, name: `${(app.names && app.names.layer) || "Layer"} 0` });
        made.set(layer.id, next);
      });
      const change = { layers: doc.state.layers.map((layer) => made.get(layer.id) || layer) };
      if (kind === "selection") change.selection = null;
      commitState(doc, "Add Vector Mask", change);
      if (kind === "selection") emit("selection", null);
      if (doc.state.activeIds.length === 1) ops.setMaskTarget(chosen[chosen.length - 1].id, "vector");
      firePanelEvent(EVENT_HISTORY);
      return true;
    },
    // Layer > Layer Mask > Delete (or Vector Mask > Delete). `apply`: its pixels go into the layer first.
    deleteMask(id, part = "mask", apply) {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id);
      if (!layer || !(part === "vector" ? layer.vectorMask : layer.mask)) return false;
      if (layer.locked) {
        emit("layer-locked");
        return false;
      }
      if (apply && part === "mask") return ops.applyMask(id);
      commitState(doc, part === "vector" ? "Delete Vector Mask" : "Delete Layer Mask", { layers: replaceLayer(doc, layer, part === "vector" ? { vectorMask: null } : { mask: null }) });
      if (doc.maskView && doc.maskView.id === id) doc.maskView = null;
      emit("mask-target", ops.maskTarget(doc));
      firePanelEvent(EVENT_HISTORY);
      return true;
    },
    canApplyMask(layer) {
      return Boolean(layer && layer.mask && layer.kind === "raster" && !layer.adjustment);
    },
    // Layer > Layer Mask > Apply: what it hides is gone from the pixels, and so is the mask
    applyMask(id) {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id);
      if (!ops.canApplyMask(layer)) return false;
      if (layer.locked) {
        emit("layer-locked");
        return false;
      }
      const visual = visualOf(Object.assign({}, layer, { vectorMask: null }), doc);
      let next;
      if (!visual) next = Object.assign({}, layer, { mask: null });
      else {
        const canvas = newCanvas(visual.canvas.width, visual.canvas.height);
        canvas.getContext("2d").drawImage(visual.canvas, 0, 0);
        next = withPixels(layer, canvas, visual.x, visual.y, null);
      }
      if (next.raw) next.raw = Object.assign({}, next.raw);
      commitState(doc, "Apply Layer Mask", { layers: replaceLayer(doc, layer, next) });
      if (doc.maskView && doc.maskView.id === id) doc.maskView = null;
      emit("mask-target", ops.maskTarget(doc));
      firePanelEvent(EVENT_HISTORY);
      return true;
    },
    // Enabled, linked, Density, Feather. `part`: "vector" for the vector mask.
    setMaskProps(id, changes, name, coalesce, part = "mask") {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id);
      const mask = layer && (part === "vector" ? layer.vectorMask : layer.mask);
      if (!mask) return false;
      commitState(doc, name || "Mask Properties", { layers: replaceLayer(doc, layer, { [part === "vector" ? "vectorMask" : "mask"]: Object.assign({}, mask, changes) }) }, coalesce);
      return true;
    },
    // Image > Adjustments > Invert, on a mask: what it hid shows, and the other way round
    invertMask(id, target = "mask") {
      const doc = app.doc;
      const layer = doc && maskHolder(doc, target, id);
      if (!layer) return false;
      if (layer.locked) {
        emit("layer-locked");
        return false;
      }
      const settled = settledMask(layer, doc);
      let canvas = null;
      if (settled.canvas) {
        canvas = newCanvas(settled.canvas.width, settled.canvas.height);
        const c = canvas.getContext("2d");
        c.drawImage(settled.canvas, 0, 0);
        c.globalCompositeOperation = "difference";
        c.fillStyle = "#fff";
        c.fillRect(0, 0, canvas.width, canvas.height);
      }
      const mask = Object.assign({}, settled, { canvas, defaultColor: settled.defaultColor ? 0 : 255 });
      if (target === "quick") commitState(doc, "Invert", { quickMask: mask });
      else commitState(doc, "Invert", { layers: replaceLayer(doc, layer, { mask }) });
      return true;
    },
    // A mask's alpha over the page, a byte per pixel: 1 where it shows the layer more than half
    maskPixels(layer, part) {
      const doc = app.doc;
      const picture = part === "vector" ? vectorPicture(Object.assign({}, layer, { vectorMask: Object.assign({}, layer.vectorMask, { disable: false }) })) : maskPicture(layer, doc, true);
      // Outside the mask's own picture the page is all its outside colour: only the picture is read
      const full = new Uint8Array(doc.width * doc.height);
      if (Math.round(picture.outside * 255) > 127) full.fill(1);
      if (!picture.canvas) return full;
      const left = Math.max(0, Math.floor(picture.x));
      const top = Math.max(0, Math.floor(picture.y));
      const bw = Math.min(doc.width, Math.ceil(picture.x + picture.canvas.width)) - left;
      const bh = Math.min(doc.height, Math.ceil(picture.y + picture.canvas.height)) - top;
      if (bw <= 0 || bh <= 0) return full;
      const alpha = maskOverPage(picture, left, top, bw, bh);
      const data = alpha.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, bw, bh).data;
      for (let y = 0; y < bh; y++) {
        const row = (top + y) * doc.width + left;
        const at = y * bw * 4 + 3;
        for (let x = 0; x < bw; x++) full[row + x] = data[at + x * 4] > 127 ? 1 : 0;
      }
      return full;
    },
    // Cmd + click on a mask's thumbnail: it becomes the selection (Shift adds, Alt takes away)
    maskToSelection(id, mode, part = "mask") {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id);
      if (!layer || !(part === "vector" ? layer.vectorMask : layer.mask)) return null;
      const selection = fromFullMask(doc, ops.maskPixels(layer, part), "layer");
      if (!selection) {
        if (!mode || mode === "intersect") ops.deselect();
        return null;
      }
      return mode ? ops.userSelection(selection, "Load Selection", mode) : ops.quietSelection(selection, "Load Selection");
    },
    // The Move tool on an unlinked mask: it moves alone
    moveMask(id, dx, dy, coalesce, part = "mask") {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id);
      const mask = layer && (part === "vector" ? layer.vectorMask : layer.mask);
      if (!mask || (!dx && !dy)) return false;
      if (layer.locked) {
        emit("layer-locked");
        return false;
      }
      const moved = part === "vector" ? { vectorMask: shiftedVector(mask, dx, dy) } : { mask: Object.assign({}, mask, { left: (mask.left || 0) + dx, top: (mask.top || 0) + dy, right: (mask.right || 0) + dx, bottom: (mask.bottom || 0) + dy }) };
      commitState(doc, "Move", { layers: replaceLayer(doc, layer, moved) }, coalesce);
      return true;
    },
    // A mask's thumbnail dragged onto another layer: it goes there, or a copy with Alt
    transferMask(fromId, toId, copy, part = "mask") {
      const doc = app.doc;
      if (!doc || fromId === toId) return false;
      const from = doc.state.layers.find((item) => item.id === fromId);
      const to = doc.state.layers.find((item) => item.id === toId);
      const key = part === "vector" ? "vectorMask" : "mask";
      if (!from || !from[key] || !ops.canHaveMask(to)) return false;
      if (from.locked || to.locked) {
        emit("layer-locked");
        return false;
      }
      const [fx, fy] = maskShift(from);
      const [tx, ty] = maskShift(to);
      const moved = part === "vector" ? shiftedVector(from.vectorMask, fx - tx, fy - ty) : Object.assign({}, from.mask, { left: (from.mask.left || 0) + fx - tx, top: (from.mask.top || 0) + fy - ty, right: (from.mask.right || 0) + fx - tx, bottom: (from.mask.bottom || 0) + fy - ty });
      const layers = doc.state.layers.map((layer) => {
        if (layer.id === toId) return Object.assign({}, layer, { [key]: moved }, layer.isBackground ? { isBackground: false, name: `${(app.names && app.names.layer) || "Layer"} 0` } : null);
        if (layer.id === fromId && !copy) return Object.assign({}, layer, { [key]: null });
        return layer;
      });
      commitState(doc, copy ? "Duplicate Layer Mask" : "Move Layer Mask", { layers, activeIds: [toId] });
      ops.setMaskTarget(toId, part);
      firePanelEvent(EVENT_SELECT);
      return true;
    },
    // Layer > Rasterize > Vector Mask: its shape goes into the pixel mask, made if need be
    rasterizeVectorMask(id) {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id);
      if (!layer || !layer.vectorMask) return false;
      if (layer.locked) {
        emit("layer-locked");
        return false;
      }
      const [sx, sy] = maskShift(layer);
      const vector = vectorPicture(Object.assign({}, layer, { vectorMask: Object.assign({}, layer.vectorMask, { disable: false }) }));
      let mask;
      if (!layer.mask) {
        const file = maskForFile(vector, vector.outside >= 0.5);
        mask = { canvas: file ? file.canvas : null, left: (file ? file.left : 0) - sx, top: (file ? file.top : 0) - sy, defaultColor: vector.outside >= 0.5 ? 255 : 0, paint: NONE };
      } else {
        // Both: what each one hides stays hidden
        const own = maskPicture(layer, doc, true);
        const left = Math.min(own.canvas ? own.x : Infinity, vector.canvas ? vector.x : Infinity, 0);
        const top = Math.min(own.canvas ? own.y : Infinity, vector.canvas ? vector.y : Infinity, 0);
        const right = Math.max(own.canvas ? own.x + own.canvas.width : -Infinity, vector.canvas ? vector.x + vector.canvas.width : -Infinity, doc.width);
        const bottom = Math.max(own.canvas ? own.y + own.canvas.height : -Infinity, vector.canvas ? vector.y + vector.canvas.height : -Infinity, doc.height);
        const alpha = maskOverPage(own, left, top, right - left, bottom - top);
        cutWith(alpha.getContext("2d"), alpha.width, alpha.height, left, top, vector);
        const outside = own.outside * vector.outside >= 0.5;
        const file = maskForFile({ canvas: alpha, x: left, y: top }, outside);
        mask = Object.assign({}, layer.mask, { canvas: file ? file.canvas : null, left: (file ? file.left : 0) - sx, top: (file ? file.top : 0) - sy, defaultColor: outside ? 255 : 0, paint: NONE });
      }
      mask.right = mask.left + (mask.canvas ? mask.canvas.width : 0);
      mask.bottom = mask.top + (mask.canvas ? mask.canvas.height : 0);
      commitState(doc, "Rasterize Vector Mask", { layers: replaceLayer(doc, layer, { mask, vectorMask: null }) });
      ops.setMaskTarget(id, "mask");
      return true;
    },
    // A layer's masks as Photoshop's file keeps them: the pixel mask in `mask`, or in
    // `realMask` with the vector mask's shape in `mask` when it has both
    masksForFile(layer, doc) {
      const [sx, sy] = maskShift(layer);
      let pixel = null;
      if (layer.mask) {
        const m = layer.mask;
        let canvas = m.canvas || null;
        let left = (m.left || 0) + sx;
        let top = (m.top || 0) + sy;
        if (m.paint && m.paint.length) {
          const file = maskForFile(maskPicture(layer, doc, true), m.defaultColor);
          canvas = file ? file.canvas : null;
          left = file ? file.left : 0;
          top = file ? file.top : 0;
        }
        if (!canvas) {
          left = 0;
          top = 0;
        }
        pixel = { left, top, right: left + (canvas ? canvas.width : 0), bottom: top + (canvas ? canvas.height : 0), defaultColor: m.defaultColor ? 255 : 0, disabled: Boolean(m.disabled) };
        if (canvas) pixel.canvas = canvas;
        if (m.userMaskDensity !== undefined && m.userMaskDensity < 1) pixel.userMaskDensity = m.userMaskDensity;
        if (m.userMaskFeather > 0) pixel.userMaskFeather = m.userMaskFeather;
      }
      if (!layer.vectorMask) return pixel ? { mask: pixel } : {};
      const vm = layer.vectorMask;
      const vectorMask = shiftedVector(vm, sx, sy);
      delete vectorMask.density;
      delete vectorMask.feather;
      const shape = vectorPicture(Object.assign({}, layer, { vectorMask: Object.assign({}, vm, { disable: false, density: undefined, feather: undefined }) }));
      const file = maskForFile(shape, shape.outside >= 0.5);
      const drawn = { left: file ? file.left : 0, top: file ? file.top : 0, defaultColor: shape.outside >= 0.5 ? 255 : 0, disabled: Boolean(vm.disable), fromVectorData: true };
      drawn.right = drawn.left + (file ? file.canvas.width : 0);
      drawn.bottom = drawn.top + (file ? file.canvas.height : 0);
      if (file) drawn.canvas = file.canvas;
      if (vm.density !== undefined && vm.density < 1) drawn.vectorMaskDensity = vm.density;
      if (vm.feather > 0) drawn.vectorMaskFeather = vm.feather;
      if (!pixel) return { mask: drawn, vectorMask };
      if (pixel.userMaskDensity !== undefined) drawn.userMaskDensity = pixel.userMaskDensity;
      if (pixel.userMaskFeather !== undefined) drawn.userMaskFeather = pixel.userMaskFeather;
      return { mask: drawn, realMask: pixel, vectorMask };
    },
    // The thumbnail of a mask, in grey, as the Layers panel shows it
    maskThumb(layer, part, width, height) {
      const doc = app.doc;
      const canvas = newCanvas(width, height);
      if (!doc) return canvas;
      const scale = Math.min(width / doc.width, height / doc.height);
      const picture = part === "vector" ? vectorPicture(Object.assign({}, layer, { vectorMask: Object.assign({}, layer.vectorMask, { disable: false, density: undefined, feather: undefined }) })) : maskPicture(layer, doc, true);
      const alpha = newCanvas(width, height);
      const a = alpha.getContext("2d");
      if (picture.outside > 0) {
        a.globalAlpha = picture.outside;
        a.fillRect(0, 0, width, height);
        a.globalAlpha = 1;
      }
      if (picture.canvas) {
        a.save();
        a.scale(scale, scale);
        a.clearRect(picture.x, picture.y, picture.canvas.width, picture.canvas.height);
        a.imageSmoothingQuality = "high";
        a.drawImage(picture.canvas, picture.x, picture.y);
        a.restore();
      }
      canvas.getContext("2d").drawImage(maskAsGray(alpha), 0, 0);
      return canvas;
    },
    /* ---- clipping masks ---- */
    // Whether a layer is clipped to the one under it, and whether one is a base
    clipping(doc = app.doc) {
      return doc ? clippingOf(doc.state.layers) : { clipped: new Set(), bases: new Set(), baseOf: new Map() };
    },
    // What Layer > Create Clipping Mask (Alt + Cmd + G) would do with the active layers:
    // "release" when one of them is clipped or a base, "create" when they can be, else null
    clippingPlan(doc = app.doc) {
      if (!doc || !doc.state.activeIds.length) return null;
      const layers = doc.state.layers;
      const info = clippingOf(layers);
      const active = layers.filter((layer) => doc.state.activeIds.includes(layer.id));
      if (active.some((layer) => info.clipped.has(layer.id) || layers.some((item) => info.baseOf.get(item.id) === layer))) return "release";
      const lowest = active[0];
      const at = layers.indexOf(lowest);
      if (active.length === 1) {
        const below = layers[at - 1];
        return lowest.kind !== "group" && below && (below.group || null) === (lowest.group || null) ? "create" : null;
      }
      return active.slice(1).some((layer) => layer.kind !== "group" && (layer.group || null) === (lowest.group || null)) ? "create" : null;
    },
    // Create Clipping Mask, or Release it: Photoshop's one command
    toggleClipping() {
      const doc = app.doc;
      const plan = ops.clippingPlan(doc);
      if (!plan) return false;
      const layers = doc.state.layers;
      const info = clippingOf(layers);
      const active = layers.filter((layer) => doc.state.activeIds.includes(layer.id));
      const change = new Set();
      if (plan === "release") {
        // A clipped layer goes with those clipped above it; a base lets all of its own go
        active.forEach((layer) => {
          const at = layers.indexOf(layer);
          const base = info.clipped.has(layer.id) ? info.baseOf.get(layer.id) : layer;
          for (let j = info.clipped.has(layer.id) ? at : at + 1; j < layers.length && info.clipped.has(layers[j].id) && info.baseOf.get(layers[j].id) === base; j++) change.add(layers[j].id);
        });
        commitState(doc, "Release Clipping Mask", { layers: layers.map((layer) => (change.has(layer.id) ? Object.assign({}, layer, { clipping: false }) : layer)) });
      } else {
        const lowest = active[0];
        const from = layers.indexOf(lowest);
        const to = layers.indexOf(active[active.length - 1]);
        if (active.length === 1) change.add(lowest.id);
        // The lowest is the base; those between it and the highest go with it
        else for (let j = from + 1; j <= to; j++) if (layers[j].kind !== "group" && (layers[j].group || null) === (lowest.group || null)) change.add(layers[j].id);
        commitState(doc, "Create Clipping Mask", { layers: layers.map((layer) => (change.has(layer.id) ? Object.assign({}, layer, { clipping: true }) : layer)) });
      }
      firePanelEvent(EVENT_HISTORY);
      return true;
    },
    // Alt + click between two layers in the Layers panel: the upper one is clipped to the lower
    // one, or let go with those above it
    clipToBelow(id) {
      const doc = app.doc;
      if (!doc) return false;
      const layers = doc.state.layers;
      const info = clippingOf(layers);
      const at = layers.findIndex((layer) => layer.id === id);
      const layer = layers[at];
      if (!layer || layer.kind === "group") return false;
      if (info.clipped.has(id)) {
        const base = info.baseOf.get(id);
        const change = new Set();
        for (let j = at; j < layers.length && info.clipped.has(layers[j].id) && info.baseOf.get(layers[j].id) === base; j++) change.add(layers[j].id);
        commitState(doc, "Release Clipping Mask", { layers: layers.map((item) => (change.has(item.id) ? Object.assign({}, item, { clipping: false }) : item)) });
      } else {
        const below = layers[at - 1];
        if (!below || (below.group || null) !== (layer.group || null)) return false;
        commitState(doc, "Create Clipping Mask", { layers: replaceLayer(doc, layer, { clipping: true }) });
      }
      firePanelEvent(EVENT_HISTORY);
      return true;
    },
    /* ---- Quick Mask (Q) ---- */
    // The selection becomes a mask the brushes paint on, red where nothing is selected; going
    // back, what is more white than black becomes the selection
    toggleQuickMask() {
      const doc = app.doc;
      if (!doc) return false;
      if (doc.state.quickMask) {
        const holder = maskHolder(doc, "quick");
        const full = ops.maskPixels(holder, "mask");
        let all = true;
        for (let i = 0; i < full.length && all; i++) all = full[i] === 1;
        const selection = all ? null : fromFullMask(doc, full, "mixed");
        commitState(doc, "Exit Quick Mask", { quickMask: null, selection: selection || null });
        maskCache.delete(holder.id);
        emit("selection", selection || null);
        emit("quick-mask", false);
        return true;
      }
      const selection = doc.state.selection;
      let quickMask;
      if (selection) {
        const b = selection.bounds;
        const left = Math.floor(b.left);
        const top = Math.floor(b.top);
        const alpha = newCanvas(Math.ceil(b.right) - left, Math.ceil(b.bottom) - top);
        const clip = clipOf(selection, 0, 0);
        const a = alpha.getContext("2d");
        if (clip.canvas) a.drawImage(clip.canvas, clip.x - left, clip.y - top);
        else a.fillRect(clip.x - left, clip.y - top, clip.width, clip.height);
        quickMask = { canvas: maskAsGray(alpha), left, top, defaultColor: 0, paint: NONE };
      } else quickMask = { canvas: null, left: 0, top: 0, defaultColor: 255, paint: NONE };
      commitState(doc, "Quick Mask", { quickMask, selection: null });
      emit("selection", null);
      emit("quick-mask", true);
      return true;
    },
    // Alt + Backspace and the others on a mask or the Quick Mask: a grey within the selection,
    // or all over it when nothing is selected, as in Photoshop
    fillMask(target, layerId, gray) {
      const doc = app.doc;
      if (!doc) return false;
      const holder = maskHolder(doc, target, layerId);
      if (!holder) return false;
      if (holder.locked) {
        emit("layer-locked");
        return true;
      }
      const [ox, oy] = maskOrigin(holder);
      const op = { t: "fill", gray, clip: doc.state.selection ? clipOf(doc.state.selection, ox, oy) : null };
      // Black or white all over: the mask is that colour, round the page too
      const plain = !op.clip && (gray === 0 || gray === 255);
      const mask = plain ? Object.assign({}, holder.mask, { canvas: null, defaultColor: gray, paint: NONE, right: holder.mask.left || 0, bottom: holder.mask.top || 0 }) : Object.assign({}, holder.mask, { paint: (holder.mask.paint || NONE).concat([op]) });
      if (target === "quick") commitState(doc, "Fill", { quickMask: mask });
      else commitState(doc, "Fill", { layers: replaceLayer(doc, holder, { mask }) });
      return true;
    },
    /* ---- painting ---- */
    // `fields.target`: "mask" paints the layer's mask, "quick" the Quick Mask, in `fields.gray`
    beginStroke(layerId, fields) {
      const doc = app.doc;
      // A worker may be finishing the last full-stroke blend just after pointerup. Do not replace
      // that live operation; the next stroke can start as soon as its History entry is committed.
      if (doc && doc.liveStroke && doc.liveStroke.op && doc.liveStroke.op.healing) return false;
      if (doc && fields.target) {
        const holder = maskHolder(doc, fields.target, layerId);
        if (!holder) return false;
        if (holder.locked) {
          emit("layer-locked");
          return false;
        }
        const [ox, oy] = maskOrigin(holder);
        const op = { t: "stroke", points: [], size: fields.size, hardness: fields.hardness, gray: fields.gray };
        ["tip", "spacing", "angle", "roundness", "flipX", "flipY", "stamped", "presetId"].forEach((key) => {
          if (fields[key] !== undefined) op[key] = fields[key];
        });
        if (fields.erase) op.erase = true;
        if (doc.state.selection) op.clip = clipOf(doc.state.selection, ox, oy);
        doc.liveStroke = { layerId, holderId: holder.id, target: fields.target, op, dx: ox, dy: oy };
        maskEntry(holder, doc);
        return true;
      }
      const layer = doc && doc.state.layers.find((item) => item.id === layerId && item.kind === "raster");
      if (!layer) return false;
      if (lockOf(layer, "pixels")) {
        emit("layer-locked");
        return false;
      }
      const selection = doc.state.selection;
      const dx = layer.dx || 0;
      const dy = layer.dy || 0;
      const { clone, healing, smudge, ...rest } = fields;
      const op = Object.assign({ t: "stroke", points: [] }, rest);
      // Transparent pixels locked: paint only on what is there, and the Eraser paints the
      // background colour, as in Photoshop
      if (lockOf(layer, "transparency")) {
        op.atop = true;
        if (op.erase) {
          delete op.erase;
          op.color = Object.assign({}, app.bg);
        }
      }
      if (clone) {
        const shot = cloneSource(doc, layer, clone.sample);
        op.source = { canvas: shot.canvas, x: shot.x - clone.ox - dx, y: shot.y - clone.oy - dy };
      } else if (healing) {
        const shot = cloneSource(doc, layer, healing.sample);
        // Keep the original full-stroke algorithm's document coordinates, including for layers
        // with an offset. CPU-backed snapshots avoid synchronous GPU readback in the fallback;
        // the Worker receives their crops as ImageBitmaps and performs every pixel read itself.
        op.healing = true;
        op.healingSource = newCanvas(doc.width, doc.height);
        op.healingDestination = newCanvas(doc.width, doc.height);
        op.healingSource.getContext("2d", { willReadFrequently: true }).drawImage(shot.canvas, shot.x - healing.ox - dx, shot.y - healing.oy - dy);
        op.healingDestination.getContext("2d", { willReadFrequently: true }).drawImage(shot.canvas, shot.x - dx, shot.y - dy);
        op.healingSourceAt = { x: 0, y: 0 };
        op.healingDestinationAt = { x: 0, y: 0 };
      } else if (smudge) {
        op.smudge = { strength: Math.max(0.01, Math.min(1, smudge.strength === undefined ? 0.5 : smudge.strength)), finger: smudge.finger || null, sampleAll: Boolean(smudge.sampleAll) };
        // Current Layer reads the live raster directly. A full document snapshot here delayed
        // the first dab and was never sampled; only Sample All Layers needs this composite.
        if (smudge.sampleAll) {
          const shot = cloneSource(doc, layer, "all");
          op.source = { canvas: shot.canvas, x: shot.x - dx, y: shot.y - dy };
        }
      }
      if (selection) op.clip = clipOf(selection, dx, dy);
      doc.liveStroke = { layerId, op, dx, dy };
      rasterEntry(layer, doc);
      return true;
    },
    extendStroke(x, y) {
      const doc = app.doc;
      const live = doc && doc.liveStroke;
      if (!live) return;
      const point = [x - live.dx, y - live.dy];
      const previous = live.op.points[live.op.points.length - 1];
      live.op.points.push(point);
      const segment = previous ? [previous, point] : [point];
      if (live.target) {
        const holder = maskHolder(doc, live.target, live.layerId);
        if (!holder) return;
        const entry = maskEntry(holder, doc);
        maskDrawOp(entry.ctx, live.op, segment);
        entry.version++;
      } else {
        const layer = doc.state.layers.find((item) => item.id === live.layerId);
        const entry = rasterEntry(layer, doc);
        if (live.op.smudge) {
          smudgeSegment(entry.ctx, live.op, segment, live.smudgeState || (live.smudgeState = makeSmudgeState(entry.ctx, live.op)));
          entry.version++;
        } else if (live.op.healing) {
          prepareHealing(doc, entry, live);
          queueHealing(doc, entry, live);
        } else if (live.op.source) cloneSegment(entry, live, segment);
        else drawOp(entry.ctx, live.op, segment);
        if (!live.op.healing) entry.version++;
      }
      const from = previous || point;
      const reach = (live.op.size || 1) + 2;
      if (!live.op.healing || !live.worker) emit("render", pageRect(doc, Math.min(from[0], point[0]) + live.dx - reach, Math.min(from[1], point[1]) + live.dy - reach, Math.max(from[0], point[0]) + live.dx + reach, Math.max(from[1], point[1]) + live.dy + reach));
    },
    endStroke() {
      const doc = app.doc;
      const live = doc && doc.liveStroke;
      if (!live) return;
      if (live.op.healing && live.worker && !live.healingReady) {
        live.finish = true;
        return;
      }
      doc.liveStroke = null;
      // The worker is shared and prewarmed for subsequent strokes, never terminated on mouseup.
      live.worker = null;
      if (live.target) {
        const holder = maskHolder(doc, live.target, live.layerId);
        if (!holder || !live.op.points.length) {
          emit("render");
          return;
        }
        const paint = (holder.mask.paint || NONE).concat([live.op]);
        const entry = maskCache.get(holder.id);
        if (entry) entry.paint = paint;
        const mask = Object.assign({}, holder.mask, { paint });
        const name = live.target === "quick" ? "Quick Mask" : live.op.erase ? "Eraser" : "Brush";
        if (live.target === "quick") commitState(doc, name, { quickMask: mask });
        else commitState(doc, name, { layers: replaceLayer(doc, holder, { mask }) });
        return;
      }
      const layer = doc.state.layers.find((item) => item.id === live.layerId);
      if (!live.op.points.length) return;
      if (live.op.healing) {
        const entry = rasterCache.get(layer.id);
        if (entry) {
          const box = strokeBox(live.op.points, live.op.size);
          const result = newCanvas(box.width, box.height);
          result.getContext("2d").drawImage(entry.canvas, box.left - entry.cx0, box.top - entry.cy0, box.width, box.height, 0, 0, box.width, box.height);
          live.op.healingResult = result;
          live.op.healingBox = box;
        }
        delete live.op.healingSource;
        delete live.op.healingDestination;
        delete live.op.healingSourceAt;
        delete live.op.healingDestinationAt;
      } else if (live.op.source) cropCloneSource(live.op);
      const paint = (layer.paint || NONE).concat([live.op]);
      const entry = rasterCache.get(layer.id);
      if (entry) {
        entry.paint = paint;
        if (paint.length % MARK_EVERY === 0) markRaster(entry, paint);
      }
      commitState(doc, live.op.smudge ? "Smudge" : live.op.healing ? "Healing Brush" : live.op.source ? "Clone Stamp" : live.op.erase ? "Eraser" : "Brush", { layers: replaceLayer(doc, layer, { paint }) });
    },
    // Alt+Backspace, Cmd+Backspace, Delete: fills or clears the selection on a pixel layer
    fillSelection(color) {
      const doc = app.doc;
      if (!doc || !doc.state.selection) return false;
      let layer = activeRaster(doc);
      if (!layer) {
        if (!color) return false;
        layer = ops.newLayer();
      }
      if (lockOf(layer, "pixels")) {
        emit("layer-locked");
        return true;
      }
      const selection = doc.state.selection;
      const op = { t: "fill", clip: clipOf(selection, layer.dx || 0, layer.dy || 0) };
      if (color) op.color = color;
      else op.erase = true;
      if (lockOf(layer, "transparency")) {
        op.atop = true;
        if (op.erase) {
          delete op.erase;
          op.color = Object.assign({}, app.bg);
        }
      }
      commitState(doc, color ? "Fill" : "Clear", { layers: replaceLayer(doc, layer, { paint: (layer.paint || NONE).concat([op]) }) });
      return true;
    },
    // The Bubble Cleaner: a click in a bubble, or a box dragged around some text
    cleanBubble(where) {
      const doc = app.doc;
      if (!doc) return { error: "doc" };
      const plan = planBubbleClean(doc, Object.assign({ tolerance: app.cleanTolerance, margin: app.cleanMargin }, where));
      if (plan.error) return plan;
      const canvas = newCanvas(plan.width, plan.height);
      canvas.getContext("2d").putImageData(new ImageData(plan.pixels, plan.width, plan.height), 0, 0);
      const layers = paintOnCleanLayer(doc.state.layers, (layer) => ({ t: "image", canvas, x: plan.left - (layer.dx || 0), y: plan.top - (layer.dy || 0) }));
      commitState(doc, "Bubble Cleaner", { layers });
      // Painted on a hidden layer, or in a hidden folder, the clean happens but can't be seen
      const clean = layers.find((layer) => layer.clean);
      const hidden = !chainOf(clean, new Map(layers.map((layer) => [layer.id, layer]))).visible;
      return { ok: true, painted: plan.painted, colour: plan.colour, hidden };
    },
    /* ---- the Bubble Reshaper (reshape-tool.js) ---- */
    // The page as the Reshaper reads it: every pixel layer on white, never the text, and
    // without the bubble layer being shaped again
    // `of`: another open page than the one shown (Remove Text on several pages)
    reshapePage(without, of) {
      const doc = of || app.doc;
      if (!doc) return null;
      const shown = without ? Object.assign({}, doc, { state: Object.assign({}, doc.state, { layers: doc.state.layers.filter((layer) => layer.id !== without) }) }) : doc;
      const data = sampleData(shown, true);
      // A page in the background keeps no copy of its pixels: a chapter's worth would fill the memory
      if (doc !== app.doc) {
        doc.sampleCache = null;
        doc.sampleKey = null;
      }
      return { data, width: doc.width, height: doc.height };
    },
    // The bubble layer under a point: the topmost one shown there that remembers its shape
    reshapedAt(x, y) {
      const doc = app.doc;
      if (!doc) return null;
      const byId = new Map(doc.state.layers.map((layer) => [layer.id, layer]));
      for (let i = doc.state.layers.length - 1; i >= 0; i--) {
        const layer = doc.state.layers[i];
        if (layer.kind !== "raster" || !layer.bubble || !layer.bitmap || layer.visible === false || !chainOf(layer, byId).visible) continue;
        const lx = Math.floor(x - layer.left - (layer.dx || 0));
        const ly = Math.floor(y - layer.top - (layer.dy || 0));
        if (lx < 0 || ly < 0 || lx >= layer.bitmap.width || ly >= layer.bitmap.height) continue;
        if (layer.bitmap.getContext("2d", { willReadFrequently: true }).getImageData(lx, ly, 1, 1).data[3] > 0) return layer;
      }
      return null;
    },
    // The bubble being shaped, on screen only; null takes it off
    reshapeShow(extra, area) {
      const doc = app.doc;
      if (!doc) return;
      doc.extra = extra;
      emit("render", area ? pageRect(doc, area.left, area.top, area.right, area.bottom) : undefined);
    },
    // The bubble becomes a layer: a new one under the texts, or the one it was shaped from
    reshapeCommit({ canvas, left, top, bubble, replaces, name }) {
      const doc = app.doc;
      if (!doc) return null;
      doc.extra = null;
      const old = replaces && doc.state.layers.find((layer) => layer.id === replaces);
      let layers;
      let id;
      if (old) {
        id = old.id;
        layers = replaceLayer(doc, old, { bitmap: canvas, left, top, dx: 0, dy: 0, paint: NONE, bubble });
      } else {
        const made = newRaster(name || "Bubble", { bitmap: canvas, left, top, bubble });
        id = made.id;
        layers = doc.state.layers.slice();
        // Where TypeR Clean goes: above the page, under the texts and their folders
        let at = layers.findIndex((layer) => layer.kind === "text");
        const rootOf = (layer) => {
          let root = layer;
          while (root && root.group) root = layers.find((item) => item.id === root.group);
          return root;
        };
        if (at >= 0 && layers[at].group) {
          const root = rootOf(layers[at]);
          while (at > 0 && rootOf(layers[at - 1]) === root) at--;
        }
        layers.splice(at < 0 ? layers.length : at, 0, made);
      }
      commitState(doc, "Bubble Reshaper", { layers, activeIds: [id] });
      firePanelEvent(EVENT_HISTORY);
      return id;
    },
    // Detect Text and Remove Text (textmask.js): a selection as one byte a pixel over the whole
    // page (1 inside), and back; a selection made from a mask without putting it on the page
    selectionFullMask(selection, of) {
      const doc = of || app.doc;
      return doc && selection ? fullMaskOf(doc, selection) : null;
    },
    fullMaskSelection(full, source, of) {
      const doc = of || app.doc;
      return doc ? fromFullMask(doc, full, source) : null;
    },
    maskSelection(mask, width, height, left, top, source) {
      return makeSelection({ source: source || "mask", mask, boxW: width, boxH: height, left, top });
    },
    // Remove Text: letters on a plain background painted over with that background, on TypeR
    // Clean, in one step. `pieces`: [{ left, top, width, height, data, colour: { r, g, b },
    // pixels }], `data` one byte a pixel over the piece, 1 where it's painted, in `colour` or,
    // for a shaded background, in the colours of `pixels` (RGBA over the piece).
    fillPlain(doc, pieces, name) {
      if (!doc || !app.docs.includes(doc) || !pieces.length) return null;
      let layers = doc.state.layers;
      pieces.forEach((piece) => {
        const canvas = newCanvas(piece.width, piece.height);
        const ctx = canvas.getContext("2d");
        const image = ctx.createImageData(piece.width, piece.height);
        const { r, g, b } = piece.colour;
        const shaded = piece.pixels;
        for (let i = 0; i < piece.data.length; i++) {
          if (!piece.data[i]) continue;
          image.data[i * 4] = shaded ? shaded[i * 4] : r;
          image.data[i * 4 + 1] = shaded ? shaded[i * 4 + 1] : g;
          image.data[i * 4 + 2] = shaded ? shaded[i * 4 + 2] : b;
          image.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
        layers = paintOnCleanLayer(layers, (layer) => ({ t: "image", canvas, x: piece.left - (layer.dx || 0), y: piece.top - (layer.dy || 0) }));
      });
      commitState(doc, name || "Remove Text", { layers });
      const clean = layers.find((layer) => layer.clean);
      return { hidden: !chainOf(clean, new Map(layers.map((layer) => [layer.id, layer]))).visible };
    },
    // A selection from a mask on the page (one byte a pixel), without TypeR pasting into it
    selectMask(mask, width, height, left, top, name) {
      const doc = app.doc;
      if (!doc) return null;
      return ops.quietSelection(makeSelection({ source: "mask", mask, boxW: width, boxH: height, left, top }), name || "Select");
    },
    // Edit > Content-Aware Fill: the selection is painted over with what surrounds it, read
    // from every pixel layer and never from the text, onto the active pixel layer or a new
    // one. Long: resolves once done, telling its progress meanwhile, 0 to 1.
    async contentAwareFill(options, progress) {
      const doc = app.doc;
      const selection = doc && doc.state.selection;
      if (!selection) return "none";
      let layer = options.output === "new" ? null : activeRaster(doc);
      if (layer && lockOf(layer, "pixels")) {
        emit("layer-locked");
        return "locked";
      }
      const b = selection.bounds;
      // The fill reads around the selection, as far again as the selection is wide, within reason
      const reach = options.area === "page" ? Math.max(doc.width, doc.height) : Math.max(64, Math.min(1024, Math.round(Math.max(b.width, b.height)) + 48));
      const left = Math.max(0, Math.floor(b.left - reach));
      const top = Math.max(0, Math.floor(b.top - reach));
      const right = Math.min(doc.width, Math.ceil(b.right + reach));
      const bottom = Math.min(doc.height, Math.ceil(b.bottom + reach));
      const width = right - left;
      const height = bottom - top;
      if (width <= 0 || height <= 0) return "none";
      const canvas = newCanvas(width, height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      paintDoc(doc, ctx, { x: -left, y: -top, skip: (item) => item.kind === "text" });
      const data = ctx.getImageData(0, 0, width, height).data;
      const clip = selectionCanvas(selection);
      const clipData = clip.getContext("2d").getImageData(0, 0, clip.width, clip.height).data;
      const mask = new Uint8Array(width * height);
      let any = false;
      for (let y = 0; y < clip.height; y++) {
        const py = b.top + y - top;
        if (py < 0 || py >= height) continue;
        for (let x = 0; x < clip.width; x++) {
          const px = b.left + x - left;
          if (px < 0 || px >= width || !clipData[(y * clip.width + x) * 4 + 3]) continue;
          mask[py * width + px] = 1;
          any = true;
        }
      }
      if (!any) return "none";
      const source = new Uint8Array(width * height).fill(1);
      const size = [doc.width, doc.height];
      const result = await inpaint({ data, width, height, mask, source }, { mirror: Boolean(options.mirror), adapt: options.adapt !== false }, progress);
      // Worked out while the page stayed free: it lands once what is under way there is over
      if (options.settle) await options.settle(doc);
      // Meanwhile the page may have closed, changed size, or the layer gone
      if (!app.docs.includes(doc) || doc.width !== size[0] || doc.height !== size[1]) return "gone";
      if (layer) {
        layer = doc.state.layers.find((item) => item.id === layer.id && item.kind === "raster") || null;
        if (!layer) return "gone";
      }
      const region = newCanvas(width, height);
      region.getContext("2d").putImageData(new ImageData(result, width, height), 0, 0);
      const pixels = newCanvas(b.width, b.height);
      pixels.getContext("2d").drawImage(region, b.left - left, b.top - top, b.width, b.height, 0, 0, b.width, b.height);
      const dx = layer ? layer.dx || 0 : 0;
      const dy = layer ? layer.dy || 0 : 0;
      const op = { t: "patch", source: { canvas: pixels, x: b.left - dx, y: b.top - dy }, clip: clipOf(selection, dx, dy) };
      if (layer) {
        commitState(doc, "Content-Aware Fill", { layers: replaceLayer(doc, layer, { paint: (layer.paint || NONE).concat([op]) }) });
        return "done";
      }
      // A new layer goes where New Layer puts one: above the active layer, in its folder
      const made = newRaster(options.name || `${(app.names && app.names.layer) || "Layer"} ${doc.state.layers.filter((item) => item.kind === "raster" && !item.clean).length + 1}`, { paint: [op] });
      const anchor = doc.state.activeIds[doc.state.activeIds.length - 1];
      const layers = doc.state.layers.slice();
      const at = layers.findIndex((item) => item.id === anchor);
      if (at >= 0) {
        made.group = layers[at].kind === "group" ? layers[at].id : layers[at].group;
        layers.splice(layers[at].kind === "group" ? at : at + 1, 0, made);
      } else layers.push(made);
      commitState(doc, "Content-Aware Fill", { layers, activeIds: [made.id] });
      return "done";
    },
    // The Spot Healing Brush: where a stroke went is painted over with what surrounds it, as
    // Content-Aware Fill does a selection, but read close by and without a question. Onto the
    // pixel layer `layerId`, or the TypeR Clean layer (made under the texts if there is none).
    // `sampleAll`: read the page as it shows, without its texts; else only the layer itself.
    // Within the selection, if there is one. Long on a long stroke: progress goes 0 to 1.
    async spotHeal({ doc, layerId, points, size, sampleAll }, progress) {
      if (!doc || !app.docs.includes(doc) || !points.length) return "none";
      const layerNow = () => (layerId ? doc.state.layers.find((item) => item.id === layerId && item.kind === "raster") : doc.state.layers.find((item) => item.clean) || null);
      let layer = layerNow();
      if (layerId && !layer) return "gone";
      if (layer && lockOf(layer, "pixels")) {
        emit("layer-locked");
        return "locked";
      }
      const r = size / 2 + 1;
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      const sl = Math.floor(Math.min(...xs) - r);
      const st = Math.floor(Math.min(...ys) - r);
      const sr = Math.ceil(Math.max(...xs) + r);
      const sb = Math.ceil(Math.max(...ys) + r);
      // Close by: a spot is healed from its neighbourhood, not from across the page
      const reach = Math.max(40, Math.min(400, Math.round(Math.max(sr - sl, sb - st) * 0.6) + 24));
      const left = Math.max(0, sl - reach);
      const top = Math.max(0, st - reach);
      const right = Math.min(doc.width, sr + reach);
      const bottom = Math.min(doc.height, sb + reach);
      const width = right - left;
      const height = bottom - top;
      if (width <= 0 || height <= 0) return "none";
      // Where the stroke went, its edge a little soft, so that the healed part melts in
      const hard = newCanvas(width, height);
      const h = hard.getContext("2d");
      h.translate(-left, -top);
      h.strokeStyle = "#000";
      const brush = { size, hardness: 100 };
      points.forEach((point, index) => paintStroke(h, brush, index ? [points[index - 1], point] : [point]));
      const selection = doc.state.selection;
      if (selection) {
        h.globalCompositeOperation = "destination-in";
        const clip = clipOf(selection, 0, 0);
        if (clip.canvas) h.drawImage(clip.canvas, clip.x, clip.y);
        else h.fillRect(clip.x, clip.y, clip.width, clip.height);
      }
      const soft = newCanvas(width, height);
      const s = soft.getContext("2d", { willReadFrequently: true });
      s.filter = `blur(${Math.max(0.6, Math.min(2, size / 24))}px)`;
      s.drawImage(hard, 0, 0);
      s.filter = "none";
      s.drawImage(hard, 0, 0);
      const softData = s.getImageData(0, 0, width, height).data;
      const mask = new Uint8Array(width * height);
      let hl = width;
      let ht = height;
      let hr = -1;
      let hb = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (softData[(y * width + x) * 4 + 3] < 4) continue;
          mask[y * width + x] = 1;
          if (x < hl) hl = x;
          if (x > hr) hr = x;
          if (y < ht) ht = y;
          if (y > hb) hb = y;
        }
      }
      if (hr < 0) return "none";
      const canvas = newCanvas(width, height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const alone = !(sampleAll || !layer);
      paintDoc(doc, ctx, { x: -left, y: -top, skip: (item) => item.kind === "text" || (alone && item.id !== layer.id) });
      const data = ctx.getImageData(0, 0, width, height).data;
      // An empty layer, read alone, has nothing to heal from: not a black patch.
      if (!mask.some((hole, i) => !hole && data[i * 4 + 3] >= 128)) return "none";
      const source = healSource(data, mask, width, height);
      const result = await inpaint({ data, width, height, mask, source }, { adapt: true }, progress);
      // Meanwhile the page may have closed, or the layer gone
      if (!app.docs.includes(doc)) return "gone";
      layer = layerNow();
      if (layerId && !layer) return "gone";
      const region = newCanvas(width, height);
      region.getContext("2d").putImageData(new ImageData(result, width, height), 0, 0);
      const bw = hr - hl + 1;
      const bh = hb - ht + 1;
      const pixels = newCanvas(bw, bh);
      pixels.getContext("2d").drawImage(region, hl, ht, bw, bh, 0, 0, bw, bh);
      const edge = newCanvas(bw, bh);
      edge.getContext("2d").drawImage(soft, hl, ht, bw, bh, 0, 0, bw, bh);
      const opFor = (target) => {
        const dx = target.dx || 0;
        const dy = target.dy || 0;
        const op = { t: "patch", source: { canvas: pixels, x: left + hl - dx, y: top + ht - dy }, clip: { canvas: edge, x: left + hl - dx, y: top + ht - dy } };
        if (lockOf(target, "transparency")) op.atop = true;
        return op;
      };
      const layers = layer ? replaceLayer(doc, layer, { paint: (layer.paint || NONE).concat([opFor(layer)]) }) : paintOnCleanLayer(doc.state.layers, opFor);
      commitState(doc, "Spot Healing Brush", { layers });
      const painted = layers.find((item) => (layer ? item.id === layer.id : item.clean));
      return painted && !chainOf(painted, new Map(layers.map((item) => [item.id, item]))).visible ? "hidden" : "done";
    },
    /* ---- the Gradient tool ---- */
    // `spec`: { type, start, end (page pixels), stops: [{ at, r, g, b, a }], method, reverse,
    // opacity, dither }. `where`: { kind: "layer" | "mask" | "quick" | "clip" | "new", id }: a
    // pixel layer, a layer's mask or the Quick Mask (in grey), or a new layer, clipped to the
    // text or folder `id` for "clip". Within the selection, else over the page, or around what
    // a new layer is clipped to. Returns what to give back as `edit`, for that gradient to be
    // drawn again in its place (its ends dragged, an option changed): all the calls with the
    // same `token` are one step of history. `quick`: drawn smaller, enough while dragging.
    drawGradient({ spec, where, edit, token, quick, name }) {
      const doc = app.doc;
      if (!doc) return null;
      if (edit && !ops.gradientLive(edit)) return null;
      const target = edit ? edit.where : where;
      const selection = doc.state.selection;
      let layers = doc.state.layers;
      let holder = null;
      let layer = null;
      let made = null;
      if (target.kind === "quick" || target.kind === "mask") {
        holder = maskHolder(doc, target.kind, target.id);
        if (!holder) return null;
        if (holder.locked) {
          emit("layer-locked");
          return null;
        }
      } else if (target.kind === "layer") {
        layer = layers.find((item) => item.id === target.id && item.kind === "raster");
        if (!layer) return null;
        if (lockOf(layer, "pixels")) {
          emit("layer-locked");
          return null;
        }
      }
      let area = edit ? edit.area : null;
      if (!area) {
        let box = { left: 0, top: 0, right: doc.width, bottom: doc.height };
        const cut = (other) => {
          box = { left: Math.max(box.left, other.left), top: Math.max(box.top, other.top), right: Math.min(box.right, other.right), bottom: Math.min(box.bottom, other.bottom) };
        };
        const base = target.kind === "clip" ? layers.find((item) => item.id === target.id) : null;
        if (base) {
          // Around what it is clipped to, with room for it to move a little
          const byId = new Map(layers.map((item) => [item.id, item]));
          const members = base.kind === "group" ? Array.from(familyOf(layers, base.id)).map((id) => byId.get(id)).filter((item) => item && item.kind !== "group") : [base];
          let l = Infinity;
          let t = Infinity;
          let r = -Infinity;
          let b = -Infinity;
          members.forEach((member) => {
            const visual = visualOf(member, doc);
            if (!visual || !visual.canvas) return;
            l = Math.min(l, visual.x);
            t = Math.min(t, visual.y);
            r = Math.max(r, visual.x + visual.canvas.width);
            b = Math.max(b, visual.y + visual.canvas.height);
          });
          if (r > l && b > t) {
            const pad = Math.round(Math.max(r - l, b - t) * 0.5);
            cut({ left: l - pad, top: t - pad, right: r + pad, bottom: b + pad });
          }
        }
        if (selection) {
          const s = selection.bounds;
          cut({ left: Math.floor(s.left), top: Math.floor(s.top), right: Math.ceil(s.right), bottom: Math.ceil(s.bottom) });
        }
        if (box.right - box.left < 1 || box.bottom - box.top < 1) return null;
        area = { left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top };
      }
      if (target.kind === "clip" || target.kind === "new") {
        made = newRaster(name || "Gradient", { clipping: target.kind === "clip" });
        layers = layers.slice();
        let at;
        if (target.kind === "clip") {
          at = layers.findIndex((item) => item.id === target.id);
          if (at < 0) return null;
          // On top of what is already clipped to it
          const clip = clippingOf(doc.state.layers);
          const base = layers[at];
          while (at + 1 < layers.length && clip.clipped.has(layers[at + 1].id) && clip.baseOf.get(layers[at + 1].id) === base) at++;
          made.group = base.group || null;
          layers.splice(at + 1, 0, made);
        } else {
          const anchor = doc.state.activeIds[doc.state.activeIds.length - 1];
          at = layers.findIndex((item) => item.id === anchor);
          if (at >= 0) {
            made.group = layers[at].kind === "group" ? layers[at].id : layers[at].group;
            layers.splice(layers[at].kind === "group" ? at : at + 1, 0, made);
          } else layers.push(made);
        }
        layer = made;
      }
      const pixels = area.width * area.height;
      const scale = quick && pixels > 1200000 ? Math.sqrt(1200000 / pixels) : 1;
      const [ox, oy] = holder ? maskOrigin(holder) : [layer.dx || 0, layer.dy || 0];
      const drawn = renderGradient(spec, area, scale, Boolean(holder));
      const op = { t: "gradient", canvas: drawn.canvas, x: area.left - ox, y: area.top - oy, width: area.width, height: area.height, clip: selection ? clipOf(selection, ox, oy) : null, spec };
      if (drawn.cover) op.cover = drawn.cover;
      if (!holder && lockOf(layer, "transparency")) op.atop = true;
      const laid = (paint) => (edit ? (paint || NONE).slice(0, -1) : paint || NONE).concat([op]);
      let change;
      if (holder) {
        const mask = Object.assign({}, holder.mask, { paint: laid(holder.mask.paint) });
        change = target.kind === "quick" ? { quickMask: mask } : { layers: replaceLayer(doc, holder, { mask }) };
      } else {
        change = { layers: layers.map((item) => (item.id === layer.id ? Object.assign({}, item, { paint: laid(item.paint) }) : item)) };
        if (made) change.activeIds = [made.id];
      }
      commitState(doc, "Gradient", change, token);
      return { docId: doc.id, where: holder ? { kind: target.kind, id: target.id } : { kind: "layer", id: layer.id }, op, area, token, made: Boolean(made || (edit && edit.made)) };
    },
    // Whether the gradient an earlier drawGradient made is still the last thing done, where it was
    gradientLive(edit) {
      const doc = app.doc;
      if (!doc || !edit || doc.id !== edit.docId) return false;
      const last = doc.history[doc.historyIndex];
      if (!last || last.coalesce !== edit.token || doc.historyIndex !== doc.history.length - 1) return false;
      let paint = null;
      if (edit.where.kind === "quick" || edit.where.kind === "mask") {
        const holder = maskHolder(doc, edit.where.kind, edit.where.id);
        paint = holder && holder.mask.paint;
      } else {
        const layer = doc.state.layers.find((item) => item.id === edit.where.id);
        paint = layer && layer.paint;
      }
      return Boolean(paint && paint[paint.length - 1] === edit.op);
    },
    // The page as the Gradient tool reads its colours: without its texts, on white. With `edit`,
    // as it was before that gradient, which must not be matched to itself.
    pageData(edit) {
      const doc = app.doc;
      if (!doc) return null;
      const before = edit && ops.gradientLive(edit) ? doc.history[doc.historyIndex - 1] : null;
      return before ? sampleData(Object.assign({}, doc, { state: before.state, sampleCache: null, sampleKey: null }), true) : sampleData(doc, true);
    },
    // The colour of the page around a point (`data`: pageData's): a few pixels averaged, so
    // that a screentone gives its grey
    pageColor(x, y, radius = 3, page) {
      const doc = app.doc;
      if (!doc) return null;
      const data = page || sampleData(doc, true);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let py = Math.max(0, Math.round(y) - radius); py <= Math.min(doc.height - 1, Math.round(y) + radius); py++) {
        for (let px = Math.max(0, Math.round(x) - radius); px <= Math.min(doc.width - 1, Math.round(x) + radius); px++) {
          const i = (py * doc.width + px) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      }
      return n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) } : null;
    },
    // The page's own colours along a gradient: every pixel in a band just outside the selection
    // says what colour the gradient has where it lies. Read from the page without its texts,
    // with the median of each step, so the bubble's outline or a stray letter doesn't count.
    // Null when the band says too little: no selection, or a gradient too short.
    pageStops(spec, band = 10, page) {
      const doc = app.doc;
      const selection = doc && doc.state.selection;
      if (!selection) return null;
      const length = Math.hypot(spec.end[0] - spec.start[0], spec.end[1] - spec.start[1]);
      if (length < 4) return null;
      const b = selection.bounds;
      const left = Math.max(0, Math.floor(b.left) - band);
      const top = Math.max(0, Math.floor(b.top) - band);
      const right = Math.min(doc.width, Math.ceil(b.right) + band);
      const bottom = Math.min(doc.height, Math.ceil(b.bottom) + band);
      const width = right - left;
      const height = bottom - top;
      if (width <= 0 || height <= 0) return null;
      // The band: the selection grown, less the selection
      const ring = newCanvas(width, height);
      const c = ring.getContext("2d", { willReadFrequently: true });
      const clip = selectionCanvas(selection);
      for (let step = 0; step < 16; step++) {
        const turn = (step / 16) * Math.PI * 2;
        for (const reach of [band / 2, band]) c.drawImage(clip, b.left - left + Math.round(Math.cos(turn) * reach), b.top - top + Math.round(Math.sin(turn) * reach));
      }
      c.globalCompositeOperation = "destination-out";
      c.drawImage(clip, b.left - left, b.top - top);
      const inBand = c.getImageData(0, 0, width, height).data;
      const data = page || sampleData(doc, true);
      const place = gradientPlace(Object.assign({}, spec, { reverse: false }));
      const STEPS = Math.max(4, Math.min(64, Math.round(length / 6)));
      const bins = Array.from({ length: STEPS + 1 }, () => [[], [], []]);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (inBand[(y * width + x) * 4 + 3] < 128) continue;
          const t = place(left + x + 0.5, top + y + 0.5);
          if (!(t >= -0.02 && t <= 1.02)) continue;
          const bin = bins[Math.max(0, Math.min(STEPS, Math.round(t * STEPS)))];
          const i = ((top + y) * doc.width + left + x) * 4;
          bin[0].push(data[i]);
          bin[1].push(data[i + 1]);
          bin[2].push(data[i + 2]);
        }
      }
      const median = (list) => {
        list.sort((p, q) => p - q);
        return list[list.length >> 1];
      };
      const stops = [];
      bins.forEach((bin, k) => {
        if (bin[0].length >= 3) stops.push({ at: k / STEPS, r: median(bin[0]), g: median(bin[1]), b: median(bin[2]), a: 1 });
      });
      // The band goes all round the selection: what it says covers all of the gradient that
      // shows, and beyond it the gradient keeps its last colours
      if (!stops.length) return null;
      if (stops.length === 1) return [Object.assign({}, stops[0], { at: 0 }), Object.assign({}, stops[0], { at: 1 })];
      return stops;
    },
    // Edit > Generative Fill: the selection and what surrounds it, read from every pixel layer
    // and never from the text, go to an image model through `draw(canvas, { ratio, size })`,
    // which resolves with the model's picture. Such a picture comes back a little moved or
    // resized: Auto-Align Layers' engine lays it back on the page by what lies around the
    // selection, and only the selection is kept, on a new layer above the active one.
    // `ratios`: the shapes the model draws, as { label, value }. Long: progress goes 0 to 1.
    // It runs alongside the person's work: the page, the selection and the active layer are the
    // ones of the moment it starts, and `settle(doc)` resolves when the page may take the layer
    // (no gesture under way). The new layer becomes the active one only if the active layers
    // are still those of the start.
    // A generation that waited its turn passes its own `doc`, `selection` and `activeIds`.
    // `fixed`: the model draws a square of that many pixels, in place to the pixel (LaMa Manga,
    // on this device): the area is that square at the page's own size when the selection fits
    // in it, and the picture needs no aligning. `inPlace`: the picture needs no aligning either
    // (FLUX on this computer, which redraws only the selection); `longest`: its largest side.
    // `folder`: { name, id }, for Remove Text: the layer goes in that folder, made under the
    // texts the first time (its id kept in `folder.id`) and made again if it was deleted.
    // `matchTones`: the inside then brought to the brightness of the page that borders it.
    async generativeFill({ draw, ratios, name, settle, doc: wanted, selection: chosen, activeIds, hide, fixed, inPlace: drawnInPlace, longest, folder, matchTones: tones }, progress = () => {}) {
      const inPlace = Boolean(fixed || drawnInPlace);
      const doc = wanted || app.doc;
      if (!doc || !app.docs.includes(doc)) return { outcome: "gone" };
      const selection = chosen || doc.state.selection;
      if (!selection || (!chosen && doc.state.quickMask)) return { outcome: "none" };
      const b = selection.bounds;
      const activeAtStart = (activeIds || doc.state.activeIds).slice();
      const sizeAtStart = [doc.width, doc.height];
      // Enough around the selection for the model to see the art it continues
      const reach = Math.max(48, Math.round(Math.max(b.width, b.height) * 0.4));
      let x0 = b.left - reach;
      let y0 = b.top - reach;
      let x1 = b.right + reach;
      let y1 = b.bottom + reach;
      // Grown to the model's nearest shape, then slid inside the page, then cut by it
      const shape = (ratios || [{ label: "1:1", value: 1 }]).reduce((best, one) => (Math.abs(Math.log(one.value / ((x1 - x0) / (y1 - y0)))) < Math.abs(Math.log(best.value / ((x1 - x0) / (y1 - y0)))) ? one : best));
      if ((x1 - x0) / (y1 - y0) < shape.value) {
        const grow = (y1 - y0) * shape.value - (x1 - x0);
        x0 -= grow / 2;
        x1 += grow / 2;
      } else {
        const grow = (x1 - x0) / shape.value - (y1 - y0);
        y0 -= grow / 2;
        y1 += grow / 2;
      }
      const inside = (a, z, limit) => {
        const length = z - a;
        if (length >= limit) return [0, limit];
        if (a < 0) return [0, Math.round(length)];
        if (z > limit) return [limit - Math.round(length), limit];
        return [Math.round(a), Math.round(a) + Math.round(length)];
      };
      // A fixed square bigger than the area: the area grows to it, so nothing is scaled
      if (fixed && x1 - x0 < fixed && y1 - y0 < fixed) {
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        x0 = cx - fixed / 2;
        x1 = cx + fixed / 2;
        y0 = cy - fixed / 2;
        y1 = cy + fixed / 2;
      }
      [x0, x1] = inside(x0, x1, doc.width);
      [y0, y1] = inside(y0, y1, doc.height);
      const width = x1 - x0;
      const height = y1 - y0;
      if (width <= 0 || height <= 0) return { outcome: "none" };
      // The page as the model sees it: on white, without the text layers, nor the layers a
      // tool leaves out (the Bubble Reshaper's new bubble, so that the old one goes whole)
      const area = newCanvas(width, height);
      const actx = area.getContext("2d", { willReadFrequently: true });
      actx.fillStyle = "#fff";
      actx.fillRect(0, 0, width, height);
      const drawn = newCanvas(width, height);
      paintDoc(doc, drawn.getContext("2d"), { x: -x0, y: -y0, skip: (item) => item.kind === "text" || Boolean(hide && hide.includes(item.id)) });
      actx.drawImage(drawn, 0, 0);
      // A big area goes smaller, a small one bigger: the models draw at one to four megapixels
      // anyway, and some refuse a picture under 256 pixels a side
      const LONGEST = fixed || longest || 2048;
      const SHORTEST = fixed || 512;
      const scale = Math.min(LONGEST / Math.max(width, height), Math.max(1, SHORTEST / Math.min(width, height)));
      let sent = area;
      if (scale !== 1) {
        sent = newCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
        const sctx = sent.getContext("2d");
        sctx.imageSmoothingQuality = "high";
        sctx.drawImage(area, 0, 0, sent.width, sent.height);
      }
      // The selection, a little grown: where the picture may differ from the page. Models that
      // take a mask get it black on white, at the size sent; the aligner leaves it out.
      const hole = newCanvas(width, height);
      const hctx = hole.getContext("2d", { willReadFrequently: true });
      const clip = selectionCanvas(selection);
      const grow = Math.max(3, Math.round(Math.max(b.width, b.height) * 0.02));
      for (let step = 0; step < 16; step++) {
        const turn = (step / 16) * Math.PI * 2;
        hctx.drawImage(clip, b.left - x0 + Math.round(Math.cos(turn) * grow), b.top - y0 + Math.round(Math.sin(turn) * grow));
      }
      hctx.drawImage(clip, b.left - x0, b.top - y0);
      const holeData = hctx.getImageData(0, 0, width, height).data;
      const mask = newCanvas(sent.width, sent.height);
      const kctx = mask.getContext("2d", { willReadFrequently: true });
      const black = newCanvas(width, height);
      const bctx = black.getContext("2d");
      bctx.drawImage(hole, 0, 0);
      bctx.globalCompositeOperation = "source-in";
      bctx.fillStyle = "#000";
      bctx.fillRect(0, 0, width, height);
      kctx.fillStyle = "#fff";
      kctx.fillRect(0, 0, mask.width, mask.height);
      kctx.drawImage(black, 0, 0, mask.width, mask.height);
      const size = Math.max(width, height) > 1400 ? "2K" : "1K";
      const picture = await draw(sent, { ratio: shape.label, size, mask, inside: { left: (b.left - x0) * scale, top: (b.top - y0) * scale, width: b.width * scale, height: b.height * scale } });
      // Meanwhile the page may have closed
      if (!app.docs.includes(doc)) return { outcome: "gone" };
      progress(0.05);
      // First laid over the area as it is, stretched to it
      const made = newCanvas(width, height);
      const mctx = made.getContext("2d", { willReadFrequently: true });
      mctx.imageSmoothingQuality = "high";
      mctx.drawImage(picture, 0, 0, width, height);
      if (picture.close) picture.close();
      // Then aligned on what surrounds the selection: the selection itself, a little grown (the
      // hole), differs on purpose (its text is gone) and says nothing about where the picture goes
      const holed = (canvas) => {
        const data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
        for (let i = 3; i < data.length; i += 4) if (holeData[i]) data[i] = 0;
        return data;
      };
      // Each way of laying it is judged on the same ground: how far its grey levels stay from
      // the page's around the selection. Kept as it came, moved and resized by a direct search
      // (enough for the drift of such models), or as Auto-Align Layers' engine finds it.
      const judge = inPlace ? null : fitGround(area, made, hole, x0, y0);
      const candidates = [{ how: "as is", m: null, error: inPlace ? 0 : judge.error(null) }];
      const searched = inPlace ? null : judge.search();
      if (searched) candidates.push({ how: "search", m: searched, error: judge.error(searched) });
      progress(0.2);
      const reference = inPlace ? null : holed(area);
      const moving = inPlace ? null : holed(made);
      let aligner = null;
      if (!inPlace) try {
        aligner = await startAligner();
        const found = await aligner.ask("analyse", {
          layers: [
            { id: "page", x: x0, y: y0, width, height, data: reference.buffer, fixed: true },
            { id: "picture", x: x0, y: y0, width, height, data: moving.buffer, fixed: false },
          ],
          projection: "auto",
        }, [reference.buffer, moving.buffer], (percent) => progress(0.2 + (percent / 100) * 0.6));
        const move = found.moves.find((one) => one.id === "picture");
        if (move && !found.failed.includes("picture")) {
          const m = move.shift ? [1, 0, move.shift[0], 0, 1, move.shift[1], 0, 0, 1] : move.matrix;
          candidates.push({ how: "details", m, error: judge.error(m) });
        }
      } catch (error) {
        console.warn("SG Typer Studio: Auto-Align Layers' engine couldn't place the generated picture", error);
      }
      const best = candidates.reduce((one, other) => (other.error < one.error - 0.05 ? other : one));
      const aligned = Number.isFinite(best.error);
      let placed = { canvas: made, left: x0, top: y0 };
      try {
        if (best.m && best.m[6] === 0 && best.m[7] === 0) {
          const m = best.m;
          placed = transformedPixels(made, x0, y0, rectFrom(x0, y0, x1, y1), [m[0] / m[8], m[3] / m[8], m[1] / m[8], m[4] / m[8], m[2] / m[8], m[5] / m[8]]);
        } else if (best.m) {
          const { data } = mctx.getImageData(0, 0, width, height);
          const out = await aligner.ask("warp", { data: data.buffer, width, height, x: x0, y: y0, matrix: best.m }, [data.buffer]);
          placed = { canvas: canvasOfBytes(out), left: out.left, top: out.top };
        }
      } catch (error) {
        console.warn("SG Typer Studio: the generated picture could not be moved", error);
      } finally {
        if (aligner) aligner.stop();
      }
      if (!app.docs.includes(doc)) return { outcome: "gone" };
      progress(0.9);
      // The picture laid on the area: the aligned one over the stretched one, so no edge shows through
      const laid = newCanvas(width, height);
      const lctx = laid.getContext("2d", { willReadFrequently: true });
      lctx.drawImage(made, 0, 0);
      if (placed.canvas !== made) lctx.drawImage(placed.canvas, placed.left - x0, placed.top - y0);
      // Models shift the tones (a cream paper, a grain, greys a little off): around the selection,
      // the picture's levels are matched to the page's, and the same levels go inside. FLUX shifts
      // them too, even drawing in place: only LaMa's pixels keep the page's own.
      // Then, unless turned off, the inside brought to the brightness of the page at its edge:
      // LaMa's too, whose inside is its own guess.
      if (!fixed || tones) {
        const laidData = lctx.getImageData(0, 0, width, height);
        const pageData = actx.getImageData(0, 0, width, height).data;
        if (!fixed) matchLevels(laidData.data, pageData, holeData);
        if (tones) matchTones(laidData.data, pageData, holeData, width, height);
        lctx.putImageData(laidData, 0, 0);
      }
      progress(0.95);
      const pixels = newCanvas(b.width, b.height);
      pixels.getContext("2d").drawImage(laid, x0 - b.left, y0 - b.top);
      if (settle) await settle(doc);
      if (!app.docs.includes(doc)) return { outcome: "gone" };
      // A page cropped or resized meanwhile has moved its places: the picture would land wrong
      if (doc.width !== sizeAtStart[0] || doc.height !== sizeAtStart[1]) return { outcome: "resized" };
      const op = { t: "patch", source: { canvas: pixels, x: b.left, y: b.top }, clip: clipOf(selection, 0, 0) };
      const layer = newRaster(name || "Generative Fill", { paint: [op] });
      // Above the layer active at the start, or the one active now, or on top
      const layers = doc.state.layers.slice();
      if (folder) {
        // Remove Text: each area on its own layer, all in the folder of their run, above TypeR
        // Clean, or under the texts; closed, so many areas don't fill the Layers panel
        let home = layers.findIndex((item) => item.id === folder.id && item.kind === "group");
        if (home < 0) {
          const clean = layers.findIndex((item) => item.clean);
          home = clean >= 0 ? clean + 1 : underTexts(layers);
          const group = { id: newId(), kind: "group", name: folder.name || "Text removed", visible: true, opacity: 1, blend: "pass through", open: false, group: clean >= 0 ? layers[clean].group || null : null };
          layers.splice(home, 0, group);
          folder.id = group.id;
        }
        layer.group = folder.id;
        layers.splice(home, 0, layer);
      } else {
        let at = layers.findIndex((item) => item.id === activeAtStart[activeAtStart.length - 1]);
        if (at < 0) at = layers.findIndex((item) => item.id === doc.state.activeIds[doc.state.activeIds.length - 1]);
        if (at >= 0) {
          layer.group = layers[at].kind === "group" ? layers[at].id : layers[at].group;
          layers.splice(layers[at].kind === "group" ? at : at + 1, 0, layer);
        } else layers.push(layer);
      }
      const unchanged = !folder && doc.state.activeIds.length === activeAtStart.length && doc.state.activeIds.every((id, i) => id === activeAtStart[i]);
      commitState(doc, folder ? "Remove Text" : "Generative Fill", unchanged ? { layers, activeIds: [layer.id] } : { layers });
      if (app.doc === doc) firePanelEvent(EVENT_HISTORY);
      progress(1);
      return { outcome: "done", aligned, how: best.how, error: Math.round(best.error * 100) / 100, tried: candidates.map((one) => `${one.how} ${one.error.toFixed(2)}`).join(", "), id: layer.id, doc };
    },
    pickColor(x, y) {
      const doc = app.doc;
      if (!doc) return null;
      const canvas = newCanvas(1, 1);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      paintDoc(doc, ctx, { keep: true, x: -Math.floor(x), y: -Math.floor(y) });
      const px = ctx.getImageData(0, 0, 1, 1).data;
      return px[3] ? { r: px[0], g: px[1], b: px[2] } : null;
    },
    /* ---- text ---- */
    newText(x, y, value, box) {
      const doc = app.doc;
      if (!doc) return null;
      const d = app.textDefaults;
      const text = value || "";
      const style = { fontPostScriptName: d.font, fontName: d.family, fontStyleName: d.style, size: d.size, impliedFontSize: d.size, autoLeading: true, tracking: 0, horizontalScale: 100, verticalScale: 100, ligature: d.ligature, textLanguage: d.language, autoKern: d.autoKern === "manual" ? "manual" : "metricsKern", color: { red: app.fg.r, green: app.fg.g, blue: app.fg.b } };
      const params = { layerText: { textKey: text, antiAlias: d.antiAlias || "antiAliasSmooth", textClickPoint: { horizontal: (x / doc.width) * 100, vertical: (y / doc.height) * 100 }, textStyleRange: [{ from: 0, to: text.length, textStyle: style }], paragraphStyleRange: [{ from: 0, to: text.length, paragraphStyle: Object.assign({ alignment: "center", autoLeadingPercentage: 1.2 }, d.hyphenate ? { hyphenate: true } : {}) }], textShape: [box ? { textType: "box", orientation: "horizontal", box: Object.assign({ verticalAlign: d.verticalAlign }, box) } : { textType: "point", orientation: "horizontal" }] } };
      const layer = newTextLayer(doc, params, null, text || "Text");
      commitState(doc, "Type Tool", { layers: addNewTexts(doc.state.layers, [layer], textSpotOf(doc)), activeIds: [layer.id] });
      firePanelEvent(EVENT_SELECT);
      return layer;
    },
    setText(id, value, coalesce) {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id && item.kind === "text");
      if (!layer) return;
      const base = layer.params.layerText.textStyleRange[0].textStyle;
      const params = paramsFromStyle({ textProps: layer.params }, value, null, base.size);
      params.layerText.textClickPoint = clone(layer.params.layerText.textClickPoint);
      if (boxShape(layer.params.layerText)) params.layerText.textShape = clone(layer.params.layerText.textShape);
      if (layer.params.layerText.textStyleRange.length > 1) params.layerText.textStyleRange = rangesAfterEdit(layer.params.layerText, params.layerText.textKey);
      const name = String(value).replace(/[\r\n]+/g, " ").substring(0, 60) || layer.name;
      // Typing redraws where the text was and where it is, not the whole page
      // (a styled folder draws its stroke around all it holds: the whole page then)
      const styled = layer.group && styledParentOf(layer, new Map(doc.state.layers.map((item) => [item.id, item])), doc.state.layers);
      const before = styled ? null : visualBounds(layer, doc);
      const next = Object.assign({}, layer, { params, raster: null, name, source: null });
      commitState(doc, "Edit Type", { layers: doc.state.layers.map((item) => (item.id === layer.id ? next : item)) }, coalesce, () => unionRect(doc, before, before && visualBounds(next, doc)));
      firePanelEvent(EVENT_HISTORY);
    },
    // Font, size, leading, colour, alignment: on all the selected text layers, or on the
    // letters of `range` when text is selected in the editor. A patch can be a function of
    // each style, for what is relative to it.
    setTextStyle(ids, patch, paragraphPatch, coalesce, range) {
      const doc = app.doc;
      if (!doc) return;
      const set = new Set(ids);
      const layers = doc.state.layers.map((layer) => {
        if (!set.has(layer.id) || layer.kind !== "text") return layer;
        const box = boxOf(layer, doc);
        const params = clone(layer.params);
        const lt = params.layerText;
        const patched = (style) => {
          const change = typeof patch === "function" ? patch(style) : patch;
          Object.assign(style, change);
          if (change.size) style.impliedFontSize = change.size;
          if (change.leading) style.impliedLeading = change.leading;
          if (change.baselineShift !== undefined) style.impliedBaselineShift = change.baselineShift;
          return style;
        };
        if (patch && range) {
          const before = lt.textStyleRange;
          const made = new Map();
          const styles = [];
          for (let at = 0; at < lt.textKey.length; at++) {
            const source = (before.find((item) => at >= item.from && at < item.to) || before[before.length - 1]).textStyle;
            if (at < range[0] || at >= range[1]) styles.push(source);
            else {
              if (!made.has(source)) made.set(source, patched(clone(source)));
              styles.push(made.get(source));
            }
          }
          lt.textStyleRange = rangesFromStyles(styles, before[0].textStyle);
        } else if (patch) lt.textStyleRange.forEach((item) => patched(item.textStyle));
        if (paragraphPatch) lt.paragraphStyleRange.forEach((range) => Object.assign(range.paragraphStyle, paragraphPatch));
        const next = Object.assign({}, layer, { params, raster: null });
        if ((paragraphPatch && paragraphPatch.alignment) || boxShape(lt)) return next;
        return centredOn(next, doc, box.xMid, box.yMid);
      });
      commitState(doc, "Character", { layers }, coalesce);
      firePanelEvent(EVENT_HISTORY);
    },
    // The side handles: the box changes and the text flows again. A base layer in, so
    // a whole gesture starts from the same text.
    setTextFrame(base, frame, coalesce) {
      const doc = app.doc;
      if (!doc || !doc.state.layers.some((item) => item.id === base.id)) return;
      const params = clone(base.params);
      const lt = params.layerText;
      if (!boxShape(lt) && base.source !== undefined && base.source !== null && !base.manualBreaks) unwrapText(lt, base.source);
      const orientation = (lt.textShape && lt.textShape[0] && lt.textShape[0].orientation) || "horizontal";
      // A box from a PSD has no vertical alignment yet: resizing it gives it the usual one
      const verticalAlign = (boxShape(lt) && boxShape(lt).box.verticalAlign) || app.textDefaults.verticalAlign;
      lt.textShape = [{ textType: "box", orientation, box: { width: Math.max(1, frame.width), height: Math.max(1, frame.height), autoHeight: Boolean(frame.autoHeight), verticalAlign } }];
      lt.textClickPoint = { horizontal: (frame.left / doc.width) * 100, vertical: (frame.top / doc.height) * 100 };
      commitState(doc, "Text Box", { layers: replaceLayer(doc, base, { params, raster: null }) }, coalesce);
      firePanelEvent(EVENT_HISTORY);
    },
    // The corners: the size of the text, with its box, around a fixed point of the frame
    scaleTextFrom(base, factor, ax, ay, coalesce) {
      const doc = app.doc;
      if (!doc || !doc.state.layers.some((item) => item.id === base.id)) return null;
      const before = frameOf(base, doc);
      const { next, size } = grownText(base, factor);
      const after = frameOf(next, doc);
      const moved = shifted(next, before.left + ax * before.width - (after.left + ax * after.width), before.top + ay * before.height - (after.top + ay * after.height), doc);
      commitState(doc, "Character", { layers: replaceLayer(doc, base, moved) }, coalesce);
      firePanelEvent(EVENT_HISTORY);
      return size;
    },
    // Several texts from the corners of the frame around them all, as one: each grows as its own
    // corner would make it, and its middle moves away from `pivot` as much; without a pivot, each
    // stays where it is. A text in perspective, its surface. One step in the history; the size of
    // the last text, or null.
    scaleTexts(bases, factor, pivot, coalesce) {
      const doc = app.doc;
      if (!doc) return null;
      const changed = new Map();
      let size = null;
      bases.forEach((base) => {
        if (base.kind !== "text" || !doc.state.layers.some((item) => item.id === base.id)) return;
        const [px, py] = pivot || middleOfText(base, doc);
        const away = ([x, y]) => [px + (x - px) * factor, py + (y - py) * factor];
        if (base.warp) {
          const scaled = ([x, y]) => [x * factor, y * factor];
          changed.set(base.id, Object.assign({}, base, { warp: Object.assign({}, base.warp, { corners: base.warp.corners.map(away), bendTop: scaled(base.warp.bendTop), bendBottom: scaled(base.warp.bendBottom) }) }));
          return;
        }
        const from = middleOfText(base, doc);
        const made = grownText(base, factor);
        const now = middleOfText(made.next, doc);
        const [x, y] = away(from);
        changed.set(base.id, shifted(made.next, x - now[0], y - now[1], doc));
        size = made.size;
      });
      if (!changed.size) return null;
      commitState(doc, "Free Transform", { layers: doc.state.layers.map((layer) => changed.get(layer.id) || layer) }, coalesce);
      firePanelEvent(EVENT_HISTORY);
      return size;
    },
    // Turns a text by `delta` radians around `pivot`, as Photoshop's transform controls do.
    // It stays a text: Photoshop gets it turned, and it can still be typed in.
    turnText(base, delta, pivot, coalesce) {
      ops.turnTexts([base], delta, pivot, coalesce);
    },
    // Several texts around the same pivot, in one step of the history
    turnTexts(bases, delta, pivot, coalesce) {
      const doc = app.doc;
      if (!doc) return;
      const changed = new Map();
      bases.forEach((base) => {
        if (base && base.kind === "text" && doc.state.layers.some((item) => item.id === base.id)) changed.set(base.id, turnedText(base, delta, pivot, doc));
      });
      if (!changed.size) return;
      commitState(doc, "Free Transform", { layers: doc.state.layers.map((layer) => changed.get(layer.id) || layer) }, coalesce);
      firePanelEvent(EVENT_HISTORY);
    },
    // Type > Convert: a box becomes a point text with the lines it had, and back
    convertText(id) {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id && item.kind === "text");
      if (!layer) return;
      const layout = layoutLayer(layer, doc);
      // Every line, the ones a box too small doesn't show too: nothing typed gets lost
      const rows = layout.relative.wrapped.map((runs) => ({ runs }));
      if (!boxShape(layer.params.layerText)) {
        const f = frameOf(layer, doc);
        ops.setTextFrame(layer, { left: f.left, top: f.top, width: f.width + 2, height: f.height, autoHeight: true });
        return;
      }
      const params = clone(layer.params);
      const lt = params.layerText;
      const paragraph = lt.paragraphStyleRange[0].paragraphStyle;
      const key = rows.map((row) => row.runs.map((run) => run.text).join("")).join("\r");
      const first = lt.textStyleRange[0].textStyle;
      lt.textKey = key;
      if (lt.textStyleRange.length > 1) lt.textStyleRange = rangesOfLines(rows, first);
      else lt.textStyleRange[0].to = key.length;
      lt.paragraphStyleRange[0].to = key.length;
      lt.textShape = [{ textType: "point", orientation: "horizontal" }];
      const f = layout.frame;
      const align = paragraph.alignment || "center";
      const x = align === "left" ? f.left : align === "right" ? f.right : f.xMid;
      const y = f.top + (layout.relative.lines[0] ? layout.relative.lines[0].baseline : 0);
      lt.textClickPoint = { horizontal: (x / doc.width) * 100, vertical: (y / doc.height) * 100 };
      commitState(doc, "Convert Text", { layers: replaceLayer(doc, layer, { params, raster: null }) });
    },
    // The Line Breaks window: the page shows a break before it is clicked
    previewBreaks(id, model, breaks) {
      const doc = app.doc;
      if (!doc) return;
      const layer = id && doc.state.layers.find((item) => item.id === id);
      const next = layer ? layerWithBreaks(layer, doc, model, breaks) : null;
      if (!next && !doc.preview) return;
      doc.preview = next;
      emit("render");
    },
    setLineBreaks(id, model, breaks) {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id);
      if (!layer) return;
      doc.preview = null;
      commitState(doc, "Line Breaks", { layers: replaceLayer(doc, layer, layerWithBreaks(layer, doc, model, breaks)) });
      firePanelEvent(EVENT_HISTORY);
    },
    /* ---- Curves adjustment layer: a temporary row until OK, no pixels of its own ---- */
    curvesBegin(id) {
      const doc = app.doc;
      if (!doc || doc.curves) return { error: "none" };
      const beforeState = doc.state;
      let layer = doc.state.layers.find((item) => item.id === id && item.kind === "curves");
      if (!layer && id === undefined && doc.state.activeIds.length === 1) {
        const active = doc.state.layers.find((item) => item.id === doc.state.activeIds[0]);
        if (active && active.kind === "curves") layer = active;
      }
      let source = null;
      if (!layer) {
        source = activeRaster(doc);
        if (!source || source.adjustment) return { error: "none" };
        let number = 1;
        while (doc.state.layers.some((item) => item.kind === "curves" && item.name === `Curves ${number}`)) number++;
        layer = newCurves(`Curves ${number}`, { group: source.group || null });
        const layers = doc.state.layers.slice();
        layers.splice(layers.indexOf(source) + 1, 0, layer);
        doc.state = Object.assign({}, doc.state, { layers, activeIds: [layer.id] });
      }
      doc.curves = { id: layer.id, beforeState };
      if (source) emit("active");

      // The histogram describes what this adjustment actually sees, not just the active raster.
      const at = doc.state.layers.indexOf(layer);
      const canvas = newCanvas(doc.width, doc.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      paintDoc(doc, context, { skip: (item) => doc.state.layers.indexOf(item) >= at });
      const data = context.getImageData(0, 0, doc.width, doc.height).data;
      const rgb = new Uint32Array(256);
      const r = new Uint32Array(256);
      const g = new Uint32Array(256);
      const b = new Uint32Array(256);
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        r[data[i]]++;
        g[data[i + 1]]++;
        b[data[i + 2]]++;
        rgb[(data[i] * 77 + data[i + 1] * 151 + data[i + 2] * 28) >> 8]++;
      }
      return { histograms: { rgb, r, g, b }, name: source ? source.name : layer.name, created: Boolean(source), params: window.TypeRCurves.cloneParams(layer.curves) };
    },
    curvesPreview(params, enabled = true) {
      const doc = app.doc;
      const session = doc && doc.curves;
      if (!session) return;
      const layer = doc.state.layers.find((item) => item.id === session.id);
      if (!layer) return;
      const curves = window.TypeRCurves.cloneParams(params || layer.curves);
      doc.state = Object.assign({}, doc.state, { layers: replaceLayer(doc, layer, { curves, curvesBypass: !enabled }) });
      emit("render");
    },
    curvesEnd(params, label = "Curves") {
      const doc = app.doc;
      const session = doc && doc.curves;
      if (!session) return;
      doc.curves = null;
      if (!params) {
        doc.state = session.beforeState;
        emit("active");
        return;
      }
      const layer = doc.state.layers.find((item) => item.id === session.id);
      if (!layer) {
        doc.state = session.beforeState;
        emit("active");
        return;
      }
      const curves = window.TypeRCurves.cloneParams(params);
      doc.state = Object.assign({}, doc.state, { layers: replaceLayer(doc, layer, { curves, curvesBypass: false }) });
      commitState(doc, label);
      firePanelEvent(EVENT_HISTORY);
    },
    /* ---- Image > Levels: a non-destructive preview of a destructive pixel edit ---- */
    // The active pixel layer, or what of it is selected. Its pixels are read once: each change
    // redraws the selected part only, and the page shows it before anything is applied.
    levelsBegin() {
      const doc = app.doc;
      if (!doc) return { error: "none" };
      const layer = activeRaster(doc);
      if (!layer || layer.adjustment) return { error: "none" };
      if (lockOf(layer, "pixels")) return { error: "locked" };
      const visual = visualOf(Object.assign({}, layer, { mask: null, vectorMask: null }), doc);
      if (!visual || !visual.canvas.width || !visual.canvas.height) return { error: "empty" };
      const width = visual.canvas.width;
      const height = visual.canvas.height;
      const canvas = newCanvas(width, height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(visual.canvas, 0, 0);
      const source = ctx.getImageData(0, 0, width, height);
      const output = new ImageData(new Uint8ClampedArray(source.data), width, height);
      let box = { left: 0, top: 0, right: width, bottom: height };
      let inside = null;
      const selection = doc.state.selection;
      if (selection) {
        const b = selection.bounds;
        box = {
          left: Math.max(0, Math.floor(b.left - visual.x)),
          top: Math.max(0, Math.floor(b.top - visual.y)),
          right: Math.min(width, Math.ceil(b.right - visual.x)),
          bottom: Math.min(height, Math.ceil(b.bottom - visual.y)),
        };
        if (box.right <= box.left || box.bottom <= box.top) return { error: "outside" };
        const m = selection.mask;
        if (m) {
          const bw = box.right - box.left;
          inside = new Uint8Array(bw * (box.bottom - box.top));
          for (let y = box.top; y < box.bottom; y++) {
            const my = y + visual.y - m.top;
            if (my < 0 || my >= m.height) continue;
            for (let x = box.left; x < box.right; x++) {
              const mx = x + visual.x - m.left;
              if (mx >= 0 && mx < m.width && m.data[my * m.width + mx]) inside[(y - box.top) * bw + x - box.left] = 1;
            }
          }
        }
      }
      // What the pixels hold, channel by channel, transparent ones left out
      const rgb = new Uint32Array(256);
      const r = new Uint32Array(256);
      const g = new Uint32Array(256);
      const b = new Uint32Array(256);
      const data = source.data;
      const bw = box.right - box.left;
      for (let y = box.top; y < box.bottom; y++) {
        let i = (y * width + box.left) * 4;
        let k = (y - box.top) * bw;
        for (let x = box.left; x < box.right; x++, i += 4, k++) {
          if (!data[i + 3] || (inside && !inside[k])) continue;
          r[data[i]]++;
          g[data[i + 1]]++;
          b[data[i + 2]]++;
          rgb[(data[i] * 77 + data[i + 1] * 151 + data[i + 2] * 28) >> 8]++;
        }
      }
      doc.levels = { id: layer.id, visual, canvas, ctx, source, output, box, inside, shown: false };
      return { histograms: { rgb, r, g, b }, selection: Boolean(selection), name: layer.name };
    },
    // `tables` is three lists of 256 values, red, green and blue; none shows the layer as it was
    levelsPreview(tables) {
      const doc = app.doc;
      const session = doc && doc.levels;
      if (!session) return;
      levelsPaint(session, tables);
      const layer = doc.state.layers.find((item) => item.id === session.id);
      if (!session.shown) {
        session.shown = true;
        doc.preview = Object.assign({}, layer, { bitmap: session.canvas, left: session.visual.x - (layer.dx || 0), top: session.visual.y - (layer.dy || 0), paint: NONE });
      }
      levelsForget(session);
      const { box, visual } = session;
      emit("render", pageRect(doc, visual.x + box.left, visual.y + box.top, visual.x + box.right, visual.y + box.bottom));
    },
    levelsEnd(tables, label = "Levels") {
      const doc = app.doc;
      const session = doc && doc.levels;
      if (!session) return;
      doc.levels = null;
      if (session.shown) doc.preview = null;
      levelsForget(session);
      const layer = doc.state.layers.find((item) => item.id === session.id);
      if (!tables || !layer) {
        emit("render");
        return;
      }
      levelsPaint(session, tables);
      commitState(doc, label, { layers: replaceLayer(doc, layer, withPixels(layer, session.canvas, session.visual.x, session.visual.y, pageMask(layer, doc))) });
      firePanelEvent(EVENT_HISTORY);
    },
    // The text's rectangle becomes a surface, with nothing moved yet
    startTextWarp(id) {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id && item.kind === "text");
      if (!layer || layer.warp || layer.rotated) return;
      const f = frameOf(Object.assign({}, layer, { raster: null }), doc);
      const [ax, ay] = anchorOf(layer.params.layerText, doc);
      const width = Math.max(1, f.width);
      const height = Math.max(1, f.height);
      const warp = {
        source: { left: f.left - ax, top: f.top - ay, width, height },
        corners: [[f.left, f.top], [f.left + width, f.top], [f.left + width, f.top + height], [f.left, f.top + height]],
        bendTop: [0, 0],
        bendBottom: [0, 0],
        wrap: 0,
      };
      commitState(doc, "Perspective", { layers: replaceLayer(doc, layer, { warp, raster: null }) });
      firePanelEvent(EVENT_HISTORY);
    },
    // A base layer in, so that a whole gesture starts from the same surface
    setTextWarp(base, warp, coalesce) {
      const doc = app.doc;
      if (!doc || !doc.state.layers.some((item) => item.id === base.id)) return;
      commitState(doc, "Perspective", { layers: replaceLayer(doc, base, { warp }) }, coalesce);
      firePanelEvent(EVENT_HISTORY);
    },
    // Back to a plain text, where the surface was
    removeTextWarp(id) {
      const doc = app.doc;
      const layer = doc && doc.state.layers.find((item) => item.id === id && item.kind === "text");
      if (!layer || !layer.warp) return;
      const place = frameOf(layer, doc);
      const plain = Object.assign({}, layer, { warp: null });
      commitState(doc, "Perspective", { layers: replaceLayer(doc, layer, centredOn(plain, doc, place.xMid, place.yMid)) });
      firePanelEvent(EVENT_HISTORY);
    },
    setTextVerticalAlign(ids, value) {
      const doc = app.doc;
      if (!doc) return;
      const set = new Set(ids);
      let changed = false;
      const layers = doc.state.layers.map((layer) => {
        const shape = set.has(layer.id) && layer.kind === "text" && boxShape(layer.params.layerText);
        if (!shape || (shape.box.verticalAlign || "top") === value) return layer;
        changed = true;
        const params = clone(layer.params);
        boxShape(params.layerText).box.verticalAlign = value;
        return Object.assign({}, layer, { params, raster: null });
      });
      if (!changed) return;
      commitState(doc, "Text Box", { layers });
      firePanelEvent(EVENT_HISTORY);
    },
    setTextAntiAlias(ids, value) {
      const doc = app.doc;
      if (!doc) return;
      const set = new Set(ids);
      const layers = doc.state.layers.map((layer) => {
        if (!set.has(layer.id) || layer.kind !== "text" || layer.params.layerText.antiAlias === value) return layer;
        const params = clone(layer.params);
        params.layerText.antiAlias = value;
        return Object.assign({}, layer, { params, raster: null });
      });
      commitState(doc, "Anti-Alias", { layers });
      firePanelEvent(EVENT_HISTORY);
    },
    // `stroke` can be a function of each layer, for a change made on each one's own stroke
    setTextStroke(ids, stroke, coalesce) {
      const doc = app.doc;
      if (!doc) return;
      const set = new Set(ids);
      const strokeOf = typeof stroke === "function" ? stroke : () => stroke;
      commitState(doc, "Stroke", { layers: doc.state.layers.map((layer) => {
        if (!set.has(layer.id) || layer.kind !== "text") return layer;
        const next = strokeOf(layer);
        return next === layer.stroke ? layer : Object.assign({}, layer, { stroke: next, raster: null });
      }) }, coalesce);
    },
    // A text layer's effects (see FX_DEFAULTS): the whole `effects` object, or a function of
    // each layer for a change made on each one's own. Null takes them all off. The letters
    // stay as they are, Photoshop's own pixels included: only what is drawn around and on them
    // changes.
    setLayerEffects(ids, effects, coalesce) {
      const doc = app.doc;
      if (!doc) return;
      const set = new Set(ids);
      const effectsOf = typeof effects === "function" ? effects : () => effects;
      commitState(doc, "Layer Style", { layers: doc.state.layers.map((layer) => {
        if (!set.has(layer.id) || layer.kind !== "text") return layer;
        const next = effectsOf(layer) || undefined;
        return next === layer.effects ? layer : Object.assign({}, layer, { effects: next });
      }) }, coalesce);
    },
    undo() {
      const doc = app.doc;
      if (!doc || doc.historyIndex <= 0) return false;
      ops.jump(doc.historyIndex - 1);
      emit("undo");
      return true;
    },
    redo() {
      const doc = app.doc;
      if (!doc || doc.historyIndex >= doc.history.length - 1) return false;
      ops.jump(doc.historyIndex + 1);
      emit("redo");
      return true;
    },
    // What a dialog tried out, gone as if it had never been
    rollbackHistory(index) {
      const doc = app.doc;
      if (!doc || doc.historyIndex <= index) return;
      ops.jump(index);
      doc.history.length = index + 1;
      emit("history");
    },
    jump(index) {
      const doc = app.doc;
      const before = sizeOf(doc);
      const { size } = doc.history[index];
      doc.historyIndex = index;
      doc.state = doc.history[index].state;
      if (size) Object.assign(doc, size);
      emit("history");
      emit("selection", doc.state.selection);
      emit("render");
      if (doc.width !== before.width || doc.height !== before.height || doc.resolution !== before.resolution) sizeChanged(doc, before);
      firePanelEvent(EVENT_HISTORY);
    },
    /* ---- documents ---- */
    addDoc(fields) {
      const doc = createDoc(fields);
      setDoc(doc);
      return doc;
    },
    // A document session.js kept, as it was. Ids go on after its own, and its repeated
    // gestures stay apart from the ones to come, whose keys start over with the page.
    restoreDoc({ nextId: nextFree, name, path, stamp, handle, width, height, resolution, psd, idml, state, history, historyIndex, savedId, view }, activate) {
      nextId = Math.max(nextId, nextFree);
      history.forEach((entry) => { entry.coalesce = null; });
      if (view.fitted) view.seen = false;
      const doc = { id: newId(), name, path, stamp: stamp || null, handle: handle || null, width, height, resolution, psd: psd || null, idml: idml || null, sampleCache: null, sampleKey: "", state, history, historyIndex, savedId, view };
      if (doc.idml && window.TypeRInDesign) window.TypeRInDesign.adopt(doc);
      if (activate) setDoc(doc);
      else {
        app.docs.push(doc);
        emit("document", app.doc);
      }
      return doc;
    },
    newDocument({ name, width, height, resolution, background }) {
      const layer = newRaster(background ? (app.names && app.names.background) || "Background" : `${(app.names && app.names.layer) || "Layer"} 1`, { isBackground: Boolean(background) });
      if (background) {
        layer.bitmap = newCanvas(width, height);
        const ctx = layer.bitmap.getContext("2d");
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
      }
      return ops.addDoc({ name, path: "new://" + newId(), width, height, resolution, layers: [layer] });
    },
    imageDocument(image, name, path, handle, resolution) {
      refuseIfTooLarge(image.naturalWidth || image.width, image.naturalHeight || image.height);
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const bitmap = newCanvas(width, height);
      bitmap.getContext("2d").drawImage(image, 0, 0);
      const layer = newRaster((app.names && app.names.background) || "Background", { bitmap, isBackground: true });
      return ops.addDoc({ name, path, width, height, resolution, layers: [layer], handle });
    },
    loadImage(url, name, path, handle, resolution) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(ops.imageDocument(image, name, path || url, handle, resolution));
        image.onerror = () => reject(new Error("Could not read " + name));
        image.src = url;
      });
    },
    // A PNG, a JPEG or a PSD, picked by the user or by TypeR's page sync
    async openBlob(file, name, path, handle) {
      handle = handle || fileHandles.get(handleKey(file)) || null;
      const key = path || ops.registerFile(file);
      // The same name isn't the same file: every chapter has its 01.psd, and a file can
      // change on disk while its document is kept in the browser
      const stamp = fileStamp(file);
      const known = app.docs.find((doc) => doc.path === key && (!doc.stamp || doc.stamp === stamp));
      if (known) {
        if (handle && !known.handle) known.handle = handle;
        setDoc(known);
        return known;
      }
      if (/\.psd$/i.test(name) || /\.psb$/i.test(name)) {
        // Told by the file's first bytes, before anything is decoded
        const head = new DataView(await file.slice(0, 26).arrayBuffer());
        if (head.byteLength >= 26 && head.getUint32(0) === 0x38425053) refuseIfTooLarge(head.getUint32(18), head.getUint32(14));
        const read = await window.TypeRPSD.read(await file.arrayBuffer(), name, file);
        const doc = ops.addDoc(Object.assign(read, { name, path: key, handle, stamp }));
        emit("psd-opened", { doc, missing: read.missingFonts, notes: read.notes });
        return doc;
      }
      const resolution = await imageResolution(file);
      const url = URL.createObjectURL(file);
      try {
        const doc = await ops.loadImage(url, name, key, handle, resolution);
        doc.stamp = stamp;
        return doc;
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    // A file read for Batch Save: a document that no tab shows, let go with dropDetached()
    async readDetached(file, name) {
      if (/\.ps[db]$/i.test(name)) {
        const head = new DataView(await file.slice(0, 26).arrayBuffer());
        if (head.byteLength >= 26 && head.getUint32(0) === 0x38425053) refuseIfTooLarge(head.getUint32(18), head.getUint32(14));
        const read = await window.TypeRPSD.read(await file.arrayBuffer(), name, file);
        return createDoc(Object.assign(read, { name, path: "batch://" + newId() }));
      }
      const url = URL.createObjectURL(file);
      try {
        const image = await new Promise((resolve, reject) => {
          const picture = new Image();
          picture.onload = () => resolve(picture);
          picture.onerror = () => reject(new Error("Could not read " + name));
          picture.src = url;
        });
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        refuseIfTooLarge(width, height);
        const bitmap = newCanvas(width, height);
        bitmap.getContext("2d").drawImage(image, 0, 0);
        const layer = newRaster((app.names && app.names.background) || "Background", { bitmap, isBackground: true });
        return createDoc({ name, path: "batch://" + newId(), width, height, resolution: await imageResolution(file), layers: [layer] });
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    dropDetached(doc) {
      forgetDocPixels(doc);
    },
    // The file on disk is now the document's: opening it again finds the document, and
    // the next save can tell whether someone else changed it
    fileWritten(doc, file) {
      doc.path = ops.registerFile(file);
      doc.stamp = fileStamp(file);
    },
    fileStamp,
    rememberHandle(file, handle) {
      fileHandles.set(handleKey(file), handle);
    },
    registerFile(file) {
      const key = "web-file://" + file.name;
      app.files.set(key, file);
      return key;
    },
    fontsReady() {
      return Fonts.builtinsLoaded();
    },
    closeDoc(doc) {
      const at = app.docs.indexOf(doc);
      if (at < 0) return;
      app.docs.splice(at, 1);
      forgetDocPixels(doc);
      if (app.doc === doc) setDoc(app.docs[Math.min(at, app.docs.length - 1)] || null);
      else emit("document", app.doc);
    },
    // What was written can be older than the document: what was typed during a long
    // write is still to save
    markSaved(doc, savedId) {
      doc.savedId = savedId === undefined ? doc.history[doc.historyIndex].id : savedId;
      emit("saved", doc);
      emit("history");
    },
    closeAll() {
      app.docs = [];
      app.doc = null;
    },
  };

  // Some layers of a page drawn on their own, as the page draws them: folders with their
  // opacity and style, clipped layers on their base. Those whose folder isn't among them
  // are drawn as if at the top of the page.
  const paintAlone = (doc, layers) => {
    const ids = new Set(layers.map((layer) => layer.id));
    const all = doc.state.layers;
    const alone = layers.map((layer) => {
      const at = all.indexOf(layer);
      let under = at - 1;
      while (under >= 0 && all[under].clipping && all[under].kind !== "group") under--;
      const lonely = layer.clipping && (under < 0 || !ids.has(all[under].id));
      const free = layer.group && !ids.has(layer.group);
      return lonely || free ? Object.assign({}, layer, lonely ? { clipping: false } : null, free ? { group: null } : null) : layer;
    });
    const canvas = newCanvas(doc.width, doc.height);
    paintDoc(Object.assign({}, doc, { state: Object.assign({}, doc.state, { layers: alone }), live: null, liveTransform: null, preview: null }), canvas.getContext("2d"));
    return canvas;
  };

  // The nearest folder above `id` that stays
  const outsideOf = (id, gone, layers) => {
    while (id && gone.has(id)) {
      const parent = layers.find((layer) => layer.id === id);
      id = parent ? parent.group || null : null;
    }
    return id || null;
  };

  const flattenLayers = (doc, layers) => {
    const canvas = newCanvas(doc.width, doc.height);
    const ctx = canvas.getContext("2d");
    layers.forEach((layer) => {
      const visual = visualOf(layer, doc);
      if (!visual) return;
      if (visual.under) drawUnder(ctx, visual, 0, 0, layer.opacity === undefined ? 1 : layer.opacity);
      ctx.globalAlpha = layer.opacity === undefined ? 1 : layer.opacity;
      ctx.globalCompositeOperation = BLENDS[layer.blend] || "source-over";
      ctx.drawImage(visual.canvas, visual.x, visual.y);
    });
    return canvas;
  };

  /* --------------------- what ExtendScript answers --------------------- */

  // Sizes are in points here, which are pixels only at 72 ppi
  const typeUnitAt = (resolution) => (resolution === 72 ? "pixelsUnit" : "pointsUnit");

  // Photoshop honours the unit a style was saved with: a size in pixels is that many pixels on
  // every page. What the panel sends is brought to points, the only unit a layer is kept in.
  const pointsPerTypeUnit = (unit, resolution) => (unit === "pixelsUnit" ? 72 / resolution : unit === "millimetersUnit" ? 72 / 25.4 : 1);
  const lengthsInPoints = (textStyle, factor) => {
    if (textStyle && factor !== 1) TEXT_LENGTHS.forEach((field) => {
      if (typeof textStyle[field] === "number") textStyle[field] *= factor;
    });
    return textStyle;
  };
  const paramsInPoints = (params, resolution) => {
    const out = clone(params);
    const factor = pointsPerTypeUnit(out.typeUnit, resolution);
    delete out.typeUnit;
    ((out.layerText && out.layerText.textStyleRange) || []).forEach((range) => lengthsInPoints(range.textStyle, factor));
    return out;
  };

  // Photoshop always names the unit, and the style window can't open without one. It is
  // this model's unit, whatever the style the layer was made from said.
  const textProps = (layer, doc) => Object.assign(clone(layer.params), { typeUnit: typeUnitAt(doc.resolution) });

  // As Photoshop's host: a stroke switched off keeps its settings but isn't applied
  const strokeToApply = (stroke) => {
    if (!stroke || stroke.enabled === false || (!(stroke.size > 0) && stroke.enabled !== true)) return null;
    return Object.assign(clone(stroke), { enabled: true, size: stroke.size || 3 });
  };

  const newTextLayer = (doc, params, stroke, name) => ({
    id: newId(),
    kind: "text",
    name: (name || (params.layerText.textKey || "").replace(/[\r\n]+/g, " ")).substring(0, 60),
    visible: true,
    opacity: 1,
    blend: "normal",
    group: null,
    params,
    stroke: strokeToApply(stroke),
  });

  // New text goes right above the active layer, in its folder, or first in the selected
  // folder; on top of the document with nothing selected. With "Always place new text on
  // top", it goes first in the active layer's folder, or on top of the document. The list
  // runs from the bottom of the stack up, with a folder's own entry right above its content.
  const textSpotOf = (doc) => {
    const active = doc.state.layers.find((layer) => layer.id === doc.state.activeIds[doc.state.activeIds.length - 1]);
    if (!active) return {};
    if (active.kind === "group") return { folder: active.id };
    return app.textDefaults.textOnTop ? { folder: active.group || null } : { folder: active.group || null, above: active.id };
  };
  const addNewTexts = (layers, created, spot) => {
    const anchor = spot.above ? layers.findIndex((layer) => layer.id === spot.above) : -1;
    let at = anchor >= 0 ? anchor + 1 : spot.folder ? layers.findIndex((layer) => layer.id === spot.folder) : -1;
    let folder = spot.folder || null;
    // Never under TypeR Clean, whose white would hide it
    const clean = layers.findIndex((layer) => layer.clean);
    if (at >= 0 && clean >= 0 && at <= clean) {
      at = clean + 1;
      folder = layers[clean].group || null;
    }
    if (at < 0) return layers.concat(created);
    created.forEach((layer) => { layer.group = folder; });
    return layers.slice(0, at).concat(created, layers.slice(at));
  };

  const isPunctuationOnly = (text) => typeof text === "string" && /^[!?.,;:'"()\[\]~\-\u00A1\u00AB\u00BB\u00BF\u060C\u061B\u061F\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u203C\u203D\u2047\u2048\u2049\u3001\u3002\u301C\uFF01\uFF1F\uFF5E]+$/.test(text.replace(/[\s\u00A0\u202F]+/g, ""));

  // Style option: a line made only of punctuation ("?!", "!!") is set larger
  const scaleForPunctuation = (style, text) => {
    const scale = style ? parseFloat(style.punctuationOnlyScale) : 0;
    if (!(scale > 1) || !isPunctuationOnly(text)) return style;
    const scaled = clone(style);
    const ranges = (scaled.textProps && scaled.textProps.layerText && scaled.textProps.layerText.textStyleRange) || [];
    ranges.forEach((range) => {
      ["size", "impliedFontSize", "leading", "impliedLeading"].forEach((field) => {
        if (range.textStyle && typeof range.textStyle[field] === "number") range.textStyle[field] *= scale;
      });
    });
    return scaled;
  };

  // The style's text with its own runs, ready to be a layer
  const sameStyle = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  const rangesFromStyles = (styles, fallback) => {
    const ranges = [];
    styles.forEach((style, at) => {
      const last = ranges[ranges.length - 1];
      if (last && sameStyle(last.textStyle, style)) last.to = at + 1;
      else ranges.push({ from: at, to: at + 1, textStyle: clone(style) });
    });
    return ranges.length ? ranges : [{ from: 0, to: 0, textStyle: clone(fallback) }];
  };
  // A typed change keeps the style of the text around it. What's new takes the style of
  // the letter before it, or of the first one at the very start.
  const rangesAfterEdit = (lt, after) => {
    const before = String(lt.textKey || "");
    const ranges = lt.textStyleRange;
    const styleAt = (index) => (ranges.find((range) => index >= range.from && index < range.to) || ranges[index < 0 ? 0 : ranges.length - 1]).textStyle;
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = 0;
    while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
    const styles = [];
    for (let at = 0; at < after.length; at++) {
      if (at < start) styles.push(styleAt(at));
      else if (at >= after.length - end) styles.push(styleAt(before.length - (after.length - at)));
      else styles.push(styleAt(start > 0 ? start - 1 : 0));
    }
    return rangesFromStyles(styles, ranges[0].textStyle);
  };
  // The same styles, on a text that now has a line break for each of its lines
  const rangesOfLines = (lines, fallback) => {
    const styles = [];
    lines.forEach((line, index) => {
      if (index) styles.push(styles[styles.length - 1] || fallback);
      line.runs.forEach((run) => Array.from({ length: run.text.length }).forEach(() => styles.push(run.style)));
    });
    return rangesFromStyles(styles, fallback);
  };

  // resolution: the page's, for a style the panel sends (its sizes are in its own unit).
  // Without it the sizes are a layer's own, in points already. sizeOverride is in points.
  const paramsFromStyle = (style, text, richTextRuns, sizeOverride, resolution) => {
    const source = style && style.textProps ? style.textProps : { layerText: {} };
    const params = resolution ? paramsInPoints(source, resolution) : clone(source);
    const toPoints = resolution ? pointsPerTypeUnit(source.typeUnit, resolution) : 1;
    const lt = params.layerText;
    const base = (lt.textStyleRange && lt.textStyleRange[0] && lt.textStyleRange[0].textStyle) || { fontPostScriptName: "WildjessNormal", fontName: "Wildjess", fontStyleName: "Normal", size: 34, autoLeading: true, color: { red: 0, green: 0, blue: 0 } };
    if (sizeOverride) {
      base.size = sizeOverride;
      if (base.impliedFontSize != null) base.impliedFontSize = sizeOverride;
    }
    const clean = String(text || "").replace(/\r\n?/g, "\r").replace(/\n/g, "\r");
    lt.textKey = clean;
    const ranges = [];
    if (Array.isArray(richTextRuns) && richTextRuns.length) {
      let at = 0;
      richTextRuns.forEach((run) => {
        const length = (run.text || "").length;
        if (!length) return;
        const style = clone(base);
        if (run.textStyle) Object.assign(style, lengthsInPoints(clone(run.textStyle), toPoints));
        if (run.bold) style.syntheticBold = true;
        if (run.italic) style.syntheticItalic = true;
        ranges.push({ from: at, to: at + length, textStyle: style });
        at += length;
      });
    }
    lt.textStyleRange = ranges.length ? ranges : [{ from: 0, to: clean.length, textStyle: base }];
    lt.paragraphStyleRange = [{ from: 0, to: clean.length, paragraphStyle: Object.assign({ alignment: "center", autoLeadingPercentage: 1.2 }, lt.paragraphStyleRange && lt.paragraphStyleRange[0] && lt.paragraphStyleRange[0].paragraphStyle) }];
    lt.textShape = [{ textType: "point", orientation: "horizontal" }];
    return params;
  };

  const wrapWords = (text, base, width, resolution) => {
    const size = sizePxOf(base, resolution);
    setRunFont(measureCtx, base, size);
    const out = [];
    String(text || "").split(/\r\n?|\n/).forEach((paragraph) => {
      let line = "";
      paragraph.split(/\s+/).filter(Boolean).forEach((word) => {
        const candidate = line ? line + " " + word : word;
        if (line && measureCtx.measureText(candidate).width > width) {
          out.push(line);
          line = word;
        } else line = candidate;
      });
      out.push(line);
    });
    return out;
  };

  // Moves a layer so the middle of its ink lands on (x, y)
  const centreLayer = (doc, params, stroke, x, y) => {
    const box = layoutLayer({ params, stroke }, doc).box;
    params.layerText.textClickPoint.horizontal += ((x - box.xMid) / doc.width) * 100;
    params.layerText.textClickPoint.vertical += ((y - box.yMid) / doc.height) * 100;
  };

  const classicParams = (doc, data, bounds) => {
    const padding = Number(data.padding) || 0;
    const params = paramsFromStyle(scaleForPunctuation(data.style, data.text), data.text, data.richTextRuns, data.textSizeOverride, doc.resolution);
    const base = params.layerText.textStyleRange[0].textStyle;
    // The enlarged text must not wrap in a box sized for the selection
    const enlarged = !data.textSizeOverride && data.style && isPunctuationOnly(data.text) ? Math.max(1, parseFloat(data.style.punctuationOnlyScale) || 1) : 1;
    const lines = wrapWords(data.text, base, Math.max(24, bounds.width * 0.9 - padding * 2) * enlarged, doc.resolution);
    if (!data.richTextRuns) {
      params.layerText.textKey = lines.join("\r");
      params.layerText.textStyleRange = [{ from: 0, to: params.layerText.textKey.length, textStyle: base }];
    }
    params.layerText.textClickPoint = { horizontal: (bounds.xMid / doc.width) * 100, vertical: (bounds.top / doc.height) * 100 };
    centreLayer(doc, params, null, bounds.xMid, bounds.yMid);
    return params;
  };

  const shapeRows = (selection, samples) => {
    const b = selection.bounds;
    const rows = [];
    for (let i = 0; i < samples; i++) {
      const y = samples <= 1 ? 0.5 : i / (samples - 1);
      if (!selection.mask) {
        rows.push({ y, left: 0, right: 1, width: 1 });
        continue;
      }
      const m = selection.mask;
      const row = Math.min(m.height - 1, Math.max(0, Math.round(y * (m.height - 1))));
      let first = -1;
      let last = -1;
      for (let x = 0; x < m.width; x++) {
        if (m.data[row * m.width + x]) {
          if (first === -1) first = x;
          last = x;
        }
      }
      if (first === -1) rows.push({ y, left: 0.5, right: 0.5, width: 0 });
      else rows.push({ y, left: first / m.width, right: (last + 1) / m.width, width: (last + 1 - first) / m.width });
    }
    return { scan: "web", bounds: b, rows, fallback: false };
  };

  const layerSignature = (doc, layer) => (layer ? layer.id + ":" + doc.historyIndex : "");

  const activeLayerSnapshot = (doc, layer) => ({
    layerId: layer.id,
    bounds: boxOf(layer, doc),
    textType: "point",
    textProps: textProps(layer, doc),
    stroke: layer.stroke || { enabled: false, size: 0, opacity: 100, position: "outer", color: { r: 255, g: 255, b: 255 } },
  });

  const host = {
    nativeAlert(data) {
      emit("alert", data);
      return "";
    },
    nativeConfirm(data) {
      return new Promise((resolve) => emit("confirm", Object.assign({}, data, { answer: (ok) => resolve(ok ? "1" : "0") })));
    },
    getUserFonts() {
      return JSON.stringify({ fonts: Fonts.list().map(({ name, postScriptName, family, style }) => ({ name, postScriptName, family, style })) });
    },
    reloadUserFonts() {
      return host.getUserFonts();
    },
    getHotkeyPressed() {
      // The panel only asks every 75 ms: a key tapped in between still counts
      const k = app.keysSeen;
      app.keysSeen = Object.assign({}, app.keys);
      if (app.keysMuted && app.keysMuted()) return "a";
      let out = "a";
      if (k.meta) out += "WINa";
      if (k.ctrl) out += "CTRLa";
      if (k.alt) out += "ALTa";
      if (k.shift) out += "SHIFTa";
      if (k.key) out += k.key + "a";
      return out;
    },
    getActiveLayerText() {
      const doc = app.doc;
      const layer = activeTextLayer(doc);
      return layer ? JSON.stringify(activeLayerSnapshot(doc, layer)) : "";
    },
    getSelectedTextLayers() {
      if (!app.doc) return JSON.stringify({ error: "doc" });
      return JSON.stringify({ layers: selectedTextLayers().map((layer) => ({ id: layer.id })) });
    },
    getCurrentSelection() {
      const doc = app.doc;
      if (!doc) return JSON.stringify({ error: "doc" });
      const selection = doc.state.selection;
      if (!selection) return JSON.stringify({ error: "noSelection" });
      if (selection.bounds.width * selection.bounds.height < 200) return JSON.stringify({ error: "smallSelection" });
      return JSON.stringify(selection.bounds);
    },
    getTypeRSelectionSnapshot() {
      const doc = app.doc;
      const selection = doc && doc.state.selection;
      return JSON.stringify({ selection: selection ? selection.bounds : null, layers: selectedTextLayers().map((layer) => ({ id: layer.id })) });
    },
    getActiveLayerTextIfChanged(data) {
      const doc = app.doc;
      const layer = activeTextLayer(doc);
      if (!layer) return JSON.stringify({ error: "layer", signature: "" });
      const signature = layerSignature(doc, layer);
      if (data && data.signature === signature) return JSON.stringify({ unchanged: true, signature });
      return JSON.stringify(Object.assign(activeLayerSnapshot(doc, layer), { signature }));
    },
    getActiveTextLayerGeometry() {
      const doc = app.doc;
      const layer = activeTextLayer(doc);
      if (!layer) return JSON.stringify({ error: "layer", signature: "" });
      return JSON.stringify({ layerId: layer.id, bounds: boxOf(layer, doc), signature: layerSignature(doc, layer) });
    },
    getTypeRPanelSnapshot(data) {
      const selection = JSON.parse(host.getTypeRSelectionSnapshot());
      return JSON.stringify({ activeLayer: JSON.parse(host.getActiveLayerTextIfChanged(data || {})), selection: selection.selection, layers: selection.layers });
    },
    startSelectionMonitoring() { return ""; },
    stopSelectionMonitoring() {
      app.monitor.lastBounds = null;
      return "";
    },
    deselectDocumentSelection() {
      if (!app.doc) return "doc";
      ops.deselect();
      app.monitor.lastBounds = null;
      return "";
    },
    getSelectionChanged() {
      const doc = app.doc;
      const key = doc ? "web:" + doc.id : "";
      if (app.monitor.documentKey !== key) {
        app.monitor.documentKey = key;
        app.monitor.lastBounds = null;
        return JSON.stringify({ documentChanged: true, documentKey: key });
      }
      const selection = doc && doc.state.selection;
      if (!selection) return JSON.stringify({ noChange: true, shiftKey: app.keys.shift, documentKey: key });
      const b = selection.bounds;
      const last = app.monitor.lastBounds;
      if (last && ["left", "top", "right", "bottom"].every((side) => Math.abs(last[side] - b[side]) <= 5)) {
        return JSON.stringify({ noChange: true, shiftKey: app.keys.shift, documentKey: key });
      }
      app.monitor.lastBounds = b;
      const item = Object.assign({ shiftKey: app.keys.shift, documentKey: key }, b);
      return JSON.stringify(Object.assign({ multiSelection: [item] }, item));
    },
    // TextShapeR's star: the text as it shows, a paragraph's lines as its box sets them
    async getRenderedTextLines() {
      const doc = app.doc;
      const layer = activeTextLayer(doc);
      if (!layer) return JSON.stringify({ error: "layer" });
      await linesReady([layer]);
      return JSON.stringify({ text: shownLines(layer.params.layerText, doc.resolution) });
    },
    // Ctrl or Alt + the star: every text layer that shows, its folders included
    async getAllRenderedTextLines() {
      const doc = app.doc;
      if (!doc) return JSON.stringify({ error: "document" });
      const byId = new Map(doc.state.layers.map((layer) => [layer.id, layer]));
      const layers = doc.state.layers.filter((layer) => layer.kind === "text" && chainOf(layer, byId).visible);
      await linesReady(layers);
      const entries = [];
      layers.forEach((layer) => {
        try {
          entries.push({ layerId: layer.id, text: shownLines(layer.params.layerText, doc.resolution) });
        } catch (readError) {
          // A text that can't be laid out teaches nothing
        }
      });
      return JSON.stringify({ entries });
    },
    // TextShapeR learns from the line breaks of finished pages: each text layer as it shows,
    // a paragraph's lines as its box sets them (Photoshop turns it into point text for this).
    // No path means the current page; an open file is read as it is now, unsaved work included.
    async scanTextShapeRTraining(path) {
      const raw = String(path || "");
      try {
        let resolution;
        let layers;
        const fromDoc = (doc) => {
          const byId = new Map(doc.state.layers.map((layer) => [layer.id, layer]));
          const pathOf = (layer) => {
            const names = [layer.name || ""];
            for (let id = layer.group; id && byId.get(id); id = byId.get(id).group) names.unshift(byId.get(id).name || "");
            return names.join(" / ");
          };
          resolution = doc.resolution;
          layers = doc.state.layers.filter((layer) => layer.kind === "text").map((layer) => ({
            layerId: layer.id, name: layer.name || "", path: pathOf(layer), visible: chainOf(layer, byId).visible, params: layer.params,
          }));
        };
        if (!raw) {
          if (!app.doc) return JSON.stringify({ error: "document" });
          fromDoc(app.doc);
        } else {
          if (!/\.ps[db]$/i.test(raw)) return JSON.stringify({ error: "badPath" });
          const file = app.files.get(raw);
          if (!file) return JSON.stringify({ error: "notFound" });
          const open = app.docs.find((doc) => doc.path === raw && doc.stamp === fileStamp(file));
          if (open) fromDoc(open);
          else ({ resolution, layers } = await window.TypeRPSD.readText(await file.arrayBuffer()));
        }
        await linesReady(layers);
        const entries = layers.map((layer, index) => {
          const entry = { layerId: layer.layerId || index + 1, name: layer.name, layerPath: layer.path, visible: layer.visible !== false, text: "" };
          try {
            entry.text = shownLines(layer.params.layerText, resolution);
          } catch (readError) {
            entry.error = "readFailed";
          }
          return entry;
        });
        return JSON.stringify({ entries });
      } catch (scanError) {
        return JSON.stringify({ error: "scanFailed" });
      }
    },
    getCurrentSelectionShape(data) {
      const doc = app.doc;
      if (!doc) return JSON.stringify({ error: "doc" });
      const selection = doc.state.selection;
      if (!selection) return JSON.stringify({ error: "noSelection" });
      return JSON.stringify(shapeRows(selection, Math.max(5, parseInt(data && data.samples, 10) || 17)));
    },
    getActiveLayerBubbleShape(data) {
      const doc = app.doc;
      if (!doc) return JSON.stringify({ error: "doc" });
      const layer = activeTextLayer(doc);
      if (!layer) return JSON.stringify({ error: "layer" });
      if (doc.state.selection) return JSON.stringify({ error: "hasSelection" });
      const box = boxOf(layer, doc);
      const scan = floodSelect(doc, box.xMid, box.yMid, parseInt(data && data.tolerance, 10) || 20);
      if (scan.bounds.width * scan.bounds.height < 200 || scan.bounds.width * scan.bounds.height > box.width * box.height * 60) return JSON.stringify({ error: "noBubble" });
      return JSON.stringify(shapeRows(scan, Math.max(5, parseInt(data && data.samples, 10) || 21)));
    },
    selectLayerById(id) {
      ops.selectLayer(parseInt(id, 10));
      return "";
    },
    setActiveLayerText(data) {
      const doc = app.doc;
      if (!doc || !activeTextLayer(doc)) return "layer";
      // As in Photoshop, every text layer selected takes the change, not only the active one,
      // all in one history step
      const changed = new Map();
      selectedTextLayers(doc).forEach((layer) => {
        const box = boxOf(layer, doc);
        // A style-only apply has no text of its own: each layer keeps its text
        const text = data.text || layer.params.layerText.textKey;
        const style = data.style ? scaleForPunctuation(data.style, text) : { textProps: layer.params };
        const kept = data.preserveActiveTextSize ? layer.params.layerText.textStyleRange[0].textStyle.size : null;
        const params = paramsFromStyle(style, text, data.richTextRuns, kept, data.style ? doc.resolution : 0);
        params.layerText.textClickPoint = clone(layer.params.layerText.textClickPoint);
        if (boxShape(layer.params.layerText)) params.layerText.textShape = clone(layer.params.layerText.textShape);
        else centreLayer(doc, params, null, box.xMid, box.yMid);
        const changes = { params, raster: null, stroke: (data.style && strokeToApply(data.style.stroke)) || layer.stroke };
        if (data.text) Object.assign(changes, { source: String(data.text), name: String(data.text).replace(/[\r\n]+/g, " ").substring(0, 60) });
        changed.set(layer.id, changes);
      });
      const layers = doc.state.layers.map((item) => (changed.has(item.id) ? Object.assign({}, item, changed.get(item.id)) : item));
      commitState(doc, "TyperTools Change", { layers });
      return "";
    },
    setTextShapeRLayerText(data) {
      const doc = app.doc;
      const layer = activeTextLayer(doc);
      if (!doc || !layer) return "layer";
      const box = boxOf(layer, doc);
      const base = layer.params.layerText.textStyleRange[0].textStyle;
      const params = paramsFromStyle({ textProps: layer.params }, data.text, data.richTextRuns, base.size);
      params.layerText.textClickPoint = clone(layer.params.layerText.textClickPoint);
      const kept = boxShape(layer.params.layerText);
      if (!kept || layer.rotated || layer.warp) {
        centreLayer(doc, params, null, box.xMid, box.yMid);
        commitState(doc, "TyperTools Change", { layers: replaceLayer(doc, layer, { params, raster: null }) });
        return "";
      }
      // A text box keeps its frame: the new lines are laid in it, and it only grows, around
      // its middle, when a line is wider than it or the lines need more height
      const lt = params.layerText;
      const shape = clone(kept);
      const before = frameOf(layer, doc);
      let widest = 0;
      relativeLayout(Object.assign({}, lt, { textShape: [{ textType: "point" }] }), doc.resolution).lines.forEach((line) => { widest = Math.max(widest, line.m.advance); });
      if (widest + 1 > shape.box.width) {
        const grow = widest + 1 - shape.box.width;
        shape.box.width += grow;
        lt.textClickPoint.horizontal -= (grow / 2 / doc.width) * 100;
      }
      if (!shape.box.autoHeight) {
        const full = relativeLayout(Object.assign({}, lt, { textShape: [{ textType: "box", box: { width: shape.box.width, height: 1, autoHeight: true } }] }), doc.resolution);
        if (full.contentHeight > shape.box.height) {
          const grow = full.contentHeight - shape.box.height;
          shape.box.height += grow;
          lt.textClickPoint.vertical -= (grow / 2 / doc.height) * 100;
        }
      }
      lt.textShape = [shape];
      let next = Object.assign({}, layer, { params, raster: null, manualBreaks: true });
      // A box that follows its text's height keeps its middle where it was
      if (shape.box.autoHeight) {
        const after = frameOf(next, doc);
        next = shifted(next, 0, (before.top + before.bottom) / 2 - (after.top + after.bottom) / 2, doc);
      }
      commitState(doc, "TyperTools Change", { layers: replaceLayer(doc, layer, next) });
      return "";
    },
    setSelectedTextLayers(data) {
      const doc = app.doc;
      if (!doc) return "doc";
      const items = (data && data.items) || [];
      if (items.length < 2) return "layer";
      let layers = doc.state.layers;
      items.forEach((item) => {
        const layer = layers.find((entry) => String(entry.id) === String(item.layerId));
        if (!layer) return;
        const box = boxOf(layer, doc);
        const text = item.text || layer.params.layerText.textKey;
        // As on one layer: the style's stroke, each layer's own size if asked, and its box
        const kept = item.preserveActiveTextSize ? layer.params.layerText.textStyleRange[0].textStyle.size : null;
        const params = paramsFromStyle(item.style ? scaleForPunctuation(item.style, text) : { textProps: layer.params }, text, item.richTextRuns, kept, item.style ? doc.resolution : 0);
        params.layerText.textClickPoint = clone(layer.params.layerText.textClickPoint);
        if (boxShape(layer.params.layerText)) params.layerText.textShape = clone(layer.params.layerText.textShape);
        else centreLayer(doc, params, null, box.xMid, box.yMid);
        const stroke = (item.style && strokeToApply(item.style.stroke)) || layer.stroke;
        layers = layers.map((entry) => (entry.id === layer.id ? Object.assign({}, entry, { params, raster: null, stroke }) : entry));
      });
      commitState(doc, "TyperTools Change", { layers });
      return "";
    },
    createTextLayerInSelection(data) {
      const doc = app.doc;
      if (!doc) return "doc";
      const selection = doc.state.selection;
      if (!selection) return "noSelection";
      if (selection.bounds.width * selection.bounds.height < 200) return "smallSelection";
      let size = null;
      if (data.preserveActiveTextSize) {
        const layer = activeTextLayer(doc);
        if (!layer) return "sizeSource";
        size = layer.params.layerText.textStyleRange[0].textStyle.size;
      }
      const params = classicParams(doc, Object.assign({}, data, { textSizeOverride: size }), selection.bounds);
      const layer = newTextLayer(doc, params, data.style && data.style.stroke, data.text);
      layer.source = String(data.text || "");
      commitState(doc, "TyperTools Paste", { layers: addNewTexts(doc.state.layers, [layer], textSpotOf(doc)), activeIds: [layer.id] });
      emit("paste", { classic: true, layers: [layer] });
      return "";
    },
    createTextLayersInStoredSelections(data) {
      const doc = app.doc;
      if (!doc) return "doc";
      const created = [];
      const texts = (data && data.texts) || [];
      const selections = (data && data.selections) || [];
      const styles = (data && data.styles) || [];
      selections.forEach((bounds, i) => {
        if (texts[i] == null) return;
        const params = classicParams(doc, { text: texts[i], style: styles[i] || styles[0], padding: data.padding }, rectFrom(bounds.left, bounds.top, bounds.right, bounds.bottom));
        created.push(newTextLayer(doc, params, styles[i] && styles[i].stroke, texts[i]));
      });
      commitState(doc, "TyperTools Paste", { layers: addNewTexts(doc.state.layers, created, textSpotOf(doc)), activeIds: created.map((layer) => layer.id), selection: selectionAfterPaste(doc) });
      emit("paste", { classic: true, layers: created });
      return "";
    },
    alignCapture() {
      const doc = app.doc;
      if (!doc) return JSON.stringify({ error: "doc" });
      const selected = selectedTextLayers(doc);
      const texts = selected.map((layer) => ({
        id: layer.id,
        index: doc.state.layers.indexOf(layer),
        box: boxOf(layer, doc),
        sizePixels: sizePxOf(layer.params.layerText.textStyleRange[0].textStyle, doc.resolution),
      }));
      const bubbles = [];
      if (doc.state.selection) {
        const s = doc.state.selection;
        bubbles.push({ selectionBounds: { left: s.bounds.left, top: s.bounds.top, right: s.bounds.right, bottom: s.bounds.bottom }, rawPath: ringsToPath(s.rings), textIds: texts.map((text) => text.id) });
      } else {
        texts.forEach((text) => {
          const scan = floodSelect(doc, text.box.xMid, text.box.yMid, 20);
          const b = scan.bounds;
          let known = bubbles.find((bubble) => bubble.selectionBounds.left === b.left && bubble.selectionBounds.top === b.top && bubble.selectionBounds.right === b.right && bubble.selectionBounds.bottom === b.bottom);
          if (!known) {
            known = { selectionBounds: { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, rawPath: ringsToPath(scan.rings), textIds: [] };
            bubbles.push(known);
          }
          known.textIds.push(text.id);
        });
      }
      return JSON.stringify({ documentId: doc.id, width: doc.width, height: doc.height, resolution: doc.resolution, texts, bubbles });
    },
    alignTextLayerToSelection(data) {
      const doc = app.doc;
      if (!doc) return "doc";
      const selected = selectedTextLayers(doc);
      if (!selected.length) return "layer";
      const placements = {};
      ((data && data.placements) || []).forEach((placement) => {
        if (placement && placement.rect) placements[placement.id] = placement.rect;
      });
      let layers = doc.state.layers;
      selected.forEach((layer) => {
        const box = boxOf(layer, doc);
        let rect = placements[layer.id] || (doc.state.selection && doc.state.selection.bounds);
        if (!rect) {
          const scan = floodSelect(doc, box.xMid, box.yMid, 20);
          if (scan.bounds.width * scan.bounds.height > box.width * box.height * 60) return;
          rect = scan.bounds;
        }
        const moved = centredOn(layer, doc, rect.xMid, rect.yMid);
        layers = layers.map((entry) => (entry.id === layer.id ? moved : entry));
      });
      commitState(doc, "TyperTools Align", { layers });
      emit("align");
      return "";
    },
    alignTextLayersToDoubleBubble() {
      const doc = app.doc;
      if (!doc) return "doc";
      const selected = selectedTextLayers(doc);
      if (selected.length < 2 || selected.length !== doc.state.activeIds.length) return "doubleBubbleLayers";
      const rects = doubleBubbleRects(doc, selected);
      if (typeof rects === "string") return rects;
      const moved = new Map(selected.map((layer, i) => [layer.id, centredOn(layer, doc, rects[i].xMid, rects[i].yMid)]));
      commitState(doc, "TyperTools Align", { layers: doc.state.layers.map((layer) => moved.get(layer.id) || layer) });
      emit("align");
      return "";
    },
    changeActiveLayerTextSize(value) {
      const doc = app.doc;
      if (!doc) return "doc";
      const selected = selectedTextLayers(doc);
      if (!selected.length) return "layer";
      let layers = doc.state.layers;
      selected.forEach((layer) => {
        const box = boxOf(layer, doc);
        const params = clone(layer.params);
        const lt = params.layerText;
        // The step applies to the displayed size; the other runs, a fixed leading and
        // a box frame follow by the same ratio
        const first = lt.textStyleRange[0].textStyle;
        const shown = first.impliedFontSize || first.size;
        const ratio = Math.max(1, shown + Number(value)) / shown;
        lt.textStyleRange.forEach((range) => {
          const style = range.textStyle;
          style.size = Math.max(0.1, (style.impliedFontSize || style.size) * ratio);
          if (style.impliedFontSize != null) style.impliedFontSize = style.size;
          if (style.autoLeading || style.leading == null) return;
          style.leading = Math.max(0.1, (style.impliedLeading || style.leading) * ratio);
          if (style.impliedLeading != null) style.impliedLeading = style.leading;
        });
        const shape = boxShape(lt);
        if (shape) {
          shape.box.width = Math.max(1, shape.box.width * ratio);
          shape.box.height = Math.max(1, shape.box.height * ratio);
        }
        centreLayer(doc, params, null, box.xMid, box.yMid);
        layers = layers.map((entry) => (entry.id === layer.id ? Object.assign({}, entry, { params, raster: null }) : entry));
      });
      commitState(doc, "TyperTools Resize", { layers });
      return "";
    },
    toggleCleaningLayers() {
      const doc = app.doc;
      if (!doc) return "";
      const hasClean = doc.state.layers.some((layer) => layer.clean);
      if (hasClean) commitState(doc, "Toggle Clean", { layers: doc.state.layers.map((layer) => (layer.clean ? Object.assign({}, layer, { visible: layer.visible === false }) : layer)) });
      return "";
    },
    undoLastTyperChange() {
      const doc = app.doc;
      if (!doc) return "doc";
      for (let i = doc.historyIndex; i > 0; i--) {
        if (doc.history[i].name === "TyperTools Change") {
          ops.jump(i - 1);
          return "";
        }
      }
      return "none";
    },
    openFile(path) {
      const raw = String(path);
      const known = app.docs.find((doc) => doc.path === raw);
      const done = (doc) => JSON.stringify({ ok: true, path: raw, documentKey: "web:" + doc.id });
      if (known) {
        setDoc(known);
        return done(known);
      }
      const name = raw.split(/[\\/]/).pop();
      const file = app.files.get(raw);
      const fail = (error) => JSON.stringify({ ok: false, path: raw, error: String((error && error.message) || error) });
      if (file) return ops.openBlob(file, name, raw).then(done, fail);
      if (raw.indexOf("/typer/app/assets/") === 0) {
        return ops.loadImage((window.TypeRPhotoshop.panelBase || "panel/") + "assets/" + raw.split("/").pop(), name, raw).then(done, fail);
      }
      // At startup, the page may be among the documents still coming back from last time
      const restoring = window.TypeRSession && window.TypeRSession.restoring();
      if (restoring) return restoring.catch(() => null).then(() => host.openFile(raw));
      return fail("Open this file first: it is not in the browser yet.");
    },
    // A document already open is read as it is now, unsaved work included, as in Photoshop
    async scanPsdFonts(path) {
      const file = app.files.get(path);
      if (!file) return JSON.stringify({ error: "notFound", file: path });
      const open = app.docs.find((doc) => doc.path === path && doc.stamp === fileStamp(file));
      try {
        const { resolution, layers } = open
          ? { resolution: open.resolution, layers: open.state.layers.filter((layer) => layer.kind === "text") }
          : await window.TypeRPSD.readText(await file.arrayBuffer());
        // By the time the panel shows them, each font is known to be here or missing
        await Fonts.ready(layers.flatMap(({ params }) => params.layerText.textStyleRange.map((range) => range.textStyle.fontPostScriptName)));
        return JSON.stringify({
          file: path,
          layers: layers.map(({ name, params, stroke }) => ({
            layerName: name,
            antiAlias: params.layerText.antiAlias || "antiAliasSmooth",
            typeUnit: typeUnitAt(resolution),
            paragraphStyle: params.layerText.paragraphStyleRange[0].paragraphStyle,
            stroke: stroke || null,
            runs: params.layerText.textStyleRange.map((range) => range.textStyle),
          })),
        });
      } catch (error) {
        return JSON.stringify({ error: "scanFailed", file: path, message: String((error && error.message) || error) });
      }
    },
    ensureWandSampleAll() {
      if (app.tool !== "wand" || app.sampleAll) return JSON.stringify({ wasOff: false });
      app.sampleAll = true;
      emit("options");
      return JSON.stringify({ wasOff: true });
    },
    smartPasteSelectionProbe() {
      const doc = app.doc;
      if (!doc) return JSON.stringify({ error: "doc" });
      const toolId = { wand: "magicWandTool", rectangle: "marqueeRectTool", ellipse: "marqueeEllipTool", lasso: "lassoTool", polygon: "polySelTool", move: "moveTool", brush: "paintbrushTool", eraser: "eraserTool", magicEraser: "magicEraserTool", text: "typeCreateOrEditTool" }[app.tool] || "";
      const selection = doc.state.selection;
      const b = selection && selection.bounds;
      return JSON.stringify({ documentId: doc.id, tool: toolId, bounds: b ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom } : null });
    },
    smartPasteCapture(data) {
      const doc = app.doc;
      if (!doc) return JSON.stringify({ error: "doc" });
      const selection = doc.state.selection;
      if (!selection || selection.bounds.width < 8 || selection.bounds.height < 8) return JSON.stringify({ error: "noSelection" });
      const b = selection.bounds;
      const result = {
        documentId: doc.id,
        width: doc.width,
        height: doc.height,
        resolution: doc.resolution,
        selectionBounds: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
        histograms: [],
        rawPath: null,
        activeTextSize: null,
      };
      // A click whose selection leaks into the page, as in TypeR's Legacy host: the panel is
      // told so, and asks again with the polygon of a disc around the click (data.local) for
      // the outline of the selection inside it. The text then goes around the click.
      const trigger = data && data.trigger;
      const clicked = !!trigger && ((trigger.source === "wand" && typeof trigger.x === "number") ||
        (trigger.source === "manual" && trigger.lastSource === "wand" && !!trigger.lastClick));
      const local = data && Array.isArray(data.local) && data.local.length >= 3 ? data.local : null;
      const sw = b.right - b.left;
      const sh = b.bottom - b.top;
      const leak = (sw >= doc.width * 0.94 && sh >= Math.min(doc.width * 0.7, doc.height * 0.6)) || (sh >= doc.height * 0.96 && sw >= doc.width * 0.6);
      if (!local && clicked && trigger.source !== "rectangle" && leak) {
        result.leak = true;
        return JSON.stringify(result);
      }
      let read = selection;
      if (local) {
        const disc = polygonSelection(doc, local);
        read = disc ? combineSelections(doc, selection, disc, "intersect") : null;
        if (!read) return JSON.stringify({ error: "shape" });
      }
      result.histograms = selectionHistograms(doc, read);
      if (data && data.keepSize) {
        const layer = activeTextLayer(doc);
        if (layer) {
          result.activeTextSize = layer.params.layerText.textStyleRange[0].textStyle.size;
          result.activeTextUnit = typeUnitAt(doc.resolution);
        }
      }
      if (!data || !data.trigger || data.trigger.source !== "rectangle") result.rawPath = ringsToPath(read.rings);
      return JSON.stringify(result);
    },
    smartPasteMeasure(data) {
      const doc = app.doc;
      if (!doc) return JSON.stringify({ error: "doc" });
      const requests = (data && data.requests) || [];
      const measure = () => JSON.stringify(requests.map((request) => {
        const lt = paramsInPoints(request.params, doc.resolution).layerText;
        const key = String(lt.textKey || "").replace(/\r$/, "");
        const runs = splitLines(Object.assign({}, lt, { textKey: key }))[0] || [];
        const m = measureRuns(runs, doc.resolution);
        const cx = doc.width / 2;
        const cy = doc.height / 2;
        const x = cx - m.advance / 2;
        return { bounds: { left: x + m.inkLeft, top: cy - m.ascent, right: x + m.inkRight, bottom: cy + m.descent } };
      }));
      const names = [];
      requests.forEach((request) => (request.params.layerText.textStyleRange || []).forEach((range) => names.push(range.textStyle.fontPostScriptName)));
      if (names.every((name) => !name || (Fonts.get(name) && Fonts.get(name).ready) || Fonts.isMissing(name))) return measure();
      return Fonts.ready(names).then(measure);
    },
    smartPasteCommit(data) {
      const doc = app.doc;
      if (!doc) return JSON.stringify({ error: "doc" });
      if (!data || String(doc.id) !== String(data.documentId)) return JSON.stringify({ error: "doc" });
      const before = doc.history[doc.historyIndex].id;
      let layers = doc.state.layers;
      const created = [];
      let spot = textSpotOf(doc);
      (data.sessions || []).forEach((session) => {
        const plan = session.plan;
        if (plan.autoClean && plan.cleanupPolygon) {
          const op = { t: "poly", polygon: plan.cleanupPolygon, color: plan.fillRGB || { red: 255, green: 255, blue: 255 }, inset: plan.cleanupInset || 0 };
          layers = paintOnCleanLayer(layers, () => op);
        }
        const layer = newTextLayer(doc, paramsInPoints(session.text.params, doc.resolution), session.text.stroke, session.layerName);
        layer.source = session.layerName || "";
        created.push(layer);
        layers = addNewTexts(layers, [layer], spot);
        // The next one goes above this one
        if (spot.above) spot = { folder: layer.group, above: layer.id };
      });
      commitState(doc, "TyperTools Smart Paste", { layers, selection: selectionAfterPaste(doc), activeIds: created.length ? [created[created.length - 1].id] : doc.state.activeIds });
      emit("selection", doc.state.selection);
      emit("paste", { sessions: data.sessions, layers: created, source: data.source });
      return JSON.stringify({ layerIds: created.map((layer) => layer.id), history: { documentId: doc.id, before, after: doc.history[doc.historyIndex].id } });
    },
    getHistorySnapshot() {
      const doc = app.doc;
      if (!doc) return JSON.stringify(null);
      return JSON.stringify({ documentId: doc.id, current: doc.history[doc.historyIndex].id, states: doc.history.map((entry) => entry.id) });
    },
    restoreHistoryState(data) {
      const doc = app.doc;
      if (!doc) return JSON.stringify({ error: "doc" });
      if (!data || String(doc.id) !== String(data.documentId)) return JSON.stringify({ error: "doc" });
      const index = doc.history.findIndex((entry) => String(entry.id) === String(data.state));
      if (index < 0) return JSON.stringify({ error: "history" });
      ops.jump(index);
      return JSON.stringify({ ok: true });
    },
    replaySelectionTrigger(trigger) {
      const doc = app.doc;
      if (!doc) return JSON.stringify({ error: "doc" });
      if (!trigger) return JSON.stringify({ error: "trigger" });
      let selection = null;
      if (trigger.source === "wand") {
        selection = floodSelect(doc, trigger.x, trigger.y, (trigger.options && trigger.options.tolerance) || app.tolerance);
        selection.trigger = trigger;
      } else if (trigger.source === "rectangle" && typeof trigger.left === "number") {
        selection = makeSelection({ rect: rectFrom(trigger.left, trigger.top, trigger.right, trigger.bottom), trigger });
      } else return JSON.stringify({ error: "trigger" });
      commitState(doc, "Select Again", { selection });
      emit("selection", selection);
      // Photoshop reports it too: the panel knows its own replay and ignores it
      setTimeout(() => firePanelEvent(EVENT_SET, descriptorFor(selection)), 0);
      return JSON.stringify({ ok: true });
    },
  };

  // Calls the panel makes all the time: they do not count as work
  const QUIET_CALL = /^\s*(getHotkeyPressed|getTypeRPanelSnapshot|getTypeRSelectionSnapshot|getActiveLayerTextIfChanged|getSelectionChanged|getCurrentSelection|getSelectedTextLayers|getUserFonts|getHistorySnapshot|ensureWandSampleAll|smartPasteSelectionProbe|stopSelectionMonitoring|startSelectionMonitoring)\s*\(/;

  // A smart paste doesn't hold clicks back: the panel queues the ones made meanwhile
  const SMART_PASTE_CALL = /^\s*(smartPasteCapture|smartPasteMeasure|smartPasteCommit|restoreHistoryState)\s*\(/;

  // ExtendScript's evalScript: the panel sends a line of JavaScript
  const evalScript = (script, callback) => {
    const source = String(script);
    const quiet = QUIET_CALL.test(source) || SMART_PASTE_CALL.test(source);
    if (!quiet) {
      app.pendingActions++;
      app.lastAction = Date.now();
    }
    let result;
    try {
      // eslint-disable-next-line no-new-func
      result = new Function("host", "with (host) { return (" + source + "\n); }")(host);
    } catch (error) {
      if (!(error instanceof ReferenceError)) console.warn("TypeR demo:", error, source.slice(0, 120));
      result = "";
    }
    const finish = (value) => {
      if (!quiet) {
        app.pendingActions = Math.max(0, app.pendingActions - 1);
        app.lastAction = Date.now();
      }
      if (typeof callback === "function") {
        callback(value === undefined || value === null ? "undefined" : typeof value === "string" ? value : String(value));
      }
    };
    if (result && typeof result.then === "function") result.then(finish, () => finish(""));
    else setTimeout(() => finish(result), 0);
  };

  window.TypeRPhotoshop = {
    app,
    ops,
    FX_ORDER,
    FX_DEFAULTS,
    fxDefault,
    effectsOn,
    flatVisual,
    BLENDS,
    grayOf,
    maskOn,
    vectorOn,
    host,
    evalScript,
    drawTextLayer,
    paintDoc,
    canvasFits,
    visualOf,
    boxOf,
    frameOf,
    turnOf,
    turnedFrame,
    lineModel,
    lineWidth,
    layoutLayer,
    caretLines,
    surfaceOf,
    isDirty,
    newRaster,
    newCurves,
    newId,
    newCanvas,
    paintStroke,
    imageResolution,
    withResolution,
    wrapWords,
    cssFont,
    languageTagOf,
    TEXT_LANGUAGES,
    DEFAULT_TEXT_LANGUAGE,
    textLanguageNumber,
    textLanguageName,
    drawOp,
    renderGradient,
    labRange,
    setActiveDoc: (doc) => setDoc(doc),
    paramsFromStyle: (style, text, runs, size) => paramsFromStyle(style, text, runs, size),
    newTextLayer: (doc, params, stroke, name) => newTextLayer(doc, params, stroke, name),
    familyOf: (layers, id) => familyOf(layers, id),
    fillOf,
    strokeOutside,
    strokeReach,
    ringOf,
    innerRingOf,
    lockOf,
    groupVisual: (group, doc) => groupVisual(group, doc),
    centredOn,
    get fonts() { return Fonts.list(); },
    extensionId: EXTENSION_ID,
    activeTextLayer,
    on(listener) {
      app.listeners.add(listener);
      return () => app.listeners.delete(listener);
    },
    addPanelListener(type, listener, obj) {
      (app.panelListeners[type] = app.panelListeners[type] || []).push({ listener, obj });
    },
    removePanelListener(type, listener) {
      if (app.panelListeners[type]) app.panelListeners[type] = app.panelListeners[type].filter((entry) => entry.listener !== listener);
    },
    resetPanelListeners() {
      app.panelListeners = {};
    },
    announce(type) {
      emit(type);
    },
    warnStorage() {
      emit("storage-full");
    },
    setKeys(keys) {
      Object.assign(app.keys, keys);
      if (keys.key) app.keysSeen = Object.assign({}, app.keys);
      else ["meta", "ctrl", "alt", "shift"].forEach((name) => {
        if (keys[name]) app.keysSeen[name] = true;
      });
    },
    clearKeys() {
      app.keys = { meta: false, ctrl: false, alt: false, shift: false, key: "" };
      app.keysSeen = Object.assign({}, app.keys);
    },
    muteKeys(test) {
      app.keysMuted = test;
    },
    keyName(event) {
      const key = event.key;
      if (!key || key === "Meta" || key === "Control" || key === "Alt" || key === "Shift" || key === "OS") return "";
      if (key === " ") return "SPACE";
      if (key === "+") return "PLUS";
      if (key === "-") return "MINUS";
      if (key === "=") return "EQUAL";
      if (key === "/") return "DIVIDE";
      if (key === "*") return "MULTIPLY";
      if (key === "Escape") return "ESCAPE";
      // Read as Settings records it: Option+L types "¬", AZERTY's 1 types "&", and both are still L and 1
      const code = event.keyCode;
      if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90)) return String.fromCharCode(code);
      // Option+L on a Mac types "¬", and a Cyrillic layout "д": the shortcut means the physical letter
      if (/^Key[A-Z]$/.test(event.code || "") && (key === "Dead" || (key.length === 1 && key.charCodeAt(0) > 127))) return event.code.slice(3);
      return key.toUpperCase();
    },
  };
})();
