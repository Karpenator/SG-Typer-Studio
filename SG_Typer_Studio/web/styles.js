// Window > Styles: real Layer Style presets, including the user's own. Presets contain the
// document engine's effect and stroke records, never a CSS approximation; the canvases here are
// only their gallery thumbnails. Custom presets live locally, independently of any one document.
(function () {
  "use strict";
  const PS = window.TypeRPhotoshop;
  const $ = (id) => document.getElementById(id);
  const STORE = "typer.web.layerStyles";
  const SIZE_STORE = "typer.web.layerStyleThumbnail";
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const rgb = (hex) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });
  const stops = (a, b, middle) => [Object.assign({ at: 0, a: 1 }, rgb(a)), ...(middle ? [Object.assign({ at: 0.5, a: 1 }, rgb(middle))] : []), Object.assign({ at: 1, a: 1 }, rgb(b))];
  const fx = (name, values = {}) => Object.assign(clone(PS.FX_DEFAULTS[name]), values);
  const stroke = (size, color, position = "outer") => ({ enabled: true, size, opacity: 100, position, color: rgb(color) });
  const style = (id, name, effects = {}, line = null, extra = {}) => Object.assign({ id, name, effects, stroke: line }, extra);
  const gradient = (colors, values = {}) => fx("gradientOverlay", Object.assign({ stops: stops(...colors) }, values));
  const shadow = (values = {}) => fx("dropShadow", values);
  const glow = (values = {}) => fx("outerGlow", values);
  const overlay = (color, values = {}) => fx("colorOverlay", Object.assign({ color: rgb(color) }, values));
  const innerShadow = (values = {}) => fx("innerShadow", values);
  const innerGlow = (values = {}) => fx("innerGlow", values);

  const BUILT_IN = [
    { id: "basics", name: "Basics", styles: [
      style("default", "Default Style (None)"),
      style("drop-shadow", "Drop Shadow", { dropShadow: shadow({ distance: 6, size: 8, opacity: 60 }) }),
      style("soft-shadow", "Soft Shadow", { dropShadow: shadow({ distance: 2, size: 16, opacity: 45 }) }),
      style("black-stroke", "Black Stroke", {}, stroke(3, "#000000")),
      style("white-stroke", "White Stroke", {}, stroke(3, "#ffffff")),
      style("inner-shadow", "Inner Shadow", { innerShadow: innerShadow({ distance: 4, size: 6, opacity: 55 }) }),
      style("outer-glow", "Outer Glow", { outerGlow: glow({ size: 14, color: rgb("#ffe9a8"), opacity: 80 }) }),
      style("soft-emboss", "Soft Emboss", { innerShadow: innerShadow({ distance: 2, size: 3, opacity: 55 }), innerGlow: innerGlow({ size: 5, opacity: 65 }), dropShadow: shadow({ distance: 1, size: 1, opacity: 35 }) }),
    ] },
    { id: "text", name: "Text Effects", styles: [
      style("neon-blue", "Neon Blue", { colorOverlay: overlay("#d8f4ff"), innerGlow: innerGlow({ color: rgb("#3fb6ff"), size: 6, opacity: 90, blend: "normal" }), outerGlow: glow({ color: rgb("#1e90ff"), size: 22, opacity: 90 }) }),
      style("neon-pink", "Neon Pink", { colorOverlay: overlay("#ffe1f3"), innerGlow: innerGlow({ color: rgb("#ff4fb4"), size: 6, opacity: 90, blend: "normal" }), outerGlow: glow({ color: rgb("#ff2d95"), size: 22, opacity: 90 }) }),
      style("chrome", "Chrome", { gradientOverlay: gradient(["#3a3f47", "#f4f6f8", "#3a3f47"]), innerGlow: innerGlow({ color: rgb("#ffffff"), size: 3, opacity: 55 }) }, stroke(1, "#2a2d33")),
      style("gold", "Gold", { gradientOverlay: gradient(["#8a5a12", "#ffe08a", "#8a5a12"]), innerGlow: innerGlow({ color: rgb("#fff2ba"), size: 4, opacity: 65 }), dropShadow: shadow({ distance: 3, size: 5, opacity: 50 }) }),
      style("comic-outline", "Comic Outline", { colorOverlay: overlay("#ffd23f"), dropShadow: shadow({ distance: 6, size: 0, opacity: 100, angle: 135 }) }, stroke(4, "#111111")),
      style("letterpress", "Letterpress", { colorOverlay: overlay("#5b6168"), innerShadow: innerShadow({ distance: 2, size: 2, opacity: 70 }), dropShadow: shadow({ distance: 1, size: 0, color: rgb("#ffffff"), opacity: 60, blend: "screen", angle: 90 }) }),
      style("hollow", "Hollow", {}, stroke(2, "#222222", "inner"), { fill: 0 }),
    ] },
    { id: "buttons", name: "Buttons", styles: [
      style("glass", "Glass", { gradientOverlay: gradient(["#2b6cb0", "#90cdf4"]), innerGlow: innerGlow({ color: rgb("#ffffff"), size: 6, opacity: 45, blend: "screen" }), dropShadow: shadow({ distance: 3, size: 8, opacity: 40 }) }),
      style("gel-green", "Gel Green", { gradientOverlay: gradient(["#1f7a3a", "#7be495"]), innerShadow: innerShadow({ distance: 2, size: 5, opacity: 35 }), innerGlow: innerGlow({ color: rgb("#d5ffe1"), size: 7, opacity: 50 }) }),
      style("pressed", "Pressed", { colorOverlay: overlay("#d7dbe0"), innerShadow: innerShadow({ distance: 3, size: 6, opacity: 60 }) }, stroke(1, "#9aa1a9", "inner")),
      style("pill-red", "Pill Red", { gradientOverlay: gradient(["#9b1c1c", "#f87171"]), innerShadow: innerShadow({ distance: 2, size: 4, opacity: 35 }), dropShadow: shadow({ distance: 2, size: 4, opacity: 45 }) }),
      style("flat-shadow", "Flat Shadow", { colorOverlay: overlay("#3b82f6"), dropShadow: shadow({ distance: 5, size: 0, opacity: 35, angle: 90 }) }),
      style("satin-plum", "Satin Plum", { colorOverlay: overlay("#7e3a8c"), gradientOverlay: gradient(["#401047", "#a75ab5"], { opacity: 55 }), innerGlow: innerGlow({ color: rgb("#e4a9ef"), size: 9, opacity: 35 }) }),
    ] },
  ];

  let T = (text) => text;
  let ask = null;
  let notify = null;
  let getTargets = () => [];
  let customs = [];
  let selected = null;
  let thumbSize = 44;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "[]");
    if (Array.isArray(saved)) customs = saved.filter((item) => item && typeof item.id === "string" && typeof item.name === "string").map(clone);
    thumbSize = Math.max(32, Math.min(64, Number(localStorage.getItem(SIZE_STORE)) || 44));
  } catch (error) { customs = []; }
  const keep = () => {
    try { localStorage.setItem(STORE, JSON.stringify(customs)); }
    catch (error) { if (notify) notify(T("Could not save the style library."), true); }
  };
  const allGroups = () => BUILT_IN.concat([{ id: "custom", name: "My Styles", styles: customs }]);
  const findStyle = (id) => {
    for (const group of allGroups()) {
      const found = group.styles.find((item) => item.id === id);
      if (found) return found;
    }
    return null;
  };

  // A gallery thumbnail. Applying the preset below always goes through the document renderer.
  const thumbnail = (preset) => {
    const canvas = document.createElement("canvas");
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = Math.round(thumbSize * ratio);
    canvas.style.width = canvas.style.height = `${thumbSize}px`;
    const c = canvas.getContext("2d");
    c.scale(ratio, ratio);
    const s = thumbSize / 44;
    const left = 9 * s, top = 9 * s, side = 26 * s;
    const path = () => {
      c.beginPath();
      if (c.roundRect) c.roundRect(left, top, side, side, 3 * s);
      else c.rect(left, top, side, side);
    };
    const color = (value, fallback = "#000") => value ? `rgb(${value.r},${value.g},${value.b})` : fallback;
    const effects = preset.effects || {};
    c.save();
    const sh = effects.dropShadow;
    if (sh && sh.enabled !== false) {
      const angle = (sh.angle || 0) * Math.PI / 180;
      c.shadowColor = color(sh.color);
      c.globalAlpha = (sh.opacity === undefined ? 75 : sh.opacity) / 100;
      c.shadowBlur = (sh.size || 0) * s * 0.45;
      c.shadowOffsetX = Math.cos(angle) * (sh.distance || 0) * s * 0.4;
      c.shadowOffsetY = -Math.sin(angle) * (sh.distance || 0) * s * 0.4;
      path(); c.fillStyle = "#888"; c.fill();
    }
    c.restore();
    c.save();
    const gl = effects.outerGlow;
    if (gl && gl.enabled !== false) {
      c.shadowColor = color(gl.color, "#fff");
      c.shadowBlur = Math.max(2, (gl.size || 5) * s * 0.35);
      path(); c.fillStyle = color(gl.color, "#fff"); c.fill();
    }
    c.restore();
    let fill = "#d7d7d7";
    if (effects.colorOverlay && effects.colorOverlay.enabled !== false) fill = color(effects.colorOverlay.color);
    if (effects.gradientOverlay && effects.gradientOverlay.enabled !== false) {
      const list = effects.gradientOverlay.stops || [];
      const g = c.createLinearGradient(left, top, left, top + side);
      list.forEach((stop) => g.addColorStop(Math.max(0, Math.min(1, stop.at)), `rgba(${stop.r},${stop.g},${stop.b},${stop.a === undefined ? 1 : stop.a})`));
      fill = g;
    }
    c.save();
    c.globalAlpha = preset.fill === undefined ? 1 : preset.fill;
    path(); c.fillStyle = fill; c.fill(); c.restore();
    if (effects.innerShadow && effects.innerShadow.enabled !== false) {
      c.save(); path(); c.clip();
      c.shadowColor = "rgba(0,0,0,.65)"; c.shadowBlur = 4 * s; c.shadowOffsetX = 2 * s; c.shadowOffsetY = 2 * s;
      c.strokeStyle = "rgba(0,0,0,.25)"; c.lineWidth = 3 * s; path(); c.stroke(); c.restore();
    }
    if (preset.stroke && preset.stroke.enabled !== false) {
      path(); c.strokeStyle = color(preset.stroke.color); c.lineWidth = Math.max(1, Math.min(4 * s, preset.stroke.size * s * 0.5)); c.stroke();
    }
    return canvas;
  };

  const apply = (preset, add) => {
    const doc = PS.app.doc;
    const targets = getTargets();
    if (!doc || !targets.length) {
      if (notify) notify(T("Select a text layer to apply a style."), true);
      return;
    }
    const ids = new Set(targets.map((layer) => layer.id));
    PS.ops.setLayers(doc.state.layers.map((layer) => {
      if (!ids.has(layer.id)) return layer;
      const effects = add ? Object.assign({}, layer.effects, clone(preset.effects || {})) : clone(preset.effects || {});
      const next = Object.assign({}, layer, {
        effects: Object.keys(effects).length ? effects : undefined,
        stroke: add && !preset.stroke ? layer.stroke : clone(preset.stroke),
        raster: null,
      });
      if (!add) {
        if (preset.blend) next.blend = preset.blend;
        if (preset.opacity !== undefined) next.opacity = preset.opacity;
        next.fill = preset.fill === undefined ? 1 : preset.fill;
        next.knockout = next.fill === 0;
      } else {
        if (preset.blend) next.blend = preset.blend;
        if (preset.opacity !== undefined) next.opacity = preset.opacity;
        if (preset.fill !== undefined) { next.fill = preset.fill; next.knockout = preset.fill === 0; }
      }
      return next;
    }), "Apply Layer Style");
  };

  const render = () => {
    const library = $("styles-library");
    library.textContent = "";
    library.style.setProperty("--style-thumb", `${thumbSize}px`);
    allGroups().forEach((group) => {
      if (group.id === "custom" && !group.styles.length) return;
      const details = document.createElement("details");
      details.className = "styles-group";
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = T(group.name);
      details.appendChild(summary);
      const grid = document.createElement("div");
      grid.className = "styles-grid";
      group.styles.forEach((preset) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "styles-preset";
        button.dataset.style = preset.id;
        button.dataset.custom = String(group.id === "custom");
        button.title = `${T(preset.name)} — ${T("Click to apply; Shift-click to add")}`;
        button.setAttribute("aria-label", T(preset.name));
        button.classList.toggle("is-selected", selected === preset.id);
        button.appendChild(thumbnail(preset));
        button.addEventListener("click", (event) => { selected = preset.id; render(); apply(preset, event.shiftKey); });
        if (group.id === "custom") button.addEventListener("dblclick", async () => {
          const answer = await ask({ title: T("Rename Style"), fields: [{ id: "name", label: T("Name"), value: preset.name }] });
          if (!answer || !answer.name.trim()) return;
          preset.name = answer.name.trim(); keep(); render();
        });
        grid.appendChild(button);
      });
      details.appendChild(grid);
      library.appendChild(details);
    });
    $("styles-delete").disabled = !selected || !customs.some((item) => item.id === selected);
    $("styles-new").disabled = !getTargets().length;
  };

  const create = async () => {
    const targets = getTargets();
    if (!targets.length) { if (notify) notify(T("Select a text layer to create a style."), true); return; }
    const layer = targets[targets.length - 1];
    const answer = await ask({
      title: T("New Style"),
      fields: [
        { id: "name", label: T("Name"), value: `${T("Style")} ${customs.length + 1}` },
        { id: "effects", label: T("Include Layer Effects"), type: "checkbox", checked: true },
        { id: "blending", label: T("Include Layer Blending Options"), type: "checkbox", checked: true },
      ],
    });
    if (!answer || !answer.name.trim()) return;
    const preset = {
      id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: answer.name.trim(),
      effects: answer.effects ? clone(layer.effects || {}) : {},
      stroke: answer.effects ? clone(layer.stroke || null) : null,
    };
    if (answer.blending) Object.assign(preset, { blend: layer.blend || "normal", opacity: layer.opacity === undefined ? 1 : layer.opacity, fill: PS.fillOf(layer) });
    customs.push(preset); selected = preset.id; keep(); render();
    if (notify) notify(T("Style saved."));
  };

  const remove = () => {
    if (!customs.some((item) => item.id === selected)) return;
    customs = customs.filter((item) => item.id !== selected);
    selected = null; keep(); render();
  };

  const init = ({ translate, dialog, toast, targets }) => {
    T = translate; ask = dialog; notify = toast; getTargets = targets;
    $("head-styles").textContent = T("Styles");
    $("styles-new").title = T("Create new style from the selected layer");
    $("styles-new").setAttribute("aria-label", $("styles-new").title);
    $("styles-delete").title = T("Delete Style");
    $("styles-delete").setAttribute("aria-label", T("Delete Style"));
    $("styles-size").value = thumbSize;
    $("styles-size").setAttribute("aria-label", T("Thumbnail size"));
    $("styles-size").addEventListener("input", () => {
      thumbSize = Number($("styles-size").value);
      try { localStorage.setItem(SIZE_STORE, String(thumbSize)); } catch (error) {}
      render();
    });
    $("styles-new").addEventListener("click", create);
    $("styles-delete").addEventListener("click", remove);
    PS.on((type) => {
      if (type === "document") render();
      else if (type === "history") $("styles-new").disabled = !getTargets().length;
    });
    render();
  };

  window.TypeRStyles = { init, render, builtins: BUILT_IN, apply, get customs() { return customs; } };
})();
