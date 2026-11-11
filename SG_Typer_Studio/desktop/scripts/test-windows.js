// What only shows on a real Windows PC, on the installed app: the title bar, real keystrokes and
// file pickers, and what it costs in memory and frames next to Chrome.
// Usage: node test-windows.js "C:\path\to\SG Typer Studio.exe"

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { _electron, chromium } = require("playwright-core");

const exe = process.argv[2];
// Not under AppData: Windows' temporary folder is one of the places the system protects
const WORK = fs.mkdtempSync(path.join(os.homedir(), "typer-studio-win-"));
const report = { steps: [], numbers: {} };
const step = (name, ok, detail) => {
  report.steps.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const powershell = (command) => execFileSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8" }).trim();
// Every keystroke goes to this app only, a file picker being one of its processes: it refuses if
// something else is in front
const press = async (pid, keys) => {
  const out = powershell(`Add-Type -AssemblyName System.Windows.Forms; Add-Type -Name Front -Namespace Native -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr w, out uint p);'; $w = New-Object -ComObject WScript.Shell; [void]$w.AppActivate(${pid}); Start-Sleep -Milliseconds 150; $p = 0; [void][Native.Front]::GetWindowThreadProcessId([Native.Front]::GetForegroundWindow(), [ref]$p); if ((Get-Process -Id $p).ProcessName -eq 'SG Typer Studio') { [System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}'); 'sent' } else { 'refused' }`);
  if (out !== "sent") throw new Error(`Couldn't bring the app in front for ${keys}`);
  await wait(400);
};

// The same drawing work in the app and in Chrome: a chapter's worth of pixels, then a tall page
// drawn again at each frame
const FRAMES = `(async () => {
  const W = 2500, H = 3500;
  const noise = new Uint32Array(W * H);
  let s = 2463534242;
  for (let k = 0; k < noise.length; k++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; noise[k] = (s | 0xff000000) >>> 0; }
  const pages = [];
  const t0 = performance.now();
  for (let i = 0; i < 40; i++) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    const img = x.createImageData(W, H);
    const out = new Uint32Array(img.data.buffer);
    const mask = (Math.imul(i + 1, 2654435761) & 0x00ffffff) >>> 0;
    for (let k = 0; k < out.length; k++) out[k] = (noise[k] ^ mask) >>> 0;
    x.putImageData(img, 0, 0);
    pages.push(c);
  }
  const buildMs = Math.round(performance.now() - t0);
  window.typerKeep = pages;
  const tall = document.createElement("canvas");
  tall.width = 3000; tall.height = 10000;
  const tx = tall.getContext("2d");
  tx.fillStyle = "#fff"; tx.fillRect(0, 0, 3000, 10000);
  const view = document.createElement("canvas");
  view.width = 1400; view.height = 860;
  view.style.cssText = "position:fixed;left:0;top:0;z-index:99999";
  document.body.appendChild(view);
  const vx = view.getContext("2d");
  const times = [];
  await new Promise((done) => {
    let last = performance.now(), n = 0;
    const step = (now) => {
      times.push(now - last); last = now;
      tx.fillStyle = "#000"; tx.font = "60px sans-serif"; tx.fillText("TypeR " + n, 100 + n * 8, 400 + n * 40);
      vx.drawImage(tall, 0, n * 20, 3000, 1843, 0, 0, 1400, 860);
      if (++n < 150) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  view.remove();
  times.shift();
  times.sort((a, b) => a - b);
  return { buildMs, frameP50: +times[Math.floor(times.length * 0.5)].toFixed(1), frameP95: +times[Math.floor(times.length * 0.95)].toFixed(1) };
})()`;

// Private memory of a whole process tree, the figure Task Manager shows
const privateMb = (pids) => {
  const out = powershell(`(Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | Measure-Object -Property PrivateMemorySize64 -Sum).Sum`);
  return Math.round(Number(out) / 1048576);
};
const appMemory = async (app) => {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map((item) => ({ pid: item.pid, type: item.type })));
  return privateMb(metrics.map((item) => item.pid));
};

const launch = async (profile, args = []) => {
  const started = Date.now();
  const env = { ...process.env, TYPER_TEST: "1", TYPER_TEST_API: "1", TYPER_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: exe, args, env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.TypeRApp && window.TypeRApp.booted, null, { timeout: 45000 });
  return { app, page, bootMs: Date.now() - started };
};

const main = async () => {
  const profile = path.join(WORK, "profile");
  // A cold launch for the first figure: nothing about it is in the system's memory beforehand
  let run = await launch(profile);
  report.numbers.firstBootMs = run.bootMs;
  const { page } = run;
  const facts = await page.evaluate(async () => ({
    pickers: [typeof showOpenFilePicker, typeof showSaveFilePicker, typeof showDirectoryPicker, typeof queryLocalFonts],
    node: [typeof window.require, typeof window.process, typeof window.cep_node],
    shell: window.TypeRShell.kind,
    menus: getComputedStyle(document.getElementById("menus")).display,
    menuCount: document.querySelectorAll("#menus .menu").length,
    overlay: navigator.windowControlsOverlay ? navigator.windowControlsOverlay.visible : null,
    overlayRect: navigator.windowControlsOverlay ? (() => { const r = navigator.windowControlsOverlay.getTitlebarAreaRect(); return [r.x, r.y, r.width, r.height]; })() : null,
    endRight: Math.round(document.querySelector(".mbar__end").getBoundingClientRect().right),
    innerWidth,
    barHeight: document.querySelector(".mbar").getBoundingClientRect().height,
    fonts: (await window.queryLocalFonts()).length,
    startTitle: document.querySelector(".start h1").textContent,
  }));
  step("the welcome screen has the app's name", facts.startTitle === "SG Typer Studio", facts.startTitle);
  step("browser file and font tools are all there", facts.pickers.every((kind) => kind === "function"), facts.pickers.join());
  step("no Node in the page", facts.node.every((kind) => kind === "undefined"));
  step("the desktop interface is on", facts.shell === "desktop", facts.shell);
  step("the page's menus are in the bar", facts.menus !== "none" && facts.menuCount >= 8, `${facts.menuCount}`);
  step("the system's window buttons don't cover the bar's content", facts.overlay === true && facts.endRight <= facts.overlayRect[0] + facts.overlayRect[2], JSON.stringify(facts));
  step("installed fonts are listed", facts.fonts > 0, `${facts.fonts}`);
  const appMenu = await run.app.evaluate(({ Menu }) => Boolean(Menu.getApplicationMenu()));
  step("no Electron menu on top of the page's", !appMenu);

  /* ----------------------------- real files, real keystrokes --------------------------- */
  const pid = await run.app.evaluate(() => process.pid);
  const chapter = path.join(WORK, "chapter");
  fs.mkdirSync(chapter);
  const png = path.join(chapter, "page 1.png");
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 1200;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 800, 1200);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  fs.writeFileSync(png, Buffer.from(data, "base64"));

  const doc = () => page.evaluate(() => {
    const { app } = window.TypeRPhotoshop;
    return app.doc ? { docs: app.docs.length, name: app.doc.name, layers: app.doc.state.layers.length, handle: app.doc.handle && app.doc.handle.constructor.name } : null;
  });

  // Ctrl+O and the real picker
  await press(pid, "^o");
  await wait(1200);
  await press(pid, png.replace(/[+^%~(){}[\]]/g, "{$&}") + "{ENTER}");
  await page.waitForFunction(() => window.TypeRPhotoshop.app.docs.length === 1, null, { timeout: 10000 }).catch(() => {});
  let now = await doc();
  step("Ctrl+O: the native picker opens a file with a lasting handle", Boolean(now) && now.handle === "FileSystemFileHandle", JSON.stringify(now));
  if (!now) throw new Error("No document: the rest can't run");

  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const layers = now.layers;
  await press(pid, "^+n");
  await wait(300);
  step("Ctrl+Shift+N adds a layer", (await doc()).layers === layers + 1);
  await press(pid, "^z");
  await wait(300);
  step("Ctrl+Z undoes it", (await doc()).layers === layers);
  await page.evaluate(() => {
    const item = window.TypeRApp.MENUS.flatMap(([, items]) => items).find((one) => one && one.label === "Free Transform");
    item.enabled = () => true;
    item.action = () => { window.typerTransformAsked = true; };
  });
  await press(pid, "^t");
  step("Ctrl+T reaches the page", await page.evaluate(() => window.typerTransformAsked === true));

  // Ctrl+Shift+S and the real picker
  const target = path.join(chapter, "saved.psd");
  await press(pid, "^+s");
  await wait(1200);
  await press(pid, target.replace(/[+^%~(){}[\]]/g, "{$&}") + "{ENTER}");
  for (let i = 0; i < 40 && !fs.existsSync(target); i++) await wait(250);
  step("Ctrl+Shift+S: the native picker saves a PSD where it was asked", fs.existsSync(target));
  await page.waitForFunction(() => /\.psd$/.test(window.TypeRPhotoshop.app.doc.name), null, { timeout: 8000 }).catch(() => {});
  const mtime = fs.existsSync(target) ? fs.statSync(target).mtimeMs : 0;
  await wait(1200);
  await page.evaluate(() => window.TypeRPhotoshop.ops.newLayer("Second"));
  await press(pid, "^s");
  for (let i = 0; i < 24 && fs.existsSync(target) && fs.statSync(target).mtimeMs === mtime; i++) await wait(250);
  step("Ctrl+S writes over it, with no question", fs.existsSync(target) && fs.statSync(target).mtimeMs > mtime);

  // From the system: a file given to the app that's already open, as "Open with" does
  const psd2 = path.join(chapter, "page 2.psd");
  fs.copyFileSync(target, psd2);
  const docsBefore = (await doc()).docs;
  spawnSync(exe, [psd2], { env: { ...process.env, TYPER_TEST: "1", TYPER_USER_DATA: profile }, timeout: 20000 });
  await page.waitForFunction((wanted) => window.TypeRPhotoshop.app.docs.length === wanted, docsBefore + 1, { timeout: 15000 }).catch(() => {});
  now = await doc();
  step("Open With hands the file to the open window, with a lasting handle", now.docs === docsBefore + 1 && now.handle === "FileSystemFileHandle", JSON.stringify(now));

  // A real text field
  await run.app.evaluate(({ clipboard }) => clipboard.writeText("Pasted text"));
  await page.evaluate(() => {
    const field = document.createElement("input");
    field.id = "test-field";
    field.style.cssText = "position:fixed;left:200px;top:200px;z-index:99999";
    document.body.appendChild(field);
    field.focus();
  });
  const field = () => page.evaluate(() => document.getElementById("test-field").value);
  await press(pid, "^v");
  step("Ctrl+V pastes in a text field", (await field()) === "Pasted text", await field());
  await press(pid, "^a");
  await press(pid, "^x");
  step("Ctrl+A and Ctrl+X work in a text field", (await field()) === "", await field());
  await press(pid, "^z");
  step("Ctrl+Z brings the text back", (await field()) === "Pasted text", await field());
  await page.evaluate(() => document.getElementById("test-field").remove());
  await wait(1500);
  await page.evaluate(() => window.TypeRSession.flush());
  await wait(600);
  await run.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await wait(1500);

  /* --------------------------------- coming back later -------------------------------- */
  run = await launch(profile);
  report.numbers.secondBootMs = run.bootMs;
  const back = await run.page.evaluate(async () => ({ docs: window.TypeRPhotoshop.app.docs.length, recent: (await window.TypeRRecent.list()).map((row) => row.name) }));
  step("the session and the recent files come back", back.docs >= 2 && back.recent.includes("saved.psd"), JSON.stringify(back));
  await run.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await wait(1500);

  /* ---------------------------------- what it costs ----------------------------------- */
  run = await launch(path.join(WORK, "profile-measure"));
  await wait(8000);
  report.numbers.idlePrivateMb = await appMemory(run.app);
  report.numbers.app = await run.page.evaluate(FRAMES);
  await wait(3000);
  report.numbers.with40PagesPrivateMb = await appMemory(run.app);
  await run.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await wait(1500);

  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const tab = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await tab.goto("about:blank");
  await wait(4000);
  report.numbers.chrome = await tab.evaluate(FRAMES);
  await browser.close();

  const failed = report.steps.filter((item) => !item.ok);
  console.log(`\n${report.steps.length - failed.length}/${report.steps.length} passed`);
  console.log(`NUMBERS ${JSON.stringify(report.numbers)}`);
  await wait(800);
  fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
  process.exit(failed.length ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  console.log(`NUMBERS ${JSON.stringify(report.numbers)}`);
  process.exit(2);
});
