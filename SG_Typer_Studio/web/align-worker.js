// Edit > Auto-Align Layers, as Photoshop does it: the same details are found on every layer,
// at every scale and turned any way, then paired up between layers. The pairs that agree on one
// movement give it (RANSAC), and the pixels themselves then say it to a fraction of a pixel
// (ECC, a correlation that doesn't mind a page lighter or darker than the other). A layer that
// shares nothing with the reference may still go through the ones it shares something with.
//
// Places are pixel centres: (0, 0) is the middle of the first pixel. A matrix has 9 numbers,
// row by row, and takes a layer's places to the reference's.

"use strict";

/* ============================== small algebra ============================== */

// Gaussian elimination with partial pivoting: A is n × n, row by row
const solve = (A, b, n) => {
  const M = Float64Array.from(A);
  const x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    let best = Math.abs(M[c * n + c]);
    for (let r = c + 1; r < n; r++) {
      const value = Math.abs(M[r * n + c]);
      if (value > best) {
        best = value;
        p = r;
      }
    }
    if (!(best > 1e-14)) return null;
    if (p !== c) {
      for (let k = 0; k < n; k++) {
        const t = M[c * n + k];
        M[c * n + k] = M[p * n + k];
        M[p * n + k] = t;
      }
      const t = x[c];
      x[c] = x[p];
      x[p] = t;
    }
    const inv = 1 / M[c * n + c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c] * inv;
      if (!f) continue;
      for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k];
      x[r] -= f * x[c];
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    let s = x[c];
    for (let k = c + 1; k < n; k++) s -= M[c * n + k] * x[k];
    x[c] = s / M[c * n + c];
  }
  for (let i = 0; i < n; i++) if (!Number.isFinite(x[i])) return null;
  return x;
};

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];
const normalised = (h) => (h[8] && Math.abs(h[8]) > 1e-12 ? h.map((value) => value / h[8]) : h);
const inverse = (m) => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) return null;
  return normalised([A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]);
};
const project = (h, x, y) => {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
};
const translate = (x, y) => [1, 0, x, 0, 1, y, 0, 0, 1];

// The four corners of a w × h picture, at the outer edges of its pixels
const cornersOf = (w, h) => [[-0.5, -0.5], [w - 0.5, -0.5], [w - 0.5, h - 0.5], [-0.5, h - 0.5]];
// How far two matrices take the corners of a picture apart, at most
const apart = (a, b, w, h) => cornersOf(w, h).reduce((most, [x, y]) => {
  const p = project(a, x, y);
  const q = project(b, x, y);
  return Math.max(most, Math.hypot(p[0] - q[0], p[1] - q[1]));
}, 0);

// The same, on places brought from -1 to 1
const spread = (a, b) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].reduce((most, [x, y]) => {
  const p = project(a, x, y);
  const q = project(b, x, y);
  return Math.max(most, Math.hypot(p[0] - q[0], p[1] - q[1]));
}, 0);

// A seeded random: the same layers always align the same way
const randomFrom = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ============================== pictures ============================== */

// Grey, as on white, and where the layer really has pixels
const greyOf = (rgba, w, h) => {
  const d = new Float32Array(w * h);
  const v = new Uint8Array(w * h);
  for (let i = 0, k = 0; k < d.length; k++, i += 4) {
    const a = rgba[i + 3] / 255;
    const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255;
    d[k] = a * lum + (1 - a);
    v[k] = rgba[i + 3] >= 128 ? 1 : 0;
  }
  return { w, h, d, v };
};

// Each new pixel is the average of what it covers: a page made smaller keeps its thin lines
const axisWeights = (n, nn) => {
  const scale = n / nn;
  const starts = new Int32Array(nn);
  const counts = new Int32Array(nn);
  const weights = [];
  for (let i = 0; i < nn; i++) {
    const a = i * scale;
    const b = Math.min(n, (i + 1) * scale);
    starts[i] = Math.floor(a);
    let count = 0;
    for (let k = Math.floor(a); k < Math.ceil(b - 1e-9) && k < n; k++) {
      weights.push((Math.min(b, k + 1) - Math.max(a, k)) / scale);
      count++;
    }
    counts[i] = count;
  }
  return { starts, counts, weights: Float32Array.from(weights) };
};
const resizeArea = (src, w, h, nw, nh) => {
  if (nw === w && nh === h) return Float32Array.from(src);
  const X = axisWeights(w, nw);
  const Y = axisWeights(h, nh);
  const tmp = new Float32Array(nw * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let i = 0, at = 0; i < nw; i++) {
      let s = 0;
      const start = X.starts[i];
      for (let k = 0; k < X.counts[i]; k++, at++) s += src[row + start + k] * X.weights[at];
      tmp[y * nw + i] = s;
    }
  }
  const out = new Float32Array(nw * nh);
  for (let j = 0, at = 0; j < nh; j++) {
    const start = Y.starts[j];
    const count = Y.counts[j];
    for (let k = 0; k < count; k++, at++) {
      const weight = Y.weights[at];
      const from = (start + k) * nw;
      const to = j * nw;
      for (let i = 0; i < nw; i++) out[to + i] += tmp[from + i] * weight;
    }
  }
  return out;
};
const resized = (img, nw, nh) => {
  if (nw === img.w && nh === img.h) return img;
  const d = resizeArea(img.d, img.w, img.h, nw, nh);
  const cover = resizeArea(Float32Array.from(img.v), img.w, img.h, nw, nh);
  const v = new Uint8Array(nw * nh);
  for (let k = 0; k < v.length; k++) v[k] = cover[k] > 0.999 ? 1 : 0;
  return { w: nw, h: nh, d, v };
};

const kernelOf = (sigma) => {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) sum += k[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return { k, radius };
};
const blur = (src, w, h, sigma) => {
  if (!(sigma > 0.1)) return Float32Array.from(src);
  const { k, radius } = kernelOf(sigma);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      if (x >= radius && x < w - radius) {
        for (let i = -radius, at = row + x - radius; i <= radius; i++, at++) s += src[at] * k[i + radius];
      } else {
        for (let i = -radius; i <= radius; i++) s += src[row + Math.min(w - 1, Math.max(0, x + i))] * k[i + radius];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    const inside = y >= radius && y < h - radius;
    for (let x = 0; x < w; x++) {
      let s = 0;
      if (inside) {
        for (let i = -radius, at = (y - radius) * w + x; i <= radius; i++, at += w) s += tmp[at] * k[i + radius];
      } else {
        for (let i = -radius; i <= radius; i++) s += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + radius];
      }
      out[y * w + x] = s;
    }
  }
  return out;
};

const gradients = (d, w, h) => {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w;
    const down = (y < h - 1 ? y + 1 : y) * w;
    const fy = y > 0 && y < h - 1 ? 0.5 : 1;
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const left = x > 0 ? k - 1 : k;
      const right = x < w - 1 ? k + 1 : k;
      gx[k] = (d[right] - d[left]) * (x > 0 && x < w - 1 ? 0.5 : 1);
      gy[k] = (d[down + x] - d[up + x]) * fy;
    }
  }
  return { gx, gy };
};

const bilinear = (d, w, h, x, y) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const x0 = Math.min(w - 1, Math.max(0, ix));
  const x1 = Math.min(w - 1, Math.max(0, ix + 1));
  const y0 = Math.min(h - 1, Math.max(0, iy)) * w;
  const y1 = Math.min(h - 1, Math.max(0, iy + 1)) * w;
  return (d[y0 + x0] * (1 - fx) + d[y0 + x1] * fx) * (1 - fy) + (d[y1 + x0] * (1 - fx) + d[y1 + x1] * fx) * fy;
};

// How many places without pixels in each rectangle, at once
const holesOf = (v, w, h) => {
  const sum = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += v[y * w + x] ? 0 : 1;
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  return (left, top, right, bottom) => sum[bottom * (w + 1) + right] - sum[top * (w + 1) + right] - sum[bottom * (w + 1) + left] + sum[top * (w + 1) + left];
};

/* ============================== details ============================== */

// Corners at every scale (Harris), spread over the page, each with its way up and a little
// picture of what's around it, 8 × 8 samples 5 pixels apart, which says the same thing on a
// lighter scan, a blurrier one or a page turned (MOPS, as panorama stitchers do it)
const SPACING = 5;
const REACH = 30;
const STEP = Math.SQRT2;
const detailsOf = (img, total) => {
  const levels = [];
  let current = { w: img.w, h: img.h, d: img.d, v: img.v };
  while (levels.length < 8 && Math.min(current.w, current.h) >= REACH * 2 + 24) {
    levels.push(current);
    const nw = Math.round(current.w / STEP);
    const nh = Math.round(current.h / STEP);
    if (nw < 8 || nh < 8) break;
    current = resized({ w: current.w, h: current.h, d: blur(current.d, current.w, current.h, 0.5), v: current.v }, nw, nh);
  }
  const area = levels.reduce((sum, level) => sum + level.w * level.h, 0);
  const xs = [];
  const ys = [];
  const descriptors = [];
  levels.forEach((level, index) => {
    const { w, h } = level;
    const smooth = blur(level.d, w, h, 1);
    const { gx, gy } = gradients(smooth, w, h);
    const xx = new Float32Array(w * h);
    const yy = new Float32Array(w * h);
    const xy = new Float32Array(w * h);
    for (let k = 0; k < xx.length; k++) {
      xx[k] = gx[k] * gx[k];
      yy[k] = gy[k] * gy[k];
      xy[k] = gx[k] * gy[k];
    }
    const a = blur(xx, w, h, 1.5);
    const b = blur(yy, w, h, 1.5);
    const c = blur(xy, w, h, 1.5);
    const response = new Float32Array(w * h);
    for (let k = 0; k < response.length; k++) response[k] = (a[k] * b[k] - c[k] * c[k]) / (a[k] + b[k] + 1e-12);
    const holes = holesOf(level.v, w, h);
    const found = [];
    for (let y = REACH; y < h - REACH; y++) {
      for (let x = REACH; x < w - REACH; x++) {
        const k = y * w + x;
        const r = response[k];
        if (r < 1e-4) continue;
        if (r <= response[k - 1] || r < response[k + 1] || r <= response[k - w - 1] || r <= response[k - w] || r <= response[k - w + 1] || r < response[k + w - 1] || r < response[k + w] || r < response[k + w + 1]) continue;
        found.push(k);
      }
    }
    found.sort((p, q) => response[q] - response[p]);
    const candidates = found.slice(0, 6000).filter((k) => {
      const x = k % w;
      const y = (k - x) / w;
      return holes(x - REACH, y - REACH, x + REACH + 1, y + REACH + 1) === 0;
    });
    // Adaptive non-maximal suppression: the strongest corner of each part of the page
    const radius = new Float64Array(candidates.length).fill(Infinity);
    for (let i = 1; i < candidates.length; i++) {
      const ki = candidates[i];
      const xi = ki % w;
      const yi = (ki - xi) / w;
      const limit = response[ki] / 0.9;
      let best = Infinity;
      for (let j = 0; j < i; j++) {
        const kj = candidates[j];
        if (response[kj] < limit) break;
        const xj = kj % w;
        const dx = xj - xi;
        const dy = (kj - xj) / w - yi;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      radius[i] = best;
    }
    const want = Math.max(40, Math.round((total * w * h) / area));
    const order = candidates.map((k, i) => i).sort((p, q) => radius[q] - radius[p]).slice(0, want);
    // Its way up: the gradient around it, weighted as by a blur of 4.5 pixels
    const turn = kernelOf(4.5);
    const wayOf = (x, y) => {
      let sx = 0;
      let sy = 0;
      const cx = Math.round(x);
      const cy = Math.round(y);
      for (let j = -turn.radius; j <= turn.radius; j++) {
        const yy = Math.min(h - 1, Math.max(0, cy + j));
        const kj = turn.k[j + turn.radius];
        for (let i = -turn.radius; i <= turn.radius; i++) {
          const at = yy * w + Math.min(w - 1, Math.max(0, cx + i));
          const weight = kj * turn.k[i + turn.radius];
          sx += gx[at] * weight;
          sy += gy[at] * weight;
        }
      }
      return [sx, sy];
    };
    const soft = blur(level.d, w, h, 2);
    const toBaseX = img.w / w;
    const toBaseY = img.h / h;
    order.forEach((i) => {
      const k = candidates[i];
      const x0 = k % w;
      const y0 = (k - x0) / w;
      // Between pixels: the top of a parabola through the neighbours
      const peak = (m, c0, p) => {
        const den = m - 2 * c0 + p;
        return den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (m - p)) / den)) : 0;
      };
      const x = x0 + peak(response[k - 1], response[k], response[k + 1]);
      const y = y0 + peak(response[k - w], response[k], response[k + w]);
      let [ux, uy] = wayOf(x, y);
      const norm = Math.hypot(ux, uy);
      if (norm > 1e-9) {
        ux /= norm;
        uy /= norm;
      } else {
        ux = 1;
        uy = 0;
      }
      const sample = new Float32Array(64);
      let mean = 0;
      for (let j = 0, at = 0; j < 8; j++) {
        const v = (j - 3.5) * SPACING;
        for (let i2 = 0; i2 < 8; i2++, at++) {
          const u = (i2 - 3.5) * SPACING;
          const value = bilinear(soft, w, h, x + ux * u - uy * v, y + uy * u + ux * v);
          sample[at] = value;
          mean += value;
        }
      }
      mean /= 64;
      let spread = 0;
      for (let m = 0; m < 64; m++) {
        sample[m] -= mean;
        spread += sample[m] * sample[m];
      }
      spread = Math.sqrt(spread / 64);
      if (spread < 1e-3) return;
      for (let m = 0; m < 64; m++) sample[m] /= spread;
      xs.push((x + 0.5) * toBaseX - 0.5);
      ys.push((y + 0.5) * toBaseY - 0.5);
      descriptors.push(sample);
    });
  });
  const desc = new Float32Array(descriptors.length * 64);
  descriptors.forEach((sample, i) => desc.set(sample, i * 64));
  return { n: descriptors.length, xs: Float64Array.from(xs), ys: Float64Array.from(ys), desc };
};

// Each detail of A with its closest one on B, when it is clearly closer than the next one
const pairsOf = (A, B) => {
  const out = [];
  const a = A.desc;
  const b = B.desc;
  for (let i = 0; i < A.n; i++) {
    let best = Infinity;
    let second = Infinity;
    let at = -1;
    const ai = i * 64;
    for (let j = 0; j < B.n; j++) {
      const bj = j * 64;
      let d = 0;
      for (let m = 0; m < 64; m += 8) {
        const d0 = a[ai + m] - b[bj + m];
        const d1 = a[ai + m + 1] - b[bj + m + 1];
        const d2 = a[ai + m + 2] - b[bj + m + 2];
        const d3 = a[ai + m + 3] - b[bj + m + 3];
        const d4 = a[ai + m + 4] - b[bj + m + 4];
        const d5 = a[ai + m + 5] - b[bj + m + 5];
        const d6 = a[ai + m + 6] - b[bj + m + 6];
        const d7 = a[ai + m + 7] - b[bj + m + 7];
        d += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3 + d4 * d4 + d5 * d5 + d6 * d6 + d7 * d7;
        if (d >= second) break;
      }
      if (d < best) {
        second = best;
        best = d;
        at = j;
      } else if (d < second) second = d;
    }
    if (at >= 0 && best < 0.64 * second) out.push(i, at);
  }
  return Int32Array.from(out);
};

/* ============================== movements ============================== */

const NEED = { t: 1, s: 2, a: 3, h: 4 };
const TRIES = { t: 300, s: 1500, a: 2500, h: 4000 };

// The movement that best takes the points p to the points q, of each kind
const fitOf = (kind, px, py, qx, qy, idx) => {
  const n = idx.length;
  let mx = 0;
  let my = 0;
  let mu = 0;
  let mv = 0;
  for (let i = 0; i < n; i++) {
    const k = idx[i];
    mx += px[k];
    my += py[k];
    mu += qx[k];
    mv += qy[k];
  }
  mx /= n;
  my /= n;
  mu /= n;
  mv /= n;
  if (kind === "t") return [1, 0, mu - mx, 0, 1, mv - my, 0, 0, 1];
  if (kind === "s") {
    let sxx = 0;
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < n; i++) {
      const k = idx[i];
      const x = px[k] - mx;
      const y = py[k] - my;
      const u = qx[k] - mu;
      const v = qy[k] - mv;
      sxx += x * x + y * y;
      sa += x * u + y * v;
      sb += x * v - y * u;
    }
    if (!(sxx > 1e-9)) return null;
    const a = sa / sxx;
    const b = sb / sxx;
    return [a, -b, mu - (a * mx - b * my), b, a, mv - (b * mx + a * my), 0, 0, 1];
  }
  if (kind === "a") {
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    let sxu = 0;
    let syu = 0;
    let sxv = 0;
    let syv = 0;
    for (let i = 0; i < n; i++) {
      const k = idx[i];
      const x = px[k] - mx;
      const y = py[k] - my;
      const u = qx[k] - mu;
      const v = qy[k] - mv;
      sxx += x * x;
      sxy += x * y;
      syy += y * y;
      sxu += x * u;
      syu += y * u;
      sxv += x * v;
      syv += y * v;
    }
    const det = sxx * syy - sxy * sxy;
    if (!(Math.abs(det) > 1e-9 * (sxx + syy) * (sxx + syy))) return null;
    const a11 = (sxu * syy - syu * sxy) / det;
    const a12 = (syu * sxx - sxu * sxy) / det;
    const a21 = (sxv * syy - syv * sxy) / det;
    const a22 = (syv * sxx - sxv * sxy) / det;
    return [a11, a12, mu - a11 * mx - a12 * my, a21, a22, mv - a21 * mx - a22 * my, 0, 0, 1];
  }
  // A homography, on points brought around 0 at a distance of about √2 (Hartley)
  let dp = 0;
  let dq = 0;
  for (let i = 0; i < n; i++) {
    const k = idx[i];
    dp += Math.hypot(px[k] - mx, py[k] - my);
    dq += Math.hypot(qx[k] - mu, qy[k] - mv);
  }
  if (!(dp > 1e-9) || !(dq > 1e-9)) return null;
  const sp = (Math.SQRT2 * n) / dp;
  const sq = (Math.SQRT2 * n) / dq;
  const N = new Float64Array(64);
  const r = new Float64Array(8);
  const row = new Float64Array(8);
  const add = (target) => {
    for (let i = 0; i < 8; i++) {
      if (!row[i]) continue;
      r[i] += row[i] * target;
      for (let j = 0; j < 8; j++) N[i * 8 + j] += row[i] * row[j];
    }
  };
  for (let i = 0; i < n; i++) {
    const k = idx[i];
    const x = (px[k] - mx) * sp;
    const y = (py[k] - my) * sp;
    const u = (qx[k] - mu) * sq;
    const v = (qy[k] - mv) * sq;
    row.set([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    add(u);
    row.set([0, 0, 0, x, y, 1, -x * v, -y * v]);
    add(v);
  }
  const h = solve(N, r, 8);
  if (!h) return null;
  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  const Tp = [sp, 0, -sp * mx, 0, sp, -sp * my, 0, 0, 1];
  const Tq = [1 / sq, 0, mu, 0, 1 / sq, mv, 0, 0, 1];
  return normalised(mul(Tq, mul(Hn, Tp)));
};

// A movement Photoshop would accept: the layer keeps its way round, isn't squashed flat and
// doesn't go past the horizon
const sane = (h, w, hgt) => {
  if (!h || h.some((value) => !Number.isFinite(value))) return false;
  const corners = cornersOf(w, hgt);
  const placed = [];
  for (const [x, y] of corners) {
    const depth = h[6] * x + h[7] * y + h[8];
    if (depth < 0.25 || depth > 4) return false;
    placed.push(project(h, x, y));
  }
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = placed[i];
    const [bx, by] = placed[(i + 1) % 4];
    const [cx, cy] = placed[(i + 2) % 4];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (!cross || (sign && Math.sign(cross) !== sign)) return false;
    sign = Math.sign(cross);
  }
  // Its sides: no more than 8 times longer or shorter, and no side 4 times another
  const sides = placed.map((p, i) => Math.hypot(placed[(i + 1) % 4][0] - p[0], placed[(i + 1) % 4][1] - p[1]));
  const before = [w, hgt, w, hgt];
  const ratios = sides.map((side, i) => side / before[i]);
  if (Math.min(...ratios) < 0.125 || Math.max(...ratios) > 8) return false;
  return Math.max(...ratios) / Math.min(...ratios) < 4;
};

const inliersOf = (h, px, py, qx, qy, pairs, limit2) => {
  const out = [];
  for (let m = 0; m < pairs.length; m++) {
    const x = px[m];
    const y = py[m];
    const w = h[6] * x + h[7] * y + h[8];
    const dx = (h[0] * x + h[1] * y + h[2]) / w - qx[m];
    const dy = (h[3] * x + h[4] * y + h[5]) / w - qy[m];
    if (dx * dx + dy * dy < limit2) out.push(m);
  }
  return out;
};

const ransac = (kind, px, py, qx, qy, limit, size, random) => {
  const m = px.length;
  const need = NEED[kind];
  if (m < need + 3) return null;
  const limit2 = limit * limit;
  const all = new Int32Array(m).map((_, i) => i);
  let best = null;
  let bestCount = 0;
  let tries = TRIES[kind];
  const pick = new Int32Array(need);
  for (let t = 0; t < tries; t++) {
    let tooClose = false;
    for (let i = 0; i < need; i++) {
      let k;
      do k = Math.floor(random() * m);
      while (pick.subarray(0, i).includes(k));
      pick[i] = k;
      for (let j = 0; j < i; j++) {
        if (Math.hypot(px[k] - px[pick[j]], py[k] - py[pick[j]]) < limit * 4) tooClose = true;
      }
    }
    if (tooClose) continue;
    const h = fitOf(kind, px, py, qx, qy, pick);
    if (!sane(h, size.w, size.h)) continue;
    let count = 0;
    for (let k = 0; k < m; k++) {
      const x = px[k];
      const y = py[k];
      const w = h[6] * x + h[7] * y + h[8];
      const dx = (h[0] * x + h[1] * y + h[2]) / w - qx[k];
      const dy = (h[3] * x + h[4] * y + h[5]) / w - qy[k];
      if (dx * dx + dy * dy < limit2) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = h;
      const share = count / m;
      const needed = Math.log(0.001) / Math.log(Math.max(1e-12, 1 - Math.pow(share, need)));
      tries = Math.min(TRIES[kind], Math.max(t + 1, Math.ceil(needed)));
    }
  }
  if (!best) return null;
  // Again with all the pairs that agree, until no more join in
  let inliers = inliersOf(best, px, py, qx, qy, all, limit2);
  for (let round = 0; round < 5; round++) {
    const h = fitOf(kind, px, py, qx, qy, inliers);
    if (!sane(h, size.w, size.h)) break;
    const next = inliersOf(h, px, py, qx, qy, all, limit2);
    if (next.length < inliers.length) break;
    const same = next.length === inliers.length;
    best = h;
    inliers = next;
    if (same) break;
  }
  return { h: best, count: inliers.length, inliers };
};

/* ============================== to a fraction of a pixel ============================== */

// What ECC moves, in places brought around the middle of the layer, from -1 to 1 across it
const PARAMETERS = { t: 2, s: 4, a: 6, h: 8 };
const inFamily = (q, kind) => {
  const h = normalised(q);
  if (kind === "t") return [1, 0, h[2], 0, 1, h[5], 0, 0, 1];
  if (kind === "s") {
    const a = (h[0] + h[4]) / 2;
    const b = (h[3] - h[1]) / 2;
    return [a, -b, h[2], b, a, h[5], 0, 0, 1];
  }
  if (kind === "a") return [h[0], h[1], h[2], h[3], h[4], h[5], 0, 0, 1];
  return h;
};
const stepped = (q, kind, delta) => {
  const next = q.slice();
  if (kind === "t") {
    next[2] += delta[0];
    next[5] += delta[1];
  } else if (kind === "s") {
    next[0] += delta[0];
    next[4] += delta[0];
    next[3] += delta[1];
    next[1] -= delta[1];
    next[2] += delta[2];
    next[5] += delta[3];
  } else {
    for (let i = 0; i < PARAMETERS[kind]; i++) next[i] += delta[i];
  }
  return next;
};

// One look at how the reference (T) and the layer (I) correlate through q, and the step that
// brings them closer, as Evangelidis and Psarakis do it (and OpenCV's findTransformECC)
const eccStep = (level, q, kind, wantStep) => {
  const { T, I, gx, gy, toT, toI } = level;
  const n = PARAMETERS[kind];
  const g = new Float64Array(n);
  const H = new Float64Array(n * n);
  const sg = new Float64Array(n);
  const sgt = new Float64Array(n);
  const sgi = new Float64Array(n);
  let count = 0;
  let st = 0;
  let si = 0;
  let stt = 0;
  let sii = 0;
  let sti = 0;
  const { w: tw, h: th } = T;
  const { w: iw, h: ih } = I;
  const [q0, q1, q2, q3, q4, q5, q6, q7, q8] = q;
  const { k, cxT, cyT, cxI, cyI } = level.frame;
  const kxI = toI.sx * k;
  const kyI = toI.sy * k;
  for (let y = 0; y < th; y++) {
    const v = ((y + 0.5) / toT.sy - 0.5 - cyT) / k;
    for (let x = 0; x < tw; x++) {
      const at = y * tw + x;
      if (!T.v[at]) continue;
      const u = ((x + 0.5) / toT.sx - 0.5 - cxT) / k;
      const w = q6 * u + q7 * v + q8;
      const up = (q0 * u + q1 * v + q2) / w;
      const vp = (q3 * u + q4 * v + q5) / w;
      const xi = (up * k + cxI + 0.5) * toI.sx - 0.5;
      const yi = (vp * k + cyI + 0.5) * toI.sy - 0.5;
      if (!(xi >= 0 && yi >= 0 && xi < iw - 1 && yi < ih - 1)) continue;
      const ix = xi | 0;
      const iy = yi | 0;
      const k00 = iy * iw + ix;
      if (!I.v[k00] || !I.v[k00 + 1] || !I.v[k00 + iw] || !I.v[k00 + iw + 1]) continue;
      const fx = xi - ix;
      const fy = yi - iy;
      const w00 = (1 - fx) * (1 - fy);
      const w01 = fx * (1 - fy);
      const w10 = (1 - fx) * fy;
      const w11 = fx * fy;
      const iv = I.d[k00] * w00 + I.d[k00 + 1] * w01 + I.d[k00 + iw] * w10 + I.d[k00 + iw + 1] * w11;
      const tv = T.d[at];
      count++;
      st += tv;
      si += iv;
      stt += tv * tv;
      sii += iv * iv;
      sti += tv * iv;
      if (!wantStep) continue;
      const dx = (gx[k00] * w00 + gx[k00 + 1] * w01 + gx[k00 + iw] * w10 + gx[k00 + iw + 1] * w11) * kxI;
      const dy = (gy[k00] * w00 + gy[k00 + 1] * w01 + gy[k00 + iw] * w10 + gy[k00 + iw + 1] * w11) * kyI;
      if (kind === "t") {
        g[0] = dx;
        g[1] = dy;
      } else if (kind === "s") {
        g[0] = dx * u + dy * v;
        g[1] = -dx * v + dy * u;
        g[2] = dx;
        g[3] = dy;
      } else if (kind === "a") {
        g[0] = dx * u;
        g[1] = dx * v;
        g[2] = dx;
        g[3] = dy * u;
        g[4] = dy * v;
        g[5] = dy;
      } else {
        const iw2 = 1 / w;
        const along = -(dx * up + dy * vp) * iw2;
        g[0] = dx * u * iw2;
        g[1] = dx * v * iw2;
        g[2] = dx * iw2;
        g[3] = dy * u * iw2;
        g[4] = dy * v * iw2;
        g[5] = dy * iw2;
        g[6] = along * u;
        g[7] = along * v;
      }
      for (let a = 0; a < n; a++) {
        const ga = g[a];
        sg[a] += ga;
        sgt[a] += ga * tv;
        sgi[a] += ga * iv;
        for (let b = a; b < n; b++) H[a * n + b] += ga * g[b];
      }
    }
  }
  if (count < 400) return null;
  const mt = st / count;
  const mi = si / count;
  const corr = sti - count * mt * mi;
  const tn2 = stt - count * mt * mt;
  const in2 = sii - count * mi * mi;
  if (!(tn2 > 1e-9) || !(in2 > 1e-9)) return null;
  const rho = corr / Math.sqrt(tn2 * in2);
  if (!wantStep) return { rho, count };
  for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) H[a * n + b] = H[b * n + a];
  const ip = new Float64Array(n);
  const tp = new Float64Array(n);
  for (let a = 0; a < n; a++) {
    ip[a] = sgi[a] - mi * sg[a];
    tp[a] = sgt[a] - mt * sg[a];
  }
  const ipH = solve(H, ip, n);
  if (!ipH) return { rho, count };
  let ipDot = 0;
  let tpDot = 0;
  for (let a = 0; a < n; a++) {
    ipDot += ip[a] * ipH[a];
    tpDot += tp[a] * ipH[a];
  }
  const lambdaD = corr - tpDot;
  if (!(lambdaD > 0)) return { rho, count };
  const lambda = (in2 - ipDot) / lambdaD;
  const ep = new Float64Array(n);
  for (let a = 0; a < n; a++) ep[a] = lambda * tp[a] - ip[a];
  const delta = solve(H, ep, n);
  return { rho, count, delta };
};

// A layer's grey picture at the scales ECC climbs through, coarse first, kept between pairs
const ladderOf = (img, full) => {
  const steps = [];
  let current = img;
  for (;;) {
    steps.unshift(current);
    if (Math.min(current.w, current.h) < 300 || steps.length >= 4) break;
    current = resized(current, Math.max(1, Math.round(current.w / 2)), Math.max(1, Math.round(current.h / 2)));
  }
  return steps.map((step) => {
    const d = blur(step.d, step.w, step.h, 1);
    const { gx, gy } = gradients(d, step.w, step.h);
    return { img: { w: step.w, h: step.h, d, v: step.v }, gx, gy, sx: step.w / full.w, sy: step.h / full.h };
  });
};

// W takes the reference's places to the layer's (full size); the result too
const refine = (ref, layer, W, kind) => {
  const k = Math.max(ref.full.w, ref.full.h) / 2;
  const frame = { k, cxT: (ref.full.w - 1) / 2, cyT: (ref.full.h - 1) / 2, cxI: (layer.full.w - 1) / 2, cyI: (layer.full.h - 1) / 2 };
  const NT = [1 / k, 0, -frame.cxT / k, 0, 1 / k, -frame.cyT / k, 0, 0, 1];
  const NI = [1 / k, 0, -frame.cxI / k, 0, 1 / k, -frame.cyI / k, 0, 0, 1];
  const NIinv = inverse(NI);
  const toQ = (m) => normalised(mul(NI, mul(m, inverse(NT))));
  const fromQ = (q) => normalised(mul(NIinv, mul(q, NT)));
  const start = inFamily(toQ(W), kind);
  const ladders = Math.min(ref.ladder.length, layer.ladder.length);
  // From the coarse to the fine, both at the same share of their size
  const levels = [];
  for (let i = 0; i < ladders; i++) {
    const a = ref.ladder[ref.ladder.length - ladders + i];
    const b = layer.ladder[layer.ladder.length - ladders + i];
    levels.push({ T: a.img, I: b.img, gx: b.gx, gy: b.gy, toT: { sx: a.sx, sy: a.sy }, toI: { sx: b.sx, sy: b.sy }, frame });
  }
  const finest = levels[levels.length - 1];
  const before = eccStep(finest, start, kind, false);
  if (!before) return { W, moved: false };
  let q = start;
  levels.forEach((level, index) => {
    const most = index === levels.length - 1 ? 15 : 40;
    let best = null;
    let bestQ = q;
    for (let round = 0; round < most; round++) {
      const look = eccStep(level, q, kind, true);
      if (!look) break;
      if (best !== null && look.rho < best - 1e-4) break;
      if (best === null || look.rho > best) {
        best = look.rho;
        bestQ = q;
      }
      if (!look.delta) break;
      const next = inFamily(stepped(q, kind, look.delta), kind);
      if (next.some((value) => !Number.isFinite(value))) break;
      const change = spread(next, q) * k * Math.max(level.toI.sx, level.toI.sy);
      q = next;
      if (change < 0.002) {
        const last = eccStep(level, q, kind, false);
        if (last && last.rho > best) {
          best = last.rho;
          bestQ = q;
        }
        break;
      }
    }
    q = bestQ;
  });
  const after = eccStep(finest, q, kind, false);
  if (!after || after.rho < before.rho) return { W, moved: false, rho: before.rho };
  return { W: fromQ(q), moved: true, rho: after.rho };
};

/* ============================== the layers together ============================== */

const ECC_KIND = { reposition: "t", collage: "s", perspective: "h" };
// How far a pair may be from the movement and still agree, in detail pixels: strict first, then
// looser for a page drawn again (by hand or by an image model), a few pixels off here and there
const LIMITS = [3, 7.5, 15];
const DETAILS_AREA = 2.2e6;
const FINE_AREA = 3.5e6;
const DETAILS = 2500;

// The pairs that agree, over the whole layer rather than a corner of it: a looser limit is
// only trusted when what it finds holds the layer together
const spreadOver = (one, px, py, size) => {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  one.inliers.forEach((k) => {
    left = Math.min(left, px[k]);
    right = Math.max(right, px[k]);
    top = Math.min(top, py[k]);
    bottom = Math.max(bottom, py[k]);
  });
  return right - left >= size.w * 0.4 && bottom - top >= size.h * 0.4;
};

// The movement that suits the whole layer best, from one that suits some of it: again and again,
// from the pairs it leaves close, close meaning a few times how far off they typically are. A page
// drawn again a little off everywhere gets the movement in between; a clean one keeps its own.
const settle = (kind, h, px, py, qx, qy, floor, cap, size) => {
  const m = px.length;
  const all = new Int32Array(m).map((_, i) => i);
  let best = h;
  let spread = 0;
  for (let round = 0; round < 8; round++) {
    const off = [];
    for (let k = 0; k < m; k++) {
      const [x, y] = project(best, px[k], py[k]);
      off.push(Math.hypot(x - qx[k], y - qy[k]));
    }
    const near = off.filter((value) => value < cap).sort((a, b) => a - b);
    if (near.length < NEED[kind] * 4) break;
    spread = 1.4826 * near[Math.floor(near.length / 2)];
    const keep = Array.from(all).filter((k) => off[k] < Math.max(floor, 2.5 * spread));
    const next = fitOf(kind, px, py, qx, qy, keep);
    if (!sane(next, size.w, size.h)) break;
    const change = apart(next, best, size.w, size.h);
    best = next;
    if (change < 0.05) break;
  }
  return { h: best, spread };
};

// How a layer goes onto another: its matrix in full-size places, how many pairs agree, and
// whether that's enough to be sure (Brown and Lowe's test, as in panorama stitchers)
const between = (moving, target, projection, detailScale, random) => {
  const pairs = pairsOf(moving.details, target.details);
  const m = pairs.length / 2;
  if (m < 8) return null;
  const px = new Float64Array(m);
  const py = new Float64Array(m);
  const qx = new Float64Array(m);
  const qy = new Float64Array(m);
  const toFull = (value, scale) => (value + 0.5) / scale - 0.5;
  for (let i = 0; i < m; i++) {
    px[i] = toFull(moving.details.xs[pairs[2 * i]], moving.detailScale.sx);
    py[i] = toFull(moving.details.ys[pairs[2 * i]], moving.detailScale.sy);
    qx[i] = toFull(target.details.xs[pairs[2 * i + 1]], target.detailScale.sx);
    qy[i] = toFull(target.details.ys[pairs[2 * i + 1]], target.detailScale.sy);
  }
  const sure = (one) => {
    let inside = 0;
    for (let i = 0; i < m; i++) {
      const [x, y] = project(one.h, px[i], py[i]);
      if (x >= 0 && y >= 0 && x < target.full.w && y < target.full.h) inside++;
    }
    return one.count >= 10 && one.count > 5.9 + 0.22 * inside;
  };
  let passing = [];
  for (let at = 0; at < LIMITS.length && !passing.length; at++) {
    const limit = LIMITS[at] / detailScale;
    const found = ["t", "s", "a", "h"].map((kind) => Object.assign({ kind }, ransac(kind, px, py, qx, qy, limit, moving.full, random))).filter((one) => one.h);
    passing = found.filter((one) => sure(one) && (at === 0 || spreadOver(one, px, py, moving.full)));
  }
  if (!passing.length) return null;
  const most = Math.max(...passing.map((one) => one.count));
  let chosen = passing.find((one) => one.count >= most * 0.97);
  const wanted = ECC_KIND[projection];
  // A movement of the kind asked for, even when the layers differ by more: the one that best
  // fits the pairs a freer movement agrees on, as Photoshop's Reposition still moves a page
  // that is also a little bigger
  if (wanted && chosen.kind !== wanted) {
    const own = passing.find((one) => one.kind === wanted);
    const richest = passing.reduce((best, one) => (one.count > best.count ? one : best));
    const h = own && own.count >= richest.count * 0.97 ? own.h : fitOf(wanted, px, py, qx, qy, richest.inliers);
    if (!sane(h, moving.full.w, moving.full.h)) return null;
    chosen = { h, count: richest.count, kind: wanted };
    // Moving alone can't lay a page of another size on the reference (one made again by an image
    // model, scanned at another resolution): it is resized and turned too, as by Collage, and said
    const scaled = wanted === "t" && fitOf("s", px, py, qx, qy, richest.inliers);
    if (scaled && sane(scaled, moving.full.w, moving.full.h) && apart(scaled, h, moving.full.w, moving.full.h) > 3) {
      chosen = { h: scaled, count: richest.count, kind: "s", resized: true };
    }
  }
  const settled = settle(chosen.kind, chosen.h, px, py, qx, qy, LIMITS[0] / detailScale, LIMITS[LIMITS.length - 1] / detailScale, moving.full);
  return { h: settled.h, count: chosen.count, kind: chosen.kind, spread: settled.spread, resized: Boolean(chosen.resized) };
};

const analyse = ({ layers, projection }, progress = () => {}) => {
  const say = (share) => progress(Math.round(share * 100));
  const biggest = Math.max(...layers.map((layer) => layer.width * layer.height));
  const fineScale = Math.min(1, Math.sqrt(FINE_AREA / biggest));
  const detailScale = Math.min(fineScale, Math.sqrt(DETAILS_AREA / biggest));
  const items = layers.map((layer, index) => {
    const full = { w: layer.width, h: layer.height };
    let img = greyOf(new Uint8ClampedArray(layer.data), layer.width, layer.height);
    img = resized(img, Math.max(1, Math.round(full.w * fineScale)), Math.max(1, Math.round(full.h * fineScale)));
    const detailImg = resized(img, Math.max(1, Math.round(full.w * detailScale)), Math.max(1, Math.round(full.h * detailScale)));
    const details = detailsOf(detailImg, DETAILS);
    say(((index + 1) / layers.length) * 0.35);
    return { id: layer.id, x: layer.x, y: layer.y, fixed: layer.fixed, full, fine: img, details, detailScale: { sx: detailImg.w / full.w, sy: detailImg.h / full.h } };
  });
  // The reference: a locked layer, or the one that shares the most with the others
  const random = randomFrom(0x7e5e);
  const n = items.length;
  const links = [];
  const pairsTotal = (n * (n - 1)) / 2;
  let done = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (items[i].fixed && items[j].fixed) continue;
      const link = between(items[j], items[i], projection, detailScale, random);
      if (link) links.push({ from: j, to: i, h: link.h, count: link.count, kind: link.kind, spread: link.spread, resized: link.resized });
      done++;
      say(0.35 + (done / pairsTotal) * 0.3);
    }
  }
  const weight = new Float64Array(n);
  links.forEach((link) => {
    weight[link.from] += link.count;
    weight[link.to] += link.count;
  });
  let reference = items.findIndex((item) => item.fixed);
  if (reference < 0) {
    reference = 0;
    for (let i = 1; i < n; i++) if (weight[i] > weight[reference]) reference = i;
  }
  // From the reference out, always through the surest link (a maximum spanning tree)
  const placed = new Map([[reference, IDENTITY]]);
  const order = [];
  for (;;) {
    let best = null;
    links.forEach((link) => {
      const fromIn = placed.has(link.from);
      const toIn = placed.has(link.to);
      if (fromIn === toIn) return;
      const child = fromIn ? link.to : link.from;
      if (items[child].fixed) return;
      if (!best || link.count > best.link.count) best = { link, child, parent: fromIn ? link.from : link.to };
    });
    if (!best) break;
    const { link, child, parent } = best;
    // The child's places to the parent's
    const h = link.from === child ? link.h : inverse(link.h);
    placed.set(child, null);
    order.push({ child, parent, h, kind: link.kind, spread: link.spread, resized: link.resized });
  }
  const ladders = new Map();
  const ladder = (index) => {
    if (!ladders.has(index)) ladders.set(index, ladderOf(items[index].fine, items[index].full));
    return ladders.get(index);
  };
  order.forEach((step, index) => {
    const ref = items[step.parent];
    const layer = items[step.child];
    const kind = step.resized ? "s" : ECC_KIND[projection] || (step.kind === "h" ? "h" : "a");
    let h = step.h;
    const W = inverse(h);
    if (W) {
      const result = refine({ full: ref.full, ladder: ladder(step.parent) }, { full: layer.full, ladder: ladder(step.child) }, W, kind);
      // The pixels have the last word, unless they take the layer far from where its details put
      // it: further than its details themselves disagree, on a page drawn again
      if (result.moved && apart(result.W, W, ref.full.w, ref.full.h) <= Math.max(4, 6 / detailScale, 4 * (step.spread || 0))) {
        const back = inverse(result.W);
        if (back && sane(back, layer.full.w, layer.full.h)) h = back;
      }
    }
    placed.set(step.child, normalised(mul(placed.get(step.parent), h)));
    say(0.65 + ((index + 1) / Math.max(1, order.length)) * 0.35);
  });
  const ref = items[reference];
  const moves = [];
  const failed = [];
  const rescaled = [];
  items.forEach((item, index) => {
    if (index === reference || item.fixed) return;
    const local = placed.get(index);
    if (!local) {
      failed.push(item.id);
      return;
    }
    // On the page: the layer's own places, then the reference's, then the page's
    const page = normalised(mul(translate(ref.x, ref.y), mul(local, translate(-item.x, -item.y))));
    const shift = [Math.round(page[2]), Math.round(page[5])];
    const offShift = apart(page, translate(page[2], page[5]), item.full.w, item.full.h);
    const toWhole = Math.hypot(page[2] - shift[0], page[5] - shift[1]);
    // Moving only, or as good as moved by whole pixels: the pixels stay as they are. With
    // Reposition, a layer that had to be resized too is drawn again all the same.
    if ((projection === "reposition" && offShift < 1) || (offShift < 0.1 && toWhole < 0.1)) {
      if (shift[0] || shift[1]) moves.push({ id: item.id, shift });
      return;
    }
    if (projection === "reposition") rescaled.push(item.id);
    if (apart(page, IDENTITY, item.full.w, item.full.h) < 0.02) return;
    moves.push({ id: item.id, matrix: page });
  });
  return { reference: ref.id, moves, failed, resized: rescaled };
};

/* ============================== new pixels ============================== */

// Keys' bicubic, on colours weighted by their opacity: no dark fringe on a transparent edge
const cubic = (t) => {
  const a = Math.abs(t);
  if (a < 1) return (1.5 * a - 2.5) * a * a + 1;
  if (a < 2) return ((-0.5 * a + 2.5) * a - 4) * a + 2;
  return 0;
};
const warp = ({ data, width, height, x, y, matrix, fill }) => {
  const src = new Uint8ClampedArray(data);
  const corners = cornersOf(width, height).map(([cx, cy]) => {
    const w = matrix[6] * (cx + x) + matrix[7] * (cy + y) + matrix[8];
    if (!(w > 0)) throw new Error("behind");
    return project(matrix, cx + x, cy + y);
  });
  const left = Math.floor(Math.min(...corners.map((p) => p[0])) + 0.5);
  const top = Math.floor(Math.min(...corners.map((p) => p[1])) + 0.5);
  const right = Math.ceil(Math.max(...corners.map((p) => p[0])) + 0.5);
  const bottom = Math.ceil(Math.max(...corners.map((p) => p[1])) + 0.5);
  const ow = right - left;
  const oh = bottom - top;
  if (ow < 1 || oh < 1 || ow > 60000 || oh > 60000 || ow * oh > Math.max(4 * width * height, 16e6) || ow * oh > 400e6) throw new Error("too big");
  const back = inverse(matrix);
  const out = new Uint8ClampedArray(ow * oh * 4);
  const wx = new Float64Array(4);
  const wy = new Float64Array(4);
  const isMask = fill !== undefined && fill !== null;
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      const X = ox + left;
      const Y = oy + top;
      const w = back[6] * X + back[7] * Y + back[8];
      const sx = (back[0] * X + back[1] * Y + back[2]) / w - x;
      const sy = (back[3] * X + back[4] * Y + back[5]) / w - y;
      const o = (oy * ow + ox) * 4;
      if (!(sx > -1.5 && sy > -1.5 && sx < width + 0.5 && sy < height + 0.5)) {
        if (isMask) {
          out[o] = out[o + 1] = out[o + 2] = fill;
          out[o + 3] = 255;
        }
        continue;
      }
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const fx = sx - ix;
      const fy = sy - iy;
      for (let i = 0; i < 4; i++) {
        wx[i] = cubic(fx - (i - 1));
        wy[i] = cubic(fy - (i - 1));
      }
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = 0; j < 4; j++) {
        const yy = iy + j - 1;
        const weightY = wy[j];
        if (!weightY) continue;
        for (let i = 0; i < 4; i++) {
          const weight = wx[i] * weightY;
          if (!weight) continue;
          const xx = ix + i - 1;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) {
            if (isMask) r += fill * weight;
            continue;
          }
          const s = (yy * width + xx) * 4;
          if (isMask) {
            r += src[s] * weight;
            continue;
          }
          const alpha = src[s + 3];
          if (!alpha) continue;
          r += src[s] * alpha * weight;
          g += src[s + 1] * alpha * weight;
          b += src[s + 2] * alpha * weight;
          a += alpha * weight;
        }
      }
      if (isMask) {
        out[o] = out[o + 1] = out[o + 2] = r;
        out[o + 3] = 255;
        continue;
      }
      if (a <= 0.5) continue;
      const alpha = Math.min(255, a);
      out[o] = Math.min(alpha, Math.max(0, r / 255)) * (255 / alpha);
      out[o + 1] = Math.min(alpha, Math.max(0, g / 255)) * (255 / alpha);
      out[o + 2] = Math.min(alpha, Math.max(0, b / 255)) * (255 / alpha);
      out[o + 3] = alpha;
    }
  }
  return { data: out.buffer, width: ow, height: oh, left, top };
};

/* ============================== the worker ============================== */

if (typeof module !== "undefined" && module.exports) {
  module.exports = { analyse, warp, detailsOf, pairsOf, greyOf, resized, refine, ladderOf, inverse, mul, project, apart, between };
} else {
  self.onmessage = ({ data }) => {
    const { id, type, payload } = data;
    try {
      if (type === "analyse") {
        const result = analyse(payload, (percent) => self.postMessage({ id, progress: percent }));
        self.postMessage({ id, result });
      } else if (type === "warp") {
        const result = warp(payload);
        self.postMessage({ id, result }, [result.data]);
      }
    } catch (error) {
      self.postMessage({ id, error: String((error && error.message) || error) });
    }
  };
  self.postMessage({ ready: true });
}
