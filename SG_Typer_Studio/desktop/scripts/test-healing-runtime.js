// Builds photoshop.js's engine under a stub of the page and paints with it: what a healing stroke
// copies, where a source from another page comes from, and what a big page costs per stroke.
// Reading the source cannot catch a page-sized copy that stalls on a 12000-pixel file; running
// it can.

const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "..", "web", "photoshop.js");
let src = fs.readFileSync(file, "utf8");

// boot() opens documents, reads the settings, starts the tutorial: left to the app. Everything
// above it is built when the file runs, and that is what this test needs.

// The few things a pointer move touches, opened to the test at the end of the module
src = src.slice(0, src.lastIndexOf("})();"));
src += `
  window.__engine = () => ({ beginStroke: ops.beginStroke, extendStroke: ops.extendStroke, endStroke: ops.endStroke, app, healSamples, healingBoxOf, setDoc, rasterCache });
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

test("A healing stroke never copies the whole page", () => {
  const page = makeDoc(101, 12000, 12000);
  app.docs.push(page);
  engine.setDoc(page);
  const op = { t: "stroke", points: [[5000, 5000], [5010, 5000]], size: 60, healing: true, healingPlan: { doc: page, from: null, sample: "below", layerId: 2, ox: -30, oy: -20, dx: 0, dy: 0 } };
  const samples = engine.healSamples({ op }, { left: 4960, top: 4960, width: 100, height: 100 });
  // 12000 x 12000 would be 576 megabytes a sample, and there are two: this is what stalled it
  assert.ok(samples.source.width * samples.source.height < 2000 * 2000, `the sample is the stroke's, not the page's (${samples.source.width} × ${samples.source.height})`);
  assert.equal(samples.source.width, samples.source.height);

  // The stroke goes on: the sample grows, and stays a stroke's size
  op.points.push([5200, 5000]);
  const grown = engine.healSamples({ op }, { left: 4960, top: 4960, width: 300, height: 100 });
  assert.ok(grown.source.width > samples.source.width, "the sample grows with the stroke");
  assert.ok(grown.source.width < 2000, `and still does not take the page (${grown.source.width})`);
});

test("A healing stroke paints and ends cleanly, its samples made to size", () => {
  const page = makeDoc(102, 800, 600);
  app.docs.push(page);
  engine.setDoc(page);
  const target = page.state.layers.find((layer) => layer.id === 2);
  const began = engine.beginStroke(target.id, { size: 30, hardness: 100, color: { red: 0, green: 0, blue: 0 }, healing: { ox: 20, oy: 10, sample: "below", doc: page, layer: 2 } });
  assert.ok(began, "the stroke begins");
  assert.ok(page.liveStroke.op.healingPlan, "with its plan for what it reads");
  assert.equal(page.liveStroke.op.healingSource, undefined, "and no page-sized sample made before it is needed");
  engine.extendStroke(420, 320);
  engine.extendStroke(440, 322);
  const samples = engine.healSamples(page.liveStroke, { left: 400, top: 300, width: 60, height: 40 });
  assert.ok(samples.source.width < page.width, "the sample is smaller than the page");
  engine.endStroke();
  assert.equal(page.liveStroke, null, "and the stroke ends");
});

test("A source taken on another page is that page's, not the one being painted on", () => {
  const painted = makeDoc(103, 900, 700);
  const reference = makeDoc(104, 640, 480);
  app.docs.push(painted, reference);
  engine.setDoc(painted);
  const target = painted.state.layers.find((layer) => layer.id === 2);
  const began = engine.beginStroke(target.id, { size: 24, hardness: 100, color: { red: 0, green: 0, blue: 0 }, healing: { ox: 12, oy: 8, sample: "all", doc: reference, layer: null } });
  assert.ok(began, "a stroke with a source on another page begins");
  const plan = painted.liveStroke.op.healingPlan;
  assert.equal(plan.from, reference, "it reads the other page");
  assert.equal(plan.sample, "all", "with the sampling chosen there");
  // Its samples are made on demand, and are the stroke's size, not either page's
  const samples = engine.healSamples(painted.liveStroke, { left: 100, top: 100, width: 40, height: 40 });
  assert.ok(samples.source.width < Math.max(painted.width, reference.width), "the sample is a stroke's size");
  assert.ok(samples.source.width > 0 && samples.source.height > 0, "and it is there");
  engine.endStroke();
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

test("A Clone Stamp stroke keeps only the layer's part it reaches", () => {
  // The layer before the stroke and the stroke's coverage were whole pages: two gigabytes each on
  // a 12000-pixel file, made at the first dab. That is what made the stamp stall there.
  const page = makeDoc(106, 12000, 12000);
  app.docs.push(page);
  engine.setDoc(page);
  const target = page.state.layers.find((layer) => layer.id === 2);
  const began = engine.beginStroke(target.id, { size: 60, hardness: 100, color: { red: 0, green: 0, blue: 0 }, clone: { ox: 300, oy: 300, sample: "below", doc: page, layer: 2 } });
  assert.ok(began, "the stroke begins");
  engine.extendStroke(6000, 6000);
  engine.extendStroke(6010, 6002);
  const live = page.liveStroke;
  assert.ok(live.base.width < 2000 && live.base.height < 2000, `the kept layer is the stroke's part (${live.base.width} × ${live.base.height})`);
  assert.ok(live.coverage.width < 2000, "and so is its coverage");
  // A long stroke grows what it keeps, half again each way, and stays a stroke's size
  engine.extendStroke(7600, 6002);
  assert.ok(page.liveStroke.base.width < 4000, `it grows with the stroke (${page.liveStroke.base.width})`);
  engine.endStroke();
  assert.equal(page.liveStroke, null, "and the stroke ends");
});

test("Switching pages with a source taken keeps the healing brush working", () => {
  // Alt + click on one tab, draw on another: its samples come from that page, and the stroke
  // ends into History like any other. (The Clone Stamp is left out here: its source is a whole
  // picture of the other page, and a canvas that holds no pixels cannot stand in for one.)
  const first = makeDoc(107, 900, 700);
  const second = makeDoc(108, 800, 600);
  app.docs.push(first, second);
  engine.setDoc(second);
  const target = second.state.layers.find((layer) => layer.id === 2);
  engine.beginStroke(target.id, { size: 24, hardness: 100, color: { red: 0, green: 0, blue: 0 }, healing: { ox: 10, oy: 10, sample: "all", doc: first, layer: null } });
  assert.ok(second.liveStroke, "the stroke began");
  assert.equal(second.liveStroke.op.healingPlan.from, first, "reading the page the source was taken on");
  engine.extendStroke(300, 300);
  engine.extendStroke(310, 305);
  engine.endStroke();
  assert.equal(second.liveStroke, null, "and it ended");
  assert.equal(Boolean(second.history[second.historyIndex].state), true, "with a History step");
  // The page it read is still open, and still itself
  assert.equal(app.docs.includes(first), true, "the page the source was taken on is still open");
});
