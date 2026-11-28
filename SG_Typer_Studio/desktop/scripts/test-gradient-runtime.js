// Runs the whole of retouch.js under a stub of the page, then drags a gradient's line, as the
// pointer does: the marks must be made once and moved after. Made again at every frame is what
// made the line lag behind the pointer dragging one of its ends, and reading the source cannot
// show the difference.

const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "..", "web", "retouch.js");
let src = fs.readFileSync(file, "utf8");

// The end of the module, opened to the test
src = src.slice(0, src.lastIndexOf("})();"));
src += `
  window.__retouch = () => ({ marks: gradMarks, group: gradGroup });
})();`;

const listeners = {};
const made = [];
const svgNode = (tag) => {
  const node = el(tag);
  node.tag = tag;
  made.push(node);
  return node;
};
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
  getContext: () => ({ getImageData: () => ({ data: [255, 255, 255, 255] }), drawImage() {}, clearRect() {} }),
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
  querySelector: (s) => el(s), querySelectorAll: () => [], createElementNS: (ns, t) => svgNode(t),
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
  __page: null,
  TypeRPhotoshop: (() => {
    const noop = () => undefined;
    const empty = () => [];
    const textDefaults = { font: "ArialMT", family: "Arial", style: "Regular", size: 18, leading: 1.3, color: { r: 0, g: 0, b: 0 }, align: "left" };
    const app = { tool: "wand", docs: [], doc: null, brush: { size: 40, hardness: 100, opacity: 100, flow: 100, spacing: 10 }, fg: { r: 0, g: 0, b: 0 }, bg: { r: 255, g: 255, b: 255 }, selectionMode: "new", textDefaults, zoom: 1, view: { x: 0, y: 0, zoom: 1 } };
    // Reads that expect a list get one, everything else answers as a call
    const ops = new Proxy({}, {
      get: (t, k) => (/(Ids|areas|boxes|rows|list|all)$/.test(String(k)) ? empty : noop),
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
const sandbox = { window, document, navigator: window.navigator, localStorage: window.localStorage,
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


// The page, and the app's side of it: the gradient is drawn again at every step of a drag, as it is
const page = { id: "doc", width: 800, height: 600, view: { zoom: 1, x: 0, y: 0 }, state: { layers: [{ id: 2, kind: "raster", visible: true, paint: [] }], activeIds: [2], selection: null }, history: [], historyIndex: 0, name: "page" };
const drawn = [];
let edit = null;
const gradientOps = new Proxy({
  gradientLive: () => true,
  drawGradient: (args) => {
    drawn.push(args);
    edit = { docId: "doc", where: args.where, token: args.token, op: { t: "gradient", at: args.spec.end[0], made: Boolean(args.edit && args.edit.made) }, area: { left: 0, top: 0, width: 800, height: 600 } };
    return edit;
  },
  pageData: () => null,
}, { get: (t, k) => (k in t ? t[k] : () => undefined) });
window.TypeRPhotoshop = { app: { tool: "gradient", docs: [page], doc: page, brush: { size: 40, hardness: 100, opacity: 100, flow: 100, spacing: 10 }, fg: { r: 0, g: 0, b: 0 }, bg: { r: 255, g: 255, b: 255 }, textDefaults: {} }, ops: gradientOps, layer: {}, announce() {}, on() {}, TEXT_LANGUAGES: ["en"], off() {}, paintDoc() {} };
window.TypeRApp = new Proxy({
  schedule: () => undefined,
  toScreen: (x, y) => [x * page.view.zoom + page.view.x, y * page.view.zoom + page.view.y],
  activeLayer: () => page.state.layers[0],
  maskPainting: () => null,
  hud() {}, toast() {}, renderOptions() {}, openColorPicker: () => true,
}, { get: (t, k) => (k in t ? t[k] : () => undefined) });

const vm = require("vm");
vm.createContext(sandbox);
try {
  vm.runInContext(src, sandbox, { filename: "retouch.js" });
} catch (error) {
  throw new Error(`retouch.js does not run: ${error.message}\n${String(error.stack).split("\n").slice(0, 4).join("\n")}`);
}

const test = require("node:test");
const assert = require("node:assert/strict");

test("The gradient's line is made once and moved after, not made again every frame", () => {
  const { marks } = sandbox.window.__retouch();
  const retouch = sandbox.window.TypeRRetouch;
  const before = made.length;
  const gesture = { kind: "retouch", tool: "gradient", mode: "new", moved: true, start: [10, 20], end: [110, 200], where: { kind: "layer", id: 2 }, edit: null, token: "gesture:gradient:1", page: null };
  retouch.drawOverlay(null, gesture);
  assert.equal(made.length - before, 5, "a line, its under-stroke, two ends and a middle: five elements");
  assert.ok(marks.line && marks.under && marks.start && marks.end && marks.mid, "each one is kept, to be moved");
  assert.equal(marks.line.attributes.d, "M10 20L110 200", "the line goes from the start to the end");
  assert.equal(String(marks.end.attributes.cx), "110", "and ends where the drag did");

  // The end dragged on: the same elements, moved
  const line = marks.line.attributes.d;
  for (let i = 1; i <= 30; i++) {
    gesture.end = [110 + i * 4, 200 + i * 3];
    retouch.drawOverlay(null, gesture);
  }
  assert.equal(made.length - before, 5, "thirty frames of a drag made no element at all");
  assert.equal(marks.line.attributes.d, "M10 20L230 290", "the line is where the pointer took the end");
  assert.equal(String(marks.end.attributes.cx), "230", "and so is the end itself");
  assert.notEqual(marks.line.attributes.d, line, "which is not where it was");

  // The frame the page is painted on empties the handles: the line is not among them
  document.getElementById("handles").textContent = "";
  retouch.drawOverlay(null, gesture);
  assert.equal(marks.line.attributes.d, "M10 20L230 290", "the line is outside what is emptied every frame");
  assert.ok(!marks.line.hasAttribute("hidden"), "and it shows");

  // No gradient any more: the marks go, and the elements stay for the next one
  sandbox.window.TypeRPhotoshop.app.tool = "brush";
  retouch.drawOverlay(null, null);
  assert.ok(marks.line.hasAttribute("hidden") && marks.mid.hasAttribute("hidden"), "hidden with no gradient to show");
  assert.equal(made.length - before, 5, "and still no element made");
  sandbox.window.TypeRPhotoshop.app.tool = "gradient";
  retouch.drawOverlay(null, gesture);
  assert.ok(!marks.line.hasAttribute("hidden"), "back at once, when a gradient is drawn again");
});

test("A click that draws nothing shows no line, and one decided shows it before the page is painted", () => {
  const { marks } = sandbox.window.__retouch();
  const retouch = sandbox.window.TypeRRetouch;
  const gesture = { kind: "retouch", tool: "gradient", mode: "new", moved: false, start: [50, 50], end: [50, 50], x: 50, y: 50, slop: 3, where: { kind: "layer", id: 2 }, edit: null, token: "gesture:gradient:2", page: null };
  retouch.drawOverlay(null, gesture);
  assert.ok(marks.line.hasAttribute("hidden"), "a press with no drag yet shows no line");
  retouch.move(gesture, { clientX: 150, clientY: 150, shiftKey: false }, [150, 150]);
  assert.equal(gesture.moved, true, "the drag is a drag");
  assert.ok(!marks.line.hasAttribute("hidden"), "and the line is on the screen already");
  assert.equal(marks.line.attributes.d, "M50 50L150 150", "where the pointer is, not where the last frame left it");
});
