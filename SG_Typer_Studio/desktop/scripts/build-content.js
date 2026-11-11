// Embeds the renderer in content/: the Windows app opens only these local files.

const fs = require("fs");
const path = require("path");
const { REPO, describe } = require("./site-files");

const target = path.resolve(__dirname, "..", "content");
fs.rmSync(target, { recursive: true, force: true });

const { id, files } = describe();
for (const file of Object.keys(files)) {
  const to = path.join(target, file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(REPO, file), to);
}
fs.writeFileSync(path.join(target, "content.json"), JSON.stringify({ id, builtAt: Date.now(), files }));

const bytes = Object.values(files).reduce((total, file) => total + file.size, 0);
console.log(`Content ${id}: ${Object.keys(files).length} files, ${(bytes / 1048576).toFixed(1)} MB.`);
