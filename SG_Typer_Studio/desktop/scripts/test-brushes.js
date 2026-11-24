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

test("Ctrl + Alt + right-drag resizes the brush and is never a lent Move or a stuck eyedropper", () => {
  const app = read("web/app.js");
  // Ctrl + Alt with the right button belongs to the brush: the Move tool is not lent then
  assert.ok(app.includes("const moveLent = (event) => LENDS_MOVE.has(app.tool) && (IS_MAC ? event.metaKey : event.ctrlKey) && !event.altKey"), "Ctrl + Alt is not Ctrl alone");
  // The resize is decided before the lent tool, before the text's handles and before the
  // right button is dropped as an unknown one
  const resize = app.indexOf("const brushResize = !isFinger(event) && event.pointerType !== \"pen\"");
  const lent = app.indexOf("const lent = !brushResize");
  const unknownButton = app.indexOf("if (event.button !== 0) return;", resize);
  assert.ok(resize > 0 && lent > resize && unknownButton > lent, "the brush's own gesture comes first");
  const branch = app.indexOf('&& brushResize) {', resize);
  assert.ok(branch > 0 && branch < unknownButton, "the brush adjust branch runs before the button gate");
  // After the gesture, the ring is the brush's: no eyedropper class is left on the page
  const finish = app.indexOf('} else if (kind === "brushAdjust") {');
  const tail = app.slice(finish, finish + 700);
  assert.ok(tail.includes('ui.stage.classList.remove("is-sampling")'), "the eyedropper goes when the drag ends");
  assert.ok(tail.includes("showBrushAtPointer()"), "the ring comes back where the pointer is");
  // The colour picker's eyedropper goes with its window, which closes without a key being let go
  const picker = app.indexOf("if (closeColorPicker) closeColorPicker(true);", 400);
  assert.ok(picker > 0);
  assert.ok(app.includes("frame = 0;\n      sampleColorForPicker = null;"), "the picker clears its sampling when it closes");
  // Alt on a brush is the eyedropper with the ring hidden, and let go it is the ring again
  assert.ok(app.includes('if (isSampling(event)) hideBrushRing();\n      else showBrushAtPointer();'), "Alt hides the ring, letting go brings it back");
  // The icon is an inline style: it must be taken off when Alt is let go, or no class can win
  assert.ok(app.includes("let cursorSet = \"\";") && app.includes("const setStageCursor = (value) =>"), "the stage's cursor is put on and taken off in one place");
  assert.ok(app.includes('if (cursorSet && BRUSHING_TOOLS.has(app.tool)) setStageCursor("");'), "letting go of Alt takes the eyedropper icon off the brush");
});

test("The brush ring reads on a light page and on a dark one", () => {
  const app = read("web/app.js");
  const css = read("web/app.css");
  const html = read("web/index.html");
  assert.ok(html.includes('class="brush-ring brush-ring--under" id="brush-ring-under"'), "a dark under-stroke under the white ring");
  assert.ok(app.includes("const placeBrushRing = (x, y, radius) =>") && app.includes("const hideBrushRing = () =>"), "both circles move and hide together");
  assert.ok(!/mix-blend-mode: difference/.test(css.slice(css.indexOf(".brush-ring {"), css.indexOf(".brush-ring {") + 200)), "difference blending alone vanished on white");
  assert.ok(css.includes(".brush-ring--under { stroke: rgba(0, 0, 0, 0.62); stroke-width: 3px; }"), "the dark stroke is the contrast on a light page");
  const hidden = app.match(/ui\.brushRing\.setAttribute\("hidden"/g) || [];
  assert.equal(hidden.length, 0, "every hide goes through hideBrushRing, so no lone ring stays");
});
