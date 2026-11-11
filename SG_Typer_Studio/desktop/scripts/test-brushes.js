const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Brushes is a searchable, persistent Workspace library with local ABR import", () => {
  const html = read("web/index.html");
  for (const id of ["pane-brushes", "brushes-search", "brushes-preview", "brushes-list", "brushes-import", "brushes-delete", "brushes-file"]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.ok(html.includes('<script src="brushes.js"></script>'));
  assert.ok(html.includes('accept=".abr,application/octet-stream" multiple'));
  const brushes = read("web/brushes.js");
  assert.ok(brushes.includes('indexedDB.open(DB, 1)'), "sampled tips use IndexedDB rather than localStorage");
  assert.ok(brushes.includes("window.TypeRPSD.library()"), "the existing lazy ag-psd loader is reused");
  assert.ok(brushes.includes("lib.readAbr(new Uint8Array(await file.arrayBuffer()))"));
  assert.ok(brushes.includes('shape.type !== "computed" && shape.type !== "sampled"'), "unsupported dynamic tips are not advertised as working presets");
  assert.ok(brushes.includes("await transaction(\"readwrite\", (store) => store.put(preset))"));
  const workspace = read("web/workspace.js");
  assert.ok(workspace.includes('brushes: "pane-brushes"'));
  assert.ok(workspace.includes('"brushes"'));
  const app = read("web/app.js");
  assert.ok(app.includes('{ label: "Brushes", check: () => Workspace().isVisible("brushes")'));
  for (const locale of fs.readdirSync(path.join(root, "web", "strings")).filter((file) => file.endsWith(".js"))) {
    assert.ok(read(path.join("web", "strings", locale)).includes('"Brushes":'), `${locale}: missing Brushes`);
  }
});

test("Sampled and computed ABR tips share live painting, mask and History rendering", () => {
  const engine = read("web/photoshop.js");
  assert.ok(engine.includes("const shapedStrokes = new WeakMap()"));
  assert.ok(engine.includes("if (op.tip || op.stamped) shapedStroke(ctx, op, points);"));
  assert.ok(engine.includes("op.angle || 0") && engine.includes("op.roundness"));
  assert.ok(engine.includes("paintStroke,"), "the panel uses the production dab renderer for previews");
  assert.ok(engine.includes('["tip", "spacing", "angle", "roundness", "flipX", "flipY", "stamped", "presetId"]'));
  const app = read("web/app.js");
  assert.ok(app.includes('["tip", "spacing", "angle", "roundness", "flipX", "flipY", "stamped", "presetId"]'));
  const actions = read("web/actions.js");
  assert.ok(actions.includes("ArrayBuffer.isView(value)) return { __actionTypedArray"), "Actions can record a sampled tip");
  assert.ok(actions.includes("new Type(item.data)"), "Action playback restores the typed alpha");
});

test("Actions disclosure and brush controls stay independent and update during drags", () => {
  const actions = read("web/actions.js");
  assert.ok(actions.includes("const disclosure = new Map()"));
  assert.ok(actions.includes('disclosure.get(`set:${set.id}`) !== false'));
  assert.ok(actions.includes('disclosure.get(`action:${action.id}`) !== false'));
  assert.ok(!actions.includes('group.open = true;') && !actions.includes('branch.open = true;'));
  assert.ok(actions.includes("showSelection();"), "row selection does not rebuild and reset details");
  assert.ok(actions.includes("const activateSummary = (event, choose)"), "only the triangle changes disclosure");
  const app = read("web/app.js");
  assert.ok(app.includes("const syncBrushControls = () =>"));
  assert.ok(app.includes('data-brush-control="size"') || app.includes('size.dataset.brushControl = "size"'));
  assert.ok(app.includes('hardness.dataset.brushControl = "hardness"'));
  const adjust = app.indexOf('current.kind === "brushAdjust"');
  const sync = app.indexOf("syncBrushControls();", adjust);
  assert.ok(adjust >= 0 && sync > adjust && sync < app.indexOf("showBrushAdjust(current, event)", adjust));
});

test("Current Layer Smudge avoids an unused snapshot and repeated post-dab readback", () => {
  const engine = read("web/photoshop.js");
  assert.ok(engine.includes("if (smudge.sampleAll) {"), "only Sample All Layers captures the composite");
  assert.ok(engine.includes("if (target && !op.smudge.sampleAll) return target.data"));
  assert.ok(engine.includes("readSquare(left, top, target)"));
  assert.ok(engine.includes("const distanceSquared = dx * dx + dy * dy"));
  assert.ok(!engine.includes('const shot = cloneSource(doc, layer, smudge.sampleAll ? "all" : "current")'));
});
