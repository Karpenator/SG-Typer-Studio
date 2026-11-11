// TypeR: Content-Aware Fill. The selection is painted over with what surrounds it, from the
// same family of methods as Photoshop's (Wexler's coarse-to-fine synthesis, matched with
// PatchMatch), with a few things of its own: a patch is compared on its structure as much as
// on its tones, so lines and screentone carry on straight; the source can be read in a mirror;
// what every patch votes for is weighed by how well it matched; and the result's tones are
// bent at the end to meet the edge of the hole, as Photoshop's Colour Adaptation, except that
// the bending stops at lines, so that a mismatched stroke can't bleed into the fill.
//
// Runs in a worker (new Worker("inpaint.js")), so the page stays alive, and loads as a plain
// script too, for a browser that refuses workers: window.TypeRInpaint.inpaint does the same.

"use strict";

(function (root) {
  const HALF = 3;
  const PATCH = HALF * 2 + 1;
  // The coarsest level still shows the hole this long: a stroke crossing it has to be seen there
  // to be carried on, and a stroke is only seen while it is thicker than a pixel
  const COARSEST = 40;
  // How much a difference of gradient counts, against a difference of tone
  const STRUCTURE = 0.6;
  // Colour adaptation never bends by more than this, nor where the page has a line
  const ADAPT_MAX = 32;
  const ADAPT_EDGE = 20;

  let seed = 0x9e3779b9;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };

  /* ------------------------------ the pyramid ------------------------------ */

  // A level: tones in rgb, 3 floats a pixel; hole: 1 where there is something to fill; known:
  // 1 where a patch may be read from (neither hole, transparent nor kept out of the sampling)
  const makeLevel = (w, h) => ({ w, h, rgb: new Float32Array(w * h * 3), hole: new Uint8Array(w * h), known: new Uint8Array(w * h) });

  const finestLevel = (data, w, h, mask, source) => {
    const L = makeLevel(w, h);
    const { rgb, hole, known } = L;
    for (let i = 0, n = w * h; i < n; i++) {
      rgb[i * 3] = data[i * 4];
      rgb[i * 3 + 1] = data[i * 4 + 1];
      rgb[i * 3 + 2] = data[i * 4 + 2];
      if (mask[i]) hole[i] = 1;
      else if (source[i] && data[i * 4 + 3] >= 128) known[i] = 1;
    }
    return L;
  };

  // Half the size, through a [1 3 3 1] filter: a screentone that the coarse level can't show
  // has to come out as its plain grey, not as a moiré the finer levels would then follow. A
  // coarse pixel is a hole if any of its four is, and its tone is the mean of the rest.
  const TAPS = [1, 3, 3, 1];
  const coarser = (F) => {
    const w = Math.ceil(F.w / 2);
    const h = Math.ceil(F.h / 2);
    const C = makeLevel(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        let anyHole = 0;
        let anyKnown = 0;
        for (let dy = -1; dy <= 2; dy++) {
          const fy = y * 2 + dy;
          if (fy < 0 || fy >= F.h) continue;
          for (let dx = -1; dx <= 2; dx++) {
            const fx = x * 2 + dx;
            if (fx < 0 || fx >= F.w) continue;
            const i = fy * F.w + fx;
            const central = dy >= 0 && dy <= 1 && dx >= 0 && dx <= 1;
            if (F.hole[i]) {
              if (central) anyHole = 1;
              continue;
            }
            if (central && F.known[i]) anyKnown = 1;
            const t = TAPS[dy + 1] * TAPS[dx + 1];
            r += F.rgb[i * 3] * t;
            g += F.rgb[i * 3 + 1] * t;
            b += F.rgb[i * 3 + 2] * t;
            n += t;
          }
        }
        const i = y * w + x;
        if (n) {
          C.rgb[i * 3] = r / n;
          C.rgb[i * 3 + 1] = g / n;
          C.rgb[i * 3 + 2] = b / n;
        }
        C.hole[i] = anyHole;
        C.known[i] = anyHole ? 0 : anyKnown;
      }
    }
    return C;
  };

  const holeBox = (L) => {
    let left = L.w;
    let top = L.h;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        if (!L.hole[y * L.w + x]) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    return right < 0 ? null : { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
  };

  // 1 within `r` pixels (Chebyshev) of a set pixel
  const dilate = (src, w, h, r) => {
    const mid = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (!src[row + x]) continue;
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(w - 1, x + r);
        for (let k = x0; k <= x1; k++) mid[row + k] = 1;
      }
    }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mid[y * w + x]) continue;
        const y0 = Math.max(0, y - r);
        const y1 = Math.min(h - 1, y + r);
        for (let k = y0; k <= y1; k++) out[k * w + x] = 1;
      }
    }
    return out;
  };

  // What the level needs before matching: the centres of the patches to match (every pixel
  // of the hole and those within a patch of it: the fill has to agree with its edge), and the
  // centres a patch may be read from (a whole patch of known pixels, `half` each way)
  const prepare = (L, half) => {
    const { w, h, hole, known } = L;
    const near = dilate(hole, w, h, half);
    const band = [];
    for (let y = half; y < h - half; y++) {
      for (let x = half; x < w - half; x++) if (near[y * w + x]) band.push(y * w + x);
    }
    L.band = Int32Array.from(band);
    // Count of unknown pixels in any box, from a summed-area table
    const W = w + 1;
    const sum = new Int32Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += known[y * w + x] ? 0 : 1;
        sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
      }
    }
    const ok = new Uint8Array(w * h);
    const okList = [];
    const side = half * 2 + 1;
    for (let y = half; y < h - half; y++) {
      for (let x = half; x < w - half; x++) {
        const x0 = x - half;
        const y0 = y - half;
        const unknown = sum[(y0 + side) * W + x0 + side] - sum[y0 * W + x0 + side] - sum[(y0 + side) * W + x0] + sum[y0 * W + x0];
        if (unknown === 0) {
          ok[y * w + x] = 1;
          okList.push(y * w + x);
        }
      }
    }
    L.ok = ok;
    L.okList = Int32Array.from(okList);
    L.half = half;
    L.nnX = new Int32Array(w * h).fill(-1);
    L.nnY = new Int32Array(w * h);
    L.nnM = new Uint8Array(w * h);
    L.nnD = new Float32Array(w * h).fill(Infinity);
    L.gx = new Float32Array(w * h);
    L.gy = new Float32Array(w * h);
    L.luma = new Float32Array(w * h);
    // How far each pixel is to be trusted: the page's own, wholly; the fill, as much as what
    // it was made from. Trust spreads inwards from the edge of the hole, round after round.
    L.conf = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) L.conf[i] = known[i] ? 1 : 0.05;
  };

  const gradients = (L, box) => {
    const { w, h, rgb, gx, gy, luma } = L;
    const bx0 = box ? Math.max(0, box.left) : 0;
    const by0 = box ? Math.max(0, box.top) : 0;
    const bx1 = box ? Math.min(w - 1, box.right) : w - 1;
    const by1 = box ? Math.min(h - 1, box.bottom) : h - 1;
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const i = y * w + x;
        luma[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
      }
    }
    for (let y = Math.max(0, by0 - 1); y <= Math.min(h - 1, by1 + 1); y++) {
      const up = Math.max(0, y - 1) * w;
      const down = Math.min(h - 1, y + 1) * w;
      const row = y * w;
      for (let x = Math.max(0, bx0 - 1); x <= Math.min(w - 1, bx1 + 1); x++) {
        gx[row + x] = (luma[row + Math.min(w - 1, x + 1)] - luma[row + Math.max(0, x - 1)]) * 0.5;
        gy[row + x] = (luma[down + x] - luma[up + x]) * 0.5;
      }
    }
  };

  // The coarsest level starts from a smooth guess: the hole's edge, diffused inwards
  const diffuse = (L) => {
    const { w, h, rgb, hole } = L;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const near = dilate(hole, w, h, 1);
    for (let i = 0, count = w * h; i < count; i++) {
      if (!near[i] || hole[i]) continue;
      r += rgb[i * 3];
      g += rgb[i * 3 + 1];
      b += rgb[i * 3 + 2];
      n++;
    }
    if (!n) return;
    const list = [];
    for (let i = 0, count = w * h; i < count; i++) {
      if (!hole[i]) continue;
      list.push(i);
      rgb[i * 3] = r / n;
      rgb[i * 3 + 1] = g / n;
      rgb[i * 3 + 2] = b / n;
    }
    const next = new Float32Array(rgb.length);
    for (let round = 0; round < 120; round++) {
      let moved = 0;
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        const x = i % w;
        const y = (i - x) / w;
        const l = x > 0 ? i - 1 : i;
        const rr = x < w - 1 ? i + 1 : i;
        const u = y > 0 ? i - w : i;
        const d = y < h - 1 ? i + w : i;
        for (let c = 0; c < 3; c++) {
          const value = (rgb[l * 3 + c] + rgb[rr * 3 + c] + rgb[u * 3 + c] + rgb[d * 3 + c]) * 0.25;
          moved = Math.max(moved, Math.abs(value - rgb[i * 3 + c]));
          next[i * 3 + c] = value;
        }
      }
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        rgb[i * 3] = next[i * 3];
        rgb[i * 3 + 1] = next[i * 3 + 1];
        rgb[i * 3 + 2] = next[i * 3 + 2];
      }
      if (moved < 0.1) break;
    }
  };

  // Then the hole is filled from its edge inwards, a patch at a time, where a line enters it
  // first (Criminisi 2004): a lone stroke crossing the hole carries on across, instead of
  // fading into whatever surrounds it. At every level, not only the coarsest: a patch is
  // chosen next to where its neighbours were read, so a screentone keeps its exact step,
  // which the coarser level, too coarse to see the dots, couldn't tell. The matching rounds
  // then make the whole agree.
  const SEED_CANDIDATES = 30000;
  const SEED_RANDOM = 256;
  const structureFirst = (L) => {
    const { w, h, rgb, hole, half, ok, okList, conf } = L;
    if (!okList.length) return;
    const side = half * 2 + 1;
    const filled = new Uint8Array(w * h);
    const confidence = new Float32Array(w * h);
    const from = new Int32Array(w * h).fill(-1);
    let left = 0;
    for (let i = 0, n = w * h; i < n; i++) {
      if (hole[i]) left++;
      else {
        filled[i] = 1;
        confidence[i] = 1;
      }
    }
    gradients(L);
    const { gx, gy } = L;
    const box = holeBox(L);
    const x0 = Math.max(half, box.left - 1);
    const x1 = Math.min(w - half - 1, box.right + 1);
    const y0 = Math.max(half, box.top - 1);
    const y1 = Math.min(h - half - 1, box.bottom + 1);
    // Only the filled pixels count. What the coarser level guessed for the rest is blurred,
    // and pixel for pixel it would favour the flattest patch over the right one.
    const patchDistance = (tx, ty, qx, qy, cutoff) => {
      let d = 0;
      for (let dy = -half; dy <= half; dy++) {
        let ti = (ty + dy) * w + tx - half;
        let qi = (qy + dy) * w + qx - half;
        for (let k = 0; k < side; k++, ti++, qi++) {
          if (!filled[ti]) continue;
          const t3 = ti * 3;
          const q3 = qi * 3;
          let e = rgb[t3] - rgb[q3];
          let p = e * e;
          e = rgb[t3 + 1] - rgb[q3 + 1];
          p += e * e;
          e = rgb[t3 + 2] - rgb[q3 + 2];
          p += e * e;
          // A gradient at the front is half guesswork: it only counts a pixel away from it
          if (filled[ti - 1] && filled[ti + 1] && filled[ti - w] && filled[ti + w]) {
            e = gx[ti] - gx[qi];
            p += STRUCTURE * e * e;
            e = gy[ti] - gy[qi];
            p += STRUCTURE * e * e;
          }
          d += p;
        }
        if (d >= cutoff) return d;
      }
      return d;
    };
    const exhaustive = okList.length <= SEED_CANDIDATES;
    let bestQ = -1;
    let bestD = Infinity;
    const consider = (qx, qy) => {
      if (qx < half || qy < half || qx >= w - half || qy >= h - half) return;
      const q = qy * w + qx;
      if (!ok[q]) return;
      const d = patchDistance(tx, ty, qx, qy, bestD);
      if (d < bestD) {
        bestD = d;
        bestQ = q;
      }
    };
    let tx = 0;
    let ty = 0;
    // The front: unfilled pixels touching filled ones, as patch centres inside the picture.
    // Its priority: how sure the patch is, times how strong the line entering it across the
    // front. Kept up to date around each patch laid, instead of read again all over.
    const priority = new Float32Array(w * h).fill(-1);
    const front = [];
    const assess = (x, y) => {
      const i = y * w + x;
      if (filled[i]) {
        priority[i] = -1;
        return;
      }
      const nx = (filled[i + 1] ? 1 : 0) - (filled[i - 1] ? 1 : 0);
      const ny = (filled[i + w] ? 1 : 0) - (filled[i - w] ? 1 : 0);
      if (!nx && !ny && !filled[i - w - 1] && !filled[i - w + 1] && !filled[i + w - 1] && !filled[i + w + 1]) {
        priority[i] = -1;
        return;
      }
      let sure = 0;
      let strongest = 0;
      let isoX = 0;
      let isoY = 0;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const j = (y + dy) * w + x + dx;
          sure += confidence[j];
          if (!filled[j]) continue;
          const mag = gx[j] * gx[j] + gy[j] * gy[j];
          if (mag > strongest) {
            strongest = mag;
            isoX = -gy[j];
            isoY = gx[j];
          }
        }
      }
      sure /= side * side;
      const norm = Math.hypot(nx, ny) || 1;
      const data = Math.abs(isoX * nx + isoY * ny) / norm / 255 + 0.001;
      if (priority[i] < 0) front.push(i);
      priority[i] = sure * data;
      L.sureAt[i] = sure;
    };
    L.sureAt = new Float32Array(w * h);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) assess(x, y);
    }
    while (left > 0) {
      let best = -1;
      let bestPriority = -1;
      let kept = 0;
      for (let k = 0; k < front.length; k++) {
        const i = front[k];
        if (priority[i] < 0) continue;
        front[kept++] = i;
        if (priority[i] > bestPriority) {
          bestPriority = priority[i];
          best = i;
        }
      }
      front.length = kept;
      const bestSure = best >= 0 ? L.sureAt[best] : 0;
      if (best < 0) break;
      tx = best % w;
      ty = (best - tx) / w;
      bestQ = -1;
      bestD = Infinity;
      // Next to where the neighbours were read first: all else equal, the texture goes on
      // from where it came
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const j = (ty + dy) * w + tx + dx;
          if (from[j] < 0) continue;
          const sx = from[j] % w;
          consider(sx - dx, (from[j] - sx) / w - dy);
        }
      }
      if (exhaustive) {
        for (let k = 0; k < okList.length; k++) {
          const q = okList[k];
          const qx = q % w;
          consider(qx, (q - qx) / w);
        }
      } else {
        // Where the coarser level read, then at random
        if (L.nnX[best] >= 0) {
          consider(L.nnX[best], L.nnY[best]);
          for (let r = 4; r >= 1; r = r >> 1) {
            for (let k = 0; k < 4; k++) consider(L.nnX[best] + Math.round((random() * 2 - 1) * r), L.nnY[best] + Math.round((random() * 2 - 1) * r));
          }
        }
        for (let k = 0; k < SEED_RANDOM; k++) {
          const q = okList[Math.floor(random() * okList.length)];
          const qx = q % w;
          consider(qx, (q - qx) / w);
        }
      }
      if (bestQ < 0) break;
      const qx = bestQ % w;
      const qy = (bestQ - qx) / w;
      const sure = bestSure;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const i = (ty + dy) * w + tx + dx;
          if (filled[i]) continue;
          const s = (qy + dy) * w + qx + dx;
          rgb[i * 3] = rgb[s * 3];
          rgb[i * 3 + 1] = rgb[s * 3 + 1];
          rgb[i * 3 + 2] = rgb[s * 3 + 2];
          filled[i] = 1;
          confidence[i] = sure;
          from[i] = s;
          left--;
        }
      }
      // Hole pixels at the very border of the picture can't be patch centres: they come last
      if (left > 0) {
        let anyInside = false;
        for (let y = y0; y <= y1 && !anyInside; y++) {
          for (let x = x0; x <= x1; x++) if (!filled[y * w + x]) { anyInside = true; break; }
        }
        if (!anyInside) break;
      }
      gradients(L, { left: tx - half, top: ty - half, right: tx + half, bottom: ty + half });
      for (let y = Math.max(y0, ty - half * 2 - 1); y <= Math.min(y1, ty + half * 2 + 1); y++) {
        for (let x = Math.max(x0, tx - half * 2 - 1); x <= Math.min(x1, tx + half * 2 + 1); x++) assess(x, y);
      }
    }
    // The matching starts from where the seed read each pixel: a first vote from matches
    // made at random would undo the seed's lines
    for (let i = 0, n = w * h; i < n; i++) {
      if (hole[i]) conf[i] = Math.max(0.05, confidence[i]);
      const s = from[i];
      if (s < 0 || !ok[s]) continue;
      const sx = s % w;
      L.nnX[i] = sx;
      L.nnY[i] = (s - sx) / w;
      L.nnM[i] = 0;
    }
  };

  const seedHole = (L) => {
    diffuse(L);
    structureFirst(L);
  };

  /* ------------------------------- matching ------------------------------- */

  // How unlike the patch around the target is to the one around the source, read mirrored
  // when m is set. Stops counting past `cutoff`: a worse candidate needn't be measured whole.
  const distance = (L, tx, ty, qx, qy, m, cutoff) => {
    const { w, rgb, gx, gy, half, conf } = L;
    const side = half * 2 + 1;
    const sign = m ? -1 : 1;
    let d = 0;
    for (let dy = -half; dy <= half; dy++) {
      let ti = (ty + dy) * w + tx - half;
      let qi = (qy + dy) * w + qx - sign * half;
      for (let k = 0; k < side; k++) {
        const t3 = ti * 3;
        const q3 = qi * 3;
        let e = rgb[t3] - rgb[q3];
        let p = e * e;
        e = rgb[t3 + 1] - rgb[q3 + 1];
        p += e * e;
        e = rgb[t3 + 2] - rgb[q3 + 2];
        p += e * e;
        e = gx[ti] - sign * gx[qi];
        p += STRUCTURE * e * e;
        e = gy[ti] - gy[qi];
        p += STRUCTURE * e * e;
        d += p * conf[ti];
        ti++;
        qi += sign;
      }
      if (d >= cutoff) return d;
    }
    return d;
  };

  // A candidate found at random has to be clearly better to replace the current match; one
  // handed over by a neighbour only has to be as good. Where everything matches alike (a
  // texture too fine for the level, a flat tone), the matches then stay coherent, patch after
  // patch, instead of scattering: the finer levels inherit a field they can refine.
  const RANDOM_MARGIN = 0.97;
  const tryCandidate = (L, t, tx, ty, qx, qy, m, loose) => {
    if (qx < L.half || qy < L.half || qx >= L.w - L.half || qy >= L.h - L.half) return;
    const q = qy * L.w + qx;
    if (!L.ok[q]) return;
    if (L.nnX[t] === qx && L.nnY[t] === qy && L.nnM[t] === m) return;
    const limit = loose ? L.nnD[t] : L.nnD[t] * RANDOM_MARGIN;
    const d = distance(L, tx, ty, qx, qy, m, limit);
    if (d < limit || (loose && d === limit && d < Infinity)) {
      L.nnX[t] = qx;
      L.nnY[t] = qy;
      L.nnM[t] = m;
      L.nnD[t] = d;
    }
  };

  const randomCandidate = (L, t, tx, ty, mirror) => {
    const q = L.okList[Math.floor(random() * L.okList.length)];
    const qx = q % L.w;
    tryCandidate(L, t, tx, ty, qx, (q - qx) / L.w, mirror && random() < 0.5 ? 1 : 0);
  };

  // Every centre of the band gets a match, at random when it has none
  const ensureMatches = (L, mirror) => {
    const { band, w } = L;
    for (let k = 0; k < band.length; k++) {
      const t = band[k];
      const tx = t % w;
      const ty = (t - tx) / w;
      if (L.nnX[t] >= 0) {
        L.nnD[t] = distance(L, tx, ty, L.nnX[t], L.nnY[t], L.nnM[t], Infinity);
        continue;
      }
      L.nnD[t] = Infinity;
      for (let tries = 0; tries < 3 && L.nnX[t] < 0; tries++) randomCandidate(L, t, tx, ty, mirror);
    }
  };

  // One pass of PatchMatch: each centre tries its neighbours' matches shifted by one, then a
  // few at random around its own, closer and closer
  const patchMatch = (L, iteration, radius, mirror) => {
    const { band, w } = L;
    const forward = iteration % 2 === 0;
    for (let n = 0; n < band.length; n++) {
      const t = band[forward ? n : band.length - 1 - n];
      const tx = t % w;
      const ty = (t - tx) / w;
      const step = forward ? 1 : -1;
      // From the neighbour before, along the row
      const a = t - step;
      if (L.nnX[a] >= 0) tryCandidate(L, t, tx, ty, L.nnX[a] + (L.nnM[a] ? -step : step), L.nnY[a], L.nnM[a], true);
      // From the neighbour before, along the column
      const b = t - step * w;
      if (b >= 0 && b < L.nnX.length && L.nnX[b] >= 0) tryCandidate(L, t, tx, ty, L.nnX[b], L.nnY[b] + step, L.nnM[b], true);
      if (L.nnX[t] < 0) {
        randomCandidate(L, t, tx, ty, mirror);
        if (L.nnX[t] < 0) continue;
      }
      const bx = L.nnX[t];
      const by = L.nnY[t];
      const bm = L.nnM[t];
      for (let r = radius; r >= 1; r = Math.floor(r / 2)) {
        const qx = bx + Math.round((random() * 2 - 1) * r);
        const qy = by + Math.round((random() * 2 - 1) * r);
        tryCandidate(L, t, tx, ty, qx, qy, mirror && random() < 0.5 ? 1 - bm : bm);
      }
    }
  };

  // Every patch of the band lays its match over the pixels it covers; a pixel of the hole
  // becomes the mean of what it got, the better matches weighing more. Returns what the
  // known pixels got too: colour adaptation compares it to what they are.
  const vote = (L, sharpness) => {
    const { band, w, rgb, hole, nnX, nnY, nnM, nnD, half, conf } = L;
    const area = (half * 2 + 1) * (half * 2 + 1);
    // How far each patch is trusted: the mean trust of what it covers. A distance was weighed
    // the same way, so it is read against the patch's trust to compare patches fairly.
    const trust = new Float32Array(band.length);
    let mean = 0;
    let count = 0;
    for (let k = 0; k < band.length; k++) {
      const t = band[k];
      if (nnX[t] < 0) continue;
      const tx = t % w;
      const ty = (t - tx) / w;
      let sum = 0;
      for (let dy = -half; dy <= half; dy++) {
        const row = (ty + dy) * w + tx - half;
        for (let i = 0; i < half * 2 + 1; i++) sum += conf[row + i];
      }
      trust[k] = sum / area;
      mean += nnD[t] / trust[k];
      count++;
    }
    if (!count) return null;
    const sigma2 = Math.max(1, (mean / count) * sharpness);
    const acc = new Float32Array(w * L.h * 3);
    const weight = new Float32Array(w * L.h);
    const sure = new Float32Array(w * L.h);
    for (let k = 0; k < band.length; k++) {
      const t = band[k];
      if (nnX[t] < 0) continue;
      const wgt = Math.max(1e-6, Math.exp(-nnD[t] / trust[k] / sigma2)) * trust[k];
      const tx = t % w;
      const ty = (t - tx) / w;
      const sign = nnM[t] ? -1 : 1;
      for (let dy = -half; dy <= half; dy++) {
        let p = (ty + dy) * w + tx - half;
        let s = (nnY[t] + dy) * w + nnX[t] - sign * half;
        for (let i = -half; i <= half; i++) {
          acc[p * 3] += wgt * rgb[s * 3];
          acc[p * 3 + 1] += wgt * rgb[s * 3 + 1];
          acc[p * 3 + 2] += wgt * rgb[s * 3 + 2];
          weight[p] += wgt;
          sure[p] += wgt * trust[k];
          p++;
          s += sign;
        }
      }
    }
    for (let i = 0, n = w * L.h; i < n; i++) {
      if (!hole[i] || !weight[i]) continue;
      rgb[i * 3] = acc[i * 3] / weight[i];
      rgb[i * 3 + 1] = acc[i * 3 + 1] / weight[i];
      rgb[i * 3 + 2] = acc[i * 3 + 2] / weight[i];
      conf[i] = Math.min(1, sure[i] / weight[i]);
    }
    return { acc, weight };
  };

  // The finer level takes the coarser's result for its hole, and starts its matches from
  // the coarser's, doubled
  const refine = (C, F) => {
    const { w, h, rgb, hole } = F;
    for (let y = 0; y < h; y++) {
      const sy = Math.max(0, Math.min(C.h - 1, (y + 0.5) / 2 - 0.5));
      const y0 = Math.floor(sy);
      const y1 = Math.min(C.h - 1, y0 + 1);
      const fy = sy - y0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!hole[i]) continue;
        const sx = Math.max(0, Math.min(C.w - 1, (x + 0.5) / 2 - 0.5));
        const x0 = Math.floor(sx);
        const x1 = Math.min(C.w - 1, x0 + 1);
        const fx = sx - x0;
        for (let c = 0; c < 3; c++) {
          const top = C.rgb[(y0 * C.w + x0) * 3 + c] * (1 - fx) + C.rgb[(y0 * C.w + x1) * 3 + c] * fx;
          const bottom = C.rgb[(y1 * C.w + x0) * 3 + c] * (1 - fx) + C.rgb[(y1 * C.w + x1) * 3 + c] * fx;
          rgb[i * 3 + c] = top * (1 - fy) + bottom * fy;
        }
        F.conf[i] = C.conf[(y >> 1) * C.w + (x >> 1)] * 0.5;
      }
    }
    const { band } = F;
    for (let k = 0; k < band.length; k++) {
      const t = band[k];
      const tx = t % w;
      const ty = (t - tx) / w;
      const parent = (ty >> 1) * C.w + (tx >> 1);
      if (C.nnX[parent] < 0) continue;
      const m = C.nnM[parent];
      const qx = C.nnX[parent] * 2 + (m ? 1 - (tx & 1) : tx & 1);
      const qy = C.nnY[parent] * 2 + (ty & 1);
      if (qx < F.half || qy < F.half || qx >= w - F.half || qy >= h - F.half || !F.ok[qy * w + qx]) continue;
      F.nnX[t] = qx;
      F.nnY[t] = qy;
      F.nnM[t] = m;
    }
  };

  /* --------------------------- colour adaptation --------------------------- */

  // What the fill got at the known pixels along the hole's edge, against what they are: the
  // difference, spread smoothly over the hole, bends the fill to meet its edge. Not across
  // a line: where the page has an edge, the difference is a misplaced stroke, not a tone.
  const adaptColours = (levels, votes) => {
    const F = levels[0];
    const { w, h, rgb, hole, gx, gy } = F;
    const ring = new Uint8Array(w * h);
    const value = new Float32Array(w * h * 3);
    let any = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (hole[i] || !votes.weight[i]) continue;
        const edge = (x > 0 && hole[i - 1]) || (x < w - 1 && hole[i + 1]) || (y > 0 && hole[i - w]) || (y < h - 1 && hole[i + w]);
        if (!edge) continue;
        ring[i] = 1;
        any = true;
        if (Math.abs(gx[i]) + Math.abs(gy[i]) > ADAPT_EDGE) continue;
        for (let c = 0; c < 3; c++) value[i * 3 + c] = Math.max(-ADAPT_MAX, Math.min(ADAPT_MAX, rgb[i * 3 + c] - votes.acc[i * 3 + c] / votes.weight[i]));
      }
    }
    if (!any) return;
    // The same problem at every level of the pyramid, solved coarse to fine
    const grids = [{ w, h, hole, ring, value, delta: new Float32Array(w * h * 3) }];
    for (let k = 1; k < levels.length; k++) {
      const fine = grids[k - 1];
      const L = levels[k];
      const coarse = { w: L.w, h: L.h, hole: L.hole, ring: new Uint8Array(L.w * L.h), value: new Float32Array(L.w * L.h * 3), delta: new Float32Array(L.w * L.h * 3) };
      for (let y = 0; y < L.h; y++) {
        for (let x = 0; x < L.w; x++) {
          const i = y * L.w + x;
          if (L.hole[i]) continue;
          let n = 0;
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const fx = x * 2 + dx;
              const fy = y * 2 + dy;
              if (fx >= fine.w || fy >= fine.h) continue;
              const j = fy * fine.w + fx;
              if (!fine.ring[j]) continue;
              n++;
              for (let c = 0; c < 3; c++) coarse.value[i * 3 + c] += fine.value[j * 3 + c];
            }
          }
          if (!n) continue;
          coarse.ring[i] = 1;
          for (let c = 0; c < 3; c++) coarse.value[i * 3 + c] /= n;
        }
      }
      grids.push(coarse);
    }
    const relax = (G, rounds) => {
      const list = [];
      for (let i = 0, n = G.w * G.h; i < n; i++) if (G.hole[i]) list.push(i);
      const at = (i) => (G.ring[i] ? G.value : G.hole[i] ? G.delta : null);
      for (let round = 0; round < rounds; round++) {
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          const x = i % G.w;
          const y = (i - x) / G.w;
          for (let c = 0; c < 3; c++) {
            let sum = 0;
            let n = 0;
            const take = (j) => {
              const from = at(j);
              if (!from) return;
              sum += from[j * 3 + c];
              n++;
            };
            if (x > 0) take(i - 1);
            if (x < G.w - 1) take(i + 1);
            if (y > 0) take(i - G.w);
            if (y < G.h - 1) take(i + G.w);
            if (n) G.delta[i * 3 + c] = sum / n;
          }
        }
      }
    };
    for (let k = grids.length - 1; k >= 0; k--) {
      const G = grids[k];
      if (k < grids.length - 1) {
        const C = grids[k + 1];
        for (let y = 0; y < G.h; y++) {
          for (let x = 0; x < G.w; x++) {
            const i = y * G.w + x;
            if (!G.hole[i]) continue;
            const j = (y >> 1) * C.w + (x >> 1);
            const from = C.ring[j] ? C.value : C.delta;
            G.delta[i * 3] = from[j * 3];
            G.delta[i * 3 + 1] = from[j * 3 + 1];
            G.delta[i * 3 + 2] = from[j * 3 + 2];
          }
        }
      }
      relax(G, k === grids.length - 1 ? 200 : 24);
    }
    const delta = grids[0].delta;
    for (let i = 0, n = w * h; i < n; i++) {
      if (!hole[i]) continue;
      rgb[i * 3] = Math.max(0, Math.min(255, rgb[i * 3] + delta[i * 3]));
      rgb[i * 3 + 1] = Math.max(0, Math.min(255, rgb[i * 3 + 1] + delta[i * 3 + 1]));
      rgb[i * 3 + 2] = Math.max(0, Math.min(255, rgb[i * 3 + 2] + delta[i * 3 + 2]));
    }
  };

  /* --------------------------------- whole --------------------------------- */

  // data: RGBA of a region of the page, mask: 1 where to fill, source: 1 where the fill may
  // read from. Returns RGBA of the region, the hole filled and opaque. progress gets 0 to 1.
  const inpaint = ({ data, width, height, mask, source }, options = {}, progress) => {
    const out = new Uint8ClampedArray(data.length);
    out.set(data);
    const mirror = Boolean(options.mirror);
    const levels = [finestLevel(data, width, height, mask, source)];
    while (levels.length < 8) {
      const last = levels[levels.length - 1];
      const box = holeBox(last);
      if (!box || Math.max(box.width, box.height) <= COARSEST || Math.min(box.width, box.height) <= 3 || Math.min(last.w, last.h) <= PATCH * 2) break;
      levels.push(coarser(last));
    }
    if (!holeBox(levels[0])) return out;
    // A patch of known pixels is a must: a level without any takes smaller ones
    levels.forEach((L) => {
      for (let half = HALF; half >= 1; half--) {
        prepare(L, half);
        if (L.okList.length) break;
      }
    });
    if (!levels.some((L) => L.okList.length)) {
      seedHole(levels[0]);
      return finish(levels[0], out);
    }
    const rounds = levels.map((L, k) => (k === levels.length - 1 ? 10 : k === 0 ? 3 : 4));
    const total = levels.reduce((sum, L, k) => sum + L.band.length * rounds[k], 0) || 1;
    let done = 0;
    let votes = null;
    for (let k = levels.length - 1; k >= 0; k--) {
      const L = levels[k];
      if (k === levels.length - 1) seedHole(L);
      else {
        refine(levels[k + 1], L);
        structureFirst(L);
      }
      if (!L.okList.length) {
        done += L.band.length * rounds[k];
        continue;
      }
      gradients(L);
      ensureMatches(L, mirror);
      const radius = k === levels.length - 1 ? Math.max(L.w, L.h) : 24;
      for (let round = 0; round < rounds[k]; round++) {
        // The first vote of a level waits for the matches to settle: the level's start
        // (the seed, or the coarser level's result) is worth more than a hasty vote
        const passes = round ? 2 : k === levels.length - 1 ? 6 : 4;
        for (let pass = 0; pass < passes; pass++) patchMatch(L, pass, radius, mirror);
        const last = round === rounds[k] - 1;
        votes = vote(L, last && k === 0 ? 0.25 : 0.5);
        gradients(L);
        done += L.band.length;
        if (progress) progress(Math.min(0.99, done / total));
      }
    }
    if (options.adapt !== false && votes && levels[0].okList.length) adaptColours(levels, votes);
    return finish(levels[0], out);
  };

  const finish = (L, out) => {
    for (let i = 0, n = L.w * L.h; i < n; i++) {
      if (!L.hole[i]) continue;
      out[i * 4] = L.rgb[i * 3];
      out[i * 4 + 1] = L.rgb[i * 3 + 1];
      out[i * 4 + 2] = L.rgb[i * 3 + 2];
      out[i * 4 + 3] = 255;
    }
    return out;
  };

  root.TypeRInpaint = { inpaint };

  // As a worker: one job at a time, with its progress
  if (typeof WorkerGlobalScope !== "undefined" && root instanceof WorkerGlobalScope) {
    root.onmessage = ({ data }) => {
      const { id, payload, options } = data;
      let lastTold = 0;
      try {
        const result = inpaint(payload, options, (fraction) => {
          const now = Date.now();
          if (now - lastTold < 80) return;
          lastTold = now;
          root.postMessage({ id, progress: fraction });
        });
        root.postMessage({ id, result }, [result.buffer]);
      } catch (error) {
        root.postMessage({ id, error: String((error && error.message) || error) });
      }
    };
    root.postMessage({ ready: true });
  }
})(typeof self !== "undefined" ? self : window);
