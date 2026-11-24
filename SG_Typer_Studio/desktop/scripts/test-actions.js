const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Actions is a Workspace library with persistent sets, recording and real document playback", () => {
  const html = read("web/index.html");
  for (const id of ["pane-actions", "actions-list", "actions-stop", "actions-play", "actions-new-set", "actions-new", "actions-delete"]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.ok(html.includes('<script src="actions.js"></script>'));
  const actions = read("web/actions.js");
  assert.ok(actions.includes('const STORE = "typer.web.actions"'));
  assert.ok(actions.includes("const newSet = async () =>") && actions.includes("const newAction = async () =>"));
  assert.ok(actions.includes("save(); startRecording(action);"), "New Action begins recording");
  assert.ok(actions.includes("const wrap = () =>") && actions.includes("PS.ops[method] = function (...args)"), "recording observes real engine operations");
  assert.ok(actions.includes("if (!opDepth && recordingAction()"), "composite commands cannot duplicate nested steps");
  assert.ok(actions.includes("captureStroke()") && actions.includes('method: "__stroke"'), "a stroke is stored as one replayable step");
  assert.ok(actions.includes("PS.ops[step.method](...decodeArgs(step.method, step.args))"), "playback calls the document engine");
  assert.ok(actions.includes("set ? set.actions : []"), "a selected set can play all its actions");
  assert.ok(actions.includes("if (step.enabled === false) continue"), "individual steps can be disabled");
  const workspace = read("web/workspace.js");
  assert.ok(workspace.includes('actions: "pane-actions"'));
  assert.ok(workspace.includes('actions: 240'));
  const app = read("web/app.js");
  assert.ok(app.includes('{ label: "Actions", check: () => Workspace().isVisible("actions")'));
  assert.ok(app.includes("window.TypeRActions.init({ translate: T, dialog, toast });"));
});

test("Actions and the two independent New Style options are localized", () => {
  const styles = read("web/styles.js");
  assert.ok(styles.includes('label: T("Include Layer Effects")'));
  assert.ok(styles.includes('label: T("Include Layer Blending Options")'));
  assert.ok(!styles.includes("Include Stroke"), "stroke is part of Layer Effects");
  const localeDir = path.join(root, "web", "strings");
  for (const locale of fs.readdirSync(localeDir).filter((file) => file.endsWith(".js"))) {
    const strings = read(path.join("web", "strings", locale));
    for (const key of ["Actions", "New set", "New Action", "Stop recording", "Begin recording", "Play selection", "Include Layer Effects", "Include Layer Blending Options"]) {
      assert.ok(strings.includes(`"${key}":`), `${locale}: missing ${key}`);
    }
  }
});

test("A recorded rename finds its layer by the name it had, not the one it is given", () => {
  const actions = read("web/actions.js");
  // The refs are read before the command runs: after a rename the old name is gone
  assert.ok(actions.includes("const early = !playing && recordingAction() ? encodeEarly(method, args) : null;"), "recording reads the layer refs before the command changes them");
  assert.ok(actions.includes("capture(method, args, early)") && actions.includes("args: encoded || encodeArgs(method, args)"), "the step keeps the refs taken before the change");
  assert.ok(actions.includes("rasterizeLayer: { 0: \"one\" }"), "Rasterize Layer records the layer it rasterizes");
  assert.ok(actions.includes("rasterizeLayer: \"Rasterize Layer\""));
});

test("Rasterize Layer turns a text or an SFX into its pixels, as Photoshop's does", () => {
  const photoshop = read("web/photoshop.js");
  assert.ok(photoshop.includes("rasterizeLayer(id, typeOnly) {"), "the engine has Rasterize Layer");
  assert.ok(photoshop.includes("return ops.rasterizeLayer(id, true);"), "Rasterize Type shares the same step, under its own name");
  assert.ok(photoshop.includes('if (!layer || layer.kind === "raster" || layer.kind === "curves") return false;'), "a pixel layer has nothing to rasterize, and a curve stays an adjustment");
  assert.ok(photoshop.includes('if (layer.kind === "group") {'), "a folder is merged into its pixels, as Photoshop's Rasterize Layer and Merge Group do");
  assert.ok(photoshop.includes('raster.bitmap = paintAlone(doc, inside);'), "the folder's pixels come from what it holds");
  assert.ok(photoshop.includes('const raster = newRaster(layer.name, { group: layer.group, opacity: layer.opacity'), "an SFX panel takes its pixels from what shows on the page");
  assert.ok(photoshop.includes('const name = typeOnly ? "Rasterize Type" : "Rasterize Layer";'), "each keeps its own name in History");
  assert.ok(photoshop.includes("commitState(doc, name,"), "it is one undoable step");
  const app = read("web/app.js");
  assert.ok(app.includes('{ label: "Rasterize Layer", keys: "Shift+Cmd+Y"'), "Layer > Rasterize Layer");
  assert.ok(app.includes('"Rasterize Type", "Rasterize Layer", null, "Convert to SFX"'), "the layer menu has it too");
  assert.ok(app.includes('"Convert to Paragraph Text", "Convert to Point Text", "Rasterize Type", "Rasterize Layer", null, "Convert to SFX"'), "the page's own right-click menu has it as well");
});
