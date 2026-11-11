// Curves model, matching PhotoCraft's point and pencil semantics. Coordinates are 8-bit levels
// (0..255); rendering tables stay floating point until the final RGB lookup is rounded.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TypeRCurves = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const MAX_POINTS = 16;
  const MIN_GAP = 2;
  const identityPoints = () => [[0, 0], [255, 255]];
  const identityMap = () => Float64Array.from({ length: 256 }, (_, i) => i);
  const finitePoint = (point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]);
  const clamp = (value) => Math.min(255, Math.max(0, value));

  const normalized = (points) => {
    if (!Array.isArray(points)) return identityPoints();
    const sorted = points.filter(finitePoint).map((point) => [clamp(point[0]), clamp(point[1])]).sort((a, b) => a[0] - b[0]);
    const unique = [];
    sorted.forEach((point) => {
      if (unique.length && Math.abs(unique[unique.length - 1][0] - point[0]) < 1e-6) unique[unique.length - 1] = point;
      else unique.push(point);
    });
    return unique.length >= 2 ? unique : identityPoints();
  };

  // Photoshop / PhotoCraft use a natural cubic spline, not a monotone spline: overshoot between
  // points is intentional, but the rendered result is clamped to the 8-bit output range.
  const curveSamples = (points, size = 256) => {
    const count = Math.max(0, Math.floor(Number.isFinite(size) ? size : 256));
    if (!count) return new Float64Array(0);
    const pts = normalized(points).map((point) => [point[0] / 255, point[1] / 255]);
    const n = pts.length;
    const last = Math.max(1, count - 1);
    const second = new Float64Array(n);
    if (n > 2) {
      const c = new Float64Array(n);
      const d = new Float64Array(n);
      for (let i = 1; i < n - 1; i++) {
        const h0 = pts[i][0] - pts[i - 1][0];
        const h1 = pts[i + 1][0] - pts[i][0];
        const a = h0 / 6;
        const b = (h0 + h1) / 3;
        const cc = h1 / 6;
        const r = (pts[i + 1][1] - pts[i][1]) / h1 - (pts[i][1] - pts[i - 1][1]) / h0;
        const denominator = b - a * c[i - 1];
        c[i] = cc / denominator;
        d[i] = (r - a * d[i - 1]) / denominator;
      }
      for (let i = n - 2; i > 0; i--) second[i] = d[i] - c[i] * second[i + 1];
    }
    const out = new Float64Array(count);
    let segment = 0;
    for (let k = 0; k < count; k++) {
      const x = k / last;
      if (x <= pts[0][0]) {
        out[k] = clamp(pts[0][1] * 255);
        continue;
      }
      if (x >= pts[n - 1][0]) {
        out[k] = clamp(pts[n - 1][1] * 255);
        continue;
      }
      while (segment + 1 < n - 1 && x > pts[segment + 1][0]) segment++;
      const [x0, y0] = pts[segment];
      const [x1, y1] = pts[segment + 1];
      const h = x1 - x0;
      const a = (x1 - x) / h;
      const b = (x - x0) / h;
      const y = a * y0 + b * y1 + ((a ** 3 - a) * second[segment] + (b ** 3 - b) * second[segment + 1]) * h * h / 6;
      out[k] = clamp(y * 255);
    }
    return out;
  };

  const sample = (table, value) => {
    if (!table.length) return clamp(value);
    const x = clamp(value) / 255 * (table.length - 1);
    const i = Math.min(table.length - 1, Math.floor(x));
    const j = Math.min(table.length - 1, i + 1);
    return table[i] + (table[j] - table[i]) * (x - i);
  };

  const mapSamples = (map) => {
    if (!map || map.length !== 256) return identityMap();
    const out = new Float64Array(256);
    let previous = 0;
    for (let i = 0; i < 256; i++) {
      const value = Number(map[i]);
      out[i] = Number.isFinite(value) ? clamp(value) : previous;
      previous = out[i];
    }
    return out;
  };

  const RENDER_SAMPLES = 4096;
  const channelTable = (channel, pencil, size) => {
    if (!pencil) return curveSamples(channel, size);
    const source = mapSamples(channel);
    const out = new Float64Array(size);
    for (let i = 0; i < size; i++) out[i] = sample(source, i / Math.max(1, size - 1) * 255);
    return out;
  };

  // PhotoCraft composes 4096-sample floating-point LUTs: each channel first, then composite RGB.
  // The existing raster session consumes a final 8-bit lookup, so only that last result is rounded.
  const tables = (channels, pencil = false) => {
    const master = channelTable(channels.rgb, pencil, RENDER_SAMPLES);
    return ["r", "g", "b"].map((key) => {
      const own = channelTable(channels[key], pencil, RENDER_SAMPLES);
      const composed = new Float64Array(RENDER_SAMPLES);
      for (let i = 0; i < RENDER_SAMPLES; i++) composed[i] = sample(master, own[i]);
      const table = new Uint8Array(256);
      for (let i = 0; i < 256; i++) table[i] = Math.round(clamp(sample(composed, i)));
      return table;
    });
  };

  const insertPoint = (points, value) => {
    if (!finitePoint(value) || !Array.isArray(points)) return null;
    const point = [clamp(value[0]), clamp(value[1])];
    const existing = points.findIndex((one) => Math.abs(one[0] - point[0]) < MIN_GAP);
    if (existing >= 0) return existing;
    if (points.length >= MAX_POINTS) return null;
    const index = points.findIndex((one) => one[0] > point[0]);
    const at = index < 0 ? points.length : index;
    points.splice(at, 0, point);
    return at;
  };

  const canDeletePoint = (points, index) => Array.isArray(points) && points.length > 2 && Number.isInteger(index) && index > 0 && index < points.length - 1;
  const deletePoint = (points, index) => {
    if (!canDeletePoint(points, index)) return false;
    points.splice(index, 1);
    return true;
  };

  const movePoint = (points, index, value) => {
    if (!Array.isArray(points) || !Number.isInteger(index) || index < 0 || index >= points.length || !finitePoint(value) || !finitePoint(points[index])) return false;
    const low = index > 0 ? points[index - 1][0] + 1 : 0;
    const high = index + 1 < points.length ? points[index + 1][0] - 1 : 255;
    const next = [Math.round(Math.min(Math.max(low, high), Math.max(low, clamp(value[0])))), Math.round(clamp(value[1]))];
    if (next[0] === points[index][0] && next[1] === points[index][1]) return false;
    points[index] = next;
    return true;
  };

  const isIdentity = (curve, pencil = false) => {
    if (pencil) {
      if (!curve || curve.length !== 256) return true;
      for (let i = 0; i < 256; i++) if (Math.abs(curve[i] - i) >= 0.5) return false;
      return true;
    }
    const pts = normalized(curve);
    return pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 255 && pts[1][1] === 255;
  };

  const pointsToMap = (points) => {
    const lut = curveSamples(points, RENDER_SAMPLES);
    const out = new Float64Array(256);
    for (let i = 0; i < 256; i++) out[i] = sample(lut, i);
    return out;
  };
  const mapToPoints = (map) => {
    const target = mapSamples(map);
    const points = [[0, target[0]], [255, target[255]]];
    while (points.length < MAX_POINTS) {
      const fitted = pointsToMap(points);
      let worst = -1;
      let error = 1;
      for (let i = 0; i < 256; i++) {
        const difference = Math.abs(fitted[i] - target[i]);
        if (difference > 1 && difference >= error) {
          error = difference;
          worst = i;
        }
      }
      if (worst < 0 || points.some((point) => Math.abs(point[0] - worst) < 0.5)) break;
      points.push([worst, target[worst]]);
      points.sort((a, b) => a[0] - b[0]);
    }
    return points;
  };

  // A fast pencil drag still fills every crossed input level, including a backwards stroke.
  const pencilLine = (map, from, to) => {
    if (!map || map.length !== 256 || !finitePoint(from) || !finitePoint(to)) return false;
    const ordered = from[0] <= to[0] ? [from, to] : [to, from];
    const first = Math.round(clamp(ordered[0][0]));
    const last = Math.round(clamp(ordered[1][0]));
    let changed = false;
    for (let i = first; i <= last; i++) {
      const t = last > first ? (i - first) / (last - first) : 1;
      const output = clamp(ordered[0][1] + (ordered[1][1] - ordered[0][1]) * t);
      if (map[i] !== output) {
        map[i] = output;
        changed = true;
      }
    }
    return changed;
  };

  const smoothMap = (map) => {
    const source = mapSamples(map);
    const out = new Float64Array(source);
    for (let i = 1; i < source.length - 1; i++) {
      const radius = Math.min(3, i, source.length - i - 1);
      let sum = 0;
      for (let k = i - radius; k <= i + radius; k++) sum += source[k];
      out[i] = sum / (radius * 2 + 1);
    }
    return out;
  };

  const CHANNELS = ["rgb", "r", "g", "b"];
  const identityParams = () => ({
    pencil: false,
    points: Object.fromEntries(CHANNELS.map((key) => [key, identityPoints()])),
    maps: Object.fromEntries(CHANNELS.map((key) => [key, Array.from(identityMap())])),
  });
  // A layer owns ordinary arrays, not the typed arrays the editor draws with. They survive
  // JSON session storage and can be shared safely with the immutable History entries.
  const cloneParams = (params) => {
    const source = params && typeof params === "object" ? params : identityParams();
    const fallback = identityParams();
    return {
      pencil: Boolean(source.pencil),
      points: Object.fromEntries(CHANNELS.map((key) => [key, normalized(source.points && source.points[key] || fallback.points[key]).map((point) => point.slice())])),
      maps: Object.fromEntries(CHANNELS.map((key) => {
        const map = source.maps && source.maps[key];
        return [key, map && map.length === 256 ? Array.from(map, (value) => clamp(Number.isFinite(value) ? value : 0)) : Array.from(fallback.maps[key])];
      })),
    };
  };
  // PSD's four records are composite, red, green and blue. Point records and pencil maps are
  // different encodings of the same layer; ag-psd calls them `channels` and `values`.
  const fromPsd = (adjustment) => {
    if (!adjustment || adjustment.type !== "curves") return identityParams();
    const pencil = Array.isArray(adjustment.values);
    const source = pencil ? adjustment.values : adjustment.channels;
    const out = identityParams();
    out.pencil = pencil;
    CHANNELS.forEach((key, index) => {
      const curve = source && source[index];
      if (!Array.isArray(curve) || !curve.length) return;
      if (pencil) {
        const map = Array.from({ length: 256 }, (_, i) => clamp(Number.isFinite(curve[i]) ? curve[i] : i));
        out.maps[key] = map;
        out.points[key] = mapToPoints(map);
      } else {
        const points = curve.map((point) => [point && point.input, point && point.output]);
        out.points[key] = normalized(points);
        out.maps[key] = Array.from(pointsToMap(out.points[key]));
      }
    });
    return out;
  };
  const toPsd = (params) => {
    const source = cloneParams(params);
    return {
      type: "curves",
      ...(source.pencil ? {
        values: CHANNELS.map((key) => source.maps[key].slice()),
      } : {
        channels: CHANNELS.map((key) => source.points[key].map(([input, output]) => ({ input: Math.round(input), output: Math.round(output) }))),
      }),
    };
  };
  // Normal Curves changes colour only: alpha and transparent pixels keep their coverage.
  // Opacity interpolates towards the untouched input, without a second source-over of alpha.
  const apply = (imageData, curveTables, opacity = 1) => {
    if (!imageData || !imageData.data || !curveTables) return false;
    const amount = Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1));
    if (!amount) return false;
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      for (let channel = 0; channel < 3; channel++) {
        const original = data[i + channel];
        data[i + channel] = original + (curveTables[channel][original] - original) * amount;
      }
    }
    return true;
  };

  return {
    MAX_POINTS,
    MIN_GAP,
    identityPoints,
    identityMap,
    identityParams,
    cloneParams,
    fromPsd,
    toPsd,
    apply,
    curveSamples,
    sample,
    tables,
    insertPoint,
    canDeletePoint,
    deletePoint,
    movePoint,
    isIdentity,
    pointsToMap,
    mapToPoints,
    pencilLine,
    smoothMap,
  };
});
