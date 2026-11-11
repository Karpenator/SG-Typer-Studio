const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

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
