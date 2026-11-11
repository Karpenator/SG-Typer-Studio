// PhotoCraft-compatible Curves maths; no DOM, Electron or raster document needed.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Curves = require("../../web/curves.js");

const channels = () => ({ rgb: Curves.identityPoints(), r: Curves.identityPoints(), g: Curves.identityPoints(), b: Curves.identityPoints() });
const sum = (values) => values.reduce((total, value) => total + value, 0);

test("identity curves and identity RGB tables leave every level unchanged", () => {
  assert.deepEqual(Array.from(Curves.curveSamples(Curves.identityPoints())), Array.from({ length: 256 }, (_, i) => i));
  Curves.tables(channels()).forEach((table) => assert.deepEqual(Array.from(table), Array.from({ length: 256 }, (_, i) => i)));
  assert.equal(Curves.isIdentity(channels().rgb), true);
  assert.equal(Curves.isIdentity([[0, 0], [128, 129], [255, 255]]), false);
  const nearlyIdentity = Curves.identityMap();
  nearlyIdentity[10] = 10.49;
  assert.equal(Curves.isIdentity(nearlyIdentity, true), true);
  nearlyIdentity[10] = 10.5;
  assert.equal(Curves.isIdentity(nearlyIdentity, true), false);
});

test("natural cubic spline matches the independently generated PhotoCraft reference", () => {
  const expected = [0, 5, 10, 15, 20, 25, 30, 34, 39, 44, 49, 53, 58, 62, 67, 71, 75, 80, 84, 88, 92, 95, 99, 103, 106, 109, 112, 115, 118, 121, 123, 126, 128, 130, 132, 134, 135, 136, 138, 139, 139, 140, 141, 141, 141, 142, 142, 142, 142, 141, 141, 140, 140, 139, 138, 137, 137, 136, 134, 133, 132, 131, 129, 128, 127, 125, 124, 122, 120, 119, 117, 115, 114, 112, 110, 109, 107, 105, 104, 102, 100, 99, 97, 96, 94, 93, 91, 90, 88, 87, 86, 85, 84, 83, 82, 81, 80, 79, 79, 78, 78, 77, 77, 77, 77, 77, 77, 77, 77, 78, 78, 78, 79, 80, 80, 81, 82, 83, 83, 84, 85, 86, 88, 89, 90, 91, 93, 94, 95, 97, 98, 100, 102, 103, 105, 107, 108, 110, 112, 114, 116, 118, 120, 121, 123, 125, 127, 130, 132, 134, 136, 138, 140, 142, 144, 147, 149, 151, 153, 155, 157, 160, 162, 164, 166, 168, 170, 173, 175, 177, 179, 181, 183, 185, 187, 189, 192, 194, 195, 197, 199, 201, 203, 205, 207, 209, 210, 212, 214, 215, 217, 218, 220, 221, 223, 224, 226, 227, 228, 229, 231, 232, 233, 234, 235, 236, 237, 238, 239, 239, 240, 241, 242, 243, 243, 244, 245, 245, 246, 246, 247, 247, 248, 248, 249, 249, 250, 250, 250, 251, 251, 251, 252, 252, 252, 252, 252, 253, 253, 253, 253, 253, 254, 254, 254, 254, 254, 254, 254, 254, 255, 255, 255, 255, 255, 255];
  const table = Curves.curveSamples([[0, 0], [32, 128], [96, 80], [192, 220], [255, 255]]).map(Math.round);
  assert.deepEqual(Array.from(table), expected);
});

test("a smaller display grid uses its full pixel range and the same endpoint convention", () => {
  assert.deepEqual(Array.from(Curves.curveSamples(Curves.identityPoints(), 5)), [0, 63.75, 127.5, 191.25, 255]);
  assert.deepEqual(Array.from(Curves.curveSamples(Curves.identityPoints(), 1)), [0]);
  assert.deepEqual(Array.from(Curves.curveSamples([[40, 100], [200, 150]], 5)), [100, 107.421875, 127.34375, 147.265625, 150]);
});

test("natural splines may overshoot but rendering clamps to 0..255", () => {
  const table = Curves.curveSamples([[0, 0], [32, 255], [64, 0], [255, 255]]);
  assert.ok(table[40] > 200);
  assert.equal(table.length, 256);
  assert.ok(Array.from(table).every((value) => value >= 0 && value <= 255));
  assert.ok(Array.from(table).some((value, i) => value > i + 20));
});

test("channel maps run before the composite RGB map", () => {
  const state = channels();
  state.r = [[0, 255], [255, 0]];
  state.rgb = [[0, 0], [128, 255], [255, 255]];
  const tables = Curves.tables(state);
  assert.equal(tables[0][0], 255);
  assert.equal(tables[0][128], 254);
  assert.equal(tables[0][255], 0);
  assert.equal(tables[1][128], 255);
  assert.deepEqual(tables[1], tables[2]);
});

test("4096-sample composite rendering matches independently calculated reference levels", () => {
  const state = channels();
  state.rgb = [[0, 0], [32, 200], [96, 40], [192, 230], [255, 255]];
  state.r = [[0, 20], [80, 180], [255, 240]];
  state.g = [[0, 255], [128, 80], [255, 0]];
  state.b = [[0, 0], [64, 20], [192, 240], [255, 255]];
  const indices = [0, 1, 17, 32, 63, 64, 95, 96, 127, 128, 160, 191, 192, 224, 254, 255];
  const expected = [
    [147, 159, 181, 54, 108, 114, 245, 246, 255, 255, 255, 255, 255, 255, 255, 255],
    [255, 255, 255, 252, 134, 129, 26, 25, 90, 94, 198, 199, 197, 109, 4, 0],
    [0, 0, 0, 11, 140, 147, 155, 148, 43, 48, 235, 255, 255, 255, 255, 255],
  ];
  Curves.tables(state).forEach((table, channel) => assert.deepEqual(indices.map((i) => table[i]), expected[channel]));
});

test("all channel and master pencil maps participate in RGB tables", () => {
  const state = channels();
  state.r = Curves.identityMap();
  for (let i = 8; i <= 12; i++) state.r[i] = 80;
  state.rgb = Curves.identityMap();
  for (let i = 78; i <= 82; i++) state.rgb[i] = 160;
  const tables = Curves.tables(state, true);
  assert.equal(tables[0][10], 160);
  assert.equal(tables[1][80], 160);
  assert.equal(tables[2][10], 10);
});

test("point insertion, movement, limits and endpoint-safe deletion match the widget", () => {
  const points = Curves.identityPoints();
  assert.equal(Curves.insertPoint(points, [100.4, 220.6]), 1);
  assert.deepEqual(points[1], [100.4, 220.6]);
  assert.equal(Curves.insertPoint(points, [101, 1]), 1);
  assert.equal(points.length, 3);
  assert.equal(Curves.movePoint(points, 1, [-100, 500]), true);
  assert.deepEqual(points[1], [1, 255]);
  assert.equal(Curves.movePoint(points, 0, [20, 40]), true);
  assert.deepEqual(points[0], [0, 40]);
  assert.equal(points.length, 3);
  assert.equal(Curves.canDeletePoint(points, 0), false);
  assert.equal(Curves.canDeletePoint(points, 2), false);
  assert.equal(Curves.canDeletePoint(points, 1), true);
  assert.equal(Curves.deletePoint(points, 1), true);
  assert.equal(Curves.deletePoint(points, 1), false);
  const full = Curves.identityPoints();
  for (let i = 1; i <= 14; i++) assert.notEqual(Curves.insertPoint(full, [i * 16, i * 16]), null);
  assert.equal(full.length, Curves.MAX_POINTS);
  assert.equal(Curves.insertPoint(full, [250, 1]), null);
});

test("adjacent points cannot cross when a point is dragged or nudged", () => {
  const points = [[0, 0], [50, 20], [100, 30], [255, 255]];
  Curves.movePoint(points, 1, [200, 25]);
  assert.deepEqual(points[1], [99, 25]);
  Curves.movePoint(points, 2, [-1, 200]);
  assert.deepEqual(points[2], [100, 200]);
  Curves.movePoint(points, 0, [100, 10]);
  assert.deepEqual(points[0], [98, 10]);
  Curves.movePoint(points, 3, [100, 240]);
  assert.deepEqual(points[3], [101, 240]);
});

test("pencil strokes interpolate every crossed level in both directions", () => {
  const map = Curves.identityMap();
  assert.equal(Curves.pencilLine(map, [40, 200], [20, 100]), true);
  for (let i = 20; i <= 40; i++) assert.equal(map[i], 100 + (i - 20) * 5);
  assert.equal(map[19], 19);
  assert.equal(map[41], 41);
  assert.equal(Curves.pencilLine(map, [60, 240], [60, 240]), true);
  assert.equal(map[60], 240);
  assert.equal(Curves.pencilLine(map, [60, 240], [60, 240]), false);
});

test("Smooth uses a symmetric radius-three window, shrinks at edges, and keeps endpoints", () => {
  const map = Curves.identityMap();
  map[0] = 20;
  map[255] = 230;
  const original = map[128];
  map[128] = 250;
  const smooth = Curves.smoothMap(map);
  assert.equal(smooth[0], 20);
  assert.equal(smooth[255], 230);
  assert.equal(smooth[1], (20 + 1 + 2) / 3);
  assert.equal(smooth[128], sum([125, 126, 127, 250, 129, 130, 131]) / 7);
  assert.notEqual(smooth[128], original);
  assert.equal(map[128], 250);
});

test("pencil maps convert back to point curves with at most sixteen points", () => {
  const map = Curves.identityMap();
  for (let i = 0; i < 256; i++) map[i] = 255 / (1 + Math.exp(-(i - 128) / 16));
  const points = Curves.mapToPoints(map);
  assert.ok(points.length >= 3 && points.length <= Curves.MAX_POINTS);
  assert.deepEqual(points[0], [0, map[0]]);
  assert.deepEqual(points.at(-1), [255, map[255]]);
  const fitted = Curves.pointsToMap(points);
  const worst = Math.max(...Array.from({ length: 256 }, (_, i) => Math.abs(fitted[i] - map[i])));
  assert.ok(points.length === Curves.MAX_POINTS || worst <= 1.001);
});

test("Curves adjustment parameters round-trip through Photoshop's point and pencil records", () => {
  const params = Curves.identityParams();
  params.points.rgb = [[0, 10], [90, 150], [255, 245]];
  params.points.r = [[0, 0], [128, 180], [255, 255]];
  const psd = Curves.toPsd(params);
  assert.equal(psd.type, "curves");
  assert.equal(psd.channels.length, 4);
  assert.deepEqual(psd.channels[0][1], { input: 90, output: 150 });
  const back = Curves.fromPsd(psd);
  assert.deepEqual(back.points, Curves.cloneParams(params).points);
  assert.equal(back.pencil, false);

  const pencil = Curves.cloneParams(params);
  pencil.pencil = true;
  pencil.maps.b[20] = 220;
  const values = Curves.toPsd(pencil).values;
  assert.equal(values.length, 4);
  assert.equal(values[3][20], 220);
  const drawn = Curves.fromPsd({ type: "curves", values });
  assert.equal(drawn.pencil, true);
  assert.equal(drawn.maps.b[20], 220);
});

test("Curves application changes RGB without changing alpha, and opacity approaches the original", () => {
  const image = { data: new Uint8ClampedArray([10, 20, 30, 128, 40, 50, 60, 0]) };
  const tables = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
  tables.forEach((table) => table.forEach((_, i) => { table[i] = 255 - i; }));
  Curves.apply(image, tables, 0.5);
  assert.deepEqual(Array.from(image.data), [128, 128, 128, 128, 40, 50, 60, 0]);
  const before = image.data.slice();
  assert.equal(Curves.apply(image, tables, 0), false);
  assert.deepEqual(image.data, before);
});

test("Layers footer creates or edits a separate Curves adjustment instead of painting the raster", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "..", "web", "app.js"), "utf8");
  const engine = fs.readFileSync(path.join(__dirname, "..", "..", "web", "photoshop.js"), "utf8");
  const psd = fs.readFileSync(path.join(__dirname, "..", "..", "web", "psd.js"), "utf8");
  assert.ok(app.includes('const curvesButton = iconButton("curves", T("Curves…"), false, () => showCurves());'));
  assert.ok(app.includes('curvesButton.id = "layers-curves";'));
  assert.ok(app.includes("footButtons = { lock, curves: curvesButton, copy, bin };"));
  assert.ok(app.includes('active.kind !== "raster" && active.kind !== "curves"'));
  assert.ok(app.includes('if (layer.kind === "curves") showCurves(layer.id);'));
  assert.ok(app.indexOf("curvesButton,\n      maskButton,") > 0, "Curves sits beside the mask button");
  const dialog = app.slice(app.indexOf("const showCurves = async"), app.indexOf("const isParagraph"));
  assert.ok(dialog.includes("ops.curvesBegin("));
  assert.ok(dialog.includes("ops.curvesPreview(params(), previewOn)"));
  assert.ok(dialog.includes('ops.curvesEnd(answer ? params() : null, "Curves")'));
  assert.ok(!dialog.includes("levelsBegin") && !dialog.includes("levelsPreview") && !dialog.includes("levelsEnd"));
  assert.ok(engine.includes('kind: "curves"'));
  assert.ok(engine.includes("layers.splice(layers.indexOf(source) + 1, 0, layer)"));
  assert.ok(engine.includes("doc.state = session.beforeState"));
  assert.ok(engine.includes('commitState(doc, label)'));
  assert.ok(psd.includes("window.TypeRCurves.toPsd(layer.curves)"));
  assert.ok(psd.includes("window.TypeRCurves.fromPsd(node.adjustment)"));
});

test("invalid data degrades to identity instead of making a non-finite raster table", () => {
  const table = Curves.curveSamples([[0, NaN], null, [255, 255]]);
  assert.deepEqual(Array.from(table), Array.from({ length: 256 }, (_, i) => i));
  const state = { rgb: [], r: null, g: [NaN], b: [] };
  Curves.tables(state, true).forEach((one) => assert.deepEqual(Array.from(one), Array.from({ length: 256 }, (_, i) => i)));
  assert.equal(Curves.movePoint(null, 0, [1, 2]), false);
  assert.equal(Curves.pencilLine(null, [0, 0], [1, 2]), false);
});
