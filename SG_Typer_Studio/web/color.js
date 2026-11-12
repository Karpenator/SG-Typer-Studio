// Photoshop-like Color panel: a saturation/value field and a hue strip driving the same
// foreground/background colours as the painting tools. It is a Workspace panel, not a modal.
(function () {
  "use strict";

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const hsbToRgb = (h, s, v) => {
    const sat = s / 100;
    const val = (v / 100) * 255;
    const at = (n) => {
      const k = (n + h / 60) % 6;
      return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1));
    };
    const [r, g, b] = [at(5), at(3), at(1)];
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  };
  const rgbToHsb = (r, g, b) => {
    const max = Math.max(r, g, b);
    const span = max - Math.min(r, g, b);
    let h = 0;
    if (span) {
      if (max === r) h = ((g - b) / span + 6) % 6;
      else if (max === g) h = (b - r) / span + 2;
      else h = (r - g) / span + 4;
    }
    return { h: h * 60, s: max ? (span / max) * 100 : 0, v: (max / 255) * 100 };
  };
  const hex = (color) => "#" + [color.r, color.g, color.b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("");

  let options = null;
  let target = "fg";
  let state = { h: 0, s: 0, v: 0 };
  let field;
  let hue;
  let hexInput;
  let foreground;
  let background;
  let drawing = false;

  const color = () => hsbToRgb(state.h, state.s, state.v);
  const current = () => target === "fg" ? options.getForeground() : options.getBackground();

  const draw = () => {
    if (!field || !options) return;
    const canvas = field;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;
    const hueColor = hsbToRgb(state.h, 100, 100);
    ctx.fillStyle = hex(hueColor);
    ctx.fillRect(0, 0, w, h);
    const white = ctx.createLinearGradient(0, 0, w, 0);
    white.addColorStop(0, "rgba(255,255,255,1)");
    white.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, w, h);
    const black = ctx.createLinearGradient(0, 0, 0, h);
    black.addColorStop(0, "rgba(0,0,0,0)");
    black.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, w, h);
    const x = (state.s / 100) * (w - 1);
    const y = (1 - state.v / 100) * (h - 1);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = state.v > 55 ? "#000" : "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 6.5, 0, Math.PI * 2);
    ctx.strokeStyle = state.v > 55 ? "#fff" : "#000";
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  const refresh = () => {
    if (!options) return;
    const fg = options.getForeground();
    const bg = options.getBackground();
    foreground.style.background = hex(fg);
    background.style.background = hex(bg);
    foreground.classList.toggle("is-active", target === "fg");
    background.classList.toggle("is-active", target === "bg");
    foreground.setAttribute("aria-pressed", String(target === "fg"));
    background.setAttribute("aria-pressed", String(target === "bg"));
    if (drawing) return;
    const next = rgbToHsb(current().r, current().g, current().b);
    state.v = next.v;
    if (next.v > 0) state.s = next.s;
    if (next.v > 0 && next.s > 0) state.h = next.h;
    hue.value = String(state.h);
    hexInput.value = hex(current());
    draw();
  };

  const commit = () => {
    drawing = true;
    const value = color();
    options.setColor(target, value);
    hexInput.value = hex(value);
    draw();
    drawing = false;
    // setColor updates the toolbar and calls refresh; reflect the selected target afterwards.
    foreground.classList.toggle("is-active", target === "fg");
    background.classList.toggle("is-active", target === "bg");
  };

  const resize = () => {
    if (!field) return;
    const box = field.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(box.width * ratio));
    const h = Math.max(1, Math.round(box.height * ratio));
    if (field.width !== w || field.height !== h) {
      field.width = w;
      field.height = h;
    }
    draw();
  };

  const init = (config) => {
    options = config;
    const T = options.translate || ((text) => text);
    field = document.getElementById("color-field");
    hue = document.getElementById("color-hue");
    hexInput = document.getElementById("color-hex");
    foreground = document.getElementById("color-foreground");
    background = document.getElementById("color-background");
    document.getElementById("head-color").textContent = T("Color panel");
    foreground.title = T("Foreground colour");
    background.title = T("Background colour");
    foreground.setAttribute("aria-label", T("Foreground colour"));
    background.setAttribute("aria-label", T("Background colour"));
    hue.setAttribute("aria-label", T("Hue"));
    hexInput.setAttribute("aria-label", T("Hex colour"));
    [["fg", foreground], ["bg", background]].forEach(([key, button]) => {
      button.addEventListener("click", () => {
        target = key;
        refresh();
      });
      button.addEventListener("dblclick", () => options.openPicker(key));
    });
    hue.addEventListener("input", () => {
      state.h = Number(hue.value);
      commit();
    });
    hexInput.addEventListener("change", () => {
      const value = hexInput.value.trim();
      if (!/^#?[0-9a-f]{6}$/i.test(value)) {
        hexInput.value = hex(current());
        return;
      }
      const normalized = value.startsWith("#") ? value : "#" + value;
      const next = { r: parseInt(normalized.slice(1, 3), 16), g: parseInt(normalized.slice(3, 5), 16), b: parseInt(normalized.slice(5, 7), 16) };
      const hsb = rgbToHsb(next.r, next.g, next.b);
      state = hsb;
      commit();
    });
    const pick = (event) => {
      const box = field.getBoundingClientRect();
      state.s = clamp(((event.clientX - box.left) / box.width) * 100, 0, 100);
      state.v = clamp((1 - (event.clientY - box.top) / box.height) * 100, 0, 100);
      commit();
    };
    field.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      field.setPointerCapture(event.pointerId);
      const move = (next) => pick(next);
      const stop = () => {
        field.removeEventListener("pointermove", move);
        field.removeEventListener("pointerup", stop);
        field.removeEventListener("pointercancel", stop);
      };
      field.addEventListener("pointermove", move);
      field.addEventListener("pointerup", stop);
      field.addEventListener("pointercancel", stop);
      pick(event);
    });
    new ResizeObserver(resize).observe(field);
    refresh();
    resize();
  };

  window.TypeRColor = { init, refresh, hsbToRgb, rgbToHsb, hex };
})();
