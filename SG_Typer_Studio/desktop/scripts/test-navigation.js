const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Navigator is a localizable Workspace panel with a live viewport and zoom controls", () => {
  const html = read("web/index.html");
  for (const id of ["pane-navigator", "navigator-preview", "navigator-canvas", "navigator-viewport", "navigator-zoom", "navigator-slider", "navigator-in", "navigator-out"]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  const workspace = read("web/workspace.js");
  assert.ok(workspace.includes('navigator: "pane-navigator"'));
  assert.ok(workspace.includes('const SIDE = ["navigator", "styles", "brushes", "actions", "layers"'));
  assert.ok(workspace.includes('panels: ["navigator", "styles", "brushes", "actions", "layers"'));
  const app = read("web/app.js");
  assert.ok(app.includes('{ label: "Navigator", check: () => Workspace().isVisible("navigator")'));
  assert.ok(app.includes("ctx.drawImage(docCanvas, 0, 0, shownW, shownH);"), "the thumbnail follows the composed document");
  assert.ok(app.includes("navigatorCenter(navigatorPoint(event))"), "preview dragging centres the main view");
  for (const locale of fs.readdirSync(path.join(root, "web", "strings")).filter((file) => file.endsWith(".js"))) {
    const strings = read(path.join("web", "strings", locale));
    assert.ok(strings.includes('"Navigator":'), `${locale}: missing Navigator`);
    assert.ok(strings.includes('"No document":'), `${locale}: missing empty Navigator text`);
  }
});

test("Document scrollbars support thumb drags, track paging and keyboard navigation", () => {
  const html = read("web/index.html");
  assert.ok(html.includes('id="scroll-h" role="scrollbar" aria-orientation="horizontal"'));
  assert.ok(html.includes('id="scroll-v" role="scrollbar" aria-orientation="vertical"'));
  const app = read("web/app.js");
  assert.ok(app.includes("scrollDrag = { axis, id: event.pointerId, origin: at, start: g.v0, geometry: g };"), "thumb drags freeze their initial geometry");
  assert.ok(app.includes("scrollToStart(axis, g.v0 + (at < g.at ? -1 : 1) * g.visible * 0.9)"), "track clicks page through the document");
  assert.ok(app.includes('event.key === "PageDown"') && app.includes('event.key === "Home"'), "scrollbars are keyboard accessible");
  assert.ok(app.includes("renderNavigator();\n    renderScrollbars();"), "both navigation aids stay in the existing paint cycle");
});

test("Shortcut recording is installed after asynchronous desktop settings initialisation", () => {
  const app = read("web/app.js");
  const settings = app.indexOf("const showSettings = async");
  const listen = app.indexOf("if (shortcuts) shortcuts.listen();", settings);
  assert.ok(settings >= 0 && listen > settings, "the recorder is attached by the opened dialog, not before the Discord await");
  const editorStart = app.indexOf("const shortcutEditor = () =>");
  const editorEnd = app.indexOf("// AltGr reads as Ctrl+Alt", editorStart);
  const editor = app.slice(editorStart, editorEnd);
  assert.ok(editor.includes("listen,"), "the editor exposes its recorder installation");
  assert.ok(!editor.includes("setTimeout(listen"), "an early timer cannot be reset by dialog construction");
});
