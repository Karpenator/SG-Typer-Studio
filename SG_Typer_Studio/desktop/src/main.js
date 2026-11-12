// The Windows window around the embedded workspace: opening files from the system, protecting
// unsaved pages, Photoshop exchange, fonts and native AI. No website or remote UI is involved.

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, session, shell } = require("electron");
const localAI = require("./local-ai");
const discord = require("./discord");
const { createFirefly } = require("./firefly");
const { migrateLegacyProfile } = require("./profile-migration");
const { createUpdateManager } = require("./update-manager");
const { createOpenRouter } = require("./openrouter");

const SCHEME = "typer";
const HOST = "app";
const START_URL = `${SCHEME}://${HOST}/web/`;
const OPENABLE = /\.(psd|psb|idml|indd|indt|png|jpe?g|webp)$/i;
const CRASH_WINDOW = 60 * 1000;
const BAR_HEIGHT = 30;
const isTest = process.env.TYPER_TEST === "1";

// Keeps a test's data apart from the real app's. Must be set before anything reads it.
if (process.env.TYPER_USER_DATA) app.setPath("userData", process.env.TYPER_USER_DATA);

// The product rename must not hide existing documents, fonts or settings. Copy the legacy
// profile once, leaving it untouched as a rollback. Test profiles are already isolated.
if (!process.env.TYPER_USER_DATA) {
  const current = app.getPath("userData");
  const warn = (error) => console.warn("SG Typer Studio: legacy profile migration:", error.message);
  // The display-name change must not strand an existing SG_Typer_Studio profile either.
  migrateLegacyProfile(current, path.join(app.getPath("appData"), "SG_Typer_Studio"), warn);
  migrateLegacyProfile(current, path.join(app.getPath("appData"), "TypeR Studio"), warn);
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

if (!app.requestSingleInstanceLock()) app.exit(0);

let win = null;
let pageReady = false;
let lastCrash = 0;
let strings = {};
const waitingPaths = [];
// A script sent by TypeR for Photoshop, kept until the page can take it
let waitingScript = null;

/* -------------------------------- the app's files -------------------------------- */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".properties": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const HEAD_TAGS = '<head>\n  <script src="desktop.js"></script>\n  <link rel="stylesheet" href="desktop.css">';

const serve = async (request) => {
  const url = new URL(request.url);
  if (url.host !== HOST) return new Response("", { status: 404 });
  let file = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (!file || file.endsWith("/")) file += "index.html";
  const root = path.join(__dirname, "..", "content");
  const full = path.resolve(root, file);
  if (!full.startsWith(path.resolve(root) + path.sep)) return new Response("", { status: 403 });
  try {
    let body = await fs.promises.readFile(full);
    if (file === "web/index.html") body = body.toString("utf8").replace("<head>", HEAD_TAGS);
    return new Response(body, { headers: { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" } });
  } catch (error) {
    return new Response("", { status: 404 });
  }
};

/* ------------------------------ opening from the system ----------------------------- */

const openablePaths = (args) => args.filter((arg) => !arg.startsWith("-") && OPENABLE.test(arg) && fs.existsSync(arg));

// The same way in as a file dropped on the window: the page gets a real, lasting handle on the
// file, so Save writes over it and it joins the recent files, with no file access in the page.
const openPaths = async (paths) => {
  if (!paths.length) return;
  if (!win || !pageReady) {
    waitingPaths.push(...paths);
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
  const { debugger: cdp } = win.webContents;
  const data = { items: [], files: paths, dragOperationsMask: 1 };
  const at = { x: 40, y: 200, data };
  try {
    await win.webContents.executeJavaScript("window.TypeRDesktopOpening = true", true);
    cdp.attach("1.3");
    await cdp.sendCommand("Input.dispatchDragEvent", { type: "dragEnter", ...at });
    await cdp.sendCommand("Input.dispatchDragEvent", { type: "dragOver", ...at });
    await cdp.sendCommand("Input.dispatchDragEvent", { type: "drop", ...at });
  } catch (error) {
    console.error("Opening from the system:", error);
  } finally {
    if (cdp.isAttached()) cdp.detach();
  }
};

/* ---------------------------- sent by TypeR for Photoshop ---------------------------- */

// TypeR for Photoshop's "Open in SG Typer Studio" writes what to open in a file of the folder both
// apps share, then opens typer-studio://open. The address carries nothing: a web page can open it
// too, and only finds there what TypeR left a moment ago, or nothing.
const LINK_SCHEMES = ["sg-typer-studio", "typer-studio"]; // the latter keeps the Photoshop plugin compatible
const REQUEST_MAX_AGE = 5 * 60 * 1000;
// A script, either way between the two apps
const SCRIPT_LIMIT = 5 * 1024 * 1024;
const exchangeFolder = () => process.env.TYPER_EXCHANGE_DIR || path.join(app.getPath("appData"), "TypeR", "Studio");
const isLink = (arg) => typeof arg === "string" && LINK_SCHEMES.some((scheme) => arg.toLowerCase().startsWith(`${scheme}:`));

const deliverScript = (script) => {
  if (!script) return;
  if (!win || !pageReady) {
    waitingScript = script;
    return;
  }
  win.webContents.send("import-script", script);
};

// The request, taken off the disk so it's used once: { files, script }, or null
const takeRequest = async () => {
  const file = path.join(exchangeFolder(), "open.json");
  let value;
  try {
    const text = await fs.promises.readFile(file, "utf8");
    await fs.promises.unlink(file);
    value = JSON.parse(text);
  } catch (error) {
    return null;
  }
  if (!value || typeof value !== "object" || value.from !== "TypeR" || value.version !== 1) return null;
  const sent = Number(value.sent);
  if (!Number.isFinite(sent) || Date.now() - sent > REQUEST_MAX_AGE || sent - Date.now() > 60 * 1000) return null;
  const files = [];
  for (const one of Array.isArray(value.files) ? value.files.slice(0, 200) : []) {
    if (typeof one === "string" && path.isAbsolute(one) && OPENABLE.test(one) && (await exists(one)) && !files.includes(one)) files.push(one);
  }
  const given = value.script && typeof value.script === "object" ? value.script : null;
  const text = given && typeof given.text === "string" ? given.text.replace(/\r\n?/g, "\n") : "";
  const script = text.trim() && text.length <= SCRIPT_LIMIT
    ? { name: typeof given.name === "string" ? given.name.replace(/\s+/g, " ").trim().slice(0, 200) : "", text }
    : null;
  return { files, script };
};

// Where this copy of the app is, for TypeR for Photoshop to know it's installed, even outside
// the folders its installers use
const noteWhereStudioIs = async () => {
  const place = process.execPath;
  const file = path.join(exchangeFolder(), "app.json");
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify({ from: "TypeR Studio", path: place, version: app.getVersion(), product: "SG Typer Studio" }), "utf8");
  } catch (error) {
    console.warn("Noting where SG Typer Studio is:", error.message);
  }
};

const openLinks = async (args) => {
  if (!args.some(isLink)) return;
  const request = await takeRequest();
  if (!request) return;
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  openPaths(request.files);
  deliverScript(request.script);
};

/* ------------------------------------ the window ------------------------------------ */

const boundsPath = () => path.join(app.getPath("userData"), "window.json");
const readBounds = () => {
  try {
    const saved = JSON.parse(fs.readFileSync(boundsPath(), "utf8"));
    const area = screen.getDisplayMatching(saved).workArea;
    const visible = saved.x < area.x + area.width - 100 && saved.x + saved.width > area.x + 100 && saved.y >= area.y - 20 && saved.y < area.y + area.height - 100;
    return visible ? saved : null;
  } catch (error) {
    return null;
  }
};
const keepBounds = () => {
  if (!win || win.isDestroyed() || win.isFullScreen()) return;
  try {
    fs.writeFileSync(boundsPath(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch (error) {
    console.warn("Window position:", error.message);
  }
};

const isOurs = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${SCHEME}:` && parsed.host === HOST;
  } catch (error) {
    return false;
  }
};
const openOutside = (url) => {
  try {
    const { protocol: kind } = new URL(url);
    if (kind === "https:" || kind === "http:" || kind === "mailto:") shell.openExternal(url);
  } catch (error) {
    console.warn("Link refused:", url);
  }
};

const fieldMenu = (params) => {
  const { editFlags: can } = params;
  const items = [];
  for (const word of (params.dictionarySuggestions || []).slice(0, 5)) items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) });
  if (items.length) items.push({ type: "separator" });
  if (params.isEditable) items.push({ role: "cut", enabled: can.canCut }, { role: "copy", enabled: can.canCopy }, { role: "paste", enabled: can.canPaste }, { type: "separator" }, { role: "selectAll", enabled: can.canSelectAll });
  else if (params.selectionText) items.push({ role: "copy" });
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
};

const createWindow = () => {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = readBounds();
  const bounds = saved || { width: Math.min(1600, Math.round(area.width * 0.92)), height: Math.min(1000, Math.round(area.height * 0.92)) };
  const look = { titleBarStyle: "hidden", titleBarOverlay: { color: "#232121", symbolColor: "#e3e4e4", height: BAR_HEIGHT } };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 500,
    show: false,
    backgroundColor: "#232121",
    title: app.getName(),
    ...look,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged || isTest,
    },
  });
  if (saved && saved.maximized) win.maximize();
  // A test doesn't take the focus from whoever is at the computer
  win.once("ready-to-show", () => (isTest ? win.showInactive() : win.show()));
  win.on("page-title-updated", (event) => event.preventDefault());
  ["resize", "move"].forEach((name) => win.on(name, () => {
    clearTimeout(win.keepTimer);
    win.keepTimer = setTimeout(keepBounds, 500);
  }));
  win.on("close", keepBounds);
  win.on("closed", () => {
    firefly.close();
    win = null;
    pageReady = false;
  });

  const { webContents: page } = win;
  page.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  page.on("will-navigate", (event, url) => {
    if (isOurs(url) && new URL(url).pathname.startsWith("/web/")) return;
    event.preventDefault();
    if (!isOurs(url)) openOutside(url);
  });
  page.on("will-prevent-unload", (event) => {
    const answer = dialog.showMessageBoxSync(win, {
      type: "warning",
      message: strings.closeTitle || "Save your changes before closing?",
      buttons: [strings.discard || "Don't save", strings.cancel || "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (answer === 0) event.preventDefault();
  });
  page.on("context-menu", (event, params) => fieldMenu(params));
  page.on("render-process-gone", (event, details) => {
    if (details.reason === "clean-exit" || !win) return;
    // Pages kept by the session come back with the reload. If it goes down again right away, a
    // reload could go on forever, on pages too heavy for this computer: that's the user's call.
    const again = Date.now() - lastCrash < CRASH_WINDOW;
    lastCrash = Date.now();
    if (!again) {
      win.reload();
      return;
    }
    const answer = dialog.showMessageBoxSync(win, { type: "error", message: strings.crashed || "SG Typer Studio stopped working, maybe for lack of memory.", buttons: [strings.tryAgain || "Try Again", strings.quit || "Quit"], defaultId: 0, cancelId: 1 });
    if (answer === 0) win.reload();
    else app.quit();
  });

  win.loadURL(START_URL);
};

/* ------------------------------------- permissions ---------------------------------- */

const ALLOWED = new Set(["local-fonts", "fileSystem", "clipboard-read", "clipboard-sanitized-write", "persistent-storage", "fullscreen"]);
const setPermissions = () => {
  const { defaultSession: ours } = session;
  ours.setPermissionRequestHandler((contents, permission, grant, details) => grant(ALLOWED.has(permission) && isOurs(details.requestingUrl)));
  ours.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (permission === "fileSystem") noteWhere(details);
    return ALLOWED.has(permission) && origin.startsWith(`${SCHEME}://`);
  });
  // Answering "allow" here only leaves an empty file behind: the writing is refused later anyway
  ours.on("file-system-access-restricted", async (event, details, callback) => {
    await dialog.showMessageBox(win, { type: "info", message: strings.protectedPlace || "This place is protected by the system. Choose another one.", buttons: [strings.ok || "OK"] });
    callback("tryAgain");
  });
};

/* ------------------------------ TypeR for Photoshop's settings ----------------------- */

// Where the Photoshop plugin keeps its storage files: UXP has its own folder, the CEP extension
// keeps them in its install folder. They're the same files SG Typer Studio keeps in the page, so the
// page can start from them. Only read, never written: the plugin keeps working as it was.
const PLUGIN_FILE = /^storage(_profiles|_profile_[a-z0-9][a-z0-9_-]{0,79})?$/i;
const PLUGIN_FILE_LIMIT = 50 * 1024 * 1024;
const pluginFolders = () => {
  if (process.env.TYPER_PHOTOSHOP_DIRS) return process.env.TYPER_PHOTOSHOP_DIRS.split(path.delimiter).filter(Boolean);
  // A test must not find the settings of the computer it runs on
  if (isTest) return [];
  const appData = app.getPath("appData");
  const folders = [path.join(appData, "TypeR", "UXP"), path.join(appData, "Adobe", "CEP", "extensions", "typertools")];
  {
    folders.push(path.join(app.getPath("home"), "AppData", "Roaming", "Adobe", "CEP", "extensions", "typertools"));
    [process.env["CommonProgramFiles(x86)"], process.env.CommonProgramFiles].filter(Boolean)
      .forEach((common) => folders.push(path.join(common, "Adobe", "CEP", "extensions", "typertools")));
  }
  return folders.filter((folder, index) => folders.findIndex((other) => other.toLowerCase() === folder.toLowerCase()) === index);
};

// A file the plugin was writing when it stopped has its last good copy beside it
const readPluginFile = async (file) => {
  for (const candidate of [file, `${file}.bak`]) {
    try {
      const { size } = await fs.promises.stat(candidate);
      if (!size || size > PLUGIN_FILE_LIMIT) continue;
      const text = await fs.promises.readFile(candidate, "utf8");
      const value = JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value)) return text;
    } catch (error) {}
  }
  return null;
};

// The folder used last wins, when both versions of the plugin have been installed
const findPhotoshopSettings = async () => {
  let best = null;
  for (const folder of pluginFolders()) {
    let names;
    try {
      names = (await fs.promises.readdir(folder)).filter((name) => PLUGIN_FILE.test(name));
    } catch (error) {
      continue;
    }
    if (!names.includes("storage") && !names.includes("storage_profiles")) continue;
    let modified = 0;
    const files = {};
    for (const name of names) {
      const text = await readPluginFile(path.join(folder, name));
      if (text === null) continue;
      files[name] = text;
      try {
        modified = Math.max(modified, (await fs.promises.stat(path.join(folder, name))).mtimeMs);
      } catch (error) {}
    }
    if (!files.storage && !files.storage_profiles) continue;
    const kind = folder.toLowerCase().includes(`${path.sep}cep${path.sep}`) ? "cep" : "uxp";
    if (!best || modified > best.modified) best = { kind, modified, files };
  }
  return best;
};

/* ------------------------------------ putting it together -------------------------- */

// Its scripts ran: this version works. Bringing a heavy session back can then take its time.
ipcMain.on("page-ready", () => {
  pageReady = true;
  openPaths(waitingPaths.splice(0));
  deliverScript(waitingScript);
  waitingScript = null;
});
ipcMain.on("text-edit", (event, command) => {
  if (Object.values(TEXT_EDITS).includes(command) && win) win.webContents[command]();
});
ipcMain.on("set-strings", (event, given) => { strings = given; });
ipcMain.on("set-title-bar", (event, color, symbolColor) => {
  const hex = /^#[0-9a-f]{6}$/i;
  if (!win || !hex.test(color) || !hex.test(symbolColor)) return;
  try {
    win.setTitleBarOverlay({ color, symbolColor, height: BAR_HEIGHT });
    win.setBackgroundColor(color);
  } catch (error) { /* an older Electron */ }
});
ipcMain.handle("photoshop-settings", () => findPhotoshopSettings().catch((error) => {
  console.warn("TypeR for Photoshop's settings:", error.message);
  return null;
}));
// Generative Fill with FLUX on this computer (local-ai.js). Only this window may ask, only for a
// model the app knows; downloads and fills can be stopped by the id the page gave them.
const fromPage = (event) => Boolean(win) && event.sender === win.webContents;
const fromEditor = (event) => fromPage(event) && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url.startsWith(START_URL);

// Updates are manual and come only from the GitHub provider fixed in desktop/package.json.
let updates = null;
const updateManager = () => {
  if (!updates) {
    const { autoUpdater } = require("electron-updater");
    updates = createUpdateManager({
      updater: autoUpdater,
      currentVersion: app.getVersion(),
      packaged: app.isPackaged,
      notify: (state) => { if (win && !win.isDestroyed()) win.webContents.send("updates-state", state); },
    });
  }
  return updates;
};
ipcMain.handle("updates-check", (event) => fromEditor(event) ? updateManager().check() : { status: "denied" });
ipcMain.handle("updates-download", (event) => fromEditor(event) ? updateManager().download() : { status: "denied" });
ipcMain.handle("updates-install", (event) => fromEditor(event) ? updateManager().install() : false);

const firefly = createFirefly({
  parent: () => win,
  changed: (state) => { if (win && !win.isDestroyed()) win.webContents.send("firefly-state", state); },
});
// The operation library is deliberately plain JSON: it can be backed up or edited without the app.
const actionsFolder = () => path.join(app.getPath("userData"), "Actions");
const actionsFile = () => path.join(actionsFolder(), "actions.json");
ipcMain.handle("actions-load", async (event) => {
  if (!fromEditor(event)) return null;
  try { return JSON.parse(await fs.promises.readFile(actionsFile(), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
});
ipcMain.handle("actions-save", async (event, sets) => {
  if (!fromEditor(event) || !Array.isArray(sets) || JSON.stringify(sets).length > 20e6) return false;
  await fs.promises.mkdir(actionsFolder(), { recursive: true });
  const temporary = `${actionsFile()}.tmp`;
  await fs.promises.writeFile(temporary, `${JSON.stringify(sets, null, 2)}\n`, "utf8");
  await fs.promises.rename(temporary, actionsFile());
  return true;
});
ipcMain.handle("actions-show", async (event) => {
  if (!fromEditor(event)) return false;
  await fs.promises.mkdir(actionsFolder(), { recursive: true });
  return !(await shell.openPath(actionsFolder()));
});

ipcMain.handle("firefly-status", (event) => fromEditor(event) ? firefly.status() : null);
ipcMain.handle("firefly-credits", (event) => fromEditor(event) ? firefly.credits() : null);
ipcMain.handle("firefly-connect", (event) => fromEditor(event) ? firefly.connect() : null);
ipcMain.handle("firefly-disconnect", (event) => fromEditor(event) ? firefly.disconnect() : null);
ipcMain.handle("firefly-generate", (event, id, request) => fromEditor(event) ? firefly.generate(id, request) : null);
ipcMain.on("firefly-cancel", (event, id) => { if (fromEditor(event)) firefly.cancel(id); });
app.on("before-quit", () => firefly.close());

// Fixed OpenRouter Image API routes, outside renderer CORS. The API key is used for this request
// only and is not written by the main process.
const openRouter = createOpenRouter();
ipcMain.handle("openrouter-request", (event, id, request) => fromEditor(event) ? openRouter.request(id, request || {}) : { ok: false, kind: "other", message: "Not allowed." });
ipcMain.on("openrouter-cancel", (event, id) => { if (fromEditor(event)) openRouter.cancel(id); });
const localJobs = new Map();
const localJob = async (event, id, run) => {
  if (!fromPage(event)) throw new Error("Not allowed.");
  const key = String(id);
  const controller = new AbortController();
  localJobs.set(key, controller);
  const tell = (progress) => { if (!event.sender.isDestroyed()) event.sender.send("local-ai-progress", Object.assign({ id: key }, progress)); };
  try {
    return { ok: true, value: await run(controller.signal, tell) };
  } catch (error) {
    if (!(error instanceof localAI.LocalError)) console.warn("Local Generative Fill:", error);
    return { ok: false, kind: error.kind || "other", message: String(error.message || error).slice(0, 500) };
  } finally {
    localJobs.delete(key);
  }
};
ipcMain.handle("local-ai-status", (event) => (fromPage(event) ? localAI.status() : null));
ipcMain.handle("local-ai-install", (event, id, model) => localJob(event, id, (signal, tell) => localAI.install(String(model), signal, tell)));
ipcMain.handle("local-ai-remove", (event, model) => (fromPage(event) ? localAI.remove(String(model)) : null));
ipcMain.handle("local-ai-generate", (event, id, request) => localJob(event, id, (signal, tell) => {
  const { model, image, mask, prompt, width, height } = request || {};
  if (!(image instanceof Uint8Array) || !(mask instanceof Uint8Array) || !Number.isFinite(width) || !Number.isFinite(height) || width > 2048 || height > 2048) throw new localAI.LocalError("other", "Bad request.");
  return localAI.generate({ model: String(model), image, mask, prompt: String(prompt || ""), width, height }, signal, tell);
}));
ipcMain.on("local-ai-cancel", (event, id) => {
  const controller = fromPage(event) && localJobs.get(String(id));
  if (controller) controller.abort();
});

// The Font FindeR's fonts, installed for this user only, as TypeR for Photoshop does: no admin
// rights. Only font files, under a plain name, in the user's own Windows font folder. They are
// registered under HKCU and announced to the running apps.
const FONT_FILE_LIMIT = 50 * 1024 * 1024;
const FONT_KIND = { OTTO: ".otf", ttcf: ".ttc", true: ".ttf", "\u0000\u0001\u0000\u0000": ".ttf" };
// Tests install into a folder of their own
const fontFolder = () => (isTest && process.env.TYPER_TEST_FONTS)
  || path.join(process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local"), "Microsoft", "Windows", "Fonts");
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const registerWindowsFonts = (entries) => new Promise((resolve, reject) => {
  const script = [
    "$ErrorActionPreference = 'Stop';",
    "$reg = 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';",
    "if (-not (Test-Path $reg)) { New-Item -Path $reg -Force | Out-Null };",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class TypeRFontApi { [DllImport(\"gdi32.dll\")] public static extern int AddFontResource(string path); [DllImport(\"user32.dll\")] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result); }';",
    ...entries.flatMap((entry) => [
      `New-ItemProperty -Path $reg -Name ${psQuote(entry.registryName)} -Value ${psQuote(entry.path)} -PropertyType String -Force | Out-Null;`,
      `[void][TypeRFontApi]::AddFontResource(${psQuote(entry.path)});`,
    ]),
    // HWND_BROADCAST + WM_FONTCHANGE, and a hung window doesn't stall the install
    "$out = [IntPtr]::Zero;",
    "[void][TypeRFontApi]::SendMessageTimeout([IntPtr]0xffff, 0x1D, [IntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$out);",
  ].join(" ");
  const { execFile } = require("child_process");
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true }, (error) => (error ? reject(error) : resolve()));
});
const installFonts = async (fonts) => {
  if (!Array.isArray(fonts) || !fonts.length || fonts.length > 200) throw new Error("Bad request.");
  const files = fonts.map((font) => {
    const bytes = font && font.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > FONT_FILE_LIMIT) throw new Error("Not a font file.");
    const extension = FONT_KIND[Buffer.from(bytes.subarray(0, 4)).toString("latin1")];
    if (!extension) throw new Error("Not a font file.");
    const stem = path.basename(String(font.name || "font")).replace(/\.[^.]*$/, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 120) || "font";
    const displayName = String(font.displayName || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200) || stem;
    return { bytes, fileName: stem + extension, registryName: `${displayName} (${extension === ".otf" ? "OpenType" : "TrueType"})` };
  });
  const folder = fontFolder();
  await fs.promises.mkdir(folder, { recursive: true });
  const entries = [];
  for (const file of files) {
    const target = path.join(folder, file.fileName);
    await fs.promises.writeFile(target, file.bytes);
    entries.push({ path: target, registryName: file.registryName });
  }
  if (!isTest) await registerWindowsFonts(entries);
  return entries.length;
};
ipcMain.handle("install-fonts", async (event, fonts) => {
  if (!fromPage(event)) return { ok: false, message: "Not allowed." };
  try {
    return { ok: true, count: await installFonts(fonts) };
  } catch (error) {
    console.warn("Font install:", error);
    return { ok: false, message: String(error.message || error).slice(0, 300) };
  }
});

/* --------------------------------- Open in Photoshop -------------------------------- */

// Where a file the page holds is: a handle doesn't say, but asking about its permission makes
// Chromium check it here, with its path. The page asks about one handle at a time, between
// where-start and where-end; a path is only taken when its name and kind are the handle's.
// A file taken from a folder the page opened answers with that folder, as it shares its
// permission: the file is the one of that name in it. Photoshop is only given the paths found
// this way, and only once they are there on the disk.
let whereAsked = null;
let whereCount = 0;
const knownPaths = new Set();
const plainName = (name) => name !== "" && name !== "." && name !== ".." && path.basename(name) === name;
const noteWhere = (details) => {
  if (!whereAsked || !details || !details.filePath) return;
  const { name, directory } = whereAsked;
  if (details.isDirectory && !directory) {
    if (plainName(name)) whereAsked.paths.add(path.join(details.filePath, name));
    return;
  }
  if (path.basename(details.filePath) !== name || Boolean(details.isDirectory) !== directory) return;
  whereAsked.paths.add(details.filePath);
};
ipcMain.handle("where-start", (event, name, directory) => {
  if (!fromPage(event)) return 0;
  whereAsked = { token: ++whereCount, name: String(name), directory: Boolean(directory), paths: new Set() };
  return whereAsked.token;
});
ipcMain.handle("where-end", async (event, token) => {
  const asked = whereAsked;
  if (!fromPage(event) || !asked || asked.token !== token) return null;
  whereAsked = null;
  if (asked.paths.size !== 1) return null;
  const [found] = asked.paths;
  const stat = await fs.promises.stat(found).catch(() => null);
  if (!stat || stat.isDirectory() !== asked.directory) return null;
  knownPaths.add(found);
  return found;
});

// The Photoshops installed by Adobe for Windows, newest first.
const execText = (file, args) => new Promise((resolve) => {
  const { execFile } = require("child_process");
  execFile(file, args, { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? "" : String(stdout)));
});
const exists = (file) => fs.promises.access(file).then(() => true, () => false);
const childrenOf = (folder) => fs.promises.readdir(folder).catch(() => []);
const findWindowsPhotoshops = async () => {
  const folders = [];
  const listed = await execText("reg", ["query", "HKLM\\SOFTWARE\\Adobe\\Photoshop", "/s", "/v", "ApplicationPath"]);
  listed.split(/\r?\n/).forEach((line) => {
    const match = /^\s*ApplicationPath\s+REG_SZ\s+(.+?)\s*$/.exec(line);
    if (match) folders.push(match[1]);
  });
  for (const programs of [process.env.ProgramW6432, process.env.ProgramFiles].filter(Boolean)) {
    const adobe = path.join(programs, "Adobe");
    (await childrenOf(adobe)).filter((name) => /^Adobe Photoshop/i.test(name)).forEach((name) => folders.push(path.join(adobe, name)));
  }
  const found = [];
  for (const folder of folders) {
    const exe = path.join(folder, "Photoshop.exe");
    if (await exists(exe)) found.push({ path: exe, name: path.basename(folder.replace(/[\\/]+$/, "")), version: "" });
  }
  return found;
};
const findPhotoshops = async () => {
  let found = [];
  if (process.env.TYPER_TEST_PHOTOSHOP) found = JSON.parse(process.env.TYPER_TEST_PHOTOSHOP);
  // A test must not find the Photoshop of the computer it runs on
  else if (isTest) found = [];
  else found = await findWindowsPhotoshops();
  const byPlace = new Map();
  for (const one of found) {
    let place = one.path;
    try {
      place = await fs.promises.realpath(one.path);
    } catch (error) {}
    if (!byPlace.has(place.toLowerCase())) byPlace.set(place.toLowerCase(), { id: place, name: one.name, version: one.version || "" });
  }
  const order = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...byPlace.values()].sort((a, b) => order.compare(b.name, a.name));
};

const openInPhotoshop = async (target, files) => {
  if (isTest) {
    global.typerPhotoshopOpened = (global.typerPhotoshopOpened || []).concat([{ app: target.id, files }]);
    return;
  }
  // A Photoshop already open takes the files from the one started here
  const { spawn } = require("child_process");
  await new Promise((resolve, reject) => {
    const child = spawn(target.id, files, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
};

// A document Photoshop already has open only comes to the front when its file is opened again,
// as Photoshop last read it. Before opening, Photoshop closes the ones whose file changed since
// it was last sent there, so that they open as they are now. One with changes not saved in
// Photoshop is left as it is, and its name returned, unless replace is true.
const lastSent = new Map();
const modifiedAt = async (file) => (await fs.promises.stat(file).catch(() => null) || {}).mtimeMs || 0;

const reloadScript = (files, replace) => `(function () {
  var wanted = ${JSON.stringify(files)}, replace = ${replace ? "true" : "false"}, found = [], unsaved = [];
  for (var j = 0; j < wanted.length; j++) wanted[j] = new File(wanted[j]).fsName.toLowerCase();
  for (var i = 0; i < app.documents.length; i++) {
    var doc = app.documents[i], where;
    try { where = doc.fullName.fsName.toLowerCase(); } catch (e) { continue; }
    for (var k = 0; k < wanted.length; k++) {
      if (wanted[k] !== where) continue;
      found.push(doc);
      if (!doc.saved) unsaved.push(doc.name);
      break;
    }
  }
  if (unsaved.length && !replace) return unsaved.join("\\n");
  for (var n = 0; n < found.length; n++) found[n].close(SaveOptions.DONOTSAVECHANGES);
  return "";
})();`;

// Runs a script in the Photoshop given, only if it is already running: its answer, as text
const runInPhotoshop = (target, code) => new Promise((resolve, reject) => {
  const { execFile } = require("child_process");
  const done = (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim())) : resolve(String(stdout).replace(/\r?\n$/, "")));
  if (process.platform !== "win32") return resolve("");
  const command = [
    "try { $ps = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application') } catch { exit 0 }",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "Write-Output $ps.DoJavaScript($env:TYPER_PHOTOSHOP_SCRIPT)",
  ].join("\n");
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
    timeout: 20000,
    windowsHide: true,
    env: { ...process.env, TYPER_PHOTOSHOP_SCRIPT: code },
  }, done);
});

// The names of the documents with changes not saved in Photoshop, left open; [] when all is ready
const reloadInPhotoshop = async (target, files, replace) => {
  const changed = [];
  for (const file of files) {
    if (lastSent.get(file) !== (await modifiedAt(file))) changed.push(file);
  }
  if (!changed.length) return [];
  if (isTest) {
    global.typerPhotoshopReloaded = (global.typerPhotoshopReloaded || []).concat([{ files: changed, replace }]);
    const unsaved = global.typerPhotoshopUnsaved || [];
    return replace ? [] : unsaved.filter((name) => changed.some((file) => path.basename(file) === name));
  }
  try {
    // Photoshop knows a file by its real place, with links followed
    const real = await Promise.all(changed.map((file) => fs.promises.realpath(file).catch(() => file)));
    const answer = await runInPhotoshop(target, reloadScript(real, replace));
    return answer ? answer.split("\n").filter(Boolean) : [];
  } catch (error) {
    // Refused, or Photoshop busy with a dialog: the files still open, as before
    console.warn("Photoshop's open documents:", error.message);
    return [];
  }
};

// The script sent with the pages, for TypeR in Photoshop: a file it looks for when a document
// opens there, takes into a script tab (the one holding the same text, or a new one), then
// removes. Only this file is written in TypeR's folder; the plugin's settings stay untouched.
const scriptForPhotoshop = () => path.join(exchangeFolder(), "script.json");
const sendScript = async (script, files) => {
  const value = {
    from: "TypeR Studio", // legacy plugin protocol; product identifies the Windows app
    product: "SG Typer Studio",
    version: 1,
    sent: Date.now(),
    name: String(script.name || "").slice(0, 200),
    text: String(script.text || "").replace(/\r\n?/g, "\n"),
    files,
  };
  if (!value.text.trim() || value.text.length > SCRIPT_LIMIT) throw new Error("This script can't be sent.");
  if (isTest) {
    global.typerPhotoshopScript = value;
    return;
  }
  const file = scriptForPhotoshop();
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  // Read whole or not at all: the plugin may look while it's being written
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(value), "utf8");
  await fs.promises.rename(temporary, file);
};

ipcMain.handle("photoshop-list", async (event) => {
  if (!fromPage(event)) return [];
  try {
    return await findPhotoshops();
  } catch (error) {
    console.warn("Finding Photoshop:", error);
    return [];
  }
});
ipcMain.handle("photoshop-open", async (event, id, paths, script, replace) => {
  if (!fromPage(event)) return { ok: false, message: "Not allowed." };
  try {
    const target = (await findPhotoshops()).find((one) => one.id === id);
    if (!target) return { ok: false, message: "This Photoshop is no longer on this computer." };
    const files = [];
    for (const file of Array.isArray(paths) ? paths : []) {
      if (typeof file === "string" && knownPaths.has(file) && /\.ps[db]$/i.test(file) && (await exists(file)) && !files.includes(file)) files.push(file);
    }
    if (!files.length) return { ok: false, message: "No file to open." };
    // Already open in Photoshop: opened again as they are now, Photoshop's own changes asked about
    const unsaved = await reloadInPhotoshop(target, files, replace === true);
    if (unsaved.length) return { ok: false, unsaved, message: `Not saved in Photoshop: ${unsaved.join(", ")}` };
    // Waiting for TypeR before the pages open: it looks for the script as they do
    let scriptError = null;
    if (script && typeof script === "object") {
      try {
        await sendScript(script, files);
      } catch (error) {
        console.warn("Script for TypeR in Photoshop:", error);
        scriptError = String(error.message || error).slice(0, 300);
      }
    }
    await openInPhotoshop(target, files);
    for (const file of files) lastSent.set(file, await modifiedAt(file));
    return { ok: true, count: files.length, scriptError };
  } catch (error) {
    console.warn("Open in Photoshop:", error);
    return { ok: false, message: String(error.message || error).slice(0, 300) };
  }
});

// Discord's Rich Presence (discord.js): only what the page is on, the rest is set there
// A test doesn't show anything in the Discord of the computer it runs on
const discordOn = !isTest || process.env.TYPER_TEST_DISCORD === "1";
ipcMain.handle("discord-available", (event) => fromPage(event) && discord.available && discordOn);
ipcMain.on("discord-activity", (event, activity) => {
  if (fromPage(event) && discordOn) discord.set(activity);
});

app.on("second-instance", (event, args) => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  openPaths(openablePaths(args.slice(1)));
  openLinks(args.slice(1));
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => discord.stop());

app.whenReady().then(() => {
  protocol.handle(SCHEME, serve);
  setPermissions();
  // No default Electron menu: all application menus belong to the embedded workspace.
  Menu.setApplicationMenu(null);
  if (process.env.TYPER_TEST_API === "1") global.typerTest = { openPaths, openLinks };
  createWindow();
  openPaths(openablePaths(process.argv.slice(app.isPackaged ? 1 : 2)));
  openLinks(process.argv.slice(app.isPackaged ? 1 : 2));
  // typer-studio:// leads here. The installers declare it too (package.json, installer.nsh):
  // this keeps it pointing at this copy of the app.
  if (app.isPackaged && !isTest) {
    LINK_SCHEMES.forEach((scheme) => app.setAsDefaultProtocolClient(scheme));
    noteWhereStudioIs();
  }
});
