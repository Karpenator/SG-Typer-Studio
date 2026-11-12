const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the sandboxed desktop preload exposes Actions without loading package.json", () => {
  let exposed = null;
  const invocations = [];
  const ipcRenderer = {
    invoke: (...args) => { invocations.push(args); return Promise.resolve({ ok: true }); },
    send: () => {},
    on: () => {},
    removeListener: () => {},
  };
  const context = {
    require(id) {
      if (id === "electron") return {
        contextBridge: { exposeInMainWorld: (name, bridge) => { exposed = { name, bridge }; } },
        ipcRenderer,
        webFrame: { setVisualZoomLevelLimits: () => {} },
      };
      throw new Error(`Sandbox rejected require(${id})`);
    },
  };
  vm.runInNewContext(read("desktop/src/preload.js"), context);
  assert.ok(exposed && exposed.name === "TypeRDesktop", "the complete bridge must survive sandboxed preload evaluation");
  assert.deepEqual(Object.keys(exposed.bridge.actions), ["load", "save", "show"]);
  exposed.bridge.actions.show();
  assert.deepEqual(invocations, [["actions-show"]]);
});

test("Action sets and actions have persistent keyboard shortcuts and a desktop folder", () => {
  const actions = read("web/actions.js");
  for (const text of ['T("Assign to Key")', 'T("Show on Disk")', "summary.addEventListener(\"contextmenu\"", "head.addEventListener(\"contextmenu\"", "clearOtherShortcuts", "window.addEventListener(\"keydown\""]) {
    assert.ok(actions.includes(text), `missing ${text}`);
  }
  assert.ok(actions.includes("shortcut: typeof set.shortcut") && actions.includes("shortcut: typeof action.shortcut"));
  assert.ok(actions.includes("desktop.load()") && actions.includes("desktop.save(snapshot)"));
  const preload = read("desktop/src/preload.js");
  assert.ok(preload.includes('ipcRenderer.invoke("actions-load")'));
  assert.ok(preload.includes('ipcRenderer.invoke("actions-save", sets)'));
  assert.ok(preload.includes('ipcRenderer.invoke("actions-show")'));
  const main = read("desktop/src/main.js");
  assert.ok(main.includes('path.join(app.getPath("userData"), "Actions")'));
  assert.ok(main.includes("shell.openPath(actionsFolder())"));
  assert.ok(main.includes('ipcMain.handle("actions-save"'));
});

test("the Photoshop engine evaluates and keeps its public text helpers", () => {
  const context2d = new Proxy({}, {
    get(target, key) {
      if (key === "measureText") return (text) => ({ width: String(text).length * 8 });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
      if (key === "getImageData") return (x, y, width = 1, height = 1) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
      return target[key] || (() => {});
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const fonts = new Proxy({ BUILTIN: [], generation: 0 }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "resolve") return () => ({ css: "Wildjess", weight: 400 });
      if (key === "withoutLigatures") return () => null;
      if (key === "list") return () => [];
      return () => {};
    },
  });
  const window = {
    TypeRFonts: fonts,
    TYPER_I18N: { lang: "en" },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  const document = {
    createElement: () => ({ getContext: () => context2d, width: 0, height: 0 }),
    addEventListener() {}, removeEventListener() {},
  };
  const sandbox = {
    window, document, console, localStorage: window.localStorage,
    ImageData: class {}, Image: class {}, Path2D: class {}, DOMMatrixReadOnly: class {}, OffscreenCanvas: class {},
    URL, TextEncoder, TextDecoder, Uint8Array, Uint8ClampedArray, ArrayBuffer, Blob,
    requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout, clearTimeout,
  };
  vm.runInNewContext(read("web/photoshop.js"), sandbox);
  assert.ok(window.TypeRPhotoshop, "the complete engine must evaluate without missing exports");
  assert.equal(typeof window.TypeRPhotoshop.wrapWords, "function");
  assert.deepEqual(Array.from(window.TypeRPhotoshop.wrapWords("one two three", { size: 12 }, 40, 72)), ["one", "two", "three"]);
});

test("TypeR Block and Short follow Photoshop's paragraph-to-point insertion pipeline", () => {
  const engine = read("web/photoshop.js");
  assert.ok(engine.includes("createTextLayerInSelection(data, point)"), "the panel's point argument must reach the host");
  assert.ok(engine.includes("createTextLayersInStoredSelections(data, point)"), "multi-bubble insertion accepts its fallback point mode");
  assert.ok(engine.includes("data.pointModes && data.pointModes[i] !== undefined"), "each style's Block/Short choice is honoured");
  assert.ok(engine.includes("classicParams(doc, Object.assign({}, data, { textSizeOverride: size }), openedBubbleBounds(doc, selection), Boolean(point))"), "classic insertion centres on the opened bubble, not its tail");
  assert.ok(engine.includes('lt.textShape = [{ textType: "point", orientation: "horizontal" }];\n    } else {\n      // Photoshop then fits the paragraph box vertically'), "only Short converts the laid-out paragraph to point text");
  assert.ok(engine.includes("const rows = layout.wrapped.map((runs) => ({ runs }));"), "Short preserves the actual renderer's soft wraps");
  assert.ok(engine.includes("lt.textStyleRange = rangesOfLines(rows, base);"), "inserted line breaks preserve rich-text ranges");
  assert.ok(engine.includes("const wrapWords ="), "the independent public wrapping helper remains available");
  assert.ok(!/classicParams[\s\S]*?const lines = wrapWords/.test(engine), "classic insertion uses the renderer's layout rather than the helper");
});

test("What is New follows GitHub and About credits the original projects", () => {
  const news = read("web/whats-new.js");
  assert.ok(news.includes("data.github ? await fetchJson(data.github, 6000)"));
  assert.ok(news.includes("latest[0].commit.message.trim()"));
  assert.ok(news.includes('link.href = note.url; link.target = "_blank"'));
  const manifest = JSON.parse(read("web/whats-new.json"));
  assert.match(manifest.github, /^https:\/\/api\.github\.com\/repos\/Karpenator\/Syndicate_Typer_Studio\/commits/);
  const app = read("web/app.js");
  for (const url of ["https://github.com/ScanR/TypeR", "https://github.com/ScanR/TypeR-Studio", "https://github.com/storytold/photocraft"]) assert.ok(app.includes(url));
  assert.ok(app.includes('["Typer Studio", "https://github.com/ScanR/TypeR-Studio"'));
  assert.ok(app.includes('{ name: "BOT" }'));
  assert.ok(app.includes("Built on the ideas and source code of the original projects."));
  const bridge = read("web/bridge.js");
  const retired = bridge.match(/const RETIRED_EXTERNAL = \/(.+)\/i;/);
  assert.ok(retired && !retired[1].includes("ScanR"), "credited project pages are not blocked");
});

test("gradient end pickers are non-modal, movable and sample the page without blocking navigation", () => {
  const app = read("web/app.js");
  const retouch = read("web/retouch.js");
  assert.ok(retouch.includes("doubleClick(event)"), "live gradient handles own their double-click");
  assert.ok(retouch.includes('App().openColorPicker(input)'), "the double-click opens that end's actual colour field");
  assert.ok(app.includes("window.TypeRRetouch.doubleClick(event)"));
  assert.ok(app.includes("modal.show();"), "the picker must not inert the stage");
  assert.ok(!app.includes("modal.showModal();\n    hexField.focus();"), "the colour picker is no longer modal");
  assert.ok(app.includes('const STORE_PICKER_POSITION = "typer.web.picker.position"'));
  assert.ok(app.includes("keepPickerPosition(modal);"), "dragging and closing remember the viewport position");
  assert.ok(app.includes("sampleColorForPicker(color);"), "stage colours go to the open picker");
  assert.ok(app.includes("Boolean(sampleColorForPicker)"), "the stage becomes an eyedropper while the picker is open");
  assert.ok(app.includes("modalBlocksPage() || ui.layerStyle"), "Space and other navigation keys still reach the page");
});

test("Magic Wand and selection cursors are distinct and contrast with the page beneath them", () => {
  const app = read("web/app.js");
  const css = read("web/app.css");
  assert.ok(!css.includes('.stage[data-tool="wand"], .stage[data-tool="magicEraser"]'));
  assert.ok(css.includes('.stage[data-tool="wand"] { cursor: url("data:image/svg+xml,'));
  assert.ok(app.includes('app.tool === "wand" ? "wand" : "crosshair"'));
  assert.ok(app.includes('docCanvas.getContext("2d").getImageData(x, y, 1, 1).data'));
  assert.ok(app.includes('lightness >= 150 ? "#000000" : "#ffffff"'));
});

test("Help opens the official SG Typer Studio Discord invite externally", () => {
  const app = read("web/app.js");
  assert.ok(app.includes('{ label: "Discord", action: () => window.open("https://discord.gg/UVF2264tYn", "_blank", "noopener,noreferrer") }'));
  const help = app.match(/\["Help", \[([\s\S]*?)\]\],/);
  assert.ok(help && help[1].includes('label: "Discord"'), "Discord belongs to the Help menu");
  const main = read("desktop/src/main.js");
  assert.ok(main.includes('if (kind === "https:" || kind === "http:" || kind === "mailto:") shell.openExternal(url);'));
});

test("Help always shows update checking and no longer contains What's New", () => {
  const app = read("web/app.js");
  const help = app.match(/\["Help", \[([\s\S]*?)\]\],/);
  assert.ok(help, "Help menu exists");
  assert.ok(!help[1].includes('label: "What\'s New"'));
  assert.ok(help[1].includes('{ label: "Check for Updates…", action: checkForUpdates }'));
  assert.ok(!help[1].includes("DesktopUpdates ?"), "the menu item is not hidden by bridge detection");
  assert.ok(app.includes('window.open(UPDATE_RELEASES, "_blank", "noopener,noreferrer")'));
  assert.ok(app.includes("https://github.com/Karpenator/SG-Typer-Studio/releases"));
});

test("touch and pen sliders keep focus until the drag ends", () => {
  const app = read("web/app.js");
  assert.ok(app.includes('event.pointerType === "mouse" || slider.type !== "range"'));
  assert.ok(app.includes("slider.focus({ preventScroll: true })"));
  assert.ok(app.includes('window.addEventListener("pointercancel", release, true)'));
  assert.ok(app.includes("setTimeout(() =>"), "blur happens after the slider's own change");
});

test("upstream Spot Healing guards empty layers and preserves periodic screentones", () => {
  const engine = read("web/photoshop.js");
  assert.ok(engine.includes("if (!mask.some((hole, i) => !hole && data[i * 4 + 3] >= 128)) return \"none\";"));
  assert.ok(engine.includes("const screentoned = (data, mask, width, height)"));
  assert.ok(engine.includes("const ring = screentoned(data, mask, width, height);"));
  assert.ok(engine.includes("repeats.some((other) =>"), "periodicity must repeat in two directions");
  assert.ok(engine.includes("spread >= toneSpread / 4 && spread <= toneSpread * 2"));
});

test("the visible product name uses spaces without abandoning its old profile", () => {
  const html = read("web/index.html");
  assert.ok(html.includes("<title>SG Typer Studio</title>"));
  assert.ok(html.includes('<span class="mbar__title">SG Typer Studio</span>'));
  const pkg = JSON.parse(read("desktop/package.json"));
  assert.equal(pkg.productName, "SG Typer Studio");
  assert.equal(pkg.build.productName, "SG Typer Studio");
  const main = read("desktop/src/main.js");
  assert.ok(main.includes('path.join(app.getPath("appData"), "SG_Typer_Studio")'));
  assert.ok(main.includes('path.join(app.getPath("appData"), "TypeR Studio")'));
});

test("OpenRouter and custom local image APIs have the intended request and credential contracts", () => {
  const source = read("web/generative.js");
  const window = {
    localStorage: { getItem: () => null, setItem: () => {} },
    dispatchEvent: () => {},
  };
  const context = { window, localStorage: window.localStorage, console, URL, CustomEvent: function () {}, setTimeout, clearTimeout, FormData, Blob, fetch };
  vm.runInNewContext(source, context);
  const Gen = window.TypeRGenerative;
  assert.ok(Gen.SERVICES.openrouter && Gen.SERVICES.custom.keyOptional);
  assert.equal(Gen.slugOf("openrouter", "openai/gpt-image-1"), "openai/gpt-image-1");
  assert.equal(Gen.slugOf("custom", "my-local-model"), "my-local-model");
  const custom = { service: "custom", keys: { custom: "" }, endpoints: { custom: "http://localhost:1234/v1" }, models: { custom: "editor" }, custom: {} };
  assert.equal(Gen.ready(custom), true);
  assert.equal(Gen.endpointOf(custom), "http://localhost:1234/v1");
  assert.throws(() => Gen.endpointOf({ endpoints: { custom: "ftp://localhost" } }), (error) => error.kind === "endpoint");
  assert.ok(source.includes('"https://openrouter.ai/api/v1/chat/completions"'));
  assert.ok(source.includes('modalities: ["image", "text"]'));
  assert.ok(source.includes('`${base}/images/edits`'));
  assert.ok(source.includes("const headers = key ? { Authorization: `Bearer ${key}` } : {};"));
  assert.ok(source.includes("/^data:(image\\/[\\w.+-]+);base64,(.+)$/s"));
});
