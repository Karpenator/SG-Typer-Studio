// All the embedded renderer can ask of the app. There is no direct file access here on purpose:
// it goes through Chromium pickers and capability handles, retaining the renderer sandbox.
// The exceptions: reading, never writing, the Photoshop plugin's settings files, at fixed places,
// installing a font file in the user's own font folder, as the plugin's Font FindeR does, and
// opening in Photoshop the PSD files the page already holds.

const { contextBridge, ipcRenderer, webFrame } = require("electron");
const releaseProvider = require("../package.json").build.publish[0];
const releasesUrl = `https://github.com/${releaseProvider.owner}/${releaseProvider.repo}/releases`;

webFrame.setVisualZoomLevelLimits(1, 1);

contextBridge.exposeInMainWorld("TypeRDesktop", {
  platform: "windows",
  ready: () => ipcRenderer.send("page-ready"),
  setStrings: (strings) => ipcRenderer.send("set-strings", strings),
  // The theme colors for the window controls on Windows (app.js)
  setTitleBar: (color, symbolColor) => ipcRenderer.send("set-title-bar", color, symbolColor),
  // A script sent by TypeR for Photoshop with the pages it opens here: { name, text }
  onImportScript: (listener) => ipcRenderer.on("import-script", (event, script) => listener(script)),
  // The Photoshop plugin's storage files on this computer, read only, or null
  findPhotoshopSettings: () => ipcRenderer.invoke("photoshop-settings"),
  // Installs the Font FindeR's fonts for this user, as the Photoshop plugin does: font files
  // only, written in the user's own font folder
  installFonts: (fonts) => ipcRenderer.invoke("install-fonts", fonts),
  // The Photoshops installed, and opening pages in one. Photoshop needs a file's path, which a
  // handle doesn't give: the page asks about the handle's permission between whereStart and
  // whereEnd, and the app answers with the path it was asked about. Only those paths open.
  photoshop: {
    list: () => ipcRenderer.invoke("photoshop-list"),
    // With a script, TypeR in Photoshop takes it into a tab as the pages open. A page Photoshop
    // already has open opens again as it is now; one with changes not saved there comes back as
    // { ok: false, unsaved: [names] }, and opens over them only with replace.
    open: (id, paths, script, replace) => ipcRenderer.invoke("photoshop-open", id, paths, script || null, replace === true),
    sendsScript: true,
    whereStart: (name, directory) => ipcRenderer.invoke("where-start", name, directory),
    whereEnd: (token) => ipcRenderer.invoke("where-end", token),
  },
  // Recorded operations live in a human-readable JSON file in the app's own Actions folder.
  actions: {
    load: () => ipcRenderer.invoke("actions-load"),
    save: (sets) => ipcRenderer.invoke("actions-save", sets),
    show: () => ipcRenderer.invoke("actions-show"),
  },
  // Manual updates from the fixed GitHub Releases provider. No URL is accepted from the page.
  updates: {
    releasesUrl,
    check: () => ipcRenderer.invoke("updates-check"),
    download: () => ipcRenderer.invoke("updates-download"),
    install: () => ipcRenderer.invoke("updates-install"),
    onState: (listener) => {
      const receive = (_event, state) => listener(state);
      ipcRenderer.on("updates-state", receive);
      return () => ipcRenderer.removeListener("updates-state", receive);
    },
  },
  // What Discord friends see while SG Typer Studio is open (Settings > Discord activity): the
  // page says which page it is on, or null for nothing
  discord: {
    available: () => ipcRenderer.invoke("discord-available"),
    set: (activity) => ipcRenderer.send("discord-activity", activity),
  },
  // Firefly's account lives in a separate session owned by the main process.
  firefly: {
    status: () => ipcRenderer.invoke("firefly-status"),
    credits: () => ipcRenderer.invoke("firefly-credits"),
    connect: () => ipcRenderer.invoke("firefly-connect"),
    disconnect: () => ipcRenderer.invoke("firefly-disconnect"),
    generate: (id, request) => ipcRenderer.invoke("firefly-generate", id, request),
    cancel: (id) => ipcRenderer.send("firefly-cancel", id),
    onState: (listener) => {
      const receive = (_event, state) => listener(state);
      ipcRenderer.on("firefly-state", receive);
      return () => ipcRenderer.removeListener("firefly-state", receive);
    },
  },
  // Generative Fill with FLUX on this computer: nothing is downloaded until a model is installed
  localAI: {
    status: () => ipcRenderer.invoke("local-ai-status"),
    install: (id, model) => ipcRenderer.invoke("local-ai-install", id, model),
    remove: (model) => ipcRenderer.invoke("local-ai-remove", model),
    generate: (id, request) => ipcRenderer.invoke("local-ai-generate", id, request),
    cancel: (id) => ipcRenderer.send("local-ai-cancel", id),
    onProgress: (listener) => ipcRenderer.on("local-ai-progress", (event, progress) => listener(progress)),
  },
});
