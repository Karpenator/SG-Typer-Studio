// The Bubble Reshaper: a bubble takes another shape and keeps its own outline. Its line is
// not stretched with it: each bit of the new outline is the old line, bent along the new
// shape, so it keeps its thickness, its ink and its soft edge. The inside is the bubble's
// own colour, the tail keeps pointing where it pointed, and what the old bubble covered and
// the new one doesn't is painted with the page around it when that is plain.
// Pure computing on RGBA arrays: the page in, a picture out, no canvas.
(function (root) {
  "use strict";

  const INF = 1e20;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrapPi = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  const median = (values) => {
    if (!values.length) return 0;
    const sorted = Float64Array.from(values).sort();
    return sorted[sorted.length >> 1];
  };
  const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = Float64Array.from(values).sort();
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };
  const smoothstep = (t) => {
    const u = clamp(t, 0, 1);
    return u * u * (3 - 2 * u);
  };

  /* ---------------------------- distances ---------------------------- */

  // Felzenszwalb's squared distance transform, one line
  const line = (f, n, d, v, z) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  // How far each pixel is from the nearest pixel that is `on`, in pixels
  const distanceTo = (on, w, h) => {
    const n = Math.max(w, h);
    const f = new Float64Array(n);
    const d = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    const grid = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) grid[i] = on[i] ? 0 : INF;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
      line(f, h, d, v, z);
      for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
      line(f, w, d, v, z);
      for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
    }
    return out;
  };
  const not = (mask) => {
    const out = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1;
    return out;
  };
  // A shape grown, shrunk, opened or closed by a disc of radius r
  const grow = (mask, w, h, r) => {
    const d = distanceTo(mask, w, h);
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = d[i] <= r ? 1 : 0;
    return out;
  };
  const shrink = (mask, w, h, r) => {
    const d = distanceTo(not(mask), w, h);
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = mask[i] && d[i] > r ? 1 : 0;
    return out;
  };

  /* ------------------------------ regions ----------------------------- */

  // The pixels close to the seed's colour and joined to it: `labels` gets `id` on them
  const flood = (data, W, H, sx, sy, tolerance, labels, id) => {
    const at = (sy * W + sx) * 4;
    const r0 = data[at];
    const g0 = data[at + 1];
    const b0 = data[at + 2];
    const close = (x, y) => {
      const i = (y * W + x) * 4;
      return Math.abs(data[i] - r0) <= tolerance && Math.abs(data[i + 1] - g0) <= tolerance && Math.abs(data[i + 2] - b0) <= tolerance;
    };
    const stack = [sx, sy];
    let area = 0;
    let left = sx;
    let right = sx;
    let top = sy;
    let bottom = sy;
    while (stack.length) {
      const y = stack.pop();
      let x = stack.pop();
      while (x >= 0 && !labels[y * W + x] && close(x, y)) x--;
      x++;
      let up = false;
      let down = false;
      for (; x < W; x++) {
        const index = y * W + x;
        if (labels[index] || !close(x, y)) break;
        labels[index] = id;
        area++;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (y > 0) {
          if (!labels[index - W] && close(x, y - 1)) {
            if (!up) {
              stack.push(x, y - 1);
              up = true;
            }
          } else up = false;
        }
        if (y < H - 1) {
          if (!labels[index + W] && close(x, y + 1)) {
            if (!down) {
              stack.push(x, y + 1);
              down = true;
            }
          } else down = false;
        }
      }
    }
    return { id, area, seed: [r0, g0, b0], box: { left, top, right: right + 1, bottom: bottom + 1 } };
  };
  // How thick a region is at its thickest: a letter's stroke is thin, a bubble isn't
  const thickness = (labels, id, W, box) => {
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    const outside = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) outside[y * w + x] = labels[(y + box.top) * W + x + box.left] === id ? 0 : 1;
    }
    // The box's border counts as outside
    const pw = w + 2;
    const ph = h + 2;
    const padded = new Uint8Array(pw * ph).fill(1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) padded[(y + 1) * pw + x + 1] = outside[y * w + x];
    const d = distanceTo(padded, pw, ph);
    let most = 0;
    for (let i = 0; i < d.length; i++) if (d[i] > most) most = d[i];
    return most;
  };
  // What a mask wraps, filled: the pixels that can't reach the window's edge without crossing it
  const fillHoles = (mask, w, h) => {
    const outside = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    const push = (i) => {
      if (mask[i] || outside[i]) return;
      outside[i] = 1;
      queue[tail++] = i;
    };
    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      push(y * w);
      push(y * w + w - 1);
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < w * (h - 1)) push(i + w);
    }
    return not(outside);
  };
  // The pieces of a mask, 4-connected: a label per pixel and each piece's size
  const pieces = (mask, w, h) => {
    const label = new Int32Array(w * h);
    const sizes = [0];
    const queue = new Int32Array(w * h);
    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || label[start]) continue;
      const id = sizes.length;
      let head = 0;
      let tail = 0;
      label[start] = id;
      queue[tail++] = start;
      while (head < tail) {
        const i = queue[head++];
        const x = i % w;
        const near = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1];
        for (let k = 0; k < 4; k++) {
          const n = near[k];
          if (n < 0 || !mask[n] || label[n]) continue;
          label[n] = id;
          queue[tail++] = n;
        }
      }
      sizes.push(tail);
    }
    return { label, sizes };
  };

  /* ------------------------------ outlines ---------------------------- */

  // The outer edge of a mask, pixel by pixel, clockwise on the screen (Moore's tracing)
  const DX = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const DIR = (dx, dy) => DX.findIndex((x, k) => x === dx && DY[k] === dy);
  const trace = (mask, w, h) => {
    let start = -1;
    for (let i = 0; i < w * h; i++) {
      if (mask[i]) {
        start = i;
        break;
      }
    }
    if (start < 0) return [];
    const sx = start % w;
    const sy = (start - sx) / w;
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
    const points = [];
    let px = sx;
    let py = sy;
    let dir = 4;
    let second = null;
    for (let steps = 0; steps < w * h * 4; steps++) {
      points.push(px, py);
      let moved = false;
      for (let k = 1; k <= 8; k++) {
        const d = (dir + k) % 8;
        const nx = px + DX[d];
        const ny = py + DY[d];
        if (!inside(nx, ny)) continue;
        const bd = (d + 7) % 8;
        const bx = px + DX[bd];
        const by = py + DY[bd];
        const was = [px, py];
        px = nx;
        py = ny;
        dir = DIR(bx - px, by - py);
        if (dir < 0) dir = (d + 4) % 8;
        moved = true;
        if (!second) second = [px, py];
        else if (was[0] === sx && was[1] === sy && px === second[0] && py === second[1]) {
          points.length -= 2;
          return points;
        }
        break;
      }
      if (!moved) return points;
    }
    return points;
  };
  // A closed outline made smooth, then laid out a pixel apart
  const smoothClosed = (pts, sigma) => {
    const n = pts.length / 2;
    const radius = Math.ceil(sigma * 3);
    const weights = [];
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const wgt = Math.exp(-(k * k) / (2 * sigma * sigma));
      weights.push(wgt);
      sum += wgt;
    }
    const out = new Float64Array(pts.length);
    for (let i = 0; i < n; i++) {
      let x = 0;
      let y = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = (((i + k) % n) + n) % n;
        const wgt = weights[k + radius];
        x += pts[j * 2] * wgt;
        y += pts[j * 2 + 1] * wgt;
      }
      out[i * 2] = x / sum;
      out[i * 2 + 1] = y / sum;
    }
    return out;
  };
  // The same, except at a sharp point (a spike's tip, a corner of a shout), kept sharp: smoothed
  // there, its tip would draw back inside the line, and the line would fill it
  const smoothKeepingPoints = (pts, sigma) => {
    const n = pts.length / 2;
    const REACH = 5;
    const dir = (a, b) => Math.atan2(pts[b * 2 + 1] - pts[a * 2 + 1], pts[b * 2] - pts[a * 2]);
    const sigmas = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const before = dir((i - REACH + n) % n, i);
      const after = dir(i, (i + REACH) % n);
      const turn = Math.abs(wrapPi(after - before));
      const sharp = clamp((turn - 0.8) / 0.7, 0, 1);
      sigmas[i] = sigma * (1 - sharp) + 0.35 * sharp;
    }
    // The sharpness spreads a little, so that the points next to a tip don't pull it in
    const spread = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let low = sigmas[i];
      for (let k = -3; k <= 3; k++) low = Math.min(low, sigmas[(i + k + n) % n] + Math.abs(k) * 0.35);
      spread[i] = low;
    }
    const out = new Float64Array(pts.length);
    for (let i = 0; i < n; i++) {
      const sg = spread[i];
      const radius = Math.ceil(sg * 3);
      let x = 0;
      let y = 0;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = (((i + k) % n) + n) % n;
        const wgt = Math.exp(-(k * k) / (2 * sg * sg));
        x += pts[j * 2] * wgt;
        y += pts[j * 2 + 1] * wgt;
        sum += wgt;
      }
      out[i * 2] = x / sum;
      out[i * 2 + 1] = y / sum;
    }
    return out;
  };
  const resampleClosed = (pts, spacing) => {
    const n = pts.length / 2;
    const cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      cum[i + 1] = cum[i] + Math.hypot(pts[j * 2] - pts[i * 2], pts[j * 2 + 1] - pts[i * 2 + 1]);
    }
    const total = cum[n];
    const m = Math.max(8, Math.round(total / spacing));
    const out = new Float64Array(m * 2);
    let seg = 0;
    for (let k = 0; k < m; k++) {
      const s = (k * total) / m;
      while (seg < n - 1 && cum[seg + 1] < s) seg++;
      const len = cum[seg + 1] - cum[seg] || 1;
      const t = (s - cum[seg]) / len;
      const j = (seg + 1) % n;
      out[k * 2] = pts[seg * 2] + (pts[j * 2] - pts[seg * 2]) * t;
      out[k * 2 + 1] = pts[seg * 2 + 1] + (pts[j * 2 + 1] - pts[seg * 2 + 1]) * t;
    }
    return out;
  };
  const areaOf = (pts) => {
    const n = pts.length / 2;
    let a = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
    }
    return a / 2;
  };
  // The direction of the outline at each point, from its neighbours `reach` away
  const anglesOf = (pts, reach) => {
    const n = pts.length / 2;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = ((i - reach) % n + n) % n;
      const b = (i + reach) % n;
      out[i] = Math.atan2(pts[b * 2 + 1] - pts[a * 2 + 1], pts[b * 2] - pts[a * 2]);
    }
    return out;
  };
  // Points on the screen are clockwise: the outward normal of direction θ is (sin θ, -cos θ)

  /* ------------------------------ sampling ---------------------------- */

  const bilinear = (src, x, y, out) => {
    const { rgba, left, top, width, height } = src;
    let fx = x - left - 0.5;
    let fy = y - top - 0.5;
    fx = clamp(fx, 0, width - 1.001);
    fy = clamp(fy, 0, height - 1.001);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    const i00 = (y0 * width + x0) * 4;
    const i10 = i00 + 4;
    const i01 = i00 + width * 4;
    const i11 = i01 + 4;
    for (let c = 0; c < 3; c++) {
      out[c] = (rgba[i00 + c] * (1 - ax) + rgba[i10 + c] * ax) * (1 - ay) + (rgba[i01 + c] * (1 - ax) + rgba[i11 + c] * ax) * ay;
    }
    return out;
  };
  const luma = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;

  /* ------------------------------ analysis ---------------------------- */

  // Finds the bubble under a click and reads everything the reshaping needs from the page:
  // its outline, its line, its colours, its tail, its kind. `page` is { data, width, height }
  // (RGBA, the page without its texts). Returns a model, or { error }.
  const analyze = (page, cx, cy, options = {}) => {
    const { data, width: W, height: H } = page;
    const tolerance = options.tolerance === undefined ? 32 : options.tolerance;
    const x = clamp(Math.round(cx), 0, W - 1);
    const y = clamp(Math.round(cy), 0, H - 1);
    const leaks = (r) => {
      const edges = (r.box.left <= 0 ? 1 : 0) + (r.box.top <= 0 ? 1 : 0) + (r.box.right >= W ? 1 : 0) + (r.box.bottom >= H ? 1 : 0);
      return edges >= 3 || r.area > W * H * 0.3 || (r.box.right - r.box.left) * (r.box.bottom - r.box.top) > W * H * 0.6;
    };
    const labels = new Uint8Array(W * H);
    const first = flood(data, W, H, x, y, tolerance, labels, 1);
    let region = first;
    const THICK = 8;
    first.thick = leaks(first) ? 0 : thickness(labels, 1, W, first.box);
    if (!(first.thick >= THICK)) {
      // On a letter, or on the line: out from the click in 16 directions, what each meets
      const tried = [first];
      const found = new Map();
      let next = 2;
      for (let n = 0; n < 16; n++) {
        const angle = (n * Math.PI) / 8;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        let past = -1;
        for (let step = 1; step < 300; step++) {
          const px = Math.round(x + dx * step);
          const py = Math.round(y + dy * step);
          if (px < 0 || py < 0 || px >= W || py >= H) break;
          const owner = labels[py * W + px];
          if (past < 0 && owner === 1) continue;
          if (past < 0) past = step;
          if (step - past > 8) break;
          let r = owner ? tried[owner - 1] : null;
          if (!r) {
            if (next > 255) break;
            r = flood(data, W, H, px, py, tolerance, labels, next++);
            r.thick = leaks(r) ? 0 : thickness(labels, r.id, W, r.box);
            tried.push(r);
          }
          if (r === first || !(r.thick >= THICK)) continue;
          found.set(r, (found.get(r) || 0) + 1);
          break;
        }
      }
      let votes = 0;
      found.forEach((count, r) => {
        if (count > votes) {
          votes = count;
          region = r;
        }
      });
      if (region === first) return { error: "background" };
    }
    if (leaks(region)) return { error: "open" };
    if (region.area < 300) return { error: "small" };

    // A window around it, wide enough for its line, a halo and the page around
    const PAD = 80;
    const win = { left: Math.max(0, region.box.left - PAD), top: Math.max(0, region.box.top - PAD), right: Math.min(W, region.box.right + PAD), bottom: Math.min(H, region.box.bottom + PAD) };
    const w = win.right - win.left;
    const h = win.bottom - win.top;
    const plain = new Uint8Array(w * h);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) plain[yy * w + xx] = labels[(yy + win.top) * W + xx + win.left] === region.id ? 1 : 0;
    }
    // Its inside: the plain colour and the letters it wraps, a little smoothed
    let inside = fillHoles(plain, w, h);
    inside = shrink(grow(inside, w, h, 2), w, h, 2);
    inside = grow(shrink(inside, w, h, 1), w, h, 1);
    // A thin tail's narrow inside is cut off: that tail is ink sticking out of the outline, cut
    // out whole below, not a bit of outline and a bit of tail. Only one or two such channels:
    // a shout's many spikes are its outline and stay.
    {
      const opened = grow(shrink(inside, w, h, 3), w, h, 3);
      const thin = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) thin[i] = inside[i] && !opened[i] ? 1 : 0;
      const { label, sizes } = pieces(thin, w, h);
      const channels = [];
      for (let id = 1; id < sizes.length; id++) if (sizes[id] >= 12) channels.push(id);
      if (channels.length && channels.length <= 2) {
        const gone = new Set(channels);
        for (let i = 0; i < w * h; i++) if (gone.has(label[i])) inside[i] = 0;
      }
    }
    {
      const { label, sizes } = pieces(inside, w, h);
      let best = 0;
      for (let id = 1; id < sizes.length; id++) if (!best || sizes[id] > sizes[best]) best = id;
      for (let i = 0; i < w * h; i++) inside[i] = label[i] === best ? 1 : 0;
    }
    let insideArea = 0;
    for (let i = 0; i < w * h; i++) insideArea += inside[i];
    if (insideArea < 300) return { error: "small" };

    // The outline, on the edge between the inside and the line
    const chain = trace(inside, w, h);
    if (chain.length < 24) return { error: "small" };
    const centred = new Float64Array(chain.length);
    for (let i = 0; i < chain.length; i += 2) {
      centred[i] = chain[i] + win.left + 0.5;
      centred[i + 1] = chain[i + 1] + win.top + 0.5;
    }
    let pts = resampleClosed(smoothKeepingPoints(resampleClosed(centred, 1), 1.8), 1);
    if (areaOf(pts) < 0) {
      const n = pts.length / 2;
      const flipped = new Float64Array(pts.length);
      for (let i = 0; i < n; i++) {
        flipped[i * 2] = pts[(n - 1 - i) * 2];
        flipped[i * 2 + 1] = pts[(n - 1 - i) * 2 + 1];
      }
      pts = flipped;
    }
    let angle = anglesOf(pts, 2);
    const N = pts.length / 2;
    // Half a pixel out: from the inside pixels' centres to their edge
    for (let i = 0; i < N; i++) {
      pts[i * 2] += Math.sin(angle[i]) * 0.5;
      pts[i * 2 + 1] -= Math.cos(angle[i]) * 0.5;
    }
    angle = anglesOf(pts, 2);

    // The bubble's colour, from its plain pixels away from the letters and the line
    const inDepth = distanceTo(not(inside), w, h);
    const fills = [[], [], []];
    for (let i = 0; i < w * h; i++) {
      if (!plain[i] || inDepth[i] < 4) continue;
      const pi = ((Math.floor(i / w) + win.top) * W + (i % w) + win.left) * 4;
      fills[0].push(data[pi]);
      fills[1].push(data[pi + 1]);
      fills[2].push(data[pi + 2]);
    }
    if (!fills[0].length) return { error: "small" };
    const fill = fills.map(median);
    const spread = [];
    for (let k = 0; k < fills[0].length; k++) spread.push(Math.max(Math.abs(fills[0][k] - fill[0]), Math.abs(fills[1][k] - fill[1]), Math.abs(fills[2][k] - fill[2])));
    const flat = percentile(spread, 0.9) <= 14;

    // The source: the page around the bubble, kept apart
    const source = { left: win.left, top: win.top, width: w, height: h, rgba: new Uint8ClampedArray(w * h * 4) };
    for (let yy = 0; yy < h; yy++) {
      const from = ((yy + win.top) * W + win.left) * 4;
      source.rgba.set(data.subarray(from, from + w * 4), yy * w * 4);
    }

    // The line: how far it goes out from the inside, whether a light halo follows it
    const fillLuma = luma(fill);
    const c = [0, 0, 0];
    const REACH = 64;
    const profiles = new Float32Array(N * (REACH + 1));
    const peaks = [];
    for (let i = 0; i < N; i++) {
      const nx = Math.sin(angle[i]);
      const ny = -Math.cos(angle[i]);
      let peak = 0;
      for (let s = 0; s <= REACH; s++) {
        bilinear(source, pts[i * 2] + nx * s, pts[i * 2 + 1] + ny * s, c);
        const contrast = Math.abs(luma(c) - fillLuma);
        profiles[i * (REACH + 1) + s] = contrast;
        if (s <= 14 && contrast > peak) peak = contrast;
      }
      peaks.push(peak);
    }
    const peak = median(peaks);
    let stroke = 0;
    let halo = 0;
    // The outermost line's end: a double line (black, white, black) is one outline
    let line = 0;
    let double = false;
    const widths = [];
    const ends = new Float32Array(N).fill(-1);
    if (peak >= 40) {
      const threshold = peak / 2;
      const crossing = (row, s) => {
        const a = profiles[row + s - 1];
        const b = profiles[row + Math.min(REACH, s)];
        return s - 1 + (a - threshold) / Math.max(1e-6, a - b);
      };
      // A halo is the bubble's own paper right past its line: as light as its inside
      const paper = Math.max(12, peak * 0.12);
      const paperRun = (row, from) => {
        let t = from;
        while (t <= REACH && profiles[row + t] < paper) t++;
        return t > REACH ? 99 : t - from;
      };
      const lights = [];
      const gaps = [];
      const outers = [];
      const afters = [];
      for (let i = 0; i < N; i++) {
        const row = i * (REACH + 1);
        let s = 0;
        while (s <= 4 && profiles[row + s] < threshold) s++;
        if (s > 4) continue;
        while (s <= REACH && profiles[row + s] >= threshold) s++;
        if (s > 30) continue;
        const end = crossing(row, s);
        widths.push(end);
        ends[i] = end;
        const lightStart = s;
        while (s <= REACH && profiles[row + s] < threshold) s++;
        lights.push(paperRun(row, lightStart));
        if (s > REACH) continue;
        const light = s - lightStart;
        const darkStart = s;
        while (s <= REACH && profiles[row + s] >= threshold) s++;
        if (s > REACH) continue;
        const dark = s - darkStart;
        if (light <= 28 && dark >= 1 && dark <= 20) {
          gaps.push(light);
          outers.push(crossing(row, s));
          afters.push(paperRun(row, s));
        }
      }
      if (widths.length > N * 0.25) {
        stroke = median(widths);
        line = stroke;
        let lightRuns = lights;
        if (gaps.length > widths.length * 0.6 && percentile(gaps, 0.75) - percentile(gaps, 0.25) <= 4) {
          double = true;
          line = median(outers);
          lightRuns = afters;
        }
        const p = percentile(lightRuns, 0.3);
        if (p >= 2 && p <= 14) halo = p;
      }
    }
    // Its colour, in its middle
    const inks = [[], [], []];
    if (stroke > 0.8) {
      for (let i = 0; i < N; i += 2) {
        const s = stroke / 2;
        bilinear(source, pts[i * 2] + Math.sin(angle[i]) * s, pts[i * 2 + 1] - Math.cos(angle[i]) * s, c);
        inks[0].push(c[0]);
        inks[1].push(c[1]);
        inks[2].push(c[2]);
      }
    }
    const ink = stroke > 0.8 ? inks.map(median) : fill.slice();
    const edge = line + halo;
    // The page just past it: plain enough to paint where the old bubble no longer is? Read
    // in a ring all around, a few pixels out from the outline's edge.
    const ringOut = distanceTo(inside, w, h);
    const around = [[], [], []];
    for (let i = 0; i < w * h; i += 2) {
      const d = ringOut[i];
      if (d < edge + 3 || d > edge + 9) continue;
      const pi = i * 4;
      around[0].push(source.rgba[pi]);
      around[1].push(source.rgba[pi + 1]);
      around[2].push(source.rgba[pi + 2]);
    }
    const outside = around.map(median);
    const offs = [];
    for (let k = 0; k < around[0].length; k++) offs.push(Math.max(Math.abs(around[0][k] - outside[0]), Math.abs(around[1][k] - outside[1]), Math.abs(around[2][k] - outside[2])));
    // Plain: hardly any of it differs, not even a panel's border crossing it
    const plainOutside = around[0].length > 20 && percentile(offs, 0.9) <= 18 && offs.filter((d) => d > 40).length <= offs.length * 0.012;

    // What the bubble covers on the page, its line and halo with it
    const reachOut = ringOut;
    const footprint = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) footprint[i] = reachOut[i] <= edge + 4 ? 1 : 0;

    // A tail drawn as a thin spike, two lines and hardly any inside: ink that sticks out of the
    // line, narrow, and ends before the window does
    let spike = null;
    if (peak >= 40) {
      const threshold = peak / 2;
      const ink = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        if (reachOut[i] <= edge + 1.5 || reachOut[i] > 400) continue;
        const pi = i * 4;
        const L = source.rgba[pi] * 0.299 + source.rgba[pi + 1] * 0.587 + source.rgba[pi + 2] * 0.114;
        if (Math.abs(L - fillLuma) >= threshold) ink[i] = 1;
      }
      const joined = shrink(grow(ink, w, h, 1.5), w, h, 1.5);
      const { label, sizes } = pieces(joined, w, h);
      const info = sizes.map(() => ({ border: false, ring: false, reach: 0, tip: -1 }));
      for (let i = 0; i < w * h; i++) {
        const id = label[i];
        if (!id) continue;
        const one = info[id];
        const px = i % w;
        const py = (i - px) / w;
        if (px === 0 || py === 0 || px === w - 1 || py === h - 1) one.border = true;
        if (reachOut[i] <= edge + 3.5) one.ring = true;
        if (reachOut[i] > one.reach) {
          one.reach = reachOut[i];
          one.tip = i;
        }
      }
      const longest = Math.max(region.box.right - region.box.left, region.box.bottom - region.box.top);
      let best = 0;
      for (let id = 1; id < sizes.length; id++) {
        const one = info[id];
        const reach = one.reach - edge;
        if (one.border || !one.ring || reach < 10 || reach > longest * 0.9 || sizes[id] > reach * 16) continue;
        if (!best || one.reach > info[best].reach) best = id;
      }
      // Its lines are the outline's own: a stroke of an SFX or of the art is thicker
      if (best) {
        const own = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) own[i] = label[i] === best && ink[i] ? 0 : 1;
        const depth = distanceTo(own, w, h);
        let thickest = 0;
        for (let i = 0; i < w * h; i++) if (label[i] === best && ink[i] && depth[i] > thickest) thickest = depth[i];
        // And it is short for its width where it leaves the outline, never widening: a line of
        // the art that touches the outline is long and thin all along.
        const reach = info[best].reach - edge;
        const rows = new Float32Array(Math.ceil(reach) + 2);
        for (let i = 0; i < w * h; i++) {
          if (label[i] !== best) continue;
          const d = Math.floor(reachOut[i] - edge);
          if (d >= 0 && d < rows.length) rows[d]++;
        }
        const widthOver = (from, to) => {
          let sum = 0;
          let count = 0;
          for (let d = Math.max(1, Math.floor(from)); d <= Math.ceil(to) && d < rows.length; d++) {
            sum += rows[d];
            count++;
          }
          return count ? sum / count : 0;
        };
        const near = widthOver(1, Math.max(2, reach * 0.3));
        const far = widthOver(reach * 0.6, reach * 0.9);
        if (thickest > Math.max(stroke * 0.65 + 1.5, 3) || near < Math.max(4, stroke * 1.5) || reach > near * 5.5 || far > near * 1.25) best = 0;
      }
      if (best) {
        const mask = new Float32Array(w * h);
        const piece = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) piece[i] = label[i] === best ? 1 : 0;
        // It starts in the outline's own line, so that it joins it with no break
        {
          const close = distanceTo(piece, w, h);
          for (let i = 0; i < w * h; i++) {
            if (piece[i] || close[i] > 3 || reachOut[i] <= edge * 0.4 || reachOut[i] > edge + 2) continue;
            const L = source.rgba[i * 4] * 0.299 + source.rgba[i * 4 + 1] * 0.587 + source.rgba[i * 4 + 2] * 0.114;
            if (Math.abs(L - fillLuma) >= threshold) piece[i] = 1;
          }
        }
        const near = distanceTo(piece, w, h);
        let rx = 0;
        let ry = 0;
        let rn = 0;
        for (let i = 0; i < w * h; i++) {
          if (near[i] <= 2.5) mask[i] = clamp(2.5 - near[i], 0, 1);
          if (near[i] <= 3.5) footprint[i] = 1;
          if (piece[i] && reachOut[i] <= edge + 4) {
            rx += i % w;
            ry += Math.floor(i / w);
            rn++;
          }
        }
        if (rn) {
          const root = [rx / rn + win.left + 0.5, ry / rn + win.top + 0.5];
          let anchorIndex = 0;
          let near2 = Infinity;
          for (let i = 0; i < N; i++) {
            const d = (pts[i * 2] - root[0]) ** 2 + (pts[i * 2 + 1] - root[1]) ** 2;
            if (d < near2) {
              near2 = d;
              anchorIndex = i;
            }
          }
          const t = info[best].tip;
          spike = { mask, root, anchorIndex, tip: [(t % w) + win.left + 0.5, Math.floor(t / w) + win.top + 0.5] };
        }
      }
    }

    // Soft: the page around has no fine detail (a tone, a gradient, a blur). What the bubble
    // hid there is carried in from all around it, so the old bubble goes without a trace.
    let under = null;
    if (!plainOutside) {
      const lumaAt = (i) => source.rgba[i * 4] * 0.299 + source.rgba[i * 4 + 1] * 0.587 + source.rgba[i * 4 + 2] * 0.114;
      const detail = [];
      for (let yy = 1; yy < h - 1; yy++) {
        for (let xx = 1; xx < w - 1; xx += 2) {
          const i = yy * w + xx;
          if (reachOut[i] < edge + 4 || reachOut[i] > edge + 16 || footprint[i]) continue;
          detail.push(Math.abs(4 * lumaAt(i) - lumaAt(i - 1) - lumaAt(i + 1) - lumaAt(i - w) - lumaAt(i + w)));
        }
      }
      if (detail.length > 60 && percentile(detail, 0.75) <= 20 && percentile(detail, 0.9) <= 45) {
        // The tone only: a panel's border or a line of ink nearby would smudge it
        const tones = [];
        for (let i = 0; i < w * h; i += 3) if (!footprint[i] && reachOut[i] <= edge + 20) tones.push(lumaAt(i));
        const tone = median(tones);
        const rgb = new Float32Array(w * h * 3);
        const known = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          if (footprint[i] || reachOut[i] > edge + 20 || Math.abs(lumaAt(i) - tone) > 28) continue;
          known[i] = 1;
          rgb[i * 3] = source.rgba[i * 4];
          rgb[i * 3 + 1] = source.rgba[i * 4 + 1];
          rgb[i * 3 + 2] = source.rgba[i * 4 + 2];
        }
        // First a test: a ring of the page around, hidden, comes back as it was?
        const test = Uint8Array.from(known);
        for (let i = 0; i < w * h; i++) if (known[i] && reachOut[i] < edge + 11) test[i] = 0;
        const guess = pushPull(rgb, test, w, h);
        const misses = [];
        for (let i = 0; i < w * h; i += 2) {
          if (footprint[i] || reachOut[i] < edge + 4 || reachOut[i] >= edge + 11) continue;
          misses.push(Math.abs(guess[i * 3] * 0.299 + guess[i * 3 + 1] * 0.587 + guess[i * 3 + 2] * 0.114 - lumaAt(i)));
        }
        const filled = misses.length > 60 && percentile(misses, 0.5) <= 2.5 && percentile(misses, 0.9) <= 15 ? pushPull(rgb, known, w, h) : null;
        if (filled) under = new Uint8ClampedArray(w * h * 3);
        for (let i = 0; filled && i < w * h; i++) {
          if (!footprint[i]) continue;
          under[i * 3] = filled[i * 3];
          under[i * 3 + 1] = filled[i * 3 + 1];
          under[i * 3 + 2] = filled[i * 3 + 2];
        }
      }
    }

    // The tail: what an opening by a disc leaves out, if one piece sticks out much further
    let maxDepth = 0;
    for (let i = 0; i < w * h; i++) if (inDepth[i] > maxDepth) maxDepth = inDepth[i];
    const disc = Math.max(5, maxDepth * 0.4);
    const body = grow(shrink(inside, w, h, disc), w, h, disc);
    const fromBody = distanceTo(body, w, h);
    const sticking = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) sticking[i] = inside[i] && fromBody[i] > 2 ? 1 : 0;
    const { label: stickLabel, sizes: stickSizes } = pieces(sticking, w, h);
    const reachOf = new Float32Array(stickSizes.length);
    for (let i = 0; i < w * h; i++) if (stickLabel[i] && fromBody[i] > reachOf[stickLabel[i]]) reachOf[stickLabel[i]] = fromBody[i];
    const order = [];
    for (let id = 1; id < stickSizes.length; id++) if (reachOf[id] > Math.max(disc * 1.1, 12)) order.push(id);
    order.sort((a, b) => stickSizes[b] - stickSizes[a]);
    let tailId = 0;
    if (order.length === 1 || (order.length > 1 && stickSizes[order[0]] > stickSizes[order[1]] * 2.5)) tailId = order[0];
    const weight = new Float32Array(N);
    let tail = null;
    if (tailId) {
      const grownTail = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) grownTail[i] = stickLabel[i] === tailId ? 1 : 0;
      const nearTail = distanceTo(grownTail, w, h);
      for (let i = 0; i < N; i++) {
        const lx = clamp(Math.floor(pts[i * 2] - Math.sin(angle[i]) - win.left), 0, w - 1);
        const ly = clamp(Math.floor(pts[i * 2 + 1] + Math.cos(angle[i]) - win.top), 0, h - 1);
        const j = ly * w + lx;
        if (nearTail[j] > 2.5) continue;
        weight[i] = smoothstep((fromBody[j] - 1) / Math.max(4, disc * 0.6));
      }
      // One run along the outline only, the longest
      let bestStart = -1;
      let bestLength = 0;
      for (let i = 0; i < N; i++) {
        if (!weight[i] || weight[(i - 1 + N) % N]) continue;
        let length = 0;
        while (length < N && weight[(i + length) % N]) length++;
        if (length > bestLength) {
          bestLength = length;
          bestStart = i;
        }
      }
      if (bestStart < 0 && weight[0]) {
        bestStart = 0;
        bestLength = N;
      }
      if (bestStart >= 0 && bestLength > 6 && bestLength < N * 0.5) {
        for (let i = 0; i < N; i++) {
          const k = (i - bestStart + N) % N;
          if (k >= bestLength) weight[i] = 0;
        }
        const a = (bestStart - 1 + N) % N;
        const b = (bestStart + bestLength) % N;
        const anchor = [(pts[a * 2] + pts[b * 2]) / 2, (pts[a * 2 + 1] + pts[b * 2 + 1]) / 2];
        let tipIndex = bestStart;
        let far = -1;
        for (let k = 0; k < bestLength; k++) {
          const i = (bestStart + k) % N;
          const d = Math.hypot(pts[i * 2] - anchor[0], pts[i * 2 + 1] - anchor[1]);
          if (d > far) {
            far = d;
            tipIndex = i;
          }
        }
        if (far > 8) tail = { start: bestStart, length: bestLength, anchor, a: [pts[a * 2], pts[a * 2 + 1]], b: [pts[b * 2], pts[b * 2 + 1]], tip: [pts[tipIndex * 2], pts[tipIndex * 2 + 1]], tipIndex };
        else weight.fill(0);
      } else weight.fill(0);
    }

    // The body's box: the handles go around it
    let bl = Infinity;
    let bt = Infinity;
    let br = -Infinity;
    let bb = -Infinity;
    for (let i = 0; i < N; i++) {
      if (weight[i] >= 0.5) continue;
      bl = Math.min(bl, pts[i * 2]);
      br = Math.max(br, pts[i * 2]);
      bt = Math.min(bt, pts[i * 2 + 1]);
      bb = Math.max(bb, pts[i * 2 + 1]);
    }
    const box = { left: bl, top: bt, right: br, bottom: bb };

    const model = {
      page: { width: W, height: H },
      points: pts,
      angle,
      count: N,
      weight,
      tail,
      box,
      fill,
      flat,
      ink,
      stroke,
      line,
      double,
      halo,
      edge,
      inner: 3,
      outside,
      plainOutside,
      source,
      footprint,
      ends,
      spike,
      fillLuma,
      under,
    };
    model.corner = cornerReach(model);
    model.pattern = patternOf(model);
    model.kind = kindOf(model, inside, w, h);
    // A shout's spikes are its outline, and a tail found whole is not found twice
    if (model.spike && (model.kind === "pattern" || (tail && Math.hypot(model.spike.tip[0] - tail.tip[0], model.spike.tip[1] - tail.tip[1]) < 60))) model.spike = null;
    return model;
  };

  // How far a rounded corner reaches along each side, from the box's corners
  const cornerReach = (model) => {
    const { points, count, box, weight } = model;
    const corners = [[box.left, box.top], [box.right, box.top], [box.right, box.bottom], [box.left, box.bottom]];
    let most = 0;
    corners.forEach(([cx, cy]) => {
      let near = Infinity;
      for (let i = 0; i < count; i++) {
        if (weight[i] > 0) continue;
        near = Math.min(near, Math.hypot(points[i * 2] - cx, points[i * 2 + 1] - cy));
      }
      most = Math.max(most, near / 0.4142);
    });
    const half = Math.min(box.right - box.left, box.bottom - box.top) / 2;
    return clamp(most * 1.15 + model.stroke, 6, half * 0.9);
  };

  // Bumps (a cloud) or spikes (a shout): the outline in pieces, valley to valley, around a
  // smooth shape
  const patternOf = (model) => {
    const { points, count: N } = model;
    let base = points;
    const window = Math.max(9, Math.round(N / 9)) | 1;
    for (let pass = 0; pass < 3; pass++) {
      const next = new Float64Array(base.length);
      const half = window >> 1;
      let sx = 0;
      let sy = 0;
      for (let k = -half; k <= half; k++) {
        const j = ((k % N) + N) % N;
        sx += base[j * 2];
        sy += base[j * 2 + 1];
      }
      for (let i = 0; i < N; i++) {
        next[i * 2] = sx / window;
        next[i * 2 + 1] = sy / window;
        const out = ((i - half) % N + N) % N;
        const inn = (i + half + 1) % N;
        sx += base[inn * 2] - base[out * 2];
        sy += base[inn * 2 + 1] - base[out * 2 + 1];
      }
      base = next;
    }
    const baseAngle = anglesOf(base, 3);
    const detail = new Float64Array(N);
    for (let i = 0; i < N; i++) detail[i] = (points[i * 2] - base[i * 2]) * Math.sin(baseAngle[i]) - (points[i * 2 + 1] - base[i * 2 + 1]) * Math.cos(baseAngle[i]);
    const soft = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += detail[(i + k + N) % N];
      soft[i] = s / 5;
    }
    const gap = Math.max(6, Math.round(N / 70));
    const valleys = [];
    for (let i = 0; i < N; i++) {
      let low = true;
      for (let k = 1; k <= gap && low; k++) if (soft[(i + k) % N] < soft[i] || soft[(i - k + N) % N] <= soft[i]) low = false;
      if (low) valleys.push(i);
    }
    // Only real valleys: a bump rises between each
    const kept = [];
    const rises = [];
    for (let v = 0; v < valleys.length; v++) {
      const a = valleys[v];
      const b = valleys[(v + 1) % valleys.length];
      let top = -Infinity;
      for (let k = a; k !== b; k = (k + 1) % N) top = Math.max(top, soft[k]);
      rises.push(top - Math.max(soft[a], soft[b]));
    }
    for (let v = 0; v < valleys.length; v++) if (rises[v] >= 2 || rises[(v - 1 + valleys.length) % valleys.length] >= 2) kept.push(valleys[v]);
    const size = Math.min(model.box.right - model.box.left, model.box.bottom - model.box.top);
    const amplitude = median(rises);
    // A cloud's or a shout's valleys are hollows, where the outline turns back: a polygon's
    // sides are never hollow
    const angle = model.angle;
    let hollow = 0;
    kept.forEach((v) => {
      const turn = wrapPi(angle[(v + 4) % N] - angle[(v - 4 + N) % N]);
      if (turn < -0.25) hollow++;
    });
    const strong = kept.length >= 9 && hollow >= kept.length * 0.6 && amplitude >= Math.max(3, size * 0.025);
    return { base, baseAngle, valleys: kept, amplitude, hollow, strong };
  };

  const kindOf = (model, inside, w, h) => {
    if (model.pattern.strong) return "pattern";
    const { box } = model;
    let area = 0;
    for (let i = 0; i < w * h; i++) area += inside[i];
    if (model.tail) area -= model.tail.length * 6;
    const ratio = area / Math.max(1, (box.right - box.left) * (box.bottom - box.top));
    return ratio > 0.9 ? "corners" : "smooth";
  };

  /* ---------------------------- the new shape ---------------------------- */

  // How the body's points move from the old box to the new one
  const bodyMap = (model, params, kind) => {
    const a = model.box;
    const b = params.box;
    const aw = a.right - a.left || 1;
    const ah = a.bottom - a.top || 1;
    const sx = (b.right - b.left) / aw;
    const sy = (b.bottom - b.top) / ah;
    if (kind !== "corners") return (x, y) => [b.left + (x - a.left) * sx, b.top + (y - a.top) * sy];
    // Corners keep their size, the sides between them take the difference
    const k = model.corner;
    const axis = (v, a0, a1, b0, b1) => {
      const ha = (a1 - a0) / 2;
      const hb = (b1 - b0) / 2;
      const ca = (a0 + a1) / 2;
      const cb = (b0 + b1) / 2;
      const t = v - ca;
      const kk = Math.min(k, ha * 0.95, hb * 0.95);
      const sign = t < 0 ? -1 : 1;
      const u = Math.abs(t);
      const innerA = ha - kk;
      const innerB = hb - kk;
      if (innerA <= 0.5) return cb + (t * hb) / (ha || 1);
      if (u <= innerA) return cb + (t * innerB) / innerA;
      return cb + sign * (innerB + (u - innerA));
    };
    return (x, y) => [axis(x, a.left, a.right, b.left, b.right), axis(y, a.top, a.bottom, b.top, b.bottom)];
  };

  // Where a tail points once its root has moved, unless its tip was dragged: still at the
  // speaker, or carried with its root when the bubble would swallow it
  const autoTip = (anchor, tip, anchorNew, wanted) => {
    if (wanted) return wanted;
    const L = Math.hypot(tip[0] - anchor[0], tip[1] - anchor[1]) || 1;
    const dx = tip[0] - anchorNew[0];
    const dy = tip[1] - anchorNew[1];
    const Ln = Math.hypot(dx, dy);
    const same = (dx * (tip[0] - anchor[0]) + dy * (tip[1] - anchor[1])) / (L * (Ln || 1));
    if (Ln >= L * 0.6 && same > 0.5) return tip;
    return [anchorNew[0] + tip[0] - anchor[0], anchorNew[1] + tip[1] - anchor[1]];
  };
  // A tail's tip once the bubble is reshaped then turned: placed as for a reshape alone (still
  // at the speaker, or carried), then turned with the bubble. A dragged tip stays where it is.
  const turnedTip = (anchor, tip, map, params) => {
    if (params.tip) return params.tip;
    const a0 = map.body(anchor[0], anchor[1]);
    // Turned, the bubble takes its tail along as it is: the speaker is no longer where it
    // pointed, and aiming at it would bend the tail away from the outline
    if (params.angle) return map.spin([a0[0] + tip[0] - anchor[0], a0[1] + tip[1] - anchor[1]]);
    return map.spin(autoTip(anchor, tip, a0, null));
  };
  // The tail as a triangle, its root's two ends where the body's outline takes them and its
  // tip where it points: one piece, no seam where it leaves the body
  const tailTriangle = (model, map, params) => {
    const { a, b, tip, anchor } = model.tail;
    const A = map(a[0], a[1]);
    const B = map(b[0], b[1]);
    const tipNew = turnedTip(anchor, tip, map, params);
    const det = (b[1] - tip[1]) * (a[0] - tip[0]) + (tip[0] - b[0]) * (a[1] - tip[1]);
    if (Math.abs(det) < 1) return null;
    return {
      tipNew,
      map: (x, y) => {
        const l1 = ((b[1] - tip[1]) * (x - tip[0]) + (tip[0] - b[0]) * (y - tip[1])) / det;
        const l2 = ((tip[1] - a[1]) * (x - tip[0]) + (a[0] - tip[0]) * (y - tip[1])) / det;
        const l3 = 1 - l1 - l2;
        return [l1 * A[0] + l2 * B[0] + l3 * tipNew[0], l1 * A[1] + l2 * B[1] + l3 * tipNew[1]];
      },
    };
  };
  // The tail goes from the new place of its root to its tip, keeping its width
  const tailMap = (model, map, params) => {
    const tail = model.tail;
    const anchor = tail.anchor;
    const anchorNew = map(anchor[0], anchor[1]);
    const tip = tail.tip;
    const tipNew = turnedTip(anchor, tip, map, params);
    const L = Math.hypot(tip[0] - anchor[0], tip[1] - anchor[1]) || 1;
    const Ln = Math.hypot(tipNew[0] - anchorNew[0], tipNew[1] - anchorNew[1]) || 1;
    const u = [(tip[0] - anchor[0]) / L, (tip[1] - anchor[1]) / L];
    const un = [(tipNew[0] - anchorNew[0]) / Ln, (tipNew[1] - anchorNew[1]) / Ln];
    const stretch = Ln / L;
    return (x, y) => {
      const dx = x - anchor[0];
      const dy = y - anchor[1];
      const along = (dx * u[0] + dy * u[1]) * stretch;
      const across = -dx * u[1] + dy * u[0];
      return [anchorNew[0] + along * un[0] - across * un[1], anchorNew[1] + along * un[1] + across * un[0]];
    };
  };

  // The turn of the box about its middle, and the same for a mere direction
  const spinOf = (params) => {
    const angle = params.angle || 0;
    const b = params.box;
    const cx = (b.left + b.right) / 2;
    const cy = (b.top + b.bottom) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const spin = angle ? (p) => [cx + (p[0] - cx) * cos - (p[1] - cy) * sin, cy + (p[0] - cx) * sin + (p[1] - cy) * cos] : (p) => p;
    spin.turn = angle ? (dx, dy) => [dx * cos - dy * sin, dx * sin + dy * cos] : (dx, dy) => [dx, dy];
    spin.back = angle ? (x, y) => [cx + (x - cx) * cos + (y - cy) * sin, cy - (x - cx) * sin + (y - cy) * cos] : (x, y) => [x, y];
    return spin;
  };
  // A box point given as shares of the box (0 to 1), on another box
  const onBox = (box, u, v) => [box.left + (box.right - box.left) * u, box.top + (box.bottom - box.top) * v];

  // Where a spike of a tail goes on a new outline: its root at the same place along it
  const spikePlace = (model, shape) => {
    const spike = model.spike;
    const N = model.count;
    let k = 0;
    let gapBest = Infinity;
    for (let q = 0; q < shape.n; q++) {
      let d = Math.abs(shape.src[q] - spike.anchorIndex);
      d = Math.min(d, N - d);
      if (d < gapBest) {
        gapBest = d;
        k = q;
      }
    }
    const a0 = model.points[spike.anchorIndex * 2];
    const a1 = model.points[spike.anchorIndex * 2 + 1];
    const turnBy = shape.angle[k] + (shape.inverted ? Math.PI : 0) - model.angle[spike.anchorIndex];
    const ox = spike.root[0] - a0;
    const oy = spike.root[1] - a1;
    const anchor = spike.root;
    const anchorNew = [shape.x[k] + ox * Math.cos(turnBy) - oy * Math.sin(turnBy), shape.y[k] + ox * Math.sin(turnBy) + oy * Math.cos(turnBy)];
    // Turned, it leaves the outline as it did, its shape kept; else it still points where it did
    const along = [spike.tip[0] - anchor[0], spike.tip[1] - anchor[1]];
    const carried = [anchorNew[0] + along[0] * Math.cos(turnBy) - along[1] * Math.sin(turnBy), anchorNew[1] + along[0] * Math.sin(turnBy) + along[1] * Math.cos(turnBy)];
    const tipNew = shape.tip || (shape.turned ? carried : autoTip(anchor, spike.tip, anchorNew, null));
    return { anchor, anchorNew, tip: spike.tip, tipNew, turnBy };
  };

  // The new outline: { x, y, src, n }. Each point knows the old point whose line it takes.
  const shapeOf = (model, params) => {
    const kind = params.kind || model.kind;
    const { points, count: N, weight, tail } = model;
    // Turned about the box's middle, after its shape is made
    const spin = spinOf(params);
    const bodyOf = bodyMap(model, params, kind === "pattern" ? "smooth" : kind);
    const map = (x, y) => spin(bodyOf(x, y));
    map.body = bodyOf;
    map.spin = spin;
    const triangle = tail && tail.a ? tailTriangle(model, map, params) : null;
    const tmap = triangle ? null : tail ? tailMap(model, map, params) : null;
    const xs = [];
    const ys = [];
    const src = [];
    const put = (i) => {
      let [x, y] = map(points[i * 2], points[i * 2 + 1]);
      const wgt = weight[i];
      if (wgt > 0 && triangle) [x, y] = triangle.map(points[i * 2], points[i * 2 + 1]);
      else if (wgt > 0 && tmap) {
        const [tx, ty] = tmap(points[i * 2], points[i * 2 + 1]);
        x += (tx - x) * wgt;
        y += (ty - y) * wgt;
      }
      xs.push(x);
      ys.push(y);
      src.push(i);
    };
    const pattern = model.pattern;
    if (kind === "pattern" && pattern.valleys.length >= 4) {
      // The bumps between valleys are laid again along the new smooth shape, as many as fit
      const { base, baseAngle } = pattern;
      const start = tail ? (tail.start + tail.length) % N : pattern.valleys[0];
      const length = tail ? N - tail.length : N;
      const along = (k) => (start + k) % N;
      // The new base, by its length
      const nb = [];
      const cum = [0];
      for (let k = 0; k <= length; k++) {
        const i = along(Math.min(k, length - (tail ? 1 : 0)) % N);
        const p = map(base[i * 2], base[i * 2 + 1]);
        nb.push(p);
        if (k) cum.push(cum[k - 1] + Math.hypot(p[0] - nb[k - 1][0], p[1] - nb[k - 1][1]));
      }
      const oldCum = [0];
      for (let k = 1; k <= length; k++) {
        const i = along(k - 1);
        const j = along(k);
        oldCum.push(oldCum[k - 1] + Math.hypot(base[j * 2] - base[i * 2], base[j * 2 + 1] - base[i * 2 + 1]));
      }
      const newTotal = cum[cum.length - 1];
      const at = (s) => {
        // A point and direction on the new base at length s
        let lo = 0;
        let hi = cum.length - 1;
        s = clamp(s, 0, newTotal);
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] <= s) lo = mid;
          else hi = mid;
        }
        const t = (s - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
        const p = [nb[lo][0] + (nb[hi][0] - nb[lo][0]) * t, nb[lo][1] + (nb[hi][1] - nb[lo][1]) * t];
        const a = nb[Math.max(0, lo - 3)];
        const b = nb[Math.min(nb.length - 1, hi + 3)];
        return { p, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
      };
      // The valleys along this run
      const marks = [];
      pattern.valleys.forEach((v) => {
        const k = (v - start + N) % N;
        if (k < length) marks.push(k);
      });
      marks.sort((a, b) => a - b);
      if (!tail) {
        if (marks[0] !== 0) marks.unshift(0);
        marks.push(length);
      } else {
        marks.unshift(0);
        marks.push(length);
      }
      const segments = [];
      for (let m = 0; m + 1 < marks.length; m++) if (marks[m + 1] > marks[m]) segments.push([marks[m], marks[m + 1]]);
      // Ends of a run beside a tail stay as they are, only the whole bumps between repeat
      const fixedHead = tail ? segments.shift() : null;
      const fixedTail = tail ? segments.pop() : null;
      const lengthOf = (seg) => (seg ? oldCum[seg[1]] - oldCum[seg[0]] : 0);
      const middle = segments.reduce((sum, seg) => sum + lengthOf(seg), 0);
      const oldTotal = oldCum[length];
      const count = segments.length ? Math.max(1, Math.round(segments.length * (newTotal / Math.max(1, oldTotal)))) : 0;
      const sequence = [];
      if (fixedHead) sequence.push(fixedHead);
      for (let k = 0; k < count; k++) sequence.push(segments[Math.min(segments.length - 1, Math.floor((k * segments.length) / count))]);
      if (fixedTail) sequence.push(fixedTail);
      const laid = sequence.reduce((sum, seg) => sum + lengthOf(seg), 0) || middle || 1;
      const scale = newTotal / laid;
      let s0 = 0;
      sequence.forEach((seg) => {
        // Each bump or spike is laid whole, turned as the new base turns under its middle, so
        // it keeps its own shape; only its ends follow the base, to meet the next one
        const mid = Math.round((seg[0] + seg[1]) / 2);
        const im = along(mid % N);
        const um = oldCum[Math.min(mid, length)] - oldCum[seg[0]];
        const middle = at(s0 + um * scale);
        const tm = baseAngle[im];
        const span = Math.max(1, seg[1] - seg[0]);
        for (let k = seg[0]; k < seg[1]; k++) {
          const i = along(k % N);
          const u = oldCum[Math.min(k, length)] - oldCum[seg[0]];
          const { p, angle } = at(s0 + u * scale);
          // The point's place around the old base, in the base's own directions
          const ox = points[i * 2] - base[i * 2];
          const oy = points[i * 2 + 1] - base[i * 2 + 1];
          const ta = baseAngle[i];
          const along0 = ox * Math.cos(ta) + oy * Math.sin(ta);
          const across0 = ox * Math.sin(ta) - oy * Math.cos(ta);
          const fx = p[0] + along0 * Math.cos(angle) + across0 * Math.sin(angle);
          const fy = p[1] + along0 * Math.sin(angle) - across0 * Math.cos(angle);
          // The same point, from the bump's middle
          const mx = points[i * 2] - base[im * 2];
          const my = points[i * 2 + 1] - base[im * 2 + 1];
          const a1 = (mx * Math.cos(tm) + my * Math.sin(tm)) * scale;
          const c1 = mx * Math.sin(tm) - my * Math.cos(tm);
          const rx = middle.p[0] + a1 * Math.cos(middle.angle) + c1 * Math.sin(middle.angle);
          const ry = middle.p[1] + a1 * Math.sin(middle.angle) - c1 * Math.cos(middle.angle);
          const t = (k - seg[0]) / span;
          const whole = smoothstep(Math.min(t, 1 - t) / 0.22);
          xs.push(fx + (rx - fx) * whole);
          ys.push(fy + (ry - fy) * whole);
          src.push(i);
        }
        s0 += lengthOf(seg) * scale;
      });
      if (tail) for (let k = 0; k < tail.length; k++) put((tail.start + k) % N);
    } else {
      for (let i = 0; i < N; i++) put(i);
    }
    // Pulls: a bit of the outline taken by the hand, the rest following softly
    (params.pulls || []).forEach((pull) => {
      // Its place and its pull are the box's own: they turn with it
      const [px, py] = spin(onBox(params.box, pull.u, pull.v));
      const [ddx, ddy] = spin.turn(pull.dx, pull.dy);
      const r2 = 2 * pull.r * pull.r;
      for (let k = 0; k < xs.length; k++) {
        const wgt = Math.exp(-((xs[k] - px) ** 2 + (ys[k] - py) ** 2) / r2);
        xs[k] += ddx * wgt;
        ys[k] += ddy * wgt;
      }
    });
    const out = resampleShape(xs, ys, src, N);
    out.tip = params.tip || null;
    out.spin = spin;
    out.turned = Boolean(params.angle);
    // Where the tail's tip is, for its handle
    if (triangle) out.tipAt = triangle.tipNew;
    else if (tail) out.tipAt = turnedTip(tail.anchor, tail.tip, map, params);
    else if (model.spike) out.tipAt = spikePlace(model, out).tipNew;
    return out;
  };

  // A pixel apart again, each point still knowing where its line comes from
  const resampleShape = (xs, ys, src, N) => {
    const n = xs.length;
    const cum = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      cum[k + 1] = cum[k] + Math.hypot(xs[j] - xs[k], ys[j] - ys[k]);
    }
    const total = cum[n];
    const m = Math.max(8, Math.round(total));
    const X = new Float64Array(m);
    const Y = new Float64Array(m);
    const S = new Float64Array(m);
    let seg = 0;
    for (let q = 0; q < m; q++) {
      const s = (q * total) / m;
      while (seg < n - 1 && cum[seg + 1] < s) seg++;
      const j = (seg + 1) % n;
      const t = (s - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
      X[q] = xs[seg] + (xs[j] - xs[seg]) * t;
      Y[q] = ys[seg] + (ys[j] - ys[seg]) * t;
      let d = src[j] - src[seg];
      if (d > N / 2) d -= N;
      if (d < -N / 2) d += N;
      S[q] = Math.abs(d) <= 4 ? (((src[seg] + d * t) % N) + N) % N : t < 0.5 ? src[seg] : src[j];
    }
    const pts = new Float64Array(m * 2);
    for (let q = 0; q < m; q++) {
      pts[q * 2] = X[q];
      pts[q * 2 + 1] = Y[q];
    }
    if (areaOf(pts) < 0) return { x: X, y: Y, src: S, n: m, angle: anglesOf(pts, 2), inverted: true };
    return { x: X, y: Y, src: S, n: m, angle: anglesOf(pts, 2) };
  };

  const insidePolygon = (shape, px, py) => {
    const { x, y, n } = shape;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if (y[i] > py !== y[j] > py && px < ((x[j] - x[i]) * (py - y[i])) / (y[j] - y[i]) + x[i]) inside = !inside;
    }
    return inside;
  };

  /* ------------------------------ drawing ------------------------------ */

  // Colours carried into the unknown pixels from the known ones, coarser then finer (push-pull)
  const pushPull = (rgb, known, w, h) => {
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
      const nbl = new Float32Array(nw * nh);
      const nk = new Float32Array(nw * nh);
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const i = y * lw + x;
          if (!k[i]) continue;
          const j = (y >> 1) * nw + (x >> 1);
          nr[j] += r[i];
          ng[j] += g[i];
          nbl[j] += b[i];
          nk[j] += k[i];
        }
      }
      lw = nw;
      lh = nh;
      r = nr;
      g = ng;
      b = nbl;
      k = nk;
      levels.push({ w: lw, h: lh, r, g, b, k });
    }
    const flatOf = (level) => {
      const out = new Float32Array(level.w * level.h * 3);
      for (let i = 0; i < level.w * level.h; i++) {
        if (!level.k[i]) continue;
        out[i * 3] = level.r[i] / level.k[i];
        out[i * 3 + 1] = level.g[i] / level.k[i];
        out[i * 3 + 2] = level.b[i] / level.k[i];
      }
      return out;
    };
    let coarse = flatOf(levels[levels.length - 1]);
    for (let n = levels.length - 2; n >= 0; n--) {
      const level = levels[n];
      const above = levels[n + 1];
      const out = flatOf(level);
      for (let y = 0; y < level.h; y++) {
        for (let x = 0; x < level.w; x++) {
          const i = y * level.w + x;
          if (level.k[i]) continue;
          const fx = clamp((x + 0.5) / 2 - 0.5, 0, above.w - 1);
          const fy = clamp((y + 0.5) / 2 - 0.5, 0, above.h - 1);
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
      coarse = out;
    }
    return coarse;
  };

  // Working space kept from one picture to the next: a drag draws the bubble at every move,
  // and fresh arrays of a few megabytes each time cost more than the drawing itself
  const scratch = new Map();
  const scratchOf = (name, Type, length) => {
    let kept = scratch.get(name);
    if (!kept || kept.length < length) {
      kept = new Type(kept ? Math.max(length, Math.min(kept.length * 2, length * 2)) : length);
      scratch.set(name, kept);
    }
    return kept.length === length ? kept : kept.subarray(0, length);
  };

  // The new bubble as a picture. Returns { left, top, width, height, rgba, gap, gapCount,
  // covered } in page pixels: `gap` marks what the old bubble covered that stays uncovered and
  // wasn't painted (the page around it isn't plain), `covered` what the new bubble covers.
  // `quick`, while a handle is dragged: the inside takes the bubble's colour instead of its
  // shades, and the arrays returned are working space, good until the next picture.
  const render = (model, shape, options = {}) => {
    const quick = Boolean(options.quick);
    const { page, source, edge, stroke, line, halo, inner } = model;
    const band = edge + 1.5;
    const R = Math.ceil(Math.max(band, inner) + 2);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < shape.n; k++) {
      minX = Math.min(minX, shape.x[k]);
      maxX = Math.max(maxX, shape.x[k]);
      minY = Math.min(minY, shape.y[k]);
      maxY = Math.max(maxY, shape.y[k]);
    }
    const left = Math.max(0, Math.min(source.left, Math.floor(minX - R - 1)));
    const top = Math.max(0, Math.min(source.top, Math.floor(minY - R - 1)));
    const right = Math.min(page.width, Math.max(source.left + source.width, Math.ceil(maxX + R + 1)));
    const bottom = Math.min(page.height, Math.max(source.top + source.height, Math.ceil(maxY + R + 1)));
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) return null;
    const n = shape.n;
    // How much the outline turns at each point, over a few pixels: a corner where it's sharp
    const MITRE = 7;
    const flip = shape.inverted ? Math.PI : 0;
    const turn = scratchOf("turn", Float32Array, n);
    for (let k = 0; k < n; k++) {
      const wide = wrapPi(shape.angle[(k + MITRE) % n] - shape.angle[(k - MITRE + n) % n]) * (shape.inverted ? -1 : 1);
      // A corner turns all at once; a round end turns as much, but along the way
      const close = wrapPi(shape.angle[(k + 3) % n] - shape.angle[(k - 3 + n) % n]) * (shape.inverted ? -1 : 1);
      turn[k] = close > wide * 0.6 ? wide : 0;
    }
    // A sharp corner's point reaches further than the line is wide
    const reachAt = (k) => (turn[k] > 0.45 ? Math.ceil(band * Math.min(4.5, 1 / Math.cos(Math.min(1.2, turn[k] / 2))) + 2) : R);
    // The nearest outline point of each pixel near the outline
    const best = scratchOf("best", Float32Array, w * h).fill(INF);
    const owner = scratchOf("owner", Int32Array, w * h).fill(-1);
    for (let k = 0; k < n; k++) {
      const qx = shape.x[k];
      const qy = shape.y[k];
      const R = reachAt(k);
      const x0 = Math.max(0, Math.floor(qx - R - left));
      const x1 = Math.min(w - 1, Math.ceil(qx + R - left));
      const y0 = Math.max(0, Math.floor(qy - R - top));
      const y1 = Math.min(h - 1, Math.ceil(qy + R - top));
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy + top + 0.5 - qy;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx + left + 0.5 - qx;
          const d = dx * dx + dy * dy;
          const i = yy * w + xx;
          if (d < best[i]) {
            best[i] = d;
            owner[i] = k;
          }
        }
      }
    }
    // Inside or out, row by row: where the outline crosses each row, from the rows each of
    // its edges spans (the rows whose middle is at or past the edge's top, short of its bottom)
    const inside = scratchOf("inside", Uint8Array, w * h).fill(0);
    const rowStart = scratchOf("rowStart", Int32Array, h + 1).fill(0);
    const rowOf = (y) => Math.ceil(y - top - 0.5);
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = shape.y[i];
      const yj = shape.y[j];
      const y0 = Math.max(0, rowOf(Math.min(yi, yj)));
      const y1 = Math.min(h, rowOf(Math.max(yi, yj)));
      for (let yy = y0; yy < y1; yy++) rowStart[yy + 1]++;
    }
    for (let yy = 0; yy < h; yy++) rowStart[yy + 1] += rowStart[yy];
    const crossings = scratchOf("crossings", Float64Array, rowStart[h]);
    const rowFill = scratchOf("rowFill", Int32Array, h);
    rowFill.set(rowStart.subarray(0, h));
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = shape.y[i];
      const yj = shape.y[j];
      const y0 = Math.max(0, rowOf(Math.min(yi, yj)));
      const y1 = Math.min(h, rowOf(Math.max(yi, yj)));
      for (let yy = y0; yy < y1; yy++) crossings[rowFill[yy]++] = shape.x[i] + ((shape.x[j] - shape.x[i]) * (yy + top + 0.5 - yi)) / (yj - yi);
    }
    for (let yy = 0; yy < h; yy++) {
      const from = rowStart[yy];
      const to = rowStart[yy + 1];
      if (to - from < 2) continue;
      const row = crossings.subarray(from, to).sort();
      for (let c = 0; c + 1 < row.length; c += 2) {
        const x0 = Math.max(0, Math.ceil(row[c] - left - 0.5));
        const x1 = Math.min(w - 1, Math.floor(row[c + 1] - left - 0.5));
        for (let xx = x0; xx <= x1; xx++) inside[yy * w + xx] = 1;
      }
    }
    const rgba = quick ? scratchOf("rgba", Uint8ClampedArray, w * h * 4).fill(0) : new Uint8ClampedArray(w * h * 4);
    const alpha = scratchOf("alpha", Float32Array, w * h).fill(0);
    const depth = scratchOf("depth", Float32Array, w * h).fill(-INF);
    const c = [0, 0, 0];
    const c2 = [0, 0, 0];
    const c3 = [0, 0, 0];
    const c4 = [0, 0, 0];
    const spikeMask = model.spike ? model.spike.mask : null;
    const nearSpike = (k) => {
      if (!model.spike) return false;
      const d = Math.abs(shape.src[k] - model.spike.anchorIndex);
      return Math.min(d, N - d) <= 16;
    };
    const N = model.count;
    const oldAngleAt = (s) => {
      const i0 = Math.floor(s) % N;
      const i1 = (i0 + 1) % N;
      const t = s - Math.floor(s);
      return model.angle[i0] + wrapPi(model.angle[i1] - model.angle[i0]) * t;
    };
    const oldPointAt = (s) => {
      const i0 = Math.floor(s) % N;
      const i1 = (i0 + 1) % N;
      const t = s - Math.floor(s);
      return [model.points[i0 * 2] + (model.points[i1 * 2] - model.points[i0 * 2]) * t, model.points[i0 * 2 + 1] + (model.points[i1 * 2 + 1] - model.points[i0 * 2 + 1]) * t];
    };
    const Bo = model.outside;
    const S = model.ink;
    // A spike of a tail: its ink, cut out, from the new outline's same place to its tip
    const spike = model.spike;
    const spriteA = spike ? scratchOf("spriteA", Float32Array, w * h).fill(0) : null;
    if (spike) {
      const { anchor, anchorNew, tip, tipNew, turnBy } = spikePlace(model, shape);
      const L = Math.hypot(tip[0] - anchor[0], tip[1] - anchor[1]) || 1;
      const Ln = Math.hypot(tipNew[0] - anchorNew[0], tipNew[1] - anchorNew[1]) || 1;
      const u = [(tip[0] - anchor[0]) / L, (tip[1] - anchor[1]) / L];
      // Its root turns as the outline turns there, so it leaves the outline as it did; it bends
      // little by little towards where its tip goes, and stretches to reach it
      const final = wrapPi(Math.atan2(tipNew[1] - anchorNew[1], tipNew[0] - anchorNew[0]) - Math.atan2(u[1], u[0]));
      const bend = wrapPi(final - turnBy);
      const stretch = Ln / L;
      const ease = (t) => smoothstep(t / 0.7);
      const turnAt = (t) => turnBy + bend * ease(t);
      const stretchAt = (t) => 1 + (stretch - 1) * ease(t);
      const there = (x, y) => {
        const dx = x - anchor[0];
        const dy = y - anchor[1];
        const along = dx * u[0] + dy * u[1];
        const across = -dx * u[1] + dy * u[0];
        const t = clamp(along / L, 0, 1);
        const a = along * stretchAt(t);
        const vx = a * u[0] - across * u[1];
        const vy = a * u[1] + across * u[0];
        const phi = turnAt(t);
        return [anchorNew[0] + vx * Math.cos(phi) - vy * Math.sin(phi), anchorNew[1] + vx * Math.sin(phi) + vy * Math.cos(phi)];
      };
      const back = (x, y) => {
        const dx = x - anchorNew[0];
        const dy = y - anchorNew[1];
        let t = clamp(Math.hypot(dx, dy) / Ln, 0, 1);
        let along = 0;
        let across = 0;
        for (let step = 0; step < 4; step++) {
          const phi = turnAt(t);
          const wx = dx * Math.cos(phi) + dy * Math.sin(phi);
          const wy = -dx * Math.sin(phi) + dy * Math.cos(phi);
          along = (wx * u[0] + wy * u[1]) / stretchAt(t);
          across = -wx * u[1] + wy * u[0];
          t = clamp(along / L, 0, 1);
        }
        return [anchor[0] + along * u[0] - across * u[1], anchor[1] + along * u[1] + across * u[0]];
      };
      // Where the spike lands: its box, carried
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < source.width * source.height; i++) {
        if (!spike.mask[i]) continue;
        const p = there((i % source.width) + source.left + 0.5, Math.floor(i / source.width) + source.top + 0.5);
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]);
        y1 = Math.max(y1, p[1]);
      }
      const paper = model.fillLuma;
      const inkLuma = luma(model.ink);
      const span = Math.max(30, Math.abs(paper - inkLuma));
      const m = [0];
      for (let yy = Math.max(0, Math.floor(y0 - 2 - top)); yy <= Math.min(h - 1, Math.ceil(y1 + 2 - top)); yy++) {
        for (let xx = Math.max(0, Math.floor(x0 - 2 - left)); xx <= Math.min(w - 1, Math.ceil(x1 + 2 - left)); xx++) {
          const [sx, sy] = back(xx + left + 0.5, yy + top + 0.5);
          const mx = Math.floor(sx - source.left);
          const my = Math.floor(sy - source.top);
          if (mx < 0 || my < 0 || mx >= source.width || my >= source.height) continue;
          m[0] = spike.mask[my * source.width + mx];
          if (m[0] <= 0) continue;
          bilinear(source, sx, sy, c);
          const as = clamp(Math.abs(paper - luma(c)) / span, 0, 1) * m[0];
          if (as <= 0.004) continue;
          spriteA[yy * w + xx] = as;
        }
      }
    }
    // The pixels well inside the line, counted in `interiorCount`
    const interior = scratchOf("interior", Int32Array, w * h);
    let interiorCount = 0;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const i = yy * w + xx;
        const k = owner[i];
        if (k < 0) {
          if (inside[i]) interior[interiorCount++] = i;
          continue;
        }
        const px = xx + left + 0.5;
        const py = yy + top + 0.5;
        // The nearest point on the segments beside the nearest point
        let bestD = INF;
        let bestK = k;
        let bestT = 0;
        for (let side = -1; side <= 0; side++) {
          const a = (k + side + n) % n;
          const b = (a + 1) % n;
          const ex = shape.x[b] - shape.x[a];
          const ey = shape.y[b] - shape.y[a];
          const len2 = ex * ex + ey * ey || 1e-9;
          const t = clamp(((px - shape.x[a]) * ex + (py - shape.y[a]) * ey) / len2, 0, 1);
          const qx = shape.x[a] + ex * t;
          const qy = shape.y[a] + ey * t;
          const d = (px - qx) ** 2 + (py - qy) ** 2;
          if (d < bestD) {
            bestD = d;
            bestK = a;
            bestT = t;
          }
        }
        const dist = Math.sqrt(bestD);
        let s = inside[i] ? -dist : dist;
        depth[i] = s;
        if (s < -inner) {
          interior[interiorCount++] = i;
          continue;
        }
        if (s > band * 4.6) continue;
        const a = bestK;
        const b = (a + 1) % n;
        const qx = shape.x[a] + (shape.x[b] - shape.x[a]) * bestT;
        const qy = shape.y[a] + (shape.y[b] - shape.y[a]) * bestT;
        const na = shape.angle[a] + wrapPi(shape.angle[b] - shape.angle[a]) * bestT + (shape.inverted ? Math.PI : 0);
        let sa = shape.src[a];
        let sb = shape.src[b];
        let ds = sb - sa;
        if (ds > N / 2) ds -= N;
        if (ds < -N / 2) ds += N;
        const sIdx = Math.abs(ds) <= 4 ? (((sa + ds * bestT) % N) + N) % N : bestT < 0.5 ? sa : sb;
        let sx;
        let sy;
        // The old outline's point and direction this pixel is read from
        let refO = null;
        let refA = 0;
        // Past a sharp corner, the line goes on straight from each side and they meet in a
        // point, as drawn: each side's cross-section is laid on, the one that reaches further
        let mitred = false;
        let blendOther = 0;
        // Not where a spike of a tail leaves the outline: the spike draws its own lines there
        if (s > 0 && turn[a] > 0.45 && !nearSpike(a)) {
          const e1 = (a - MITRE + n) % n;
          const e2 = (a + 1 + MITRE) % n;
          const h1 = (px - shape.x[e1]) * Math.sin(shape.angle[e1] + flip) - (py - shape.y[e1]) * Math.cos(shape.angle[e1] + flip);
          const h2 = (px - shape.x[e2]) * Math.sin(shape.angle[e2] + flip) - (py - shape.y[e2]) * Math.cos(shape.angle[e2] + flip);
          const h = Math.max(h1, h2);
          // Between the rounded tip and the point where the sides meet is still inside
          if (h < s - 0.3) {
            const e = h1 >= h2 ? e1 : e2;
            const oa = oldAngleAt(shape.src[e]);
            const o = oldPointAt(shape.src[e]);
            sx = o[0] + Math.sin(oa) * h;
            sy = o[1] - Math.cos(oa) * h;
            s = h;
            mitred = true;
            refO = o;
            refA = oa;
            // Along the corner's middle the two sides' lines meet: they blend, with no step
            const other = Math.abs(h1 - h2);
            if (other < 2) {
              const f = h1 >= h2 ? e2 : e1;
              const ob = oldAngleAt(shape.src[f]);
              const p2 = oldPointAt(shape.src[f]);
              const hh = Math.min(h1, h2);
              bilinear(source, p2[0] + Math.sin(ob) * hh, p2[1] - Math.cos(ob) * hh, c2);
              blendOther = 0.5 - other / 4;
            }
          }
        }
        if (!mitred) {
          const oa = oldAngleAt(sIdx);
          const o = oldPointAt(sIdx);
          const phi = oa - na;
          const dx = px - qx;
          const dy = py - qy;
          const cos = Math.cos(phi);
          const sin = Math.sin(phi);
          sx = o[0] + dx * cos - dy * sin;
          sy = o[1] + dx * sin + dy * cos;
          refO = o;
          refA = oa;
        }
        if (s > band) continue;
        if (s < -inner) {
          interior[interiorCount++] = i;
          continue;
        }
        // Where a spike of a tail leaves the outline, the spike alone is drawn: twice, the two
        // would not quite meet. Where the spike is faint (its soft edge) or absent, the
        // outline's own copy stays under it, so the join never thins.
        if (spikeMask) {
          const mx = Math.floor(sx - source.left);
          const my = Math.floor(sy - source.top);
          if (mx >= 0 && my >= 0 && mx < source.width && my < source.height && spikeMask[my * source.width + mx] >= 1 && s > 0 && spriteA[i] > 0.7) continue;
        }
        bilinear(source, sx, sy, c);
        if (blendOther > 0) for (let ch = 0; ch < 3; ch++) c[ch] += (c2[ch] - c[ch]) * blendOther;
        let a8 = 1;
        if (s > line - 0.5) {
          // The line's outer edge is ink only, against the page it was drawn on right there: no
          // trace of that page comes along, and the edge comes out clean on anything
          let bg = Bo;
          if (!model.plainOutside) {
            // A few pixels of it, averaged: on a screentone one pixel is a dot or the paper
            const nx = Math.sin(refA);
            const ny = -Math.cos(refA);
            c3[0] = c3[1] = c3[2] = 0;
            let count = 0;
            for (let d = line + 2; d <= line + 5.1; d += 1.5) {
              for (let t = -1.5; t <= 1.5; t += 1.5) {
                bilinear(source, refO[0] + nx * d - ny * t, refO[1] + ny * d + nx * t, c4);
                c3[0] += c4[0];
                c3[1] += c4[1];
                c3[2] += c4[2];
                count++;
              }
            }
            c3[0] /= count;
            c3[1] /= count;
            c3[2] /= count;
            bg = c3;
          }
          const span = (S[0] - bg[0]) ** 2 + (S[1] - bg[1]) ** 2 + (S[2] - bg[2]) ** 2;
          if (!halo && stroke > 0.8 && span > 900) {
            const ink = ((c[0] - bg[0]) * (S[0] - bg[0]) + (c[1] - bg[1]) * (S[1] - bg[1]) + (c[2] - bg[2]) * (S[2] - bg[2])) / span;
            a8 = clamp(ink, 0, 1) * clamp(band - s, 0, 1);
            // Around a point, the line reaches no further than its own width
            if (mitred) a8 = Math.min(a8, clamp(line + 0.5 - s, 0, 1));
            if (a8 > 0.004) for (let ch = 0; ch < 3; ch++) c[ch] = clamp((c[ch] - (1 - a8) * bg[ch]) / a8, 0, 255);
          } else a8 = clamp(edge + 0.5 - s, 0, 1);
        }
        if (a8 <= 0) continue;
        rgba[i * 4] = c[0];
        rgba[i * 4 + 1] = c[1];
        rgba[i * 4 + 2] = c[2];
        alpha[i] = a8;
      }
    }
    // The inside: the bubble's colour, or its shades carried in from its edge. While a handle
    // is dragged, the colour alone: the shades come once it is let go.
    if (model.flat || quick) {
      for (let at = 0; at < interiorCount; at++) {
        const i = interior[at];
        rgba[i * 4] = model.fill[0];
        rgba[i * 4 + 1] = model.fill[1];
        rgba[i * 4 + 2] = model.fill[2];
        alpha[i] = 1;
      }
    } else if (interiorCount) {
      const rgb = scratchOf("rgb", Float32Array, w * h * 3).fill(0);
      const known = scratchOf("known", Uint8Array, w * h).fill(0);
      const unknown = scratchOf("unknown", Uint8Array, w * h).fill(0);
      for (let at = 0; at < interiorCount; at++) unknown[interior[at]] = 1;
      for (let i = 0; i < w * h; i++) {
        if (alpha[i] < 1 || !inside[i] || unknown[i] || depth[i] > -1.5) continue;
        known[i] = 1;
        rgb[i * 3] = rgba[i * 4];
        rgb[i * 3 + 1] = rgba[i * 4 + 1];
        rgb[i * 3 + 2] = rgba[i * 4 + 2];
      }
      const filled = pushPull(rgb, known, w, h);
      for (let at = 0; at < interiorCount; at++) {
        const i = interior[at];
        rgba[i * 4] = filled[i * 3];
        rgba[i * 4 + 1] = filled[i * 3 + 1];
        rgba[i * 4 + 2] = filled[i * 3 + 2];
        alpha[i] = 1;
      }
    }
    // The spike laid over everything else
    if (spriteA) {
      for (let i = 0; i < w * h; i++) {
        const as = spriteA[i];
        if (as <= 0.004) continue;
        const ab = alpha[i];
        const a = as + ab * (1 - as);
        for (let ch = 0; ch < 3; ch++) rgba[i * 4 + ch] = (model.ink[ch] * as + rgba[i * 4 + ch] * ab * (1 - as)) / a;
        alpha[i] = a;
      }
    }
    // Where the old bubble was: the plain page painted again, or a gap left to fill
    const gap = quick ? scratchOf("gap", Uint8Array, w * h).fill(0) : new Uint8Array(w * h);
    let gapCount = 0;
    const under = model.under;
    const paintGap = (model.plainOutside || Boolean(under)) && options.paintGap !== false;
    const covered = quick ? scratchOf("covered", Uint8Array, w * h).fill(0) : new Uint8Array(w * h);
    for (let yy = 0; yy < h; yy++) {
      const sy = yy + top - source.top;
      for (let xx = 0; xx < w; xx++) {
        const i = yy * w + xx;
        const a8 = alpha[i];
        if (a8 > 0) covered[i] = 1;
        const sx = xx + left - source.left;
        const old = sx >= 0 && sy >= 0 && sx < source.width && sy < source.height && model.footprint[sy * source.width + sx];
        // Once the whole old bubble is being drawn over (Generative Fill), nothing is left to fill
        if (old && a8 < 0.999 && !options.cleared) {
          if (paintGap) {
            const j = (sy * source.width + sx) * 3;
            for (let ch = 0; ch < 3; ch++) rgba[i * 4 + ch] = rgba[i * 4 + ch] * a8 + (under ? under[j + ch] : Bo[ch]) * (1 - a8);
            alpha[i] = 1;
          } else if (a8 < 0.5) {
            gap[i] = 1;
            gapCount++;
          }
        }
        rgba[i * 4 + 3] = Math.round(alpha[i] * 255);
      }
    }
    return { left, top, width: w, height: h, rgba, gap, gapCount, covered, painted: paintGap, quick };
  };

  /* ------------------------------ helpers for the tool ------------------------------ */

  const tipOf = (model) => (model.tail ? model.tail.tip : model.spike ? model.spike.tip : null);
  const startParams = (model) => ({ box: Object.assign({}, model.box), tip: null, pulls: [], kind: model.kind, angle: 0 });

  // The box that wraps a text: the text's own proportions, as small as the shape allows with
  // `pad` pixels between the text and the line
  const fitBox = (model, params, rect, pad) => {
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    const rw = rect.right - rect.left;
    const rh = rect.bottom - rect.top;
    const margin = pad + model.stroke;
    const probes = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const l = rect.left - margin;
      const r = rect.right + margin;
      const tp = rect.top - margin;
      const b = rect.bottom + margin;
      probes.push([l + (r - l) * t, tp], [l + (r - l) * t, b], [l, tp + (b - tp) * t], [r, tp + (b - tp) * t]);
    }
    const boxFor = (k) => ({ left: cx - (rw * k) / 2 - margin, right: cx + (rw * k) / 2 + margin, top: cy - (rh * k) / 2 - margin, bottom: cy + (rh * k) / 2 + margin });
    const fits = (k) => {
      const shape = shapeOf(model, Object.assign({}, params, { box: boxFor(k), pulls: [] }));
      return probes.every(([px, py]) => insidePolygon(shape, px, py));
    };
    let lo = 1;
    let hi = 2.6;
    if (fits(lo)) return boxFor(lo);
    if (!fits(hi)) return boxFor(hi);
    for (let step = 0; step < 14; step++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return boxFor(hi);
  };

  const api = { analyze, shapeOf, render, startParams, fitBox, insidePolygon, onBox, tipOf, grow };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TypeRReshape = api;
})(typeof window !== "undefined" ? window : globalThis);
