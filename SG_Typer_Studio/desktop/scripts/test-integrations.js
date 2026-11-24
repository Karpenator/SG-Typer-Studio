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

test("a new selection starts with the full Generative Fill prompt and controls", () => {
  const source = read("web/app.js");
  assert.ok(source.includes('const gen = { open: true, prompt: "", focus: false };'), "the prompt must not start collapsed after an update");
  assert.ok(source.includes("taskBar.append(back, modelPick, input, go, settingsButton, separator(), deselect, separator(), hide);"));
  assert.ok(source.includes('iconButton("settings", T("Generative Fill settings")'));
  assert.ok(source.includes('const setTaskBar = (on) =>'));
});

test("Generate goes to the model again when a plain, white area is selected after a generation", async () => {
  // The text detection's areas tell which parts of a selection lie on a plain background: white,
  // here, as a page is left after a generation over white.
  const maskWindow = { addEventListener() {}, removeEventListener() {}, localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(read("web/textmask.js"), { window: maskWindow, document: { addEventListener() {}, visibilityState: "visible" }, console, setTimeout, clearTimeout, fetch: async () => { throw new Error("offline"); }, URL, CustomEvent: function () {} });
  const Mask = maskWindow.TypeRTextMask;
  const width = 40;
  const height = 20;
  const page = new Uint8ClampedArray(width * height * 4).fill(255);
  const maskOf = (blocks) => {
    const mask = new Uint8Array(width * height);
    blocks.forEach(([x0, y0, x1, y1]) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * width + x] = 1;
    });
    return mask;
  };
  const one = maskOf([[20, 7, 26, 13]]);
  assert.equal(Mask.areasOf(one, page, width, height, 6, 2).filter((area) => area.plain).length, 1, "a white area counts as plain: Generate must not paint it over");

  // The editor's own Generate, as it stands, run on that page with the services stubbed
  const source = read("web/app.js");
  const from = source.indexOf("  const generationTargets = ");
  const start = from > 0 ? from : source.indexOf("  const runGenerative = ");
  const end = source.indexOf("  // Parts of a selection on a plain background");
  assert.ok(start > 0 && end > start, "Generate must stay testable on its own");
  const fills = [];
  const started = [];
  let mask = one;
  const selection = { source: "rectangle", bounds: { left: 20, top: 7, right: 25, bottom: 12 } };
  const doc = { width, height, state: { selection, quickMask: false, activeIds: [] } };
  const context = {
    Gen: {
      load: () => ({ service: "google", keys: { google: "key" }, models: { google: "gemini-3.1-flash-image" }, custom: {} }),
      ready: () => true,
      takesPrompt: () => true,
      modelOf: (account) => account.models.google,
      priceOf: () => ({ usd: 0.07, free: false }),
    },
    Mask,
    app: { doc },
    textLink: () => 6,
    gen: { open: true, prompt: "" },
    pixelsOnly: () => false,
    agreeToDownload: async () => true,
    ops: {
      selectionFullMask: () => mask,
      maskSelection: (data, w, h, left, top, source2) => ({ source: source2, mask: data, bounds: { left, top, right: left + w - 1, bottom: top + h - 1 } }),
      deselect: () => {},
    },
    // The plain fill at once: Remove Text's and the Bubble Cleaner's, never Generate's
    fillPlainAreas: (target, areas, name) => fills.push({ name, count: areas.length }),
    startJobs: () => started.push("start"),
    renderGenTray: () => {},
    schedule: () => {},
    dialog: async () => true,
    fill: (text) => text,
    T: (text) => text,
    money: (usd) => `$${usd}`,
    modelName: () => "Nano Banana 2",
    serviceName: () => "Google",
    AbortController,
    console,
  };
  // The editor's own generation list, in the sandbox as it is in its scope
  const preamble = "let genJobs = []; let genJobCount = 0; let genTrayOpen = true;\n";
  const generate = vm.runInNewContext(`${preamble}${source.slice(start, end)}; ({ runGenerative, jobs: () => genJobs });`, context);
  assert.equal(typeof generate.runGenerative, "function");
  await generate.runGenerative();
  assert.equal(fills.length, 0, "Fill with the background at once is never Generate's: a white area would turn into a white TypeR Clean");
  assert.equal(generate.jobs().length, 1, "the model gets the white area, as it got it the first time");
  assert.equal(generate.jobs()[0].prompt, "");
  assert.equal(generate.jobs()[0].selection, selection, "one plain area is asked as it was drawn");
  assert.deepEqual(started, ["start"], "the generation starts at once");

  // Two places apart: one generation each, still nothing painted over
  mask = maskOf([[0, 0, 6, 6], [20, 7, 26, 13]]);
  generate.jobs().length = 0;
  started.length = 0;
  await generate.runGenerative();
  assert.equal(fills.length, 0);
  assert.equal(generate.jobs().length, 2, "each place apart goes to the model");
  assert.ok(generate.jobs().every((job) => job.selection.source === "mask"));

  assert.ok(!source.includes("const areas = described ?"), "Generate must not classify the selection as plain backgrounds");
  assert.ok(!source.includes('fillPlainAreas(doc, plain, "Generative Fill")'), "Generate must never paint the selection on TypeR Clean");
  assert.ok(source.includes('if (plain.length) fillPlainAreas(doc, plain, "Remove Text");'), "Remove Text keeps filling plain backgrounds at once");
});

test("the local model settings say where the models go and open that folder", async () => {
  const localAI = read("desktop/src/local-ai.js");
  assert.ok(localAI.includes("folder: root(),"), "the status carries the folder");
  assert.ok(localAI.includes('const root = () => savedFolder() || process.env.TYPER_LOCAL_AI_DIR || path.join(app.getPath("userData"), "local-ai");'), "a picked folder wins over the environment's and the app's own");
  assert.ok(localAI.includes('const settingsFile = () => path.join(app.getPath("userData"), "local-ai.json");'), "the choice is kept in the app's settings");
  assert.ok(localAI.includes("const setFolder = async (folder) =>") && localAI.includes("if (next && !path.isAbsolute(next))"), "a folder can be chosen, and must be a full path");
  assert.ok(localAI.includes("const freeSpace = () =>") && localAI.includes("fs.statfs("), "the room left on that drive is read");
  assert.ok(localAI.includes("const migrateNow = async (from, onProgress) =>") && localAI.includes("const migrate = (from, onProgress) => {"), "models in an older folder can be copied over");
  // The server runs from the folder, and the models are read from it: both go by root()
  assert.ok(localAI.includes("const args = [\"--diffusion-model\", filePath(one.diffusion)"), "the engine runs the models where they now are");
  assert.ok(localAI.includes("const pidPath = () => path.join(root(), \"server.pid\");"), "the server's pid is kept with them");
  const main = read("desktop/src/main.js");
  assert.ok(main.includes('ipcMain.handle("local-ai-folder"') && main.includes('ipcMain.handle("local-ai-show"'), "the app answers with the path and opens it");
  assert.ok(main.includes("await shell.openPath(folder)"));
  for (const channel of ["local-ai-pick-folder", "local-ai-set-folder", "local-ai-free", "local-ai-elsewhere", "local-ai-migrate"]) {
    assert.ok(main.includes(`ipcMain.handle("${channel}"`), `the app asks for a folder and keeps the answer (${channel})`);
  }
  assert.ok(main.includes('properties: ["openDirectory", "createDirectory"]'), "the dialog lets a new folder be made on another drive");
  const preload = read("desktop/src/preload.js");
  for (const line of ['folder: () => ipcRenderer.invoke("local-ai-folder")', 'show: () => ipcRenderer.invoke("local-ai-show")', 'pickFolder: (current) => ipcRenderer.invoke("local-ai-pick-folder", current)', 'setFolder: (folder) => ipcRenderer.invoke("local-ai-set-folder", folder)', 'freeSpace: () => ipcRenderer.invoke("local-ai-free")', 'elsewhere: () => ipcRenderer.invoke("local-ai-elsewhere")', 'migrate: (id, from) => ipcRenderer.invoke("local-ai-migrate", id, from)']) {
    assert.ok(preload.includes(line), line);
  }
  const source = read("web/generative.js");
  const picked = [];
  const window = { localStorage: { getItem: () => null, setItem: () => {} }, dispatchEvent: () => {}, TypeRDesktop: { localAI: {
    onProgress: () => {},
    folder: async () => "D:/AI/local-ai",
    show: async () => true,
    pickFolder: async () => ({ folder: "E:/Models" }),
    setFolder: async (folder) => { picked.push(folder); return { folder }; },
    freeSpace: async () => ({ free: 100 * 1024 ** 3, enough: true }),
    elsewhere: async () => ["C:/old/local-ai"],
    migrate: async () => ({ ok: true, value: { folder: "E:/Models" } }),
  } } };
  const context = { window, localStorage: window.localStorage, console, URL, CustomEvent: function () {}, setTimeout, clearTimeout, FormData, Blob, atob, DOMException, fetch: async () => { throw new Error("no"); } };
  vm.runInNewContext(source, context);
  const Gen = window.TypeRGenerative;
  assert.equal(await Gen.localFolder(), "D:/AI/local-ai");
  assert.equal(await Gen.localShowFolder(), true);
  assert.deepEqual(Object.assign({}, await Gen.localPickFolder("C:/where")), { folder: "E:/Models" });
  assert.equal((await Gen.localSetFolder("E:/Models")).folder, "E:/Models");
  assert.deepEqual(picked, ["E:/Models"]);
  assert.equal((await Gen.localFreeSpace()).enough, true);
  assert.deepEqual(Object.assign([], await Gen.localElsewhere()), ["C:/old/local-ai"]);
  assert.equal((await Gen.localMigrate("C:/old/local-ai", () => {}, null)).folder, "E:/Models");
  const app = read("web/app.js");
  assert.ok(app.includes('T("Downloaded to:")') && app.includes('T("Choose Folder…")') && app.includes('T("Open")'), "the settings show the path, a way to open it and a way to change it");
  assert.ok(app.includes('T("Default Folder")') && app.includes('T("Copy Them")'), "the app's own folder can come back, and models left behind can be copied");
});
