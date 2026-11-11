const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Styles is a Workspace preset library with persistent user presets and real layer operations", () => {
  const html = read("web/index.html");
  for (const id of ["pane-styles", "styles-library", "styles-size", "styles-new", "styles-delete"]) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  assert.ok(html.includes('<script src="styles.js"></script>'), "the preset engine is loaded");
  const styles = read("web/styles.js");
  for (const group of ['id: "basics"', 'id: "text"', 'id: "buttons"', 'id: "custom"']) assert.ok(styles.includes(group), `missing ${group}`);
  assert.ok(styles.includes('const STORE = "typer.web.layerStyles";'));
  assert.ok(styles.includes("PS.ops.setLayers(doc.state.layers.map"), "applying a preset edits document layers, not only thumbnails");
  assert.ok(styles.includes("Object.assign({}, layer.effects, clone(preset.effects || {}))"), "Shift-click adds effects");
  assert.ok(styles.includes('effects: answer.effects ? clone(layer.effects || {}) : {}'), "Layer Effects owns the saved effects");
  assert.ok(styles.includes("stroke: answer.effects ? clone(layer.stroke || null) : null"), "stroke belongs to Layer Effects");
  assert.ok(styles.includes("answer.blending") && styles.includes("PS.fillOf(layer)"), "blending options are independent");
  const workspace = read("web/workspace.js");
  assert.ok(workspace.includes('styles: "pane-styles"'));
  const app = read("web/app.js");
  assert.ok(app.includes('{ label: "Styles", check: () => Workspace().isVisible("styles")'));
  assert.ok(app.includes("window.TypeRStyles.init({ translate: T, dialog, toast, targets: styleTargets });"));
});

test("Workspace modules dock as persistent, reorderable tabs and two-tab groups dissolve cleanly", () => {
  const workspace = read("web/workspace.js");
  assert.ok(workspace.includes("tabs: {},"), "tab groups are part of saved layout");
  assert.ok(workspace.includes('const addTabs = (leader, ids, x, y, w)'));
  assert.ok(workspace.includes('tab.setAttribute("role", "tab")'));
  assert.ok(workspace.includes('tab.setAttribute("aria-selected", String(id === active))'));
  assert.ok(workspace.includes('return { column: name, tab: part.id, before: tabs[at]'), "title rows accept tab drops");
  assert.ok(workspace.includes('layout.tabs[target.tab] = { panels: [target.tab], active: id }'), "a standalone module becomes a group");
  assert.ok(workspace.includes("if (target && target.tab === id && !leaderOf(id)) return;"), "dropping a standalone panel on itself cannot duplicate it");
  assert.ok(workspace.includes("if (id === oldLeader && remaining.length) panels[at] = remaining[0];"), "removing a leader promotes the remaining tab");
  assert.ok(workspace.includes("if (remaining.length > 1)"), "the last docked panel becomes standalone again");
  assert.ok(workspace.includes("if (leader && shown) layout.tabs[leader].active = id;"), "Window menu reveals and activates a grouped panel");
});

test("Smudge uses sequential premultiplied dabs with live preview, sampling options and History replay", () => {
  const app = read("web/app.js");
  assert.ok(app.includes('["smudge", "Smudge", "R"]'));
  assert.ok(app.includes('T("Strength")') && app.includes('T("Finger Painting")'));
  assert.ok(app.includes("sampleAll: smudge.sampleAll"));
  const engine = read("web/photoshop.js");
  assert.ok(engine.includes("const makeSmudgeState = (ctx, op)"), "one carried buffer belongs to the whole stroke");
  assert.ok(engine.includes("smudgeSegment(entry.ctx, live.op, segment, live.smudgeState"), "pointer segments preview through the same algorithm");
  assert.ok(engine.includes("state.carry[i] = picked[i] * a;"), "colour pickup is premultiplied");
  assert.ok(engine.includes("sampleCtx.drawImage(op.source.canvas"), "Sample All Layers starts from the merged snapshot");
  assert.ok(engine.includes("sampleCtx.drawImage(ctx.canvas, state.cx0 - left"), "changed active-layer pixels replace their old merged pixels");
  assert.ok(engine.includes("if (clipped) coverage *="), "selection coverage constrains every dab");
  assert.ok(engine.includes('op.t === "stroke" && op.smudge'), "cache rebuild and Redo replay Smudge before Clone Stamp handling");
  assert.ok(engine.includes('live.op.smudge ? "Smudge"'), "one stroke has its own History entry");
});
