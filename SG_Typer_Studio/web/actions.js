// Window > Actions: named sets of replayable operations. Recording wraps the same public
// document operations used by the tools and menus; playback calls them again, so every step
// participates in rendering and History. Libraries are local and survive application restarts.
(function () {
  "use strict";
  const PS = window.TypeRPhotoshop;
  const $ = (id) => document.getElementById(id);
  const STORE = "typer.web.actions";
  // Brush tips are typed alpha arrays. Keep their type through local JSON storage so an
  // imported sampled brush recorded in an Action replays exactly after a reload.
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value, (key, item) => ArrayBuffer.isView(item) ? { __actionTypedArray: item.constructor.name, data: Array.from(item) } : item), (key, item) => {
    if (!item || !item.__actionTypedArray || !Array.isArray(item.data)) return item;
    const Type = window[item.__actionTypedArray];
    return typeof Type === "function" && Type.BYTES_PER_ELEMENT ? new Type(item.data) : item;
  });
  const uid = (kind) => `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // Commands with serializable parameters and deterministic document results. Interactive
  // previews, file dialogs, clipboard contents, generators and arbitrary canvas payloads are
  // deliberately not recorded as though replaying them would be safe.
  const METHODS = new Set([
    "resizeCanvas", "transformLayers", "crop", "resizeImage", "magicErase", "wandAt", "colorRange",
    "rectangle", "ellipse", "lasso", "selectAll", "invert", "reselect", "grow", "nudgeSelection", "deselect",
    "toggleLayer", "setLayerProps", "moveLayers", "moveLayer", "newLayer", "newGroup", "duplicateLayers", "layerViaCopy",
    "groupLayers", "ungroupLayers", "deleteLayers", "reorderLayer", "reorderLayers", "newLayerBelow", "mergeDown",
    "mergeSelected", "mergeGroup", "mergeVisible", "flatten", "rasterizeText", "selectLayerPixels", "replaceFonts",
    "addMask", "addVectorMask", "deleteMask", "applyMask", "setMaskProps", "invertMask", "maskToSelection", "moveMask",
    "transferMask", "rasterizeVectorMask", "toggleClipping", "clipToBelow", "toggleQuickMask", "fillMask", "fillSelection",
    "newText", "setText", "setTextStyle", "convertText", "setLineBreaks", "setTextVerticalAlign", "setTextAntiAlias",
    "setTextStroke", "setLayerEffects",
  ]);
  const ID_ARGS = {
    transformLayers: { 0: "many" }, toggleLayer: { 0: "one" }, setLayerProps: { 0: "one" }, moveLayers: { 0: "many" }, moveLayer: { 0: "one" },
    reorderLayer: { 0: "one", 1: "one" }, reorderLayers: { 0: "many", 1: "one" }, mergeGroup: { 0: "one" }, rasterizeText: { 0: "one" },
    selectLayerPixels: { 0: "one" }, addMask: { 1: "many" }, addVectorMask: { 1: "many" }, deleteMask: { 0: "one" }, applyMask: { 0: "one" },
    setMaskProps: { 0: "one" }, invertMask: { 0: "one" }, maskToSelection: { 0: "one" }, moveMask: { 0: "one" },
    transferMask: { 0: "one", 1: "one" }, rasterizeVectorMask: { 0: "one" }, clipToBelow: { 0: "one" }, fillMask: { 1: "one" },
    setText: { 0: "one" }, setTextStyle: { 0: "many" }, convertText: { 0: "one" }, setLineBreaks: { 0: "one" },
    setTextVerticalAlign: { 0: "many" }, setTextAntiAlias: { 0: "many" }, setTextStroke: { 0: "many" }, setLayerEffects: { 0: "many" },
  };
  const COALESCE_ARGS = { setLayerProps: 3, moveLayers: 3, setMaskProps: 3, moveMask: 2, setText: 2, setTextStyle: 3, setTextStroke: 2, setLayerEffects: 2 };
  const LABELS = {
    resizeCanvas: "Canvas Size", transformLayers: "Transform", crop: "Crop", resizeImage: "Image Size", magicErase: "Magic Eraser", wandAt: "Magic Wand", colorRange: "Colour Range",
    rectangle: "Rectangular Marquee", ellipse: "Elliptical Marquee", lasso: "Lasso", selectAll: "Select All", invert: "Inverse", reselect: "Reselect", grow: "Grow", nudgeSelection: "Move Selection", deselect: "Deselect",
    toggleLayer: "Layer Visibility", setLayerProps: "Layer Properties", moveLayers: "Move Layers", moveLayer: "Move Layer", newLayer: "New Layer", newGroup: "New Group", duplicateLayers: "Duplicate Layers", layerViaCopy: "Layer Via Copy",
    groupLayers: "Group Layers", ungroupLayers: "Ungroup Layers", deleteLayers: "Delete Layers", reorderLayer: "Reorder Layer", reorderLayers: "Reorder Layers", newLayerBelow: "New Layer Below", mergeDown: "Merge Down",
    mergeSelected: "Merge Layers", mergeGroup: "Merge Group", mergeVisible: "Merge Visible", flatten: "Flatten Image", rasterizeText: "Rasterize Type", selectLayerPixels: "Select Layer Pixels", replaceFonts: "Replace Fonts",
    addMask: "Add Layer Mask", addVectorMask: "Add Vector Mask", deleteMask: "Delete Mask", applyMask: "Apply Mask", setMaskProps: "Mask Properties", invertMask: "Invert Mask", maskToSelection: "Mask To Selection", moveMask: "Move Mask",
    transferMask: "Transfer Mask", rasterizeVectorMask: "Rasterize Vector Mask", toggleClipping: "Clipping Mask", clipToBelow: "Clipping Mask", toggleQuickMask: "Quick Mask", fillMask: "Fill Mask", fillSelection: "Fill",
    newText: "Type Tool", setText: "Edit Text", setTextStyle: "Text Style", convertText: "Convert Text", setLineBreaks: "Line Breaks", setTextVerticalAlign: "Vertical Alignment", setTextAntiAlias: "Anti-Alias",
    setTextStroke: "Stroke", setLayerEffects: "Layer Style",
  };

  let T = (text) => text;
  let ask = null;
  let notify = null;
  let sets = [];
  let selected = { setId: null, actionId: null };
  // Disclosure belongs to the tree, not to selection. Rebuilding a row for a click used to
  // reset every <details> to open and made the triangles appear to do nothing.
  const disclosure = new Map();
  let recordingId = null;
  let activeStroke = null;
  let playing = false;
  let playToken = 0;
  let currentStep = null;
  let wrapped = false;
  let opDepth = 0;
  let lastUnsupported = 0;

  const makeSet = (name) => ({ id: uid("set"), name, shortcut: "", actions: [] });
  const makeAction = (name) => ({ id: uid("action"), name, shortcut: "", steps: [] });
  const normalize = (saved) => Array.isArray(saved) ? saved.filter((set) => set && typeof set.id === "string" && typeof set.name === "string" && Array.isArray(set.actions)).map((set) => ({
    id: set.id, name: set.name, shortcut: typeof set.shortcut === "string" ? set.shortcut : "",
    actions: set.actions.filter((action) => action && typeof action.id === "string" && typeof action.name === "string" && Array.isArray(action.steps)).map((action) => ({ id: action.id, name: action.name, shortcut: typeof action.shortcut === "string" ? action.shortcut : "", steps: action.steps.filter((step) => step && typeof step.method === "string").map((step) => Object.assign({ enabled: true }, step)) })),
  })) : [];
  try {
    const raw = localStorage.getItem(STORE);
    if (raw !== null) sets = normalize(JSON.parse(raw));
    else sets = [makeSet("Default Actions")];
  } catch (error) { sets = [makeSet("Default Actions")]; }
  const desktop = window.TypeRDesktop && window.TypeRDesktop.actions;
  let diskSave = Promise.resolve();
  const save = () => {
    try { localStorage.setItem(STORE, JSON.stringify(sets)); }
    catch (error) { if (notify) notify(T("Could not save the action library."), true); }
    if (desktop) {
      const snapshot = clone(sets);
      diskSave = diskSave.then(() => desktop.save(snapshot)).catch((error) => {
        if (notify) notify(`${T("Could not save the action library.")} ${error.message || error}`, true);
        return false;
      });
    }
  };
  const allActions = () => sets.flatMap((set) => set.actions);
  const actionById = (id) => allActions().find((action) => action.id === id) || null;
  const setOf = (actionId) => sets.find((set) => set.actions.some((action) => action.id === actionId)) || null;
  const selectedAction = () => actionById(selected.actionId);
  const selectedSet = () => setOf(selected.actionId) || sets.find((set) => set.id === selected.setId) || null;
  const recordingAction = () => actionById(recordingId);

  // A layer id is stable on the original document. Name/kind/index also let an action run on a
  // different page, where the recorded numeric id naturally does not exist.
  const refFor = (id) => {
    const doc = PS.app.doc;
    const index = doc ? doc.state.layers.findIndex((layer) => layer.id === id) : -1;
    if (index < 0) throw new Error("layer not found");
    const layer = doc.state.layers[index];
    return { id: layer.id, name: layer.name, kind: layer.kind, index };
  };
  const resolveRef = (ref) => {
    const doc = PS.app.doc;
    if (!doc || !ref) throw new Error("no document or recorded layer");
    let layer = doc.state.layers.find((item) => item.id === ref.id);
    if (!layer && Number.isInteger(ref.index)) {
      const at = doc.state.layers[ref.index];
      if (at && at.name === ref.name && at.kind === ref.kind) layer = at;
    }
    if (!layer) layer = doc.state.layers.find((item) => item.name === ref.name && item.kind === ref.kind);
    if (!layer) throw new Error(`${T("Layer not found")}: ${ref.name}`);
    return layer.id;
  };
  const plain = (value) => {
    if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") { if (Number.isFinite(value)) return value; throw new Error("non-finite parameter"); }
    if (ArrayBuffer.isView(value)) return { __actionTypedArray: value.constructor.name, data: Array.from(value, plain) };
    if (Array.isArray(value)) return value.map(plain);
    if (typeof value !== "object") throw new Error("non-serializable parameter");
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error("non-serializable parameter");
    const out = {};
    Object.keys(value).forEach((key) => { out[key] = plain(value[key]); });
    return out;
  };
  const unsupported = (error) => {
    if (Date.now() - lastUnsupported < 1200) return;
    lastUnsupported = Date.now();
    if (notify) notify(`${T("This command cannot be recorded")}: ${error.message || error}`, true);
  };
  const encodeArgs = (method, args) => {
    const refs = ID_ARGS[method] || {};
    const encoded = args.map((arg, index) => {
      if (refs[index] === "one") return refFor(arg);
      if (refs[index] === "many") return arg.map(refFor);
      if (COALESCE_ARGS[method] === index) return undefined;
      return plain(arg);
    });
    return encoded;
  };
  const decodeArgs = (method, args) => {
    const refs = ID_ARGS[method] || {};
    return (args || []).map((arg, index) => {
      if (refs[index] === "one") return resolveRef(arg);
      if (refs[index] === "many") return arg.map(resolveRef);
      if (COALESCE_ARGS[method] === index) return undefined;
      return clone(arg);
    });
  };
  const strokeLabel = (fields) => fields.smudge ? "Smudge" : fields.healing ? "Healing Brush" : fields.clone ? "Clone Stamp" : fields.erase ? "Eraser" : fields.target ? "Mask Brush" : "Brush";
  const capture = (method, args) => {
    const action = recordingAction();
    if (!action || playing || !METHODS.has(method)) return;
    try {
      action.steps.push({ method, args: encodeArgs(method, args), label: LABELS[method] || method, enabled: true });
      save(); render();
    } catch (error) { unsupported(error); }
  };
  const captureStroke = () => {
    const action = recordingAction();
    if (!action || !activeStroke || !activeStroke.points.length) { activeStroke = null; return; }
    try {
      action.steps.push({ method: "__stroke", layer: refFor(activeStroke.layerId), fields: plain(activeStroke.fields), points: plain(activeStroke.points), label: strokeLabel(activeStroke.fields), enabled: true });
      save(); render();
    } catch (error) { unsupported(error); }
    activeStroke = null;
  };

  const wrap = () => {
    if (wrapped) return;
    wrapped = true;
    METHODS.forEach((method) => {
      const original = PS.ops[method];
      if (typeof original !== "function") return;
      PS.ops[method] = function (...args) {
        opDepth++;
        let result;
        try { result = original.apply(this, args); }
        finally { opDepth--; }
        // A composite op may call another recordable op. Only the outer command is a step.
        if (!opDepth && recordingAction() && !playing && result !== false && !(result && typeof result.then === "function")) capture(method, args);
        return result;
      };
    });
    const begin = PS.ops.beginStroke;
    PS.ops.beginStroke = function (layerId, fields) {
      const result = begin.call(this, layerId, fields);
      if (result && recordingAction() && !playing) activeStroke = { layerId, fields: clone(fields), points: [] };
      return result;
    };
    const extend = PS.ops.extendStroke;
    PS.ops.extendStroke = function (x, y) {
      const result = extend.call(this, x, y);
      if (activeStroke && recordingAction() && !playing) activeStroke.points.push([x, y]);
      return result;
    };
    const end = PS.ops.endStroke;
    PS.ops.endStroke = function (...args) {
      const result = end.apply(this, args);
      if (activeStroke && recordingAction() && !playing) captureStroke();
      else activeStroke = null;
      return result;
    };
  };

  const runStep = async (step) => {
    if (step.method === "__stroke") {
      const layerId = resolveRef(step.layer);
      if (!PS.ops.beginStroke(layerId, clone(step.fields))) throw new Error(T("The recorded brush cannot paint on this layer"));
      step.points.forEach(([x, y]) => PS.ops.extendStroke(x, y));
      PS.ops.endStroke();
      return;
    }
    if (!METHODS.has(step.method) || typeof PS.ops[step.method] !== "function") throw new Error(`${T("Unknown action step")}: ${step.method}`);
    const result = PS.ops[step.method](...decodeArgs(step.method, step.args));
    if (result && typeof result.then === "function") await result;
    if (result === false) throw new Error(`${T("The step could not run")}: ${T(step.label || step.method)}`);
  };

  const stop = () => {
    if (playing) playToken++;
    playing = false;
    currentStep = null;
    recordingId = null;
    activeStroke = null;
    render();
  };
  const startRecording = (action) => {
    if (playing) return;
    if (recordingId) { if (notify) notify(T("Stop recording first."), true); return; }
    let target = action || selectedAction();
    if (!target) {
      let set = selectedSet();
      if (!set) { set = sets[0] || makeSet("Default Actions"); if (!sets.includes(set)) sets.push(set); }
      target = makeAction(`Action ${allActions().length + 1}`);
      set.actions.push(target);
      selected = { setId: set.id, actionId: target.id };
    }
    recordingId = target.id;
    activeStroke = null;
    save(); render();
  };
  const play = async () => {
    if (playing || recordingId) { if (notify && recordingId) notify(T("Stop recording before playing."), true); return; }
    if (!PS.app.doc) { if (notify) notify(T("Open a document to play an action."), true); return; }
    const one = selectedAction();
    const set = selectedSet();
    const actions = one ? [one] : set ? set.actions : [];
    const jobs = actions.map((action) => ({ action, steps: action.steps.filter((step) => step.enabled !== false) })).filter((job) => job.steps.length);
    if (!jobs.length) { if (notify) notify(T("There are no enabled steps to play."), true); return; }
    const token = ++playToken;
    playing = true; currentStep = null; render();
    let failed = false;
    try {
      for (const job of jobs) {
        for (let index = 0; index < job.action.steps.length; index++) {
          const step = job.action.steps[index];
          if (step.enabled === false) continue;
          if (token !== playToken) return;
          currentStep = { actionId: job.action.id, index }; render();
          try { await runStep(step); }
          catch (error) {
            failed = true;
            if (notify) notify(`${T("Action stopped")}: ${job.action.name} — ${index + 1}: ${error.message || error}`, true);
            break;
          }
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        if (failed || token !== playToken) break;
      }
    } finally {
      if (token === playToken) { playing = false; currentStep = null; render(); }
    }
  };

  /* ------------------------- context menu and keyboard shortcuts ------------------------- */

  let context = null;
  let assigning = false;
  const closeContext = () => { if (context) context.remove(); context = null; };
  const comboOf = (event) => {
    let key = event.key;
    if (/^(Shift|Control|Alt|AltGraph|Meta|OS|Dead|CapsLock|Unidentified)$/.test(key)) return null;
    if (key === "Delete") key = "Backspace";
    if (key === " ") key = "Space";
    if (key.length === 1) {
      const lower = key.toLowerCase();
      if (/^[a-z]$/.test(lower)) key = lower.toUpperCase();
      else if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
      else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
    }
    const parts = [];
    if (event.altKey && !event.getModifierState("AltGraph")) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if ((event.ctrlKey || event.metaKey) && !event.getModifierState("AltGraph")) parts.push("Cmd");
    parts.push(key);
    return parts.join("+");
  };
  const comboLabel = (combo) => combo ? combo.replace(/Cmd/g, "Ctrl") : "";
  const clearOtherShortcuts = (combo, except) => {
    sets.forEach((set) => {
      if (set !== except && set.shortcut === combo) set.shortcut = "";
      set.actions.forEach((action) => { if (action !== except && action.shortcut === combo) action.shortcut = ""; });
    });
  };
  const assignShortcut = async (item, isSet) => {
    if (assigning || playing || recordingId) return;
    assigning = true;
    closeContext();
    const body = document.createElement("div");
    body.className = "actions-assign";
    const instruction = document.createElement("p");
    instruction.textContent = T("Press a key or key combination. Esc cancels.");
    const caps = document.createElement("kbd");
    caps.className = "actions-assign__keys";
    caps.textContent = item.shortcut ? comboLabel(item.shortcut) : T("Press the keys…");
    const problem = document.createElement("p");
    problem.className = "modal__hint";
    problem.setAttribute("role", "status");
    body.append(instruction, caps, problem);
    let chosen = null;
    const onKey = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        const close = $("modal").querySelector(".modal__foot .btn--main");
        if (close) close.click();
        return;
      }
      const combo = comboOf(event);
      if (!combo) return;
      if (/^(Tab|Enter|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(combo)) {
        problem.textContent = T("This key is reserved.");
        return;
      }
      const conflict = window.TypeRApp && window.TypeRApp.shortcutConflict && window.TypeRApp.shortcutConflict(combo);
      if (conflict) {
        caps.textContent = comboLabel(combo);
        problem.textContent = `${T("Already assigned")}: ${conflict}`;
        return;
      }
      chosen = combo;
      item.shortcut = combo;
      clearOtherShortcuts(combo, item);
      save(); render();
      const close = $("modal").querySelector(".modal__foot .btn--main");
      if (close) close.click();
    };
    document.addEventListener("keydown", onKey, true);
    try { await ask({ title: `${T("Assign to Key")}: ${item.name}`, body, ok: T("Cancel"), cancel: false }); }
    finally { document.removeEventListener("keydown", onKey, true); assigning = false; }
    return chosen;
  };
  const showOnDisk = async () => {
    closeContext();
    if (!desktop) { if (notify) notify(T("The Actions folder is available in the desktop application."), true); return; }
    const ok = await desktop.show().catch(() => false);
    if (!ok && notify) notify(T("The Actions folder could not be opened."), true);
  };
  const openContext = (event, item, isSet) => {
    event.preventDefault(); event.stopPropagation();
    selected = isSet ? { setId: item.id, actionId: null } : { setId: setOf(item.id).id, actionId: item.id };
    render(); closeContext();
    const menu = document.createElement("div");
    menu.className = "menu__list menu__list--context actions-context";
    menu.setAttribute("role", "menu");
    const add = (label, action, disabled) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "menu__item"; button.setAttribute("role", "menuitem");
      const text = document.createElement("span"); text.textContent = label; button.appendChild(text);
      button.disabled = Boolean(disabled);
      button.addEventListener("click", action);
      menu.appendChild(button);
    };
    add(T("Assign to Key"), () => assignShortcut(item, isSet), assigning || playing || recordingId);
    if (item.shortcut) add(T("Clear shortcut"), () => { item.shortcut = ""; save(); render(); closeContext(); });
    add(T("Show on Disk"), showOnDisk);
    document.body.appendChild(menu); context = menu;
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8))}px`;
  };
  document.addEventListener("pointerdown", (event) => { if (context && !context.contains(event.target)) closeContext(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeContext(); }, true);
  window.addEventListener("blur", closeContext);
  const matches = (event, combo) => comboOf(event) === combo;
  window.addEventListener("keydown", (event) => {
    if (assigning || event.repeat || event.defaultPrevented || $("modal").open) return;
    const active = document.activeElement;
    if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
    for (const set of sets) {
      if (matches(event, set.shortcut)) {
        event.preventDefault(); event.stopImmediatePropagation();
        selected = { setId: set.id, actionId: null }; render(); void play(); return;
      }
      const action = set.actions.find((item) => matches(event, item.shortcut));
      if (action) {
        event.preventDefault(); event.stopImmediatePropagation();
        selected = { setId: set.id, actionId: action.id }; render(); void play(); return;
      }
    }
  }, true);

  const newSet = async () => {
    const answer = await ask({ title: T("New set"), fields: [{ id: "name", label: T("Name"), value: `Set ${sets.length + 1}` }] });
    if (!answer || !answer.name.trim()) return;
    const set = makeSet(answer.name.trim());
    sets.push(set); selected = { setId: set.id, actionId: null };
    save(); render();
  };
  const newAction = async () => {
    if (!sets.length) sets.push(makeSet("Default Actions"));
    const set = selectedSet() || sets[0];
    const answer = await ask({
      title: T("New Action"),
      fields: [
        { id: "name", label: T("Name"), value: `Action ${allActions().length + 1}` },
        { id: "set", label: T("Set"), value: set.id, options: sets.map((item) => [item.id, item.name]) },
      ],
    });
    if (!answer || !answer.name.trim()) return;
    const action = makeAction(answer.name.trim());
    const target = sets.find((item) => item.id === answer.set) || set;
    target.actions.push(action); selected = { setId: target.id, actionId: action.id };
    save(); startRecording(action);
  };
  const remove = async () => {
    if (recordingId || playing) return;
    const action = selectedAction();
    if (action) {
      const answer = await ask({ title: T("Delete Action"), body: `${T("Delete")} “${action.name}”?` });
      if (!answer) return;
      const set = setOf(action.id);
      set.actions = set.actions.filter((item) => item.id !== action.id);
      selected = { setId: set.id, actionId: null };
    } else {
      const set = selectedSet();
      if (!set) return;
      const answer = await ask({ title: T("Delete Set"), body: `${T("Delete")} “${set.name}”?` });
      if (!answer) return;
      sets = sets.filter((item) => item.id !== set.id);
      selected = { setId: null, actionId: null };
    }
    save(); render();
  };
  const rename = async (item, isSet) => {
    const answer = await ask({ title: T(isSet ? "Rename Set" : "Rename Action"), fields: [{ id: "name", label: T("Name"), value: item.name }] });
    if (!answer || !answer.name.trim()) return;
    item.name = answer.name.trim(); save(); render();
  };

  const showSelection = () => {
    document.querySelectorAll(".actions-set > summary").forEach((row) => row.classList.toggle("is-selected", !selected.actionId && selected.setId === row.parentElement.dataset.set));
    document.querySelectorAll(".actions-action > summary").forEach((row) => row.classList.toggle("is-selected", selected.actionId === row.parentElement.dataset.action));
  };
  const activateSummary = (event, choose) => {
    // A details summary otherwise toggles from its whole row. Only the triangle at the left
    // changes disclosure; choosing an action by its name leaves every branch exactly as it was.
    event.preventDefault();
    const row = event.currentTarget;
    const details = row.parentElement;
    const box = row.getBoundingClientRect();
    if (event.detail === 0 || (event.clientX >= box.left && event.clientX <= box.left + 18)) details.open = !details.open;
    choose();
    showSelection();
  };
  const render = () => {
    const list = $("actions-list");
    if (!list) return;
    list.textContent = "";
    if (!sets.length) {
      const empty = document.createElement("p"); empty.className = "actions-empty"; empty.textContent = T("No sets or actions yet"); list.appendChild(empty);
    }
    sets.forEach((set) => {
      const group = document.createElement("details"); group.className = "actions-set"; group.open = disclosure.get(`set:${set.id}`) !== false; group.dataset.set = set.id;
      group.addEventListener("toggle", () => disclosure.set(`set:${set.id}`, group.open));
      const summary = document.createElement("summary");
      summary.classList.toggle("is-selected", !selected.actionId && selected.setId === set.id);
      const folder = document.createElement("span"); folder.textContent = "▰";
      const name = document.createElement("span"); name.className = "actions-set__name"; name.textContent = set.name; name.title = name.textContent;
      const count = document.createElement("span"); count.className = "actions-count"; count.textContent = String(set.actions.length);
      summary.append(folder, name);
      if (set.shortcut) { const keys = document.createElement("kbd"); keys.className = "actions-shortcut"; keys.textContent = comboLabel(set.shortcut); summary.appendChild(keys); }
      summary.appendChild(count);
      summary.addEventListener("click", (event) => activateSummary(event, () => { selected = { setId: set.id, actionId: null }; }));
      summary.addEventListener("dblclick", (event) => { event.preventDefault(); rename(set, true); });
      summary.addEventListener("contextmenu", (event) => openContext(event, set, true));
      group.appendChild(summary);
      set.actions.forEach((action) => {
        const branch = document.createElement("details"); branch.className = "actions-action"; branch.open = disclosure.get(`action:${action.id}`) !== false; branch.dataset.action = action.id;
        branch.addEventListener("toggle", () => disclosure.set(`action:${action.id}`, branch.open));
        const head = document.createElement("summary"); head.classList.toggle("is-selected", selected.actionId === action.id);
        const actionName = document.createElement("span"); actionName.className = "actions-action__name"; actionName.textContent = action.id === recordingId ? `● ${action.name}` : action.name; actionName.title = action.name;
        const steps = document.createElement("span"); steps.className = "actions-count"; steps.textContent = String(action.steps.length);
        head.append(actionName);
        if (action.shortcut) { const keys = document.createElement("kbd"); keys.className = "actions-shortcut"; keys.textContent = comboLabel(action.shortcut); head.appendChild(keys); }
        head.appendChild(steps);
        head.addEventListener("click", (event) => activateSummary(event, () => { selected = { setId: set.id, actionId: action.id }; }));
        head.addEventListener("dblclick", (event) => { event.preventDefault(); rename(action, false); });
        head.addEventListener("contextmenu", (event) => openContext(event, action, false));
        branch.appendChild(head);
        action.steps.forEach((step, index) => {
          const row = document.createElement("label"); row.className = "actions-step";
          row.classList.toggle("is-off", step.enabled === false);
          row.classList.toggle("is-current", Boolean(currentStep && currentStep.actionId === action.id && currentStep.index === index));
          const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = step.enabled !== false; enabled.setAttribute("aria-label", `${T("Enabled")}: ${T(step.label || step.method)}`);
          enabled.addEventListener("change", () => { step.enabled = enabled.checked; save(); render(); });
          const label = document.createElement("span"); label.className = "actions-step__label"; label.textContent = T(step.label || step.method); label.title = label.textContent;
          row.append(enabled, label); branch.appendChild(row);
        });
        group.appendChild(branch);
      });
      list.appendChild(group);
    });
    const status = $("actions-status");
    status.hidden = !recordingId && !playing;
    status.classList.toggle("is-recording", Boolean(recordingId));
    const recording = recordingAction();
    status.textContent = recording ? `${T("Recording")}: ${recording.name} (${recording.steps.length})` : playing ? T("Playing…") : "";
    $("actions-record").classList.toggle("is-on", Boolean(recordingId));
    $("actions-record").disabled = playing;
    $("actions-stop").disabled = !recordingId && !playing;
    $("actions-play").disabled = playing || Boolean(recordingId) || !PS.app.doc;
    $("actions-new").disabled = playing || Boolean(recordingId);
    $("actions-new-set").disabled = playing;
    $("actions-delete").disabled = playing || Boolean(recordingId) || (!selectedAction() && !selectedSet());
  };

  const init = async ({ translate, dialog, toast }) => {
    T = translate; ask = dialog; notify = toast;
    $("head-actions").textContent = T("Actions");
    const labels = { "actions-stop": "Stop recording", "actions-record": "Begin recording", "actions-play": "Play selection", "actions-new-set": "New set", "actions-new": "New Action", "actions-delete": "Delete" };
    Object.entries(labels).forEach(([id, label]) => { $(id).title = T(label); $(id).setAttribute("aria-label", T(label)); });
    $("actions-stop").addEventListener("click", stop);
    $("actions-record").addEventListener("click", () => recordingId ? stop() : startRecording());
    $("actions-play").addEventListener("click", play);
    $("actions-new-set").addEventListener("click", newSet);
    $("actions-new").addEventListener("click", newAction);
    $("actions-delete").addEventListener("click", remove);
    PS.on((type) => { if (type === "document") render(); });
    wrap(); render();
    if (desktop) {
      const before = JSON.stringify(sets);
      try {
        const stored = await desktop.load();
        // A click made while the file was being read is never overwritten by the older disk state.
        if (before === JSON.stringify(sets) && Array.isArray(stored)) { sets = normalize(stored); render(); }
        else if (stored === null) save(); // migrate the browser library on the first desktop run
      } catch (error) { if (notify) notify(`${T("Could not read the action library.")}: ${error.message || error}`, true); }
    }
  };

  window.TypeRActions = {
    init, play, stop, startRecording, runStep,
    get sets() { return sets; },
    get recording() { return recordingAction(); },
    get playing() { return playing; },
  };
})();
