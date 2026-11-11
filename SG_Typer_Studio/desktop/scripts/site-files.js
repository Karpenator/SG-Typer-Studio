// The renderer and assets embedded in the Windows app. Asking git leaves out what is ignored
// on purpose: the commercial lettering fonts stay out of the app.

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const WANTED = ["web", "assets/brand", "assets/fonts", "i18n.js", "images/icon.png"];
const listFiles = () => {
  const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", ...WANTED], { cwd: REPO, encoding: "utf8" });
  return out
    .split("\0")
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(REPO, file)) && fs.statSync(path.join(REPO, file)).isFile())
    .sort();
};

const hashOf = (data) => ({ sha256: crypto.createHash("sha256").update(data).digest("hex"), size: data.length });

// Without a commit, the files as they are on the disk
const describe = () => {
  const files = {};
  for (const file of listFiles()) files[file] = hashOf(fs.readFileSync(path.join(REPO, file)));
  const id = crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 16);
  return { id, files };
};

module.exports = { REPO, listFiles, describe };
