const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { solveMembrane, seamlessClone } = require(path.join(__dirname, "..", "..", "web", "healing.js"));

test("Healing Brush membrane reproduces a harmonic boundary", () => {
  const width = 64;
  const height = 48;
  const mask = new Uint8Array(width * height);
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      mask[at] = Math.hypot(x - 32, y - 24) < 17 ? 1 : 0;
      values[at] = mask[at] ? 0 : 0.2 + 0.005 * x + 0.003 * y;
    }
  }
  assert.equal(solveMembrane(width, height, mask, values), true);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) assert.ok(Math.abs(values[y * width + x] - (0.2 + 0.005 * x + 0.003 * y)) < 0.003);
    }
  }
});

test("Healing Brush takes destination colour and keeps source texture", () => {
  const width = 96;
  const height = 64;
  const source = new Uint8ClampedArray(width * height * 4);
  const destination = new Uint8ClampedArray(width * height * 4);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const pixel = at * 4;
      const value = x % 8 < 4 ? 70 : 190;
      source[pixel] = source[pixel + 1] = source[pixel + 2] = value;
      source[pixel + 3] = 255;
      destination[pixel] = 40;
      destination[pixel + 1] = 170;
      destination[pixel + 2] = 210;
      destination[pixel + 3] = 255;
      mask[at] = x > 24 && x < 72 && y > 16 && y < 48 ? 1 : 0;
    }
  }
  const output = seamlessClone(width, height, source, destination, mask);
  const mean = [0, 0, 0];
  let light = 0;
  let dark = 0;
  let count = 0;
  // Whole stripe periods: an incomplete period would bias the source's own mean.
  for (let y = 26; y < 38; y++) {
    for (let x = 36; x < 60; x++) {
      const pixel = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) mean[channel] += output[pixel + channel];
      if (x % 8 === 2) light += output[pixel + 1];
      if (x % 8 === 6) dark += output[pixel + 1];
      count++;
    }
  }
  const average = mean.map((value) => value / count);
  assert.ok(Math.abs(average[0] - 40) < 20, average.join(","));
  assert.ok(Math.abs(average[1] - 170) < 20, average.join(","));
  assert.ok(Math.abs(average[2] - 210) < 20, average.join(","));
  assert.ok(Math.abs(light - dark) / 6 > 50, "source stripe contrast survives");
  for (const [x, y] of [[0, 0], [23, 32], [73, 32], [95, 63]]) {
    const pixel = (y * width + x) * 4;
    assert.deepEqual(Array.from(output.slice(pixel, pixel + 4)), [40, 170, 210, 255]);
  }
});

test("Healing Brush leaves an empty mask byte for byte unchanged", () => {
  const width = 32;
  const height = 24;
  const source = new Uint8ClampedArray(width * height * 4).fill(120);
  const destination = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < width * height; at++) {
    destination[at * 4] = 20;
    destination[at * 4 + 1] = 40;
    destination[at * 4 + 2] = 60;
    destination[at * 4 + 3] = at % 256;
  }
  assert.deepEqual(seamlessClone(width, height, source, destination, new Uint8Array(width * height)), destination);
});

test("Healing Brush is loaded before the raster engine and has its own UI identity", () => {
  const root = path.join(__dirname, "..", "..");
  const html = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
  assert.ok(html.indexOf('src="healing.js"') < html.indexOf('src="photoshop.js"'));
  const app = fs.readFileSync(path.join(root, "web", "app.js"), "utf8");
  assert.ok(app.includes('["healing", "Healing Brush", "Shift+S"]'));
  const css = fs.readFileSync(path.join(root, "web", "app.css"), "utf8");
  // The brushes show a crosshair and hide it only while their ring is drawn (is-ring): hiding it by
  // the tool alone left a page with no cursor on it when the ring did not come
  assert.match(css, /\.stage\[data-tool="brush"\][\s\S]{0,220}data-tool="healing"[\s\S]{0,80}data-tool="smudge"\] \{ cursor: crosshair; \}/, "the brushes and the Smudge tool show a pointer of their own");
  assert.ok(css.includes(".stage.is-ring { cursor: none; }"), "and the ring, when drawn, takes it away");
  assert.ok(css.includes(".stage__over { position: absolute; z-index: 5;") && css.includes(".stamp-preview { position: absolute; z-index: 4;"), "the source texture cannot cover the brush outline");
  const russian = fs.readFileSync(path.join(root, "web", "strings", "ru.js"), "utf8");
  assert.ok(russian.includes('"Healing Brush": "Восстанавливающая кисть"'));
  const engine = fs.readFileSync(path.join(root, "web", "photoshop.js"), "utf8");
  assert.ok(engine.includes('new Worker("healing-worker.js")'), "full-stroke solving runs off the UI thread");
  assert.ok(engine.includes("paintStroke(c, coverageOp, index ? [op.points[index - 1], point] : [point])"), "coverage replays the complete original polyline on HTMLCanvas");
  assert.ok(engine.includes("healingStroke(entry, live);"), "the synchronous fallback also blends the complete stroke");
  assert.ok(engine.includes("if (layer) applyHealingData(rasterEntry(layer, doc), live, data);"), "continuous movement displays completed exact frames instead of starving the live preview");
  assert.ok(engine.includes('!live.worker || typeof createImageBitmap === "undefined"'), "missing bitmap transfer support retains the synchronous fallback");
  assert.ok(engine.includes("op.healingSource = newCanvas(doc.width, doc.height);"), "source samples retain the original document coordinates for offset layers");
  assert.ok(engine.includes("ctx.drawImage(op.healingResult, op.healingBox.left, op.healingBox.top);"), "History replays the compact result without solving again");
  assert.ok(!/op.t === "stroke" && op.healingResult[\s\S]{0,400}globalCompositeOperation = "copy"/.test(engine), "a healing patch is drawn over the layer, never copy: undo must not empty the rest of it");
  assert.ok(engine.includes("if (touched) {"), "a healing patch carries only the pixels its stroke changed");
  const worker = fs.readFileSync(path.join(root, "web", "healing-worker.js"), "utf8");
  assert.ok(worker.includes("seamlessClone(width, height, source, destination, mask, 4)"), "the worker uses the original RGBA full-stroke solver");
  assert.ok(worker.includes("new OffscreenCanvas"), "GPU pixel readback is isolated in the worker");
  assert.ok(engine.includes("createImageBitmap(frame.source"), "the UI thread transfers bitmaps instead of reading pixels synchronously");
  assert.ok(engine.includes("const prewarmHealing = () => getHealingWorker();"), "one worker is prewarmed and shared by later strokes");
});

test("Undo after two healing strokes apart restores the page, not a square of it", () => {
  const engine = fs.readFileSync(path.join(__dirname, "..", "..", "web", "photoshop.js"), "utf8");
  // The second stroke's patch is replayed over the first one's result. Drawn with "copy" it
  // would erase everything outside its box, leaving the first patch's square blank.
  const record = engine.slice(engine.indexOf("if (live.op.healing) {"), engine.indexOf("} else if (live.op.source) cropCloneSource(live.op);"));
  assert.ok(record.includes("if (touched) {"), "the patch is kept only when the stroke changed something");
  assert.ok(record.includes("patch.data[i] = 0;"), "pixels the stroke didn't reach stay transparent in the patch");
  assert.ok(record.includes("live.base"), "the stroke is compared with the layer as it was before it");
  assert.ok(engine.includes('ctx.globalCompositeOperation = op.atop ? "source-atop" : "source-over";'), "replaying heals paints over the layer, never copies onto it");
});
