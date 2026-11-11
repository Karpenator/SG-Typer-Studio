// Drives the real app, from its sources, through what makes it an app: opening files from the
// system, saving over them, coming back after a restart, the menus, closing with unsaved work,
// and offline use. Native file pickers aren't driven here.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { _electron } = require("playwright-core");
const electronPath = require("electron");

const DESKTOP = path.resolve(__dirname, "..");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "typer-studio-test-"));
const results = [];
const step = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const booted = () => window.TypeRApp && window.TypeRApp.booted;
const launch = async (profile, env = {}, args = [], ready = booted) => {
  const started = Date.now();
  const clean = { ...process.env };
  delete clean.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [DESKTOP, ...args],
    env: { ...clean, TYPER_TEST: "1", TYPER_TEST_API: "1", TYPER_USER_DATA: profile, ...env },
  });
  const page = await app.firstWindow();
  const problems = [];
  page.on("console", (message) => { if (message.type() === "error") problems.push(message.text().slice(0, 200)); });
  page.on("pageerror", (error) => problems.push(String(error).slice(0, 200)));
  page.on("requestfailed", (request) => problems.push(`failed ${request.url()}`));
  page.on("response", (response) => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`); });
  // A new profile meets the setup assistant first: skipped, unless the test is about it
  if (ready === booted) {
    await page.waitForFunction(() => document.querySelector("dialog.onboard[open]") || (window.TypeRApp && window.TypeRApp.booted), null, { timeout: 30000 });
    if (await page.$("dialog.onboard[open]")) await page.click("dialog.onboard .onboard__skip");
  }
  await page.waitForFunction(ready, null, { timeout: 30000 });
  return { app, page, problems, bootMs: Date.now() - started };
};
const close = async ({ app, page }) => {
  await page.evaluate(() => window.TypeRSession.flush && window.TypeRSession.flush()).catch(() => {});
  await wait(400);
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
  await wait(300);
};
const docCount = (page) => page.evaluate(() => window.TypeRPhotoshop.app.docs.length);
const waitDocs = (page, count) => page.waitForFunction((wanted) => window.TypeRPhotoshop.app.docs.length === wanted, count, { timeout: 20000 });

const makePng = async (page, file) => {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 1200;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 800, 1200);
    context.fillStyle = "#c33";
    context.fillRect(100, 100, 300, 300);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  fs.writeFileSync(file, Buffer.from(data, "base64"));
};

const main = async () => {
  /* ---------------------------- first launch, no connection --------------------------- */
  const profile = path.join(WORK, "profile");
  // Two Photoshops to choose from: the test notes what they're asked to open, nothing starts
  const photoshops = [{ path: path.join(WORK, "Adobe Photoshop 2025.exe"), name: "Adobe Photoshop 2025", version: "26.0" }, { path: path.join(WORK, "Adobe Photoshop 2026.exe"), name: "Adobe Photoshop 2026", version: "27.0" }];
  const exchange = path.join(WORK, "exchange");
  let run = await launch(profile, { TYPER_TEST_PHOTOSHOP: JSON.stringify(photoshops), TYPER_EXCHANGE_DIR: exchange });
  step("starts with no connection, from its own copy", true, `${run.bootMs} ms to ready`);
  const page = run.page;
  const facts = await page.evaluate(async () => ({
    url: location.href,
    pickers: [typeof showOpenFilePicker, typeof showSaveFilePicker, typeof showDirectoryPicker, typeof queryLocalFonts],
    node: [typeof window.require, typeof window.process, typeof window.cep_node],
    frame: document.getElementById("panel-frame").src,
    title: document.querySelector(".mbar__title").textContent,
    fontState: (await navigator.permissions.query({ name: "local-fonts" })).state,
    secure: isSecureContext,
    desktopClass: document.documentElement.className,
    workers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    manifest: Boolean(document.querySelector("link[rel=manifest]")),
    externalControls: ["get-plugin", "support"].filter((id) => document.getElementById(id)),
    help: window.TypeRApp.MENUS.find(([name]) => name === "Help")[1].filter(Boolean).map((item) => item.label),
  }));
  step("served from the app's own address", facts.url.startsWith("typer://app/web/"), facts.url);
  step("browser file and font tools are all there", facts.pickers.every((kind) => kind === "function"), facts.pickers.join());
  step("no Node in the page", facts.node.every((kind) => kind === "undefined"));
  step("the panel started", /panel\/index\.html/.test(facts.frame));
  step("no PWA or service worker", facts.workers === 0 && !facts.manifest);
  step("no website, download, support, problem-report, or Discord-server controls", facts.externalControls.length === 0 && !["Back to the Site", "Download…", "Download the Photoshop Plugin", "Report a Problem", "Discord Server", "Support the Project"].some((label) => facts.help.includes(label)));
  step("installed fonts need no question", facts.fontState === "granted");
  step("the title is the app's", facts.title === "SG Typer Studio", facts.title);
  const listed = await page.evaluate(async () => (await window.queryLocalFonts()).length);
  step("installed fonts are listed", listed > 0, `${listed}`);
  await wait(800);
  step("nothing failed while starting", run.problems.length === 0, run.problems.slice(0, 5).join(" | "));

  /* --------------------------- opening from the system, saving ------------------------ */
  const chapter = path.join(WORK, "chapter");
  fs.mkdirSync(chapter);
  const png = path.join(chapter, "page 1.png");
  await makePng(page, png);
  await run.app.evaluate((_, file) => global.typerTest.openPaths([file]), png);
  await waitDocs(page, 1);
  const opened = await page.evaluate(() => {
    const { doc } = window.TypeRPhotoshop.app;
    return { name: doc.name, kind: doc.handle && doc.handle.constructor.name };
  });
  step("a PNG opens from the system with a real file handle", opened.kind === "FileSystemFileHandle", JSON.stringify(opened));

  // Makes a real PSD with the app's own writer, then opens it from the system
  const psd = path.join(chapter, "page 2.psd");
  const psdData = await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.TypeRPSD.write(window.TypeRPhotoshop.app.doc, "page 2.psd"));
    let text = "";
    for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(text);
  });
  fs.writeFileSync(psd, Buffer.from(psdData, "base64"));
  await run.app.evaluate((_, file) => global.typerTest.openPaths([file]), psd);
  await waitDocs(page, 2);
  step("a PSD opens as a new page beside the first", (await page.evaluate(() => window.TypeRPhotoshop.app.doc.name)) === "page 2.psd");

  const before = fs.statSync(psd);
  await page.evaluate(() => {
    const { ops } = window.TypeRPhotoshop;
    ops.newLayer("From the test");
  });
  const saved = await page.evaluate(() => window.TypeRApp.save());
  await wait(300);
  const after = fs.statSync(psd);
  step("Save writes over the same file, with no question", saved === true && (after.mtimeMs > before.mtimeMs), `${before.size} -> ${after.size} bytes`);
  step("no temporary file left beside it", fs.readdirSync(chapter).every((name) => !name.endsWith(".crswap")), fs.readdirSync(chapter).join(", "));
  const reread = await page.evaluate(async () => {
    const file = await window.TypeRPhotoshop.app.doc.handle.getFile();
    return { size: file.size, dirty: window.TypeRPhotoshop.isDirty(window.TypeRPhotoshop.app.doc) };
  });
  step("the saved page is clean", !reread.dirty && reread.size === after.size);

  // Changed in Photoshop, then opened here again: its own tab takes the file as it is now
  const changedOnDisk = async (layerName) => {
    const data = await page.evaluate(async (name) => {
      const { ops, app } = window.TypeRPhotoshop;
      const doc = app.doc;
      const at = doc.historyIndex;
      ops.newLayer(name);
      const bytes = new Uint8Array(await window.TypeRPSD.write(doc, doc.name));
      ops.rollbackHistory(at);
      let text = "";
      for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(text);
    }, layerName);
    fs.writeFileSync(psd, Buffer.from(data, "base64"));
  };
  const tabState = () => page.evaluate(() => {
    const { app, isDirty } = window.TypeRPhotoshop;
    return { count: app.docs.length, at: app.docs.indexOf(app.doc), name: app.doc.name, layers: app.doc.state.layers.map((layer) => layer.name), dirty: isDirty(app.doc) };
  });
  const tabBefore = await tabState();
  await changedOnDisk("From Photoshop");
  await run.app.evaluate((_, file) => global.typerTest.openPaths([file]), psd);
  await page.waitForFunction(() => window.TypeRPhotoshop.app.doc.state.layers.some((layer) => layer.name === "From Photoshop"), null, { timeout: 15000 }).catch(() => {});
  const tabAfter = await tabState();
  step("a PSD changed elsewhere and opened again comes back in its own tab, as it is now", tabAfter.count === tabBefore.count && tabAfter.at === tabBefore.at && tabAfter.name === "page 2.psd" && tabAfter.layers.includes("From Photoshop") && !tabAfter.dirty, JSON.stringify({ tabBefore, tabAfter }));
  await changedOnDisk("From Photoshop again");
  await page.evaluate(() => window.TypeRPhotoshop.ops.newLayer("Not saved here"));
  await run.app.evaluate((_, file) => global.typerTest.openPaths([file]), psd);
  const askedReload = await page.waitForSelector("#modal[open] .modal__foot .btn--main", { timeout: 10000 }).then(() => true, () => false);
  if (askedReload) await page.click("#modal[open] .modal__foot .btn--main");
  await page.waitForFunction(() => window.TypeRPhotoshop.app.doc.state.layers.some((layer) => layer.name === "From Photoshop again"), null, { timeout: 15000 }).catch(() => {});
  const tabReloaded = await tabState();
  step("with changes not saved here, it asks first, then the tab takes the new version", askedReload && tabReloaded.count === tabBefore.count && tabReloaded.at === tabBefore.at && tabReloaded.layers.includes("From Photoshop again") && !tabReloaded.layers.includes("Not saved here") && !tabReloaded.dirty, JSON.stringify(tabReloaded));

  /* ---------------------------------- Open in Photoshop -------------------------------- */
  const listed2 = await page.evaluate(() => window.TypeRDesktop.photoshop.list());
  step("the Photoshops installed are found, the newest first", listed2.map((one) => one.name).join() === "Adobe Photoshop 2026,Adobe Photoshop 2025", JSON.stringify(listed2));
  const beforePs = fs.statSync(psd).mtimeMs;
  await page.evaluate(() => window.TypeRPhotoshop.ops.newLayer("Before Photoshop"));
  const sending = page.evaluate(() => window.TypeRApp.openInPhotoshop());
  await page.waitForSelector("#modal[open] select", { timeout: 5000 });
  const psAsked = await page.evaluate(() => Array.from(document.querySelectorAll("#modal[open] select")).map((select) => Array.from(select.options).map((option) => option.textContent)));
  step("Open in Photoshop asks for this page or all of them, and which Photoshop", psAsked.length === 2 && psAsked[0].length === 2 && psAsked[1].length === 2, JSON.stringify(psAsked));
  await page.selectOption("#modal[open] select >> nth=0", "one");
  await page.selectOption("#modal[open] select >> nth=1", listed2[1].id);
  await page.click("#modal[open] .modal__foot .btn--main");
  await sending;
  const sent = await run.app.evaluate(() => global.typerPhotoshopOpened || []);
  const sentFiles = sent.length === 1 ? sent[0].files.map((file) => fs.realpathSync(file)) : [];
  step("the page is saved first, then its own PSD opens in the Photoshop chosen", sent.length === 1 && sent[0].app === listed2[1].id && sentFiles.join() === fs.realpathSync(psd) && fs.statSync(psd).mtimeMs > beforePs, JSON.stringify(sent));
  const psRefused = await page.evaluate((id) => window.TypeRDesktop.photoshop.open(id, ["/etc/hosts", "/tmp/elsewhere.psd"]), listed2[0].id);
  step("only the files of open pages can be sent to Photoshop", psRefused && psRefused.ok === false && (await run.app.evaluate(() => global.typerPhotoshopOpened.length)) === 1, JSON.stringify(psRefused));
  // Import the script: the panel's open tab goes with the pages, for TypeR in Photoshop
  await page.evaluate(async () => {
    const path = window.TypeRKit.activeStoragePath();
    const frame = document.getElementById("panel-frame");
    const bridge = frame && frame.contentWindow && frame.contentWindow.__typerWeb;
    const data = JSON.parse((bridge ? bridge.getFile(path) : window.TypeRKit.read(path)) || "{}");
    const tab = { id: "e2e-script", name: "Chapter 12", text: "Hello\r\nWorld", images: [], currentLineIndex: 0 };
    data.tabs = (data.tabs || []).concat([tab]);
    data.currentTabId = tab.id;
    if (bridge) bridge.setFile(path, JSON.stringify(data));
    else await window.TypeRKit.keep(path, JSON.stringify(data));
  });
  const sendingScript = page.evaluate(() => window.TypeRApp.openInPhotoshop());
  await page.waitForSelector("#modal[open] input[type=checkbox]", { timeout: 5000 });
  await page.check("#modal[open] input[type=checkbox]");
  await page.click("#modal[open] .modal__foot .btn--main");
  await sendingScript;
  const sentScript = await run.app.evaluate(() => global.typerPhotoshopScript || null);
  // The panel's own button to the other app is the app's Open in Photoshop
  const panelButton = page.frameLocator("#panel-frame").locator(".footer-actions button[aria-label='Ouvrir dans Photoshop']");
  const panelHasButton = await panelButton.waitFor({ timeout: 15000 }).then(() => true, () => false);
  if (panelHasButton) {
    await panelButton.click();
    await page.waitForSelector("#modal[open] select", { timeout: 5000 }).catch(() => {});
  }
  const panelAsks = await page.evaluate(() => Boolean(document.querySelector("#modal[open] select")) && document.querySelector("#modal[open] .modal__head, #modal[open] h2, #modal[open]").textContent.includes("Photoshop"));
  step("the panel's Open in Photoshop button opens the app's dialog", panelHasButton && panelAsks);
  if (panelAsks) await page.click("#modal[open] .modal__foot .btn:not(.btn--main)");
  step("Import the script sends the panel's script with the pages", sentScript && sentScript.name === "Chapter 12" && sentScript.text === "Hello\nWorld" && sentScript.files.length === 1, JSON.stringify(sentScript));
  // Already open in Photoshop: opened again as it is now only when it changed since it was sent
  const reloads = await run.app.evaluate(() => global.typerPhotoshopReloaded || []);
  step("a PSD sent to Photoshop again is opened anew there only when it changed since", reloads.length === 1 && reloads[0].files.length === 1 && fs.realpathSync(reloads[0].files[0]) === fs.realpathSync(psd) && !reloads[0].replace, JSON.stringify(reloads));
  // With changes not saved in Photoshop: asked first, then replaced
  await run.app.evaluate(() => { global.typerPhotoshopUnsaved = ["page 2.psd"]; });
  await page.evaluate(() => window.TypeRPhotoshop.ops.newLayer("For Photoshop again"));
  const sentBefore = await run.app.evaluate(() => global.typerPhotoshopOpened.length);
  const sendingAgain = page.evaluate(() => window.TypeRApp.openInPhotoshop());
  await page.waitForSelector("#modal[open] select", { timeout: 5000 });
  await page.selectOption("#modal[open] select >> nth=0", "one");
  await page.click("#modal[open] .modal__foot .btn--main");
  const askedReplace = await page.waitForFunction(() => {
    const modal = document.querySelector("#modal[open]");
    return Boolean(modal && !modal.querySelector("select") && modal.textContent.includes("page 2.psd"));
  }, null, { timeout: 10000 }).then(() => true, () => false);
  if (askedReplace) await page.click("#modal[open] .modal__foot .btn--main");
  await sendingAgain;
  const replaced = await run.app.evaluate(() => ({ reloads: global.typerPhotoshopReloaded, opened: global.typerPhotoshopOpened.length }));
  await run.app.evaluate(() => { global.typerPhotoshopUnsaved = []; });
  step("changes not saved in Photoshop are asked about before the page replaces them", askedReplace && replaced.opened === sentBefore + 1 && replaced.reloads.slice(-2).map((one) => one.replace).join() === "false,true", JSON.stringify(replaced));
  // A page from a folder opened whole holds the folder's permission, not its own: its PSD still opens
  const folderPages = path.join(WORK, "folder chapter");
  fs.mkdirSync(folderPages);
  fs.copyFileSync(psd, path.join(folderPages, "01.psd"));
  // Dropped on the window as from the Finder, not opened by the system, which takes files only
  await page.evaluate(() => Object.defineProperty(window, "TypeRDesktopOpening", { configurable: true, get: () => false, set: () => {} }));
  await run.app.evaluate((_, folder) => global.typerTest.openPaths([folder]), folderPages);
  await waitDocs(page, 3);
  await page.evaluate(() => {
    window.typerPickedFolder = false;
    window.showDirectoryPicker = async () => {
      window.typerPickedFolder = true;
      throw new DOMException("refused by the test", "AbortError");
    };
  });
  const sendingFolder = page.evaluate(() => window.TypeRApp.openInPhotoshop());
  await page.waitForSelector("#modal[open] select", { timeout: 5000 });
  await page.selectOption("#modal[open] select >> nth=0", "one");
  await page.click("#modal[open] .modal__foot .btn--main");
  await sendingFolder;
  const sentFolder = await run.app.evaluate(() => (global.typerPhotoshopOpened || []).slice(-1)[0] || null);
  const pickedFolder = await page.evaluate(async () => {
    delete window.TypeRDesktopOpening;
    await window.TypeRApp.closeDoc();
    return window.typerPickedFolder;
  });
  await waitDocs(page, 2);
  step("a PSD of a folder opened whole opens in Photoshop, with no folder to choose", !pickedFolder && sentFolder && sentFolder.files.length === 1 && fs.realpathSync(sentFolder.files[0]) === fs.realpathSync(path.join(folderPages, "01.psd")), JSON.stringify({ pickedFolder, sentFolder }));

  // The other process that the system starts when the app is already open
  const clean = { ...process.env };
  delete clean.ELECTRON_RUN_AS_NODE;
  const png2 = path.join(chapter, "page 3.png");
  fs.copyFileSync(png, png2);
  spawnSync(electronPath, [DESKTOP, png2], { env: { ...clean, TYPER_TEST: "1", TYPER_USER_DATA: profile }, timeout: 15000 });
  await waitDocs(page, 3).then(() => step("a second launch hands its file to the open window", true)).catch(() => step("a second launch hands its file to the open window", false));

  // TypeR for Photoshop's Open in SG Typer Studio: a request in the folder both apps share, then
  // typer-studio://open, which carries nothing itself
  fs.mkdirSync(exchange, { recursive: true });
  const request = path.join(exchange, "open.json");
  const png4 = path.join(chapter, "page 4.png");
  fs.copyFileSync(png, png4);
  const sendFromPhotoshop = (name) => {
    fs.writeFileSync(request, JSON.stringify({ from: "TypeR", version: 1, sent: Date.now(), files: [png4, "/etc/hosts"], script: { name, text: "One\r\nTwo" } }));
    return run.app.evaluate((_, link) => global.typerTest.openLinks([link]), "typer-studio://open");
  };
  const scriptTabs = () => page.evaluate(() => {
    const data = JSON.parse(window.TypeRKit.read(window.TypeRKit.activeStoragePath()) || "null") || {};
    const tabs = (data.tabs || []).filter((tab) => tab.text === "One\nTwo");
    return { count: tabs.length, current: tabs.some((tab) => tab.id === data.currentTabId), names: tabs.map((tab) => tab.name) };
  });
  await sendFromPhotoshop("From Photoshop");
  const fromPhotoshop = await waitDocs(page, 4).then(() => true, () => false);
  step("typer-studio://open opens the files TypeR for Photoshop left, only those, once", fromPhotoshop && !fs.existsSync(request), await page.evaluate(() => window.TypeRPhotoshop.app.docs.map((doc) => doc.name).join(", ")));
  await page.waitForFunction(() => {
    const data = JSON.parse(window.TypeRKit.read(window.TypeRKit.activeStoragePath()) || "null") || {};
    return (data.tabs || []).some((tab) => tab.text === "One\nTwo" && tab.id === data.currentTabId);
  }, null, { timeout: 10000 }).catch(() => {});
  const firstTabs = await scriptTabs();
  step("its script becomes the panel's open tab", firstTabs.count === 1 && firstTabs.current && firstTabs.names[0] === "From Photoshop", JSON.stringify(firstTabs));
  await sendFromPhotoshop("Again");
  await wait(2500);
  const againTabs = await scriptTabs();
  step("the same script again goes back to its tab, with no copy", againTabs.count === 1 && againTabs.current && !fs.existsSync(request), JSON.stringify(againTabs));

  /* ---------------------------------- leaving the app --------------------------------- */
  const windows = () => run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await run.app.evaluate(({ shell }) => {
    global.typerOpened = [];
    shell.openExternal = async (url) => { global.typerOpened.push(url); };
  });
  await page.evaluate(() => { window.open("https://discord.com/x", "_blank", "noopener"); });
  await wait(300);
  await page.evaluate(() => { const link = document.createElement("a"); link.href = "https://github.com/y"; document.body.appendChild(link); link.click(); link.remove(); });
  await wait(500);
  const outside = await run.app.evaluate(() => global.typerOpened);
  step("links go to the real browser, never in the app", outside.length === 2 && (await windows()) === 1 && page.url().startsWith("typer://"), outside.join(", "));

  /* --------------------------------- coming back later ------------------------------- */
  await page.waitForTimeout(1500);
  await close(run);
  run = await launch(profile);
  await run.page.waitForFunction(() => window.TypeRPhotoshop.app.docs.length > 0, null, { timeout: 20000 }).catch(() => {});
  const back = await run.page.evaluate(async () => {
    const { app } = window.TypeRPhotoshop;
    const doc = app.docs.find((one) => one.name === "page 2.psd");
    const rows = await window.TypeRRecent.list();
    return { docs: app.docs.length, kind: doc && doc.handle && doc.handle.constructor.name, recent: rows.map((row) => row.name) };
  });
  step("the session comes back after a restart", back.docs >= 3, JSON.stringify(back));
  step("recent files come back", back.recent.includes("page 2.psd"), back.recent.join(", "));
  const before2 = fs.statSync(psd).mtimeMs;
  await run.page.evaluate(() => {
    const { app, ops } = window.TypeRPhotoshop;
    window.TypeRPhotoshop.setActiveDoc(app.docs.find((one) => one.name === "page 2.psd"));
    ops.newLayer("After the restart");
  });
  const savedAgain = await run.page.evaluate(() => window.TypeRApp.save());
  await wait(300);
  step("Save still writes over the file after a restart, with no question", savedAgain === true && fs.statSync(psd).mtimeMs > before2);

  // Work the session hasn't kept yet is what the warning is for
  await run.app.evaluate(({ dialog }) => {
    global.typerAsked = 0;
    dialog.showMessageBoxSync = () => { global.typerAsked += 1; return 1; };
  });
  await run.page.evaluate(() => {
    window.TypeRPhotoshop.ops.newLayer("Unsaved");
    window.addEventListener("beforeunload", (event) => { event.preventDefault(); event.returnValue = ""; });
  });
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await wait(800);
  const stayed = await run.app.evaluate(({ BrowserWindow }) => ({ asked: global.typerAsked, open: BrowserWindow.getAllWindows().length }));
  step("closing with unsaved work asks first, and Cancel keeps the window", stayed.asked === 1 && stayed.open === 1, JSON.stringify(stayed));
  await close(run);

  /* ---------------------------- TypeR for Photoshop's settings ------------------------ */
  // A plugin folder as the CEP version leaves it: two profiles, and files that aren't settings
  const plugin = path.join(WORK, "typertools");
  fs.mkdirSync(plugin);
  const style = (id) => ({ id, name: id, folder: null, textProps: { layerText: { textStyleRange: [{ from: 0, to: 1, textStyle: { fontPostScriptName: "ArialMT", fontName: "Arial", size: 20 } }] } } });
  const pluginFiles = {
    storage: JSON.stringify({ notFirstTime: true, styles: [style("base")], autoUpdate: true, mcpOperations: [1], tabs: [{ id: "t", name: "105", autoName: true, images: [{ name: "01.psd", path: "/nowhere/01.psd" }], lastOpenedImagePath: "/nowhere/01.psd" }] }),
    storage_profiles: JSON.stringify({ version: 1, activeProfileId: "p1", profiles: [{ id: "default", name: "Default" }, { id: "p1", name: "Manhwa" }] }),
    storage_profile_p1: JSON.stringify({ notFirstTime: true, whatsNewSeen: "3.0", styles: [style("m1"), style("m2")] }),
    "storage.before-import": "{}",
  };
  Object.entries(pluginFiles).forEach(([name, text]) => fs.writeFileSync(path.join(plugin, name), text));
  // A first start goes through the setup assistant (web/onboarding.js): its styles step offers them
  const offered = () => document.querySelector("dialog.onboard[open], #modal[open]") || (window.TypeRApp && window.TypeRApp.booted);
  const modalText = (page) => page.evaluate(() => { const modal = document.querySelector("dialog.onboard[open], #modal[open]"); return modal ? modal.innerText : null; });
  const profile3 = path.join(WORK, "profile3");
  run = await launch(profile3, { TYPER_PHOTOSHOP_DIRS: plugin }, [], offered);
  await run.page.click("dialog.onboard .onboard__foot .btn--main").catch(() => {});
  await wait(300);
  const stylesStep = await run.page.evaluate(() => {
    const on = document.querySelector("dialog.onboard .onboard__choice.is-on");
    return on ? on.innerText : null;
  }).catch(() => null);
  step("a first start offers TypeR for Photoshop's settings", /\b3\b/.test(stylesStep || ""), (stylesStep || "no card").split("\n").filter(Boolean)[0]);
  // Taken with Next, then the rest is skipped
  await run.page.click("dialog.onboard .onboard__foot .btn--main");
  await run.page.click("dialog.onboard .onboard__skip");
  await run.page.waitForFunction(booted, null, { timeout: 30000 });
  await wait(1500);
  const taken = await run.page.evaluate(() => {
    const Kit = window.TypeRKit;
    const base = JSON.parse(Kit.read("/typer/storage"));
    return { paths: Kit.storedPaths().sort(), active: Kit.activeStoragePath(), styles: JSON.parse(Kit.read(Kit.activeStoragePath())).styles.map((one) => one.id), base, frame: document.getElementById("panel-frame").src };
  });
  step("its profiles and styles are taken", taken.active === "/typer/storage_profile_p1" && taken.styles.join() === "m1,m2" && taken.paths.join() === "/typer/storage,/typer/storage_profile_p1,/typer/storage_profiles", JSON.stringify({ active: taken.active, styles: taken.styles }));
  step("without what only the plugin needs", !taken.base.mcpOperations && taken.base.autoUpdate === false && taken.base.tabs[0].images.length === 0 && taken.base.tabs[0].name === "105" && /panel\/index\.html/.test(taken.frame));
  step("the plugin's files are left as they were", Object.entries(pluginFiles).every(([name, text]) => fs.readFileSync(path.join(plugin, name), "utf8") === text));
  const again = await run.page.evaluate(async () => {
    const found = await window.TypeRStudio.findPhotoshopSettings({ overOwn: true });
    return { again: Boolean(found && found.replaces), atStart: await window.TypeRStudio.findPhotoshopSettings() };
  });
  step("Help → Setup Assistant… offers them again, saying they replace these", again.again && again.atStart === null);
  await close(run);
  run = await launch(profile3, { TYPER_PHOTOSHOP_DIRS: plugin }, [], offered);
  step("and it's offered only once", (await modalText(run.page)) === null);
  await close(run);

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  fs.rmSync(WORK, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  console.log(`Kept for a look: ${WORK}`);
  spawnSync("pkill", ["-f", WORK]);
  process.exit(2);
});
