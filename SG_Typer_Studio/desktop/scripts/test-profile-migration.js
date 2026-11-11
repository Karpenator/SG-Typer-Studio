const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { migrateLegacyProfile } = require("../src/profile-migration");

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sg-profile-migration-"));
  const legacy = path.join(root, "TypeR Studio");
  const target = path.join(root, "SG Typer Studio");
  fs.mkdirSync(path.join(legacy, "IndexedDB", "typer-app"), { recursive: true });
  fs.mkdirSync(path.join(legacy, "Local Storage", "leveldb"), { recursive: true });
  fs.mkdirSync(path.join(legacy, "content", "web"), { recursive: true });
  fs.mkdirSync(path.join(legacy, "Cache"), { recursive: true });
  fs.mkdirSync(path.join(legacy, "typer-studio-updater"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "window.json"), JSON.stringify({ width: 1200, height: 800 }));
  fs.writeFileSync(path.join(legacy, "IndexedDB", "typer-app", "document.idb"), "open document");
  fs.writeFileSync(path.join(legacy, "Local Storage", "leveldb", "settings.log"), "settings");
  fs.writeFileSync(path.join(legacy, "content", "web", "remote.js"), "retired");
  fs.writeFileSync(path.join(legacy, "Cache", "cached"), "retired");
  fs.writeFileSync(path.join(legacy, "typer-studio-updater", "update.exe"), "retired");
  return { root, legacy, target };
};

test("profile migration preserves user data and excludes retired downloads and caches", (t) => {
  const { root, legacy, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(migrateLegacyProfile(target, legacy), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, "window.json"), "utf8")).width, 1200);
  assert.equal(fs.readFileSync(path.join(target, "IndexedDB", "typer-app", "document.idb"), "utf8"), "open document");
  assert.equal(fs.readFileSync(path.join(target, "Local Storage", "leveldb", "settings.log"), "utf8"), "settings");
  assert.equal(fs.existsSync(path.join(target, "content")), false);
  assert.equal(fs.existsSync(path.join(target, "Cache")), false);
  assert.equal(fs.existsSync(path.join(target, "typer-studio-updater")), false);
  assert.equal(fs.existsSync(path.join(target + ".migrating")), false);
});

test("migration leaves the legacy profile untouched as a rollback", (t) => {
  const { root, legacy, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  migrateLegacyProfile(target, legacy);
  assert.equal(fs.readFileSync(path.join(legacy, "IndexedDB", "typer-app", "document.idb"), "utf8"), "open document");
  assert.equal(fs.existsSync(path.join(legacy, "content", "web", "remote.js")), true);
});

test("an existing new profile is never overwritten or merged", (t) => {
  const { root, legacy, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "window.json"), "new profile");
  assert.equal(migrateLegacyProfile(target, legacy), false);
  assert.equal(fs.readFileSync(path.join(target, "window.json"), "utf8"), "new profile");
  assert.equal(fs.existsSync(path.join(target, "IndexedDB")), false);
});

test("a missing legacy profile is a no-op", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sg-profile-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "new");
  assert.equal(migrateLegacyProfile(target, path.join(root, "missing")), false);
  assert.equal(fs.existsSync(target), false);
});

test("a failed migration cleans its temporary copy and reports the error", (t) => {
  const { root, legacy } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // A file where the destination's parent directory belongs fails on every OS.
  const blocker = path.join(root, "blocked");
  const target = path.join(blocker, "SG Typer Studio");
  fs.writeFileSync(blocker, "occupied");
  const errors = [];
  assert.equal(migrateLegacyProfile(target, legacy, (error) => errors.push(error)), false);
  assert.equal(fs.readFileSync(blocker, "utf8"), "occupied");
  assert.equal(fs.existsSync(target + ".migrating"), false);
  assert.equal(errors.length, 1);
});
