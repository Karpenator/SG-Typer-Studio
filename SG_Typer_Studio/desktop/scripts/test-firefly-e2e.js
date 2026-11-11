// Real Electron, editor and canvas pipeline, with only Adobe's generation transport replaced.
// Run after `npm run content`. The optional --login flag checks the real Adobe sign-in page.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { PARTNER_MODELS } = require("../src/firefly-models");
const { READ_GENERATION_CONTEXT } = require("../src/firefly-session-context");

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "typer-firefly-test-"));
  const env = { ...process.env, TYPER_TEST: "1", TYPER_TEST_API: "1", TYPER_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require("electron"), args: [path.resolve(__dirname, "..")], env });
  try {
    // Automated Adobe windows must not steal focus from the user's own signed-in app.
    await app.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.prototype.show = function () {};
      BrowserWindow.prototype.focus = function () {};
      app.on("browser-window-created", (_event, window) => window.hide());
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForFunction(() => document.querySelector("dialog.onboard[open]") || window.TypeRApp?.booted);
    if (await page.$("dialog.onboard[open]")) await page.click("dialog.onboard .onboard__skip");
    await page.waitForFunction(() => window.TypeRApp?.booted);
    assert.equal(await page.evaluate(() => Boolean(window.TypeRGenerative.SERVICES.adobe)), true);
    assert.deepEqual(await page.evaluate(() => window.TypeRDesktop.firefly.status()), { connected: false, connecting: false });

    // Check the real settings, including saving the provider and keeping Adobe out of key inputs.
    await page.evaluate(() => {
      const menu = window.TypeRApp.MENUS.flatMap((entry) => entry[1] || []);
      const settings = menu.find((entry) => entry?.label === "Settings…");
      if (!settings) throw Error("Settings action missing");
      settings.action();
    });
    await page.waitForSelector(".gensettings", { state: "attached" });
    const settings = await page.evaluate(() => {
      const pane = document.querySelector(".gensettings");
      const service = Array.from(pane.querySelectorAll("select")).find(s => s.querySelector('option[value="adobe"]'));
      service.value = "adobe";
      service.dispatchEvent(new Event("change"));
      const model = Array.from(pane.querySelectorAll("select")).find(s => s.querySelector('option[value="firefly-image-5"]'));
      return { passwords: pane.querySelectorAll('input[type="password"]').length, adobe: pane.textContent.includes("Adobe Firefly"), links: Array.from(pane.querySelectorAll("a")).map((a) => a.getAttribute("href")), models: Array.from(model.options).map(o => o.value), chosen: model.value, premium: pane.textContent.includes("premium") };
    });
    assert.equal(settings.passwords, 2);
    assert.equal(settings.adobe, true);
    assert.ok(settings.links.every((url) => url && url !== "undefined"));
    assert.deepEqual(settings.models, ["firefly-image-5", "firefly-fill", ...Object.keys(PARTNER_MODELS)]);
    assert.equal(settings.chosen, "firefly-image-5");
    assert.equal(settings.premium, true);
    await page.keyboard.press("Escape");
    console.log("ok settings: Adobe account controls, no Adobe API-key field");

    if (process.argv.includes("--login")) {
      const opened = app.waitForEvent("window");
      await page.evaluate(() => { window.fireflyConnection = window.TypeRDesktop.firefly.connect(); });
      const login = await opened;
      await login.waitForURL(/firefly\.adobe\.com/, { timeout: 30000 });
      await login.waitForFunction(() => Boolean(window.adobeIMS), null, { timeout: 45000 });
      const facts = await login.evaluate(() => ({ node: typeof require, signedIn: window.adobeIMS.isSignedInUser(), hasTokenAPI: typeof window.adobeIMS.getAccessToken === "function" }));
      assert.equal(facts.node, "undefined");
      assert.equal(facts.hasTokenAPI, true);
      console.log(`ok real Adobe window: IMS loaded, signedIn=${facts.signedIn}, no Node access`);
      // Read through the same fixed script as the native connector. Only boolean
      // capability facts leave this isolated test window, never session values.
      const context = await login.evaluate(`(async () => {
        const context = await ${READ_GENERATION_CONTEXT};
        return { hasArp: Boolean(context.arpToken), hasUserId: Boolean(context.userId) };
      })()`);
      console.log(`Adobe public session context: arp=${context.hasArp}, profile=${context.hasUserId}`);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().startsWith("https://firefly.adobe.com"))?.close());
      assert.equal((await page.evaluate(() => window.fireflyConnection)).kind, "cancelled");
      assert.deepEqual(await page.evaluate(() => window.TypeRDesktop.firefly.disconnect()), { connected: false, connecting: false });
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
      console.log("ok cancelled sign-in and disconnect close the Adobe window");
    }

    // Synthetic account balance through the native IPC. No real account is used.
    await app.evaluate(({ ipcMain }) => {
      global.creditHandlers = { status: ipcMain._invokeHandlers.get("firefly-status"), credits: ipcMain._invokeHandlers.get("firefly-credits") };
      global.creditValue = { status: "ready", total: 250, remaining: 188, resetAt: "2026-11-24T12:00:00.000Z" };
      ipcMain.removeHandler("firefly-status");
      ipcMain.handle("firefly-status", () => ({ connected: true, connecting: false }));
      ipcMain.removeHandler("firefly-credits");
      ipcMain.handle("firefly-credits", () => global.delayCredits ? new Promise(resolve => { global.resolveCredits = resolve; }) : { ...global.creditValue, updatedAt: Date.now() });
    });
    await page.evaluate(async () => {
      window.addEventListener("typer-firefly-credits", event => { window.creditTestState = event.detail; });
      await window.TypeRGenerative.adobeStatus();
      const menu = window.TypeRApp.MENUS.flatMap(entry => entry[1] || []);
      menu.find(entry => entry?.label === "Settings…").action();
    });
    await page.getByRole("button", { name: /^(Generative Fill|Remplissage génératif)$/ }).click();
    await page.waitForFunction(() => document.querySelector(".gensettings__credits strong")?.textContent.includes("188/250"));
    const creditFacts = await page.evaluate(() => {
      const panel = document.querySelector(".gensettings__credits");
      return { hidden: panel.hidden, remaining: panel.querySelector("progress").value, total: panel.querySelector("progress").max, text: panel.textContent };
    });
    assert.equal(creditFacts.hidden, false);
    assert.equal(creditFacts.remaining, 188);
    assert.equal(creditFacts.total, 250);
    assert.match(creditFacts.text, /November 24, 2026|24 November 2026|24 novembre 2026/);
    await app.evaluate(() => { global.creditValue.remaining = 0; });
    await page.click(".gensettings__credits button");
    await page.waitForFunction(() => document.querySelector(".gensettings__credits strong")?.textContent.includes("0/250"));
    assert.equal(await page.$eval(".gensettings__credits progress", progress => progress.value), 0);
    await app.evaluate(() => { global.creditValue = { status: "unavailable" }; });
    await page.click(".gensettings__credits button");
    await page.waitForFunction(() => /unavailable|indisponible/.test(document.querySelector(".gensettings__credits strong")?.textContent || ""));
    assert.equal(await page.$eval(".gensettings__credits progress", progress => progress.hidden), true);
    await app.evaluate(() => { global.creditValue = { status: "ready", total: 250, remaining: 188, resetAt: null }; });
    await page.click(".gensettings__credits button");
    await page.waitForFunction(() => window.creditTestState?.remaining === 188);
    await page.keyboard.press("Escape");
    console.log("ok Adobe credit display: 188/250, meter, reset date, refresh, zero and unavailable states");

    // The trusted IPC is kept. Replace its generation handler, never renderer account tokens.
    await app.evaluate(({ ipcMain, nativeImage }) => {
      ipcMain.removeHandler("firefly-generate");
      ipcMain.handle("firefly-generate", (_event, id, request) => {
        global.creditValue.remaining--;
        global.fireflyRequest = { id, model: request.model, size: request.size, prompt: request.prompt, image: Buffer.from(request.image).toString("base64"), mask: request.mask ? Buffer.from(request.mask).toString("base64") : null };
        if (request.model !== "firefly-fill") {
          const image = nativeImage.createFromBuffer(Buffer.from(request.image));
          return { ok: true, value: image.resize({ width: image.getSize().width * 2 }).toJPEG(95) };
        }
        return { ok: true, value: request.image };
      });
    });
    const result = await page.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 301; canvas.height = 197;
      const context = canvas.getContext("2d"); context.fillStyle = "#b03020"; context.fillRect(0, 0, canvas.width, canvas.height);
      const mask = document.createElement("canvas"); mask.width = 301; mask.height = 197;
      const m = mask.getContext("2d"); m.fillStyle = "white"; m.fillRect(0, 0, 301, 197); m.fillStyle = "black"; m.fillRect(20, 30, 70, 60);
      const image = await window.TypeRGenerative.generate({ settings: { service: "adobe", models: { adobe: "firefly-fill" } }, canvas, mask, prompt: "" });
      const size = [image.width, image.height]; image.close(); return size;
    });
    assert.deepEqual(result, [301, 197]);
    await page.waitForFunction(() => window.creditTestState?.remaining === 187);
    console.log("ok Adobe balance refreshes after generation");
    const request = await app.evaluate(() => global.fireflyRequest);
    assert.equal(request.prompt, "");
    const maskFacts = await page.evaluate(async ({ mask }) => {
      const blob = await (await fetch(`data:image/png;base64,${mask}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0);
      return { size: [canvas.width, canvas.height], selected: Array.from(ctx.getImageData(40, 50, 1, 1).data), outside: Array.from(ctx.getImageData(200, 100, 1, 1).data) };
    }, request);
    assert.deepEqual(maskFacts.size, [304, 208]);
    assert.deepEqual(maskFacts.selected, [255, 255, 255, 255]);
    assert.deepEqual(maskFacts.outside, [0, 0, 0, 255]);
    console.log("ok image pipeline: aligned dimensions, white selection, black exterior, original result dimensions, empty prompt");

    const image5 = await page.evaluate(async () => {
      const Gen = window.TypeRGenerative;
      const canvas = document.createElement("canvas"); canvas.width = 301; canvas.height = 197;
      canvas.getContext("2d").fillRect(0, 0, 301, 197);
      const settings = { service: "adobe", models: { adobe: "firefly-image-5" } };
      const picture = await Gen.generate({ settings, canvas, prompt: "", size: "2K" });
      const result = { size: [picture.width, picture.height], aligned: !Gen.drawsInPlace(settings), defaultPrompt: Gen.DEFAULT_PROMPT };
      picture.close();
      return result;
    });
    assert.deepEqual(image5.size, [602, 394]);
    assert.equal(image5.aligned, true);
    const image5Request = await app.evaluate(() => global.fireflyRequest);
    assert.equal(image5Request.model, "firefly-image-5");
    assert.equal(image5Request.size, "2K");
    assert.equal(image5Request.mask, null);
    assert.equal(image5Request.prompt, image5.defaultPrompt);
    const image5Input = Buffer.from(image5Request.image, "base64");
    assert.deepEqual([image5Input.readUInt32BE(16), image5Input.readUInt32BE(20)], [301, 197]);
    console.log("ok Image 5: explicit model, reference proportions, no mask upload, cleanup prompt, JPEG output with new dimensions");

    for (const [model, definition] of Object.entries(PARTNER_MODELS)) {
      const facts = await page.evaluate(async ({ model }) => {
        const Gen = window.TypeRGenerative;
        const settings = { ...Gen.load(), service: "adobe", models: { adobe: model } };
        Gen.save(settings);
        const loaded = Gen.load();
        const canvas = document.createElement("canvas"); canvas.width = 301; canvas.height = 197;
        canvas.getContext("2d").fillRect(0, 0, 301, 197);
        const mask = document.createElement("canvas"); mask.width = 301; mask.height = 197;
        const ctx = mask.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 301, 197); ctx.fillStyle = "black"; ctx.fillRect(20, 30, 70, 60);
        const picture = await Gen.generate({ settings: loaded, canvas, mask, prompt: "", size: "2K" });
        const facts = { selected: Gen.modelOf(loaded), name: Gen.modelsOf(loaded).find(([id]) => id === model)?.[1], size: [picture.width, picture.height], aligned: !Gen.drawsInPlace(loaded) };
        picture.close(); return facts;
      }, { model });
      assert.equal(facts.selected, model);
      assert.equal(facts.name, definition.name);
      assert.equal(facts.aligned, true);
      assert.deepEqual(facts.size, [602, 394]);
      const request = await app.evaluate(() => global.fireflyRequest);
      assert.equal(request.model, model);
      assert.equal(request.prompt, image5.defaultPrompt);
      if (definition.mask) {
        const alpha = await page.evaluate(async base64 => {
          const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
          const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0); image.close();
          return { size: [canvas.width, canvas.height], inside: ctx.getImageData(40, 50, 1, 1).data[3], outside: ctx.getImageData(200, 100, 1, 1).data[3] };
        }, request.mask);
        assert.deepEqual(alpha, { size: [301, 197], inside: 0, outside: 255 });
      } else assert.equal(request.mask, null);
    }
    console.log("ok eight Adobe partners: persisted model choices, labels, cleanup prompt, JPEG output, GPT alpha masks and Gemini reference-only input");

    // Actual document insertion and undo through the existing editor operation.
    for (const model of ["firefly-image-5", "gpt-image-2.6-flare", "gemini-nano-banana-2.1"]) {
      const documentFacts = await page.evaluate(async model => {
        const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext("2d"); ctx.fillStyle = "#a03020"; ctx.fillRect(0, 0, 256, 256);
        const blob = await new Promise((done) => canvas.toBlob(done));
        await window.TypeRApp.openFiles([new File([blob], "Firefly test.png", { type: "image/png" })]);
        const { app, ops, paintDoc } = window.TypeRPhotoshop;
        const doc = app.doc;
        const mask = new Uint8ClampedArray(60 * 40); mask.fill(255);
        const selection = ops.maskSelection(mask, 60, 40, 25, 35);
        const before = doc.state.layers.length;
        const at = doc.historyIndex;
        const snapshot = () => {
          const out = document.createElement("canvas"); out.width = 256; out.height = 256;
          const context = out.getContext("2d"); paintDoc(doc, context);
          return context.getImageData(0, 0, 256, 256).data;
        };
        const original = snapshot();
        const settings = { service: "adobe", models: { adobe: model } };
        await ops.generativeFill({ doc, selection, inPlace: window.TypeRGenerative.drawsInPlace(settings), matchTones: false, name: "Firefly test", draw: (canvas, info) => window.TypeRGenerative.generate({ settings, canvas, mask: info.mask, prompt: "Remove the lettering.", size: info.size }) });
        const layer = doc.state.layers.find((one) => one.name === "Firefly test");
        const patch = layer?.paint?.[0]?.source;
        const after = snapshot();
        let outsideUnchanged = true;
        for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
          if (x >= 25 && x < 85 && y >= 35 && y < 75) continue;
          const p = (y * 256 + x) * 4;
          for (let c = 0; c < 4; c++) if (original[p + c] !== after[p + c]) outsideUnchanged = false;
        }
        const facts = { added: doc.state.layers.length - before, layer: Boolean(layer), at: patch ? [patch.x, patch.y, patch.canvas.width, patch.canvas.height] : null, outsideUnchanged };
        ops.rollbackHistory(at);
        facts.undo = doc.state.layers.length === before;
        return facts;
      }, model);
      assert.equal(documentFacts.added, 1);
      assert.equal(documentFacts.layer, true);
      assert.equal(documentFacts.undo, true);
      assert.equal(documentFacts.outsideUnchanged, true);
      assert.deepEqual(documentFacts.at, [25, 35, 60, 40]);
      const finalRequest = await app.evaluate(() => global.fireflyRequest);
      assert.match(finalRequest.prompt, /^Remove the lettering\./);
      assert.match(finalRequest.prompt, /Keep the framing/);
      console.log(`ok ${model} document: alignment, selection-only patch, unchanged outside pixels, undo restores prior state`);
    }

    // A perfect model result must survive the real compositor unchanged, even
    // on white manga paper with reconstructed black lines inside the selection.
    for (const matchTones of [false, true]) {
      const unchanged = await page.evaluate(async matchTones => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 768;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, 768, 768);
        ctx.strokeStyle = "black"; ctx.lineWidth = 4; ctx.strokeRect(300, 300, 160, 140);
        ctx.fillStyle = "#808080"; ctx.fillRect(350, 340, 60, 60);
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        await window.TypeRApp.openFiles([new File([blob], "Manga tones.png", { type: "image/png" })]);
        const { app, ops, paintDoc } = window.TypeRPhotoshop;
        const doc = app.doc;
        const selection = ops.maskSelection(new Uint8ClampedArray(320 * 320).fill(255), 320, 320, 224, 224);
        const snapshot = () => {
          const image = document.createElement("canvas"); image.width = image.height = 768;
          const context = image.getContext("2d"); paintDoc(doc, context);
          return context.getImageData(0, 0, 768, 768).data;
        };
        const before = snapshot();
        await ops.generativeFill({ doc, selection, matchTones, name: "Exact source", draw: image => createImageBitmap(image) });
        const after = snapshot();
        let changed = 0;
        for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
        return { changed, white: after[(250 * 768 + 250) * 4], black: after[(300 * 768 + 300) * 4], gray: after[(360 * 768 + 360) * 4] };
      }, matchTones);
      assert.deepEqual(unchanged, { changed: 0, white: 255, black: 0, gray: 128 });
    }
    console.log("ok generated manga retains exact white, black and gray pixels, with tone matching on and off");

    await app.evaluate(() => { global.delayCredits = true; });
    await page.evaluate(() => { window.pendingCreditTest = window.TypeRGenerative.adobeCredits(true); });
    await page.waitForFunction(() => window.creditTestState?.status === "loading");
    await page.evaluate(() => window.TypeRGenerative.adobeDisconnect());
    await app.evaluate(() => global.resolveCredits({ status: "ready", remaining: 999, total: 999, updatedAt: Date.now() }));
    await page.evaluate(() => window.pendingCreditTest);
    assert.equal(await page.evaluate(() => window.creditTestState.status), "signedout");
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("firefly-status"); ipcMain.handle("firefly-status", global.creditHandlers.status);
      ipcMain.removeHandler("firefly-credits"); ipcMain.handle("firefly-credits", global.creditHandlers.credits);
    });
    console.log("ok disconnect discards an in-flight credit balance");
    assert.deepEqual(errors, []);
    console.log("ok no renderer errors");
    // A hidden Adobe window must not keep TypeR running after its workspace closes.
    await page.evaluate(() => { window.TypeRDesktop.firefly.connect(); });
    const exited = new Promise((done) => app.process().once("exit", done));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().startsWith("typer://app/"))?.destroy()).catch(() => {});
    await Promise.race([exited, new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(Error("Adobe window kept the app running")), 10000); timer.unref(); })]);
    console.log("ok closing TypeR also closes its Adobe session window");
  } finally {
    const exited = new Promise((done) => { if (app.process().exitCode !== null) done(); else app.process().once("exit", done); });
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await exited;
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
