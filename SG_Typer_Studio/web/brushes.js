// Photoshop-compatible brush presets. ABR parsing is provided by ag-psd on demand; imported
// alpha tips and settings live in IndexedDB, so a library survives reloads without localStorage
// quotas or a server. The same preset object supplies panel previews and real paint operations.

(function () {
  "use strict";

  const PS = window.TypeRPhotoshop;
  const { app } = PS;
  const $ = (id) => document.getElementById(id);
  const DB = "typer-web-brushes";
  const STORE = "presets";
  const SELECTED = "typer.web.brushPreset";
  const MAX_TIP = 1024;
  let T = (text) => text;
  let notify = () => {};
  let imported = [];
  let selectedId = null;
  let query = "";
  let thumbSize = 48;
  const disclosure = new Map();
  const uid = () => `abr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  const basic = (id, name, size, hardness, spacing = 0.1) => ({ id, name, group: ["Basic"], size, hardness, spacing, angle: 0, roundness: 1, builtIn: true });
  const builtins = [
    basic("basic-hard-1", "Hard Round 1", 1, 100),
    basic("basic-hard-5", "Hard Round 5", 5, 100),
    basic("basic-hard-12", "Hard Round 12", 12, 100),
    basic("basic-hard-24", "Hard Round 24", 24, 100),
    basic("basic-soft-12", "Soft Round 12", 12, 0),
    basic("basic-soft-24", "Soft Round 24", 24, 0),
    basic("basic-soft-50", "Soft Round 50", 50, 0),
    basic("basic-soft-100", "Soft Round 100", 100, 0),
  ];
  const all = () => builtins.concat(imported);
  const selected = () => all().find((preset) => preset.id === selectedId) || null;

  /* ------------------------------- persistence ------------------------------ */

  let opening = null;
  const openDb = () => {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("The brush library is open in another tab"));
    });
    return opening;
  };
  const transaction = async (mode, act) => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = act(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error || request.error);
      tx.onabort = () => reject(tx.error || new Error("The brush library could not be saved"));
    });
  };
  const validPreset = (preset) => preset && typeof preset.id === "string" && typeof preset.name === "string" && Array.isArray(preset.group) && Number.isFinite(preset.size) && (!preset.tip || (preset.tip.alpha && preset.tip.width > 0 && preset.tip.height > 0));
  const ready = (async () => {
    try {
      const rows = await transaction("readonly", (store) => store.getAll());
      imported = (rows || []).filter(validPreset);
      imported.forEach((preset) => { preset.builtIn = false; });
    } catch (error) {
      console.warn("SG Typer Studio: brush library could not be opened", error);
    }
    try { selectedId = localStorage.getItem(SELECTED); } catch (error) { selectedId = null; }
    if (selectedId && selected()) apply(selected(), false);
    render();
  })();

  /* --------------------------------- drawing -------------------------------- */

  const operation = (preset, size, color = { red: 35, green: 35, blue: 39 }) => ({
    size,
    hardness: preset.hardness,
    spacing: preset.spacing,
    angle: preset.angle,
    roundness: preset.roundness,
    flipX: preset.flipX,
    flipY: preset.flipY,
    tip: preset.tip,
    stamped: true,
    color,
  });
  const drawPreview = (canvas, preset, stroke = false) => {
    const width = stroke ? 240 : Math.max(36, thumbSize);
    const height = stroke ? 46 : width;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    const size = Math.min(stroke ? 30 : width - 10, Math.max(2, preset.size));
    const op = operation(preset, size);
    if (stroke) {
      const points = [[8, height / 2 + 4], [width * 0.32, height / 2 - 8], [width * 0.62, height / 2 + 7], [width - 9, height / 2 - 3]];
      for (let i = 0; i < points.length; i++) PS.paintStroke(ctx, op, i ? [points[i - 1], points[i]] : [points[i]]);
    } else PS.paintStroke(ctx, op, [[width / 2, height / 2]]);
  };
  const apply = (preset, chooseTool = true) => {
    ["tip", "spacing", "angle", "roundness", "flipX", "flipY", "stamped", "presetId"].forEach((key) => delete app.brush[key]);
    app.brush.size = clamp(Math.round(preset.size || 24), 1, 2000);
    app.brush.hardness = clamp(Math.round((preset.hardness === undefined ? 100 : preset.hardness) * 100) / 100, 0, 100);
    ["tip", "spacing", "angle", "roundness", "flipX", "flipY"].forEach((key) => {
      if (preset[key] !== undefined) app.brush[key] = preset[key];
    });
    app.brush.stamped = true;
    app.brush.presetId = preset.id;
    selectedId = preset.id;
    try { localStorage.setItem(SELECTED, selectedId); } catch (error) { /* Storage may be off. */ }
    if (chooseTool && window.TypeRApp) window.TypeRApp.setTool("brush");
    if (window.TypeRApp) window.TypeRApp.syncBrushControls();
    render();
  };
  const select = (id) => {
    const preset = all().find((item) => item.id === id);
    if (preset) apply(preset);
  };

  /* ---------------------------------- ABR ---------------------------------- */

  const downsampleTip = (sample) => {
    let { w: width, h: height } = sample.bounds;
    let alpha = sample.alpha;
    if (Math.max(width, height) <= MAX_TIP) return { width, height, alpha };
    const source = PS.newCanvas(width, height);
    const ctx = source.getContext("2d", { willReadFrequently: true });
    const image = ctx.createImageData(width, height);
    for (let i = 0; i < alpha.length; i++) image.data[i * 4 + 3] = alpha[i];
    ctx.putImageData(image, 0, 0);
    const scale = MAX_TIP / Math.max(width, height);
    const out = PS.newCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    const oc = out.getContext("2d", { willReadFrequently: true });
    oc.drawImage(source, 0, 0, out.width, out.height);
    const pixels = oc.getImageData(0, 0, out.width, out.height).data;
    alpha = new Uint8Array(out.width * out.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
    return { width: out.width, height: out.height, alpha };
  };
  const fromAbr = (data, filename) => {
    const samples = new Map(data.samples.map((sample) => [sample.id, sample]));
    const folder = filename.replace(/\.abr$/i, "") || T("Imported");
    const presets = [];
    let skipped = 0;
    data.brushes.forEach((brush, index) => {
      const shape = brush.shape;
      if (!shape || (shape.type !== "computed" && shape.type !== "sampled")) { skipped++; return; }
      let tip = null;
      if (shape.type === "sampled") {
        const sample = samples.get(shape.sampledData);
        if (!sample) { skipped++; return; }
        tip = downsampleTip(sample);
      }
      const group = Array.isArray(brush.group) && brush.group.length ? brush.group.map(String) : [folder];
      presets.push({
        id: uid(),
        name: String(brush.name || shape.name || `${T("Brush")} ${index + 1}`),
        group,
        size: clamp(Math.round(shape.size || (tip ? Math.max(tip.width, tip.height) : 24)), 1, 2000),
        hardness: shape.type === "computed" ? clamp((shape.hardness === undefined ? 1 : shape.hardness) * 100, 0, 100) : 100,
        spacing: clamp(shape.spacingOn === false ? 0.1 : (shape.spacing || 0.25), 0.01, 10),
        angle: Number(shape.angle) || 0,
        roundness: clamp(shape.roundness === undefined ? 1 : shape.roundness, 0.01, 1),
        flipX: Boolean(shape.flipX),
        flipY: Boolean(shape.flipY),
        tip,
        builtIn: false,
      });
    });
    return { presets, skipped };
  };
  const importFiles = async (files) => {
    let count = 0;
    let skipped = 0;
    let last = null;
    for (const file of Array.from(files || [])) {
      try {
        const lib = await window.TypeRPSD.library();
        const data = lib.readAbr(new Uint8Array(await file.arrayBuffer()));
        const mapped = fromAbr(data, file.name);
        skipped += mapped.skipped;
        for (const preset of mapped.presets) {
          await transaction("readwrite", (store) => store.put(preset));
          imported.push(preset);
          last = preset;
          count++;
        }
      } catch (error) {
        skipped++;
        console.warn(`SG Typer Studio: could not import ${file.name}`, error);
      }
    }
    if (last) apply(last, false);
    else render();
    const message = count
      ? `${T("Imported brushes")}: ${count}${skipped ? ` · ${T("Unsupported or unreadable")}: ${skipped}` : ""}`
      : `${T("No supported brushes found")}${skipped ? ` (${skipped})` : ""}`;
    notify(message, !count);
    return { imported: count, skipped, last };
  };
  const remove = async () => {
    const preset = selected();
    if (!preset || preset.builtIn) return false;
    try {
      await transaction("readwrite", (store) => store.delete(preset.id));
      imported = imported.filter((item) => item.id !== preset.id);
      selectedId = null;
      try { localStorage.removeItem(SELECTED); } catch (error) { /* Storage may be off. */ }
      apply(builtins[3], false);
      return true;
    } catch (error) {
      notify(T("The brush could not be deleted"), true);
      return false;
    }
  };

  /* ---------------------------------- panel -------------------------------- */

  const matches = (preset) => !query || `${preset.name} ${preset.group.join(" ")}`.toLocaleLowerCase().includes(query);
  const renderCurrent = () => {
    const preset = selected() || builtins[3];
    $("brushes-name").textContent = preset.name;
    $("brushes-meta").textContent = `${Math.round(app.brush.size)} px · ${Math.round(app.brush.hardness)}%${preset.tip ? ` · ${preset.tip.width}×${preset.tip.height}` : ""}`;
    drawPreview($("brushes-preview"), preset, true);
    $("brushes-delete").disabled = !selected() || preset.builtIn;
  };
  const render = () => {
    const list = $("brushes-list");
    if (!list) return;
    renderCurrent();
    list.textContent = "";
    const root = { groups: new Map(), presets: [] };
    all().filter(matches).forEach((preset) => {
      let node = root;
      preset.group.forEach((name) => {
        if (!node.groups.has(name)) node.groups.set(name, { groups: new Map(), presets: [] });
        node = node.groups.get(name);
      });
      node.presets.push(preset);
    });
    const addGroup = (node, container, path = "") => {
      node.groups.forEach((child, name) => {
        const key = `${path}/${name}`;
        const details = document.createElement("details");
        details.className = "brushes-group";
        details.open = query ? true : disclosure.get(key) !== false;
        details.addEventListener("toggle", () => disclosure.set(key, details.open));
        const summary = document.createElement("summary");
        const count = (branch) => branch.presets.length + Array.from(branch.groups.values()).reduce((sum, item) => sum + count(item), 0);
        summary.innerHTML = `<span class="brushes-folder" aria-hidden="true">▰</span><span></span><small>${count(child)}</small>`;
        summary.querySelector("span:nth-child(2)").textContent = name;
        details.appendChild(summary);
        addGroup(child, details, key);
        container.appendChild(details);
      });
      if (node.presets.length) {
        const grid = document.createElement("div");
        grid.className = "brushes-grid";
        grid.style.setProperty("--brush-cell", `${thumbSize}px`);
        node.presets.forEach((preset) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "brushes-preset";
          button.classList.toggle("is-selected", preset.id === selectedId);
          button.dataset.brush = preset.id;
          button.title = `${preset.name} · ${preset.size} px`;
          button.setAttribute("aria-label", button.title);
          const canvas = document.createElement("canvas");
          canvas.className = "brushes-thumb";
          drawPreview(canvas, preset);
          const label = document.createElement("span");
          label.textContent = preset.name;
          button.append(canvas, label);
          button.addEventListener("click", () => select(preset.id));
          grid.appendChild(button);
        });
        container.appendChild(grid);
      }
    };
    addGroup(root, list);
    if (!list.children.length) {
      const empty = document.createElement("p");
      empty.className = "brushes-empty";
      empty.textContent = T("No brushes match your search");
      list.appendChild(empty);
    }
  };
  const init = ({ translate, toast }) => {
    T = translate;
    notify = toast;
    $("head-brushes").textContent = T("Brushes");
    $("brushes-search").placeholder = T("Search brushes");
    $("brushes-search").setAttribute("aria-label", T("Search brushes"));
    $("brushes-import").title = T("Import Brushes (.abr)…");
    $("brushes-import").setAttribute("aria-label", T("Import Brushes (.abr)…"));
    $("brushes-delete").title = T("Delete Brush");
    $("brushes-delete").setAttribute("aria-label", T("Delete Brush"));
    $("brushes-search").addEventListener("input", (event) => { query = event.target.value.trim().toLocaleLowerCase(); render(); });
    $("brushes-size").addEventListener("input", (event) => { thumbSize = Number(event.target.value); render(); });
    $("brushes-import").addEventListener("click", () => $("brushes-file").click());
    $("brushes-file").addEventListener("change", async (event) => {
      await importFiles(event.target.files);
      event.target.value = "";
    });
    $("brushes-delete").addEventListener("click", () => { void remove(); });
    render();
    void ready;
  };

  window.TypeRBrushes = { init, ready, importFiles, select, remove, render, list: all, selected, drawPreview };
})();
