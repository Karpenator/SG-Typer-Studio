// Two retouching tools around photoshop.js's work: the Spot Healing Brush (Shift+J) and the
// Gradient tool (G). This file is what the person sees and does: the strokes waiting to be
// healed, the gradient's ends that stay draggable once it is drawn, and the options bar.
//
// The Spot Healing Brush paints where to heal, and each stroke is filled from what surrounds
// it by the Content-Aware Fill engine (inpaint.js), in a worker: the next stroke can be painted
// while one is healing. With no pixel layer active it heals on TypeR Clean, under the texts.
//
// The Gradient tool goes further than Photoshop's in a few places a typesetter meets every day:
// - on a text or an SFX, it goes on a new layer clipped to it: the letters take the gradient,
//   their stroke keeps its colour, and the text stays editable;
// - "Match the page" takes its colours from the page itself, along the drag, from the band
//   just outside the selection: drag across a gradient bubble, its text selected, and the
//   bubble's own gradient is drawn again under the text;
// - once drawn, its ends can still be dragged and its options changed, until Enter, another
//   gradient or another tool: one step of history for all of it;
// - it is dithered, so a long soft gradient shows no bands.
(function () {
  "use strict";

  const PS = window.TypeRPhotoshop;
  if (!PS) return;
  const { app, ops } = PS;
  const App = () => window.TypeRApp;
  const T = (text) => (window.TypeRApp ? window.TypeRApp.T(text) : text);
  const SVGNS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const touch = () => Boolean(window.TypeRShell && window.TypeRShell.touch);

  const svgEl = (tag, attributes, parent) => {
    const el = document.createElementNS(SVGNS, tag);
    Object.keys(attributes).forEach((key) => el.setAttribute(key, attributes[key]));
    if (parent) parent.appendChild(el);
    return el;
  };
  const redraw = () => App().schedule(false);

  /* ------------------------------ settings ------------------------------ */

  const STORE = "typer.web.retouch";
  const prefs = (() => {
    const out = { healAll: true, colors: "fgbg", custom: null, type: "linear", method: "perceptual", opacity: 100, reverse: false, dither: true };
    try {
      Object.assign(out, JSON.parse(window.localStorage.getItem(STORE)) || {});
    } catch (error) {
      // Defaults
    }
    return out;
  })();
  const keepPrefs = () => {
    try {
      window.localStorage.setItem(STORE, JSON.stringify(prefs));
    } catch (error) {
      // Only a preference
    }
  };

  /* -------------------------- the Spot Healing Brush -------------------------- */

  // Strokes waiting their turn, healed one after the other, each on the page the last one left
  const jobs = [];
  let healing = false;
  // Where the last stroke ended: Shift + click heals a straight line from there
  let lastHeal = null;
  const healGroup = svgEl("g", { class: "heal-strokes" });
  const overDoc = $("over-doc");
  if (overDoc) overDoc.appendChild(healGroup);

  const OUTCOMES = {
    none: "Nothing to heal from here.",
    hidden: "Healed, but on a hidden layer. Show it in the Layers panel to see the result.",
  };
  const runHeals = async () => {
    if (healing) return;
    healing = true;
    while (jobs.length) {
      const job = jobs[0];
      job.state = "working";
      redraw();
      const started = performance.now();
      try {
        const outcome = await ops.spotHeal({ doc: job.doc, layerId: job.layerId, points: job.points, size: job.size, sampleAll: job.sampleAll }, (fraction) => {
          // Only a long one says how far it is
          if (performance.now() - started > 700) App().working(`${T("Spot Healing…")} ${Math.round(fraction * 100)}%`);
        });
        if (OUTCOMES[outcome]) App().toast(T(OUTCOMES[outcome]), outcome === "hidden");
      } catch (error) {
        console.warn("SG Typer Studio: the Spot Healing Brush failed", error);
        App().toast(T("The healing didn't go through."), true);
      }
      App().working(null);
      jobs.shift();
      redraw();
    }
    healing = false;
  };

  const healDown = (event, point, base) => {
    if (App().pixelsOnly()) return null;
    const layer = App().activeLayer();
    if (layer && layer.kind === "raster" && !layer.adjustment && PS.lockOf(layer, "pixels")) {
      App().toast(T("This layer is locked."));
      return null;
    }
    const line = event.shiftKey && lastHeal && lastHeal.doc === app.doc;
    return Object.assign(base, { kind: "retouch", tool: "heal", points: line ? [lastHeal.point, point] : [point], size: app.brush.size, slop: 0 });
  };
  const healMove = (gesture, event) => {
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    const zoom = App().view().zoom;
    (events.length ? events : [event]).forEach((item) => {
      const p = App().toDoc(item);
      const last = gesture.points[gesture.points.length - 1];
      // A pixel on screen apart is enough: the heal follows the shape, not every tremor
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) * zoom >= 1) gesture.points.push(p);
    });
    redraw();
  };
  const healUp = (gesture, cancelled) => {
    redraw();
    if (cancelled || !app.doc) return;
    const layer = App().activeLayer();
    const onPixels = layer && layer.kind === "raster" && !layer.adjustment;
    jobs.push({ doc: app.doc, points: gesture.points, size: gesture.size, layerId: onPixels ? layer.id : null, sampleAll: prefs.healAll || !onPixels, state: "waiting" });
    lastHeal = { doc: app.doc, point: gesture.points[gesture.points.length - 1] };
    runHeals();
  };
  // The strokes on the page, dark as in Photoshop, until they are healed
  const drawHeals = (gesture) => {
    healGroup.textContent = "";
    const shown = jobs.filter((job) => job.doc === app.doc);
    if (gesture && gesture.kind === "retouch" && gesture.tool === "heal") shown.push({ points: gesture.points, size: gesture.size, state: "live" });
    shown.forEach((job) => {
      const [first, ...rest] = job.points;
      const d = `M${first[0]} ${first[1]}` + (rest.length ? rest.map((p) => `L${p[0]} ${p[1]}`).join("") : "l0.01 0");
      svgEl("path", { class: `heal-stroke is-${job.state}`, d, "stroke-width": job.size }, healGroup);
    });
  };

  /* ------------------------------ the Gradient tool ------------------------------ */

  const COLORS = [
    ["fgbg", "Foreground to Background"],
    ["fgClear", "Foreground to Transparent"],
    ["bw", "Black to White"],
    ["page", "Match the page"],
  ];
  const TYPES = [
    ["linear", "Linear"],
    ["radial", "Radial"],
    ["angle", "Angle"],
    ["reflected", "Reflected"],
    ["diamond", "Diamond"],
  ];
  const METHODS = [
    ["perceptual", "Perceptual"],
    ["linear", "Linear"],
    ["classic", "Classic"],
  ];
  const stop = (at, c, a = 1) => ({ at, r: c.r, g: c.g, b: c.b, a });
  const BLACK = { r: 0, g: 0, b: 0 };
  const WHITE = { r: 255, g: 255, b: 255 };

  // Its own colours ("custom"), apart from the foreground and background colours: its two ends
  // changed in the options bar, or any number of colours, each with its opacity, in the
  // Gradient Editor. They can be kept as presets.
  const STORE_PRESETS = "typer.web.gradients";
  const MAX_PRESETS = 40;
  const unit = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const byte = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  // A copy of `stops`, each one checked: what was kept may come from an older version
  const cleanStops = (stops) => (Array.isArray(stops) ? stops : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ at: unit(item.at), r: byte(item.r), g: byte(item.g), b: byte(item.b), a: item.a === undefined ? 1 : unit(item.a) }));
  const sorted = (stops) => stops.slice().sort((a, b) => a.at - b.at);
  const sameStops = (a, b) => {
    if (a.length !== b.length) return false;
    const x = sorted(a);
    const y = sorted(b);
    return x.every((item, i) => ["r", "g", "b"].every((key) => item[key] === y[i][key]) && Math.abs(item.at - y[i].at) < 1e-3 && Math.abs(item.a - y[i].a) < 1e-3);
  };
  const toHex = (c) => `#${[c.r, c.g, c.b].map((value) => byte(value).toString(16).padStart(2, "0")).join("")}`;
  const fromHex = (hex) => {
    const n = parseInt(String(hex).slice(1, 7), 16) || 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  // The colour between two of them, for a colour added there
  const colorAt = (stops, at) => {
    const list = sorted(stops);
    let i = 0;
    while (i < list.length - 1 && list[i + 1].at < at) i++;
    const a = list[i];
    const b = list[Math.min(i + 1, list.length - 1)];
    const f = b.at > a.at ? Math.max(0, Math.min(1, (at - a.at) / (b.at - a.at))) : 0;
    const mix = (key) => a[key] + (b[key] - a[key]) * f;
    return { at, r: byte(mix("r")), g: byte(mix("g")), b: byte(mix("b")), a: unit(mix("a")) };
  };
  const customStops = () => {
    const stops = cleanStops(prefs.custom);
    return stops.length >= 2 ? stops : [stop(0, BLACK), stop(1, WHITE)];
  };
  const readPresets = () => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORE_PRESETS));
      return (Array.isArray(saved) ? saved : [])
        .filter((item) => item && typeof item.name === "string" && cleanStops(item.stops).length >= 2)
        .map((item) => ({ name: item.name, stops: sorted(cleanStops(item.stops)) }));
    } catch (error) {
      return [];
    }
  };
  const keepPresets = (list) => {
    try {
      window.localStorage.setItem(STORE_PRESETS, JSON.stringify(list.slice(0, MAX_PRESETS)));
    } catch (error) {
      App().toast(T("The preset couldn't be saved."), true);
    }
  };
  // The page's pixels before this gradient, read once: a gradient over the page must not be
  // matched to itself while its ends move
  let pageData = null;
  const stopsFor = (colors, start, end, page) => {
    if (colors === "fgClear") return [stop(0, app.fg), stop(1, app.fg, 0)];
    if (colors === "bw") return [stop(0, BLACK), stop(1, WHITE)];
    if (colors === "custom") return customStops();
    if (colors === "page") {
      const spec = { type: prefs.type, start, end };
      const along = ops.pageStops(spec, 10, page);
      if (along) return along;
      const a = ops.pageColor(start[0], start[1], 3, page) || app.fg;
      const b = ops.pageColor(end[0], end[1], 3, page) || app.bg;
      return [stop(0, a), stop(1, b)];
    }
    return [stop(0, app.fg), stop(1, app.bg)];
  };
  const specFor = (start, end, page) => ({ type: prefs.type, start, end, stops: stopsFor(prefs.colors, start, end, page), method: prefs.method, reverse: prefs.reverse, opacity: prefs.opacity / 100, dither: prefs.dither });

  // Where the gradient goes: the targeted mask or the Quick Mask, the active pixel layer, or a
  // new layer, clipped to the text or SFX that is active
  const whereNow = () => {
    const painting = App().maskPainting();
    if (painting && painting.target === "vector") {
      App().toast(T("This is a vector mask: rasterize it to paint on it (Layer > Vector Mask > Rasterize)."));
      return null;
    }
    if (painting) return painting.target === "quick" ? { kind: "quick" } : { kind: "mask", id: painting.id };
    const sfx = window.TypeRSFX && window.TypeRSFX.activeSfx && window.TypeRSFX.activeSfx();
    if (sfx) return { kind: "clip", id: sfx.id };
    const layer = App().activeLayer();
    if (layer && layer.kind === "raster" && !layer.adjustment) {
      if (PS.lockOf(layer, "pixels")) {
        App().toast(T("This layer is locked."));
        return null;
      }
      return { kind: "layer", id: layer.id };
    }
    if (layer && (layer.kind === "text" || layer.kind === "group")) return { kind: "clip", id: layer.id };
    return { kind: "new" };
  };

  // The gradient just drawn, whose ends can still be dragged: { edit, start, end, page }
  let live = null;
  // A gradient's drag under way, from the button going down to it coming up
  let dragging = false;
  let tokens = 0;
  let toldClip = false;
  const liveNow = () => {
    if (live && (!app.doc || !ops.gradientLive(live.edit))) live = null;
    return live;
  };
  const endLive = () => {
    if (!live) return;
    live = null;
    pageData = null;
    redraw();
    App().renderOptions();
  };

  // With Shift, the drag turns by steps of 45°
  const aimed = (from, to, event) => {
    if (!event.shiftKey) return to;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const length = Math.hypot(dx, dy);
    return [from[0] + Math.cos(angle) * length, from[1] + Math.sin(angle) * length];
  };
  const tell = (start, end, event) => {
    const angle = Math.round((-Math.atan2(end[1] - start[1], end[0] - start[0]) * 180) / Math.PI);
    App().hud(`${angle}° · ${Math.round(Math.hypot(end[0] - start[0], end[1] - start[1]))} px`, event);
  };

  // Drawn once a frame at most, small while the pointer moves, at full size when it stops
  let frame = 0;
  let pending = null;
  const draw = (gesture, quick) => {
    const spec = specFor(gesture.start, gesture.end, gesture.page);
    const result = ops.drawGradient({ spec, where: gesture.where, edit: gesture.edit, token: gesture.token, quick, name: T("Gradient") });
    if (result) gesture.edit = result;
    else if (gesture.edit) gesture.lost = true;
    if (result && result.made && gesture.where && gesture.where.kind === "clip" && !toldClip) {
      toldClip = true;
      App().toast(T("The gradient is on a new layer clipped to the text: the letters take it, the stroke keeps its colour."), true);
    }
    redraw();
  };
  const drawSoon = (gesture) => {
    pending = gesture;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const g = pending;
      pending = null;
      if (g && !g.lost) draw(g, true);
    });
  };
  const flush = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
  };

  const HANDLE_REACH = () => (touch() ? 18 : 9);
  const handleAt = (event) => {
    const current = liveNow();
    if (!current) return null;
    const stage = $("stage").getBoundingClientRect();
    const x = event.clientX - stage.left;
    const y = event.clientY - stage.top;
    const near = (p) => {
      const [sx, sy] = App().toScreen(p[0], p[1]);
      return Math.hypot(sx - x, sy - y) <= HANDLE_REACH();
    };
    if (near(current.end)) return "end";
    if (near(current.start)) return "start";
    if (near([(current.start[0] + current.end[0]) / 2, (current.start[1] + current.end[1]) / 2])) return "move";
    return null;
  };

  const gradientDown = (event, point, base) => {
    const handle = handleAt(event);
    if (handle) {
      dragging = true;
      return Object.assign(base, { kind: "retouch", tool: "gradient", mode: handle, from: { start: live.start.slice(), end: live.end.slice() }, x0: point[0], y0: point[1], start: live.start.slice(), end: live.end.slice(), edit: live.edit, token: live.edit.token, where: live.edit.where, page: live.page, slop: 0 });
    }
    endLive();
    const where = whereNow();
    if (!where) return null;
    tokens++;
    const page = prefs.colors === "page" ? ops.pageData() : null;
    dragging = true;
    return Object.assign(base, { kind: "retouch", tool: "gradient", mode: "new", start: point, end: point, where, edit: null, token: `gesture:gradient:${Date.now()}:${tokens}`, page });
  };
  const gradientMove = (gesture, event, point) => {
    if (gesture.mode === "new") {
      if (!gesture.moved) return;
      gesture.end = aimed(gesture.start, point, event);
    } else if (gesture.mode === "move") {
      const dx = point[0] - gesture.x0;
      const dy = point[1] - gesture.y0;
      gesture.start = [gesture.from.start[0] + dx, gesture.from.start[1] + dy];
      gesture.end = [gesture.from.end[0] + dx, gesture.from.end[1] + dy];
    } else if (gesture.mode === "start") gesture.start = aimed(gesture.end, point, event);
    else gesture.end = aimed(gesture.start, point, event);
    tell(gesture.start, gesture.end, event);
    drawSoon(gesture);
  };
  const gradientUp = (gesture, event, point, cancelled) => {
    dragging = false;
    flush();
    App().hud(null);
    if (gesture.mode === "new" && !cancelled && gesture.moved && point && event) gesture.end = aimed(gesture.start, point, event);
    const short = Math.hypot(gesture.end[0] - gesture.start[0], gesture.end[1] - gesture.start[1]) < 1;
    if (gesture.mode === "new" && (cancelled || !gesture.moved || short)) {
      // A click alone draws nothing; a drag let go of takes back what it drew
      if (gesture.edit && !gesture.lost && ops.gradientLive(gesture.edit)) ops.undo();
      redraw();
      return;
    }
    if (cancelled) {
      gesture.start = gesture.from.start;
      gesture.end = gesture.from.end;
    }
    if (gesture.lost) {
      redraw();
      return;
    }
    draw(gesture, false);
    if (gesture.lost) return;
    live = { edit: gesture.edit, start: gesture.start, end: gesture.end, page: gesture.page };
    App().renderOptions();
  };
  // The live gradient again, with the options as they are now. `quick`: smaller, while a
  // colour of the Gradient Editor is dragged.
  let liveFrame = 0;
  const redrawLive = (quick = false) => {
    if (liveFrame) cancelAnimationFrame(liveFrame);
    liveFrame = 0;
    const current = liveNow();
    if (!current) return;
    if (prefs.colors === "page" && !current.page) current.page = ops.pageData(current.edit);
    const gesture = { start: current.start, end: current.end, where: current.edit.where, edit: current.edit, token: current.edit.token, page: current.page };
    draw(gesture, quick);
    if (gesture.lost) endLive();
    else current.edit = gesture.edit;
  };
  const redrawLiveSoon = () => {
    if (liveFrame) return;
    liveFrame = requestAnimationFrame(() => {
      liveFrame = 0;
      redrawLive(true);
    });
  };

  // Its line and its ends, on the screen
  const drawGradientMarks = (parent, gesture) => {
    let start;
    let end;
    if (gesture && gesture.kind === "retouch" && gesture.tool === "gradient") {
      if (gesture.mode === "new" && !gesture.moved) return;
      ({ start, end } = gesture);
    } else {
      const current = liveNow();
      if (!current || app.tool !== "gradient") return;
      ({ start, end } = current);
    }
    const a = App().toScreen(start[0], start[1]);
    const b = App().toScreen(end[0], end[1]);
    const d = `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
    svgEl("path", { class: "grad-line grad-line--under", d }, parent);
    svgEl("path", { class: "grad-line", d }, parent);
    const r = touch() ? 7 : 5;
    svgEl("circle", { class: "grad-end grad-end--start", cx: a[0], cy: a[1], r }, parent);
    svgEl("circle", { class: "grad-end", cx: b[0], cy: b[1], r }, parent);
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const m = r * 0.8;
    svgEl("path", { class: "grad-mid", d: `M${mx} ${my - m}L${mx + m} ${my}L${mx} ${my + m}L${mx - m} ${my}Z` }, parent);
  };

  /* ------------------------------ the options bar ------------------------------ */

  const button = (className, title, on, action) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className + (on ? " is-on" : "");
    el.title = title;
    el.setAttribute("aria-label", title);
    el.setAttribute("aria-pressed", String(Boolean(on)));
    el.addEventListener("click", action);
    return el;
  };
  // A small picture of a gradient, drawn by the engine that draws the real one. `plain`: as
  // its colours are placed, not reversed (the Gradient Editor's bar).
  const preview = (width, height, type, stops, plain = false) => {
    const centred = type !== "linear";
    const start = centred ? [width / 2, height / 2] : [1, height / 2];
    const end = centred ? [width - 1, height / 2] : [width - 1, height / 2];
    const { canvas } = PS.renderGradient({ type, start, end, stops, method: prefs.method, reverse: !plain && prefs.reverse, opacity: 1, dither: false }, { left: 0, top: 0, width, height });
    canvas.className = "grad-preview";
    return canvas;
  };
  const changed = (key, value) => {
    prefs[key] = value;
    keepPrefs();
    App().renderOptions();
    redrawLive();
    if (editor) syncEditor();
  };
  const select = (label, options, value, onChange) => {
    const el = document.createElement("select");
    options.forEach(([id, text]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = T(text);
      el.appendChild(option);
    });
    el.value = value;
    el.addEventListener("change", () => {
      el.blur();
      onChange(el.value);
    });
    const wrap = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = label;
    wrap.append(name, el);
    return wrap;
  };
  const hint = (text) => {
    const el = document.createElement("span");
    el.className = "obar__hint";
    el.textContent = text;
    return el;
  };
  const make = (tag, className, parent, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  };

  /* --------------------------- the gradient's own colours --------------------------- */

  // The colours the ends and the Gradient Editor change, as the gradient has them now: the
  // foreground and background colours, or those of the page along the gradient just drawn
  const currentStops = () => {
    if (prefs.colors === "page") {
      const current = liveNow();
      if (!current) return [stop(0, BLACK), stop(1, WHITE)];
      if (!current.page) current.page = ops.pageData(current.edit);
      return sorted(cleanStops(stopsFor("page", current.start, current.end, current.page)));
    }
    return sorted(cleanStops(stopsFor(prefs.colors, [0, 0], [1, 0], null)));
  };
  // The gradient takes these colours as its own. `quick`: a colour being dragged, the
  // gradient on the page drawn smaller until it is let go.
  const useStops = (stops, { quick = false, fromEditor = false } = {}) => {
    prefs.colors = "custom";
    prefs.custom = sorted(cleanStops(stops));
    if (!quick) keepPrefs();
    showCurrent();
    if (quick) redrawLiveSoon();
    else redrawLive();
    if (editor && !fromEditor) syncEditor();
  };
  const choosePreset = (preset) => {
    useStops(preset.stops);
    App().renderOptions();
  };
  // A colour field, tried out as the picker moves. Brought back to its first colour (the
  // picker's Cancel), the gradient has the colours it had before.
  const colorField = (title, value, onPick, onBack) => {
    const input = document.createElement("input");
    input.type = "color";
    input.title = title;
    input.setAttribute("aria-label", title);
    input.value = value;
    let before = null;
    input.addEventListener("input", () => {
      if (!before) before = { value, colors: prefs.colors, custom: prefs.custom ? cleanStops(prefs.custom) : null };
      if (input.value === before.value) {
        prefs.colors = before.colors;
        prefs.custom = before.custom;
        before = null;
        keepPrefs();
        onBack();
        return;
      }
      onPick(fromHex(input.value));
    });
    input.addEventListener("change", () => {
      before = null;
      value = input.value;
      App().renderOptions();
    });
    return input;
  };
  // In the options bar: the gradient's first and last colours, each a click from the picker
  const endField = (last) => {
    const pick = (stops) => (last ? stops[stops.length - 1] : stops[0]);
    let base = null;
    const input = colorField(T(last ? "End Color" : "Start Color"), toHex(pick(currentStops())), (color) => {
      if (!base) base = currentStops();
      const stops = cleanStops(base);
      Object.assign(pick(stops), color);
      useStops(stops);
    }, () => {
      base = null;
      showCurrent();
      redrawLive();
      if (editor) syncEditor();
    });
    input.classList.add("grad-end-color");
    input.addEventListener("change", () => {
      base = null;
    });
    return input;
  };
  // The options bar's picture of the gradient, and its ends, as its colours change
  const NEUTRAL = [stop(0, { r: 92, g: 136, b: 184 }), stop(1, { r: 236, g: 214, b: 236 })];
  const currentPicture = () => {
    const stops = prefs.colors === "page" && !liveNow() ? NEUTRAL : currentStops();
    return preview(46, 16, "linear", stops);
  };
  const showCurrent = () => {
    const shown = document.querySelector(".grad-current");
    if (shown) {
      const old = shown.querySelector(".grad-preview");
      if (old) old.replaceWith(currentPicture());
    }
    const stops = currentStops();
    document.querySelectorAll(".grad-end-color").forEach((input) => {
      if (input.closest(".grad-own")) input.value = toHex(input.dataset.end === "last" ? stops[stops.length - 1] : stops[0]);
    });
  };

  /* ------------------------------ the Gradient Editor ------------------------------ */

  // Beside the page, not over it: a gradient can be drawn while it is open, and it changes as
  // its colours do. Alt + click on the page gives the colour chosen the page's colour there.
  let editor = null;
  const closeEditor = () => {
    if (!editor) return;
    const was = editor;
    editor = null;
    was.el.remove();
    document.removeEventListener("pointerdown", was.outside, true);
    window.removeEventListener("resize", was.away);
    window.removeEventListener("keydown", was.escape);
    const anchor = document.querySelector(".grad-current");
    if (anchor) anchor.setAttribute("aria-expanded", "false");
  };
  // Its colours again from the gradient's, changed from elsewhere
  const syncEditor = () => {
    if (!editor) return;
    editor.stops = currentStops();
    editor.chosen = Math.min(editor.chosen, editor.stops.length - 1);
    editor.render();
  };
  const openEditor = (anchor) => {
    closeEditor();
    const el = make("div", "grad-editor");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", T("Gradient Editor"));
    const state = { el, stops: currentStops(), chosen: 0, removing: null };
    editor = state;
    const effective = () => state.stops.filter((item) => item !== state.removing);
    // The fields stay as they are, their values changed in place: one being scrubbed must stay
    const edited = (quick) => {
      useStops(effective(), { quick, fromEditor: true });
      showRamp();
      showPresets();
      refreshFields();
    };

    const head = make("div", "grad-editor__head", el);
    make("span", "", head, T("Gradient Editor"));
    const shut = make("button", "icon-btn", head);
    shut.type = "button";
    shut.title = T("Close");
    shut.setAttribute("aria-label", shut.title);
    shut.innerHTML = App().ICON.close;
    shut.addEventListener("click", closeEditor);

    make("div", "grad-editor__label", el, T("Presets"));
    const presets = make("div", "grad-editor__presets", el);

    const ramp = make("div", "grad-editor__ramp", el);
    const track = make("div", "grad-editor__track", el);
    track.title = T("Click to add a color. Drag a color down to remove it.");

    const fields = make("div", "grad-editor__fields", el);
    const saveRow = make("div", "grad-editor__save", el);
    const name = make("input", "", saveRow);
    name.type = "text";
    name.maxLength = 60;
    name.setAttribute("aria-label", T("Name"));
    const save = make("button", "btn", saveRow, T("Save as Preset"));
    save.type = "button";
    make("p", "grad-editor__hint", el, T("Click under the bar to add a color, drag one down off it to remove it. Alt + click on the page gives the selected color the page's color."));

    const defaultName = () => {
      const taken = new Set(readPresets().map((item) => item.name));
      let n = readPresets().length + 1;
      while (taken.has(`${T("Gradient")} ${n}`)) n++;
      return `${T("Gradient")} ${n}`;
    };
    const keep = () => {
      const label = name.value.trim() || defaultName();
      const list = readPresets().filter((item) => item.name !== label);
      list.push({ name: label, stops: sorted(cleanStops(effective())) });
      keepPresets(list);
      name.value = "";
      name.placeholder = defaultName();
      showPresets();
      App().renderOptions();
    };
    save.addEventListener("click", keep);
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        keep();
      }
    });

    const showPresets = () => {
      presets.textContent = "";
      COLORS.filter(([id]) => id !== "page").forEach(([id, label]) => {
        const el = button("grad-swatch", T(label), prefs.colors === id, () => {
          prefs.colors = id;
          keepPrefs();
          syncEditor();
          redrawLive();
          App().renderOptions();
        });
        el.appendChild(preview(34, 16, "linear", stopsFor(id, [0, 0], [1, 0], null), true));
        presets.appendChild(el);
      });
      const own = prefs.colors === "custom" ? customStops() : null;
      readPresets().forEach((preset) => {
        const item = make("span", "grad-editor__preset", presets);
        const el = button("grad-swatch", preset.name, Boolean(own && sameStops(own, preset.stops)), () => {
          choosePreset(preset);
          syncEditor();
        });
        el.appendChild(preview(34, 16, "linear", preset.stops, true));
        item.appendChild(el);
        const remove = make("button", "grad-editor__remove", item);
        remove.type = "button";
        remove.title = `${T("Delete Preset")} (${preset.name})`;
        remove.setAttribute("aria-label", remove.title);
        remove.innerHTML = App().ICON.close;
        remove.addEventListener("click", () => {
          keepPresets(readPresets().filter((other) => other.name !== preset.name));
          showPresets();
          App().renderOptions();
        });
      });
    };

    let shownFor = null;
    let inputs = null;
    const refreshFields = () => {
      const chosen = state.stops[state.chosen];
      if (!inputs || chosen !== shownFor) {
        showFields();
        return;
      }
      const set = (input, value) => {
        if (document.activeElement !== input) input.value = value;
      };
      set(inputs.color, toHex(chosen));
      set(inputs.opacity, Math.round(chosen.a * 100));
      set(inputs.place, Math.round(chosen.at * 100));
      inputs.remove.disabled = state.stops.length <= 2;
    };
    const showFields = () => {
      fields.textContent = "";
      const chosen = state.stops[state.chosen];
      shownFor = chosen || null;
      inputs = null;
      if (!chosen) return;
      const color = colorField(T("Color"), toHex(chosen), (picked) => {
        Object.assign(chosen, picked);
        edited(false);
      }, () => {
        syncEditor();
        showCurrent();
        redrawLive();
        App().renderOptions();
      });
      color.classList.add("grad-editor__color");
      fields.appendChild(color);
      const opacity = App().numberInput(Math.round(chosen.a * 100), 0, 100, (value) => {
        chosen.a = unit(value / 100);
        edited(false);
      });
      const withUnit = (label) => {
        const field = make("span", "grad-editor__field", fields);
        field.appendChild(label);
        make("span", "grad-editor__unit", field, "%");
      };
      withUnit(App().scrubbed(T("Opacity"), opacity));
      const place = App().numberInput(Math.round(chosen.at * 100), 0, 100, (value) => {
        chosen.at = unit(value / 100);
        edited(false);
      });
      withUnit(App().scrubbed(T("Location"), place));
      const remove = make("button", "icon-btn", fields);
      remove.type = "button";
      remove.title = T("Delete");
      remove.setAttribute("aria-label", remove.title);
      remove.innerHTML = App().ICON.trash;
      remove.disabled = state.stops.length <= 2;
      remove.addEventListener("click", () => removeChosen());
      inputs = { color, opacity, place, remove };
    };
    const removeChosen = () => {
      if (state.stops.length <= 2) return;
      state.stops.splice(state.chosen, 1);
      state.chosen = Math.min(state.chosen, state.stops.length - 1);
      edited(false);
      App().renderOptions();
    };
    const focusChosen = () => {
      const mark = track.querySelector(".grad-stop.is-on");
      if (mark) mark.focus({ preventScroll: true });
    };

    const showRamp = () => {
      ramp.textContent = "";
      ramp.appendChild(preview(332, 22, "linear", effective(), true));
      track.textContent = "";
      state.stops.forEach((item, i) => {
        const mark = make("button", "grad-stop" + (i === state.chosen ? " is-on" : "") + (item === state.removing ? " is-removing" : ""), track);
        mark.type = "button";
        mark.dataset.i = String(i);
        mark.style.left = `${item.at * 100}%`;
        mark.style.setProperty("--color", `rgba(${item.r}, ${item.g}, ${item.b}, ${item.a})`);
        mark.title = `${toHex(item)} · ${Math.round(item.a * 100)}% · ${Math.round(item.at * 100)}%`;
        mark.setAttribute("aria-label", `${T("Color")} ${i + 1}: ${mark.title}`);
        mark.setAttribute("aria-pressed", String(i === state.chosen));
      });
    };
    state.render = () => {
      showRamp();
      showFields();
      showPresets();
    };

    // A colour chosen, dragged along the bar, or down off it to remove it. Under the bar or on
    // it, a new colour, the gradient's own there.
    const grab = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const box = track.getBoundingClientRect();
      const along = (e) => unit((e.clientX - box.left) / box.width);
      const mark = event.target.closest(".grad-stop");
      let item;
      let moved = false;
      if (mark) {
        item = state.stops[Number(mark.dataset.i)];
        if (!item) return;
      } else {
        item = colorAt(state.stops, along(event));
        state.stops.push(item);
        moved = true;
      }
      state.chosen = state.stops.indexOf(item);
      if (moved) edited(true);
      else {
        showRamp();
        refreshFields();
      }
      focusChosen();
      const x0 = event.clientX;
      const holder = event.currentTarget;
      holder.setPointerCapture(event.pointerId);
      const move = (e) => {
        if (!moved && Math.abs(e.clientX - x0) < 3 && e.clientY - box.bottom < 24) return;
        moved = true;
        item.at = along(e);
        state.removing = state.stops.length > 2 && e.clientY - box.bottom > 24 ? item : null;
        edited(true);
      };
      const end = () => {
        holder.removeEventListener("pointermove", move);
        holder.removeEventListener("pointerup", end);
        holder.removeEventListener("pointercancel", end);
        if (!moved) return;
        if (state.removing) {
          state.stops = state.stops.filter((other) => other !== state.removing);
          state.removing = null;
          state.chosen = Math.min(state.chosen, state.stops.length - 1);
        } else state.chosen = state.stops.indexOf(item);
        edited(false);
        focusChosen();
        App().renderOptions();
      };
      holder.addEventListener("pointermove", move);
      holder.addEventListener("pointerup", end);
      holder.addEventListener("pointercancel", end);
    };
    track.addEventListener("pointerdown", grab);
    ramp.addEventListener("pointerdown", grab);

    // Its keys are its own: Delete removes the colour chosen, not the layer
    el.addEventListener("keydown", (event) => {
      if (event.metaKey || event.ctrlKey) return;
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
      } else if ((event.key === "Delete" || event.key === "Backspace") && event.target.closest(".grad-stop")) {
        event.preventDefault();
        removeChosen();
        focusChosen();
      } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && event.target.closest(".grad-stop")) {
        event.preventDefault();
        const item = state.stops[state.chosen];
        item.at = unit(item.at + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 0.1 : 0.01));
        edited(false);
        focusChosen();
      }
    });

    // Away from it, it closes, but not on the page or the options bar, nor in the colour
    // picker it opened
    state.outside = (event) => {
      if (el.contains(event.target) || (event.target.closest && event.target.closest("#options, dialog, #stage"))) return;
      closeEditor();
    };
    state.away = () => closeEditor();
    // Esc from a field of the options bar too, but not from the colour picker, which it cancels
    state.escape = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog[open]")) closeEditor();
    };
    name.placeholder = defaultName();
    state.render();
    document.body.appendChild(el);
    const box = anchor.getBoundingClientRect();
    const width = el.offsetWidth;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, box.left))}px`;
    if (window.innerHeight - box.bottom >= el.offsetHeight + 12 || box.top < el.offsetHeight + 12) el.style.top = `${box.bottom + 4}px`;
    else el.style.bottom = `${window.innerHeight - box.top + 4}px`;
    anchor.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", state.outside, true);
    window.addEventListener("keydown", state.escape);
    // On a touch screen the keyboard resizes the window
    if (!touch()) window.addEventListener("resize", state.away);
  };

  /* ------------------------------ the options bar ------------------------------ */

  const options = (bar) => {
    const tool = app.tool;
    if (tool === "heal") {
      bar.appendChild(App().checkbox(T("Sample all layers"), prefs.healAll, (on) => {
        prefs.healAll = on;
        keepPrefs();
      }));
      return;
    }
    if (tool !== "gradient") return;
    const colours = document.createElement("span");
    colours.className = "obar__group grad-swatches";
    COLORS.forEach(([id, name]) => {
      const stops = id === "page" ? NEUTRAL : stopsFor(id, [0, 0], [1, 0], null);
      const el = button("grad-swatch", T(name), prefs.colors === id, () => changed("colors", id));
      el.appendChild(preview(34, 16, "linear", stops));
      if (id === "page") {
        const mark = document.createElement("span");
        mark.className = "grad-swatch__mark";
        mark.innerHTML = App().ICON.eyedropper;
        el.appendChild(mark);
      }
      colours.appendChild(el);
    });
    bar.appendChild(colours);
    // The presets kept, a click away
    const saved = readPresets();
    if (saved.length) {
      const kept = document.createElement("span");
      kept.className = "obar__group grad-swatches grad-presets";
      const own = prefs.colors === "custom" ? customStops() : null;
      saved.forEach((preset) => {
        const el = button("grad-swatch", preset.name, Boolean(own && sameStops(own, preset.stops)), () => choosePreset(preset));
        el.appendChild(preview(34, 16, "linear", preset.stops));
        kept.appendChild(el);
      });
      bar.appendChild(kept);
    }
    // Its own colours: its ends, and the Gradient Editor for the rest
    const own = document.createElement("span");
    own.className = "obar__group grad-own";
    const withEnds = prefs.colors !== "page" || Boolean(liveNow());
    const first = withEnds ? endField(false) : null;
    const last = withEnds ? endField(true) : null;
    if (first) first.dataset.end = "first";
    if (last) last.dataset.end = "last";
    const edit = button("grad-current", T("Gradient Editor"), prefs.colors === "custom", () => {
      if (editor) closeEditor();
      else openEditor(edit);
    });
    edit.setAttribute("aria-haspopup", "dialog");
    edit.setAttribute("aria-expanded", String(Boolean(editor)));
    edit.appendChild(currentPicture());
    const caret = document.createElement("span");
    caret.className = "grad-current__caret";
    caret.innerHTML = App().ICON.chevronDown;
    edit.appendChild(caret);
    // Reversed, the ends are shown the way the gradient goes
    const ends = prefs.reverse ? [last, first] : [first, last];
    if (ends[0]) own.appendChild(ends[0]);
    own.appendChild(edit);
    if (ends[1]) own.appendChild(ends[1]);
    bar.appendChild(own);

    const kinds = document.createElement("span");
    kinds.className = "obar__group";
    const shown = prefs.colors === "page" ? [stop(0, BLACK), stop(1, WHITE)] : stopsFor(prefs.colors === "fgClear" ? "fgbg" : prefs.colors, [0, 0], [1, 0], null);
    TYPES.forEach(([id, name]) => {
      const el = button("grad-type", T(name), prefs.type === id, () => changed("type", id));
      el.appendChild(preview(18, 18, id, shown));
      kinds.appendChild(el);
    });
    const opacity = App().numberInput(prefs.opacity, 0, 100, (value) => changed("opacity", Math.max(0, Math.min(100, Math.round(value)))));
    bar.append(kinds, App().scrubbed(T("Opacity"), opacity));
    bar.appendChild(select(T("Method"), METHODS, prefs.method, (value) => changed("method", value)));
    bar.appendChild(App().checkbox(T("Reverse"), prefs.reverse, (on) => changed("reverse", on)));
    bar.appendChild(App().checkbox(T("Dither"), prefs.dither, (on) => changed("dither", on)));
    if (liveNow()) bar.appendChild(hint(T("Drag its ends to adjust it. Enter: done.")));
    else if (prefs.colors === "page") bar.appendChild(hint(T("Select the text, then drag across the bubble: its gradient is drawn again.")));
  };

  /* ------------------------------ what app.js calls ------------------------------ */

  window.TypeRRetouch = {
    down(event, point, base) {
      if (app.tool === "heal") return healDown(event, point, base);
      if (app.tool === "gradient") return gradientDown(event, point, base);
      return null;
    },
    move(gesture, event, point) {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > gesture.slop) gesture.moved = true;
      if (gesture.tool === "heal") healMove(gesture, event);
      else gradientMove(gesture, event, point);
    },
    up(gesture, event, point, cancelled) {
      if (gesture.tool === "heal") healUp(gesture, cancelled);
      else gradientUp(gesture, event, point, cancelled);
    },
    // A second finger arrives: what one finger started is let go
    cancel(gesture) {
      if (gesture && gesture.kind === "retouch") this.up(gesture, null, null, true);
    },
    hover(event) {
      if (app.tool !== "gradient") return;
      const handle = handleAt(event);
      $("stage").style.cursor = handle ? (handle === "move" ? "move" : "pointer") : "";
    },
    doubleClick(event) {
      if (app.tool !== "gradient") return false;
      const handle = handleAt(event);
      if (handle !== "start" && handle !== "end") return false;
      const input = document.querySelector(`#options .grad-end-color[data-end="${handle === "end" ? "last" : "first"}"]`);
      if (!input || !App().openColorPicker) return false;
      App().openColorPicker(input);
      return true;
    },
    drawOverlay(handles, gesture) {
      drawHeals(gesture);
      drawGradientMarks(handles, gesture);
    },
    options,
    toolChosen(tool) {
      if (tool !== "gradient") {
        closeEditor();
        endLive();
      }
    },
    // Alt + click on the page with the Gradient Editor open: the colour chosen there takes it
    sampled(color) {
      if (!editor || app.tool !== "gradient" || !editor.stops[editor.chosen]) return false;
      Object.assign(editor.stops[editor.chosen], { r: byte(color.r), g: byte(color.g), b: byte(color.b) });
      useStops(editor.stops, { fromEditor: true });
      editor.render();
      return true;
    },
    // Esc closes the Gradient Editor first. Enter or Esc: the gradient's ends go, the gradient stays.
    key(event) {
      if (event.key === "Escape" && editor) {
        closeEditor();
        return true;
      }
      if ((event.key === "Enter" || event.key === "Escape") && app.tool === "gradient" && liveNow()) {
        endLive();
        return true;
      }
      return false;
    },
    busy: () => jobs.length > 0,
    // The gradients kept in the Gradient Editor, for Layer Style's Gradient Overlay (app.js)
    gradientPresets: () => readPresets(),
    // For the tutorial (guide.js): the options, a gradient being dragged, one whose ends show
    prefs: () => Object.assign({}, prefs),
    dragging: () => dragging,
    editing: () => Boolean(liveNow()),
  };
})();
