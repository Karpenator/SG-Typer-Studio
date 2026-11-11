// One-time, non-destructive migration for the SG Typer Studio product rename.

const fs = require("fs");
const path = require("path");

const SKIPPED = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "content", // remotely downloaded interface from the retired updater
  "typer-studio-updater",
]);

const migrateLegacyProfile = (target, legacy, warn = () => {}) => {
  if (!target || !legacy || target === legacy || fs.existsSync(target) || !fs.existsSync(legacy)) return false;
  const temporary = `${target}.migrating`;
  const cleanup = () => {
    try {
      fs.rmSync(temporary, { recursive: true, force: true });
    } catch (error) { /* an invalid destination has no temporary directory to clean */ }
  };
  try {
    cleanup();
    fs.cpSync(legacy, temporary, {
      recursive: true,
      filter: (source) => source === legacy || !SKIPPED.has(path.relative(legacy, source).split(path.sep)[0]),
    });
    // A complete copy appears at the destination atomically; the old profile remains a rollback.
    fs.renameSync(temporary, target);
    return true;
  } catch (error) {
    cleanup();
    warn(error);
    return false;
  }
};

module.exports = { migrateLegacyProfile, SKIPPED };
