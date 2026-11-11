// An isolated Adobe web session. Only Adobe's own IMS library reads its session; the editor
// receives connection state and generated pixels, never cookies or access tokens.
const { BrowserWindow, session } = require("electron");
const { createClient, FireflyError } = require("./firefly-client");
const { READ_GENERATION_CONTEXT } = require("./firefly-session-context");
const { fetchCredits } = require("./firefly-credits");

const HOME = "https://firefly.adobe.com/generate/image?view=edit";
const PARTITION = "persist:typer-adobe-firefly";
const AUTH_HOSTS = ["adobe.com", "adobelogin.com", "adobe.io", "google.com", "apple.com", "facebook.com", "microsoftonline.com", "live.com"];
const authUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && AUTH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
};
// This script is fixed, never constructed from editor input. Called only on firefly.adobe.com.
const READ_SESSION = `(() => {
  const ims = window.adobeIMS;
  if (!ims) return null;
  if (!ims.isSignedInUser()) return { signedOut: true };
  const access = ims && ims.getAccessToken();
  if (!ims || !ims.isSignedInUser() || !access || access.isGuestToken || !access.token) return null;
  return { token: access.token, expires: new Date(access.expire).getTime() };
})()`;

const createFirefly = ({ changed = () => {}, parent = () => null } = {}) => {
  let adobeSession = null;
  let login = null;
  let token = null;
  let expires = 0;
  let connecting = null;
  let timer = null;
  let reading = false;
  let restored = false;
  let shuttingDown = false;
  let epoch = 0;
  const popups = new Set();
  const jobs = new Map();
  const state = () => ({ connected: Boolean(token && expires > Date.now() + 15000), connecting: Boolean(connecting) });
  const announce = () => changed(state());
  const readSession = async () => {
    if (reading || !login || login.isDestroyed()) return;
    let origin;
    try { origin = new URL(login.webContents.getURL()).origin; } catch { return; }
    if (origin !== "https://firefly.adobe.com") return;
    const window = login;
    const version = epoch;
    reading = true;
    try {
      const result = await login.webContents.executeJavaScript(READ_SESSION);
      if (window !== login || version !== epoch || shuttingDown) return;
      if (result?.signedOut && token) {
        token = null;
        expires = 0;
        announce();
      }
      if (typeof result?.token === "string" && Number.isFinite(result.expires) && result.expires > Date.now() + 15000) {
        const wasConnected = state().connected;
        token = result.token;
        expires = result.expires;
        if (connecting) {
          const resolve = connecting.resolve;
          clearTimeout(connecting.timeout);
          connecting = null;
          login.hide();
          resolve({ ok: true, ...state() });
          announce();
        } else if (!wasConnected) announce();
      }
    } catch { /* The page may be navigating through sign-in. */ }
    finally { reading = false; }
  };
  const secure = (page) => {
    page.on("will-navigate", (event, url) => { if (!authUrl(url)) event.preventDefault(); });
    page.on("will-redirect", (event, url) => { if (!authUrl(url)) event.preventDefault(); });
    page.setWindowOpenHandler(({ url }) => ({ action: authUrl(url) ? "allow" : "deny", overrideBrowserWindowOptions: {
      width: 580, height: 760, autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    } }));
    page.on("did-create-window", (child) => {
      popups.add(child);
      child.on("closed", () => { popups.delete(child); void readSession(); });
      secure(child.webContents);
    });
  };
  const open = () => {
    if (login && !login.isDestroyed()) return login;
    adobeSession ||= session.fromPartition(PARTITION);
    adobeSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    adobeSession.setPermissionCheckHandler(() => false);
    if (!adobeSession.listenerCount("will-download")) adobeSession.on("will-download", (event) => event.preventDefault());
    login = new BrowserWindow({
      width: 1000, height: 760, show: false, title: "Adobe Firefly", autoHideMenuBar: true,
      parent: parent() || undefined,
      webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    secure(login.webContents);
    login.webContents.on("did-finish-load", readSession);
    login.on("close", (event) => {
      if (shuttingDown) return;
      event.preventDefault();
      login.hide();
      if (connecting) {
        const resolve = connecting.resolve;
        clearTimeout(connecting.timeout);
        connecting = null;
        resolve({ ok: false, kind: "cancelled", ...state() });
        announce();
      }
    });
    timer = setInterval(() => {
      if (token && expires <= Date.now() + 60000 && !connecting && !login.webContents.isLoading()) {
        token = null;
        expires = 0;
        announce();
        login.webContents.reload();
      }
      void readSession();
    }, 3000);
    timer.unref();
    login.loadURL(HOME).catch(() => {});
    return login;
  };
  const credentials = async () => {
    await readSession();
    if (!state().connected) throw new FireflyError("adobeauth", "Sign in to Adobe Firefly in Generative Fill settings.");
    const window = login;
    const version = epoch;
    let context = {};
    if (window && !window.isDestroyed() && new URL(window.webContents.getURL()).origin === "https://firefly.adobe.com") {
      context = await window.webContents.executeJavaScript(READ_GENERATION_CONTEXT).catch(() => ({}));
    }
    if (version !== epoch || window !== login || shuttingDown || !state().connected) throw new FireflyError("adobeauth", "Sign in to Adobe Firefly in Generative Fill settings.");
    return { token, arpToken: context?.arpToken, userId: context?.userId };
  };
  const client = createClient({ credentials, fetch: (...args) => adobeSession.fetch(...args) });
  const disposeWindow = () => {
    clearInterval(timer);
    timer = null;
    for (const popup of popups) if (!popup.isDestroyed()) popup.destroy();
    popups.clear();
    if (login && !login.isDestroyed()) login.destroy();
    login = null;
  };
  const api = {
    async credits() {
      await readSession();
      if (!state().connected) return { status: "signedout" };
      const version = epoch;
      const accountToken = token;
      try {
        const balance = await fetchCredits((...args) => adobeSession.fetch(...args), accountToken, AbortSignal.timeout(15000));
        if (version !== epoch || token !== accountToken || !state().connected || shuttingDown) return { status: "signedout" };
        return { status: "ready", ...balance, updatedAt: Date.now() };
      } catch { return { status: "unavailable" }; }
    },
    async status() {
      // Restore an existing Adobe login without opening a visible window. A fresh install
      // doesn't load Adobe until Connect is explicitly chosen.
      if (!restored) {
        restored = true;
        const version = epoch;
        adobeSession ||= session.fromPartition(PARTITION);
        const cookies = await adobeSession.cookies.get({});
        if (version === epoch && !shuttingDown && cookies.some((cookie) => /(?:^|\.)adobelogin\.com$/.test(cookie.domain.replace(/^\./, "")))) open();
      }
      await readSession();
      return state();
    },
    connect() {
      if (connecting) { open().show(); return connecting.promise; }
      const window = open();
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      const timeout = setTimeout(() => {
        connecting = null;
        resolve({ ok: false, kind: "adobeauth", ...state() });
        announce();
      }, 5 * 60 * 1000);
      connecting = { promise, resolve, timeout };
      window.show();
      window.focus();
      announce();
      void readSession();
      return promise;
    },
    async disconnect() {
      epoch += 1;
      for (const controller of jobs.values()) controller.abort();
      if (connecting) { clearTimeout(connecting.timeout); connecting.resolve({ ok: false, kind: "cancelled" }); connecting = null; }
      disposeWindow();
      token = null;
      expires = 0;
      restored = true;
      if (adobeSession) {
        await adobeSession.clearStorageData();
        await adobeSession.clearCache();
        await adobeSession.closeAllConnections();
      }
      announce();
      return state();
    },
    async generate(id, request) {
      if (typeof id !== "string" || !/^firefly-\d+$/.test(id) || jobs.has(id) || jobs.size >= 3) return { ok: false, kind: "other", message: "Firefly is busy." };
      const controller = new AbortController();
      jobs.set(id, controller);
      try { return { ok: true, value: await client.generate(request, controller.signal) }; }
      catch (error) {
        if (controller.signal.aborted) return { ok: false, kind: "cancelled", message: "Cancelled." };
        if (error.kind === "adobeauth") {
          token = null;
          expires = 0;
          if (login && !login.isDestroyed()) login.webContents.reload();
          announce();
        }
        return { ok: false, kind: error.kind || "other", message: error instanceof FireflyError ? error.message : "Adobe Firefly could not finish the request.", rate: false };
      } finally { jobs.delete(id); }
    },
    cancel(id) { jobs.get(id)?.abort(); },
    close() {
      epoch += 1;
      shuttingDown = true;
      for (const controller of jobs.values()) controller.abort();
      if (connecting) { clearTimeout(connecting.timeout); connecting.resolve({ ok: false, kind: "cancelled" }); connecting = null; }
      disposeWindow();
      token = null;
    },
  };
  return api;
};

module.exports = { createFirefly };
