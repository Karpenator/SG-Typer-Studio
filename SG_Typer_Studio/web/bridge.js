// Loaded first in the panel's iframe: rebuilds the CEP environment the TypeR
// panel expects (window.__adobe_cep__, window.cep), then starts the panel. No
// file of the panel is changed: it runs as it does in Photoshop.

(function () {
  "use strict";

  const photoshop = window.parent.TypeRPhotoshop;
  const ROOT = "/typer";
  const params = new URLSearchParams(window.location.search);
  const language = params.get("lang") || "en";
  const LOCALES = { en: "en_US", fr: "fr_FR", es: "es_SP", it: "it_IT", de: "de_DE", pt: "pt_BR", ru: "ru_RU", tr: "tr_TR", uk: "uk_UA", vi: "vi_VN", ar: "ar_AE" };
  // Languages the Photoshop plugin doesn't ship yet live in web/panel-locale/
  const EXTRA_LOCALES = ["it_IT"];
  const appLocale = LOCALES[language] || "en_US";
  const gray = { antialiasLevel: 0, type: 1, color: { red: 58, green: 56, blue: 56, alpha: 255 } };

  // TypeR's storage files live in the embedded Chromium profile.
  const kit = window.parent.TypeRKit;
  const remember = (path, value) => {
    if (kit.keeps(path)) kit.keep(path, value);
  };
  const forget = (path) => {
    if (kit.keeps(path)) kit.forget(path);
  };
  let startingStorage = kit.read(ROOT + "/storage");
  const shell = window.parent.TypeRShell;
  if (!startingStorage) {
    // A new user starts as in Photoshop: no styles, no script, and TypeR's own tutorial.
    // On a touch screen the tutorial's gestures don't apply.
    // SG Typer Studio has its own tutorial (guide.js): the panel's isn't started here
    startingStorage = JSON.stringify(shell.touch ? kit.freshTouchStorage(window.parent.TypeRApp.T("Dialogue")) : kit.freshStorage(!window.parent.TypeRGuide));
  } else {
    // The panel speaks the app's language: a language picked in its settings before they
    // lost the choice would win over it
    try {
      const stored = JSON.parse(startingStorage);
      delete stored.language;
      if (params.get("tour")) stored.notFirstTime = false;
      startingStorage = JSON.stringify(stored);
    } catch (error) {
      console.warn("SG Typer Studio: could not read TypeR's settings", error);
    }
  }
  const files = { [ROOT + "/storage"]: startingStorage };
  // The other profiles, and the list of profiles
  kit.storedPaths().forEach((path) => { files[path] = kit.read(path); });
  const FS = { NO_ERROR: 0, ERR_UNKNOWN: 1, ERR_INVALID_PARAMS: 2, ERR_NOT_FOUND: 3, ERR_CANT_READ: 4, ERR_UNSUPPORTED_ENCODING: 5, ERR_CANT_WRITE: 6, ERR_OUT_OF_SPACE: 7, ERR_NOT_FILE: 8, ERR_NOT_DIRECTORY: 9, ERR_FILE_EXISTS: 10 };

  const parseProperties = (text) => {
    const out = {};
    let key = null;
    let value = "";
    String(text || "").replace(/\r/g, "").split("\n").forEach((line) => {
      if (key === null && (line.startsWith("#") || !line.trim())) return;
      if (key !== null) value += line;
      else {
        const at = line.indexOf("=");
        if (at === -1) return;
        key = line.slice(0, at).trim();
        value = line.slice(at + 1);
      }
      if (value.endsWith("\\")) {
        value = value.slice(0, -1) + "\n";
        return;
      }
      out[key] = value;
      key = null;
      value = "";
    });
    return out;
  };

  const fs = Object.assign({}, FS, {
    readFile(path) {
      if (Object.prototype.hasOwnProperty.call(files, path)) return { err: FS.NO_ERROR, data: files[path] };
      return { err: FS.ERR_NOT_FOUND, data: "" };
    },
    writeFile(path, data, encoding) {
      files[path] = String(data);
      if (window.parent.TypeRTouch) window.parent.TypeRTouch.panelChanged();
      if (kit.keeps(path)) remember(path, files[path]);
      // The app follows what the panel keeps: its current line in the status bar, its shortcuts
      if (kit.keeps(path)) window.parent.dispatchEvent(new Event("typer-storage"));
      // A file written outside TypeR's own folder is an export: it is downloaded. A font or a
      // .zip comes as Base64, and the file must hold its bytes, not that text
      else if (String(path).indexOf(ROOT + "/") !== 0) downloadFile(String(path).split(/[\\/]/).pop(), encoding === "Base64" ? fromBase64(files[path]) : files[path]);
      return { err: FS.NO_ERROR };
    },
    deleteFile(path) {
      const existed = Object.prototype.hasOwnProperty.call(files, path);
      delete files[path];
      forget(path);
      return { err: existed ? FS.NO_ERROR : FS.ERR_NOT_FOUND };
    },
    makedir() { return { err: FS.NO_ERROR }; },
    readdir() { return { err: FS.NO_ERROR, data: [] }; },
    stat() { return { err: FS.ERR_NOT_FOUND }; },
    rename() { return { err: FS.NO_ERROR }; },
    // The panel's file dialogs: a folder means "where to export", which is a download
    showOpenDialogEx(multiple, chooseDirectory, title, initial, types) {
      if (chooseDirectory) return { err: FS.NO_ERROR, data: ["/downloads"] };
      return pickFiles(multiple, types);
    },
    // Saving goes to the browser's downloads (see writeFile)
    showSaveDialogEx(title, initial, types, name) {
      const extension = types && types[0] ? "." + types[0] : "";
      if (extension === ".zip") lendZipHost();
      return { err: FS.NO_ERROR, data: "/downloads/" + (name || "TypeR" + extension) };
    },
  });
  fs.showOpenDialog = fs.showOpenDialogEx;
  fs.showSaveDialog = fs.showSaveDialogEx;

  const downloadFile = (name, data) => {
    const link = window.parent.document.createElement("a");
    link.href = URL.createObjectURL(new Blob([data], { type: "application/octet-stream" }));
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  };

  const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

  const toBase64 = (bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };

  // The fonts a .zip can carry: the files loaded in this browser, and the computer's own
  // when the browser may read them. The built-in fonts stay out, like any font without a file.
  const fontFileBytes = async (font) => {
    if (font.source === "file") {
      await window.parent.TypeRFonts.ensure(font.postScriptName);
      const loaded = window.parent.TypeRFonts.get(font.postScriptName);
      return loaded && loaded.url ? new Uint8Array(await (await fetch(loaded.url)).arrayBuffer()) : null;
    }
    if (font.source !== "local" || !window.parent.queryLocalFonts) return null;
    const [local] = await window.parent.queryLocalFonts({ postscriptNames: [font.postScriptName] });
    return local ? new Uint8Array(await (await local.blob()).arrayBuffer()) : null;
  };

  const findFont = (ref) => {
    const Fonts = window.parent.TypeRFonts;
    return Fonts.get(ref.postScriptName) || Fonts.list().find((font) => font.family === ref.fontName && font.style === (ref.fontStyleName || "Regular"));
  };

  const fontFileName = (font, bytes) => {
    const tag = String.fromCharCode.apply(null, bytes.subarray(0, 4));
    return `fonts/${font.postScriptName}.${tag === "OTTO" ? "otf" : tag === "ttcf" ? "ttc" : "ttf"}`;
  };

  const exportZip = async ({ zipPath, jsonFileName, jsonString, fontRefs }) => {
    const entries = [{ name: jsonFileName, data: new TextEncoder().encode(jsonString) }];
    const missing = [];
    const used = new Set();
    for (const ref of fontRefs || []) {
      const font = findFont(ref);
      const bytes = font ? await fontFileBytes(font).catch(() => null) : null;
      if (!bytes) missing.push(ref.label);
      else if (!used.has(font.postScriptName)) {
        used.add(font.postScriptName);
        entries.push({ name: fontFileName(font, bytes), data: bytes });
      }
    }
    downloadFile(String(zipPath).split(/[\\/]/).pop(), await kit.writeArchive(entries));
    return { ok: true, missing, fontCount: used.size };
  };

  // fontFileExport.js leaves a .zip to the plugin's host when window.typerUXP exists. The
  // panel calls it right after the save dialog, before any timer runs, and everything else
  // only looks for that host when it loads: it stays here for that one step.
  const lendZipHost = () => {
    window.typerUXP = { request: (name, data) => (name === "exportZipWithFonts" ? exportZip(data) : Promise.reject(new Error(name))) };
    setTimeout(() => { delete window.typerUXP; }, 0);
  };

  // The fonts the Font FindeR installs (TypeR's fontInstaller.js): kept here like a font file
  // the user loads, so the text can use them at once. The desktop app also installs them on
  // the computer, for the other apps, as the Photoshop plugin does.
  window.typerFontHost = {
    async installFonts(fonts) {
      const files = (fonts || []).map((font) => ({ name: font.saveName, displayName: font.displayName, bytes: font.bytes }));
      const { added } = await window.parent.TypeRFonts.addFiles(files.map((file) => ({ name: file.name, buffer: file.bytes.slice().buffer })));
      if (!added.length) throw new Error("installFailed");
      const desktop = window.parent.TypeRDesktop;
      if (desktop && desktop.installFonts) {
        const result = await desktop.installFonts(files);
        if (!result || !result.ok) throw new Error((result && result.message) || "installFailed");
      }
      return files.length;
    },
  };

  const pickFiles = (multiple, types) => new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = Boolean(multiple);
    // A style file can also be the .zip TypeR exports with its fonts
    const styleFile = types && types.includes("json");
    // Not on a touch screen: iOS greys out the extensions it doesn't know (see touch.js)
    if (types && types.length && !shell.touch) input.accept = types.map((type) => "." + type).concat(styleFile ? [".zip"] : []).join(",");
    input.addEventListener("change", async () => {
      const picked = Array.from(input.files);
      // A .zip is imported by the window around the panel
      if (styleFile && picked.some((file) => /\.zip$/i.test(file.name))) {
        resolve({ err: FS.NO_ERROR, data: [] });
        window.parent.TypeRApp.importKits(picked);
        return;
      }
      const paths = [];
      for (const file of Array.from(input.files)) {
        const key = photoshop.ops.registerFile(file);
        if (/\.(json|txt|properties)$/i.test(file.name)) files[key] = await file.text();
        // A tool preset is binary: the panel asks for it in Base64
        else if (/\.tpl$/i.test(file.name)) files[key] = toBase64(new Uint8Array(await file.arrayBuffer()));
        paths.push(key);
      }
      resolve({ err: FS.NO_ERROR, data: paths });
    });
    input.addEventListener("cancel", () => resolve({ err: FS.NO_ERROR, data: [] }));
    input.click();
  });

  // The embedded panel comes from the Photoshop plugin and contains legacy website/update
  // links. Those controls are disabled; the original projects' GitHub pages remain valid credits.
  const RETIRED_EXTERNAL = /(?:typer\.hayasaku\.fr|discord(?:\.gg|\.com\/invite)|ko-fi\.com|swirt\.github\.io\/typertools)/i;

  window.cep = {
    fs,
    encoding: { UTF8: "UTF-8", Base64: "Base64", convertion: {} },
    util: {
      openURLInDefaultBrowser(url) {
        if (RETIRED_EXTERNAL.test(String(url))) return { err: FS.NO_ERROR };
        window.open(String(url), "_blank", "noopener");
        return { err: FS.NO_ERROR };
      },
      registerExtensionUnloadCallback() {},
    },
  };

  const environment = () => ({
    appName: "PHXS",
    // Photoshop 2024: no switch to the UXP plugin is offered in the browser
    appVersion: "25.0.0",
    appLocale,
    appUILocale: appLocale,
    appId: "PHXS",
    isAppOnline: true,
    appSkinInfo: {
      baseFontFamily: "system-ui",
      baseFontSize: 12,
      appBarBackgroundColor: gray,
      panelBackgroundColor: gray,
      appBarBackgroundColorSRGB: gray,
      panelBackgroundColorSRGB: gray,
      systemHighlightColor: { red: 40, green: 142, blue: 223, alpha: 255 },
    },
  });

  let bundle = {};
  window.__adobe_cep__ = {
    getHostEnvironment: () => JSON.stringify(environment()),
    getCurrentApiVersion: () => JSON.stringify({ major: 11, minor: 0, micro: 0 }),
    getSystemPath: () => ROOT,
    getExtensionId: () => photoshop.extensionId,
    getHostCapabilities: () => JSON.stringify({ EXTENDED_PANEL_MENU: false, EXTENDED_PANEL_ICONS: false, DELEGATE_APE_ENGINE: false, SUPPORT_HTML_EXTENSIONS: true, DISABLE_FLASH_EXTENSIONS: true }),
    evalScript: (script, callback) => photoshop.evalScript(script, callback),
    addEventListener: (type, listener, obj) => photoshop.addPanelListener(type, listener, obj),
    removeEventListener: (type, listener) => photoshop.removePanelListener(type, listener),
    dispatchEvent() {},
    closeExtension() {},
    requestOpenExtension() {},
    getExtensions: () => "[]",
    getNetworkPreferences: () => "{}",
    initResourceBundle: () => JSON.stringify(bundle),
    dumpInstallationInfo: () => "",
    getScaleFactor: () => window.devicePixelRatio || 1,
    getMonitorScaleFactor: () => window.devicePixelRatio || 1,
    setScaleFactorChangedHandler() {},
    invokeSync: (name) => (name === "isWindowVisible" ? "true" : ""),
    invokeAsync() {},
    resizeContent() {},
    registerInvalidCertificateCallback() {},
    registerKeyEventsInterest() {},
    loadSnapshot() {},
  };

  // No plugin installer or site manifest in the desktop app: update checks answer "up to
  // date", and every other retired website/promo/download endpoint stays unreachable.
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = String((input && input.url) || input);
    if (/api\.github\.com\/repos\/ScanR\/TypeR/i.test(url)) {
      return Promise.resolve(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (RETIRED_EXTERNAL.test(url)) return Promise.resolve(new Response("Retired external endpoint", { status: 410 }));
    return realFetch(input, init);
  };

  // Files the user imports stay in the renderer: their "path" is a blob URL
  Object.defineProperty(File.prototype, "path", {
    configurable: true,
    get() {
      return photoshop.ops.registerFile(this);
    },
  });

  // The panel previews styles with local() fonts: here they are web fonts
  const webFonts = {};
  window.parent.TypeRFonts.BUILTIN.forEach((font) => {
    const url = `url("../../assets/fonts/${font.file}.woff2") format("woff2")`;
    webFonts[font.postScriptName] = url;
    webFonts[font.name] = url;
    webFonts[`${font.family} ${font.style}`] = url;
  });
  const LOCAL_FONT = /local\("([^"]+)"\)/g;
  const rewriteFontRules = (style) => {
    const text = style.textContent;
    if (!text || text.indexOf("local(") === -1) return;
    let changed = false;
    const next = text.replace(/src:([^;}]*)/g, (whole, list) => {
      let url = null;
      LOCAL_FONT.lastIndex = 0;
      let match = LOCAL_FONT.exec(list);
      while (match && !url) {
        const loaded = window.parent.TypeRFonts.urlOf(match[1]);
        url = webFonts[match[1]] || (loaded ? `url("${loaded}")` : null);
        match = LOCAL_FONT.exec(list);
      }
      if (!url) return whole;
      changed = true;
      return "src:" + url;
    });
    if (changed) style.textContent = next;
  };
  // Only the <style> elements a change touches are read again, not all of them at each
  // change of the panel: the panel's own rules are in its head, the previews' in its body
  const styleOf = (node) => {
    const element = node.nodeType === 1 ? node : node.parentNode;
    return element && element.nodeType === 1 ? element.closest("style") : null;
  };
  const rewriteTouchedRules = (mutations) => {
    const touched = new Set();
    mutations.forEach((mutation) => {
      const style = styleOf(mutation.target);
      if (style) touched.add(style);
      else if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.nodeName === "STYLE") touched.add(node);
          else if (node.firstElementChild) node.querySelectorAll("style").forEach((inner) => touched.add(inner));
        });
      }
    });
    touched.forEach(rewriteFontRules);
  };
  const watchFontRules = () => {
    const scan = () => Array.prototype.forEach.call(document.querySelectorAll("style"), rewriteFontRules);
    new MutationObserver(rewriteTouchedRules).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    // A kept font is read when it's first asked for: its rule waits for it
    const stop = window.parent.TypeRFonts.onChange(scan);
    window.addEventListener("pagehide", stop);
    scan();
  };

  // Help's illustrations are optional (the panel hides one that doesn't load) and none ship
  // yet: rather than asking for each and getting a 404, the image fails at once
  const HELP_MEDIA = /\/icons\/help\/[^/]+\.gif$/;
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this.tagName === "IMG" && name === "src" && HELP_MEDIA.test(String(value))) {
      const image = this;
      setTimeout(() => image.dispatchEvent(new Event("error")), 0);
      return;
    }
    return setAttribute.call(this, name, value);
  };

  // In Photoshop the panel is its own window. Here a scrollIntoView would also
  // scroll the page around the iframe: keep it inside the panel.
  Element.prototype.scrollIntoView = function (options) {
    for (let box = this.parentElement; box; box = box.parentElement) {
      const overflow = getComputedStyle(box).overflowY;
      if ((overflow !== "auto" && overflow !== "scroll") || box.scrollHeight <= box.clientHeight) continue;
      const item = this.getBoundingClientRect();
      const room = box.getBoundingClientRect();
      const block = options && typeof options === "object" ? options.block : options === false ? "end" : "start";
      if (block === "center") box.scrollTop += item.top + item.height / 2 - (room.top + room.height / 2);
      else if (block === "end") box.scrollTop += item.bottom - room.bottom;
      else if (block === "nearest") {
        if (item.top < room.top) box.scrollTop += item.top - room.top;
        else if (item.bottom > room.bottom) box.scrollTop += item.bottom - room.bottom;
      } else box.scrollTop += item.top - room.top;
      return;
    }
  };

  const syncKeyboard = () => shell.syncKeyboard();
  if (window.visualViewport) window.visualViewport.addEventListener("resize", syncKeyboard);
  ["focusin", "focusout"].forEach((name) => window.addEventListener(name, () => {
    [100, 350, 700].forEach((wait) => setTimeout(syncKeyboard, wait));
  }));

  // Reading the script on a touch screen: the whole row picks the line, its end pastes it.
  // The row's own buttons are the size of a mouse pointer.
  const pressSvg = (host) => {
    const icon = host && host.querySelector("svg");
    if (icon) icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };
  document.addEventListener("click", (event) => {
    const root = document.documentElement;
    if (!root.classList.contains("t-touch") || root.classList.contains("t-writing")) return;
    const row = event.target.closest && event.target.closest(".text-line");
    if (!row || event.target.closest(".text-line-select svg, .text-line-insert svg")) return;
    pressSvg(event.clientX > row.getBoundingClientRect().right - 48 ? row.querySelector(".text-line-insert") : row.querySelector(".text-line-select"));
  });

  // iOS greys out every file whose extension it doesn't know, .psd included: on a touch screen
  // the panel's file pickers take anything, and the panel keeps what it can read (see touch.js)
  document.addEventListener("click", (event) => {
    const input = event.target;
    if (document.documentElement.classList.contains("t-touch") && input instanceof HTMLInputElement && input.type === "file") input.removeAttribute("accept");
  }, true);

  // The panel's Import pages button is a plain file input: its files can be read, not written
  // back, so Save always asked where. Where the browser has a real picker, the panel gets the
  // same files from it, each with the file on disk behind it, and Save writes over the PSD
  const PICKER_TYPES = { ".psd": "image/vnd.adobe.photoshop", ".psb": "image/vnd.adobe.photoshop", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
  document.addEventListener("click", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file" || shell.touch || typeof window.showOpenFilePicker !== "function") return;
    const extensions = input.accept.split(",").map((item) => item.trim().toLowerCase());
    if (!extensions.includes(".psd") || !extensions.every((item) => PICKER_TYPES[item])) return;
    event.preventDefault();
    const accept = {};
    extensions.forEach((item) => (accept[PICKER_TYPES[item]] = accept[PICKER_TYPES[item]] || []).push(item));
    window.showOpenFilePicker({ multiple: input.multiple, types: [{ description: "Photoshop, PNG, JPEG", accept }] }).then(async (handles) => {
      const list = new DataTransfer();
      for (const handle of handles) {
        const file = await handle.getFile();
        photoshop.ops.rememberHandle(file, handle);
        list.items.add(file);
      }
      input.files = list.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, (error) => {
      if (error.name !== "AbortError") console.error(error);
    });
  }, true);

  // The pages given to Import pages are the app's chapter, the one its pager and Page Down /
  // Page Up go through, script or not. The same button, lit, unlinks them. And the other way
  // round: a chapter opened in the app is given to this button (pagesFromApp, below).
  let fromApp = false;
  document.addEventListener("change", (event) => {
    const input = event.target;
    if (!fromApp && input instanceof HTMLInputElement && input.dataset.tour === "import-pages-input" && window.parent.TypeRApp) window.parent.TypeRApp.setPages(input.files, true);
  }, true);
  document.addEventListener("click", (event) => {
    const button = event.target.closest && event.target.closest('[data-tour="import-pages"]');
    if (!fromApp && button && button.classList.contains("is-active") && window.parent.TypeRApp) window.parent.TypeRApp.setPages(null, true);
  }, true);
  // The walkthrough offered by the panel's Help is Photoshop's: here the app's own tutorial
  // (guide.js) takes its place, the Help closing behind it
  document.addEventListener("click", (event) => {
    const guide = window.parent.TypeRGuide;
    const button = event.target.closest && event.target.closest(".help-actions .help-action");
    if (!guide || window.parent.TypeRShell.touch || !button || button !== button.parentNode.querySelector(".help-action")) return;
    event.preventDefault();
    event.stopPropagation();
    const modal = button.closest(".app-modal");
    const close = modal && modal.querySelector(".topcoat-icon-button--large--quiet");
    if (close) close.click();
    guide.show();
  }, true);
  const pagesFromApp = {
    // Made again in this window: the panel reads each file's path, which only this window's files have
    importPages(files) {
      const input = document.querySelector('[data-tour="import-pages-input"]');
      if (!input) return;
      const list = new DataTransfer();
      files.forEach((file) => list.items.add(new File([file], file.name, { type: file.type, lastModified: file.lastModified })));
      fromApp = true;
      try {
        input.files = list.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } finally {
        fromApp = false;
      }
    },
    unlinkPages() {
      const button = document.querySelector('[data-tour="import-pages"].is-active');
      if (!button) return;
      fromApp = true;
      try {
        button.click();
      } finally {
        fromApp = false;
      }
    },
  };

  // Keys for TypeR's shortcut poll, read in the page and in the panel
  const track = (event) => {
    photoshop.setKeys({ meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, key: event.type === "keydown" ? photoshop.keyName(event) : "" });
    if (window.parent.TypeRApp) window.parent.TypeRApp.showSampling(event);
  };
  window.addEventListener("keydown", track, true);
  // The keys that stand for the mouse's buttons click in the panel too (keyclick.js)
  if (window.parent.TypeRKeyClick) window.parent.TypeRKeyClick.watch(window);
  window.addEventListener("keydown", (event) => {
    if (window.parent.TypeRApp) window.parent.TypeRApp.handleKey(event, true);
  });
  window.addEventListener("keyup", track, true);
  window.addEventListener("blur", () => photoshop.clearKeys());
  if (window.parent.TypeRApp) window.parent.TypeRApp.watchChoices(document);

  const load = (url) => fetch(url).then((response) => (response.ok ? response.text() : "")).catch(() => "");

  // FontScanR reads the list of fonts once, when it opens, but the browser only learns
  // about the computer's fonts one by one, during the scan: it would call them missing.
  // The rows added are marked, once per frame, and all of them again when the fonts change
  const markFound = (item) => {
    const preview = item.querySelector(".fsr-item-preview");
    if (!preview) return;
    const state = window.parent.TypeRFonts.isMissing(preview.title) ? "missing" : "found";
    if (item.dataset.font !== state) item.dataset.font = state;
  };
  const fsrAdded = new Set();
  let fsrAll = false;
  let fsrFrame = 0;
  const markFsrItems = () => {
    fsrFrame = 0;
    const all = fsrAll;
    const added = Array.from(fsrAdded);
    fsrAll = false;
    fsrAdded.clear();
    if (all) {
      document.querySelectorAll(".fsr-item").forEach(markFound);
      return;
    }
    added.forEach((node) => {
      if (!node.isConnected) return;
      const item = node.closest(".fsr-item");
      if (item) markFound(item);
      else if (node.firstElementChild) node.querySelectorAll(".fsr-item").forEach(markFound);
    });
  };
  const markFsrSoon = () => {
    if (!fsrFrame) fsrFrame = window.requestAnimationFrame(markFsrItems);
  };
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        const element = node.nodeType === 1 ? node : node.parentElement;
        if (element) fsrAdded.add(element);
      });
    });
    if (fsrAdded.size) markFsrSoon();
  }).observe(document.documentElement, { childList: true, subtree: true });
  const stopMarking = window.parent.TypeRFonts.onChange(() => {
    fsrAll = true;
    markFsrSoon();
  });
  window.addEventListener("pagehide", stopMarking);

  // Sentences that say something else here than in Photoshop: there are no profiles
  const loadWebText = () => fetch("../panel-locale/web-text.json").then((response) => response.json()).catch(() => ({}));
  // Sections hidden here (see panel/index.html): the profiles; the language, which is the
  // app's own (?lang=); and legacy plugin updates, which are disabled above.
  // Without their titles, the settings search doesn't offer them either
  const HIDDEN_TITLES = ["profilesTitle", "profilesManageTitle", "profilesCreateTitle", "settingsLanguageLabel", "settingsCheckUpdatesLabel", "settingsAutoUpdateLabel", "settingsCheckUpdatesButton"];
  const withoutHiddenTitles = (text) => text.replace(new RegExp(`^(${HIDDEN_TITLES.join("|")})=.*$`, "gm"), "");

  Promise.all([
    load("locale/messages.properties"),
    appLocale === "en_US" ? "" : load(EXTRA_LOCALES.includes(appLocale) ? `../panel-locale/${appLocale}/messages.properties` : `locale/${appLocale}/messages.properties`),
    loadWebText(),
  ]).then(([fullBase, fullLocal, webText]) => {
    const base = withoutHiddenTitles(fullBase);
    const local = withoutHiddenTitles(fullLocal);
    files[ROOT + "/locale/messages.properties"] = base;
    if (local) files[`${ROOT}/locale/${appLocale}/messages.properties`] = local;
    bundle = Object.assign({}, parseProperties(base), webText.en_US, parseProperties(local), webText[appLocale]);
    watchFontRules();
    const script = document.createElement("script");
    script.src = "modern.index.js";
    document.body.appendChild(script);
  });

  window.__typerWeb = {
    importPages: pagesFromApp.importPages,
    unlinkPages: pagesFromApp.unlinkPages,
    getFile: (path) => files[path],
    // The panel's words in its language, for what the app shows of it (its menu, its modes)
    text: (key) => (typeof bundle[key] === "string" ? bundle[key] : ""),
    setFile: (path, value) => { files[path] = value; },
  };
  // The panel's button to the other app (TypeR's openInStudio.js): here, the app's own Open in
  // Photoshop, only in the desktop app, which can reach Photoshop
  const parentApp = window.parent;
  if (parentApp.TypeRDesktop && parentApp.TypeRDesktop.photoshop && parentApp.TypeRApp && parentApp.TypeRApp.openInPhotoshop) {
    window.__typerWeb.openInPhotoshop = () => { parentApp.TypeRApp.openInPhotoshop(); };
  }
})();
