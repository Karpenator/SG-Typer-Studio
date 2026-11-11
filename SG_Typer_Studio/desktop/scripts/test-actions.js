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
