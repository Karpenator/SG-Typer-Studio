const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "web/workspace.js"), "utf8");
const colorSource = fs.readFileSync(path.join(root, "web/color.js"), "utf8");

class Classes {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.values.has(name) : Boolean(force);
    if (on) this.values.add(name); else this.values.delete(name);
    return on;
  }
}
class Element {
  constructor(tag = "div", id = "") {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.style = {};
    this.dataset = {};
    this.classList = new Classes();
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.attributes = {};
    this.hidden = false;
    this.textContent = "";
    this.clientWidth = id === "work" ? 1400 : 0;
    this.clientHeight = id === "work" ? 900 : 0;
    this.offsetWidth = 300;
    this.offsetHeight = 250;
  }
  set className(value) { this.classList = new Classes(); value.split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name)); }
  get className() { return [...this.classList.values].join(" "); }
  get firstChild() { return this.children[0] || null; }
  append(...items) { items.forEach((item) => this.appendChild(item)); }
  appendChild(item) {
    if (item.parentNode) item.parentNode.children = item.parentNode.children.filter((child) => child !== item);
    item.parentNode = this;
    if (this.id === "workspace-rail") item.offsetTop = this.children.length * 35 + 5;
    this.children.push(item);
    return item;
  }
  insertBefore(item) { return this.appendChild(item); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== listener); }
  setAttribute(name, value) { this.attributes[name] = value; }
  matches(selector) {
    if (selector.startsWith(".")) return selector.slice(1).split(".").every((name) => this.classList.contains(name));
    if (selector.startsWith("[")) {
      const match = selector.match(/^\[data-panel="([^"]+)"\]$/);
      return Boolean(match && this.dataset.panel === match[1]);
    }
    return false;
  }
  closest(selector) {
    for (let item = this; item; item = item.parentNode) if (selector.split(", ").some((part) => item.matches(part))) return item;
    return null;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const out = [];
    const match = (item) => {
      if (selector === ".dock__head > span") return item.tagName === "SPAN" && item.parentNode && item.parentNode.classList.contains("dock__head");
      if (selector.includes(", ")) return selector.split(", ").some((part) => match.call({ }, part));
      return item.matches(selector);
    };
    const visit = (item) => {
      for (const child of item.children) {
        if (selector.includes(", ") ? selector.split(", ").some((part) => child.matches(part)) : match(child)) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
  getBoundingClientRect() {
    if (this.id === "work") return { left: 0, top: 0, width: 1400, height: 900 };
    return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0, width: parseFloat(this.style.width) || this.offsetWidth, height: parseFloat(this.style.height) || this.offsetHeight };
  }
  fire(type, event = {}) { for (const listener of this.listeners[type] || []) listener(event); }
}

function workspace(saved) {
  const ids = ["work", "tools", "dock-typer", "pane-navigator", "pane-color", "pane-styles", "pane-brushes", "pane-actions", "pane-layers", "pane-character", "pane-sfx", "breaks", "pane-history"];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element("section", id)]));
  for (const id of ids.filter((id) => id !== "work")) {
    const head = new Element("div");
    head.className = "dock__head";
    const title = new Element("span");
    title.textContent = id;
    head.appendChild(title);
    elements[id].appendChild(head);
  }
  const docs = new Element("div", "docs");
  elements.work.appendChild(docs);
  elements.work.querySelector = (selector) => selector === ".docs" ? docs : Element.prototype.querySelector.call(elements.work, selector);
  const listeners = {};
  const storage = new Map();
  if (saved) storage.set("typer.web.layout", JSON.stringify(saved));
  const window = {
    TypeRShell: { touch: false, onChange() {} },
    TypeRPhotoshop: { announce() {} },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    addEventListener: (type, listener) => { (listeners[type] ||= []).push(listener); },
    removeEventListener: (type, listener) => { listeners[type] = (listeners[type] || []).filter((item) => item !== listener); },
  };
  const document = { getElementById: (id) => elements[id] || null, createElement: (tag) => new Element(tag) };
  const context = {
    window, document, console,
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    TypeRShell: { touch: false, onChange() {} },
    TypeRPhotoshop: { announce() {} },
  };
  vm.runInNewContext(source, context);
  window.TypeRWorkspace.init((text) => text);
  return {
    window, elements, listeners,
    saved: () => JSON.parse(storage.get("typer.web.layout")),
    clickRail(id) {
      const rail = elements.work.children.find((item) => item.id === "workspace-rail");
      const target = rail.children.find((item) => item.dataset.panel === id);
      assert.ok(target, `missing rail button ${id}`);
      target.fire("click");
    },
  };
}

const oldLayout = () => ({
  version: 1,
  tools: "left",
  columns: { left: { width: 250, panels: [] }, middle: { width: 360, panels: ["typer"] }, right: { width: 250, panels: ["navigator", "styles", "layers"] } },
  heights: { typer: 500, navigator: 200, styles: 250, layers: 250, brushes: 300, actions: 220, character: 220, sfx: 300, breaks: 250, history: 180 },
  hidden: {}, floating: {}, tabs: {}, order: [], dockOf: {}, sideShown: null,
});

test("Color conversions preserve primaries, greyscale and arbitrary RGB values", () => {
  const context = { window: {} };
  vm.runInNewContext(colorSource, context);
  const api = context.window.TypeRColor;
  const rgb = (h, s, v) => ({ ...api.hsbToRgb(h, s, v) });
  assert.deepEqual(rgb(0, 100, 100), { r: 255, g: 0, b: 0 });
  assert.deepEqual(rgb(120, 100, 100), { r: 0, g: 255, b: 0 });
  assert.deepEqual(rgb(240, 100, 100), { r: 0, g: 0, b: 255 });
  assert.deepEqual(rgb(42, 0, 50), { r: 128, g: 128, b: 128 });
  for (const rgb of [{ r: 18, g: 203, b: 91 }, { r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }, { r: 126, g: 48, b: 210 }]) {
    const hsb = api.rgbToHsb(rgb.r, rgb.g, rgb.b);
    assert.deepEqual({ ...api.hsbToRgb(hsb.h, hsb.s, hsb.v) }, rgb);
  }
  assert.equal(api.hex({ r: 0, g: 170, b: 255 }), "#00aaff");
});

test("Version 1 docks migrate without losing or duplicating panels", () => {
  const run = workspace(oldLayout());
  run.window.TypeRWorkspace.setVisible("history", true);
  const saved = run.saved();
  assert.equal(saved.version, 2);
  assert.deepEqual(Object.keys(saved.columns).sort(), ["left", "right"]);
  const placements = [...saved.columns.left.panels, ...saved.columns.right.panels, ...Object.keys(saved.floating), ...saved.rail];
  const tabMembers = Object.values(saved.tabs).flatMap((group) => group.panels);
  for (const id of ["typer", "navigator", "color", "styles", "brushes", "actions", "layers", "character", "sfx", "breaks", "history"]) {
    assert.equal(placements.filter((item) => item === id).length + (tabMembers.includes(id) && !placements.includes(id) ? 1 : 0), 1, id);
  }
  assert.ok(saved.columns.right.panels.includes("typer"));
  assert.ok(saved.columns.right.panels.includes("navigator"));
  assert.ok(saved.columns.right.panels.includes("color"), "new Color panel is added to an old layout");
});

test("Rail icon opens and closes one persistent left-hand flyout", () => {
  const run = workspace();
  run.clickRail("styles");
  assert.equal(run.elements["pane-styles"].hidden, false);
  assert.ok(run.elements["pane-styles"].classList.contains("is-rail-flyout"));
  assert.ok(parseFloat(run.elements["pane-styles"].style.left) + parseFloat(run.elements["pane-styles"].style.width) < 1400);
  let saved = run.saved();
  assert.equal(saved.railOpen, "styles");
  assert.ok(saved.rail.includes("styles"));
  assert.ok(!saved.columns.right.panels.includes("styles"));
  run.clickRail("styles");
  assert.equal(run.elements["pane-styles"].hidden, true);
  assert.equal(run.saved().railOpen, null);
  run.clickRail("brushes");
  assert.equal(run.saved().railOpen, "brushes");
  assert.equal(run.elements["pane-styles"].hidden, true);
});

test("Dragging a docked Color panel to the rail removes its old dock and opens its flyout", () => {
  const run = workspace();
  const panel = run.elements["pane-color"];
  const head = panel.querySelector(".dock__head");
  const box = panel.getBoundingClientRect();
  const event = { button: 0, clientX: box.left + 30, clientY: box.top + 10, target: head, preventDefault() {} };
  head.fire("pointerdown", event);
  for (const listener of run.listeners.pointermove || []) listener({ clientX: 1390, clientY: 80 });
  for (const listener of run.listeners.pointerup || []) listener({ clientX: 1390, clientY: 80 });
  const saved = run.saved();
  assert.ok(saved.rail.includes("color"));
  assert.equal(saved.railOpen, "color");
  assert.ok(!saved.columns.right.panels.includes("color"));
  assert.ok(!saved.floating.color);
  assert.ok(panel.classList.contains("is-rail-flyout"));
  assert.equal(panel.hidden, false);
});
