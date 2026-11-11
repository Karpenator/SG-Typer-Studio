// The Bubble Reshaper (U): a click takes a bubble, its handles give it another shape,
// Enter lays it on the page. The work is reshape.js's; this is the tool around it: the
// handles, the bubble shown as it will be, the options bar, and what the old bubble leaves
// uncovered, painted when the page around was plain, else filled or left selected to redraw.
(function () {
  "use strict";

  const PS = window.TypeRPhotoshop;
  const R = window.TypeRReshape;
  if (!PS || !R) return;
  const { app, ops } = PS;
  const App = () => window.TypeRApp;
  const T = (text) => (window.TypeRApp ? window.TypeRApp.T(text) : text);
  const Gen = window.TypeRGenerative || null;
  const SVGNS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const touch = () => Boolean(window.TypeRShell && window.TypeRShell.touch);

  /* ------------------------------ settings ------------------------------ */

  const STORE = "typer.web.reshape";
  const settings = (() => {
    const out = { behind: "" };
    try {
      Object.assign(out, JSON.parse(window.localStorage.getItem(STORE)) || {});
    } catch (error) {
      // Defaults
    }
    return out;
  })();
  const keepSettings = () => {
    try {
      window.localStorage.setItem(STORE, JSON.stringify(settings));
    } catch (error) {
      // Only a preference
    }
  };
  const genReady = () => Boolean(Gen && Gen.ready(Gen.load()));
  // What fills the part of the page the old bubble no longer covers, when it isn't plain
  const behind = () => settings.behind || (genReady() ? "generative" : "select");

  /* ------------------------------ the session ------------------------------ */

  // One bubble being shaped, on one page: { doc, state, model, params, replaces, shape, result }
  let session = null;
  let frame = 0;

  const clone = (params) => ({ box: Object.assign({}, params.box), tip: params.tip ? params.tip.slice() : null, pulls: params.pulls.map((pull) => Object.assign({}, pull)), kind: params.kind, angle: params.angle || 0 });
  const changed = (s) => {
    const a = s.params;
    const b = s.start;
    return a.kind !== b.kind || Math.abs((a.angle || 0) - (b.angle || 0)) > 1e-4 || a.pulls.length !== b.pulls.length || Boolean(a.tip) !== Boolean(b.tip) || ["left", "top", "right", "bottom"].some((side) => Math.abs(a.box[side] - b.box[side]) > 0.25) || (a.tip && b.tip && (a.tip[0] !== b.tip[0] || a.tip[1] !== b.tip[1]));
  };

  // Where a new bubble layer goes: under the texts, as TypeR Clean
  const firstAbove = (doc) => {
    const layers = doc.state.layers;
    const rootOf = (layer) => {
      let root = layer;
      while (root && root.group) root = layers.find((item) => item.id === root.group);
      return root;
    };
    let at = layers.findIndex((layer) => layer.kind === "text");
    if (at < 0) return null;
    if (layers[at].group) {
      const root = rootOf(layers[at]);
      while (at > 0 && rootOf(layers[at - 1]) === root) at--;
    }
    return layers[at].id;
  };

  const REFUSALS = {
    background: "Click inside a bubble.",
    open: "This area is open or too large for a bubble.",
    small: "This bubble is too small to reshape.",
  };

  const begin = (x, y) => {
    const doc = app.doc;
    if (!doc) return false;
    const layer = ops.reshapedAt(x, y);
    let model;
    let params;
    let replaces = null;
    let cleared = false;
    if (layer && layer.bubble && layer.bubble.model && layer.bubble.model.page.width === doc.width && layer.bubble.model.page.height === doc.height) {
      // A bubble shaped before: its shape comes back as it was left
      model = layer.bubble.model;
      params = clone(layer.bubble.params);
      replaces = layer.id;
      // Its old bubble is being drawn over whole already: no gap is left, whatever the shape
      cleared = Boolean(layer.bubble.cleared);
    } else {
      const page = ops.reshapePage();
      if (!page) return false;
      model = R.analyze(page, x, y, { tolerance: app.cleanTolerance });
      if (model.error) {
        App().toast(T(REFUSALS[model.error] || REFUSALS.background));
        return false;
      }
      params = R.startParams(model);
    }
    const replaced = replaces && doc.state.layers.find((item) => item.id === replaces);
    session = { doc, state: doc.state, model, params, start: clone(params), replaces, group: replaced ? replaced.group : null, before: replaces ? null : firstAbove(doc), cleared, shape: null, result: null, area: null };
    show();
    App().renderOptions();
    return true;
  };

  // Drawn again at the next frame, once however many moves come before it. `quick`, from a
  // handle being dragged: the inside stays plain until the handle is let go.
  let frameQuick = false;
  const show = (quick = false) => {
    frameQuick = frame ? frameQuick && quick : quick;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      redraw(frameQuick);
    });
  };
  const redraw = (quick) => {
    const s = session;
    if (!s || app.doc !== s.doc) return;
    s.shape = R.shapeOf(s.model, s.params);
    s.result = R.render(s.model, s.shape, { cleared: s.cleared, quick });
    if (!s.result) return;
    const canvas = pictureOf(s.result, true);
    const r = s.result;
    const area = { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height };
    const both = s.area ? { left: Math.min(area.left, s.area.left), top: Math.min(area.top, s.area.top), right: Math.max(area.right, s.area.right), bottom: Math.max(area.bottom, s.area.bottom) } : null;
    s.area = area;
    const layer = PS.newRaster("", { id: "reshape-preview", bitmap: canvas, left: r.left, top: r.top, group: s.group });
    ops.reshapeShow({ layer, before: s.before, replaces: s.replaces }, both);
    drawOverlay();
  };

  // The picture as a canvas. On screen, what will still need filling is striped, and the same
  // canvas is painted again at every move; the one laid on the page is its own.
  let preview = null;
  const pictureOf = (result, onScreen) => {
    let canvas;
    if (onScreen) {
      if (!preview || preview.width !== result.width || preview.height !== result.height) preview = PS.newCanvas(result.width, result.height);
      canvas = preview;
    } else canvas = PS.newCanvas(result.width, result.height);
    const ctx = canvas.getContext("2d");
    // Drawn straight from the picture's own pixels: the stripes go on them, and only on screen
    const image = new ImageData(result.rgba, result.width, result.height);
    if (onScreen && result.gapCount) {
      const px = image.data;
      for (let y = 0; y < result.height; y++) {
        for (let x = 0; x < result.width; x++) {
          const i = y * result.width + x;
          if (!result.gap[i]) continue;
          const on = (x + y + result.left + result.top) % 12 < 5;
          px[i * 4] = on ? 38 : 120;
          px[i * 4 + 1] = on ? 132 : 170;
          px[i * 4 + 2] = 255;
          px[i * 4 + 3] = on ? 150 : 60;
        }
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  };

  const end = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    preview = null;
    const s = session;
    session = null;
    if (s && s.doc.extra) ops.reshapeShow(null);
    drawOverlay();
    if (App()) App().renderOptions();
  };
  const cancel = () => end();

  // The bubble lands as a layer; what it no longer covers is filled or selected
  const commit = () => {
    const s = session;
    if (!s) return;
    if (app.doc !== s.doc) return end();
    if (!changed(s)) return end();
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    s.shape = R.shapeOf(s.model, s.params);
    s.result = R.render(s.model, s.shape, { cleared: s.cleared });
    session = null;
    const result = s.result;
    if (!result) return end();
    const canvas = pictureOf(result, false);
    const id = ops.reshapeCommit({ canvas, left: result.left, top: result.top, bubble: { model: s.model, params: clone(s.params), cleared: s.cleared }, replaces: s.replaces, name: T("Bubble") });
    drawOverlay();
    App().renderOptions();
    if (id && !s.cleared && result.gapCount > 40) fillBehind(result, id, s.model);
  };

  // The uncovered part, a little wider so the old line's edge goes too, never on the new bubble
  const gapSelection = (result) => {
    const { width: w, height: h, gap, rgba } = result;
    const grown = new Uint8Array(w * h);
    const R2 = 3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!gap[y * w + x]) continue;
        for (let dy = -R2; dy <= R2; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -R2; dx <= R2; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w || dx * dx + dy * dy > R2 * R2) continue;
            const j = yy * w + xx;
            if (rgba[j * 4 + 3] < 128) grown[j] = 1;
          }
        }
      }
    }
    return ops.selectMask(grown, w, h, result.left, result.top, "Bubble Reshaper");
  };
  // The whole old bubble, its line, tail and halo, grown well past them: the model gets the
  // art around to continue, and none of the old bubble is left anywhere
  const wholeSelection = (model) => {
    const src = model.source;
    const { box, page } = model;
    const reach = Math.max(16, Math.min(40, Math.round(Math.min(box.right - box.left, box.bottom - box.top) * 0.08)));
    const left = Math.max(0, src.left - reach);
    const top = Math.max(0, src.top - reach);
    const w = Math.min(page.width, src.left + src.width + reach) - left;
    const h = Math.min(page.height, src.top + src.height + reach) - top;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) if (model.footprint[y * src.width + x]) mask[(y + src.top - top) * w + x + src.left - left] = 1;
    }
    return ops.selectMask(R.grow(mask, w, h, reach), w, h, left, top, "Bubble Reshaper");
  };
  const PROMPT = "Remove the speech balloon in this area completely, its outline, its tail and its white inside, and redraw the artwork that was behind it so it continues the surroundings seamlessly: the same line art, screentone, tones and paper. Add no text, no balloon and nothing new.";
  const fillBehind = async (result, id, model) => {
    const way = behind();
    // What fills it goes under the new bubble, never over its edge
    const layers = app.doc.state.layers;
    const at = layers.findIndex((layer) => layer.id === id);
    if (way !== "select" && at > 0) ops.selectLayer(layers[at - 1].id);
    if (way === "generative" && Gen && App().generate) {
      // The model sees the page without the new bubble, and redraws under it
      const whole = wholeSelection(model);
      const started = whole && (await App().generate(whole, PROMPT, T("Behind the bubble"), [id]));
      if (started) {
        // Shaped again later, this bubble needs nothing more behind it
        const layer = app.doc && app.doc.state.layers.find((item) => item.id === id);
        if (layer && layer.bubble) layer.bubble.cleared = true;
        return;
      }
      gapSelection(result);
      App().toast(T("The part of the page the old bubble covered is selected: redraw it there."), true);
      return;
    }
    const selection = gapSelection(result);
    if (!selection) return;
    if (way === "content") {
      App().toast(T("Content-Aware Fill…"));
      const outcome = await ops.contentAwareFill({ output: "new", name: T("Behind the bubble") }, () => {});
      if (outcome !== "done") App().toast(T("The part of the page the old bubble covered is selected: redraw it there."), true);
      return;
    }
    App().toast(T("The part of the page the old bubble covered is selected: redraw it there."), true);
  };

  /* ------------------------------ text inside ------------------------------ */

  // The texts over the bubble: the box that holds them all
  const textsOver = (s) => {
    const doc = s.doc;
    const b = s.params.box;
    const hits = doc.state.layers.filter((layer) => {
      if (layer.kind !== "text" || layer.visible === false) return false;
      const f = PS.frameOf(layer, doc);
      if (!f) return false;
      const ix = Math.min(f.right, b.right) - Math.max(f.left, b.left);
      const iy = Math.min(f.bottom, b.bottom) - Math.max(f.top, b.top);
      return ix > 0 && iy > 0 && ix * iy >= (f.right - f.left) * (f.bottom - f.top) * 0.3;
    });
    if (!hits.length) return null;
    const frames = hits.map((layer) => PS.frameOf(layer, doc));
    return { left: Math.min(...frames.map((f) => f.left)), top: Math.min(...frames.map((f) => f.top)), right: Math.max(...frames.map((f) => f.right)), bottom: Math.max(...frames.map((f) => f.bottom)) };
  };
  const fitText = () => {
    const s = session;
    if (!s) return;
    const rect = textsOver(s);
    if (!rect) {
      App().toast(T("There is no text over this bubble."));
      return;
    }
    const pad = Math.max(10, Math.min(rect.right - rect.left, rect.bottom - rect.top) * 0.08);
    s.params.pulls = [];
    s.params.box = R.fitBox(s.model, s.params, rect, pad);
    show();
    App().renderOptions();
  };

  /* ------------------------------ on the page ------------------------------ */

  let group = null;
  const overlay = () => {
    if (group && group.isConnected) return group;
    const over = $("over");
    if (!over) return null;
    group = document.createElementNS(SVGNS, "g");
    group.id = "over-reshape";
    over.appendChild(group);
    return group;
  };
  const svg = (tag, attributes, parent) => {
    const el = document.createElementNS(SVGNS, tag);
    Object.keys(attributes).forEach((key) => el.setAttribute(key, attributes[key]));
    parent.appendChild(el);
    return el;
  };
  const HANDLES = [["nw", 0, 0], ["n", 0.5, 0], ["ne", 1, 0], ["e", 1, 0.5], ["se", 1, 1], ["s", 0.5, 1], ["sw", 0, 1], ["w", 0, 0.5]];
  const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#fff" stroke-width="4"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></g><g stroke="#000" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></g></svg>')}") 12 12, crosshair`;
  const CURSOR = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", tip: "move", move: "move", pull: "grab", rotate: ROTATE_CURSOR };
  let handles = [];
  const drawOverlay = () => {
    const g = overlay();
    if (!g) return;
    g.textContent = "";
    handles = [];
    const s = session;
    if (!s || app.doc !== s.doc || app.tool !== "reshape" || !App()) return;
    const screen = (x, y) => App().toScreen(x, y);
    if (s.shape) {
      let d = "";
      for (let k = 0; k < s.shape.n; k += 2) {
        const [x, y] = screen(s.shape.x[k], s.shape.y[k]);
        d += `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      svg("path", { d: d + "Z", class: "reshape-line" }, g);
    }
    // The frame turns with the bubble
    const at = (fx, fy) => {
      const p = onFrame(s.params, fx, fy);
      return screen(p[0], p[1]);
    };
    const corners = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
    svg("polygon", { points: corners.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" "), class: "reshape-frame" }, g);
    const size = touch() ? 13 : 7;
    HANDLES.forEach(([kind, fx, fy]) => {
      const [x, y] = at(fx, fy);
      svg("rect", { class: "handle", x: Math.round(x - size / 2) + 0.5, y: Math.round(y - size / 2) + 0.5, width: size, height: size }, g);
      handles.push({ kind, x, y });
    });
    // The ● above the top edge turns it
    const topMid = at(0.5, 0);
    const centre = at(0.5, 0.5);
    const away = [topMid[0] - centre[0], topMid[1] - centre[1]];
    const length = Math.hypot(away[0], away[1]) || 1;
    const knob = [topMid[0] + (away[0] / length) * 20, topMid[1] + (away[1] / length) * 20];
    svg("line", { x1: topMid[0], y1: topMid[1], x2: knob[0], y2: knob[1], class: "reshape-stem" }, g);
    svg("circle", { class: "handle handle--bend", cx: knob[0], cy: knob[1], r: touch() ? 8 : 4.5 }, g);
    handles.push({ kind: "rotate", x: knob[0], y: knob[1] });
    const tip = s.shape && s.shape.tipAt;
    if (tip) {
      const [x, y] = screen(tip[0], tip[1]);
      svg("circle", { class: "handle handle--bend", cx: x, cy: y, r: touch() ? 8 : 4.5 }, g);
      handles.push({ kind: "tip", x, y });
    }
  };

  // A point of the frame, as shares of its box (0 to 1), on the page, turned with it
  const onFrame = (params, fx, fy) => {
    const b = params.box;
    const cx = (b.left + b.right) / 2;
    const cy = (b.top + b.bottom) / 2;
    const x = b.left + (b.right - b.left) * fx - cx;
    const y = b.top + (b.bottom - b.top) * fy - cy;
    const a = params.angle || 0;
    return [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)];
  };
  // A point of the page in the frame's own unturned directions, from its middle
  const toFrame = (params, x, y) => {
    const b = params.box;
    const dx = x - (b.left + b.right) / 2;
    const dy = y - (b.top + b.bottom) / 2;
    const a = -(params.angle || 0);
    return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  };
  const stagePoint = (event) => {
    const stage = $("stage");
    const rect = stage.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  // What the pointer is over: a handle, the outline, inside the box, or elsewhere
  const hit = (event, point) => {
    const s = session;
    if (!s) return null;
    const [sx, sy] = stagePoint(event);
    const reach = event.pointerType === "touch" ? 22 : 8;
    let best = null;
    let near = reach;
    handles.forEach((h) => {
      const d = Math.hypot(h.x - sx, h.y - sy);
      if (d <= near) {
        near = d;
        best = h.kind;
      }
    });
    if (best) return best;
    if (s.shape) {
      const zoom = App().view().zoom;
      const limit = (event.pointerType === "touch" ? 14 : 6) / zoom;
      for (let k = 0; k < s.shape.n; k++) if (Math.hypot(s.shape.x[k] - point[0], s.shape.y[k] - point[1]) <= limit) return "pull";
      if (R.insidePolygon(s.shape, point[0], point[1])) return "move";
    }
    const b = s.params.box;
    const [lx, ly] = toFrame(s.params, point[0], point[1]);
    const hw = (b.right - b.left) / 2;
    const hh = (b.bottom - b.top) / 2;
    if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return "move";
    // Just outside the frame, all around it, a drag turns it, as in Photoshop
    const out = Math.hypot(Math.max(0, Math.abs(lx) - hw), Math.max(0, Math.abs(ly) - hh)) * App().view().zoom;
    if (out <= (event.pointerType === "touch" ? 30 : 22)) return "rotate";
    return null;
  };

  const hover = (event, point) => {
    const stage = $("stage");
    if (!stage) return;
    const over = session ? hit(event, point) : null;
    stage.style.cursor = over ? CURSOR[over] || "" : "crosshair";
  };

  // A press: on a handle, the outline or the bubble, a drag begins; elsewhere, the bubble
  // being shaped lands and the one under the press is taken
  const down = (event, point, base) => {
    const s = session;
    const over = s && app.doc === s.doc ? hit(event, point) : null;
    if (!over) {
      if (s) commit();
      begin(point[0], point[1]);
      return null;
    }
    const from = clone(s.params);
    const g = Object.assign(base, { kind: "reshape", mode: over, from });
    if (over === "pull") {
      const b = s.params.box;
      const [lx, ly] = toFrame(s.params, point[0], point[1]);
      const pull = {
        u: 0.5 + lx / Math.max(1, b.right - b.left),
        v: 0.5 + ly / Math.max(1, b.bottom - b.top),
        dx: 0,
        dy: 0,
        r: Math.max(12, Math.min(b.right - b.left, b.bottom - b.top) * (event.altKey ? 0.14 : 0.3)),
      };
      s.params.pulls.push(pull);
      g.pull = pull;
    }
    return g;
  };

  const MIN = 16;
  const move = (current, event, point) => {
    const s = session;
    if (!s) return;
    const { from, mode, start } = current;
    const dx = point[0] - start[0];
    const dy = point[1] - start[1];
    // The same move in the frame's own directions, for its sides and the pulls
    const a = -(from.angle || 0);
    const ldx = dx * Math.cos(a) - dy * Math.sin(a);
    const ldy = dx * Math.sin(a) + dy * Math.cos(a);
    if (mode === "rotate") {
      const b = from.box;
      const cx = (b.left + b.right) / 2;
      const cy = (b.top + b.bottom) / 2;
      let angle = (from.angle || 0) + Math.atan2(point[1] - cy, point[0] - cx) - Math.atan2(start[1] - cy, start[0] - cx);
      angle = Math.atan2(Math.sin(angle), Math.cos(angle));
      // Shift: 15° steps
      if (event.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
      s.params.angle = angle;
    } else if (mode === "move") {
      s.params.box = { left: from.box.left + dx, top: from.box.top + dy, right: from.box.right + dx, bottom: from.box.bottom + dy };
    } else if (mode === "tip") {
      s.params.tip = [point[0], point[1]];
    } else if (mode === "pull") {
      current.pull.dx = ldx;
      current.pull.dy = ldy;
    } else {
      // A side or a corner, as the Crop tool's: Shift keeps the proportions, Alt from the middle.
      // Worked out in the frame's own directions, then turned back onto the page.
      const ob = from.box;
      const ow = (ob.right - ob.left) / 2;
      const oh = (ob.bottom - ob.top) / 2;
      const b = { left: -ow, right: ow, top: -oh, bottom: oh };
      const dx = ldx;
      const dy = ldy;
      const west = mode.includes("w");
      const east = mode.includes("e");
      const north = mode.includes("n");
      const south = mode.includes("s");
      const middle = event.altKey;
      let left = b.left;
      let right = b.right;
      let top = b.top;
      let bottom = b.bottom;
      if (west) left = Math.min(b.left + dx, b.right - MIN);
      if (east) right = Math.max(b.right + dx, b.left + MIN);
      if (north) top = Math.min(b.top + dy, b.bottom - MIN);
      if (south) bottom = Math.max(b.bottom + dy, b.top + MIN);
      if (middle) {
        if (west) right = b.right + (b.left - left);
        if (east) left = b.left - (right - b.right);
        if (north) bottom = b.bottom + (b.top - top);
        if (south) top = b.top - (bottom - b.bottom);
      }
      if (event.shiftKey && (west || east) && (north || south)) {
        const ratio = (b.right - b.left) / Math.max(1, b.bottom - b.top);
        const w = right - left;
        const h = bottom - top;
        if (w / h > ratio) {
          const nh = w / ratio;
          if (north && !middle) top = bottom - nh;
          else if (south && !middle) bottom = top + nh;
          else {
            const cy = (top + bottom) / 2;
            top = cy - nh / 2;
            bottom = cy + nh / 2;
          }
        } else {
          const nw = h * ratio;
          if (west && !middle) left = right - nw;
          else if (east && !middle) right = left + nw;
          else {
            const cx = (left + right) / 2;
            left = cx - nw / 2;
            right = cx + nw / 2;
          }
        }
      }
      // The frame's middle moves in its own directions, turned onto the page
      const mx = (left + right) / 2;
      const my = (top + bottom) / 2;
      const turn = from.angle || 0;
      const cx = (ob.left + ob.right) / 2 + mx * Math.cos(turn) - my * Math.sin(turn);
      const cy = (ob.top + ob.bottom) / 2 + mx * Math.sin(turn) + my * Math.cos(turn);
      const hw = (right - left) / 2;
      const hh = (bottom - top) / 2;
      s.params.box = { left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh };
    }
    show(true);
    if (mode === "rotate") App().renderOptions();
  };
  const up = (current, event, point, cancelled) => {
    const s = session;
    if (!s) return;
    if (cancelled) s.params = clone(current.from);
    else if (current.mode === "pull" && Math.hypot(current.pull.dx, current.pull.dy) < 0.5) s.params.pulls.pop();
    // The bubble as it will be, its inside shaded, now that the handle is let go
    show();
    App().renderOptions();
  };

  /* ------------------------------ the options bar ------------------------------ */

  const button = (label, run, main) => {
    const press = document.createElement("button");
    press.type = "button";
    press.className = main ? "btn btn--small btn--main" : "btn btn--small";
    press.textContent = T(label);
    press.addEventListener("click", () => {
      press.blur();
      run();
    });
    return press;
  };
  const choice = (label, options, value, pick) => {
    const select = document.createElement("select");
    options.forEach(([key, text]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = T(text);
      select.appendChild(option);
    });
    select.value = value;
    select.addEventListener("change", () => {
      select.blur();
      pick(select.value);
    });
    const wrap = document.createElement("label");
    const span = document.createElement("span");
    span.style.color = "var(--muted)";
    span.textContent = T(label);
    wrap.append(span, select);
    return wrap;
  };
  const KINDS = [["smooth", "Round"], ["corners", "Keep corners"], ["pattern", "Clouds and spikes"]];
  const options = (bar) => {
    const s = session && app.doc === session.doc ? session : null;
    if (!s) {
      const hint = document.createElement("span");
      hint.style.color = "var(--muted)";
      hint.textContent = T("Click a bubble to reshape it.");
      bar.appendChild(hint);
      bar.appendChild(choice("Uncovered page", BEHIND, behind(), (value) => {
        settings.behind = value;
        keepSettings();
      }));
      return;
    }
    bar.appendChild(choice("Shape", KINDS, s.params.kind, (value) => {
      if (!session) return;
      session.params.kind = value;
      show();
    }));
    // The turn, in degrees, as Free Transform's
    const degrees = Math.round(((s.params.angle || 0) * 180) / Math.PI * 10) / 10;
    bar.appendChild(App().scrubbed(T("Angle"), App().numberInput(degrees, -180, 180, (value) => {
      if (!session) return;
      session.params.angle = (Math.max(-180, Math.min(180, Number(value) || 0)) * Math.PI) / 180;
      show();
    })));
    const fit = button("Fit to text", fitText);
    fit.disabled = !textsOver(s);
    bar.appendChild(fit);
    bar.appendChild(choice("Uncovered page", BEHIND, behind(), (value) => {
      settings.behind = value;
      keepSettings();
    }));
    bar.appendChild(button("Reset", () => {
      if (!session) return;
      session.params = clone(R.startParams(session.model));
      show();
      App().renderOptions();
    }));
    bar.appendChild(button("Cancel", cancel));
    bar.appendChild(button("Apply", commit, true));
  };
  const BEHIND = [["generative", "Generative Fill"], ["content", "Content-Aware Fill"], ["select", "Select it to redraw"]];

  /* ------------------------------ the rest of the app ------------------------------ */

  // Another tool: the bubble lands if it was changed
  const toolChosen = (tool) => {
    if (tool !== "reshape" && session) commit();
    const stage = $("stage");
    if (stage && tool === "reshape") stage.style.cursor = "crosshair";
    drawOverlay();
  };

  PS.on((type) => {
    const s = session;
    if (!s) return;
    // Another page, or a change made meanwhile (an undo): the shaping stops
    if (type === "document" && app.doc !== s.doc) {
      if (s.doc.extra) s.doc.extra = null;
      session = null;
      if (App()) App().renderOptions();
    } else if (type === "history" && s.doc.state !== s.state) {
      if (s.doc.extra) s.doc.extra = null;
      session = null;
      PS.announce("render");
      if (App()) App().renderOptions();
    }
    if (type === "render" || type === "view" || type === "document" || type === "history") drawOverlay();
  });

  // Enter lays the bubble, Escape forgets it, before the app sees either
  window.addEventListener("keydown", (event) => {
    if (!session || app.tool !== "reshape" || event.target.closest("input, textarea, select, [contenteditable]")) return;
    if (document.querySelector(".modal[open], dialog[open]")) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  }, true);

  window.TypeRReshapeTool = {
    down,
    move,
    up,
    hover,
    options,
    toolChosen,
    drawOverlay,
    commit,
    cancel,
    fitText,
    setBehind(value) {
      settings.behind = value;
      keepSettings();
    },
    busy: () => Boolean(session),
    session: () => session,
    begin,
  };
})();
