// Runs the whole of app.js under a stub of the page and does what a user does with a source taken
// from another tab: picks the tool, Alt + clicks on one page, switches to another, paints. Reading
// the source cannot show that the source survives the switch; running it can.

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
    setTool, ui, app, stamp, healing, showStampPreview, switchDoc,
    ringShown: () => !ui.brushRing.hasAttribute("hidden"),
    ringClass: () => ui.stage.classList.contains("is-ring"),
    brushAt: () => { brushAt = [100, 100]; },
  };
})();
`;

// A page, as much of one as the file touches while it is built: elements that hold classes and
// attributes, a context that paints nothing, and a window with the modules the app expects.
const listeners = {};
const calls = [];
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
    // Reads that expect a list get one, everything else answers as a call. A stroke is recorded:
    // what it was told to read is the whole point of this test
    const ops = new Proxy({}, {
      get: (t, k) => {
        if (/(Ids|areas|boxes|rows|list|all)$/.test(String(k))) return empty;
        if (k === "beginStroke") return (id, fields) => { calls.push({ id, fields }); return true; };
        return noop;
      },
    });
    const layer = new Proxy({}, { get: () => noop });
    const base = { app, ops, layer, announce() {}, on() {}, TEXT_LANGUAGES: ["en"], off() {}, paintDoc() {}, canvasFits: () => true, setActiveDoc: (doc) => { app.doc = doc; }, referencePicture: () => ({ width: 400, height: 300 }) };
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
  vm.runInContext(src, sandbox, { filename: "app.js" });
} catch (error) {
  throw new Error(`app.js does not run: ${error.message}\n${String(error.stack).split("\n").slice(0, 4).join("\n")}`);
}
const t = sandbox.window.__test;
const app = t.app;
const stageListeners = {};
Object.keys(listeners).forEach((k) => { if (k.startsWith("stage:")) stageListeners[k.slice(6)] = listeners[k]; });

const raster = (id) => ({ id, kind: "raster", name: `Layer ${id}`, visible: true, opacity: 1, paint: [], locks: 0 });
const makeDoc = (id, name) => ({ id, name, width: 400, height: 300, view: { zoom: 1, x: 0, y: 0 }, state: { layers: [raster(id * 10 + 1)], activeIds: [id * 10 + 1], selection: null }, history: [{ id: 1 }], historyIndex: 0 });
const A = makeDoc(7, "A.png");
const B = makeDoc(9, "B.png");
A.history[0].state = A.state;
B.history[0].state = B.state;
app.docs.push(A, B);
app.brush = { size: 40, hardness: 100, opacity: 100, flow: 100, spacing: 10 };
t.ui.editor.hidden = true;

const fire = (type, extra) => {
  const event = Object.assign({ clientX: 120, clientY: 110, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, button: 0, pointerType: "mouse", pointerId: 1, target: { closest: () => null }, preventDefault() {}, stopPropagation() {} }, extra);
  (stageListeners[type] || []).forEach((listener) => listener(event));
};
// The tab bar's own way of switching, which is what a user clicks
const shown = (doc) => t.switchDoc(doc);

const test = require("node:test");
const assert = require("node:assert/strict");

test("A source taken with Alt on one tab is used on another", () => {
  t.setTool("stamp");
  shown(A);
  fire("pointerdown", { altKey: true });
  assert.equal(t.stamp.doc, A, "the source is the page clicked on");
  assert.equal(t.stamp.layer, A.state.layers[0].id, "with its layer, for Current Layer");

  // The tab is switched: nothing about the source changes
  shown(B);
  assert.equal(t.stamp.doc, A, "switching a tab leaves the source where it was");

  // The first click on this page paints from it
  calls.length = 0;
  fire("pointerdown", { clientX: 200, clientY: 150 });
  const stroke = calls.find((call) => call.fields && call.fields.clone);
  assert.ok(stroke, "a stroke began");
  assert.equal(stroke.fields.clone.doc, A, "reading the page the source was taken on");
  assert.equal(stroke.fields.clone.layer, A.state.layers[0].id, "its layer, sampled there");
  // The source pixel under the first click here: the offset is from this page, not the click on A
  assert.deepEqual([stroke.fields.clone.ox, stroke.fields.clone.oy], [120 - 200, 110 - 150], "the offset is counted from the first click on this page");
  fire("pointerup", {});
});

test("The Healing Brush reads the same page, and says so under the brush", () => {
  t.setTool("healing");
  shown(A);
  fire("pointerdown", { altKey: true });
  assert.equal(t.healing.doc, A, "its source is that page too");
  shown(B);
  calls.length = 0;
  fire("pointerdown", { clientX: 210, clientY: 160 });
  const stroke = calls.find((call) => call.fields && call.fields.healing);
  assert.ok(stroke, "a healing stroke began");
  assert.equal(stroke.fields.healing.doc, A, "reading the source page");
  // A source on another page is not drawn on this one, but it is shown under the brush: its own
  // pixels, from its own place on that page
  assert.doesNotThrow(() => t.showStampPreview({ clientX: 210, clientY: 160, pointerType: "mouse" }), "the preview draws with a source on another page");
  fire("pointerup", {});
});

test("A source whose page is closed says so, rather than painting nothing", () => {
  t.setTool("healing");
  shown(A);
  fire("pointerdown", { altKey: true });
  shown(B);
  app.docs.splice(app.docs.indexOf(A), 1);
  calls.length = 0;
  assert.doesNotThrow(() => fire("pointerdown", { clientX: 220, clientY: 170 }), "the click does not throw");
  assert.equal(calls.length, 0, "and paints nothing");
  assert.equal(t.healing.doc, null, "the source is let go with its page");
});
