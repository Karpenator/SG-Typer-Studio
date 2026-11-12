/* Photoshop Optical kerning: spacing from glyph silhouettes, not a fixed pair table.
 * The fitted coefficients and features mirror PhotoCraft's clean-room measurements of
 * Photoshop 2026 (Arial, Georgia, Times New Roman and Verdana). Browser glyph profiles
 * are rasterised once per face/grapheme and kept in em units. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TypeROpticalKerning = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SAMPLES = 48;
  const Y_LO = -0.25;
  const Y_HI = 1;
  const BAND_LO = -0.1;
  const DEPTH = 0.04;
  const NEAR = 0.1;
  const C0 = -0.0033;
  const C_MIN = 0.5384;
  const C_EXCESS = 0.5526;
  const C_NEAR = -0.1612;
  const LIMIT = 400;
  const SAMPLE_SIZE = 256;
  const caches = new Map();
  let canvasFactory = null;

  const sampleY = (i) => Y_LO + ((Y_HI - Y_LO) * (i + 0.5)) / SAMPLES;
  const finite = (v) => Number.isFinite(v) ? v : 0;
  const sizeAdjust = (size) => size > 0 ? 11 * Math.log(95 / Math.max(15, Math.min(95, size))) : 0;

  function pairFeatures(left, right) {
    if (!left || !right) return null;
    const gaps = [];
    for (let i = 0; i < SAMPLES; i++) {
      if (sampleY(i) < BAND_LO) continue;
      if (left.right[i] !== null && right.left[i] !== null) gaps.push(left.right[i] + right.left[i]);
    }
    if (!gaps.length) return null;
    const min = Math.min.apply(Math, gaps);
    const excess = gaps.reduce((sum, gap) => sum + Math.min(DEPTH, gap - min), 0) / gaps.length;
    return [min, excess];
  }

  function kernFromFeatures(features, reference) {
    if (!features || !reference) return 0;
    const k = 1000 * (C0 + C_MIN * (reference[0] - features[0]) +
      C_EXCESS * (reference[1] - features[1]) +
      C_NEAR * (Math.min(NEAR, reference[0]) - Math.min(NEAR, features[0])));
    return Number.isFinite(k) ? Math.max(-LIMIT, Math.min(LIMIT, k)) : 0;
  }

  function makeCanvas(w, h) {
    if (canvasFactory) return canvasFactory(w, h);
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      return canvas;
    }
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    return null;
  }

  function profile(cache, ctx, grapheme) {
    if (cache.profiles.has(grapheme)) return cache.profiles.get(grapheme);
    let result = null;
    // A space has no silhouette. Ligatures/composed clusters are measured as the browser shaped them.
    if (grapheme && !/^\s+$/u.test(grapheme)) {
      const profileFont = ctx.font.replace(/(\d+(?:\.\d+)?)px/, SAMPLE_SIZE + "px");
      const probe = makeCanvas(1, 1);
      const probeCtx = probe && probe.getContext("2d");
      if (probeCtx) probeCtx.font = profileFont;
      const advance = probeCtx ? probeCtx.measureText(grapheme).width : 0;
      if (advance > 0 && Number.isFinite(advance)) {
        const pad = Math.ceil(SAMPLE_SIZE * 0.35);
        const width = Math.ceil(advance + pad * 2 + 4);
        const height = Math.ceil(SAMPLE_SIZE * 1.7);
        const baseline = Math.ceil(SAMPLE_SIZE * 1.15);
        const canvas = makeCanvas(width, height);
        const g = canvas && canvas.getContext("2d", { willReadFrequently: true });
        if (g) {
          g.font = profileFont;
          if ("letterSpacing" in g) g.letterSpacing = "0px";
          g.textAlign = "left";
          g.textBaseline = "alphabetic";
          if ("fontKerning" in g) g.fontKerning = "none";
          g.fillStyle = "#fff";
          g.fillText(grapheme, pad, baseline);
          const pixels = g.getImageData(0, 0, width, height).data;
          const left = Array(SAMPLES).fill(null);
          const right = Array(SAMPLES).fill(null);
          for (let i = 0; i < SAMPLES; i++) {
            const y = Math.max(0, Math.min(height - 1, Math.round(baseline - sampleY(i) * SAMPLE_SIZE)));
            let lo = -1;
            let hi = -1;
            const row = y * width * 4;
            for (let x = 0; x < width; x++) {
              // Ignore sub-pixel fringes, but retain genuinely thin stems.
              if (pixels[row + x * 4 + 3] >= 24) {
                if (lo < 0) lo = x;
                hi = x + 1;
              }
            }
            if (lo >= 0) {
              left[i] = (lo - pad) / SAMPLE_SIZE;
              right[i] = advance / SAMPLE_SIZE - (hi - pad) / SAMPLE_SIZE;
            }
          }
          result = { left, right, advance: advance / SAMPLE_SIZE };
        }
      }
    }
    if (cache.profiles.size > 12000) cache.profiles.clear();
    cache.profiles.set(grapheme, result);
    return result;
  }

  function faceCache(fontKey, styleKey) {
    const key = fontKey + "|" + styleKey;
    let cache = caches.get(key);
    if (!cache) {
      cache = { profiles: new Map(), reference: undefined };
      caches.set(key, cache);
    }
    if (caches.size > 160) caches.clear();
    return cache;
  }

  function reference(cache, ctx) {
    if (cache.reference !== undefined) return cache.reference;
    cache.reference = null;
    for (const glyph of ["o", "O", "n", "H"]) {
      const p = profile(cache, ctx, glyph);
      const features = pairFeatures(p, p);
      if (features) {
        cache.reference = features;
        break;
      }
    }
    return cache.reference;
  }

  // Grapheme breaks match the layout engine's segmenter where available.
  function graphemes(text) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
    }
    return Array.from(text);
  }

  /** Return pixel deltas after every grapheme, plus their cumulative starts.
   * `manual` is an optional map of UTF-16 starts to Photoshop's 1/1000-em manual kern. */
  function spacing(ctx, fontKey, styleKey, text, sizePt, sizePx, manual) {
    const chars = graphemes(String(text || ""));
    const deltas = Array(chars.length).fill(0);
    const starts = Array(chars.length).fill(0);
    if (!chars.length) return { chars, deltas, starts, total: 0 };
    const cache = faceCache(fontKey, styleKey);
    const ref = reference(cache, ctx);
    let total = 0;
    for (let i = 0; i < chars.length; i++) {
      if (i + 1 < chars.length) {
        const features = pairFeatures(profile(cache, ctx, chars[i]), profile(cache, ctx, chars[i + 1]));
        // One thousandths of an em, then the run's point size and document px/pt scale.
        if (features && ref) total += ((kernFromFeatures(features, ref) + sizeAdjust(sizePt)) / 1000) * sizePx;
      }
      deltas[i] = total;
      if (i + 1 < chars.length) starts[i + 1] = total;
    }
    // Manual kerning remains a character property in Optical mode too.
    if (manual) {
      let at = 0;
      let extra = 0;
      for (let i = 0; i < chars.length; i++) {
        const value = finite(manual.get ? manual.get(at) : manual[at]);
        extra += (value / 1000) * sizePx;
        starts[i] += extra;
        at += chars[i].length;
      }
      total += extra;
    }
    return { chars, deltas, starts, total };
  }

  return {
    spacing,
    pairFeatures,
    kernFromFeatures,
    sizeAdjust,
    sampleY,
    clear() { caches.clear(); },
    setCanvasFactory(factory) { canvasFactory = factory; caches.clear(); },
    _test: { SAMPLES, SAMPLE_SIZE, faceCache },
  };
});
