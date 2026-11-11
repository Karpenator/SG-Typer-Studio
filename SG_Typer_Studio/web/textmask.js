// Detect Text and Remove Text: the page, without its texts, goes to a text detection model
// (Temizle, by Safi Çizgi), which answers with where the letters are. That becomes a selection;
// Remove Text then splits it into its areas, paints those on a plain background (one colour or a
// smooth shading) back itself and has Generative Fill redraw only those over the art (app.js does
// the asking and the showing).
//
// No key: each install gets its own anonymous token from the service (/v1/device), so each
// person has their own limit. On for everyone: `typer.web.textmask` in localStorage can hold
// { on: false } to hide it on a device, and { confidence } (0.05 to 0.95, lower catches more). For
// tests, { url } sends the pages through a relay instead (scripts/text-mask-proxy.js).
(function () {
  "use strict";

  const STORE = "typer.web.textmask";
  const STORE_DEVICE = "typer.web.textmask.device";
  const API = "https://temizle.saficizgi.com";
  // The service takes up to 15 MB a page
  const MAX_BYTES = 14.5e6;
  const DEFAULT_CONFIDENCE = 0.2;

  const load = () => {
    let saved = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(STORE)) || {};
    } catch (error) {
      saved = {};
    }
    const url = typeof saved.url === "string" && /^https?:\/\//.test(saved.url.trim()) ? saved.url.trim().replace(/\/+$/, "") : "";
    const confidence = Number.isFinite(saved.confidence) ? Math.min(0.95, Math.max(0.05, saved.confidence)) : DEFAULT_CONFIDENCE;
    return { on: saved.on !== false || Boolean(url), url: url || API, relay: Boolean(url) && url !== API, confidence };
  };
  const enabled = () => load().on;

  /* -------------------------- this install's token -------------------------- */

  const readDevice = () => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORE_DEVICE));
      if (saved && typeof saved.install === "string") return saved;
    } catch (error) {
      // A new install id, then
    }
    return null;
  };
  const newInstall = () => (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (window.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
  // Asked once, then kept until a day before it ends (about a month); asked again when refused
  let asking = null;
  const tokenOf = async (renew, signal) => {
    let device = readDevice();
    if (!renew && device && device.token && device.expires * 1000 - Date.now() > 864e5) return device.token;
    if (asking) return asking;
    asking = (async () => {
      const install = device ? device.install : newInstall();
      let response;
      try {
        response = await fetch(`${API}/v1/device`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ install_id: install }), signal });
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        throw new TextMaskError("network", String((error && error.message) || error));
      }
      if (!response.ok) await readError(response);
      const answer = await response.json();
      if (!answer || typeof answer.token !== "string") throw new TextMaskError("other", "No token came back.");
      device = { install, token: answer.token, expires: Number(answer.expires_at) || Date.now() / 1000 + 864e3 };
      try {
        window.localStorage.setItem(STORE_DEVICE, JSON.stringify(device));
      } catch (error) {
        // Kept for this session only
      }
      return device.token;
    })();
    try {
      return await asking;
    } finally {
      asking = null;
    }
  };

  class TextMaskError extends Error {
    constructor(kind, detail, retry) {
      super(detail || kind);
      this.kind = kind;
      this.detail = detail || "";
      this.retry = retry || 0;
    }
  }

  const blobOf = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  // The page as the service takes it: PNG, or JPEG when too heavy, or smaller as a last resort
  const encode = async (page) => {
    const canvas = document.createElement("canvas");
    canvas.width = page.width;
    canvas.height = page.height;
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(page.data), page.width, page.height), 0, 0);
    let blob = await blobOf(canvas, "image/png");
    if (blob && blob.size <= MAX_BYTES) return blob;
    blob = await blobOf(canvas, "image/jpeg", 0.92);
    if (blob && blob.size <= MAX_BYTES) return blob;
    const scale = Math.sqrt(MAX_BYTES / ((blob && blob.size) || MAX_BYTES * 2)) * 0.9;
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(page.width * scale));
    small.height = Math.max(1, Math.round(page.height * scale));
    const sctx = small.getContext("2d");
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(canvas, 0, 0, small.width, small.height);
    blob = await blobOf(small, "image/jpeg", 0.9);
    if (!blob || blob.size > MAX_BYTES) throw new TextMaskError("big");
    return blob;
  };

  const readError = async (response) => {
    let detail = "";
    try {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        detail = typeof json.detail === "string" ? json.detail : Array.isArray(json.detail) ? json.detail.map((one) => one.msg || "").join("; ") : text;
      } catch (error) {
        detail = text;
      }
    } catch (error) {
      detail = "";
    }
    detail = String(detail || response.statusText || response.status).slice(0, 200);
    const status = response.status;
    const retry = Number(response.headers.get("retry-after")) || 0;
    if (status === 401 || status === 403) throw new TextMaskError("key", detail);
    if (status === 429 || /rate limit|too many|quota/i.test(detail)) throw new TextMaskError("quota", detail, retry);
    if (status === 413) throw new TextMaskError("big", detail);
    throw new TextMaskError("other", detail);
  };

  // Where the letters are on `page` ({ data: RGBA, width, height }): one byte a pixel over the
  // page, 1 on a letter. Resolves with { mask, count, seconds }.
  const detect = async (page, { signal, confidence } = {}) => {
    const config = load();
    const blob = await encode(page);
    const wanted = Number.isFinite(confidence) ? confidence : config.confidence;
    // A relay adds its own key; the service itself takes this install's token
    const send = async (renew) => {
      const form = new FormData();
      form.append("file", blob, blob.type === "image/png" ? "page.png" : "page.jpg");
      const headers = config.relay ? {} : { Authorization: `Bearer ${await tokenOf(renew, signal)}` };
      try {
        return await fetch(`${config.url}/v1/mask?confidence=${wanted.toFixed(2)}`, { method: "POST", headers, body: form, signal });
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        throw new TextMaskError("network", String((error && error.message) || error));
      }
    };
    let response;
    try {
      response = await send(false);
    } catch (error) {
      if (error && error.kind === "network") checkHealth();
      throw error;
    }
    // A token refused (ended, or the service's keys changed): a new one, once
    if ((response.status === 401 || response.status === 403) && !config.relay) response = await send(true);
    if (!response.ok) await readError(response);
    misses = 0;
    setHealth("up");
    let bitmap;
    try {
      bitmap = await createImageBitmap(await response.blob());
    } catch (error) {
      throw new TextMaskError("other", "The mask that came back could not be read.");
    }
    // Same size as the page, unless it was sent smaller: drawn back at the page's size
    const canvas = document.createElement("canvas");
    canvas.width = page.width;
    canvas.height = page.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, page.width, page.height);
    ctx.drawImage(bitmap, 0, 0, page.width, page.height);
    if (bitmap.close) bitmap.close();
    const data = ctx.getImageData(0, 0, page.width, page.height).data;
    const mask = new Uint8Array(page.width * page.height);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4] >= 128 ? 1 : 0;
    const count = response.headers.get("x-detections");
    const seconds = response.headers.get("x-seg-seconds");
    return { mask, count: count === null ? null : Number(count), seconds: seconds === null ? null : Number(seconds) };
  };

  /* ------------------------------ the mask's areas ------------------------------ */

  // `mask` grown by `r` pixels each way (a square), one byte a pixel
  const dilate = (mask, w, h, r) => {
    if (r <= 0) return mask.slice();
    const across = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let count = 0;
      for (let x = 0; x <= Math.min(r, w - 1); x++) count += mask[row + x];
      for (let x = 0; x < w; x++) {
        across[row + x] = count > 0 ? 1 : 0;
        if (x + r + 1 < w) count += mask[row + x + r + 1];
        if (x - r >= 0) count -= mask[row + x - r];
      }
    }
    const out = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      let count = 0;
      for (let y = 0; y <= Math.min(r, h - 1); y++) count += across[y * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = count > 0 ? 1 : 0;
        if (y + r + 1 < h) count += across[(y + r + 1) * w + x];
        if (y - r >= 0) count -= across[(y - r) * w + x];
      }
    }
    return out;
  };

  // The areas of `mask`: the parts no further than `link` pixels apart go together (the letters
  // of a balloon, of a sound effect). Each is { left, top, width, height, data, count }, its
  // `data` one byte a pixel over its bounds, from `mask` only. Parts of fewer than `least`
  // pixels are left out: nothing a person would call text.
  const split = (mask, w, h, link, least = 12) => {
    const grouped = link > 0 ? dilate(mask, w, h, link) : mask;
    const labels = new Int32Array(w * h);
    const stack = new Int32Array(w * h);
    const boxes = [];
    let next = 0;
    for (let start = 0; start < labels.length; start++) {
      if (!grouped[start] || labels[start]) continue;
      next += 1;
      const box = { left: w, top: h, right: -1, bottom: -1, count: 0 };
      let top = 0;
      stack[top++] = start;
      labels[start] = next;
      while (top) {
        const i = stack[--top];
        const x = i % w;
        const y = (i - x) / w;
        if (mask[i]) {
          box.count++;
          if (x < box.left) box.left = x;
          if (x > box.right) box.right = x;
          if (y < box.top) box.top = y;
          if (y > box.bottom) box.bottom = y;
        }
        if (x > 0 && grouped[i - 1] && !labels[i - 1]) { labels[i - 1] = next; stack[top++] = i - 1; }
        if (x < w - 1 && grouped[i + 1] && !labels[i + 1]) { labels[i + 1] = next; stack[top++] = i + 1; }
        if (y > 0 && grouped[i - w] && !labels[i - w]) { labels[i - w] = next; stack[top++] = i - w; }
        if (y < h - 1 && grouped[i + w] && !labels[i + w]) { labels[i + w] = next; stack[top++] = i + w; }
      }
      boxes[next] = box;
    }
    const areas = [];
    for (let label = 1; label <= next; label++) {
      const box = boxes[label];
      if (box.count < least) continue;
      const width = box.right - box.left + 1;
      const height = box.bottom - box.top + 1;
      const data = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) {
        const from = (box.top + y) * w + box.left;
        for (let x = 0; x < width; x++) {
          if (mask[from + x] && labels[from + x] === label) data[y * width + x] = 1;
        }
      }
      areas.push({ left: box.left, top: box.top, width, height, data, count: box.count });
    }
    return areas;
  };

  /* ------------------ what can be painted over without the model ------------------ */

  // How far, on each channel, a pixel may be from the background and still be the background
  // (the grain of a scan, of a JPEG)
  const TOLERANCE = 20;
  // The pixels this close to the letters are the ones the paint will meet: nearly all of them
  // must be the background
  const NEAR = 2;
  // A line the selection comes up to beside the letters (a panel's border, a caption's box, a
  // balloon's outline) covers a long stretch of what is near them, in one piece; the grain of a
  // tone or a hatching across it, only short bits. A piece this long (in pixels) is a line, not
  // the art: it isn't held against the background, as long as such lines cover no more than
  // LINE_SHARE of what is near the letters. Whether it runs on under them is told afterwards.
  // Its length counts in bands (the band follows the page's size, as lines and grain do).
  const LINE = 4;
  const LINE_SHARE = 0.5;
  // What comes from outside the area (an outline) may go deeper in than its edge, as long as it
  // keeps at least this many pixels from the letters
  const CLEAR = 3;

  // Least squares: the six numbers of a smooth shading (1, u, v, u², uv, v²) for each channel,
  // from the samples `use` keeps. Null when they can't be told apart (too few, all in a line).
  const fitShading = (count, us, vs, colours, use) => {
    const ata = new Float64Array(36);
    const aty = new Float64Array(18);
    const t = new Float64Array(6);
    let n = 0;
    for (let s = 0; s < count; s++) {
      if (!use[s]) continue;
      n++;
      const u = us[s];
      const v = vs[s];
      t[0] = 1; t[1] = u; t[2] = v; t[3] = u * u; t[4] = u * v; t[5] = v * v;
      for (let i = 0; i < 6; i++) {
        for (let j = i; j < 6; j++) ata[i * 6 + j] += t[i] * t[j];
        for (let c = 0; c < 3; c++) aty[i * 3 + c] += t[i] * colours[s * 3 + c];
      }
    }
    if (n < 12) return null;
    for (let i = 0; i < 6; i++) for (let j = 0; j < i; j++) ata[i * 6 + j] = ata[j * 6 + i];
    // A touch of ridge, so a shading the samples barely tell stays flat rather than wild
    for (let i = 0; i < 6; i++) ata[i * 6 + i] += n * (i ? 1e-3 : 1e-9);
    // Gaussian elimination, the three channels at once
    for (let col = 0; col < 6; col++) {
      let pivot = col;
      for (let row = col + 1; row < 6; row++) if (Math.abs(ata[row * 6 + col]) > Math.abs(ata[pivot * 6 + col])) pivot = row;
      if (Math.abs(ata[pivot * 6 + col]) < 1e-12) return null;
      if (pivot !== col) {
        for (let k = 0; k < 6; k++) [ata[col * 6 + k], ata[pivot * 6 + k]] = [ata[pivot * 6 + k], ata[col * 6 + k]];
        for (let c = 0; c < 3; c++) [aty[col * 3 + c], aty[pivot * 3 + c]] = [aty[pivot * 3 + c], aty[col * 3 + c]];
      }
      for (let row = 0; row < 6; row++) {
        if (row === col) continue;
        const f = ata[row * 6 + col] / ata[col * 6 + col];
        if (!f) continue;
        for (let k = col; k < 6; k++) ata[row * 6 + k] -= f * ata[col * 6 + k];
        for (let c = 0; c < 3; c++) aty[row * 3 + c] -= f * aty[col * 3 + c];
      }
    }
    const coef = new Float64Array(18);
    for (let i = 0; i < 6; i++) for (let c = 0; c < 3; c++) coef[i * 3 + c] = aty[i * 3 + c] / ata[i * 6 + i];
    return (u, v, c) => coef[c] + coef[3 + c] * u + coef[6 + c] * v + coef[9 + c] * u * u + coef[12 + c] * u * v + coef[15 + c] * v * v;
  };

  // What is known of a field (three numbers a pixel, where `known`), carried smoothly into the
  // rest: averaged on coarser and coarser grids, then brought back down (push-pull)
  const carry = (values, known, w, h) => {
    const levels = [{ w, h, sum: values, weight: Float32Array.from(known) }];
    for (let i = 0; i < w * h; i++) if (!known[i]) values[i * 3] = values[i * 3 + 1] = values[i * 3 + 2] = 0;
    while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
      const fine = levels[levels.length - 1];
      const cw = Math.ceil(fine.w / 2);
      const ch = Math.ceil(fine.h / 2);
      const sum = new Float32Array(cw * ch * 3);
      const weight = new Float32Array(cw * ch);
      for (let y = 0; y < fine.h; y++) {
        for (let x = 0; x < fine.w; x++) {
          const i = y * fine.w + x;
          if (!fine.weight[i]) continue;
          const j = (y >> 1) * cw + (x >> 1);
          weight[j] += fine.weight[i];
          for (let c = 0; c < 3; c++) sum[j * 3 + c] += fine.sum[i * 3 + c];
        }
      }
      levels.push({ w: cw, h: ch, sum, weight });
    }
    // Back down: where a grid knew nothing, the coarser one's answer, blended between its cells
    let above = null;
    for (let n = levels.length - 1; n >= 0; n--) {
      const level = levels[n];
      const out = new Float32Array(level.w * level.h * 3);
      for (let y = 0; y < level.h; y++) {
        for (let x = 0; x < level.w; x++) {
          const i = y * level.w + x;
          if (level.weight[i]) {
            for (let c = 0; c < 3; c++) out[i * 3 + c] = level.sum[i * 3 + c] / level.weight[i];
            continue;
          }
          if (!above) continue;
          const coarse = levels[n + 1];
          const fx = Math.max(0, Math.min(coarse.w - 1, (x + 0.5) / 2 - 0.5));
          const fy = Math.max(0, Math.min(coarse.h - 1, (y + 0.5) / 2 - 0.5));
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const x1 = Math.min(coarse.w - 1, x0 + 1);
          const y1 = Math.min(coarse.h - 1, y0 + 1);
          const tx = fx - x0;
          const ty = fy - y0;
          for (let c = 0; c < 3; c++) {
            const top = above[(y0 * coarse.w + x0) * 3 + c] * (1 - tx) + above[(y0 * coarse.w + x1) * 3 + c] * tx;
            const bottom = above[(y1 * coarse.w + x0) * 3 + c] * (1 - tx) + above[(y1 * coarse.w + x1) * 3 + c] * tx;
            out[i * 3 + c] = top * (1 - ty) + bottom * ty;
          }
        }
      }
      above = out;
    }
    return above;
  };

  // Whether `area` lies on a plain background, one that paint can give back exactly: one colour
  // (a white, a black, a pink balloon) or a smooth shading (a gradient balloon, a sky). Read from
  // a band of `band` pixels around it, the other letters (`all`) left out: most of what is near
  // the letters must be that background. Lines may come up to the area, as a balloon's outline
  // does when the letters are close to it: they are left as they are, unpainted, if they stop
  // within its edge (`margin` pixels deep, how far the letters' area was grown), or go deeper
  // while keeping clear of the letters. One that comes up to them runs under them (the art), and
  // only the model can draw it on.
  // { plain, colour: { r, g, b }, data }, `data` the pixels to paint over the area's bounds; a
  // shading also gives `pixels`, RGBA over the area's bounds, the colour to paint at each.
  const plainOf = (area, rgba, w, h, all, band = 6, margin = band) => {
    const no = { plain: false, colour: null };
    const left = Math.max(0, area.left - band);
    const top = Math.max(0, area.top - band);
    const right = Math.min(w, area.left + area.width + band);
    const bottom = Math.min(h, area.top + area.height + band);
    const bw = right - left;
    const bh = bottom - top;
    const ax = area.left - left;
    const ay = area.top - top;
    // How far each pixel of the window is from the area (ON on it, 0 further than `band`)
    const ON = 255;
    const dist = new Uint8Array(bw * bh);
    const queue = new Int32Array(bw * bh);
    let tail = 0;
    for (let y = 0; y < area.height; y++) {
      for (let x = 0; x < area.width; x++) {
        if (!area.data[y * area.width + x]) continue;
        const i = (ay + y) * bw + ax + x;
        dist[i] = ON;
        queue[tail++] = i;
      }
    }
    const inArea = tail;
    for (let head = 0; head < tail; head++) {
      const i = queue[head];
      const d = dist[i] === ON ? 0 : dist[i];
      if (d >= band) continue;
      const x = i % bw;
      const y = (i - x) / bw;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(bh - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(bw - 1, x + 1); nx++) {
          const n = ny * bw + nx;
          if (dist[n]) continue;
          dist[n] = d + 1;
          queue[tail++] = n;
        }
      }
    }
    // The samples: where they are (u, v around the area's middle), how far, their colour
    const cx = area.left + area.width / 2;
    const cy = area.top + area.height / 2;
    const scale = Math.max(area.width, area.height) / 2 + band;
    const count0 = tail - inArea;
    const at = new Int32Array(count0);
    const us = new Float32Array(count0);
    const vs = new Float32Array(count0);
    const ds = new Uint8Array(count0);
    const colours = new Float32Array(count0 * 3);
    let count = 0;
    for (let k = inArea; k < tail; k++) {
      const i = queue[k];
      const x = i % bw;
      const y = (i - x) / bw;
      const page = (top + y) * w + left + x;
      if (all && all[page]) continue;
      at[count] = i;
      us[count] = (left + x - cx) / scale;
      vs[count] = (top + y - cy) / scale;
      ds[count] = dist[i];
      colours[count * 3] = rgba[page * 4];
      colours[count * 3 + 1] = rgba[page * 4 + 1];
      colours[count * 3 + 2] = rgba[page * 4 + 2];
      count++;
    }
    const use = new Uint8Array(count);
    let nearCount = 0;
    for (let s = 0; s < count; s++) if (ds[s] <= NEAR) { use[s] = 1; nearCount++; }
    if (nearCount < 12) return no;
    // The samples on a line along the letters (see LINE), left out of the judging
    const line = new Uint8Array(count);
    // How well a background explains the samples: the share of those near the letters, and of
    // the whole band, it explains, and how closely it explains those near the letters. Those it
    // explains (no further off than `tolerance`) are marked in `use`.
    const judge = (bg, tolerance = TOLERANCE) => {
      let near = 0, nearIn = 0, all = 0, inBand = 0, error = 0;
      for (let s = 0; s < count; s++) {
        if (line[s]) {
          use[s] = 0;
          continue;
        }
        let worst = 0;
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(colours[s * 3 + c] - bg(us[s], vs[s], c)));
        use[s] = worst <= tolerance ? 1 : 0;
        const fits = worst <= TOLERANCE;
        all++;
        if (fits) inBand++;
        if (ds[s] <= NEAR) {
          near++;
          if (fits) {
            nearIn++;
            error += worst;
          }
        }
      }
      const result = { near: near ? nearIn / near : 0, band: all ? inBand / all : 0, error: nearIn ? error / nearIn : TOLERANCE };
      // The grain of a scan, of a JPEG, of a page made bigger or smaller stays well within 5 levels
      // on average; a screentone that a smaller or softer page has blurred into a grey doesn't
      result.ok = result.near >= 0.85 && result.band >= 0.6 && result.error <= 5;
      return result;
    };
    // One colour: the middle of what is near the letters
    const median = [0, 1, 2].map((c) => {
      const values = [];
      for (let s = 0; s < count; s++) if (ds[s] <= NEAR) values.push(colours[s * 3 + c]);
      values.sort((a, b) => a - b);
      return values[values.length >> 1];
    });
    // What is near the letters without being that colour, in pieces: the long ones are lines
    const sampleAt = new Int32Array(bw * bh).fill(-1);
    for (let s = 0; s < count; s++) {
      if (ds[s] > NEAR) continue;
      let worst = 0;
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(colours[s * 3 + c] - median[c]));
      if (worst > TOLERANCE) sampleAt[at[s]] = s;
    }
    const piece = new Int32Array(nearCount);
    let lined = 0;
    for (let s = 0; s < count; s++) {
      if (sampleAt[at[s]] !== s || line[s]) continue;
      // Marked 2 while its piece is gathered, then 1 if it is long enough, 3 if not
      let size = 0;
      line[s] = 2;
      piece[size++] = s;
      for (let head = 0; head < size; head++) {
        const i = at[piece[head]];
        const x = i % bw;
        const y = (i - x) / bw;
        for (let ny = Math.max(0, y - 1); ny <= Math.min(bh - 1, y + 1); ny++) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(bw - 1, x + 1); nx++) {
            const n = sampleAt[ny * bw + nx];
            if (n < 0 || line[n]) continue;
            line[n] = 2;
            piece[size++] = n;
          }
        }
      }
      const long = size >= LINE * band;
      for (let k = 0; k < size; k++) line[piece[k]] = long ? 1 : 3;
      if (long) lined += size;
    }
    // Only the lines are left marked, and none if they are too much of it
    for (let s = 0; s < count; s++) if (line[s] !== 1 || lined > nearCount * LINE_SHARE) line[s] = 0;
    const flatAt = (u, v, c) => median[c];
    const flat = judge(flatAt);
    // A shading: fitted to what is near the letters, then again and again to what it explains
    // all around, more and more closely, so an outline or the art beside the balloon soon has no
    // say in it
    for (let s = 0; s < count; s++) use[s] = ds[s] <= NEAR && !line[s] ? 1 : 0;
    let shading = null;
    let smooth = null;
    for (const tolerance of [TOLERANCE * 4, TOLERANCE * 2, TOLERANCE, TOLERANCE]) {
      const fitted = fitShading(count, us, vs, colours, use);
      if (!fitted) break;
      shading = fitted;
      smooth = judge(shading, tolerance);
    }
    // The shading over the area: if it barely changes, one colour does as well
    let spread = 0;
    if (smooth && smooth.ok) {
      const low = [255, 255, 255];
      const high = [0, 0, 0];
      for (let y = 0; y < area.height; y++) {
        for (let x = 0; x < area.width; x++) {
          if (!area.data[y * area.width + x]) continue;
          const u = (area.left + x - cx) / scale;
          const v = (area.top + y - cy) / scale;
          for (let c = 0; c < 3; c++) {
            const value = shading(u, v, c);
            if (value < low[c]) low[c] = value;
            if (value > high[c]) high[c] = value;
          }
        }
      }
      spread = Math.max(high[0] - low[0], high[1] - low[1], high[2] - low[2]);
      // A shading that strays far from every colour around it is guessing, not giving back
      for (let c = 0; c < 3 && smooth.ok; c++) {
        let least = 255;
        let most = 0;
        for (let s = 0; s < count; s++) {
          if (!use[s]) continue;
          least = Math.min(least, colours[s * 3 + c]);
          most = Math.max(most, colours[s * 3 + c]);
        }
        if (low[c] < least - TOLERANCE || high[c] > most + TOLERANCE) smooth.ok = false;
      }
    }
    let bg = null;
    if (flat.ok && (!smooth || !smooth.ok || spread <= 6 || flat.error <= smooth.error + 1)) bg = flatAt;
    else if (smooth && smooth.ok) bg = shading;
    if (!bg) return no;
    // Which samples it explains, in `use`
    judge(bg);
    // What comes up to the area without being the background (`use` tells, for the chosen one):
    // followed into the area through the pixels that aren't the background either, no deeper
    // than its edge (but see below). The area's pixels, each with how deep in it it is.
    const depth = new Uint16Array(bw * bh);
    const limit = margin + 1;
    tail = 0;
    for (let k = 0; k < inArea; k++) {
      const i = queue[k];
      const x = i % bw;
      const y = (i - x) / bw;
      if (x === 0 || y === 0 || x === bw - 1 || y === bh - 1 || dist[i - 1] !== ON || dist[i + 1] !== ON || dist[i - bw] !== ON || dist[i + bw] !== ON) {
        depth[i] = 1;
        queue[tail++] = i;
      }
    }
    for (let head = 0; head < tail; head++) {
      const i = queue[head];
      const x = i % bw;
      const y = (i - x) / bw;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(bh - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(bw - 1, x + 1); nx++) {
          const n = ny * bw + nx;
          if (dist[n] !== ON || depth[n]) continue;
          depth[n] = depth[i] + 1;
          queue[tail++] = n;
        }
      }
    }
    const off = (i) => {
      const x = i % bw;
      const y = (i - x) / bw;
      const page = ((top + y) * w + left + x) * 4;
      const u = (left + x - cx) / scale;
      const v = (top + y - cy) / scale;
      for (let c = 0; c < 3; c++) if (Math.abs(rgba[page + c] - bg(u, v, c)) > TOLERANCE) return true;
      return false;
    };
    const kept = new Uint8Array(bw * bh);
    let deepest = 0;
    tail = 0;
    for (let s = 0; s < count; s++) {
      if (ds[s] !== 1 || use[s]) continue;
      kept[at[s]] = 2;
      queue[tail++] = at[s];
    }
    for (let head = 0; head < tail; head++) {
      const i = queue[head];
      const x = i % bw;
      const y = (i - x) / bw;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(bh - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(bw - 1, x + 1); nx++) {
          const n = ny * bw + nx;
          if (dist[n] !== ON || kept[n] || !off(n)) continue;
          kept[n] = 1;
          if (depth[n] > deepest) deepest = depth[n];
          queue[tail++] = n;
        }
      }
    }
    // Deeper than the edge, it runs under the letters, unless it keeps CLEAR of them and stays
    // shallower than those around where it goes deep: then it's an outline the letters come
    // close to, the selection reaching past it (the detection's mask has a margin of its own
    // around the strokes). The letters: what isn't the background without coming from outside
    // the area. None around, it may be the letters themselves that touch it; one that ends
    // against them may go on under them: the model's work.
    if (deepest > limit) {
      const near = new Uint16Array(bw * bh);
      tail = 0;
      for (let i = 0; i < bw * bh; i++) {
        if (kept[i] !== 1 || depth[i] <= limit) continue;
        near[i] = 1;
        queue[tail++] = i;
      }
      const reach = band * 2;
      let letters = Infinity;
      let apart = Infinity;
      for (let head = 0; head < tail; head++) {
        const i = queue[head];
        // The first met is the nearest. A speck within the edge isn't one of the letters, which
        // lie deeper than that, but it must be kept clear of all the same.
        if (dist[i] === ON && !kept[i] && off(i)) {
          if (apart === Infinity) apart = near[i] - 1;
          if (depth[i] > limit && depth[i] < letters) letters = depth[i];
        }
        if (near[i] > reach) continue;
        const x = i % bw;
        const y = (i - x) / bw;
        for (let ny = Math.max(0, y - 1); ny <= Math.min(bh - 1, y + 1); ny++) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(bw - 1, x + 1); nx++) {
            const n = ny * bw + nx;
            if (near[n]) continue;
            near[n] = near[i] + 1;
            queue[tail++] = n;
          }
        }
      }
      if (letters === Infinity || deepest >= letters || apart < CLEAR) return no;
    }
    // A shading meets the page exactly at the area's edge: what it misses of the background
    // there is carried in, smoothly, so no seam shows
    let misses = null;
    if (bg === shading) {
      const values = new Float32Array(bw * bh * 3);
      const known = new Uint8Array(bw * bh);
      for (let s = 0; s < count; s++) {
        if (!use[s]) continue;
        known[at[s]] = 1;
        for (let c = 0; c < 3; c++) values[at[s] * 3 + c] = colours[s * 3 + c] - shading(us[s], vs[s], c);
      }
      misses = carry(values, known, bw, bh);
    }
    // What gets painted: the area, but for what was kept
    const data = new Uint8Array(area.data.length);
    const pixels = misses ? new Uint8ClampedArray(area.width * area.height * 4) : null;
    let painted = 0;
    for (let y = 0; y < area.height; y++) {
      for (let x = 0; x < area.width; x++) {
        const j = y * area.width + x;
        if (!area.data[j] || kept[(ay + y) * bw + ax + x] === 1) continue;
        data[j] = 1;
        painted++;
        if (!pixels) continue;
        const u = (area.left + x - cx) / scale;
        const v = (area.top + y - cy) / scale;
        const k = ((ay + y) * bw + ax + x) * 3;
        for (let c = 0; c < 3; c++) pixels[j * 4 + c] = Math.round(shading(u, v, c) + misses[k + c]);
        pixels[j * 4 + 3] = 255;
      }
    }
    if (!painted) return no;
    const result = { plain: true, colour: { r: median[0], g: median[1], b: median[2] }, data };
    if (pixels) result.pixels = pixels;
    return result;
  };

  // The areas of the selection `full` (see split), each told whether it lies on a plain
  // background (see plainOf). `grow`: how far the letters' areas were grown. One that doesn't is
  // looked at again in smaller parts, since two balloons side by side, or a balloon and a word
  // over the art beside it, may have come together: its parts on a plain background are still
  // painted, and only the rest, as one area, is left to the model. The parts are taken closer
  // and closer: first those a third of `link` apart, then, of those still not on a plain
  // background, those that don't touch (letters a few pixels from a word beside them).
  const areasOf = (full, rgba, w, h, link, grow = 4) => {
    const band = Math.max(6, grow + 3);
    const judge = (area) => {
      const whole = area.data;
      Object.assign(area, plainOf(area, rgba, w, h, full, band, grow + 1));
      area.whole = whole;
      return area;
    };
    const links = [...new Set([Math.max(1, Math.round(link / 3)), 1])];
    const areas = [];
    split(full, w, h, link).forEach((area) => {
      judge(area);
      if (area.plain) {
        areas.push(area);
        return;
      }
      const plain = [];
      let left = [area];
      links.forEach((near) => {
        const next = [];
        left.forEach((piece) => {
          const parts = split(piece.whole, piece.width, piece.height, near, 1);
          if (parts.length < 2) {
            next.push(piece);
            return;
          }
          parts.forEach((part) => {
            part.left += piece.left;
            part.top += piece.top;
            (judge(part).plain ? plain : next).push(part);
          });
        });
        left = next;
      });
      if (!plain.length) {
        areas.push(area);
        return;
      }
      areas.push(...plain);
      // The rest, as one area
      const rest = area.data.slice();
      plain.forEach((part) => {
        for (let y = 0; y < part.height; y++) {
          for (let x = 0; x < part.width; x++) {
            if (part.whole[y * part.width + x]) rest[(part.top - area.top + y) * area.width + part.left - area.left + x] = 0;
          }
        }
      });
      let x0 = area.width;
      let y0 = area.height;
      let x1 = -1;
      let y1 = -1;
      let count = 0;
      for (let y = 0; y < area.height; y++) {
        for (let x = 0; x < area.width; x++) {
          if (!rest[y * area.width + x]) continue;
          count++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (!count) return;
      const width = x1 - x0 + 1;
      const height = y1 - y0 + 1;
      const data = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) data.set(rest.subarray((y0 + y) * area.width + x0, (y0 + y) * area.width + x0 + width), y * width);
      areas.push({ left: area.left + x0, top: area.top + y0, width, height, data, whole: data, count, plain: false, colour: null });
    });
    return areas;
  };

  /* ------------------------- whether the service is up ------------------------- */

  // Asked at /health now and then. Taken as down only after several misses in a row, so one
  // slow answer doesn't hide anything; back up at the first good answer.
  const MISSES = 3;
  const HEALTH_TIMEOUT = 10e3;
  const AGAIN_UP = 5 * 60e3;
  const AGAIN_MISSED = 15e3;
  const AGAIN_DOWN = 60e3;
  let health = "unknown";
  let misses = 0;
  let healthTimer = 0;
  let healthAsking = null;
  const healthListeners = new Set();
  const setHealth = (next) => {
    if (next === health) return;
    health = next;
    healthListeners.forEach((listener) => {
      try {
        listener(health);
      } catch (error) {
        console.warn("SG Typer Studio: text detection status listener failed", error);
      }
    });
  };
  const askHealth = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT);
    try {
      const response = await fetch(`${load().url}/health`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) return false;
      const answer = await response.json().catch(() => null);
      return Boolean(answer) && answer.status === "ok" && answer.models_loaded !== false;
    } catch (error) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
  const checkHealth = () => {
    if (healthAsking) return healthAsking;
    clearTimeout(healthTimer);
    healthAsking = (async () => {
      const ok = await askHealth();
      if (ok) {
        misses = 0;
        setHealth("up");
      } else {
        misses += 1;
        if (misses >= MISSES) setHealth("down");
      }
      healthTimer = setTimeout(checkHealth, ok ? AGAIN_UP : health === "down" ? AGAIN_DOWN : AGAIN_MISSED);
    })();
    return healthAsking.finally(() => {
      healthAsking = null;
    });
  };
  let watching = false;
  // Starts the checks (once); `listener` hears each change, "up" or "down"
  const watch = (listener) => {
    if (listener) healthListeners.add(listener);
    if (watching || !enabled()) return;
    watching = true;
    checkHealth();
    // Back online, or back on the page after a long while: asked again at once
    window.addEventListener("online", () => checkHealth());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && health !== "up") checkHealth();
    });
  };
  // False only once the service has missed several times in a row
  const available = () => health !== "down";

  window.TypeRTextMask = { API, load, enabled, available, watch, detect, dilate, split, plainOf, areasOf, TextMaskError };
})();
