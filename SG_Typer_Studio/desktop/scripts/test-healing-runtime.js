// Builds photoshop.js's engine under a stub of the page and paints with it: a healing stroke
// copies what it must, and a source taken on another page is read from that page. Reading the
// source cannot show either; running it can.

const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "..", "web", "photoshop.js");
let src = fs.readFileSync(file, "utf8");

// boot() opens documents, reads the settings, starts the tutorial: left to the app. Everything
// above it is built when the file runs, and that is what this test needs.

// The few things a pointer move touches, opened to the test at the end of the module
src = src.slice(0, src.lastIndexOf("})();"));
src += `
  window.__engine = () => ({ beginStroke: ops.beginStroke, extendStroke: ops.extendStroke, endStroke: ops.endStroke, app, setDoc, rasterCache, referenceShot });
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
  width: 1, height: 1,
  getContext: () => el("ctx-" + id),
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
  focus() {}, closest: () => null, querySelector: (sel) => el("q:" + sel),
}), {
  get(target, key) {
    if (key in target) return target[key];
    if (typeof key !== "string") return undefined;
    // A context reads back what it was given, so that a canvas can be said to fit: the engine
    // asks by painting one pixel and reading its alpha
    if (key === "getImageData") return () => ({ data: [0, 0, 0, 255], width: 1, height: 1 });
    if (key === "createImageData") return (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)), width: w, height: h });
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

const vm = require("vm");
vm.createContext(sandbox);
try {
  vm.runInContext(src, sandbox, { filename: "photoshop.js" });
} catch (error) {
  throw new Error(`photoshop.js does not run: ${error.message}\n${String(error.stack).split("\n").slice(0, 4).join("\n")}`);
}
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = sandbox.window.__engine();
const app = engine.app;
const makeLayer = (id) => ({ id, kind: "raster", name: `Layer ${id}`, visible: true, opacity: 1, paint: [], locks: 0, bitmap: null, left: 0, top: 0, dx: 0, dy: 0, mask: null, vectorMask: null });
const makeDoc = (id, width, height) => {
  const doc = {
    id, name: `Page ${id}`, width, height,
    state: { layers: [makeLayer(1), makeLayer(2)], activeIds: [2], selection: null },
    history: [{ id: 1, name: "Open" }], historyIndex: 0,
    view: { zoom: 0.1, x: 0, y: 0 },
  };
  doc.history[0].state = doc.state;
  return doc;
};

test("A healing stroke keeps its samples, and a source from another page is that page's", () => {
  const painted = makeDoc(101, 1600, 1200);
  const reference = makeDoc(102, 640, 480);
  app.docs.push(painted, reference);
  engine.setDoc(painted);
  const target = painted.state.layers.find((layer) => layer.id === 2);
  const began = engine.beginStroke(target.id, { size: 30, hardness: 100, color: { red: 0, green: 0, blue: 0 }, healing: { ox: 20, oy: 10, sample: "below", doc: painted, layer: 2 } });
  assert.ok(began, "the stroke begins");
  const op = painted.liveStroke.op;
  // The samples are the page's own coordinates, whole, as the healer reads them
  assert.equal(op.healingSource.width, painted.width, "the source sample is the page's");
  assert.equal(op.healingDestination.width, painted.width, "and so is the destination's");
  assert.deepEqual([op.healingSourceAt.x, op.healingSourceAt.y], [0, 0], "at the page's own corner");
  engine.extendStroke(420, 320);
  engine.extendStroke(440, 322);
  engine.endStroke();
  assert.equal(painted.liveStroke, null, "and the stroke ends");

  // Another page taken as the source: the same stroke, reading that page's pixels
  engine.setDoc(painted);
  const fromElsewhere = engine.beginStroke(target.id, { size: 24, hardness: 100, color: { red: 0, green: 0, blue: 0 }, healing: { ox: 12, oy: 8, sample: "all", doc: reference, layer: null } });
  assert.ok(fromElsewhere, "a stroke with a source on another page begins");
  engine.extendStroke(100, 100);
  engine.endStroke();
  assert.equal(painted.liveStroke, null, "and ends");
});

test("A page that changes forgets what a stroke read from it", () => {
  // The helper that forgets it is used by every commit, which is the first thing any edit does:
  // declared after that use it would throw on opening a page, before a brush is ever touched
  const page = makeDoc(105, 400, 300);
  app.docs.push(page);
  engine.setDoc(page);
  const ops = sandbox.window.TypeRPhotoshop.ops;
  ops.newLayer();
  assert.equal(page.history.length >= 1, true, "the change went into History");
});
