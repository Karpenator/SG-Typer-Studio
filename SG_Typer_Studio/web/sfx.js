// SFX in SG Typer Studio: a sound effect typed once and laid out letter by letter. Its settings
// (the word, the font, the path the letters follow, how much chance moves them) live on its
// folder as `sfx`; its letters are ordinary text layers inside the folder, one per letter, as
// a letterer would make them by hand in Photoshop. So a PSD keeps working in Photoshop, and
// whatever is done to a letter here or there (moved, turned, resized, retyped) is read back
// from the letter itself and kept when the SFX is laid out again.

(function () {
  "use strict";

  const PS = window.TypeRPhotoshop;
  const { app, ops } = PS;
  const Fonts = window.TypeRFonts;
  const App = () => window.TypeRApp;
  const T = (text) => (window.TypeRApp ? window.TypeRApp.T(text) : text);
  const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (all, key) => (values[key] === undefined ? all : values[key]));
  const $ = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const deg = (radians) => (radians * 180) / Math.PI;
  const round = (value, step = 100) => Math.round(value * step) / step;
  const wrapAngle = (radians) => Math.atan2(Math.sin(radians), Math.cos(radians));
  const STORE = "typer.web.sfx";
  const STORE_PRESETS = "typer.web.sfx.presets";
  const STORE_BANK = "typer.web.sfx.bank";
  const MAX_LETTERS = 60;

  /* ------------------------------- the settings ------------------------------- */

  const WHITE = { r: 255, g: 255, b: 255 };
  const BLACK = { r: 0, g: 0, b: 0 };
  const BASE = {
    v: 1,
    text: "BOOM",
    font: { ps: "Bangers-Regular", family: "Bangers", style: "Regular" },
    size: 60,
    color: { red: 0, green: 0, blue: 0 },
    // Where it is: the middle of its path on the page, the path's angle, and a scale for it all
    origin: [0, 0],
    angle: 0,
    scale: 1,
    // `length`: the letters fill that much of the path, their size follows. 0: their size sets it.
    path: { kind: "line", bend: 35, amp: 30, waves: 1, step: 25, length: 0, points: null },
    spacing: -12,
    follow: true,
    curve: { kind: "flat", amount: 40, peak: 0 },
    perspective: 0,
    bulge: 0,
    source: null,
    chaos: 100,
    jitter: { rotate: 12, size: 12, shift: 10, stretch: 6, skew: 0 },
    zigzag: 0,
    // Every letter turned by this much, the path staying as it is
    turn: 0,
    slant: 0,
    seed: 1,
    stack: "left",
    mode: "cut",
    stroke: { enabled: true, size: 4, color: WHITE, outer: { size: 0, color: BLACK } },
    hollow: false,
    relief: { enabled: false, dx: 5, dy: 5, color: BLACK },
    echo: { enabled: false, count: 2, scale: 125, opacity: 35 },
    noPunctuation: false,
    letters: [],
    next: 1,
  };
  const PATHS = ["line", "arc", "wave", "stairs", "vertical", "circle", "free"];
  const CURVES = ["flat", "grow", "shrink", "peak"];
  const STACKS = ["left", "right", "alternate"];

  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  // A recipe from another version, a preset or a file: every setting there, nothing foreign
  const merged = (base, value) => {
    const out = {};
    Object.keys(base).forEach((key) => {
      const own = value ? value[key] : undefined;
      if (isObject(base[key]) && isObject(own)) out[key] = merged(base[key], own);
      else if (own !== undefined && (typeof own === typeof base[key] || base[key] === null || own === null || Array.isArray(base[key]))) out[key] = clone(own);
      else out[key] = clone(base[key]);
    });
    return out;
  };
  const normal = (value) => {
    const out = merged(BASE, value);
    if (value && isObject(value.source)) out.source = { at: Array.isArray(value.source.at) ? value.source.at.slice(0, 2) : [0, 0], amount: Number(value.source.amount) || 0, radial: Number(value.source.radial) || 0 };
    if (!Array.isArray(out.letters)) out.letters = [];
    out.letters = out.letters.filter((letter) => letter && typeof letter.ch === "string").map((letter) => ({ key: Number(letter.key) || 0, ch: letter.ch, o: isObject(letter.o) ? letter.o : null, lock: isObject(letter.lock) ? letter.lock : null }));
    out.next = Math.max(out.next || 1, ...out.letters.map((letter) => letter.key + 1));
    if (!PATHS.includes(out.path.kind)) out.path.kind = "line";
    if (!CURVES.includes(out.curve.kind)) out.curve.kind = "flat";
    if (!STACKS.includes(out.stack)) out.stack = "left";
    if (out.mode !== "fusion") out.mode = "cut";
    return out;
  };

  // What a preset keeps: how the SFX looks, not where it is nor what it says
  const LOOK_KEYS = ["size", "spacing", "follow", "curve", "perspective", "bulge", "chaos", "jitter", "zigzag", "turn", "slant", "stack", "mode", "stroke", "hollow", "relief", "echo", "noPunctuation"];
  const lookOf = (recipe, withFont) => {
    const out = {};
    LOOK_KEYS.forEach((key) => { out[key] = clone(recipe[key]); });
    out.path = { kind: recipe.path.kind === "free" ? "line" : recipe.path.kind, bend: recipe.path.bend, amp: recipe.path.amp, waves: recipe.path.waves, step: recipe.path.step };
    if (recipe.source) out.source = { amount: recipe.source.amount, radial: recipe.source.radial };
    if (withFont) {
      out.font = clone(recipe.font);
      out.color = clone(recipe.color);
    }
    return out;
  };
  const withLook = (recipe, look) => {
    const out = clone(recipe);
    Object.keys(look).forEach((key) => {
      if (key === "path") {
        // A path drawn by hand stays, unless the preset asks for a shape of its own
        const keepFree = recipe.path.kind === "free" && recipe.path.points && (!look.path.kind || look.path.kind === "line");
        out.path = Object.assign({}, out.path, look.path, { length: recipe.path.length, points: keepFree ? recipe.path.points : null, kind: keepFree ? "free" : look.path.kind || recipe.path.kind });
      } else if (key === "source") out.source = look.source ? Object.assign({ at: out.source ? out.source.at : out.origin.slice() }, out.source, look.source) : null;
      else out[key] = clone(look[key]);
    });
    if (out.path.kind === "free" && !out.path.points) out.path.kind = "line";
    if (!("source" in look)) out.source = null;
    return normal(out);
  };

  // Built in: one per kind of sound, as the guides sort them. Fonts stay the user's own.
  const BUILTIN = [
    { id: "impact", name: "Impact", look: { size: 70, spacing: -18, chaos: 100, jitter: { rotate: 14, size: 16, shift: 10, stretch: 8, skew: 0 }, zigzag: 6, slant: 0, curve: { kind: "peak", amount: 35, peak: 1 }, stack: "left", mode: "cut", stroke: { enabled: true, size: 5, color: WHITE, outer: { size: 0, color: BLACK } }, hollow: false, path: { kind: "line" } } },
    { id: "explosion", name: "Explosion", look: { size: 90, spacing: -14, chaos: 120, jitter: { rotate: 18, size: 18, shift: 12, stretch: 10, skew: 4 }, zigzag: 0, slant: 0, curve: { kind: "flat", amount: 40, peak: 0 }, stack: "left", mode: "fusion", stroke: { enabled: true, size: 6, color: WHITE, outer: { size: 4, color: BLACK } }, source: { amount: 55, radial: 55 }, path: { kind: "arc", bend: 25 } } },
    { id: "shrill", name: "Shrill, shaky", look: { size: 40, spacing: 4, chaos: 100, jitter: { rotate: 9, size: 6, shift: 22, stretch: 4, skew: 6 }, zigzag: 10, slant: 0, curve: { kind: "flat", amount: 40, peak: 0 }, stack: "left", mode: "cut", stroke: { enabled: true, size: 3, color: WHITE, outer: { size: 0, color: BLACK } }, path: { kind: "wave", amp: 18, waves: 2 } } },
    { id: "whisper", name: "Whisper", look: { size: 26, spacing: 12, chaos: 60, jitter: { rotate: 5, size: 4, shift: 8, stretch: 0, skew: 0 }, zigzag: 0, slant: 0, curve: { kind: "shrink", amount: 30, peak: 0 }, stack: "left", mode: "cut", stroke: { enabled: true, size: 3, color: WHITE, outer: { size: 0, color: BLACK } }, path: { kind: "line" } } },
    { id: "motion", name: "Motion", look: { size: 50, spacing: -8, chaos: 50, jitter: { rotate: 4, size: 4, shift: 4, stretch: 4, skew: 0 }, zigzag: 0, slant: -14, curve: { kind: "grow", amount: 55, peak: 0 }, perspective: 0, stack: "right", mode: "cut", stroke: { enabled: true, size: 4, color: WHITE, outer: { size: 0, color: BLACK } }, path: { kind: "arc", bend: 18 } } },
    { id: "small", name: "Small sound in a bubble", look: { size: 30, spacing: -14, chaos: 90, jitter: { rotate: 12, size: 10, shift: 10, stretch: 4, skew: 0 }, zigzag: 4, slant: 0, curve: { kind: "flat", amount: 40, peak: 0 }, stack: "left", mode: "cut", stroke: { enabled: false, size: 3, color: WHITE, outer: { size: 0, color: BLACK } }, path: { kind: "line" } } },
    { id: "subtitle", name: "Subtitle", look: { size: 16, spacing: 2, chaos: 0, jitter: { rotate: 0, size: 0, shift: 0, stretch: 0, skew: 0 }, zigzag: 0, slant: 0, curve: { kind: "flat", amount: 0, peak: 0 }, stack: "left", mode: "cut", stroke: { enabled: true, size: 3, color: WHITE, outer: { size: 0, color: BLACK } }, hollow: false, relief: { enabled: false, dx: 5, dy: 5, color: BLACK }, echo: { enabled: false, count: 2, scale: 125, opacity: 35 }, path: { kind: "line" } } },
  ];

  const readStore = (key, fallback) => {
    try {
      const value = JSON.parse(window.localStorage.getItem(key));
      return value === null || value === undefined ? fallback : value;
    } catch (error) {
      return fallback;
    }
  };
  const writeStore = (key, value) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      PS.warnStorage();
    }
  };

  // The settings the next SFX starts from: the last ones used
  let defaults = normal(readStore(STORE, null));
  defaults.letters = [];
  defaults.source = null;
  const keepDefaults = (recipe) => {
    const look = lookOf(recipe, true);
    defaults = withLook(defaults, look);
    defaults.text = recipe.text;
    defaults.letters = [];
    defaults.source = null;
    writeStore(STORE, Object.assign(clone(defaults), { source: recipe.source ? { at: [0, 0], amount: recipe.source.amount, radial: recipe.source.radial } : null }));
  };
  // The SFX guide's practice leaves the settings as they were before it
  const defaultsSnapshot = () => ({ kept: clone(defaults), stored: readStore(STORE, null) });
  const restoreDefaults = (snapshot) => {
    if (!snapshot) return;
    defaults = snapshot.kept;
    if (snapshot.stored) writeStore(STORE, snapshot.stored);
    else {
      try {
        window.localStorage.removeItem(STORE);
      } catch (error) {
        // Nothing was kept before, nothing to take back
      }
    }
  };
  const storedSource = () => {
    const stored = readStore(STORE, null);
    return stored && stored.source ? { amount: stored.source.amount, radial: stored.source.radial } : null;
  };

  /* --------------------------------- letters --------------------------------- */

  const graphemes = (text) => {
    if (window.Intl && Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
    return Array.from(text);
  };
  const PUNCTUATION = /^[!?.,;:…¡¿'"«»“”‘’()\-–—~！？。、]+$/u;
  const isShown = (recipe, letter) => Boolean(letter.ch.trim()) && !(recipe.noPunctuation && PUNCTUATION.test(letter.ch));

  // A new word keeps the letters it shares with the old one, with their keys, their changes
  // and their pins: typing an O in BOM doesn't throw the other letters again
  const relink = (recipe, text) => {
    const old = recipe.letters;
    const chars = graphemes(String(text).replace(/[\r\n\t]+/g, " ")).slice(0, MAX_LETTERS);
    const n = old.length;
    const m = chars.length;
    const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) table[i][j] = old[i].ch === chars[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
    const out = [];
    // Letters dropped just before a new one: the new one takes the place of the first, so a
    // letter retyped in place stays where it was put
    let freed = [];
    let i = 0;
    let j = 0;
    while (j < m) {
      if (i < n && old[i].ch === chars[j]) {
        out.push(old[i]);
        freed = [];
        i++;
        j++;
      } else if (i < n && table[i + 1][j] >= table[i][j + 1]) {
        freed.push(old[i]);
        i++;
      } else {
        const reused = freed.shift();
        out.push(reused ? Object.assign({}, reused, { ch: chars[j] }) : { key: recipe.next++, ch: chars[j], o: null, lock: null });
        j++;
      }
    }
    recipe.letters = out;
    recipe.text = chars.join("");
    return recipe;
  };

  // Chance that doesn't change unless asked: the same seed and the same letter give the same
  // throw, each setting its own (`channel`). Between -1 and 1.
  const chance = (seed, key, channel) => {
    let h = (Math.imul(seed | 0, 374761393) + Math.imul(key | 0, 668265263) + Math.imul(channel, 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return (h / 4294967295) * 2 - 1;
  };

  /* -------------------------------- measuring -------------------------------- */

  const languageOf = () => app.textDefaults.language;
  const styleFor = (font, size, sx, sy, color) => ({
    fontPostScriptName: font.ps,
    fontName: font.family,
    fontStyleName: font.style,
    size,
    impliedFontSize: size,
    autoLeading: true,
    tracking: 0,
    horizontalScale: round(sx * 100),
    verticalScale: round(sy * 100),
    ligature: false,
    textLanguage: languageOf(),
    color: { red: color.red, green: color.green, blue: color.blue },
  });
  const paramsFor = (doc, ch, style, anchor) => ({
    layerText: {
      textKey: ch,
      antiAlias: "antiAliasSmooth",
      textClickPoint: { horizontal: (anchor[0] / doc.width) * 100, vertical: (anchor[1] / doc.height) * 100 },
      textStyleRange: [{ from: 0, to: ch.length, textStyle: style }],
      paragraphStyleRange: [{ from: 0, to: ch.length, paragraphStyle: { alignment: "center", autoLeadingPercentage: 1.2 } }],
      textShape: [{ textType: "point", orientation: "horizontal" }],
    },
  });
  // A letter's ink at 100 pt, around its anchor: everything else is a multiple of it
  const measures = new Map();
  const measure = (doc, font, ch) => {
    const key = [Fonts.generation, doc.resolution, font.ps, ch].join("|");
    let found = measures.get(key);
    if (found) return found;
    if (measures.size > 3000) measures.clear();
    const layer = { kind: "text", params: paramsFor(doc, ch, styleFor(font, 100, 1, 1, { red: 0, green: 0, blue: 0 }), [0, 0]) };
    const box = PS.layoutLayer(layer, doc).relative.box;
    const empty = !(box.width > 0);
    const em = (100 * doc.resolution) / 72;
    found = empty ? { w: em * 0.4, h: em * 0.7, cx: 0, cy: -em * 0.35 } : { w: box.width, h: box.height, cx: box.left + box.width / 2, cy: box.top + box.height / 2 };
    measures.set(key, found);
    return found;
  };

  /* ------------------------------- the layout -------------------------------- */

  const curveAt = (curve, k, n, t) => {
    const amount = clamp(curve.amount, 0, 150) / 100;
    if (curve.kind === "grow") return 1 - amount / 2 + amount * t;
    if (curve.kind === "shrink") return 1 + amount / 2 - amount * t;
    if (curve.kind === "peak") {
      const peak = clamp(Math.round(curve.peak), 0, Math.max(0, n - 1));
      const far = Math.max(peak, n - 1 - peak, 1);
      return 1 - amount / 2 + amount * (1 - Math.abs(k - peak) / far);
    }
    return 1;
  };

  // A path, `length` long, around (0, 0): where a point `s` along it is, and which way it goes
  const polyline = (points) => {
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    return { points, lengths, total: lengths[lengths.length - 1] };
  };
  const pathFor = (path, length, unit) => {
    const L = Math.max(1, length);
    if (path.kind === "arc") {
      const phi = (clamp(path.bend, -100, 100) / 100) * Math.PI * 1.2;
      if (Math.abs(phi) > 1e-3) {
        const R = L / phi;
        const lift = (R * (1 - Math.cos(phi / 2))) / 2;
        return (s) => {
          const a = (s - L / 2) / R;
          return { x: R * Math.sin(a), y: R * (1 - Math.cos(a)) - lift, a };
        };
      }
    }
    if (path.kind === "wave") {
      const amp = (clamp(path.amp, 0, 200) / 100) * unit;
      const waves = clamp(path.waves, 0.25, 8);
      const k = (2 * Math.PI * waves) / L;
      return (s) => ({ x: s - L / 2, y: -amp * Math.sin(k * s), a: Math.atan(-amp * k * Math.cos(k * s)) });
    }
    if (path.kind === "vertical") return (s) => ({ x: 0, y: s - L / 2, a: 0 });
    if (path.kind === "circle") {
      const R = L / (2 * Math.PI);
      return (s) => {
        const a = (2 * Math.PI * (s - L / 2)) / L;
        return { x: R * Math.sin(a), y: -R * Math.cos(a), a };
      };
    }
    if (path.kind === "free" && path.points && path.points.length > 1) {
      const line = polyline(path.points);
      const f = line.total > 0 ? line.total / L : 1;
      return (s) => {
        const at = clamp(s * f, 0, line.total);
        let i = 1;
        while (i < line.lengths.length - 1 && line.lengths[i] < at) i++;
        const a0 = line.points[i - 1];
        const a1 = line.points[i];
        const span = line.lengths[i] - line.lengths[i - 1] || 1;
        const u = (at - line.lengths[i - 1]) / span;
        // The way it goes, over a little more than one segment: a hand-drawn path wobbles
        const before = line.points[Math.max(0, i - 2)];
        const after = line.points[Math.min(line.points.length - 1, i + 1)];
        return { x: a0[0] + (a1[0] - a0[0]) * u, y: a0[1] + (a1[1] - a0[1]) * u, a: Math.atan2(after[1] - before[1], after[0] - before[0]) };
      };
    }
    return (s) => ({ x: s - L / 2, y: 0, a: 0 });
  };
  const freeLength = (path) => (path.kind === "free" && path.points && path.points.length > 1 ? polyline(path.points).total : 0);

  // The page from the SFX's own frame, and back
  const toPage = (recipe, x, y) => {
    const c = Math.cos(rad(recipe.angle));
    const s = Math.sin(rad(recipe.angle));
    return [recipe.origin[0] + recipe.scale * (c * x - s * y), recipe.origin[1] + recipe.scale * (s * x + c * y)];
  };
  const toLocal = (recipe, x, y) => {
    const c = Math.cos(rad(recipe.angle));
    const s = Math.sin(rad(recipe.angle));
    const dx = (x - recipe.origin[0]) / recipe.scale;
    const dy = (y - recipe.origin[1]) / recipe.scale;
    return [c * dx + s * dy, -s * dx + c * dy];
  };

  // Every letter where it goes: in the SFX's frame first (`local`), then on the page
  const layoutOf = (recipe, doc) => {
    const r = recipe;
    const unit = (r.size * doc.resolution) / 72;
    const chaos = clamp(r.chaos, 0, 200) / 100;
    const J = r.jitter;
    const shown = [];
    r.letters.forEach((letter, index) => {
      if (isShown(r, letter)) shown.push({ letter, index, k: shown.length, spaceBefore: 0 });
      else if (!letter.ch.trim() && shown.length) shown[shown.length - 1].spaceAfter = (shown[shown.length - 1].spaceAfter || 0) + 1;
    });
    const n = shown.length;
    const vertical = r.path.kind === "vertical";
    // Readability first: chance moves letters within limits that keep the word legible
    shown.forEach((item) => {
      const { letter, k } = item;
      const t = n > 1 ? k / (n - 1) : 0.5;
      const key = letter.key;
      let f = curveAt(r.curve, k, n, t);
      f *= 1 + (clamp(r.perspective, -100, 100) / 100) * (t - 0.5) * 1.2;
      f *= 1 + (clamp(r.bulge, -100, 100) / 100) * 0.6 * (1 - Math.abs(2 * t - 1) - 0.5);
      f *= 1 + clamp((clamp(J.size, 0, 45) / 100) * chaos * chance(r.seed, key, 1), -0.6, 0.6);
      const stretch = clamp((clamp(J.stretch, 0, 30) / 100) * chaos * chance(r.seed, key, 2), -0.35, 0.35);
      item.size = r.size * Math.max(0.15, f);
      item.sx = 1 + stretch;
      item.sy = 1 - stretch * 0.6;
      item.turn = clamp(clamp(J.rotate, 0, 35) * chaos * chance(r.seed, key, 3) + clamp(r.zigzag, -25, 25) * (k % 2 ? 1 : -1), -40, 40);
      item.shift = clamp((clamp(J.shift, 0, 40) / 100) * chaos * chance(r.seed, key, 4), -0.5, 0.5);
      item.skew = clamp(clamp(r.slant, -25, 25) + clamp(J.skew, 0, 15) * chaos * chance(r.seed, key, 5), -25, 25);
      item.m = measure(doc, r.font, letter.ch);
    });
    const along = (item, fit) => (vertical ? item.m.h * (item.size / 100) * item.sy : item.m.w * (item.size / 100) * item.sx) * fit;
    const gapOf = (fit) => (clamp(r.spacing, -80, 200) / 100) * unit * fit;
    const spaceOf = (fit) => unit * 0.45 * fit;
    const natural = (fit) => {
      let total = 0;
      shown.forEach((item, i) => {
        total += along(item, fit);
        if (i < n - 1) total += gapOf(fit) + (item.spaceAfter || 0) * spaceOf(fit);
      });
      return total;
    };
    const place = (fit) => {
      let total = natural(fit);
      if (r.path.kind === "circle") total += gapOf(fit);
      const at = pathFor(r.path, total, unit * fit);
      let s = 0;
      shown.forEach((item, i) => {
        const w = along(item, fit);
        const p = at(s + w / 2);
        const size = item.size * fit;
        const px = (size * doc.resolution) / 72;
        const turn = r.follow && !vertical ? deg(p.a) : 0;
        const lift = item.shift * px * 0.5;
        let x = p.x + Math.sin(p.a) * lift;
        let y = p.y - Math.cos(p.a) * lift;
        if (r.path.kind === "stairs") y -= (item.k - (n - 1) / 2) * (clamp(r.path.step, -100, 100) / 100) * unit * fit;
        item.pose = { x, y, rot: turn + item.turn + (Number(r.turn) || 0), skew: item.skew, size, sx: item.sx, sy: item.sy };
        s += w;
        if (i < n - 1) s += gapOf(fit) + (item.spaceAfter || 0) * spaceOf(fit);
      });
      return { total, at };
    };
    // The letters fill the path they were given: their size follows
    let fit = 1;
    const wanted = r.path.kind === "free" ? freeLength(r.path) : r.path.kind === "circle" ? 0 : r.path.length;
    const base = natural(1);
    if (wanted > 0 && base > 0) fit = clamp(wanted / base, 0.05, 20);
    let laid = place(fit);
    // A source: the letters grow as they go away from it, and turn to face away from it
    if (r.source && n) {
      const [sx, sy] = toLocal(r, r.source.at[0], r.source.at[1]);
      const far = shown.map((item) => Math.hypot(item.pose.x - sx, item.pose.y - sy));
      const near = Math.min(...far);
      const span = Math.max(...far) - near || 1;
      const amount = clamp(r.source.amount, 0, 150) / 100;
      shown.forEach((item, i) => { item.size *= Math.max(0.2, 1 - amount / 2 + (amount * (far[i] - near)) / span); });
      const again = natural(1);
      if (wanted > 0 && again > 0) fit = clamp(wanted / again, 0.05, 20);
      laid = place(fit);
      const radial = clamp(r.source.radial, 0, 100) / 100;
      shown.forEach((item) => {
        const away = deg(Math.atan2(item.pose.y - sy, item.pose.x - sx)) + 90;
        item.pose.rot += deg(wrapAngle(rad(away - item.pose.rot))) * radial;
      });
    }
    // What was done by hand: a nudge, a turn, a size on top of the layout, or a letter pinned
    const letters = shown.map((item) => {
      const { letter } = item;
      let local = item.pose;
      const o = letter.o;
      if (letter.lock) local = Object.assign({}, local, letter.lock);
      else if (o) local = Object.assign({}, local, { x: local.x + (o.dx || 0), y: local.y + (o.dy || 0), rot: local.rot + (o.rot || 0), size: local.size * (o.scale || 1), sx: local.sx * (o.sx || 1) });
      const font = (letter.lock && letter.lock.font) || (o && o.font) || r.font;
      const color = (letter.lock && letter.lock.color) || (o && o.color) || r.color;
      const center = toPage(r, local.x, local.y);
      return { key: letter.key, ch: letter.ch, k: item.k, local, font, color, center, rot: r.angle + local.rot, skew: local.skew, size: local.size * r.scale, sx: local.sx, sy: local.sy };
    });
    // The path, on the page, for the handles
    const guide = [];
    for (let i = 0; i <= 32; i++) {
      const p = laid.at((laid.total * i) / 32);
      guide.push(toPage(r, p.x, p.y));
    }
    return { letters, guide, total: laid.total, fit, unit };
  };

  /* ------------------------------ letters as layers ------------------------------ */

  const strokeFor = (stroke) => (stroke && stroke.enabled && stroke.size > 0 ? { enabled: true, size: stroke.size, opacity: 100, position: "outer", color: Object.assign({}, stroke.color), outer: stroke.outer && stroke.outer.size > 0 ? { size: stroke.outer.size, color: Object.assign({}, stroke.outer.color) } : undefined } : null);
  const spinOf = (rot, skew) => {
    const c = Math.cos(rad(rot));
    const s = Math.sin(rad(rot));
    const k = Math.tan(rad(skew));
    const spin = [c + k * s, s, -s + k * c, c].map((value) => (Math.abs(value) < 1e-9 ? 0 : value));
    return spin;
  };
  const isStraight = (spin) => Math.abs(spin[0] - 1) < 1e-9 && Math.abs(spin[1]) < 1e-9 && Math.abs(spin[2]) < 1e-9 && Math.abs(spin[3] - 1) < 1e-9;

  const partLayer = (doc, group, pose, part, reuse, look) => {
    const size = round(Math.max(0.5, pose.size));
    const style = styleFor(pose.font, size, pose.sx, pose.sy, look.color || pose.color);
    const m = measure(doc, pose.font, pose.ch);
    const k = size / 100;
    const cx = m.cx * k * pose.sx;
    const cy = m.cy * k * pose.sy;
    const spin = spinOf(pose.rot, pose.skew);
    const center = look.center || pose.center;
    const anchor = [center[0] - (spin[0] * cx + spin[2] * cy), center[1] - (spin[1] * cx + spin[3] * cy)];
    const name = part.role === "letter" ? pose.ch : `${pose.ch} (${part.role}${part.role === "echo" ? " " + part.n : ""})`;
    const layer = PS.newTextLayer(doc, paramsFor(doc, pose.ch, style, anchor), look.stroke, name);
    const straight = isStraight(spin);
    return Object.assign(layer, {
      id: reuse ? reuse.id : layer.id,
      group: group.id,
      visible: reuse ? reuse.visible !== false : true,
      locked: reuse ? reuse.locked : undefined,
      rotated: !straight,
      spin: straight ? null : spin,
      knockout: Boolean(look.knockout),
      opacity: look.opacity === undefined ? 1 : look.opacity,
      sfxPart: part,
    });
  };

  const partKey = (part) => `${part.role}:${part.key}:${part.n || 0}`;
  // The stacking: "left" puts each letter in front of the one on its right, as in ink
  const stacked = (recipe, letters) => {
    const list = letters.slice();
    if (recipe.stack === "left") return list.reverse();
    if (recipe.stack === "alternate") return list.filter((item) => item.k % 2).concat(list.filter((item) => !(item.k % 2)));
    return list;
  };

  // The folder and its letters as the settings say: a new list of the document's layers
  const laidLayers = (doc, group, recipe, layers = doc.state.layers) => {
    const layout = layoutOf(recipe, doc);
    const fusion = recipe.mode === "fusion";
    const stroke = strokeFor(recipe.stroke);
    const old = new Map();
    layers.forEach((layer) => {
      if (layer.group === group.id && layer.sfxPart) old.set(partKey(layer.sfxPart), layer);
    });
    const order = stacked(recipe, layout.letters);
    const parts = [];
    const add = (pose, part, look) => parts.push(partLayer(doc, group, pose, part, old.get(partKey(part)), look));
    if (recipe.echo.enabled) {
      const count = clamp(Math.round(recipe.echo.count), 1, 4);
      const middle = toPage(recipe, 0, 0);
      for (let n = count; n >= 1; n--) {
        const f = Math.pow(clamp(recipe.echo.scale, 50, 250) / 100, n);
        const opacity = clamp(recipe.echo.opacity, 1, 100) / 100 * (1 - (n - 1) / (count + 1));
        order.forEach((pose) => {
          const center = [middle[0] + (pose.center[0] - middle[0]) * f, middle[1] + (pose.center[1] - middle[1]) * f];
          add(Object.assign({}, pose, { size: pose.size * f }), { role: "echo", key: pose.key, n }, { center, opacity, stroke: fusion ? null : stroke });
        });
      }
    }
    if (recipe.relief.enabled) {
      // The relief keeps its direction on the page: the light doesn't turn with the SFX
      const dx = recipe.relief.dx * recipe.scale;
      const dy = recipe.relief.dy * recipe.scale;
      order.forEach((pose) => {
        add(pose, { role: "relief", key: pose.key }, { center: [pose.center[0] + dx, pose.center[1] + dy], color: { red: recipe.relief.color.r, green: recipe.relief.color.g, blue: recipe.relief.color.b }, stroke: fusion ? null : stroke });
      });
    }
    order.forEach((pose) => add(pose, { role: "letter", key: pose.key }, { stroke: fusion ? null : stroke, knockout: !fusion && recipe.hollow }));
    const name = !group.name || /^SFX\b/.test(group.name) ? `SFX ${recipe.text.trim()}`.slice(0, 60) : group.name;
    const next = Object.assign({}, group, {
      kind: "group",
      name,
      blend: "normal",
      sfx: recipe,
      stroke: fusion ? stroke : null,
      knockout: fusion && recipe.hollow,
    });
    const rest = [];
    let at = -1;
    layers.forEach((layer) => {
      if (layer.id === group.id) {
        at = rest.length;
        return;
      }
      if (layer.group === group.id && layer.sfxPart) return;
      rest.push(layer);
    });
    if (at < 0) at = rest.length;
    return rest.slice(0, at).concat(parts, [next], rest.slice(at));
  };

  /* -------------------------- reading the letters back -------------------------- */

  // A letter as it is now, however it got there: its middle, its turn, its size
  const poseOf = (layer, doc) => {
    const lt = layer.params.layerText;
    const style = lt.textStyleRange[0].textStyle;
    const anchor = [(lt.textClickPoint.horizontal / 100) * doc.width, (lt.textClickPoint.vertical / 100) * doc.height];
    const spin = (layer.rotated && layer.spin) || [1, 0, 0, 1];
    const turn = Math.atan2(spin[1], spin[3]);
    const lean = spin[0] * Math.sin(turn) + spin[2] * Math.cos(turn);
    const size = style.impliedFontSize || style.size || 12;
    const sx = (style.horizontalScale === undefined ? 100 : style.horizontalScale) / 100;
    const sy = (style.verticalScale === undefined ? 100 : style.verticalScale) / 100;
    const font = { ps: style.fontPostScriptName, family: style.fontName || style.fontPostScriptName, style: style.fontStyleName || "Regular" };
    const m = measure(doc, font, lt.textKey || " ");
    const k = size / 100;
    const cx = m.cx * k * sx;
    const cy = m.cy * k * sy;
    return { ch: lt.textKey || "", center: [anchor[0] + spin[0] * cx + spin[2] * cy, anchor[1] + spin[1] * cx + spin[3] * cy], rot: deg(turn), skew: deg(Math.atan(lean)), size, sx, sy, font, color: style.color || { red: 0, green: 0, blue: 0 } };
  };

  const roleByName = (layer) => {
    if (/\(relief\)$/.test(layer.name || "")) return { role: "relief" };
    const echo = /\(echo (\d+)\)$/.exec(layer.name || "");
    if (echo) return { role: "echo", n: Number(echo[1]) };
    return { role: "letter" };
  };
  // Which letter layer is which letter: from TypeR's own marks, else (a PSD back from
  // Photoshop) from the order they were stacked in, else by what they say
  const lettersOf = (doc, group, recipe) => {
    const kids = doc.state.layers.filter((layer) => layer.group === group.id && layer.kind === "text");
    const byKey = new Map();
    const marked = kids.filter((layer) => layer.sfxPart);
    if (marked.length) {
      marked.forEach((layer) => { if (layer.sfxPart.role === "letter") byKey.set(layer.sfxPart.key, layer); });
      return byKey;
    }
    const letters = kids.filter((layer) => roleByName(layer).role === "letter");
    const expected = stacked(recipe, layoutOf(recipe, doc).letters);
    if (letters.length === expected.length && letters.every((layer, i) => layer.params.layerText.textKey === expected[i].ch)) {
      letters.forEach((layer, i) => byKey.set(expected[i].key, layer));
      return byKey;
    }
    const free = letters.slice();
    expected.forEach((item) => {
      const at = free.findIndex((layer) => layer.params.layerText.textKey === item.ch);
      if (at >= 0) byKey.set(item.key, free.splice(at, 1)[0]);
    });
    return byKey;
  };

  const sameColor = (a, b) => a && b && a.red === b.red && a.green === b.green && a.blue === b.blue;

  // The settings as the letters are now: what was moved, turned or retyped by hand, here or in
  // Photoshop, becomes part of them. The whole SFX moved, turned or scaled at once is the
  // SFX's own place, angle and scale, not a change to every letter.
  const settled = (doc, group) => {
    const recipe = normal(group.sfx);
    const byKey = lettersOf(doc, group, recipe);
    const kids = doc.state.layers.filter((layer) => layer.group === group.id && layer.kind === "text");
    if (!kids.length) return { recipe, byKey };
    // Letters gone are gone from the word; letters retyped say their new letter
    recipe.letters = recipe.letters.filter((letter) => !isShown(recipe, letter) || byKey.has(letter.key));
    recipe.letters.forEach((letter) => {
      const layer = byKey.get(letter.key);
      if (layer && layer.params.layerText.textKey && layer.params.layerText.textKey !== letter.ch) letter.ch = layer.params.layerText.textKey;
    });
    recipe.text = recipe.letters.map((letter) => letter.ch).join("");
    if (recipe.mode === "fusion" && group.stroke && group.stroke.enabled) {
      recipe.stroke = { enabled: true, size: group.stroke.size, color: Object.assign({}, group.stroke.color), outer: group.stroke.outer ? { size: group.stroke.outer.size, color: Object.assign({}, group.stroke.outer.color) } : { size: 0, color: BLACK } };
    }
    const expected = layoutOf(recipe, doc).letters;
    const pairs = expected.map((e) => ({ e, layer: byKey.get(e.key) })).filter((pair) => pair.layer);
    if (!pairs.length) return { recipe, byKey };
    pairs.forEach((pair) => { pair.a = poseOf(pair.layer, doc); });
    const moved = (pair) => Math.hypot(pair.a.center[0] - pair.e.center[0], pair.a.center[1] - pair.e.center[1]) > 0.8;
    const turned = (pair) => Math.abs(deg(wrapAngle(rad(pair.a.rot - pair.e.rot)))) > 0.2 || Math.abs(pair.a.skew - pair.e.skew) > 0.3;
    const resized = (pair) => Math.abs(pair.a.size / pair.e.size - 1) > 0.006 || Math.abs(pair.a.sx / pair.e.sx - 1) > 0.006;
    const refont = (pair) => pair.a.font.ps !== pair.e.font.ps || !sameColor(pair.a.color, pair.e.color);
    const changed = pairs.filter((pair) => moved(pair) || turned(pair) || resized(pair) || refont(pair));
    if (!changed.length) return { recipe, byKey };
    // All of it, the same way
    if (changed.length === pairs.length && !pairs.some(refont)) {
      const n = pairs.length;
      const ec = [0, 0];
      const ac = [0, 0];
      pairs.forEach(({ e, a }) => {
        ec[0] += e.center[0] / n;
        ec[1] += e.center[1] / n;
        ac[0] += a.center[0] / n;
        ac[1] += a.center[1] / n;
      });
      let dot = 0;
      let cross = 0;
      let ee = 0;
      let aa = 0;
      pairs.forEach(({ e, a }) => {
        const ex = e.center[0] - ec[0];
        const ey = e.center[1] - ec[1];
        const ax = a.center[0] - ac[0];
        const ay = a.center[1] - ac[1];
        dot += ex * ax + ey * ay;
        cross += ex * ay - ey * ax;
        ee += ex * ex + ey * ey;
        aa += ax * ax + ay * ay;
      });
      const turn = n > 1 && ee > 1 ? Math.atan2(cross, dot) : rad(pairs[0].a.rot - pairs[0].e.rot);
      const factor = n > 1 && ee > 1 ? Math.sqrt(aa / ee) : pairs[0].a.size / pairs[0].e.size;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const fits = pairs.every(({ e, a }) => {
        const x = ac[0] + factor * (c * (e.center[0] - ec[0]) - s * (e.center[1] - ec[1]));
        const y = ac[1] + factor * (s * (e.center[0] - ec[0]) + c * (e.center[1] - ec[1]));
        return Math.hypot(x - a.center[0], y - a.center[1]) < 1.5 && Math.abs(deg(wrapAngle(rad(a.rot - e.rot) - turn))) < 0.5 && Math.abs(a.size / e.size / factor - 1) < 0.015 && Math.abs(a.sx / e.sx - 1) < 0.01;
      });
      if (fits) {
        const ox = recipe.origin[0] - ec[0];
        const oy = recipe.origin[1] - ec[1];
        recipe.origin = [ac[0] + factor * (c * ox - s * oy), ac[1] + factor * (s * ox + c * oy)];
        recipe.angle = round(recipe.angle + deg(turn), 10000);
        recipe.scale *= factor;
        if (recipe.path.length) recipe.path.length *= 1;
        if (recipe.source) {
          const sx = recipe.source.at[0] - ec[0];
          const sy = recipe.source.at[1] - ec[1];
          recipe.source.at = [ac[0] + factor * (c * sx - s * sy), ac[1] + factor * (s * sx + c * sy)];
        }
        return { recipe, byKey };
      }
    }
    // A new font or colour for every letter at once is the SFX's own
    if (pairs.length > 1 && pairs.every((pair) => pair.a.font.ps === pairs[0].a.font.ps) && pairs[0].a.font.ps !== recipe.font.ps) {
      recipe.font = Object.assign({}, pairs[0].a.font);
      recipe.letters.forEach((letter) => { if (letter.o) delete letter.o.font; });
    }
    if (pairs.length > 1 && pairs.every((pair) => sameColor(pair.a.color, pairs[0].a.color)) && !sameColor(pairs[0].a.color, recipe.color)) {
      recipe.color = Object.assign({}, pairs[0].a.color);
      recipe.letters.forEach((letter) => { if (letter.o) delete letter.o.color; });
    }
    // Some letters, by hand: each keeps what was done to it
    changed.forEach(({ e, a }) => {
      const letter = recipe.letters.find((item) => item.key === e.key);
      if (!letter) return;
      const [lx, ly] = toLocal(recipe, a.center[0], a.center[1]);
      const [ex, ey] = toLocal(recipe, e.center[0], e.center[1]);
      if (letter.lock) {
        letter.lock = Object.assign({}, letter.lock, { x: lx, y: ly, rot: a.rot - recipe.angle, skew: a.skew, size: a.size / recipe.scale, sx: a.sx, sy: a.sy });
        if (a.font.ps !== recipe.font.ps) letter.lock.font = a.font;
        if (!sameColor(a.color, recipe.color)) letter.lock.color = a.color;
        return;
      }
      const o = Object.assign({ dx: 0, dy: 0, rot: 0, scale: 1, sx: 1 }, letter.o);
      o.dx += lx - ex;
      o.dy += ly - ey;
      o.rot += deg(wrapAngle(rad(a.rot - e.rot)));
      o.scale *= a.size / e.size;
      o.sx *= a.sx / e.sx;
      if (a.font.ps !== recipe.font.ps) o.font = a.font;
      else delete o.font;
      if (!sameColor(a.color, recipe.color)) o.color = a.color;
      else delete o.color;
      letter.o = o;
    });
    return { recipe, byKey };
  };

  /* --------------------------------- doing it --------------------------------- */

  const layerById = (doc, id) => doc.state.layers.find((layer) => layer.id === id) || null;
  // The SFX of a layer: the folder itself, or the one a letter is in
  const sfxOf = (doc, layer) => {
    for (let item = layer; item; item = item.group ? layerById(doc, item.group) : null) {
      if (item.kind === "group" && item.sfx) return item;
    }
    return null;
  };
  const activeSfx = () => {
    const doc = app.doc;
    if (!doc) return null;
    const id = doc.state.activeIds[doc.state.activeIds.length - 1];
    const layer = id !== undefined && layerById(doc, id);
    return layer ? sfxOf(doc, layer) : null;
  };

  // The SFX as it is now, read once and shared by the overlay, the panel and the options bar
  // until something changes: the document's state and its layers are made anew on every change,
  // so the same state, group and fonts mean the same reading. Its recipe and layout are read,
  // never changed: what edits them reads its own with `settled`.
  let reading = null;
  const settledNow = (doc, group) => {
    const gen = Fonts.generation;
    if (reading && reading.doc === doc && reading.state === doc.state && reading.group === group && reading.gen === gen && reading.resolution === doc.resolution && reading.width === doc.width && reading.height === doc.height) return reading;
    const next = { doc, state: doc.state, group, gen, resolution: doc.resolution, width: doc.width, height: doc.height, recipe: null, byKey: null, layout: null, failed: false, boxes: null };
    try {
      const read = settled(doc, group);
      next.recipe = read.recipe;
      next.byKey = read.byKey;
    } catch (error) {
      next.recipe = normal(group.sfx);
      next.failed = true;
    }
    if (!next.failed) {
      try {
        next.layout = layoutOf(next.recipe, doc);
      } catch (error) {
        next.failed = true;
      }
    }
    reading = next;
    return reading;
  };
  // The layout of a recipe: the shared one when it is the shared recipe, else laid out now
  const layoutNow = (recipe, doc) => (reading && reading.recipe === recipe && reading.layout && reading.doc === doc && reading.gen === Fonts.generation && reading.resolution === doc.resolution ? reading.layout : layoutOf(recipe, doc));

  const fontNames = (recipe) => {
    const names = [recipe.font.ps];
    recipe.letters.forEach((letter) => {
      if (letter.o && letter.o.font) names.push(letter.o.font.ps);
      if (letter.lock && letter.lock.font) names.push(letter.lock.font.ps);
    });
    return names;
  };
  const fontsReady = (recipe) => fontNames(recipe).every((name) => {
    const face = Fonts.get(name);
    return (face && face.ready) || Fonts.isMissing(name);
  });
  const ensureFont = (recipe) => {
    const names = [recipe.font.ps];
    recipe.letters.forEach((letter) => {
      if (letter.o && letter.o.font) names.push(letter.o.font.ps);
      if (letter.lock && letter.lock.font) names.push(letter.lock.font.ps);
    });
    return Promise.all(names.map((name) => Fonts.ensure(name).catch(() => null)));
  };

  // The SFX laid out again with these settings, in one step of history (`coalesce` joins the
  // steps of a slider being dragged)
  const apply = (group, recipe, { name = "SFX", coalesce, activeIds, amend, selection } = {}) => {
    const doc = app.doc;
    if (!doc) return null;
    const current = layerById(doc, group.id) || group;
    const layers = laidLayers(doc, current, recipe);
    ops.setLayers(layers, name, { coalesce, activeIds, amend, selection });
    return layerById(doc, group.id);
  };
  const edit = (change, coalesce, name) => {
    const group = activeSfx();
    if (!group) {
      change(defaults);
      defaults = normal(defaults);
      keepDefaults(defaults);
      renderPanel(true);
      renderOptions();
      return;
    }
    const doc = app.doc;
    const { recipe } = settled(doc, group);
    change(recipe);
    const next = normal(recipe);
    keepDefaults(next);
    // Most often the font is there: the change shows at once, in the order it was made
    if (fontsReady(next)) apply(group, next, { name: name || "SFX", coalesce });
    else {
      ensureFont(next).then(() => {
        const fresh = app.doc && layerById(app.doc, group.id);
        if (fresh) apply(fresh, next, { name: name || "SFX", coalesce });
      });
    }
  };

  // A new SFX: the next one at `at`, along `line` ([from, to]) or `points` (a path drawn)
  const newSfx = async ({ at, line, points, text, look, fitRect, amendInto, group: into } = {}) => {
    const doc = app.doc;
    if (!doc) return null;
    let recipe = normal(clone(defaults));
    if (look) recipe = withLook(recipe, look);
    recipe.letters = [];
    recipe.next = 1;
    relink(recipe, text !== undefined ? text : defaults.text || "BOOM");
    recipe.seed = 1 + Math.floor(Math.random() * 100000);
    recipe.scale = 1;
    recipe.angle = 0;
    recipe.path.length = 0;
    recipe.path.points = null;
    if (recipe.path.kind === "free") recipe.path.kind = "line";
    recipe.origin = at ? at.slice() : [doc.width / 2, doc.height / 2];
    if (line) {
      const [a, b] = line;
      recipe.origin = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      recipe.angle = round(deg(Math.atan2(b[1] - a[1], b[0] - a[0])), 100);
      recipe.path.length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (recipe.path.kind === "vertical" || recipe.path.kind === "circle") recipe.path.kind = "line";
      if (Math.abs(recipe.angle) > 90) {
        // Drawn from right to left, a word would read upside down
        recipe.angle = round(recipe.angle + (recipe.angle > 0 ? -180 : 180), 100);
      }
    }
    if (points && points.length > 1) {
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
      recipe.origin = [(left + right) / 2, (top + bottom) / 2];
      recipe.path.kind = "free";
      recipe.path.points = simplify(points, 2).map(([x, y]) => [round(x - recipe.origin[0], 10), round(y - recipe.origin[1], 10)]);
    }
    recipe.source = look && look.source ? { at: [recipe.origin[0], recipe.origin[1] + 120], amount: look.source.amount, radial: look.source.radial } : null;
    await ensureFont(recipe);
    if (fitRect) recipe = fitted(recipe, fitRect, doc);
    const group = into || { id: PS.newId(), kind: "group", name: "SFX", visible: true, opacity: 1, blend: "normal", open: false, group: null };
    let layers = doc.state.layers;
    if (!into) {
      // Above the active layer, in its folder, never inside another SFX
      const active = layers.find((layer) => layer.id === doc.state.activeIds[doc.state.activeIds.length - 1]);
      const anchor = active ? sfxOf(doc, active) || active : null;
      if (anchor) group.group = anchor.kind === "group" && !anchor.sfx ? anchor.id : anchor.group || null;
      const at = anchor ? (anchor.kind === "group" && !anchor.sfx ? layers.indexOf(anchor) : layers.indexOf(anchor) + 1) : layers.length;
      layers = layers.slice(0, at).concat([group], layers.slice(at));
    }
    const laid = laidLayers(doc, group, recipe, layers);
    ops.setLayers(laid, "New SFX", { activeIds: [group.id], amend: amendInto });
    picked = null;
    keepDefaults(recipe);
    return layerById(app.doc, group.id);
  };

  // A path drawn by hand, without its jitter
  const simplify = (points, tolerance) => {
    if (points.length < 3) return points.slice();
    const keep = [points[0]];
    let last = points[0];
    for (let i = 1; i < points.length - 1; i++) {
      if (Math.hypot(points[i][0] - last[0], points[i][1] - last[1]) >= tolerance * 3) {
        keep.push(points[i]);
        last = points[i];
      }
    }
    keep.push(points[points.length - 1]);
    // Smoothed once: a mouse draws in steps
    return keep.map((p, i) => {
      if (i === 0 || i === keep.length - 1) return p;
      return [(keep[i - 1][0] + p[0] * 2 + keep[i + 1][0]) / 4, (keep[i - 1][1] + p[1] * 2 + keep[i + 1][1]) / 4];
    });
  };

  // The box an SFX takes on the page, letters and all
  const extentOf = (layout, doc) => {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    layout.letters.forEach((pose) => {
      const m = measure(doc, pose.font, pose.ch);
      const k = pose.size / 100;
      const w = (m.w * k * pose.sx) / 2;
      const h = (m.h * k * pose.sy) / 2;
      const spin = spinOf(pose.rot, pose.skew);
      [[-w, -h], [w, -h], [w, h], [-w, h]].forEach(([x, y]) => {
        const px = pose.center[0] + spin[0] * x + spin[2] * y;
        const py = pose.center[1] + spin[1] * x + spin[3] * y;
        left = Math.min(left, px);
        top = Math.min(top, py);
        right = Math.max(right, px);
        bottom = Math.max(bottom, py);
      });
    });
    return isFinite(left) ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
  };

  // Into a box (a selection, a bubble): tall boxes stack the letters, the others lay them
  // across, and the SFX shrinks until it fits with a margin
  const fitted = (input, rect, doc) => {
    const recipe = normal(clone(input));
    const tall = rect.height > rect.width * 1.6 && recipe.letters.filter((letter) => isShown(recipe, letter)).length > 1;
    if (tall) recipe.path.kind = "vertical";
    else if (recipe.path.kind === "vertical" || recipe.path.kind === "circle" || recipe.path.kind === "free") recipe.path.kind = "line";
    recipe.path.points = null;
    recipe.scale = 1;
    recipe.angle = 0;
    recipe.origin = [rect.left + rect.width / 2, rect.top + rect.height / 2];
    recipe.path.length = (tall ? rect.height : rect.width) * 0.82;
    for (let i = 0; i < 6; i++) {
      const box = extentOf(layoutOf(recipe, doc), doc);
      if (!box) break;
      const ratio = Math.min((rect.width * 0.86) / box.width, (rect.height * 0.86) / box.height);
      // Centred on what shows, which the path's middle isn't always
      recipe.origin = [recipe.origin[0] + (rect.left + rect.width / 2 - (box.left + box.width / 2)), recipe.origin[1] + (rect.top + rect.height / 2 - (box.top + box.height / 2))];
      if (ratio >= 0.995) break;
      recipe.path.length *= ratio;
    }
    return recipe;
  };

  // Several letter layers made one by one, as on a page lettered by hand: one SFX that keeps
  // every letter exactly where it was, and lays out the letters typed next
  const adopt = (doc, texts) => {
    // Where each letter shows: Photoshop's own pixels, when the text was never edited here
    const poses = texts.map((layer) => {
      const pose = poseOf(layer, doc);
      if (layer.raster) {
        const box = PS.boxOf(layer, doc);
        pose.center = [box.xMid, box.yMid];
      }
      return pose;
    });
    const n = poses.length;
    const c = [poses.reduce((sum, p) => sum + p.center[0], 0) / n, poses.reduce((sum, p) => sum + p.center[1], 0) / n];
    let xx = 0;
    let xy = 0;
    let yy = 0;
    poses.forEach((p) => {
      const dx = p.center[0] - c[0];
      const dy = p.center[1] - c[1];
      xx += dx * dx;
      xy += dx * dy;
      yy += dy * dy;
    });
    let angle = n > 1 ? 0.5 * Math.atan2(2 * xy, xx - yy) : rad(poses[0].rot);
    if (Math.abs(angle) > Math.PI / 2) angle += angle > 0 ? -Math.PI : Math.PI;
    const order = poses.map((p, i) => ({ p, i, along: (p.center[0] - c[0]) * Math.cos(angle) + (p.center[1] - c[1]) * Math.sin(angle) })).sort((a, b) => a.along - b.along);
    const sizes = poses.map((p) => p.size).sort((a, b) => a - b);
    const recipe = normal(clone(defaults));
    recipe.font = Object.assign({}, poses[order[0].i].font);
    recipe.color = Object.assign({}, poses[order[0].i].color);
    recipe.size = round(sizes[Math.floor(n / 2)], 10);
    recipe.origin = c;
    recipe.angle = round(deg(angle), 100);
    recipe.scale = 1;
    recipe.path = Object.assign({}, recipe.path, { kind: "line", length: 0, points: null });
    recipe.source = null;
    recipe.letters = [];
    recipe.next = 1;
    order.forEach(({ p }) => {
      const [x, y] = toLocal(recipe, p.center[0], p.center[1]);
      const lock = { x, y, rot: p.rot - recipe.angle, skew: p.skew, size: p.size, sx: p.sx, sy: p.sy };
      if (p.font.ps !== recipe.font.ps) lock.font = p.font;
      if (!sameColor(p.color, recipe.color)) lock.color = p.color;
      recipe.letters.push({ key: recipe.next++, ch: p.ch, o: null, lock });
    });
    recipe.text = recipe.letters.map((letter) => letter.ch).join("");
    const strokes = texts.map((layer) => layer.stroke).filter((stroke) => stroke && stroke.enabled);
    recipe.stroke = strokes.length ? { enabled: true, size: strokes[0].size, color: Object.assign({}, strokes[0].color), outer: strokes[0].outer ? { size: strokes[0].outer.size, color: Object.assign({}, strokes[0].outer.color) } : { size: 0, color: BLACK } } : Object.assign({}, recipe.stroke, { enabled: false });
    recipe.mode = "cut";
    return recipe;
  };

  // Layer > Convert to SFX: the selected texts. Letters made one by one become one SFX as they
  // are; a word becomes an SFX laid out from it, where it was.
  const convert = async () => {
    const doc = app.doc;
    if (!doc) return;
    const texts = App().activeTexts().filter((layer) => !sfxOf(doc, layer));
    if (!texts.length) {
      App().toast(T("Select text layers first: a word, or letters made one by one."));
      return;
    }
    let recipe;
    if (texts.length > 1 && texts.every((layer) => graphemes(layer.params.layerText.textKey.trim()).length <= 2)) recipe = adopt(doc, texts);
    else {
      const layer = texts[0];
      const pose = poseOf(layer, doc);
      const box = PS.boxOf(layer, doc);
      if (layer.raster) pose.center = [box.xMid, box.yMid];
      recipe = normal(clone(defaults));
      recipe.letters = [];
      recipe.next = 1;
      relink(recipe, layer.params.layerText.textKey.replace(/[\r\n]+/g, " ").trim() || "SFX");
      recipe.font = Object.assign({}, pose.font);
      recipe.color = Object.assign({}, pose.color);
      recipe.size = round(pose.size, 10);
      recipe.origin = [box.xMid, box.yMid];
      recipe.angle = round(deg(PS.turnOf(layer)), 100);
      recipe.scale = 1;
      recipe.path = Object.assign({}, recipe.path, { kind: recipe.path.kind === "free" ? "line" : recipe.path.kind, length: 0, points: null });
      recipe.source = null;
      if (layer.stroke && layer.stroke.enabled) recipe.stroke = { enabled: true, size: layer.stroke.size, color: Object.assign({}, layer.stroke.color), outer: layer.stroke.outer ? { size: layer.stroke.outer.size, color: Object.assign({}, layer.stroke.outer.color) } : { size: 0, color: BLACK } };
      recipe.seed = 1 + Math.floor(Math.random() * 100000);
    }
    await ensureFont(recipe);
    const top = texts[texts.length - 1];
    const gone = new Set(texts.map((layer) => layer.id));
    const group = { id: PS.newId(), kind: "group", name: "SFX", visible: true, opacity: 1, blend: "normal", open: false, group: top.group || null };
    const layers = [];
    doc.state.layers.forEach((layer) => {
      if (layer.id === top.id) layers.push(group);
      if (!gone.has(layer.id)) layers.push(layer);
    });
    ops.setLayers(laidLayers(doc, group, recipe, layers), "Convert to SFX", { activeIds: [group.id] });
    App().setTool("sfx");
  };

  // Layer > Separate SFX Letters: the folder stays, its letters become layers like any other
  const separate = () => {
    const doc = app.doc;
    const group = activeSfx();
    if (!doc || !group) return;
    const layers = doc.state.layers.map((layer) => {
      if (layer.id === group.id) {
        const next = Object.assign({}, layer);
        delete next.sfx;
        next.name = layer.name;
        return next;
      }
      if (layer.group === group.id && layer.sfxPart) {
        const next = Object.assign({}, layer);
        delete next.sfxPart;
        return next;
      }
      return layer;
    });
    ops.setLayers(layers, "Separate SFX Letters", { activeIds: [group.id] });
  };

  const duplicate = () => {
    const doc = app.doc;
    const group = activeSfx();
    if (!doc || !group) return;
    const { recipe } = settled(doc, group);
    const copy = normal(clone(recipe));
    copy.origin = [copy.origin[0] + 24, copy.origin[1] + 24];
    if (copy.source) copy.source.at = [copy.source.at[0] + 24, copy.source.at[1] + 24];
    const twin = { id: PS.newId(), kind: "group", name: group.name, visible: true, opacity: group.opacity, blend: "normal", open: false, group: group.group, mask: null };
    const layers = doc.state.layers.slice();
    layers.splice(layers.indexOf(layerById(doc, group.id)) + 1, 0, twin);
    ops.setLayers(laidLayers(doc, twin, copy, layers), "Duplicate SFX", { activeIds: [twin.id] });
  };

  /* --------------------------- around the original SFX --------------------------- */

  const selection = () => (app.doc ? app.doc.state.selection : null);
  const needSelection = () => {
    const chosen = selection();
    if (!chosen) App().toast(T("Make a selection first: around the original SFX, or a bubble with the Magic Wand."));
    return chosen;
  };

  // The selection's long side and its angle, read from its outline: a Japanese SFX drawn
  // on a slant gets its translation on the same slant
  const axisOf = (chosen) => {
    const points = [];
    chosen.rings.forEach((ring) => ring.forEach((p) => points.push(p)));
    if (points.length < 3) return { angle: 0, length: chosen.bounds.width, center: [chosen.bounds.xMid, chosen.bounds.yMid], across: chosen.bounds.height };
    const c = [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
    let xx = 0;
    let xy = 0;
    let yy = 0;
    points.forEach(([x, y]) => {
      xx += (x - c[0]) * (x - c[0]);
      xy += (x - c[0]) * (y - c[1]);
      yy += (y - c[1]) * (y - c[1]);
    });
    let angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    let min = Infinity;
    let max = -Infinity;
    let low = Infinity;
    let high = -Infinity;
    points.forEach(([x, y]) => {
      const u = (x - c[0]) * Math.cos(angle) + (y - c[1]) * Math.sin(angle);
      const v = -(x - c[0]) * Math.sin(angle) + (y - c[1]) * Math.cos(angle);
      min = Math.min(min, u);
      max = Math.max(max, u);
      low = Math.min(low, v);
      high = Math.max(high, v);
    });
    const center = [c[0] + Math.cos(angle) * (min + max) / 2 - Math.sin(angle) * (low + high) / 2, c[1] + Math.sin(angle) * (min + max) / 2 + Math.cos(angle) * (low + high) / 2];
    // Upright Japanese SFX run down the page: the translation reads across, or stacked
    if (Math.abs(angle) > Math.PI / 2) angle += angle > 0 ? -Math.PI : Math.PI;
    return { angle, length: max - min, across: high - low, center };
  };

  const fitToSelection = async () => {
    const chosen = needSelection();
    if (!chosen) return;
    const b = chosen.bounds;
    const group = activeSfx();
    if (group) {
      const doc = app.doc;
      const recipe = fitted(settled(doc, group).recipe, b, doc);
      await ensureFont(recipe);
      apply(group, recipe, { name: "Fit SFX", selection: null });
    } else await newSfx({ fitRect: b });
    ops.deselect();
  };

  // A tall or slanted original: the SFX takes its axis, a little inside it
  const followSelection = async (options = {}) => {
    const chosen = selection();
    if (!chosen) return null;
    const axis = axisOf(chosen);
    const tall = axis.length > axis.across * 1.6 && Math.abs(Math.abs(deg(axis.angle)) - 90) < 25;
    const half = (axis.length * 0.82) / 2;
    const a = [axis.center[0] - Math.cos(axis.angle) * half, axis.center[1] - Math.sin(axis.angle) * half];
    const b = [axis.center[0] + Math.cos(axis.angle) * half, axis.center[1] + Math.sin(axis.angle) * half];
    if (tall || axis.length < axis.across * 1.2) return newSfx(Object.assign({ fitRect: chosen.bounds }, options));
    return newSfx(Object.assign({ line: [a, b] }, options));
  };

  // The publisher's full treatment: the original goes (Content-Aware Fill, on a layer of its
  // own), the SFX takes its place and its slant
  const replaceOriginal = async () => {
    const chosen = needSelection();
    if (!chosen) return;
    App().toast(T("Removing the original SFX…"));
    try {
      const outcome = await ops.contentAwareFill({ area: "around", output: "new", mirror: false, adapt: true, name: T("SFX clean") }, () => {});
      if (outcome === "none") App().toast(T("Nothing to fill from."));
    } catch (error) {
      App().toast(T("The fill didn't go through."), true);
      return;
    }
    if (!selection()) ops.reselect();
    await followSelection();
    ops.deselect();
  };

  // A styled subtitle beside the original, which stays: small, straight, outlined
  const subtitle = async () => {
    const chosen = needSelection();
    if (!chosen) return;
    const b = chosen.bounds;
    const look = BUILTIN.find((item) => item.id === "subtitle").look;
    const doc = app.doc;
    const made = await newSfx({ at: [b.right + 10, b.yMid], look });
    if (!made) return;
    // Beside the original, inside the page
    const { recipe } = settled(app.doc, made);
    const box = extentOf(layoutOf(recipe, doc), doc);
    if (box) {
      let x = b.right + 8 + box.width / 2;
      if (x + box.width / 2 > doc.width) x = b.left - 8 - box.width / 2;
      recipe.origin = [recipe.origin[0] + (x - (box.left + box.width / 2)), recipe.origin[1] + (b.yMid - (box.top + box.height / 2))];
      apply(made, recipe, { name: "New SFX", amend: true });
    }
    ops.deselect();
  };

  // Part of the drawing in front of the SFX (an arm, a blade): the SFX is hidden under the selection
  const hideUnderSelection = () => {
    const doc = app.doc;
    const group = activeSfx();
    const chosen = needSelection();
    if (!doc || !group || !chosen) return;
    const b = chosen.bounds;
    const old = group.mask && group.mask.canvas ? group.mask : null;
    const left = Math.floor(old ? Math.min(old.left, b.left) : b.left);
    const top = Math.floor(old ? Math.min(old.top, b.top) : b.top);
    const right = Math.ceil(old ? Math.max(old.left + old.canvas.width, b.right) : b.right);
    const bottom = Math.ceil(old ? Math.max(old.top + old.canvas.height, b.bottom) : b.bottom);
    const canvas = PS.newCanvas(Math.max(1, right - left), Math.max(1, bottom - top));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (old) ctx.drawImage(old.canvas, old.left - left, old.top - top);
    const shape = PS.newCanvas(Math.max(1, Math.round(b.width)), Math.max(1, Math.round(b.height)));
    const s = shape.getContext("2d");
    if (chosen.mask) {
      const image = s.createImageData(chosen.mask.width, chosen.mask.height);
      for (let i = 0; i < chosen.mask.data.length; i++) if (chosen.mask.data[i]) image.data[i * 4 + 3] = 255;
      s.putImageData(image, 0, 0);
    } else {
      s.fillRect(0, 0, shape.width, shape.height);
    }
    s.globalCompositeOperation = "source-in";
    s.fillStyle = "#000";
    s.fillRect(0, 0, shape.width, shape.height);
    ctx.drawImage(shape, b.left - left, b.top - top);
    const mask = { canvas, left, top, right: left + canvas.width, bottom: top + canvas.height, defaultColor: 255 };
    ops.setLayers(doc.state.layers.map((layer) => (layer.id === group.id ? Object.assign({}, layer, { mask }) : layer)), "Hide SFX under selection", { selection: null });
  };
  const clearMask = () => {
    const doc = app.doc;
    const group = activeSfx();
    if (!doc || !group || !group.mask) return;
    ops.setLayers(doc.state.layers.map((layer) => (layer.id === group.id ? Object.assign({}, layer, { mask: null }) : layer)), "Show SFX whole");
  };

  /* ---------------------------------- saving ---------------------------------- */

  const recipesForSave = (doc) => doc.state.layers.filter((layer) => layer.kind === "group" && layer.sfx).map((group) => {
    let recipe;
    try {
      recipe = settled(doc, group).recipe;
    } catch (error) {
      recipe = normal(group.sfx);
    }
    return { name: group.name, recipe };
  });

  /* ---------------------------- presets and the bank ---------------------------- */

  let presets = readStore(STORE_PRESETS, []);
  if (!Array.isArray(presets)) presets = [];
  let bank = readStore(STORE_BANK, []);
  if (!Array.isArray(bank)) bank = [];

  const applyLook = (look, label) => edit((recipe) => {
    const next = withLook(recipe, look);
    if (look.source && !recipe.source) next.source = { at: [recipe.origin[0], recipe.origin[1] + 120 * recipe.scale], amount: look.source.amount, radial: look.source.radial };
    Object.keys(next).forEach((key) => { recipe[key] = next[key]; });
  }, null, label || "SFX Preset");

  const savePreset = async () => {
    const values = await App().dialog({ title: T("Save as a preset"), ok: T("Save"), fields: [{ id: "name", label: T("Name"), value: T("My SFX") }] });
    if (!values || !String(values.name || "").trim()) return;
    const group = activeSfx();
    const recipe = group ? settled(app.doc, group).recipe : defaults;
    presets = presets.filter((item) => item.name !== values.name.trim()).concat([{ name: values.name.trim(), look: lookOf(recipe, true) }]);
    writeStore(STORE_PRESETS, presets);
    renderPanel(true);
    renderOptions();
  };

  const keepInBank = async () => {
    const group = activeSfx();
    if (!group) return;
    const recipe = settled(app.doc, group).recipe;
    const values = await App().dialog({ title: T("Keep in the SFX bank"), ok: T("Keep"), fields: [{ id: "name", label: T("Name"), value: recipe.text.trim() || "SFX" }] });
    if (!values || !String(values.name || "").trim()) return;
    const kept = normal(clone(recipe));
    kept.origin = [0, 0];
    kept.angle = recipe.angle;
    if (kept.source) kept.source.at = toLocal(recipe, recipe.source.at[0], recipe.source.at[1]);
    bank = bank.filter((item) => item.name !== values.name.trim()).concat([{ name: values.name.trim(), recipe: kept, sourceLocal: Boolean(kept.source) }]);
    writeStore(STORE_BANK, bank);
    App().toast(fill(T("{name} is in the SFX bank."), { name: values.name.trim() }));
    renderPanel(true);
  };

  // An SFX from the bank, on this page: where the view's middle is, its letters as they were
  const placeFromBank = async (item) => {
    const doc = app.doc;
    if (!doc) return;
    const v = doc.view;
    const stage = $("stage").getBoundingClientRect();
    const at = [(stage.width / 2 - v.x) / v.zoom, (stage.height / 2 - v.y) / v.zoom];
    const recipe = normal(clone(item.recipe));
    recipe.origin = [clamp(at[0], 0, doc.width), clamp(at[1], 0, doc.height)];
    if (recipe.source && item.sourceLocal) recipe.source.at = toPage(recipe, recipe.source.at[0], recipe.source.at[1]);
    await ensureFont(recipe);
    const group = { id: PS.newId(), kind: "group", name: "SFX", visible: true, opacity: 1, blend: "normal", open: false, group: null };
    ops.setLayers(laidLayers(doc, group, recipe, doc.state.layers.concat([group])), "New SFX", { activeIds: [group.id] });
  };

  /* --------------------------- lines of the script --------------------------- */

  // A line of the script marked as an SFX ("SFX: BOOM") lands as an SFX in the bubble or the
  // box it was pasted in, with the SFX settings, in the same step as the paste
  const SCRIPT_MARK = /^\s*(?:sfx|fx|se|ono|onomatop[ée]e?|bruit|son)\s*[:：]\s*(.+)$/i;
  const fromScript = (layers) => {
    const doc = app.doc;
    if (!doc || !layers || !layers.length) return;
    const marked = layers.filter((layer) => layer && layer.kind === "text" && SCRIPT_MARK.test(String(layer.params.layerText.textKey || "").replace(/\r/g, " ")));
    if (!marked.length) return;
    setTimeout(async () => {
      for (const pasted of marked) {
        const now = app.doc && layerById(app.doc, pasted.id);
        if (!now) continue;
        const text = SCRIPT_MARK.exec(String(now.params.layerText.textKey).replace(/\r/g, " "))[1].trim();
        const box = PS.frameOf(now, app.doc);
        const rect = { left: box.left, top: box.top, width: Math.max(40, box.width), height: Math.max(30, box.height) };
        await ensureFont(defaults);
        const doc2 = app.doc;
        let recipe = normal(clone(defaults));
        recipe.letters = [];
        recipe.next = 1;
        relink(recipe, text);
        recipe.seed = 1 + Math.floor(Math.random() * 100000);
        recipe.source = null;
        recipe = fitted(recipe, rect, doc2);
        const group = { id: PS.newId(), kind: "group", name: "SFX", visible: true, opacity: 1, blend: "normal", open: false, group: now.group || null };
        const list = [];
        doc2.state.layers.forEach((layer) => {
          if (layer.id === now.id) list.push(group);
          else list.push(layer);
        });
        ops.setLayers(laidLayers(doc2, group, recipe, list), "TyperTools Smart Paste", { activeIds: [group.id], amend: true });
      }
    }, 0);
  };

  /* ------------------------------ letter by letter ------------------------------ */

  // The letter being worked on, in the SFX tool
  // What was just done with the tool, for whoever listens (the SFX guide's practice)
  const listeners = new Set();
  const tell = (detail) => listeners.forEach((listener) => {
    try {
      listener(detail);
    } catch (error) {
      console.warn("TypeR SFX: a listener failed", error);
    }
  });
  const onGesture = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  let picked = null;
  const pickedLetter = (group) => (picked && group && picked.group === group.id ? picked.key : null);

  const editLetter = (key, change, coalesce, name) => edit((recipe) => {
    const letter = recipe.letters.find((item) => item.key === key);
    if (letter) change(letter, recipe);
  }, coalesce, name || "SFX Letter");

  const pinLetter = (key, on) => {
    const doc = app.doc;
    const group = activeSfx();
    if (!doc || !group) return;
    const { recipe } = settled(doc, group);
    const layout = layoutOf(recipe, doc);
    const pose = layout.letters.find((item) => item.key === key);
    const letter = recipe.letters.find((item) => item.key === key);
    if (!letter || !pose) return;
    if (on) {
      letter.lock = Object.assign({}, pose.local);
      if (pose.font.ps !== recipe.font.ps) letter.lock.font = pose.font;
      if (!sameColor(pose.color, recipe.color)) letter.lock.color = pose.color;
      letter.o = null;
    } else letter.lock = null;
    apply(group, recipe, { name: on ? "SFX Letter" : "SFX Letter" });
  };

  // An O that lasts: BOM, BOOM, BOOOM
  const elongate = (key) => edit((recipe) => {
    const at = recipe.letters.findIndex((item) => item.key === key);
    if (at < 0 || recipe.letters.length >= MAX_LETTERS) return;
    recipe.letters.splice(at + 1, 0, { key: recipe.next++, ch: recipe.letters[at].ch, o: null, lock: null });
    recipe.text = recipe.letters.map((letter) => letter.ch).join("");
  }, null, "SFX Letter");

  const removeLetter = (key) => {
    edit((recipe) => {
      recipe.letters = recipe.letters.filter((item) => item.key !== key);
      recipe.text = recipe.letters.map((letter) => letter.ch).join("");
    }, null, "SFX Letter");
    picked = null;
  };

  /* --------------------------------- the tool --------------------------------- */

  const SVGNS = "http://www.w3.org/2000/svg";
  let overlay = null;
  const overlayGroup = () => {
    if (overlay && overlay.isConnected) return overlay;
    const over = $("over");
    if (!over) return null;
    overlay = document.createElementNS(SVGNS, "g");
    overlay.id = "over-sfx";
    over.appendChild(overlay);
    return overlay;
  };
  const svg = (tag, attributes, parent) => {
    const el = document.createElementNS(SVGNS, tag);
    Object.keys(attributes).forEach((key) => el.setAttribute(key, attributes[key]));
    parent.appendChild(el);
    return el;
  };
  const screen = (p) => App().toScreen(p[0], p[1]);

  let handles = [];
  let preview = null;
  // A handle the SFX guide points at: an end of the path, the picked letter, its ● or its corner
  let mark = null;
  const setMark = (kind) => {
    mark = kind || null;
    drawOverlay();
  };
  const drawOverlay = () => {
    const g = overlayGroup();
    if (!g) return;
    g.textContent = "";
    handles = [];
    const doc = app.doc;
    if (!doc || app.tool !== "sfx" || !App()) return;
    if (preview) {
      const points = preview.map(screen);
      svg("polyline", { points: points.map((p) => p.join(",")).join(" "), class: "sfx-guide sfx-guide--new" }, g);
      return;
    }
    const group = activeSfx();
    if (!group) return;
    const read = settledNow(doc, group);
    if (read.failed) return;
    const { recipe, layout } = read;
    // The letters' boxes on the page, kept with the reading: a zoom or a pan only projects them
    if (!read.boxes) {
      const byKey = new Map(recipe.letters.map((item) => [item.key, item]));
      read.boxes = layout.letters.map((pose) => {
        const m = measure(doc, pose.font, pose.ch);
        const k = pose.size / 100;
        return { pose, letter: byKey.get(pose.key) || null, w: (m.w * k * pose.sx) / 2, h: (m.h * k * pose.sy) / 2, spin: spinOf(pose.rot, pose.skew) };
      });
    }
    svg("polyline", { points: layout.guide.map(screen).map((p) => p.join(",")).join(" "), class: "sfx-guide" }, g);
    const key = pickedLetter(group);
    const pad = 2 / doc.view.zoom;
    read.boxes.forEach(({ pose, letter, spin, w: hw, h: hh }) => {
      const w = hw + pad;
      const h = hh + pad;
      const corners = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => screen([pose.center[0] + spin[0] * x + spin[2] * y, pose.center[1] + spin[1] * x + spin[3] * y]));
      const on = pose.key === key;
      svg("polygon", { points: corners.map((p) => p.join(",")).join(" "), class: `sfx-letter${on ? " is-on" : ""}${letter && (letter.o || letter.lock) ? " is-touched" : ""}` }, g);
      if (letter && letter.lock) {
        const [x, y] = corners[1];
        svg("circle", { cx: x, cy: y, r: 3, class: "sfx-pin" }, g);
      }
      if (on) {
        const top = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2];
        const center = screen(pose.center);
        const away = [top[0] - center[0], top[1] - center[1]];
        const len = Math.hypot(away[0], away[1]) || 1;
        const knob = [top[0] + (away[0] / len) * 16, top[1] + (away[1] / len) * 16];
        svg("line", { x1: top[0], y1: top[1], x2: knob[0], y2: knob[1], class: "sfx-stem" }, g);
        svg("circle", { cx: knob[0], cy: knob[1], r: 4.5, class: "sfx-knob" }, g);
        handles.push({ kind: "letterTurn", at: knob, key: pose.key });
        const corner = corners[2];
        svg("rect", { x: corner[0] - 4, y: corner[1] - 4, width: 8, height: 8, class: "sfx-handle" }, g);
        handles.push({ kind: "letterSize", at: corner, key: pose.key });
      }
    });
    // The path's ends and its bend
    if (recipe.path.kind !== "free" && recipe.path.kind !== "circle") {
      const ends = [layout.guide[0], layout.guide[layout.guide.length - 1]];
      ends.forEach((p, i) => {
        const [x, y] = screen(p);
        svg("rect", { x: x - 4.5, y: y - 4.5, width: 9, height: 9, class: "sfx-end" }, g);
        handles.push({ kind: i ? "end1" : "end0", at: [x, y] });
      });
      if (recipe.path.kind === "arc" || recipe.path.kind === "wave") {
        const p = recipe.path.kind === "arc" ? layout.guide[16] : layout.guide[Math.round(32 / (4 * clamp(recipe.path.waves, 0.25, 8)))] || layout.guide[8];
        const [x, y] = screen(p);
        svg("circle", { cx: x, cy: y, r: 5, class: "sfx-bend" }, g);
        handles.push({ kind: recipe.path.kind === "arc" ? "bend" : "amp", at: [x, y] });
      }
    }
    if (recipe.source) {
      const [x, y] = screen(recipe.source.at);
      svg("path", { d: `M${x} ${y - 7}L${x + 7} ${y}L${x} ${y + 7}L${x - 7} ${y}Z`, class: "sfx-source" }, g);
      handles.push({ kind: "source", at: [x, y] });
    }
    if (mark) {
      let at = null;
      if (mark === "letter") {
        const pose = layout.letters.find((item) => item.key === key) || layout.letters[Math.min(1, layout.letters.length - 1)];
        if (pose) at = screen(pose.center);
      } else {
        const kind = { knob: "letterTurn", corner: "letterSize" }[mark] || mark;
        const handle = handles.find((item) => item.kind === kind);
        if (handle) at = handle.at;
      }
      if (at) svg("circle", { cx: at[0], cy: at[1], r: 14, class: "sfx-mark" }, g);
    }
  };

  const stagePoint = (event) => {
    const rect = $("stage").getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const handleAt = (event) => {
    const [x, y] = stagePoint(event);
    let best = null;
    let bestDistance = 9;
    handles.forEach((handle) => {
      const d = Math.hypot(handle.at[0] - x, handle.at[1] - y);
      if (d < bestDistance) {
        best = handle;
        bestDistance = d;
      }
    });
    return best;
  };
  // The letter of an SFX under a point, by its turned box
  const letterAt = (point) => {
    const doc = app.doc;
    const hit = ops.hitLayer(point[0], point[1], true);
    if (!hit || hit.kind !== "text") return null;
    const group = sfxOf(doc, hit);
    if (!group) return null;
    let key = hit.sfxPart ? hit.sfxPart.key : null;
    if (key === null) {
      const { byKey } = settled(doc, group);
      byKey.forEach((layer, k) => { if (layer.id === hit.id) key = k; });
    }
    if (hit.sfxPart && hit.sfxPart.role !== "letter") key = hit.sfxPart.key;
    return { group, key };
  };

  let gestures = 0;
  const down = (event, point, base) => {
    const doc = app.doc;
    if (!doc) return null;
    const group = activeSfx();
    const handle = group ? handleAt(event) : null;
    gestures++;
    const token = `gesture:sfx${gestures}`;
    if (handle) {
      const { recipe } = settled(doc, group);
      const layout = layoutOf(recipe, doc);
      return Object.assign(base, { kind: "sfx", mode: handle.kind, group: group.id, key: handle.key, recipe, layout, token });
    }
    const letter = letterAt(point);
    if (letter) {
      if (!doc.state.activeIds.includes(letter.group.id) || doc.state.activeIds.length !== 1) ops.selectLayer(letter.group.id);
      picked = letter.key === null || event.altKey ? null : { group: letter.group.id, key: letter.key };
      const fresh = layerById(app.doc, letter.group.id);
      const { recipe } = settled(app.doc, fresh);
      showAll();
      // Alt + drag: the whole SFX moves, as with the Move tool
      if (event.altKey || letter.key === null) return Object.assign(base, { kind: "sfx", mode: "whole", group: fresh.id, recipe, token });
      return Object.assign(base, { kind: "sfx", mode: "letter", group: fresh.id, key: letter.key, recipe, layout: layoutOf(recipe, app.doc), token });
    }
    picked = null;
    // Shift + click in a bubble: the next SFX fills it
    return Object.assign(base, { kind: "sfx", mode: "create", points: [point], token, free: event.altKey || freeDrawing, bubble: event.shiftKey });
  };

  const move = (gesture, event, point) => {
    const doc = app.doc;
    if (!doc) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > gesture.slop) gesture.moved = true;
    if (!gesture.moved) return;
    const group = layerById(doc, gesture.group);
    if (gesture.mode === "create") {
      const last = gesture.points[gesture.points.length - 1];
      if (Math.hypot(point[0] - last[0], point[1] - last[1]) * doc.view.zoom >= 2) gesture.points.push(point);
      preview = gesture.free ? gesture.points.slice() : [gesture.start, point];
      drawOverlay();
      return;
    }
    if (!group) return;
    const ending = gesture.mode === "end0" || gesture.mode === "end1";
    if (ending) {
      const way = endWay(event);
      // Another key held: what was done stays, and the new way goes on from where the pointer is
      if (gesture.way && gesture.way !== way && gesture.last) {
        gesture.recipe = gesture.last;
        gesture.layout = layoutOf(gesture.last, doc);
        gesture.from = point;
      }
      gesture.way = way;
      (gesture.ways = gesture.ways || new Set()).add(way);
      showEndHint(true);
    }
    const recipe = normal(clone(gesture.recipe));
    const [dx, dy] = [point[0] - gesture.start[0], point[1] - gesture.start[1]];
    const c = Math.cos(rad(recipe.angle));
    const s = Math.sin(rad(recipe.angle));
    const localDelta = [(c * dx + s * dy) / recipe.scale, (-s * dx + c * dy) / recipe.scale];
    const letter = gesture.key !== undefined ? recipe.letters.find((item) => item.key === gesture.key) : null;
    const pose = letter && gesture.layout ? gesture.layout.letters.find((item) => item.key === letter.key) : null;
    const nudgeLetter = (change) => {
      if (letter.lock) change(letter.lock, true);
      else {
        letter.o = Object.assign({ dx: 0, dy: 0, rot: 0, scale: 1, sx: 1 }, letter.o);
        change(letter.o, false);
      }
    };
    if (gesture.mode === "letter" && letter) {
      nudgeLetter((o, locked) => {
        if (locked) {
          o.x += localDelta[0];
          o.y += localDelta[1];
        } else {
          o.dx += localDelta[0];
          o.dy += localDelta[1];
        }
      });
    } else if (gesture.mode === "letterTurn" && letter && pose) {
      const from = Math.atan2(gesture.start[1] - pose.center[1], gesture.start[0] - pose.center[0]);
      const to = Math.atan2(point[1] - pose.center[1], point[0] - pose.center[0]);
      let turn = deg(wrapAngle(to - from));
      if (event.shiftKey) turn = Math.round((pose.rot + turn) / 15) * 15 - pose.rot;
      nudgeLetter((o) => { o.rot += turn; });
    } else if (gesture.mode === "letterSize" && letter && pose) {
      const from = Math.hypot(gesture.start[0] - pose.center[0], gesture.start[1] - pose.center[1]) || 1;
      const to = Math.hypot(point[0] - pose.center[0], point[1] - pose.center[1]);
      const factor = clamp(to / from, 0.1, 10);
      nudgeLetter((o, locked) => {
        if (locked) o.size *= factor;
        else o.scale *= factor;
      });
    } else if (gesture.mode === "whole") {
      recipe.origin = [recipe.origin[0] + dx, recipe.origin[1] + dy];
      if (recipe.source) recipe.source.at = [recipe.source.at[0] + dx, recipe.source.at[1] + dy];
    } else if (ending && gesture.way !== "path") {
      // A key held: the ends stay, and the letters change between them
      const guide = gesture.layout.guide;
      const first = guide[0];
      const last = guide[guide.length - 1];
      const fixed = gesture.mode === "end1" ? first : last;
      const from = gesture.from || gesture.start;
      const base = gesture.recipe;
      if (gesture.way === "move") {
        // Space: the whole SFX follows the pointer, as it is
        const shift = [point[0] - from[0], point[1] - from[1]];
        recipe.origin = [base.origin[0] + shift[0], base.origin[1] + shift[1]];
        if (recipe.source) recipe.source.at = [base.source.at[0] + shift[0], base.source.at[1] + shift[1]];
      } else if (gesture.way === "turn") {
        // Alt: every letter turns on itself, as the pointer goes round the SFX's middle
        const mid = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
        let turn = (Number(base.turn) || 0) + deg(wrapAngle(Math.atan2(point[1] - mid[1], point[0] - mid[0]) - Math.atan2(from[1] - mid[1], from[0] - mid[0])));
        if (event.shiftKey) turn = Math.round(turn / 15) * 15;
        recipe.turn = round(deg(wrapAngle(rad(turn))), 10);
      } else {
        const d0 = Math.hypot(from[0] - fixed[0], from[1] - fixed[1]) || 1;
        const f = clamp(Math.hypot(point[0] - fixed[0], point[1] - fixed[1]) / d0, 0.05, 20);
        if (gesture.way === "size") {
          // Cmd + Shift: all the letters bigger or smaller, from the end that stays
          recipe.scale = base.scale * f;
        } else if (gesture.way === "curve") {
          // Shift: the end held grows or shrinks against the other, which keeps its size: the
          // word turns growing or shrinking, or even again on the way back
          const layout = gesture.layout;
          const n = layout.letters.length;
          if (n < 2) return;
          const dragsLast = gesture.mode === "end1";
          const was = base.curve.kind === "peak" ? { kind: "flat", amount: 0, peak: 0 } : base.curve;
          const lastOverFirst = curveAt(was, n - 1, n, 1) / curveAt(was, 0, n, 0);
          const ratio = clamp(dragsLast ? lastOverFirst * f : lastOverFirst / f, 1 / 7, 7);
          const signed = (2 * (ratio - 1)) / (ratio + 1);
          if (Math.abs(signed) < 0.03) {
            if (base.curve.kind !== "peak" || Math.abs(f - 1) >= 0.05) recipe.curve.kind = "flat";
          } else {
            recipe.curve.kind = signed > 0 ? "grow" : "shrink";
            recipe.curve.amount = round(clamp(Math.abs(signed) * 100, 0, 150), 1);
          }
          // The path follows the letters, and the end that stays keeps its letter's size
          const fixedAt = (curve) => (dragsLast ? curveAt(curve, 0, n, 0) : curveAt(curve, n - 1, n, 1));
          recipe.size = (base.size * layout.fit * fixedAt(base.curve)) / fixedAt(recipe.curve);
          recipe.path.length = 0;
        } else {
          // Ctrl: the letters keep their size and move apart or together, the path with them
          const layout = gesture.layout;
          const n = layout.letters.length;
          if (n < 2) return;
          const unit = layout.unit * layout.fit;
          recipe.size = base.size * layout.fit;
          recipe.path.length = 0;
          recipe.spacing = round(clamp(base.spacing + ((layout.total * (f - 1)) / ((n - 1) * unit)) * 100, -80, 200), 10);
        }
        // The end that stays, where it was
        const guideNow = layoutOf(normal(recipe), doc).guide;
        const now = gesture.mode === "end1" ? guideNow[0] : guideNow[guideNow.length - 1];
        const shift = [fixed[0] - now[0], fixed[1] - now[1]];
        recipe.origin = [recipe.origin[0] + shift[0], recipe.origin[1] + shift[1]];
        if (recipe.source) recipe.source.at = [recipe.source.at[0] + shift[0], recipe.source.at[1] + shift[1]];
      }
    } else if (ending) {
      // One end stays, the other follows: the path turns and stretches, the letters' size with it
      const guide = gesture.layout.guide;
      const first = guide[0];
      const last = guide[guide.length - 1];
      const [a, b] = gesture.mode === "end1" ? [first, point] : [point, last];
      const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const before = Math.hypot(last[0] - first[0], last[1] - first[1]) || 1;
      if (chord < 4) return;
      const was = Math.atan2(last[1] - first[1], last[0] - first[0]);
      const now = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const f = chord / before;
      recipe.angle = round(gesture.recipe.angle + deg(wrapAngle(now - was)), 100);
      recipe.path.length = gesture.layout.total * f;
      if (recipe.path.kind === "free") recipe.path.kind = "line";
      // The chord's middle, in the SFX's own frame, scales with the path
      const offset = toLocal(gesture.recipe, (first[0] + last[0]) / 2, (first[1] + last[1]) / 2);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const cc = Math.cos(rad(recipe.angle));
      const ss = Math.sin(rad(recipe.angle));
      const k = recipe.scale * f;
      recipe.origin = [mid[0] - k * (cc * offset[0] - ss * offset[1]), mid[1] - k * (ss * offset[0] + cc * offset[1])];
    } else if (gesture.mode === "bend") {
      const guide = gesture.layout.guide;
      const a = guide[0];
      const b = guide[guide.length - 1];
      const chord = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const normalX = -(b[1] - a[1]) / chord;
      const normalY = (b[0] - a[0]) / chord;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const sag = -((point[0] - mid[0]) * normalX + (point[1] - mid[1]) * normalY);
      // Sagitta over chord, back to the bend: a few steps of search are enough
      const ratio = clamp(sag / chord, -0.49, 0.49);
      let low = 0;
      let high = 1;
      const sagOf = (bend) => {
        const phi = bend * Math.PI * 1.2;
        if (phi < 1e-4) return 0;
        const R = 1 / phi;
        return (R * (1 - Math.cos(phi / 2))) / (2 * R * Math.sin(phi / 2));
      };
      for (let i = 0; i < 30; i++) {
        const mid2 = (low + high) / 2;
        if (sagOf(mid2) < Math.abs(ratio)) low = mid2;
        else high = mid2;
      }
      recipe.path.bend = round(Math.sign(ratio) * low * 100, 10);
    } else if (gesture.mode === "amp") {
      const guide = gesture.layout.guide;
      const a = guide[0];
      const b = guide[guide.length - 1];
      const chord = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const normalX = -(b[1] - a[1]) / chord;
      const normalY = (b[0] - a[0]) / chord;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const lift = Math.abs((point[0] - mid[0]) * normalX + (point[1] - mid[1]) * normalY);
      recipe.path.amp = round(clamp((lift / (gesture.layout.unit * gesture.layout.fit * recipe.scale)) * 100, 0, 200), 10);
    } else if (gesture.mode === "source" && recipe.source) {
      recipe.source.at = [point[0], point[1]];
    } else return;
    const next = normal(recipe);
    if (ending) gesture.last = next;
    apply(group, next, { name: "SFX", coalesce: gesture.token });
  };

  // Dragging an end of the path: by itself, the path; Space moves the SFX, Alt turns the
  // letters, Ctrl spreads them, Shift makes that end bigger or smaller than the other (the size
  // along the word), Ctrl + Shift resizes them all
  let spaceHeld = false;
  const isSpaceKey = (event) => event.code === "Space" || event.key === " ";
  document.addEventListener("keydown", (event) => { if (isSpaceKey(event)) spaceHeld = true; }, true);
  document.addEventListener("keyup", (event) => { if (isSpaceKey(event)) spaceHeld = false; }, true);
  window.addEventListener("blur", () => { spaceHeld = false; });
  const endWay = (event) => (spaceHeld ? "move" : event.altKey ? "turn" : event.ctrlKey || event.metaKey ? (event.shiftKey ? "size" : "spacing") : event.shiftKey ? "curve" : "path");
  const END_HINT = "Drag: the end of the path. Space: move the SFX. Alt: turn the letters. Cmd: spread them. Shift: this end bigger or smaller. Cmd + Shift: resize them.";
  let hintKept = null;
  const showEndHint = (on) => {
    const status = $("status-hint");
    if (!status) return;
    if (on) {
      if (hintKept === null) hintKept = status.textContent;
      status.textContent = T(END_HINT).replace(/Cmd/g, /Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd" : "Ctrl");
    } else if (hintKept !== null) {
      status.textContent = hintKept;
      hintKept = null;
    }
  };

  const up = async (gesture, event, point, cancelled) => {
    preview = null;
    showEndHint(false);
    if (cancelled) {
      drawOverlay();
      return;
    }
    if (gesture.mode === "create") {
      if (!gesture.moved) {
        if (gesture.bubble) {
          ops.wandAt(point[0], point[1], "new");
          const chosen = selection();
          if (chosen && chosen.bounds.width > 6 && chosen.bounds.height > 6 && chosen.bounds.width < app.doc.width * 0.9) {
            await newSfx({ fitRect: chosen.bounds });
            ops.deselect();
          } else {
            if (chosen) ops.deselect();
            await newSfx({ at: point });
          }
        } else await newSfx({ at: point });
      } else if (gesture.free && gesture.points.length > 2) {
        await newSfx({ points: gesture.points.concat([point]) });
      } else {
        const length = Math.hypot(point[0] - gesture.start[0], point[1] - gesture.start[1]);
        if (length * app.doc.view.zoom < 6) await newSfx({ at: gesture.start });
        else await newSfx({ line: [gesture.start, point] });
      }
      drawOverlay();
      focusText();
      tell({ mode: "create" });
      return;
    }
    showAll();
    if (gesture.moved) tell({ mode: gesture.mode, ways: gesture.ways ? Array.from(gesture.ways) : [] });
    else if (gesture.mode === "letter") tell({ mode: "pick" });
  };

  const hover = (event, point) => {
    const stage = $("stage");
    if (!app.doc) return;
    const handle = activeSfx() ? handleAt(event) : null;
    showEndHint(Boolean(handle && (handle.kind === "end0" || handle.kind === "end1")));
    if (handle) {
      stage.style.cursor = handle.kind === "letterTurn" ? "grab" : handle.kind === "letterSize" ? "nwse-resize" : "move";
      return;
    }
    stage.style.cursor = letterAt(point) ? "move" : "crosshair";
  };

  /* ------------------------------- the panel ------------------------------- */

  let freeDrawing = false;
  let panelKey = "";
  let panelRecipe = null;
  let panelRecipeJson = "";
  const el = (tag, className, parent, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  };
  const hex2 = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  const toHex = (c) => (c.red !== undefined ? `#${hex2(c.red)}${hex2(c.green)}${hex2(c.blue)}` : `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`);
  const fromHex = (hex) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });

  // A setting: its name, a slider and its number. Dragging the slider is one step of history.
  const slider = (parent, label, value, min, max, step, onChange, unit) => {
    const row = el("label", "sfx__slider", parent);
    el("span", "sfx__name", row, label).title = label;
    const range = el("input", "", row);
    range.type = "range";
    range.min = min;
    range.max = max;
    range.step = step;
    range.value = value;
    range.style.setProperty("--fill", (value - min) / (max - min));
    const number = el("input", "", row);
    number.type = "number";
    number.min = min;
    number.max = max;
    number.step = step;
    number.value = round(value, 10);
    if (unit) el("span", "sfx__unit", row, unit);
    const coalesce = `sfx-${label}-${Math.random()}`;
    range.addEventListener("input", () => {
      number.value = range.value;
      onChange(Number(range.value), coalesce);
    });
    number.addEventListener("change", () => {
      const v = clamp(Number(number.value) || 0, Number(min), Number(max));
      number.value = v;
      range.value = v;
      range.style.setProperty("--fill", (v - min) / (max - min));
      onChange(v, coalesce);
    });
    number.addEventListener("keydown", (event) => {
      if (event.key === "Enter") number.blur();
      event.stopPropagation();
    });
    return row;
  };
  const choice = (parent, label, value, options, onChange) => {
    const row = el("label", "sfx__row", parent);
    el("span", "sfx__name", row, label);
    const select = el("select", "", row);
    options.forEach(([key, text]) => {
      const option = el("option", "", select, text);
      option.value = key;
    });
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return select;
  };
  const check = (parent, label, value, onChange) => {
    const row = el("label", "sfx__check", parent);
    const input = el("input", "", row);
    input.type = "checkbox";
    input.checked = value;
    el("span", "", row, label);
    input.addEventListener("change", () => onChange(input.checked));
    return input;
  };
  const colour = (parent, value, onChange, title, coalesceKey) => {
    const input = el("input", "", parent);
    input.type = "color";
    input.title = title || T("Colour");
    input.setAttribute("aria-label", input.title);
    input.value = toHex(value);
    const coalesce = coalesceKey || `sfx-colour-${Math.random()}`;
    input.addEventListener("input", () => onChange(fromHex(input.value), coalesce));
    return input;
  };
  const button = (parent, label, action, className) => {
    const node = el("button", `btn btn--small${className ? " " + className : ""}`, parent, label);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  };
  const section = (parent, title, open, id) => {
    const details = el("details", "sfx__section", parent);
    const stored = readStore("typer.web.sfx.open", {});
    details.open = stored[id] !== undefined ? stored[id] : open;
    el("summary", "", details, title);
    details.addEventListener("toggle", () => {
      const now = readStore("typer.web.sfx.open", {});
      now[id] = details.open;
      writeStore("typer.web.sfx.open", now);
    });
    return el("div", "sfx__body", details);
  };

  // The word field of the options bar: a new SFX's word is typed there at once
  let barWord = null;
  let optionsKey = "";
  const recipeNow = (group) => (group && app.doc ? settledNow(app.doc, group).recipe : defaults);
  // The bar, the panel and the page shown again: what was picked has changed
  const showAll = () => {
    drawOverlay();
    optionsKey = "";
    renderOptions();
    renderPanel(true);
  };
  const focusText = () => {
    showAll();
    if (barWord) {
      barWord.focus({ preventScroll: true });
      barWord.select();
    }
  };

  // The letters' size as it shows: on a path that sets it, what the path makes of it
  const shownSize = (recipe, group) => {
    const fitting = recipe.path.kind === "free" || recipe.path.length > 0;
    return round(fitting && group && app.doc ? recipe.size * layoutNow(recipe, app.doc).fit * recipe.scale : recipe.size * recipe.scale, 10);
  };
  // A path drawn by hand grows with its letters; on the others, a size typed sets the size and
  // the path no longer decides it
  const sizeTo = (value) => (r) => {
    if (r.path.kind === "free" && r.path.points && app.doc) {
      const now = r.size * layoutOf(r, app.doc).fit * r.scale;
      const factor = now > 0 ? value / now : 1;
      r.path.points = r.path.points.map(([x, y]) => [x * factor, y * factor]);
      return;
    }
    r.size = value / r.scale;
    r.path.length = 0;
  };

  const setFont = (face) => Fonts.ensure(face.postScriptName).then(() => edit((r) => { r.font = { ps: face.postScriptName, family: face.family, style: face.style }; }, null, "SFX"));
  const fontControls = (recipe) => {
    const family = el("button", "font-field obar__wide sfx__family");
    family.type = "button";
    family.title = T("Font");
    family.setAttribute("aria-label", T("Font"));
    el("span", "", family, recipe.font.family || recipe.font.ps);
    family.addEventListener("pointerdown", (event) => event.preventDefault());
    family.addEventListener("click", () => {
      App().openFontMenu(family, recipe.font.family, (familyName) => {
        const face = App().mainFace(App().facesOf(familyName));
        if (face) setFont(face);
      });
    });
    const faces = el("select", "");
    faces.title = T("Font style");
    faces.setAttribute("aria-label", T("Font style"));
    const list = App().facesOf(recipe.font.family);
    (list.length ? list : [{ postScriptName: recipe.font.ps, style: recipe.font.style }]).forEach((face) => {
      const option = el("option", "", faces, face.style);
      option.value = face.postScriptName;
    });
    faces.value = recipe.font.ps;
    faces.addEventListener("change", () => {
      const face = Fonts.get(faces.value);
      if (face) setFont(face);
    });
    return [family, faces];
  };

  // The shapes of the path, drawn
  const SHAPES = [
    ["line", "Straight", '<path d="M2 8h12"/>'],
    ["arc", "Arc", '<path d="M2 12Q8 1 14 12"/>'],
    ["wave", "Wave", '<path d="M1.5 8C3 3.5 5 3.5 6.5 8S10 12.5 11.5 8 14 4.5 14.5 5.5"/>'],
    ["stairs", "Stairs", '<path d="M2 13.5h3v-3h3v-3h3v-3h3"/>'],
    ["vertical", "Stacked (tall spaces)", '<path d="M5 3h6M5 8h6M5 13h6"/>'],
    ["circle", "Circle (burst)", '<circle cx="8" cy="8" r="3.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>'],
    ["free", "Drawn by hand", '<path d="M2 12C3.5 5 5.5 4 6.5 8.5S10 12 11 7s2.5-3.5 3-2.5"/>'],
  ];
  const DICE = '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><circle class="sfx-dot" cx="5.5" cy="5.5" r="1"/><circle class="sfx-dot" cx="10.5" cy="10.5" r="1"/><circle class="sfx-dot" cx="8" cy="8" r="1"/><circle class="sfx-dot" cx="10.5" cy="5.5" r="1"/><circle class="sfx-dot" cx="5.5" cy="10.5" r="1"/>';
  const BACK = '<path d="M10 3.5 5.5 8l4.5 4.5"/>';
  const HELP = '<circle cx="8" cy="8" r="6.5"/><path d="M6.1 6.2a2 2 0 0 1 3.9.6c0 1.3-2 2-2 2"/><path d="M8 11.3h.01"/>';
  const helpButton = (bar) => {
    if (!window.TypeRSFXGuide) return;
    const node = iconButton(bar, HELP, T("SFX guide: every shortcut, and a 2-minute practice"), false, () => window.TypeRSFXGuide.show());
    node.classList.add("sfx__help");
  };
  const iconButton = (parent, inner, title, on, action) => {
    const node = el("button", "icon-btn" + (on ? " is-on" : ""), parent);
    node.type = "button";
    node.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${inner}</svg>`;
    node.title = title;
    node.setAttribute("aria-label", title);
    node.setAttribute("aria-pressed", String(Boolean(on)));
    node.addEventListener("click", action);
    return node;
  };
  // With no SFX chosen, "drawn by hand" is how the next drag lays it out
  const shapeShown = (recipe, group) => (!group && freeDrawing ? "free" : recipe.path.kind);
  const pickShape = (value, group) => {
    if (value === "free") {
      if (!group) {
        freeDrawing = true;
        showAll();
        return;
      }
      const r = recipeNow(group);
      if (!(r.path.points && r.path.points.length > 1)) {
        App().toast(T("Alt + drag with the SFX tool draws a path."));
        return;
      }
    } else if (!group) freeDrawing = false;
    edit((r) => { r.path.kind = value; }, null, "SFX");
  };
  const shapeButtons = (parent, recipe, group) => {
    const box = el("span", "obar__group sfx__shapes", parent);
    const current = shapeShown(recipe, group);
    SHAPES.forEach(([value, name, inner]) => iconButton(box, inner, T(name), current === value, () => pickShape(value, group)));
    return box;
  };

  const builtinLook = (item) => Object.assign(lookOf(BASE, false), item.look, { path: Object.assign({}, lookOf(BASE, false).path, item.look.path) });
  const presetOptions = () => [["", T("Preset…")]].concat(BUILTIN.map((item) => [`b:${item.id}`, T(item.name)]), presets.map((item, i) => [`u:${i}`, item.name]));
  const pickPreset = (value) => {
    if (value.startsWith("b:")) {
      const item = BUILTIN.find((preset) => preset.id === value.slice(2));
      // A built-in preset is a whole look: what it doesn't say goes back to the start
      if (item) applyLook(builtinLook(item), "SFX Preset");
    } else if (value.startsWith("u:")) {
      const item = presets[Number(value.slice(2))];
      if (item) applyLook(item.look, "SFX Preset");
    }
  };
  const reroll = () => edit((recipe) => { recipe.seed = 1 + Math.floor(Math.random() * 100000); }, null, "SFX Dice");

  /* ----------------------------- a letter, by hand ----------------------------- */

  // What changes on a letter goes to its pin when it has one, to its own changes otherwise
  const touch = (letter, change) => {
    if (letter.lock) change(letter.lock, true);
    else {
      letter.o = Object.assign({ dx: 0, dy: 0, rot: 0, scale: 1, sx: 1 }, letter.o);
      change(letter.o, false);
    }
  };
  const poseNow = (recipe, key) => layoutNow(recipe, app.doc).letters.find((item) => item.key === key);
  const turnLetterTo = (key, value, coalesce) => editLetter(key, (l, r) => {
    const now = poseNow(r, key);
    const delta = value - (now ? now.rot - r.angle : 0);
    touch(l, (o) => { o.rot += delta; });
  }, coalesce);
  const sizeLetterTo = (key, value, coalesce) => editLetter(key, (l, r) => {
    const now = poseNow(r, key);
    const factor = now && now.size > 0 ? value / now.size : 1;
    touch(l, (o, locked) => {
      if (locked) o.size *= factor;
      else o.scale *= factor;
    });
  }, coalesce);
  // Arrows: on the page, so the SFX's own angle and scale are undone first
  const nudgeLetter = (key, dx, dy) => editLetter(key, (l, r) => {
    const c = Math.cos(rad(r.angle));
    const s = Math.sin(rad(r.angle));
    const lx = (c * dx + s * dy) / r.scale;
    const ly = (-s * dx + c * dy) / r.scale;
    touch(l, (o, locked) => {
      if (locked) {
        o.x += lx;
        o.y += ly;
      } else {
        o.dx += lx;
        o.dy += ly;
      }
    });
  }, "sfx-key-move");
  const turnLetterBy = (key, delta) => editLetter(key, (l) => touch(l, (o) => { o.rot += delta; }), "sfx-key-turn");
  const scaleLetterBy = (key, factor) => editLetter(key, (l) => touch(l, (o, locked) => {
    if (locked) o.size *= factor;
    else o.scale *= factor;
  }), "sfx-key-size");
  const stepLetter = (group, direction) => {
    const recipe = recipeNow(group);
    const list = recipe.letters.filter((letter) => isShown(recipe, letter));
    if (!list.length) return;
    const at = list.findIndex((letter) => picked && letter.key === picked.key);
    const next = list[(at + direction + list.length) % list.length];
    picked = { group: group.id, key: next.key };
    showAll();
  };
  // A double-click or Enter on a letter: the word, with that letter selected in it, to type over
  const retype = (key) => {
    const group = activeSfx();
    if (!group) return;
    const recipe = recipeNow(group);
    const at = recipe.letters.findIndex((letter) => letter.key === key);
    if (at < 0) return;
    showAll();
    const start = recipe.letters.slice(0, at).map((letter) => letter.ch).join("").length;
    // After the click that asked for it, which would take the focus back to the page
    setTimeout(() => {
      if (!barWord) return;
      barWord.focus({ preventScroll: true });
      barWord.setSelectionRange(start, start + recipe.letters[at].ch.length);
    }, 30);
  };

  /* ------------------------------- the options bar ------------------------------- */

  const renderOptions = () => {
    if (app.tool === "sfx" && App() && App().renderOptions) App().renderOptions();
  };
  // What the bar shows: when that changes, it is drawn again
  const barKey = () => {
    const group = activeSfx();
    const recipe = recipeNow(group);
    const key = pickedLetter(group);
    const letter = key !== null ? recipe.letters.find((item) => item.key === key) : null;
    const pose = letter && app.doc ? poseNow(recipe, key) : null;
    return JSON.stringify([group ? group.id : null, key, pose ? [round(pose.rot, 10), round(pose.size, 10)] : null, letter ? [Boolean(letter.lock), Boolean(letter.o)] : null, Boolean(selection()), recipe.text, recipe.font, shownSize(recipe, group), recipe.color, recipe.path.kind, recipe.chaos, recipe.stroke.enabled, recipe.stroke.color, recipe.stroke.size, freeDrawing, presets.length, Fonts.generation]);
  };
  const wordField = (bar, recipe, group, width) => {
    const word = el("input", "sfx__barword", bar);
    word.type = "text";
    word.value = recipe.text;
    word.placeholder = T("The sound, as it reads: BOOM, CRACK…");
    word.title = T("SFX text");
    word.setAttribute("aria-label", T("SFX text"));
    word.spellcheck = false;
    word.style.width = `${width}px`;
    word.addEventListener("input", () => edit((r) => relink(r, word.value), `sfx-word-${group ? group.id : 0}`, "SFX Text"));
    word.addEventListener("keydown", (event) => {
      event.stopPropagation();
      // The word is typed into the document: Cmd+Z undoes it there, and then the SFX placed,
      // not the field's own memory, which never saw the word the click put in
      if (event.key.toLowerCase() === "z" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        if (event.shiftKey) ops.redo();
        else ops.undo();
        return;
      }
      if (event.key === "Enter" || event.key === "Escape") {
        word.blur();
        $("stage").focus({ preventScroll: true });
      }
    });
    barWord = word;
    return word;
  };
  const presetSelect = (bar) => {
    const preset = el("select", "sfx__preset", bar);
    preset.setAttribute("aria-label", T("Preset"));
    preset.title = T("Preset");
    presetOptions().forEach(([value, text]) => {
      const option = el("option", "", preset, text);
      option.value = value;
    });
    preset.addEventListener("change", () => {
      pickPreset(preset.value);
      preset.value = "";
    });
  };
  // A field let go of: the bar shows what it now says
  const watchBar = (bar) => {
    if (bar.dataset.sfxWatched) return;
    bar.dataset.sfxWatched = "1";
    bar.addEventListener("focusout", () => setTimeout(() => {
      if (app.tool !== "sfx" || bar.contains(document.activeElement)) return;
      optionsKey = "";
      refresh();
    }, 0));
  };
  const options = (bar) => {
    const A = App();
    const group = activeSfx();
    const recipe = recipeNow(group);
    const gid = group ? group.id : 0;
    optionsKey = barKey();
    barWord = null;
    watchBar(bar);

    // A letter picked on the page: the bar is that letter's
    const key = pickedLetter(group);
    const letter = key !== null ? recipe.letters.find((item) => item.key === key) : null;
    const pose = letter && app.doc ? poseNow(recipe, key) : null;
    if (letter && pose) {
      iconButton(bar, BACK, T("Back to the whole SFX"), false, () => {
        picked = null;
        showAll();
      });
      wordField(bar, recipe, group, 120);
      const name = el("span", "obar__hint sfx__letter-name", bar, fill(T("Letter {letter}"), { letter: `“${letter.ch}”` }));
      name.title = T("Arrows move it, [ and ] turn it, + and − resize it, Tab goes to the next letter, Enter or a double-click retypes it.");
      const turn = A.numberInput(round(pose.rot - recipe.angle, 10), -360, 360, (value) => turnLetterTo(key, value, `sfx-bar-turn-${gid}`), 0.5);
      turn.title = T("Turn");
      bar.appendChild(A.scrubbed(T("Turn"), turn));
      const size = A.numberInput(round(pose.size, 10), 1, 2000, (value) => { if (value > 0) sizeLetterTo(key, value, `sfx-bar-letter-size-${gid}`); }, 0.5);
      size.title = T("Size");
      bar.appendChild(A.scrubbed(T("Size"), size));
      const actions = el("span", "sfx__acts", bar);
      const pin = button(actions, letter.lock ? T("Unpin") : T("Pin"), () => pinLetter(key, !letter.lock), letter.lock ? "is-on" : "");
      pin.title = T("A pinned letter stays as it is when the dice are thrown again");
      button(actions, T("Longer"), () => elongate(key)).title = T("Repeat this letter: BOM, BOOM, BOOOM");
      button(actions, T("Reset"), () => editLetter(key, (l) => { l.o = null; l.lock = null; }, null, "SFX Letter")).disabled = !letter.o && !letter.lock;
      button(actions, T("Remove"), () => removeLetter(key));
      helpButton(bar);
      return;
    }

    wordField(bar, recipe, group, 140);

    // A selection: what to do with the original SFX under it
    if (selection()) {
      presetSelect(bar);
      el("span", "obar__hint", bar, T("Original SFX"));
      const actions = el("span", "sfx__acts", bar);
      button(actions, T("Fit in the selection"), fitToSelection);
      button(actions, T("Follow the original"), async () => {
        await followSelection();
        ops.deselect();
      });
      button(actions, T("Replace the original"), replaceOriginal);
      button(actions, T("Subtitle beside it"), subtitle);
      if (group) button(actions, T("Hide under the selection"), hideUnderSelection);
      helpButton(bar);
      return;
    }

    const [family, faces] = fontControls(recipe);
    bar.append(family, faces);
    const size = A.numberInput(shownSize(recipe, group), 1, 2000, (value) => { if (value > 0) edit(sizeTo(value), `sfx-bar-size-${gid}`, "SFX"); }, 0.5);
    size.title = recipe.path.kind === "free" || recipe.path.length > 0 ? T("The letters fill their path: drag an end of the path, or set a size here to stop that.") : T("Size");
    bar.appendChild(A.scrubbed(T("Size"), size));
    colour(bar, recipe.color, (c, coalesce) => edit((r) => { r.color = { red: c.r, green: c.g, blue: c.b }; }, coalesce, "SFX"), T("Text colour"), `sfx-bar-colour-${gid}`);
    shapeButtons(bar, recipe, group);
    const chance = el("span", "sfx__pair", bar);
    const chaos = A.numberInput(recipe.chaos, 0, 200, (value) => edit((r) => { r.chaos = value; }, `sfx-bar-chaos-${gid}`, "SFX"));
    chaos.title = T("Chaos");
    chance.appendChild(A.scrubbed(T("Chaos"), chaos));
    iconButton(chance, DICE, T("Throw the dice again: new chance, same settings"), false, reroll);
    const outline = el("span", "sfx__pair", bar);
    outline.appendChild(A.checkbox(T("Stroke"), recipe.stroke.enabled, (on) => edit((r) => { r.stroke.enabled = on; }, null, "SFX")));
    colour(outline, recipe.stroke.color, (c, coalesce) => edit((r) => { r.stroke.color = c; r.stroke.enabled = true; }, coalesce, "SFX"), T("Stroke colour"), `sfx-bar-stroke-colour-${gid}`);
    const width = A.numberInput(recipe.stroke.size, 1, 40, (value) => edit((r) => { r.stroke.size = value; r.stroke.enabled = true; }, `sfx-bar-stroke-${gid}`, "SFX"), 0.5);
    width.title = T("Width");
    width.disabled = !recipe.stroke.enabled;
    outline.appendChild(width);
    el("span", "sfx__unit", outline, "px");
    presetSelect(bar);
    helpButton(bar);
  };

  /* --------------------------- previews of the looks --------------------------- */

  // A look shown with the word being made, drawn by the page's own engine on a page of its own
  const thumbs = new Map();
  let thumbJobs = [];
  let thumbTimer = 0;
  const thumbWord = (recipe) => graphemes(String(recipe.text || "").trim()).slice(0, 10).join("") || "BOOM";
  // Every preview at about the same size, its outline with it, so that none is blurred up
  const atThumbSize = (r, doc) => {
    const f = clamp(80 / Math.max(1, (r.size * r.scale * doc.resolution) / 72), 0.2, 8);
    r.scale *= f;
    r.stroke.size *= f;
    r.stroke.outer.size *= f;
    r.relief.dx *= f;
    r.relief.dy *= f;
    if (r.path.points) r.path.points = r.path.points.map(([x, y]) => [x * f, y * f]);
    return r;
  };
  const thumbRecipe = (spec, doc) => {
    const middle = [doc.width / 2, doc.height / 2];
    let r;
    if (spec.recipe) {
      r = normal(clone(spec.recipe));
      r.origin = middle;
      r.source = r.source && spec.sourceLocal ? Object.assign({}, r.source, { at: toPage(r, r.source.at[0], r.source.at[1]) }) : null;
      if (r.source) {
        const k = r.scale;
        atThumbSize(r, doc);
        const f = r.scale / k;
        r.source.at = [middle[0] + (r.source.at[0] - middle[0]) * f, middle[1] + (r.source.at[1] - middle[1]) * f];
        return r;
      }
      return atThumbSize(r, doc);
    }
    r = normal(clone(spec.from));
    r.letters = [];
    r.next = 1;
    relink(r, spec.word);
    r.origin = middle;
    r.angle = 0;
    r.scale = 1;
    r.source = null;
    r.path = Object.assign({}, r.path, { length: 0, points: null, kind: r.path.kind === "free" ? "line" : r.path.kind });
    r = atThumbSize(withLook(r, spec.look), doc);
    if (spec.look.source) r.source = { at: [middle[0], middle[1] + ((r.size * r.scale * doc.resolution) / 72) * 2], amount: spec.look.source.amount, radial: spec.look.source.radial };
    return r;
  };
  const drawArt = (doc, recipe) => {
    const group = { id: "sfx-thumb", kind: "group", name: "", visible: true, opacity: 1, blend: "normal", open: false, group: null };
    const layers = laidLayers(doc, group, recipe, [group]);
    doc.state.layers = layers;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    layers.forEach((layer) => {
      if (layer.kind !== "text") return;
      const visual = PS.visualOf(layer, doc);
      if (!visual || !visual.canvas || !visual.canvas.width) return;
      left = Math.min(left, visual.x);
      top = Math.min(top, visual.y);
      right = Math.max(right, visual.x + visual.canvas.width);
      bottom = Math.max(bottom, visual.y + visual.canvas.height);
    });
    if (!(right > left && bottom > top)) return null;
    const folder = layers.find((layer) => layer.id === group.id);
    const stroke = folder && folder.stroke && folder.stroke.enabled ? folder.stroke : null;
    const reach = Math.ceil(stroke ? stroke.size + ((stroke.outer && stroke.outer.size) || 0) + 2 : 2);
    left = Math.floor(left - reach);
    top = Math.floor(top - reach);
    const art = PS.newCanvas(Math.ceil(right + reach - left), Math.ceil(bottom + reach - top));
    const ctx = art.getContext("2d", { willReadFrequently: true });
    PS.paintDoc(doc, ctx, { x: -left, y: -top, keep: true });
    // The layers' pictures have room around their letters: the preview keeps only the ink
    const { data, width, height } = ctx.getImageData(0, 0, art.width, art.height);
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] < 12) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < x0) return null;
    const ink = PS.newCanvas(x1 - x0 + 1, y1 - y0 + 1);
    ink.getContext("2d").drawImage(art, -x0, -y0);
    return ink;
  };
  // Drawn at once if it was drawn before; `cachedOnly` leaves the others for later
  const paintThumb = (canvas, spec, cachedOnly) => {
    const resolution = app.doc ? app.doc.resolution : 72;
    const doc = { id: "sfx-thumbs", width: 8000, height: 4000, resolution, state: { layers: [], activeIds: [] } };
    const recipe = thumbRecipe(spec, doc);
    const key = JSON.stringify([recipe, resolution, Fonts.generation]);
    let art = thumbs.get(key);
    if (art === undefined) {
      if (cachedOnly) return false;
      if (!fontsReady(recipe) && !spec.waited) {
        spec.waited = true;
        ensureFont(recipe).then(() => { if (canvas.isConnected) queueThumb(canvas, spec); });
        return true;
      }
      art = drawArt(doc, recipe);
      thumbs.set(key, art);
      if (thumbs.size > 80) thumbs.delete(thumbs.keys().next().value);
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!art) return true;
    const pad = 8;
    const k = Math.min((canvas.width - pad * 2) / art.width, (canvas.height - pad * 2) / art.height, 1.5);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(art, (canvas.width - art.width * k) / 2, (canvas.height - art.height * k) / 2, art.width * k, art.height * k);
    return true;
  };
  const runThumbs = () => {
    thumbTimer = 0;
    const started = performance.now();
    while (thumbJobs.length && performance.now() - started < 14) {
      const [canvas, spec] = thumbJobs.shift();
      if (!canvas.isConnected) continue;
      try {
        paintThumb(canvas, spec, false);
      } catch (error) {
        console.warn("SG Typer Studio: could not draw an SFX preview", error);
      }
    }
    if (thumbJobs.length) thumbTimer = setTimeout(runThumbs, 16);
  };
  const queueThumb = (canvas, spec) => {
    thumbJobs = thumbJobs.filter(([other]) => other.isConnected && other !== canvas);
    thumbJobs.push([canvas, spec]);
    if (!thumbTimer) thumbTimer = setTimeout(runThumbs, 40);
  };

  /* --------------------------------- the panel --------------------------------- */

  let galleryTab = readStore("typer.web.sfx.tab", "styles") === "bank" ? "bank" : "styles";
  const tile = (grid, name, action, spec, remove, removeTitle) => {
    const node = el("div", "sfx__tile", grid);
    const pick = el("button", "sfx__tile-pick", node);
    pick.type = "button";
    pick.title = name;
    pick.setAttribute("aria-label", name);
    const canvas = el("canvas", "sfx__thumb", pick);
    canvas.width = 220;
    canvas.height = 100;
    el("span", "sfx__tile-name", pick, name);
    pick.addEventListener("click", action);
    if (remove) {
      const x = button(node, "×", remove, "sfx__tile-x");
      x.title = removeTitle;
      x.setAttribute("aria-label", removeTitle);
    }
    let drawn = false;
    try {
      drawn = paintThumb(canvas, spec, true);
    } catch (error) {
      drawn = true;
    }
    if (!drawn) queueThumb(canvas, spec);
  };
  const addTile = (grid, label, title, action) => {
    const node = el("div", "sfx__tile sfx__tile--add", grid);
    const pick = el("button", "sfx__tile-pick", node);
    pick.type = "button";
    pick.title = title;
    pick.setAttribute("aria-label", title);
    el("span", "sfx__plus", pick, "+");
    el("span", "sfx__tile-name", pick, label);
    pick.addEventListener("click", action);
  };
  const gallery = (host, recipe, group) => {
    const box = el("div", "sfx__gallery", host);
    const tabs = el("div", "sfx__tabs", box);
    [["styles", T("Styles")], ["bank", T("SFX bank")]].forEach(([id, name]) => {
      const tab = button(tabs, name, () => {
        galleryTab = id;
        writeStore("typer.web.sfx.tab", id);
        renderPanel(true);
      }, `sfx__tab${galleryTab === id ? " is-on" : ""}`);
      tab.setAttribute("aria-pressed", String(galleryTab === id));
    });
    const grid = el("div", "sfx__tiles", box);
    const word = thumbWord(recipe);
    if (galleryTab === "styles") {
      BUILTIN.forEach((item) => tile(grid, T(item.name), () => pickPreset(`b:${item.id}`), { look: builtinLook(item), word, from: recipe }));
      presets.forEach((item, i) => tile(grid, item.name, () => pickPreset(`u:${i}`), { look: item.look, word, from: recipe }, () => {
        presets.splice(i, 1);
        writeStore(STORE_PRESETS, presets);
        renderPanel(true);
        optionsKey = "";
        renderOptions();
      }, T("Delete this preset")));
      addTile(grid, T("Save…"), T("Save as a preset"), savePreset);
      return;
    }
    bank.forEach((item, i) => tile(grid, item.name, () => placeFromBank(item), { recipe: item.recipe, sourceLocal: item.sourceLocal }, () => {
      bank.splice(i, 1);
      writeStore(STORE_BANK, bank);
      renderPanel(true);
    }, T("Remove from the bank")));
    if (group) addTile(grid, T("Keep in the bank…"), T("Keep in the SFX bank"), keepInBank);
    if (!bank.length) el("p", "sfx__hint", box, T("SFX kept here can be placed on any page, letters and all."));
  };
  // What is rarely set, folded away under "More"
  const more = (parent, id) => {
    const details = el("details", "sfx__more", parent);
    const stored = readStore("typer.web.sfx.open", {});
    details.open = Boolean(stored[id]);
    el("summary", "", details, T("More"));
    details.addEventListener("toggle", () => {
      const now = readStore("typer.web.sfx.open", {});
      now[id] = details.open;
      writeStore("typer.web.sfx.open", now);
    });
    return el("div", "sfx__body", details);
  };
  // An effect given to the SFX: its name, a cross to take it off, its settings
  const effect = (parent, name, remove, removeTitle, title) => {
    const box = el("div", "sfx__fx", parent);
    const head = el("div", "sfx__fx-head", box);
    const label = el("span", "", head, name);
    if (title) label.title = title;
    const x = button(head, "×", remove, "sfx__fx-x");
    x.title = removeTitle || T("Remove this effect");
    x.setAttribute("aria-label", x.title);
    return el("div", "sfx__fx-body", box);
  };
  const addEffect = (id) => {
    if (id === "mask") {
      hideUnderSelection();
      return;
    }
    edit((r) => {
      if (id === "hollow") {
        r.hollow = true;
        r.stroke.enabled = true;
      }
      if (id === "relief") r.relief.enabled = true;
      if (id === "echo") r.echo.enabled = true;
      if (id === "source" && !r.source) {
        const kept = storedSource() || { amount: 50, radial: 50 };
        const below = toPage(r, 0, ((r.size * (app.doc ? app.doc.resolution : 72)) / 72) * 2);
        r.source = { at: below, amount: kept.amount, radial: kept.radial };
      }
    }, null, "SFX");
  };

  const renderPanel = (force) => {
    const host = $("sfx");
    if (!host || !App()) return;
    const pane = $("pane-sfx");
    if (pane && pane.hidden && !force) return;
    const active = document.activeElement;
    if (!force && host.contains(active) && (active.tagName === "INPUT" || active.tagName === "SELECT") && active.type !== "checkbox" && active.type !== "button") return;
    const group = activeSfx();
    const recipe = recipeNow(group);
    const shownKey = JSON.stringify([group ? group.id : null, group ? group.name : "", Boolean(group && group.mask), Fonts.generation, presets.length, bank.length, freeDrawing, Boolean(selection()), galleryTab]);
    // The same recipe object is the same recipe; another one is read through only when it is new
    if (recipe !== panelRecipe) {
      const json = JSON.stringify(recipe);
      panelRecipe = recipe;
      if (json !== panelRecipeJson) {
        panelRecipeJson = json;
        panelKey = "";
      }
    }
    if (!force && shownKey === panelKey) return;
    panelKey = shownKey;
    const scroll = host.scrollTop;
    host.textContent = "";

    el("div", "sfx__head", host, group ? group.name : T("Settings for the next SFX"));
    gallery(host, recipe, group);

    // The path, and the size of the letters along it
    const path = section(host, T("Path"), true, "path");
    shapeButtons(path, recipe, group).setAttribute("aria-label", T("Shape"));
    if (recipe.path.kind === "arc") slider(path, T("Bend"), recipe.path.bend, -100, 100, 1, (value, coalesce) => edit((r) => { r.path.bend = value; }, coalesce, "SFX"));
    if (recipe.path.kind === "wave") {
      slider(path, T("Height"), recipe.path.amp, 0, 200, 1, (value, coalesce) => edit((r) => { r.path.amp = value; }, coalesce, "SFX"), "%");
      slider(path, T("Waves"), recipe.path.waves, 0.25, 6, 0.25, (value, coalesce) => edit((r) => { r.path.waves = value; }, coalesce, "SFX"));
    }
    if (recipe.path.kind === "stairs") slider(path, T("Step"), recipe.path.step, -100, 100, 1, (value, coalesce) => edit((r) => { r.path.step = value; }, coalesce, "SFX"), "%");
    slider(path, T("Angle"), round(recipe.angle, 10), -180, 180, 0.5, (value, coalesce) => edit((r) => { r.angle = value; }, coalesce, "SFX"), "°");
    slider(path, T("Letter turn"), round(Number(recipe.turn) || 0, 10), -180, 180, 0.5, (value, coalesce) => edit((r) => { r.turn = value; }, coalesce, "SFX"), "°").title = T("Every letter turned on itself, the path staying as it is (Alt + drag an end of the path)");
    slider(path, T("Spacing"), recipe.spacing, -80, 120, 1, (value, coalesce) => edit((r) => { r.spacing = value; }, coalesce, "SFX"), "%");
    choice(path, T("Size"), recipe.curve.kind, [["flat", T("Even")], ["grow", T("Growing")], ["shrink", T("Shrinking")], ["peak", T("Loudest letter")]], (value) => edit((r) => { r.curve.kind = value; }, null, "SFX")).title = T("Size along the word");
    if (recipe.curve.kind !== "flat") slider(path, T("Amount"), recipe.curve.amount, 0, 150, 1, (value, coalesce) => edit((r) => { r.curve.amount = value; }, coalesce, "SFX"), "%");
    if (recipe.curve.kind === "peak") {
      const shown = recipe.letters.filter((letter) => isShown(recipe, letter));
      choice(path, T("Loudest"), String(clamp(Math.round(recipe.curve.peak), 0, Math.max(0, shown.length - 1))), shown.map((letter, i) => [String(i), `${i + 1}: ${letter.ch}`]), (value) => edit((r) => { r.curve.peak = Number(value); }, null, "SFX"));
    }
    const pathMore = more(path, "path-more");
    check(pathMore, T("Letters turn with the path"), recipe.follow, (on) => edit((r) => { r.follow = on; }, null, "SFX"));
    slider(pathMore, T("Zigzag"), recipe.zigzag, -25, 25, 0.5, (value, coalesce) => edit((r) => { r.zigzag = value; }, coalesce, "SFX"), "°");
    slider(pathMore, T("Lean"), recipe.slant, -25, 25, 0.5, (value, coalesce) => edit((r) => { r.slant = value; }, coalesce, "SFX"), "°");
    slider(pathMore, T("Perspective"), recipe.perspective, -100, 100, 1, (value, coalesce) => edit((r) => { r.perspective = value; }, coalesce, "SFX"), "%");
    slider(pathMore, T("Bulge"), recipe.bulge, -100, 100, 1, (value, coalesce) => edit((r) => { r.bulge = value; }, coalesce, "SFX"), "%");
    choice(pathMore, T("In front"), recipe.stack, [["left", T("Left letters on top")], ["right", T("Right letters on top")], ["alternate", T("Alternating")]], (value) => edit((r) => { r.stack = value; }, null, "SFX"));
    check(pathMore, T("Drop the punctuation (a sound isn't an exclamation)"), recipe.noPunctuation, (on) => edit((r) => { r.noPunctuation = on; }, null, "SFX"));

    // Chance: one setting, its parts under "More"
    const chance = section(host, T("Chance"), true, "chaos");
    slider(chance, T("Chaos"), recipe.chaos, 0, 200, 1, (value, coalesce) => edit((r) => { r.chaos = value; }, coalesce, "SFX"), "%");
    const chanceMore = more(chance, "chaos-more");
    slider(chanceMore, T("Rotation"), recipe.jitter.rotate, 0, 35, 0.5, (value, coalesce) => edit((r) => { r.jitter.rotate = value; }, coalesce, "SFX"), "°");
    slider(chanceMore, T("Size"), recipe.jitter.size, 0, 45, 1, (value, coalesce) => edit((r) => { r.jitter.size = value; }, coalesce, "SFX"), "%");
    slider(chanceMore, T("Up and down"), recipe.jitter.shift, 0, 40, 1, (value, coalesce) => edit((r) => { r.jitter.shift = value; }, coalesce, "SFX"), "%");
    slider(chanceMore, T("Stretch"), recipe.jitter.stretch, 0, 30, 1, (value, coalesce) => edit((r) => { r.jitter.stretch = value; }, coalesce, "SFX"), "%");
    slider(chanceMore, T("Skew"), recipe.jitter.skew, 0, 15, 0.5, (value, coalesce) => edit((r) => { r.jitter.skew = value; }, coalesce, "SFX"), "°");

    // The outline, then the effects given to this SFX, and a way to add one
    const look = section(host, T("Outline and effects"), true, "look");
    const strokeRow = el("div", "sfx__row", look);
    check(strokeRow, T("Stroke"), recipe.stroke.enabled, (on) => edit((r) => { r.stroke.enabled = on; }, null, "SFX"));
    colour(strokeRow, recipe.stroke.color, (c, coalesce) => edit((r) => { r.stroke.color = c; }, coalesce, "SFX"), T("Stroke colour"));
    if (recipe.stroke.enabled) {
      slider(look, T("Width"), recipe.stroke.size, 1, 40, 0.5, (value, coalesce) => edit((r) => { r.stroke.size = value; }, coalesce, "SFX"), "px");
      choice(look, T("Overlaps"), recipe.mode, [["cut", T("Cut (each letter)")], ["fusion", T("Fusion (one shape)")]], (value) => edit((r) => { r.mode = value; }, null, "SFX"));
      const outer = more(look, "outer-more");
      const outerRow = el("div", "sfx__row", outer);
      el("span", "sfx__name", outerRow, T("Outer stroke"));
      colour(outerRow, recipe.stroke.outer.color, (c, coalesce) => edit((r) => { r.stroke.outer.color = c; }, coalesce, "SFX"), T("Outer stroke colour"));
      slider(outer, T("Outer width"), recipe.stroke.outer.size, 0, 40, 0.5, (value, coalesce) => edit((r) => { r.stroke.outer.size = value; }, coalesce, "SFX"), "px");
    }
    if (recipe.hollow) effect(look, T("Hollow"), () => edit((r) => { r.hollow = false; }, null, "SFX"), null, T("Hollow: the drawing shows inside the letters"));
    if (recipe.relief.enabled) {
      const box = effect(look, T("Relief"), () => edit((r) => { r.relief.enabled = false; }, null, "SFX"));
      const row = el("div", "sfx__row", box);
      el("span", "sfx__name", row, T("Colour"));
      colour(row, recipe.relief.color, (c, coalesce) => edit((r) => { r.relief.color = c; }, coalesce, "SFX"), T("Relief colour"));
      slider(box, T("Across"), recipe.relief.dx, -40, 40, 0.5, (value, coalesce) => edit((r) => { r.relief.dx = value; }, coalesce, "SFX"), "px");
      slider(box, T("Down"), recipe.relief.dy, -40, 40, 0.5, (value, coalesce) => edit((r) => { r.relief.dy = value; }, coalesce, "SFX"), "px");
    }
    if (recipe.echo.enabled) {
      const box = effect(look, T("Echo"), () => edit((r) => { r.echo.enabled = false; }, null, "SFX"), null, T("Echo: the word again, bigger, behind"));
      slider(box, T("Copies"), recipe.echo.count, 1, 4, 1, (value, coalesce) => edit((r) => { r.echo.count = value; }, coalesce, "SFX"));
      slider(box, T("Growth"), recipe.echo.scale, 50, 250, 1, (value, coalesce) => edit((r) => { r.echo.scale = value; }, coalesce, "SFX"), "%");
      slider(box, T("Opacity"), recipe.echo.opacity, 1, 100, 1, (value, coalesce) => edit((r) => { r.echo.opacity = value; }, coalesce, "SFX"), "%");
    }
    if (recipe.source) {
      const box = effect(look, T("Source of the sound"), () => edit((r) => { r.source = null; }, null, "SFX"), null, T("The letters grow away from a point (drag the ◆)"));
      slider(box, T("Growth"), recipe.source.amount, 0, 150, 1, (value, coalesce) => edit((r) => { if (r.source) r.source.amount = value; }, coalesce, "SFX"), "%");
      slider(box, T("Facing away"), recipe.source.radial, 0, 100, 1, (value, coalesce) => edit((r) => { if (r.source) r.source.radial = value; }, coalesce, "SFX"), "%");
    }
    if (group && group.mask) effect(look, T("Hide under the selection"), clearMask, T("Show it whole"));
    const missing = [];
    if (!recipe.hollow) missing.push(["hollow", T("Hollow")]);
    if (!recipe.relief.enabled) missing.push(["relief", T("Relief")]);
    if (!recipe.echo.enabled) missing.push(["echo", T("Echo")]);
    if (!recipe.source) missing.push(["source", T("Source of the sound")]);
    if (group && !group.mask && selection()) missing.push(["mask", T("Hide under the selection")]);
    if (missing.length) {
      const add = el("select", "sfx__add", look);
      add.setAttribute("aria-label", T("Add an effect…"));
      [["", T("Add an effect…")]].concat(missing).forEach(([value, text]) => {
        const option = el("option", "", add, text);
        option.value = value;
      });
      add.addEventListener("change", () => {
        const value = add.value;
        add.value = "";
        if (value) addEffect(value);
      });
    }
    host.scrollTop = scroll;
  };

  /* ------------------------------- staying in step ------------------------------- */

  // The panel is there only while it's of use: with the SFX tool, or an SFX selected. It
  // opens and closes when that changes, so it can still be closed or opened by hand meanwhile.
  let wantedBefore = null;
  const followContext = () => {
    const workspace = window.TypeRWorkspace;
    if (!workspace || window.TypeRShell.touch) return;
    const wanted = app.tool === "sfx" || Boolean(activeSfx());
    if (wanted === wantedBefore) return;
    wantedBefore = wanted;
    if (workspace.isVisible("sfx") !== wanted) workspace.setVisible("sfx", wanted);
  };

  let pending = 0;
  const refresh = () => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      // A letter picked in an SFX that isn't active any more is let go
      const group = activeSfx();
      if (picked && (!group || group.id !== picked.group)) picked = null;
      followContext();
      drawOverlay();
      renderPanel(false);
      // The options bar follows the SFX selected, and what is done to it
      if (app.tool === "sfx" && barKey() !== optionsKey) renderOptions();
    });
  };
  PS.on((type, detail) => {
    // A part of the page redrawn is a stroke or a drag going on: only the SFX tool's own matter
    if (type === "render" && detail && app.tool !== "sfx") return;
    if (type === "render" || type === "history" || type === "view" || type === "document" || type === "selection" || type === "tabs") refresh();
    if (type === "paste" && detail) fromScript(detail.layers);
  });
  Fonts.onChange(() => {
    measures.clear();
    refresh();
  });
  // The letter picked, by the keyboard: arrows move it, [ and ] turn it, + and − resize it,
  // Tab goes to the next one, Enter retypes it, Delete takes it out, Escape lets it go
  document.addEventListener("keydown", (event) => {
    if (app.tool !== "sfx" || !app.doc || event.target.closest("input, textarea, select, [contenteditable]")) return;
    if (!App() || App().isEditing() || document.querySelector(".modal[open], dialog[open]")) return;
    // AltGr is Ctrl + Alt on Windows: [ and ] need it on a French keyboard
    if ((event.ctrlKey || event.metaKey) && !event.altKey) return;
    const group = activeSfx();
    const key = pickedLetter(group);
    if (key === null) return;
    const step = event.shiftKey ? 10 : 1;
    const k = event.key;
    if (k === "Escape") {
      picked = null;
      showAll();
    } else if (k === "ArrowLeft") nudgeLetter(key, -step, 0);
    else if (k === "ArrowRight") nudgeLetter(key, step, 0);
    else if (k === "ArrowUp") nudgeLetter(key, 0, -step);
    else if (k === "ArrowDown") nudgeLetter(key, 0, step);
    else if (k === "[" || k === "{") turnLetterBy(key, event.shiftKey ? -15 : -2);
    else if (k === "]" || k === "}") turnLetterBy(key, event.shiftKey ? 15 : 2);
    else if (k === "+" || k === "=") scaleLetterBy(key, event.shiftKey && k === "=" ? 1.2 : 1.05);
    else if (k === "-" || k === "_") scaleLetterBy(key, k === "_" ? 1 / 1.2 : 1 / 1.05);
    else if (k === "Tab") stepLetter(group, event.shiftKey ? -1 : 1);
    else if (k === "Enter") retype(key);
    else if (k === "Delete" || k === "Backspace") removeLetter(key);
    else return;
    event.preventDefault();
    event.stopPropagation();
    const KEY_ACTIONS = { Escape: "release", ArrowLeft: "move", ArrowRight: "move", ArrowUp: "move", ArrowDown: "move", "[": "turn", "{": "turn", "]": "turn", "}": "turn", "+": "size", "=": "size", "-": "size", _: "size", Tab: "step", Enter: "retype", Delete: "remove", Backspace: "remove" };
    tell({ mode: "key", action: KEY_ACTIONS[k] });
  }, true);

  // A double-click on a letter: type over it
  const stageNode = $("stage");
  if (stageNode) stageNode.addEventListener("dblclick", (event) => {
    if (app.tool !== "sfx" || !app.doc || event.altKey) return;
    const key = pickedLetter(activeSfx());
    if (key === null) return;
    retype(key);
    tell({ mode: "key", action: "retype" });
  });

  // The panel shows with the tool, the first time and whenever it was left hidden
  const toolChosen = (tool) => {
    if (tool === "sfx") {
      const workspace = window.TypeRWorkspace;
      if (workspace && !window.TypeRShell.touch && !workspace.isVisible("sfx")) workspace.setVisible("sfx", true);
      renderPanel(true);
      if (window.TypeRSFXGuide) window.TypeRSFXGuide.toolChosen();
    } else preview = null;
    followContext();
    drawOverlay();
  };

  const head = $("head-sfx");
  if (head) head.textContent = T("SFX");

  window.TypeRSFX = {
    down,
    move,
    up,
    hover,
    options,
    toolChosen,
    drawOverlay,
    convert,
    separate,
    duplicate,
    keepInBank,
    newSfx,
    fitToSelection,
    replaceOriginal,
    subtitle,
    hideUnderSelection,
    recipesForSave,
    activeSfx,
    settled: (group) => settled(app.doc, group),
    layoutOf: (recipe) => layoutOf(normal(recipe), app.doc),
    normal,
    relink,
    apply,
    edit,
    canConvert: () => Boolean(app.doc) && App().activeTexts().some((layer) => !sfxOf(app.doc, layer)),
    isSfx: (layer) => Boolean(app.doc && layer && sfxOf(app.doc, layer)),
    sfxOf: (layer) => (app.doc && layer ? sfxOf(app.doc, layer) : null),
    renderPanel,
    onGesture,
    setMark,
    defaultsSnapshot,
    // How a new SFX looks before anything is changed, the font and colour aside
    startingLook: () => lookOf(BASE),
    restoreDefaults: (snapshot) => {
      // The word field keeps the bar as it is while it is being typed in
      if (barWord && barWord === document.activeElement) barWord.blur();
      restoreDefaults(snapshot);
      if (app.tool === "sfx") showAll();
    },
    pickedLetter: () => pickedLetter(activeSfx()),
  };
})();
