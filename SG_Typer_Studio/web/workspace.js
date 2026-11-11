// The workspace, arranged as you like: each panel can be dragged by its title bar into a
// column or out of it, where it floats and resizes. The panels never change place in the
// page's HTML, they only get coordinates: moving TypeR's iframe in the HTML would reload it.
// Phones and tablets have their own arrangement (touch.js): here, every panel just stays ready.

(function () {
  "use strict";

  const PS = window.TypeRPhotoshop;
  const $ = (id) => document.getElementById(id);
  const STORE = "typer.web.layout";
  const SPLIT = 4;
  const TOOLS = 42;
  const HEAD = 26;
  const MIN_DOCS = 320;
  const ELEMENTS = { tools: "tools", typer: "dock-typer", navigator: "pane-navigator", styles: "pane-styles", brushes: "pane-brushes", actions: "pane-actions", layers: "pane-layers", character: "pane-character", sfx: "pane-sfx", breaks: "breaks", history: "pane-history" };
  const PANELS = ["typer", "navigator", "styles", "brushes", "actions", "layers", "character", "sfx", "breaks", "history"];
  const SIDE = ["navigator", "styles", "brushes", "actions", "layers", "character", "sfx", "breaks", "history"];
  const COLUMNS = ["left", "middle", "right"];
  const MIN = { tools: [42, 42], typer: [280, 260], navigator: [180, 150], styles: [180, 150], brushes: [210, 180], actions: [190, 130], layers: [170, 90], character: [210, 130], sfx: [230, 160], breaks: [210, 120], history: [150, 80] };
  const Shell = window.TypeRShell;
  const work = $("work");
  const docs = work.querySelector(".docs");
  const element = (id) => $(ELEMENTS[id]);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  /* ------------------------------- the arrangement ------------------------------ */

  const fresh = () => ({
    version: 1,
    tools: "left",
    columns: { left: { width: 250, panels: [] }, middle: { width: 360, panels: ["typer"] }, right: { width: 250, panels: ["navigator", "styles", "brushes", "actions", "layers", "character", "sfx", "breaks", "history"] } },
    heights: { typer: 600, navigator: 220, styles: 290, brushes: 340, actions: 240, layers: 290, character: 240, sfx: 420, breaks: 290, history: 180 },
    // The SFX panel comes with the SFX tool; Actions opens from Window when it is needed.
    hidden: { history: true, sfx: true, brushes: true, actions: true },
    floating: {},
    // A docked tab group's leader is its entry in a column. The other panels share its rectangle.
    tabs: {},
    order: [],
    dockOf: {},
    sideShown: null,
  });

  const load = () => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORE));
      if (!saved || saved.version !== 1) return fresh();
      const layout = Object.assign(fresh(), saved);
      layout.tabs = {};
      // Validate tab groups before placing their leaders. A damaged layout must never duplicate
      // a panel or make the only visible copy of one disappear.
      const memberOf = {};
      const claimed = new Set(Object.keys(layout.floating));
      Object.entries(saved.tabs || {}).forEach(([leader, group]) => {
        if (!PANELS.includes(leader) || claimed.has(leader) || !group || !Array.isArray(group.panels)) return;
        const panels = group.panels.filter((id) => {
          if (!PANELS.includes(id) || claimed.has(id)) return false;
          claimed.add(id);
          return true;
        });
        if (!panels.includes(leader) || panels.length < 2) return;
        layout.tabs[leader] = { panels, active: panels.includes(group.active) ? group.active : leader };
        panels.forEach((id) => { memberOf[id] = leader; });
      });
      // Every panel in exactly one place, whatever a file from another version says.
      const seen = new Set(Object.keys(layout.floating));
      COLUMNS.forEach((name) => {
        layout.columns[name].panels = layout.columns[name].panels.filter((id) => {
          if (!PANELS.includes(id) || seen.has(id) || (memberOf[id] && memberOf[id] !== id)) return false;
          seen.add(id);
          if (layout.tabs[id]) layout.tabs[id].panels.forEach((item) => seen.add(item));
          return true;
        });
      });
      // A group whose leader was lost becomes ordinary panels again.
      Object.keys(layout.tabs).forEach((leader) => { if (!seen.has(leader)) delete layout.tabs[leader]; });
      PANELS.forEach((id) => {
        if (seen.has(id)) return;
        if (id === "navigator" || id === "styles" || id === "brushes" || id === "actions") {
          const at = layout.columns.right.panels.indexOf("layers");
          layout.columns.right.panels.splice(at < 0 ? layout.columns.right.panels.length : at, 0, id);
        } else layout.columns.right.panels.push(id);
        seen.add(id);
        // Panels added after an old layout was saved keep their initial visibility.
        if (id === "sfx" || id === "brushes" || id === "actions") layout.hidden = Object.assign({}, layout.hidden, { [id]: true });
        if (!layout.heights[id]) layout.heights = Object.assign({}, layout.heights, { [id]: fresh().heights[id] });
      });
      return layout;
    } catch (error) {
      return fresh();
    }
  };

  let layout = load();
  const save = () => {
    try {
      window.localStorage.setItem(STORE, JSON.stringify(layout));
    } catch (error) {
      console.warn("SG Typer Studio: could not keep the workspace", error);
    }
  };

  /* --------------------------------- drawing it --------------------------------- */

  let T = (text) => text;
  let geometry = { columns: {}, docs: null, width: 0, height: 0 };
  const POSITION = ["left", "top", "width", "height", "zIndex"];
  const place = (el, x, y, w, h) => {
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.width = `${Math.round(w)}px`;
    el.style.height = `${Math.round(h)}px`;
  };

  const leaderOf = (id) => Object.keys(layout.tabs).find((leader) => layout.tabs[leader].panels.includes(id));
  const activeIn = (leader) => {
    const group = layout.tabs[leader];
    if (!group) return leader;
    const shown = group.panels.filter((id) => !layout.hidden[id]);
    if (shown.length && !shown.includes(group.active)) group.active = shown[0];
    return group.active;
  };
  const shownIn = (name) => layout.columns[name].panels.filter((id) => layout.tabs[id] ? layout.tabs[id].panels.some((item) => !layout.hidden[item]) : !layout.hidden[id]);

  // Everything that follows a drag runs on the window: the splitters are drawn again as they move
  const dragging = (event, onMove, onEnd) => {
    work.classList.add("is-arranging");
    event.preventDefault();
    const stop = (next) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      work.classList.remove("is-arranging");
      if (onEnd) onEnd(next);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const addSplit = (kind, x, y, w, h, onDown) => {
    const split = document.createElement("div");
    split.className = `ws-split ws-split--${kind}`;
    place(split, x, y, w, h);
    split.addEventListener("pointerdown", onDown);
    work.appendChild(split);
  };

  const widthSplit = (name, sign) => (event) => {
    const start = event.clientX;
    const from = geometry.columns[name].w;
    const least = Math.max(...shownIn(name).map((id) => MIN[id][0]));
    dragging(event, (next) => {
      layout.columns[name].width = clamp(from + sign * (next.clientX - start), least, 900);
      apply();
    }, save);
  };

  const heightSplit = (name, above, below) => (event) => {
    const start = event.clientY;
    const parts = geometry.columns[name].parts;
    parts.forEach((part) => { layout.heights[part.id] = part.h; });
    const a = parts.find((part) => part.id === above).h;
    const b = parts.find((part) => part.id === below).h;
    dragging(event, (next) => {
      const moved = clamp(next.clientY - start, MIN[above][1] - a, b - MIN[below][1]);
      layout.heights[above] = a + moved;
      layout.heights[below] = b - moved;
      apply();
    }, save);
  };

  const addTabs = (leader, ids, x, y, w) => {
    const strip = document.createElement("div");
    strip.className = "ws-tabs";
    strip.setAttribute("role", "tablist");
    place(strip, x, y, w, HEAD);
    const active = activeIn(leader);
    ids.forEach((id) => {
      const tab = document.createElement("div");
      tab.className = "ws-tab";
      tab.dataset.panel = id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(id === active));
      tab.tabIndex = id === active ? 0 : -1;
      const title = element(id).querySelector(".dock__head > span");
      const label = document.createElement("span");
      label.textContent = title ? title.textContent : id;
      tab.appendChild(label);
      const close = document.createElement("button");
      close.type = "button";
      close.className = "ws-tab__close";
      close.textContent = "×";
      close.title = T("Close");
      close.setAttribute("aria-label", `${T("Close")} ${label.textContent}`);
      close.addEventListener("pointerdown", (event) => event.stopPropagation());
      close.addEventListener("click", (event) => { event.stopPropagation(); setVisible(id, false); });
      tab.appendChild(close);
      tab.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button")) return;
        if (activeIn(leader) !== id) {
          layout.tabs[leader].active = id;
          apply();
        }
        startMove(id, element(id), event);
      });
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        layout.tabs[leader].active = id;
        apply(); save();
      });
      strip.appendChild(tab);
    });
    work.appendChild(strip);
  };

  const stack = (name, x, w, top, height) => {
    const ids = shownIn(name);
    const room = height - SPLIT * (ids.length - 1);
    const sum = ids.reduce((total, id) => total + layout.heights[id], 0);
    const parts = [];
    let y = top;
    ids.forEach((id, index) => {
      const last = index === ids.length - 1;
      const h = last ? top + height - y : Math.round((layout.heights[id] / sum) * room);
      const group = layout.tabs[id];
      const members = group ? group.panels.filter((item) => !layout.hidden[item]) : [id];
      members.forEach((item) => {
        const el = element(item);
        el.classList.remove("is-floating");
        el.classList.toggle("is-tabbed", Boolean(group));
        el.style.zIndex = "";
        place(el, x, y + (group ? HEAD : 0), w, h - (group ? HEAD : 0));
      });
      if (group) addTabs(id, members, x, y, w);
      parts.push({ id, y, h, tabs: group ? members : null });
      y += h;
      if (!last) {
        addSplit("h", x, y, w, SPLIT, heightSplit(name, id, ids[index + 1]));
        y += SPLIT;
      }
    });
    geometry.columns[name] = { x, w, parts };
  };

  const apply = () => {
    const touch = Shell.touch;
    work.classList.toggle("is-custom", !touch);
    PANELS.forEach((id) => {
      const leader = leaderOf(id);
      element(id).hidden = !touch && (Boolean(layout.hidden[id]) || Boolean(leader && activeIn(leader) !== id));
    });
    work.querySelectorAll(".ws-split, .ws-tabs").forEach((split) => split.remove());
    if (touch) {
      Object.keys(ELEMENTS).map(element).concat(docs).forEach((el) => {
        POSITION.forEach((key) => { el.style[key] = ""; });
        el.classList.remove("is-floating", "is-tabbed");
      });
      PS.announce("workspace");
      return;
    }
    const W = work.clientWidth;
    const H = work.clientHeight;
    geometry = { columns: {}, docs: null, width: W, height: H };

    let from = 0;
    let to = W;
    let top = 0;
    let bottom = H;
    const tools = element("tools");
    tools.dataset.place = layout.tools;
    tools.classList.toggle("is-floating", layout.tools === "float");
    // At the top or the bottom, the tools lie in a row across the whole window
    tools.setAttribute("aria-orientation", layout.tools === "top" || layout.tools === "bottom" ? "horizontal" : "vertical");
    if (layout.tools !== "float") tools.style.zIndex = "";
    if (layout.tools === "left") {
      place(tools, 0, 0, TOOLS, H);
      from = TOOLS;
    } else if (layout.tools === "right") {
      place(tools, W - TOOLS, 0, TOOLS, H);
      to = W - TOOLS;
    } else if (layout.tools === "top") {
      place(tools, 0, 0, W, TOOLS);
      top = TOOLS;
    } else if (layout.tools === "bottom") {
      place(tools, 0, H - TOOLS, W, TOOLS);
      bottom = H - TOOLS;
    }
    const tall = bottom - top;
    geometry.top = top;
    geometry.bottom = bottom;

    // Columns give way before the page does
    const wanted = COLUMNS.map((name) => (shownIn(name).length ? layout.columns[name].width : 0));
    const total = wanted.reduce((sum, width) => sum + (width ? width + SPLIT : 0), 0);
    const room = to - from - MIN_DOCS;
    const ratio = total > room && total > 0 ? Math.max(0.3, room / total) : 1;
    const [leftW, middleW, rightW] = wanted.map((width) => Math.round(width * ratio));
    let docsFrom = from;
    let docsTo = to;
    if (leftW) {
      stack("left", from, leftW, top, tall);
      addSplit("v", from + leftW, top, SPLIT, tall, widthSplit("left", 1));
      docsFrom = from + leftW + SPLIT;
    }
    if (rightW) {
      stack("right", to - rightW, rightW, top, tall);
      addSplit("v", to - rightW - SPLIT, top, SPLIT, tall, widthSplit("right", -1));
      docsTo = to - rightW - SPLIT;
    }
    if (middleW) {
      stack("middle", docsTo - middleW, middleW, top, tall);
      addSplit("v", docsTo - middleW - SPLIT, top, SPLIT, tall, widthSplit("middle", -1));
      docsTo = docsTo - middleW - SPLIT;
    }
    place(docs, docsFrom, top, docsTo - docsFrom, tall);
    geometry.docs = { x: docsFrom, w: docsTo - docsFrom };
    geometry.to = to;

    layout.order = layout.order.filter((id) => layout.floating[id]);
    Object.keys(layout.floating).forEach((id) => {
      if (!layout.order.includes(id)) layout.order.push(id);
    });
    layout.order.forEach((id, index) => {
      if (layout.hidden[id]) return;
      const rect = layout.floating[id];
      const w = Math.min(rect.w, W);
      const h = Math.min(rect.h, H);
      const el = element(id);
      el.classList.add("is-floating");
      el.style.zIndex = 12 + index;
      place(el, clamp(rect.x, 80 - w, W - 80), clamp(rect.y, 0, H - HEAD), w, h);
    });

    PANELS.forEach((id) => {
      const button = element(id).querySelector(".dock__float");
      if (!button) return;
      const floating = Boolean(layout.floating[id]);
      button.classList.toggle("is-on", floating);
      button.title = T(floating ? "Dock" : "Detach");
      button.setAttribute("aria-label", button.title);
    });
    PS.announce("workspace");
  };

  /* ------------------------------- moving a panel ------------------------------- */

  const hintBox = document.createElement("div");
  hintBox.className = "ws-hint";
  hintBox.hidden = true;

  const removeFromColumns = (id) => {
    const oldLeader = leaderOf(id);
    if (oldLeader) {
      const old = layout.tabs[oldLeader];
      const remaining = old.panels.filter((item) => item !== id);
      COLUMNS.forEach((name) => {
        const panels = layout.columns[name].panels;
        const at = panels.indexOf(oldLeader);
        if (at < 0) return;
        layout.dockOf[id] = name;
        if (id === oldLeader && remaining.length) panels[at] = remaining[0];
      });
      delete layout.tabs[oldLeader];
      if (remaining.length > 1) {
        const leader = remaining[0];
        layout.tabs[leader] = { panels: remaining, active: remaining.includes(old.active) && old.active !== id ? old.active : leader };
      }
    }
    COLUMNS.forEach((name) => {
      const column = layout.columns[name];
      if (column.panels.includes(id)) {
        layout.dockOf[id] = name;
        column.panels = column.panels.filter((item) => item !== id);
      }
    });
  };

  const raise = (id) => {
    if (!layout.floating[id]) return;
    layout.order = layout.order.filter((item) => item !== id).concat(id);
  };

  // Where a dropped panel would go: onto a title as a tab, between two panels of a column,
  // or into an empty column at the edge of the page. Anywhere else it floats, even over a panel.
  const dropTarget = (id, x, y) => {
    const H = geometry.height;
    const W = geometry.width;
    if (id === "tools") {
      if (x < 56) return { tools: "left", rect: { x: 0, y: 0, w: TOOLS, h: H } };
      if (x > W - 56) return { tools: "right", rect: { x: W - TOOLS, y: 0, w: TOOLS, h: H } };
      if (y < 40) return { tools: "top", rect: { x: 0, y: 0, w: W, h: TOOLS } };
      if (y > H - 40) return { tools: "bottom", rect: { x: 0, y: H - TOOLS, w: W, h: TOOLS } };
      return null;
    }
    const top = geometry.top || 0;
    const bottom = geometry.bottom || H;
    const edge = 36;
    const emptyOf = (name) => !geometry.columns[name] || !geometry.columns[name].parts.some((part) => part.id !== id);
    if (emptyOf("left") && !geometry.columns.left && x >= geometry.docs.x && x < geometry.docs.x + edge) {
      return { column: "left", before: null, rect: { x: geometry.docs.x, y: top, w: edge, h: bottom - top } };
    }
    if (!geometry.columns.right && x > geometry.to - edge) return { column: "right", before: null, rect: { x: geometry.to - edge, y: top, w: edge, h: bottom - top } };
    if (!geometry.columns.middle && x > geometry.docs.x + geometry.docs.w - edge && x <= geometry.docs.x + geometry.docs.w) {
      return { column: "middle", before: null, rect: { x: geometry.docs.x + geometry.docs.w - edge, y: top, w: edge, h: bottom - top } };
    }
    for (const name of COLUMNS) {
      const column = geometry.columns[name];
      if (!column || x < column.x || x > column.x + column.w) continue;
      // The title row is a tab drop target, not another horizontal split. Dropping beside a
      // module joins its group; dropping out of the row keeps the existing above/below docking.
      for (const part of column.parts) {
        if (y < part.y - 5 || y > part.y + HEAD + 5) continue;
        const tabs = part.tabs || [part.id];
        const at = Math.max(0, Math.min(tabs.length - 1, Math.floor((x - column.x) / column.w * tabs.length)));
        return { column: name, tab: part.id, before: tabs[at], rect: { x: column.x, y: part.y, w: column.w, h: HEAD } };
      }
      const parts = column.parts.filter((part) => part.id !== id);
      if (!parts.length) return { column: name, before: null, rect: { x: column.x, y: top, w: column.w, h: bottom - top } };
      for (let index = 0; index <= parts.length; index++) {
        const at = index < parts.length ? parts[index].y : bottom;
        if (Math.abs(y - at) <= 30) return { column: name, before: index < parts.length ? parts[index].id : null, rect: { x: column.x, y: clamp(at - 3, top, bottom - 6), w: column.w, h: 6 } };
      }
    }
    return null;
  };

  const settle = (id, target, rect) => {
    if (id === "tools") {
      if (target) {
        layout.tools = target.tools;
        delete layout.floating.tools;
      } else {
        // Out of its strip it's only as tall as its tools
        if (layout.tools !== "float") {
          element("tools").style.height = "auto";
          rect.h = Math.min(rect.h, element("tools").offsetHeight);
        }
        layout.tools = "float";
        layout.floating.tools = rect;
        raise(id);
      }
      return;
    }
    const wasFloating = Boolean(layout.floating[id]);
    // Letting a standalone panel go over its own title changes nothing; in particular it must
    // not manufacture a two-entry group containing the same panel twice.
    if (target && target.tab === id && !leaderOf(id)) return;
    if (target && target.tab && target.tab === leaderOf(id)) {
      const group = layout.tabs[target.tab];
      const rest = group.panels.filter((item) => item !== id);
      const at = target.before ? rest.indexOf(target.before) : -1;
      rest.splice(at < 0 ? rest.length : at, 0, id);
      group.panels = rest;
      group.active = id;
      return;
    }
    removeFromColumns(id);
    delete layout.floating[id];
    if (!target) {
      // Out of a column: small enough for its bottom edge to be within reach
      if (!wasFloating) rect.h = Math.min(rect.h, Math.round(geometry.height * 0.8));
      layout.floating[id] = rect;
      raise(id);
      return;
    }
    if (target.tab) {
      if (!layout.tabs[target.tab]) layout.tabs[target.tab] = { panels: [target.tab], active: id };
      const group = layout.tabs[target.tab];
      const at = target.before ? group.panels.indexOf(target.before) : -1;
      group.panels.splice(at < 0 ? group.panels.length : at, 0, id);
      group.active = id;
      layout.dockOf[id] = target.column;
      return;
    }
    const panels = layout.columns[target.column].panels;
    const at = target.before ? panels.indexOf(target.before) : -1;
    panels.splice(at < 0 ? panels.length : at, 0, id);
  };

  const startMove = (id, el, event) => {
    if (Shell.touch || event.button !== 0) return;
    const box = el.getBoundingClientRect();
    const area = work.getBoundingClientRect();
    let grabX = event.clientX - box.left;
    let grabY = event.clientY - box.top;
    const startX = event.clientX;
    const startY = event.clientY;
    let lifted = false;
    let target = null;
    dragging(event, (next) => {
      if (!lifted) {
        if (Math.hypot(next.clientX - startX, next.clientY - startY) < 4) return;
        lifted = true;
        el.classList.add("is-moving");
        el.style.zIndex = 40;
        // Out of a row, the tools stand upright again, held by their grip
        if (id === "tools" && (layout.tools === "top" || layout.tools === "bottom")) {
          el.dataset.place = "float";
          el.setAttribute("aria-orientation", "vertical");
          el.style.width = `${TOOLS}px`;
          el.style.height = "auto";
          grabX = TOOLS / 2;
          grabY = 5;
        }
      }
      el.style.left = `${next.clientX - area.left - grabX}px`;
      el.style.top = `${clamp(next.clientY - area.top - grabY, 0, area.height - HEAD)}px`;
      target = dropTarget(id, next.clientX - area.left, next.clientY - area.top);
      hintBox.hidden = !target;
      if (target) place(hintBox, target.rect.x, target.rect.y, target.rect.w, target.rect.h);
    }, () => {
      hintBox.hidden = true;
      el.classList.remove("is-moving");
      if (lifted) settle(id, target, { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.offsetWidth, h: el.offsetHeight });
      else raise(id);
      apply();
      save();
    });
  };

  const EDGES = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];
  const startResize = (id, el, edge, event) => {
    const rect = Object.assign({}, layout.floating[id]);
    const startX = event.clientX;
    const startY = event.clientY;
    const [minW, minH] = MIN[id];
    dragging(event, (next) => {
      const dx = next.clientX - startX;
      const dy = next.clientY - startY;
      const out = Object.assign({}, rect);
      if (edge.includes("e")) out.w = Math.max(minW, rect.w + dx);
      if (edge.includes("s")) out.h = Math.max(minH, rect.h + dy);
      if (edge.includes("w")) {
        out.w = Math.max(minW, rect.w - dx);
        out.x = rect.x + rect.w - out.w;
      }
      if (edge.includes("n")) {
        out.h = Math.max(minH, rect.h - dy);
        out.y = rect.y + rect.h - out.h;
      }
      layout.floating[id] = out;
      apply();
    }, save);
  };

  /* ------------------------------- what the app asks ------------------------------ */

  const toggleFloat = (id) => {
    const el = element(id);
    if (layout.floating[id]) {
      delete layout.floating[id];
      layout.columns[layout.dockOf[id] || "right"].panels.push(id);
    } else {
      const box = el.getBoundingClientRect();
      const area = work.getBoundingClientRect();
      removeFromColumns(id);
      const w = Math.max(box.width, id === "breaks" ? 340 : 0);
      const h = Math.min(box.height, Math.round(area.height * 0.8));
      layout.floating[id] = { x: clamp(box.left - area.left - 24, 0, area.width - w - 8), y: clamp(box.top - area.top + 24, 0, area.height - h - 8), w, h };
      raise(id);
    }
    apply();
    save();
  };

  const isVisible = (id) => !layout.hidden[id];
  const setVisible = (id, shown) => {
    layout.hidden[id] = !shown;
    const leader = leaderOf(id);
    if (leader && shown) layout.tabs[leader].active = id;
    apply();
    save();
  };
  const toggle = (id) => setVisible(id, !isVisible(id));

  // All the panels but TypeR at once, and back to what was shown
  const sideVisible = () => SIDE.some(isVisible);
  const toggleSide = () => {
    if (sideVisible()) {
      layout.sideShown = SIDE.filter(isVisible);
      SIDE.forEach((id) => { layout.hidden[id] = true; });
    } else {
      (layout.sideShown || ["layers", "character", "breaks"]).forEach((id) => { layout.hidden[id] = false; });
    }
    apply();
    save();
  };

  const reset = () => {
    layout = fresh();
    try {
      window.localStorage.removeItem(STORE);
    } catch (error) {
      console.warn("SG Typer Studio: could not reset the workspace", error);
    }
    apply();
  };

  const FLOAT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.500" y="2.500" width="8" height="8"/><path d="M2.500 5.500v8h8"/></svg>';

  const init = (translate) => {
    T = translate;
    work.appendChild(hintBox);
    PANELS.forEach((id) => {
      const el = element(id);
      const head = el.querySelector(".dock__head");
      const actions = document.createElement("span");
      actions.className = "dock__actions";
      const float = document.createElement("button");
      float.type = "button";
      float.className = "dock__float";
      float.innerHTML = FLOAT_ICON;
      float.addEventListener("click", () => toggleFloat(id));
      const close = document.createElement("button");
      close.type = "button";
      close.className = "tab__close";
      close.textContent = "×";
      close.title = T("Close");
      close.setAttribute("aria-label", T("Close"));
      close.addEventListener("click", () => setVisible(id, false));
      actions.append(float, close);
      head.appendChild(actions);
      head.addEventListener("pointerdown", (event) => {
        if (!event.target.closest("button, select, input")) startMove(id, el, event);
      });
    });
    const tools = element("tools");
    const grip = document.createElement("div");
    grip.className = "tools__grip";
    tools.insertBefore(grip, tools.firstChild);
    grip.addEventListener("pointerdown", (event) => startMove("tools", tools, event));
    Object.keys(ELEMENTS).forEach((id) => {
      const el = element(id);
      EDGES.forEach((edge) => {
        const handle = document.createElement("div");
        handle.className = `ws-grip ws-grip--${edge}`;
        handle.addEventListener("pointerdown", (event) => {
          if (layout.floating[id]) startResize(id, el, edge, event);
        });
        el.appendChild(handle);
      });
      el.addEventListener("pointerdown", () => {
        if (!layout.floating[id] || layout.order[layout.order.length - 1] === id) return;
        raise(id);
        layout.order.forEach((item, index) => { element(item).style.zIndex = 12 + index; });
      }, true);
    });
    let waiting = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(waiting);
      waiting = requestAnimationFrame(apply);
    }).observe(work);
    Shell.onChange(apply);
    apply();
  };

  window.TypeRWorkspace = { init, apply, isVisible, toggle, setVisible, sideVisible, toggleSide, toggleFloat, reset };
})();
