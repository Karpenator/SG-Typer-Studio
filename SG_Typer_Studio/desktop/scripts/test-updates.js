const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { createUpdateManager } = require("../src/update-manager");
const { configureGitHub, repositoryFrom } = require("./configure-github");

const ROOT = path.join(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const fixture = (available = true) => {
  const updater = new EventEmitter();
  updater.checks = 0;
  updater.downloads = 0;
  updater.installs = [];
  updater.checkForUpdates = async () => {
    updater.checks++;
    return {
      isUpdateAvailable: available,
      updateInfo: {
        version: available ? "0.2.0" : "0.1.2",
        releaseDate: "2026-11-10T12:00:00Z",
        releaseNotes: [{ note: "New brushes" }, { note: "Faster healing" }],
      },
    };
  };
  updater.downloadUpdate = async () => {
    updater.downloads++;
    updater.emit("download-progress", { percent: 50, transferred: 5, total: 10 });
    return ["update.exe"];
  };
  updater.quitAndInstall = (...args) => updater.installs.push(args);
  return updater;
};

test("manual check reports GitHub release notes without downloading automatically", async () => {
  const updater = fixture();
  const manager = createUpdateManager({ updater, currentVersion: "0.1.2", packaged: true });
  const result = await manager.check();
  assert.equal(result.status, "available");
  assert.equal(result.version, "0.2.0");
  assert.equal(result.notes, "New brushes\n\nFaster healing");
  assert.equal(updater.checks, 1);
  assert.equal(updater.downloads, 0);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
});

test("latest version and source runs do not start a download", async () => {
  const latest = createUpdateManager({ updater: fixture(false), currentVersion: "0.1.2", packaged: true });
  assert.equal((await latest.check()).status, "none");
  const developmentUpdater = fixture();
  const development = createUpdateManager({ updater: developmentUpdater, currentVersion: "0.1.2", packaged: false });
  assert.equal((await development.check()).status, "development");
  assert.equal((await development.download()).status, "development");
  assert.equal(development.install(), false);
  assert.equal(developmentUpdater.checks, 0);
  assert.equal(developmentUpdater.downloads, 0);
});

test("download reports progress and a confirmed install restarts into the new version", async () => {
  const updater = fixture();
  const states = [];
  const manager = createUpdateManager({ updater, currentVersion: "0.1.2", packaged: true, notify: (state) => states.push(state) });
  await manager.check();
  const result = await manager.download();
  assert.equal(result.status, "downloaded");
  assert.equal(updater.downloads, 1);
  assert.ok(states.some((state) => state.status === "downloading" && state.percent === 50));
  assert.ok(states.some((state) => state.status === "downloaded" && state.percent === 100));
  assert.equal(manager.install(), true);
  assert.deepEqual(updater.installs, [[false, true]]);
});

test("concurrent download requests share one operation", async () => {
  const updater = fixture();
  let finish;
  updater.downloadUpdate = () => new Promise((resolve) => { finish = resolve; updater.downloads++; });
  const manager = createUpdateManager({ updater, currentVersion: "0.1.2", packaged: true });
  await manager.check();
  const first = manager.download();
  const second = manager.download();
  assert.equal(updater.downloads, 1);
  assert.equal(manager.install(), false);
  finish(["update.exe"]);
  assert.equal((await first).status, "downloaded");
});

test("network failures become bounded UI states and can be retried", async () => {
  const updater = fixture();
  updater.checkForUpdates = async () => { throw new Error("offline"); };
  const manager = createUpdateManager({ updater, currentVersion: "0.1.2", packaged: true });
  assert.deepEqual((await manager.check()).message, "offline");
  assert.equal((await manager.check()).status, "error");
  assert.equal(updater.downloads, 0);
});

test("one command moves update metadata and What's New to a clean repository", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sg-github-config-"));
  fs.mkdirSync(path.join(root, "desktop", "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "web"), { recursive: true });
  fs.writeFileSync(path.join(root, "desktop", "package.json"), JSON.stringify({ build: {} }));
  fs.writeFileSync(path.join(root, "desktop", "src", "preload.js"), 'const releasesUrl = "https://github.com/OldOwner/Old-Studio/releases";\n');
  fs.writeFileSync(path.join(root, "web", "whats-new.json"), JSON.stringify({ github: "old", notes: [] }));
  const parsed = repositoryFrom(["https://github.com/NewOwner/Clean-Studio.git"]);
  const result = configureGitHub({ ...parsed, root });
  assert.deepEqual(parsed, { owner: "NewOwner", repository: "Clean-Studio" });
  assert.equal(result.releases, "https://github.com/NewOwner/Clean-Studio/releases");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "desktop", "package.json"), "utf8"));
  assert.deepEqual(pkg.build.publish, [{ provider: "github", owner: "NewOwner", repo: "Clean-Studio", releaseType: "release" }]);
  const news = JSON.parse(fs.readFileSync(path.join(root, "web", "whats-new.json"), "utf8"));
  assert.equal(news.github, "https://api.github.com/repos/NewOwner/Clean-Studio/commits?per_page=1");
  assert.ok(fs.readFileSync(path.join(root, "desktop", "src", "preload.js"), "utf8").includes(result.releases));
  assert.doesNotThrow(() => configureGitHub({ ...parsed, root }), "reconfiguring the current provider is idempotent");
  assert.throws(() => repositoryFrom(["https://example.com/NewOwner/Clean-Studio"]));
});

test("Help, IPC, packaging and Russian strings implement only the fixed GitHub provider", () => {
  const app = read("web/app.js");
  assert.ok(app.includes('{ label: "Check for Updates…", action: checkForUpdates }'));
  assert.ok(app.includes("DesktopUpdates.check()") && app.includes("DesktopUpdates.download()") && app.includes("DesktopUpdates.install()"));
  const preload = read("desktop/src/preload.js");
  for (const channel of ["updates-check", "updates-download", "updates-install", "updates-state"]) assert.ok(preload.includes(channel));
  assert.ok(preload.includes("releasesUrl") && preload.includes("https://github.com/Karpenator/Syndicate_Typer_Studio/releases"));
  assert.ok(!preload.includes('require("../package.json")'), "sandboxed preload cannot read package.json");
  assert.ok(app.includes("DesktopUpdates.releasesUrl"));
  const main = read("desktop/src/main.js");
  assert.ok(main.includes('require("electron-updater")'));
  assert.ok(main.includes('fromEditor(event) ? updateManager().check()'));
  const pkg = JSON.parse(read("desktop/package.json"));
  assert.ok(pkg.dependencies["electron-updater"]);
  assert.equal(pkg.scripts["configure:github"], "node scripts/configure-github.js");
  assert.deepEqual(pkg.build.publish, [{ provider: "github", owner: "Karpenator", repo: "Syndicate_Typer_Studio", releaseType: "release" }]);
  const russian = read("web/strings/ru.js");
  assert.ok(russian.includes('"Check for Updates…": "Проверить обновление…"'));
  assert.ok(russian.includes('"Restart and Install": "Перезапустить и установить"'));
});
