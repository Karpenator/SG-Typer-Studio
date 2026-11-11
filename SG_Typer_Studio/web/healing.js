// Healing Brush's gradient-domain blend, matching PhotoCraft's Poisson membrane solver.
// Source gradients survive; the destination around the stroke determines colour and lighting.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TypeRHealing = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const TOLERANCE = 0.00002;
  const FINE_ITERATIONS = 30;
  const FINE_OMEGA = 1.7;

  const sor = (width, height, unknown, values, maxIterations, omega) => {
    let count = 0;
    for (let i = 0; i < unknown.length; i++) if (unknown[i]) count++;
    // Typed arrays avoid allocating a little [index, neighbours] object for every pixel, on
    // every channel, on every pointermove. That garbage was a major source of UI stalls.
    const cells = new Int32Array(count);
    const neighboursOf = new Uint8Array(count);
    for (let i = 0, at = 0; i < unknown.length; i++) {
      if (!unknown[i]) continue;
      const x = i % width;
      const y = Math.floor(i / width);
      cells[at] = i;
      neighboursOf[at] = (x > 0 ? 1 : 0) | (x + 1 < width ? 2 : 0) | (y > 0 ? 4 : 0) | (y + 1 < height ? 8 : 0);
      at++;
    }
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let largest = 0;
      for (let at = 0; at < cells.length; at++) {
        const i = cells[at];
        const neighbours = neighboursOf[at];
        let sum = 0;
        let count = 0;
        if (neighbours & 1) { sum += values[i - 1]; count++; }
        if (neighbours & 2) { sum += values[i + 1]; count++; }
        if (neighbours & 4) { sum += values[i - width]; count++; }
        if (neighbours & 8) { sum += values[i + width]; count++; }
        if (!count) continue;
        const change = omega * (sum / count - values[i]);
        values[i] += change;
        largest = Math.max(largest, Math.abs(change));
      }
      if (largest < TOLERANCE) break;
    }
  };

  // Cascadic multigrid: a coarse harmonic guess, then a few successive over-relaxation sweeps.
  const solve = (width, height, unknown, values, depth = 0) => {
    let unknownCount = 0;
    let knownSum = 0;
    let knownCount = 0;
    for (let i = 0; i < unknown.length; i++) {
      if (unknown[i]) unknownCount++;
      else { knownSum += values[i]; knownCount++; }
    }
    if (!unknownCount || !knownCount) return;
    if (width >= 8 && height >= 8 && unknownCount > 64 && depth < 16) {
      const cw = Math.ceil(width / 2);
      const ch = Math.ceil(height / 2);
      const coarseUnknown = new Uint8Array(cw * ch);
      coarseUnknown.fill(1);
      const coarse = new Float32Array(cw * ch);
      for (let cy = 0; cy < ch; cy++) {
        for (let cx = 0; cx < cw; cx++) {
          let sum = 0;
          let count = 0;
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const x = cx * 2 + dx;
            const y = cy * 2 + dy;
            if (x >= width || y >= height || unknown[y * width + x]) continue;
            sum += values[y * width + x];
            count++;
          }
          if (count) {
            coarseUnknown[cy * cw + cx] = 0;
            coarse[cy * cw + cx] = sum / count;
          }
        }
      }
      solve(cw, ch, coarseUnknown, coarse, depth + 1);
      for (let y = 0; y < height; y++) {
        const fy = Math.max(0, Math.min(ch - 1, (y + 0.5) / 2 - 0.5));
        const y0 = Math.floor(fy);
        const y1 = Math.min(ch - 1, y0 + 1);
        const ty = fy - y0;
        for (let x = 0; x < width; x++) {
          const at = y * width + x;
          if (!unknown[at]) continue;
          const fx = Math.max(0, Math.min(cw - 1, (x + 0.5) / 2 - 0.5));
          const x0 = Math.floor(fx);
          const x1 = Math.min(cw - 1, x0 + 1);
          const tx = fx - x0;
          const a = coarse[y0 * cw + x0] + (coarse[y0 * cw + x1] - coarse[y0 * cw + x0]) * tx;
          const b = coarse[y1 * cw + x0] + (coarse[y1 * cw + x1] - coarse[y1 * cw + x0]) * tx;
          values[at] = a + (b - a) * ty;
        }
      }
      sor(width, height, unknown, values, FINE_ITERATIONS, FINE_OMEGA);
      return;
    }
    const mean = knownSum / knownCount;
    for (let i = 0; i < unknown.length; i++) if (unknown[i]) values[i] = mean;
    sor(width, height, unknown, values, 2000, 1.85);
  };

  const solveMembrane = (width, height, unknown, values) => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !unknown || !values || unknown.length !== width * height || values.length !== width * height) return false;
    solve(width, height, unknown, values);
    return true;
  };

  // RGBA bytes in, RGBA bytes out. Outside the mask the destination is returned byte for byte.
  const seamlessClone = (width, height, source, destination, mask, channels = 4, solveChannels = channels) => {
    const output = destination && destination.length ? new Uint8ClampedArray(destination) : new Uint8ClampedArray();
    const count = width * height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || channels < 1 || solveChannels < 0 || solveChannels > channels || !source || !destination || !mask || source.length !== count * channels || destination.length !== count * channels || mask.length !== count) return output;
    for (let channel = 0; channel < solveChannels; channel++) {
      const membrane = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        if (!mask[i]) membrane[i] = (destination[i * channels + channel] - source[i * channels + channel]) / 255;
      }
      solve(width, height, mask, membrane);
      for (let i = 0; i < count; i++) {
        if (mask[i]) output[i * channels + channel] = (source[i * channels + channel] / 255 + membrane[i]) * 255;
      }
    }
    return output;
  };

  return { solveMembrane, seamlessClone };
});
