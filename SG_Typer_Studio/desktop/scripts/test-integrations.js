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
  assert.ok(app.includes('wand: SVG(wandPaths("currentColor"))'), "toolbar uses the Photoshop-like tipped wand");
  assert.ok(app.includes('kind === "wand" ? "18 5"'), "the cursor hotspot is the wand's sparkling tip");
  assert.ok(css.includes("fill='%23000' stroke='none'") && css.includes(') 18 5, crosshair'));
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

test("desktop OpenRouter discovery and generation use the CORS-independent main-process bridge", async () => {
  const source = read("web/generative.js");
  const calls = [];
  const installs = [];
  const window = {
    localStorage: { getItem: () => null, setItem: () => {} }, dispatchEvent: () => {},
    TypeRDesktop: { localAI: {
      onProgress: () => {},
      status: async () => ({ available: true, models: { "flux2-klein-4b": { installed: false, download: 100 } } }),
      install: async (id, model) => { installs.push({ id, model }); return { ok: true, value: { installed: true } }; },
    }, openRouter: {
      request: async (id, request) => {
        calls.push({ id, request });
        if (request.route === "models") return { ok: true, value: { data: [{ id: "vendor/desktop-image", name: "Desktop Image", architecture: { input_modalities: ["image", "text"], output_modalities: ["image"] }, supported_parameters: { input_references: { type: "range", min: 0, max: 2 }, aspect_ratio: { type: "enum", values: ["3:2"] } } }] } };
        return { ok: true, value: { data: [{ b64_json: "AA==" }], usage: { cost: 0.01 } } };
      },
      cancel: () => {},
    } },
  };
  const context = { window, localStorage: window.localStorage, console, URL, CustomEvent: function () {}, setTimeout, clearTimeout, FormData, Blob, atob, DOMException,
    createImageBitmap: async () => ({ width: 1, height: 1 }),
    fetch: async () => { throw new Error("renderer CORS failure"); },
  };
  vm.runInNewContext(source.replace("window.TypeRGenerative = { SERVICES,", "window.TypeRGenerative = { __viaOpenRouter: viaOpenRouter, SERVICES,"), context);
  const Gen = window.TypeRGenerative;
  const found = await Gen.discoverOpenRouter("secret");
  assert.equal(found[0][0], "vendor/desktop-image");
  await Gen.__viaOpenRouter({ key: "secret", model: "vendor/desktop-image", prompt: "edit", image: { mime: "image/png", data: "AAAA" }, ratio: "16:9", signal: null });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].request.route, "models");
  assert.equal(calls[1].request.route, "images");
  assert.equal(calls[1].request.body.aspect_ratio, "3:2");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].request.body.input_references)), [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }]);
  assert.ok(read("desktop/src/main.js").includes('ipcMain.handle("openrouter-request"'));
  assert.ok(read("desktop/src/preload.js").includes('ipcRenderer.invoke("openrouter-request", id, request)'));
  const installed = await Gen.localInstall("flux2-klein-4b", () => {}, null);
  assert.equal(installed.installed, true);
  assert.equal(installs.length, 1);
  assert.equal(installs[0].model, "flux2-klein-4b");
});

test("OpenRouter uses its dedicated Image API with an input reference; custom local API keeps its credential contract", async () => {
  const source = read("web/generative.js");
  const window = {
    localStorage: { getItem: () => null, setItem: () => {} },
    dispatchEvent: () => {},
  };
  const requests = [];
  const context = {
    window, localStorage: window.localStorage, console, URL, CustomEvent: function () {}, setTimeout, clearTimeout, FormData, Blob, atob,
    createImageBitmap: async () => ({ width: 1, height: 1 }),
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (String(url).endsWith("/images/models")) return { ok: true, json: async () => ({ data: [
        { id: "vendor/new-image", name: "New Image", architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] }, supported_parameters: { aspect_ratio: { type: "enum", values: ["auto", "1:1", "1:8"] }, resolution: { type: "enum", values: ["1K", "3K"] }, input_references: { type: "range", min: 0, max: 4 } } },
        { id: "vendor/text-only", architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
        { id: "vendor/text-to-image", architecture: { input_modalities: ["text"], output_modalities: ["image"] } },
      ] }) };
      return { ok: true, json: async () => ({ data: [{ b64_json: "AA==", media_type: "image/png" }], usage: { cost: 0.01 } }) };
    },
  };
  const testSource = source.replace("window.TypeRGenerative = { SERVICES,", "window.TypeRGenerative = { __viaOpenRouter: viaOpenRouter, __viaCompatible: viaCompatible, SERVICES,");
  vm.runInNewContext(testSource, context);
  const Gen = window.TypeRGenerative;
  assert.ok(Gen.SERVICES.openrouter && Gen.SERVICES.custom.keyOptional);
  assert.equal(Gen.slugOf("openrouter", "openai/gpt-image-1"), "openai/gpt-image-1");
  assert.ok(Gen.modelsOf({ custom: {} }, "openrouter").some(([id]) => id === "google/gemini-3.1-flash-image"));
  assert.ok(Gen.modelsOf({ custom: {} }, "openrouter").some(([id]) => id === "bytedance-seed/seedream-5-5"));
  assert.ok(Gen.ratiosFor("bytedance-seed/seedream-5-5").some(({ label }) => label === "1:2"));
  assert.equal(Gen.slugOf("custom", "my-local-model"), "my-local-model");
  const custom = { service: "custom", keys: { custom: "" }, endpoints: { custom: "http://localhost:1234/v1" }, models: { custom: "editor" }, custom: {} };
  assert.equal(Gen.ready(custom), true);
  assert.equal(Gen.endpointOf(custom), "http://localhost:1234/v1");
  assert.throws(() => Gen.endpointOf({ endpoints: { custom: "ftp://localhost" } }), (error) => error.kind === "endpoint");

  const result = await Gen.__viaOpenRouter({ key: "secret", model: "openai/gpt-image-1", prompt: "remove the text", image: { mime: "image/png", data: "AAAA" }, ratio: "16:9", size: "2K", quality: "high", signal: null });
  assert.equal(result.picture.width, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://openrouter.ai/api/v1/images");
  assert.equal(requests[0].options.headers.Authorization, "Bearer secret");
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.model, "openai/gpt-image-1");
  assert.equal(body.prompt, "remove the text");
  assert.equal(body.n, 1);
  assert.equal(body.modalities, undefined, "image-only models must not be asked for text output");
  assert.equal(body.messages, undefined, "the dedicated Image API does not use chat messages");
  assert.deepEqual(body.input_references, [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }]);
  assert.equal(body.aspect_ratio, "3:2", "GPT Image gets the nearest supported aspect ratio");
  assert.equal(body.quality, "high");
  assert.equal(body.resolution, undefined, "GPT Image does not accept the resolution field");

  await Gen.__viaOpenRouter({ key: "secret", model: "google/gemini-3.1-flash-image", prompt: "edit", image: { mime: "image/png", data: "AAAA" }, ratio: "1:4", size: "4K", signal: null });
  const gemini = JSON.parse(requests[1].options.body);
  assert.equal(gemini.aspect_ratio, "1:4");
  assert.equal(gemini.resolution, "4K");
  assert.equal(gemini.quality, undefined);
  await Gen.__viaOpenRouter({ key: "secret", model: "bytedance-seed/seedream-5-5", prompt: "edit", image: { mime: "image/png", data: "AAAA" }, ratio: "1:2", size: "1.5K", signal: null });
  const seedream = JSON.parse(requests[2].options.body);
  assert.equal(seedream.aspect_ratio, "1:2");
  assert.equal(seedream.resolution, "1.5K");
  assert.equal(requests.length, 3);
  const discovered = await Gen.discoverOpenRouter("secret");
  assert.deepEqual(JSON.parse(JSON.stringify(discovered)), [["vendor/new-image", "New Image"]], "only image-output models that accept an image can edit a selection");
  assert.equal(requests[3].options.headers.Authorization, "Bearer secret");
  assert.ok(Gen.ratiosFor("vendor/new-image").every(({ label, value }) => label !== "auto" && Number.isFinite(value)));
  await Gen.__viaOpenRouter({ key: "secret", model: "vendor/new-image", prompt: "edit", image: { mime: "image/png", data: "AAAA" }, ratio: "1:8", size: "3K", signal: null });
  const dynamic = JSON.parse(requests[4].options.body);
  assert.equal(dynamic.aspect_ratio, "1:8");
  assert.equal(dynamic.resolution, "3K");
  assert.ok(Gen.modelsOf({ models: { openrouter: "vendor/manual-image" }, custom: {} }, "openrouter").some(([id]) => id === "vendor/manual-image"));

  const localImage = { mime: "image/png", data: "AAAA" };
  const localSettings = { endpoints: { custom: "http://localhost:1234/v1/images" }, apiModes: { custom: "json" } };
  await Gen.__viaCompatible({ key: "", model: "local-model", prompt: "edit", image: localImage, settings: localSettings, signal: null });
  assert.equal(requests[5].url, "http://localhost:1234/v1/images");
  assert.equal(requests[5].options.headers.Authorization, undefined);
  const local = JSON.parse(requests[5].options.body);
  assert.equal(local.model, "local-model");
  assert.deepEqual(local.input_references, [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }]);
  assert.equal(local.aspect_ratio, undefined, "local requests stay minimal without capability discovery");
  await Gen.__viaCompatible({ key: "local-key", model: "local-model", prompt: "edit", image: localImage, settings: { endpoints: { custom: "http://localhost:1234/v1" }, apiModes: { custom: "edit" } }, signal: null });
  assert.equal(requests[6].url, "http://localhost:1234/v1/images/edits");
  assert.equal(requests[6].options.headers.Authorization, "Bearer local-key");
  assert.equal(requests[6].options.body.get("model"), "local-model");
  assert.equal(requests[6].options.body.get("prompt"), "edit");
  assert.equal(requests[6].options.body.get("image").type, "image/png");
  assert.deepEqual({ ...Gen.costOf({}, "openrouter", "bytedance-seed/seedream-5-5", { usage: { cost: 0.04 } }) }, { usd: 0.04, counted: true });

  assert.ok(source.includes('`${base}/images/edits`'));
  assert.ok(source.includes("const headers = key ? { Authorization: `Bearer ${key}` } : {};"));
  assert.ok(source.includes("/^data:(image\\/[\\w.+-]+);base64,(.+)$/s"));
});
