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
  const closes = app.indexOf("sampleColorForPicker = null;", app.indexOf("const done = (keep) =>"));
  assert.ok(closes > 0 && closes < app.indexOf("closeColorPicker = done;", closes), "the picker clears its sampling when it closes");
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

test("Every identifier the pointer code names is declared, and declared before it is first used", () => {
  const app = read("web/app.js");
  // BRUSHING_TOOLS was used but never declared: every move threw, and no tool had a cursor
  assert.ok(app.includes("const BRUSHING_TOOLS = new Set([\"brush\", \"eraser\", \"stamp\", \"healing\", \"heal\", \"smudge\"]);"), "the brushing tools are declared once");
  const declared = app.indexOf("const BRUSHING_TOOLS =");
  const isSampling = app.indexOf("const isSampling =");
  const firstRead = app.indexOf("BRUSHING_TOOLS.has(");
  assert.ok(declared > 0 && declared < firstRead, "it is declared before the code that asks about it");
  // isSampling only names it when called, which is long after both: a const in a function body is
  // read at call time, so the arrow function there is fine.
  assert.ok(isSampling > 0, "the sampling rule is a function, not a value read at load");
  // The helpers the pointer handlers call must exist too
  for (const helper of ["const placeBrushRing =", "const hideBrushRing =", "const showBrushAtPointer =", "const setStageCursor =", "let cursorSet"]) {
    assert.ok(app.includes(helper), `${helper} exists`);
  }
  // Nothing may be named without being declared anywhere: a bare use is a ReferenceError on every
  // event, which reads as a dead pointer rather than as a broken line
  for (const name of ["BRUSHING_TOOLS", "cursorSet", "brushAt", "hoverAt"]) {
    assert.ok(new RegExp(`(const|let|var)\\s+${name}\\b`).test(app), `${name} is declared`);
  }
});

test("A brush's pointer is hidden only by the ring that is drawn in its place", () => {
  const app = read("web/app.js");
  const css = read("web/app.css");
  // The tool's own class must not say cursor:none: that hid the pointer and left it to the ring,
  // and a ring that never came left nothing at all
  const brushes = ['brush', 'eraser', 'stamp', 'healing', 'heal', 'smudge'];
  const toolRule = css.split("\n").find((line) => brushes.every((tool) => line.includes(`[data-tool="${tool}"]`)) || (/data-tool="brush"/.test(line) && line.includes("cursor")));
  assert.ok(toolRule, "the brushing tools have a rule");
  assert.ok(!/cursor:\s*none/.test(toolRule), `the brush tool shows a crosshair, not nothing: ${toolRule.trim()}`);
  assert.ok(/cursor:\s*crosshair/.test(toolRule), "and it is visible");
  // Hiding the pointer goes with the ring: the same class that draws it takes it away
  assert.ok(/\.stage\.is-ring \{ cursor: none; \}/.test(css), "is-ring hides the pointer");
  assert.ok(app.includes('ui.stage.classList.toggle("is-ring", drawn);'), "the ring turns it on when it is drawn");
  assert.ok(/const hideBrushRing = \(\) => \{[\s\S]{0,220}?classList\.remove\("is-ring"\)/.test(app), "and off when it goes");
  // A hidden ring leaves a visible pointer: place and hide stay together
  assert.ok(/const hideBrushRing[\s\S]{0,220}?remove\("is-ring"\)/.test(app), "hiding the ring puts the pointer back");
});

test("The Clone Stamp and the Healing Brush can take their source from another open page", () => {
  const app = read("web/app.js");
  // The source carries the page it was taken on, so a stroke can read pixels from another tab
  assert.ok(app.includes("const stampFields = (state) => ({ ox: state.offset ? state.offset[0] : 0, oy: state.offset ? state.offset[1] : 0, sample: state.sample, doc: state.doc || app.doc, layer: state.layer || null });"), "the source says which page and layer it came from");
  assert.ok(app.includes("const sourceIsElsewhere = () => hasStampSource() && stampState().doc !== app.doc;"), "a source on another page is known as one");
  assert.ok(app.includes("app.docs.includes(stampState().doc)"), "and only while that page is still open");
  // The options bar says where it is, and lets it go in one click
  assert.ok(app.includes('where.textContent = elsewhere ? fill(T("Source: {page}"), { page: state.doc.name }) : T("Source: this page");'), "the bar says which page the source is on");
  assert.ok(app.includes('back.textContent = T("Use this page");'), "and one click takes it from this page again");
  // A source on another page is that page's pixels: the preview under the brush shows them, cut
  // from that page as it stands in its own tab
  assert.ok(app.includes("const elsewhere = sourceIsElsewhere();"), "the preview knows a source from another page");
  assert.ok(app.includes("ctx.drawImage(referencePicture(), sx - (size * other.zoom) / 2, sy - (size * other.zoom) / 2, size * other.zoom, size * other.zoom, 0, 0, side, side);"), "and draws that page there");
  assert.ok(app.includes("const referencePicture = () => {"), "through the picture the engine keeps of it");
  // Taken on this page, the source is still this page as it was when the stroke started
  const engine = read("web/photoshop.js");
  assert.ok(engine.includes("const shotOf = (fields) => {"), "a stroke asks for the page it reads");
  assert.ok(engine.includes("if (fields.doc && fields.doc !== doc) {"), "and reads the other page when the source was taken there");
  assert.ok(engine.includes("return referenceShot(fields.doc, fields.sample, other);"), "from a picture kept for that page");
});

test("A source whose page was closed says so instead of painting nothing", () => {
  const app = read("web/app.js");
  // The page a source was taken on can go away: a stroke then says so rather than reaching for it
  assert.ok(app.includes("const sourceGone = () => Boolean(stampState().doc) && !app.docs.includes(stampState().doc);"), "a closed page is known as gone");
  assert.ok(app.includes('toast(T(tool === "healing" ? "The page the healing source was taken on is closed. Alt + click to choose another." : "The page the clone source was taken on is closed. Alt + click to choose another."));'), "and the click that finds it gone says so");
  assert.ok(app.includes("Object.assign(state, { doc: null, layer: null, x: 0, y: 0, offset: null, pointer: null });"), "while the source itself is let go");
});

test("The source taken with Alt on one page stays when another tab is opened", () => {
  // What a user does: pick the tool, Alt + click on the reference page, switch tabs, paint. The
  // source must still name the page it came from, with the layer sampled there and the offset
  // counted from the first click on the page being painted.
  const app = read("web/app.js");
  const engine = read("web/photoshop.js");
  assert.ok(app.includes('const hasStampSource = () => Boolean(app.doc) && Boolean(stampState().doc) && app.docs.includes(stampState().doc);'), "the source counts while its page is open");
  assert.ok(app.includes("const stampFields = (state) => ({ ox: state.offset ? state.offset[0] : 0, oy: state.offset ? state.offset[1] : 0, sample: state.sample, doc: state.doc || app.doc, layer: state.layer || null });"), "and every stroke says which page it reads");
  // Switching a tab goes straight to the engine, which is what leaves the source alone
  assert.ok(app.includes("const switchDoc = (doc) => {\n    if (!ui.editor.hidden) endEdit();\n    if (!settleTransform()) return;\n    PS.setActiveDoc(doc);\n  };"), "switching a tab only tells the engine which page is shown");
  // On another page the layer chosen there decides what "Current Layer" and "Current and Below"
  // read, as if its own Clone Stamp were used
  assert.ok(engine.includes('const other = fields.layer ? fields.doc.state.layers.find((item) => item.id === fields.layer) : null;'), "the layer sampled is the one chosen on the source page");
  assert.ok(engine.includes("const at = sample === \"below\" && layer ? doc.state.layers.indexOf(layer) : -1;"), "and Current and Below stops at it there");
});
