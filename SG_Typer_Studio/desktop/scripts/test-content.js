// Offline checks for the embedded renderer and Windows package. No Electron download is needed.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const WEB = path.join(ROOT, "web");
const walk = (directory, extension) => fs.readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && (!extension || entry.name.endsWith(extension)))
  .map((entry) => path.join(entry.parentPath, entry.name));
const external = (reference) => !reference || /^(?:[a-z]+:|\/\/|data:|var\()/i.test(reference);

test("HTML and CSS local resources exist", () => {
  const missing = [];
  for (const file of walk(WEB, ".html")) {
    const html = fs.readFileSync(file, "utf8");
    for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)/gi)) {
      const reference = match[1].split(/[?#]/)[0];
      // A trailing slash is the static prefix of a document.write() locale URL.
      if (external(reference) || reference.endsWith("/")) continue;
      const target = path.resolve(path.dirname(file), decodeURIComponent(reference));
      if (!fs.existsSync(target)) missing.push(`${path.relative(ROOT, file)}: ${reference}`);
    }
  }
  for (const file of walk(WEB, ".css")) {
    const css = fs.readFileSync(file, "utf8");
    for (const match of css.matchAll(/url\(\s*["']?([^\)"']+)/g)) {
      const reference = match[1].split(/[?#]/)[0];
      if (external(reference)) continue;
      const target = path.resolve(path.dirname(file), decodeURIComponent(reference));
      if (!fs.existsSync(target)) missing.push(`${path.relative(ROOT, file)}: ${reference}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("dynamic locale modules, touch UI, WASM and SG graphics exist", () => {
  const required = ["web/touch.js", "web/touch.css", "web/vendor/indd.wasm", "desktop/build/icon.png", "images/icon.png", "assets/brand/sg-logo.png", "assets/brand/sg-typer-studio-icon.png"];
  for (const lang of ["fr", "es", "it", "de", "pt", "ru", "uk", "pl", "nl", "tr", "ar", "vi", "id", "th", "ja", "ko", "zh"]) {
    required.push(`web/strings/${lang}.js`, `web/strings/sfx/${lang}.js`, `web/strings/guide/${lang}.js`);
  }
  assert.deepEqual(required.filter((file) => !fs.existsSync(path.join(ROOT, file))), []);
  for (const file of ["desktop/build/icon.png", "images/icon.png", "assets/brand/sg-logo.png", "assets/brand/sg-typer-studio-icon.png"]) {
    const png = fs.readFileSync(path.join(ROOT, file));
    assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a", `${file} is a PNG`);
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, `${file} has dimensions`);
  }
});

test("quick Windows launcher keeps start, tests and EXE build wired", () => {
  const launcher = fs.readFileSync(path.join(ROOT, "start-sg.bat"), "utf8");
  for (const command of ["call npm start", "call npm run test:unit", "call npm test", "call npm run dist:win", "call npm install --include=dev", "call node node_modules\\electron\\install.js", 'pushd "%~dp0desktop"', "node_modules\\electron\\dist\\electron.exe"]) {
    assert.ok(launcher.includes(command), `start-sg.bat contains ${command}`);
  }
  assert.ok(!/^\s*npm\s+/im.test(launcher), "npm commands run through call");
});

test("panel manifest is an exact inventory of embedded panel files", () => {
  const panel = path.join(WEB, "panel");
  const expected = walk(panel).map((file) => path.relative(panel, file).split(path.sep).join("/"))
    .filter((file) => !["index.html", "files.json"].includes(file) && !file.startsWith("locale/") && !file.endsWith(".LICENSE.txt"))
    .sort();
  const actual = JSON.parse(fs.readFileSync(path.join(panel, "files.json"), "utf8"));
  assert.deepEqual(actual, expected);
});

test("webpack dynamic JS and CSS chunks all exist", () => {
  const panel = path.join(WEB, "panel");
  const source = fs.readFileSync(path.join(panel, "modern.index.js"), "utf8");
  const start = source.indexOf("n.u=");
  const end = source.indexOf(",n.g=function()", start);
  assert.ok(start >= 0 && end > start, "webpack runtime maps are present");
  const runtime = source.slice(start, end);
  const missing = [];
  for (const match of runtime.matchAll(/\{([^{}]+)\}\[e\]\+"\."\+\{([^{}]+)\}\[e\]\+"\.(index\.js|css)"/g)) {
    const names = Object.fromEntries(Array.from(match[1].matchAll(/(\d+):"([^"]+)"/g), (item) => [item[1], item[2]]));
    const hashes = Object.fromEntries(Array.from(match[2].matchAll(/(\d+):"([^"]+)"/g), (item) => [item[1], item[2]]));
    for (const [id, name] of Object.entries(names)) {
      const file = path.join(panel, `modern.${name}.${hashes[id]}.${match[3]}`);
      if (!hashes[id] || !fs.existsSync(file)) missing.push(path.basename(file));
    }
  }
  assert.deepEqual(missing, []);
});

test("retired hosted UI and promotional endpoints are absent", () => {
  // The official SG community is intentional; legacy promotional invites remain retired.
  const retired = /https?:\/\/(?:typer\.hayasaku\.fr\/(?!ns\/sfx)|(?:www\.)?ko-fi\.com|discord(?:\.gg|\.com\/invite)(?!\/UVF2264tYn)|swirt\.github\.io\/typertools)/i;
  const failures = [];
  for (const file of [...walk(WEB, ".js"), ...walk(path.join(ROOT, "desktop", "src"), ".js")]) {
    const source = fs.readFileSync(file, "utf8");
    if (retired.test(source)) failures.push(path.relative(ROOT, file));
    for (const marker of ["serviceWorker.register", "manifest.webmanifest", "desktop-update.json"]) {
      if (source.includes(marker)) failures.push(`${path.relative(ROOT, file)}: ${marker}`);
    }
  }
  assert.deepEqual(failures, []);
  // This URI is an XMP compatibility identifier, never a network request.
  assert.equal(fs.readFileSync(path.join(WEB, "psd.js"), "utf8").includes('const XMP_NS = "http://typer.hayasaku.fr/ns/sfx/1.0/";'), true);
});

test("desktop packaging is Windows x64 only and retains the legacy plugin scheme", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "desktop", "package.json"), "utf8"));
  assert.equal(pkg.productName, "SG Typer Studio");
  assert.deepEqual(pkg.build.win.target, ["nsis"]);
  assert.equal(pkg.build.mac, undefined);
  assert.equal(pkg.build.linux, undefined);
  assert.deepEqual(pkg.build.publish, [{ provider: "github", owner: "Karpenator", repo: "Syndicate_Typer_Studio", releaseType: "release" }]);
  assert.equal(pkg.devDependencies["electron-updater"], undefined);
  assert.ok(pkg.dependencies["electron-updater"]);
  assert.deepEqual(pkg.build.protocols[0].schemes, ["sg-typer-studio", "typer-studio"]);
  const main = fs.readFileSync(path.join(ROOT, "desktop", "src", "main.js"), "utf8");
  assert.ok(main.includes('path.join(app.getPath("appData"), "TypeR Studio")'));
  assert.ok(main.includes('from: "TypeR Studio"'));
});
