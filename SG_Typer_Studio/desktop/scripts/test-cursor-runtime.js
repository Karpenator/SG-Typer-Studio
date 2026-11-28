// Runs the whole of app.js under a stub of the page, then moves the pointer over the stage with
// every tool: what a user does first, and what used to throw and leave no cursor at all.
// A source file read as text cannot catch that (BRUSHING_TOOLS was used and never declared), so
// this one runs the file rather than reading it.

const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "..", "web", "app.js");
let src = fs.readFileSync(file, "utf8");

// boot() opens documents, reads the settings, starts the tutorial: left to the app. Everything
// above it is built when the file runs, and that is what this test needs.
if (!src.includes("\n  boot();\n")) throw new Error("boot() not found");
src = src.replace("\n  boot();\n", "\n  void 0;\n");

// The few things a pointer move touches, opened to the test at the end of the module
src = src.slice(0, src.lastIndexOf("})();"));
src += `
  window.__test = {
    setTool, showSampling, ui, app,
    openColorPicker, isSampling,
    ringShown: () => !ui.brushRing.hasAttribute("hidden"),
    ringClass: () => ui.stage.classList.contains("is-ring"),
    brushAt: () => { brushAt = [100, 100]; },
    loupeShown: () => !ui.loupe.hidden,
    loupeHex: () => ui.loupeHex.textContent,
    drawLoupe: (event, point) => drawLoupe(event, point),
    hideLoupe: () => hideLoupe(),
    stageListeners: (type) => (window.__listeners["stage:" + type] || []),
  };
})();
`;

// A page, as much of one as the file touches while it is built: elements that hold classes and
// attributes, a context that paints nothing, and a window with the modules the app expects.
const listeners = {};
const el = (id) => new Proxy(({
  id, style: new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }), dataset: {}, hidden: false, lastElementChild: { textContent: "" }, firstElementChild: { textContent: "" }, textContent: "", innerHTML: "", title: "", value: "0", classList: {
    set: new Set(),
    toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); },
    add(...c) { c.forEach((x) => this.set.add(x)); },
    remove(...c) { c.forEach((x) => this.set.delete(x)); },
    contains(c) { return this.set.has(c); },
  },
  attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; }, hasAttribute(k) { return k in this.attributes; },
  append(...nodes) { if (!this.firstChild) this.firstChild = nodes[0]; this.childNodes.push(...nodes); },
  appendChild(n) { if (!this.firstChild) this.firstChild = n; this.childNodes.push(n); return n; },
  insertBefore() {}, removeChild() {}, replaceChildren() {}, remove() {}, firstChild: null, lastChild: null, children: [], childNodes: [],
  setAttributeNS() {}, getAttribute(k) { return this.attributes[k] ?? null; }, addEventListener(t, f) { (listeners[id + ":" + t] ||= []).push(f); },
  getContext: () => ({ getImageData: () => ({ data: [255, 255, 255, 255] }), drawImage() {}, clearRect() {}, fillRect() {}, strokeRect() {} }),
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
  focus() {}, closest: () => null, querySelector: (sel) => el("q:" + sel),
}), {
  get(target, key) {
    if (key in target) return target[key];
    if (typeof key !== "string") return undefined;
    // Anything else a real element has: a no-op method, or undefined for a value
    if (/^on/.test(key)) return null;
    // A DOM element answers a call to nearly anything with nothing, as after(), before(), replaceWith() do
    return () => el(key);
  },
  set(target, key, value) { target[key] = value; return true; },
});
const cache = {};
const document = {
  getElementById: (id) => (cache[id] ||= el(id)),
  querySelector: (s) => el(s), querySelectorAll: () => [], createElementNS: (ns, t) => el(t),
  createTextNode: (t) => el("text"),
  createElement: (t) => el(t), addEventListener() {}, body: el("body"), head: el("head"),
  documentElement: el("html"), write() {}, activeElement: el("active"),
};
const window = {
  addEventListener(t, f) { (listeners["window:" + t] ||= []).push(f); },
  removeEventListener(t, f) { const list = listeners["window:" + t] || []; const at = list.indexOf(f); if (at >= 0) list.splice(at, 1); },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  innerWidth: 1400, innerHeight: 900, devicePixelRatio: 1,
  navigator: { platform: "Win32", userAgent: "node", clipboard: { writeText: async () => {} } },
  TypeRShell: { touch: false, onChange() {}, desktop: () => false },
  TYPER_I18N: { lang: "en", strings: {} },
  TYPER_WEB_STRINGS: {},
  TypeRGuide: { show() {} },
  TypeRFonts: { onChange() {}, available: () => true, list: () => [], resolve: () => "Arial", isMissing: () => false, pick: () => "Arial", fontOf: () => "Arial", faces: () => [], installed: () => [] },
  TypeRKit: { onChange() {}, available: () => false, list: () => [] },
  TypeRRecent: { available: false, list: async () => [], add: async () => {}, remove: async () => {} },
  TypeRTextMask: { enabled: () => false, onChange() {} },
  TypeRColor: (() => { const c = { init() {}, show() {}, open() {}, refresh() {} }; return new Proxy(c, { get: (t, k) => (k in t ? t[k] : () => {}) }); })(),
  TypeRSFX: new Proxy({ toolChosen() {}, hover() {} }, { get: (t, k) => (k in t ? t[k] : () => {}) }),
  TypeRRetouch: new Proxy({ toolChosen() {}, sampled: () => false, hover() {} }, { get: (t, k) => (k in t ? t[k] : () => {}) }),
  TypeRReshapeTool: new Proxy({ toolChosen() {}, hover() {} }, { get: (t, k) => (k in t ? t[k] : () => {}) }),
  TypeRWorkspace: new Proxy({ sideVisible: () => true, toggleSide() {} }, { get: (t, k) => (k in t ? t[k] : () => {}) }),
  TypeRStyles: new Proxy({ init() {}, refresh() {} }, { get: (t, k) => (k in t ? t[k] : () => {}) }),
  TypeRBrushes: new Proxy({ init() {}, refresh() {} }, { get: (t, k) => (k in t ? t[k] : () => {}) }),
  TypeRActions: new Proxy({ init() {}, refresh() {} }, { get: (t, k) => (k in t ? t[k] : () => {}) }),
  TypeRStudio: { takePhotoshopSettings: async () => {} },
  TypeRPhotoshop: (() => {
    const noop = () => undefined;
    const empty = () => [];
    const textDefaults = { font: "ArialMT", family: "Arial", style: "Regular", size: 18, leading: 1.3, color: { r: 0, g: 0, b: 0 }, align: "left" };
    const app = { tool: "wand", docs: [], doc: null, brush: { size: 40, hardness: 100, opacity: 100, flow: 100, spacing: 10 }, fg: { r: 0, g: 0, b: 0 }, bg: { r: 255, g: 255, b: 255 }, selectionMode: "new", textDefaults, zoom: 1, view: { x: 0, y: 0, zoom: 1 } };
    // Reads that expect a list get one, everything else answers as a call
    // The page's pixels, as the eyedropper reads them: one colour all through, so it reads back
    const area = (left, top, width, height) => {
      const data = new Uint8ClampedArray(Math.max(1, width) * Math.max(1, height) * 4);
      for (let at = 0; at < data.length; at += 4) { data[at] = 51; data[at + 1] = 102; data[at + 2] = 153; data[at + 3] = 255; }
      return data;
    };
    const ops = new Proxy({ pickArea: area }, {
      get: (t, k) => (k in t ? t[k] : /(Ids|areas|boxes|rows|list|all)$/.test(String(k)) ? empty : noop),
    });
    const layer = new Proxy({}, { get: () => noop });
    const base = { app, ops, layer, announce() {}, on() {}, TEXT_LANGUAGES: ["en"], off() {}, paintDoc() {} };
    const defaultValue = (key) => (key === "layer" || key === "defaultLayer" ? layer : () => {});
    return new Proxy(base, { get: (target, key) => (key in target && target[key] !== undefined ? target[key] : defaultValue(String(key))) });
  })(),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { href: "file:///app/index.html", search: "" },
};
window.window = window;
window.__listeners = listeners;
const sandbox = { window, document, lists: listeners, navigator: window.navigator, localStorage: window.localStorage,
  requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame,
  setTimeout, clearTimeout, setInterval, clearInterval, console, performance, Image: function () {}, Event: function () {}, CustomEvent: function () {},
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  ResizeObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
  MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
  IntersectionObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  FontFace: function () {}, WebAssembly: {}, Worker: function () { this.postMessage = () => {}; },
  OffscreenCanvas: function () { return el("offscreen"); },
  DOMException: class DOMException extends Error {},
  XMLSerializer: function () { this.serializeToString = () => ""; },
  FileReader: function () {}, File: function () {}, FileList: function () {}, FormData: function () {}, Headers: function () {}, Request: function () {}, Response: function () {},
  AbortController: function () { this.signal = {}; this.abort = () => {}; },
  structuredClone: (x) => x, CSS: { escape: (x) => x }, ImageData: function () {}, Path2D: function () {},
  Audio: function () {}, speechSynthesis: { getVoices: () => [], speak() {} }, Notification: function () {},
  prompt: () => null, confirm: () => true, alert: () => {},
  queueMicrotask: (f) => f(), DOMParser: function () {}, URL, Blob: function () {}, fetch: async () => ({}), indexedDB: undefined };

const vm = require("vm");
vm.createContext(sandbox);
try {
  vm.runInContext(src, sandbox, { filename: "app.js" });
} catch (error) {
  throw new Error(`app.js does not run: ${error.message}\n${String(error.stack).split("\n").slice(0, 4).join("\n")}`);
}
const t = sandbox.window.__test;


/* ------------------------------------------------------------------------------------------------
   Every tool, moved: the stage must still have a pointer on it afterwards
   ------------------------------------------------------------------------------------------------ */

const checks = [];
const check = (name, ok, detail) => {
  checks.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

const page = { width: 800, height: 1200, view: { zoom: 1, x: 0, y: 0 }, state: { layers: [], activeIds: [] }, name: "page" };
t.app.doc = page;
t.app.brush = { size: 40, hardness: 100, opacity: 100, flow: 100, spacing: 10 };
t.ui.editor.hidden = true;
const move = (extra = {}) => Object.assign({ clientX: 220, clientY: 180, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, button: 0, pointerType: "mouse", pointerId: 1 }, extra);

// The Clone Stamp and the Healing Brush keep Alt for their source: Alt there must not become an
// eyedropper, and the move still must not throw
for (const tool of ["stamp", "healing"]) {
  let threw = null;
  try {
    t.setTool(tool);
    t.brushAt();
    t.showSampling(move({ altKey: true }));
    check(`${tool}: Alt is the source, not the eyedropper`, !t.ui.stage.classList.contains("is-sampling"));
    t.showSampling(move());
  } catch (error) {
    threw = error;
  }
  check(`${tool}: Alt does not throw`, !threw, threw ? `${threw.name}: ${threw.message}` : "");
}

const ALL = ["move", "rectangle", "ellipse", "lasso", "polygon", "wand", "crop", "brush", "eraser", "magicEraser", "gradient", "stamp", "healing", "smudge", "clean", "heal", "reshape", "eyedropper", "text", "sfx", "hand", "zoom"];
for (const tool of ALL) {
  let threw = null;
  try {
    t.setTool(tool);
    t.brushAt();
    // A move, then Alt for the eyedropper, then the resize's Ctrl + Alt, then Alt let go
    t.showSampling(move());
    t.showSampling(move({ altKey: true }));
    t.showSampling(move({ altKey: true, ctrlKey: true, button: 2 }));
    t.showSampling(move());
  } catch (error) {
    threw = error;
  }
  check(`${tool}: a move does not throw`, !threw, threw ? `${threw.name}: ${threw.message}` : "");
}

// A brush draws its ring, and the pointer is hidden by that ring and by nothing else
t.setTool("brush");
t.brushAt();
t.showSampling(move());
check("brush: the ring is drawn", t.ringShown());
check("brush: the pointer is hidden by the ring", t.ringClass());
t.showSampling(move({ altKey: true }));
check("Alt: the ring goes and the pointer comes back", !t.ringShown() && !t.ringClass());
check("Alt: the eyedropper's class is on", t.ui.stage.classList.contains("is-sampling"));
t.showSampling(move());
check("Alt let go: the eyedropper's class is off at once", !t.ui.stage.classList.contains("is-sampling"));
check("Alt let go: the ring is back", t.ringShown() && t.ringClass());

// The Color Picker: no "Pick from the screen" button, and its window takes Enter and Esc wherever
// the focus is — a colour sampled on the page leaves it there. Closing it always clears sampling.
const pickerInput = () => {
  const input = el("picker-input");
  input.type = "color";
  input.value = "#336699";
  input.title = "Start Color";
  return input;
};
{
  const input = pickerInput();
  t.openColorPicker(input);
  const labels = [];
  const walk = (node) => {
    if (!node || !node.childNodes) return;
    (node.childNodes || []).forEach((child) => {
      if (child) {
        if (child.textContent) labels.push(String(child.textContent));
        walk(child);
      }
    });
  };
  walk(t.ui.modal);
  check("the picker has no screen-picking button", !labels.some((text) => /Pick from the screen/i.test(text)));
  check("the picker samples as soon as it is open", Boolean(t.isSampling({ clientX: 10, clientY: 10 })));
  const keys = listeners["window:keydown"] || [];
  // The list is spliced as listeners go, so its length is taken before the keys are sent
  const open = keys.length;
  check("the picker listens for the keyboard itself", open > 0);
  // Enter and Esc are the picker's wherever the focus is: every listener sees the key, and the
  // picker's own closes the window and takes its listeners with it.
  const key = (name, target) => ({ key: name, preventDefault() {}, stopPropagation() {}, target: target || { tagName: "INPUT", closest: () => null } });
  keys.slice().forEach((fn) => fn(key("Enter")));
  // Only the picker's own handler takes itself off: that is its window closing
  check("Enter closes the picker", (listeners["window:keydown"] || []).length === open - 1);
  check("closing the picker clears its sampling", !t.isSampling({ clientX: 10, clientY: 10 }));
  // Esc, reopened: the same through the cancel path
  t.openColorPicker(pickerInput());
  const again = (listeners["window:keydown"] || []).length;
  (listeners["window:keydown"] || []).slice().forEach((fn) => fn(key("Escape")));
  check("Esc closes the picker", (listeners["window:keydown"] || []).length === again - 1);
  check("Esc clears its sampling", !t.isSampling({ clientX: 10, clientY: 10 }));
  // The gradient's ends stay draggable while the picker is open: over one, the page is not the
  // picker's eyedropper, and the tool's own drag takes the click.
  t.openColorPicker(pickerInput());
  const retouch = sandbox.window.TypeRRetouch;
  const was = retouch.handleAt;
  let asked = null;
  sandbox.window.TypeRRetouch = new Proxy(Object.assign({}, was === undefined ? {} : {}, {
    handleAt: (event) => { asked = event; return "end"; },
    sampled: () => false,
    hover() {},
    toolChosen() {},
  }), { get: (target, key) => (key in target ? target[key] : () => {}) });
  t.setTool("gradient");
  t.showSampling(move({ clientX: 40, clientY: 40 }));
  check("over a gradient end, the picker's eyedropper is off", !t.ui.stage.classList.contains("is-sampling") && Boolean(asked));
  sandbox.window.TypeRRetouch = new Proxy({ handleAt: () => null, sampled: () => false, hover() {}, toolChosen() {} }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  t.showSampling(move({ clientX: 60, clientY: 60 }));
  check("away from the ends, the page is the picker's eyedropper again", t.ui.stage.classList.contains("is-sampling"));
  t.setTool("brush");
  (listeners["window:keydown"] || []).slice().forEach((fn) => fn(key("Escape")));
}

// The eyedropper's loupe: the page's pixels in a square around the pointer, its colour under them.
// It comes and goes with the pointer and with a click, and never stays behind.
{
  t.setTool("eyedropper");
  t.showSampling(move({ clientX: 240, clientY: 200 }));
  t.drawLoupe(move({ clientX: 240, clientY: 200 }), [240, 200]);
  check("the loupe shows on the eyedropper", t.loupeShown());
  check("the loupe reads the colour under the pointer", t.loupeHex() === "#336699", t.loupeHex());
  // A press: the colour is taken, and the loupe goes with the click
  t.hideLoupe();
  check("a click takes the loupe with it", !t.loupeShown());
  check("the loupe is told when the pointer leaves the stage", t.stageListeners("pointerleave").length > 0 && t.stageListeners("pointercancel").length > 0);
  // A move takes it away when it is no longer the eyedropper's, and brings it back when it is
  t.setTool("brush");
  t.drawLoupe(move({ clientX: 240, clientY: 200 }), [240, 200]);
  check("no loupe for a brush with Alt let go", !t.loupeShown());
  t.setTool("eyedropper");
  t.drawLoupe(move({ clientX: 240, clientY: 200 }), [240, 200]);
  check("the loupe is back with the eyedropper", t.loupeShown());
  t.setTool("brush");
  t.drawLoupe(move({ clientX: 240, clientY: 200 }), [240, 200]);
}

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks`);

const test = require("node:test");
const assert = require("node:assert/strict");
test("Every tool keeps a pointer on the stage when the mouse moves", () => {
  assert.equal(checks.length, ALL.length + 25, "each tool was moved, Alt's meaning was watched, and so were the brush's ring and the Color Picker");
  assert.equal(failed, 0, `${failed} of ${checks.length} checks failed`);
});
