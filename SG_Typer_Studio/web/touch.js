// The interface for fingers, on phones and tablets. The page takes the screen and the work is
// a loop: tap a bubble, the line goes in, adjust it, tap the next one. So the current line is
// always in view, what can be done to the selected text sits just above it, and the panels
// slide over part of the page, which stays live behind them.
//
// Nothing here is a second TypeR: the panel in the iframe and the side panes are the desktop's
// own, placed one at a time (touch.css). What isn't theirs is read from the panel's storage
// and asked of its buttons.

(function () {
  "use strict";

  const PS = window.TypeRPhotoshop;
  const App = window.TypeRApp;
  const Shell = window.TypeRShell;
  const Kit = window.TypeRKit;
  const Fonts = window.TypeRFonts;
  const { app, ops } = PS;
  const { T, fill, ICON, toast } = App;
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const frame = $("panel-frame");
  const stage = $("stage");

  const el = (tag, className, props, ...children) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.assign(node, props || {});
    node.append(...children.filter((child) => child !== null && child !== undefined));
    return node;
  };
  const button = (className, icon, label, action, showLabel) => {
    const node = el("button", className, { type: "button" });
    if (icon) node.innerHTML = ICON[icon] || icon;
    if (showLabel) node.append(el("span", "", { textContent: label }));
    else {
      node.title = label;
      node.setAttribute("aria-label", label);
    }
    if (action) node.addEventListener("click", action);
    return node;
  };
  // Held down, it goes on: a text is rarely one pixel away from its place
  const repeating = (node, run) => {
    let timer = 0;
    let repeated = false;
    const stop = () => clearTimeout(timer);
    // Nothing happens before the finger lifts or stays: it may only be scrolling the row
    node.addEventListener("pointerdown", (event) => {
      repeated = false;
      const again = () => {
        repeated = true;
        run();
        timer = setTimeout(again, 70);
      };
      timer = setTimeout(again, 380);
    });
    node.addEventListener("pointerup", () => {
      stop();
      if (!repeated) run();
    });
    node.addEventListener("pointercancel", stop);
    node.addEventListener("pointerleave", stop);
    node.addEventListener("contextmenu", (event) => event.preventDefault());
    node.addEventListener("click", (event) => {
      if (event.detail === 0) run();
    });
    return node;
  };

  /* ------------------------------- TypeR's panel ------------------------------ */

  const panel = () => {
    try {
      return frame.contentDocument && frame.contentDocument.getElementById("app") ? frame.contentDocument : null;
    } catch (error) {
      return null;
    }
  };
  const pressInPanel = (selector) => {
    const doc = panel();
    const target = doc && doc.querySelector(selector);
    if (target) target.click();
    return Boolean(target);
  };
  const panelStorage = () => {
    try {
      return JSON.parse(frame.contentWindow.__typerWeb.getFile(Kit.activeStoragePath()) || "null");
    } catch (error) {
      return null;
    }
  };
  const panelText = (key) => {
    try {
      return JSON.parse(frame.contentWindow.__adobe_cep__.initResourceBundle())[key];
    } catch (error) {
      return null;
    }
  };

  // What the panel holds about the script: the line it will paste next, and its style
  const readScript = () => {
    const data = panelStorage();
    if (!data) return null;
    const tab = (data.tabs || []).find((item) => item.id === data.currentTabId) || data;
    const raw = String(tab.text || "").split(/\r?\n/);
    const ignored = data.ignoreLinePrefixes || [];
    const counts = (line) => line.trim() && !ignored.some((prefix) => prefix && line.startsWith(prefix));
    const index = tab.currentLineIndex || 0;
    const style = (data.styles || []).find((item) => item.id === data.currentStyleId) || null;
    const color = style && style.textProps && style.textProps.layerText && style.textProps.layerText.textStyleRange && style.textProps.layerText.textStyleRange[0].textStyle.color;
    return {
      empty: !raw.some(counts),
      line: raw[index] || "",
      at: raw.slice(0, index + 1).filter(counts).length,
      total: raw.filter(counts).length,
      style: style ? style.name : "",
      color: color ? `rgb(${color.red},${color.green},${color.blue})` : "",
      pasteOnTap: data.pasteOnClick === true,
    };
  };

  const setScript = (text) => {
    const doc = panel();
    const area = doc && doc.querySelector(".text-area");
    if (!area) return;
    Object.getOwnPropertyDescriptor(frame.contentWindow.HTMLTextAreaElement.prototype, "value").set.call(area, text);
    area.dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
  };

  let writing = false;
  const setWriting = (on, focus) => {
    writing = on;
    const doc = panel();
    if (doc) doc.documentElement.classList.toggle("t-writing", on);
    const area = doc && doc.querySelector(".text-area");
    if (area && focus) area.focus();
    if (area && !on) area.blur();
    renderSheetHead();
  };

  // The PSDs of a chapter, linked to the script: each "Page 12" line opens its file. The
  // panel's own button, whose footer has no room here.
  const pagesLinked = () => {
    const doc = panel();
    const target = doc && doc.querySelector('[data-tour="import-pages"]');
    return Boolean(target && target.classList.contains("is-active"));
  };

  const pasteScript = async () => {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (error) {
      setWriting(true, true);
      return;
    }
    if (!text.trim()) {
      toast(T("The clipboard is empty."));
      return;
    }
    const doc = panel();
    const current = doc && doc.querySelector(".text-area") ? doc.querySelector(".text-area").value : "";
    setScript(current.trim() ? `${current.replace(/\s+$/, "")}\n${text}` : text);
  };

  /* --------------------------------- the view --------------------------------- */

  // A text being worked on stays in sight above a panel or the keyboard, and the page goes
  // back to where it was afterwards.
  let held = null;
  let flight = 0;

  const flyTo = (doc, target, instant) => {
    cancelAnimationFrame(flight);
    const from = { zoom: doc.view.zoom, x: doc.view.x, y: doc.view.y };
    doc.view.fitted = false;
    const put = (t) => {
      doc.view.zoom = from.zoom + (target.zoom - from.zoom) * t;
      doc.view.x = from.x + (target.x - from.x) * t;
      doc.view.y = from.y + (target.y - from.y) * t;
      App.viewChanged();
    };
    if (instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      put(1);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 180);
      put(1 - (1 - t) * (1 - t));
      if (t < 1) flight = requestAnimationFrame(step);
    };
    flight = requestAnimationFrame(step);
  };

  const freeArea = () => {
    const box = stage.getBoundingClientRect();
    let bottom = box.bottom;
    // Where the sheet comes to rest, not where it is while it slides in: offsetTop ignores the
    // transform that moves it
    if (current && Shell.side === "bottom") bottom = Math.min(bottom, sheet.offsetTop);
    if (App.isEditing()) bottom = Math.min(bottom, $("editor").getBoundingClientRect().top);
    return { width: box.width, height: Math.max(80, bottom - box.top) };
  };

  const reveal = (layer, instant) => {
    const doc = app.doc;
    if (!doc || !layer) return;
    const area = freeArea();
    const box = PS.frameOf(layer, doc);
    const w = Math.max(1, box.width);
    const h = Math.max(1, box.height);
    const margin = 16;
    // Big enough to read and to touch, with its bubble around it: a large screen doesn't need
    // the text to fill it
    const most = Math.min((area.width - margin * 2) / w, (area.height - margin * 2) / h, Math.max(area.height * 0.7, 240) / h);
    let zoom = doc.view.zoom;
    if (w * zoom < Math.min(area.width * 0.5, 170)) zoom = Math.min(most, Math.min(area.width * 0.6, 340) / w);
    zoom = Math.min(zoom, most);
    const x0 = box.left * zoom;
    const y0 = box.top * zoom;
    let x = doc.view.x * (zoom / doc.view.zoom);
    let y = doc.view.y * (zoom / doc.view.zoom);
    if (zoom === doc.view.zoom && x0 + x >= margin && x0 + w * zoom + x <= area.width - margin && y0 + y >= margin && y0 + h * zoom + y <= area.height - margin) return;
    x = (area.width - w * zoom) / 2 - x0;
    y = (area.height - h * zoom) / 2 - y0;
    if (!held || held.doc !== doc) held = { doc, zoom: doc.view.zoom, x: doc.view.x, y: doc.view.y, fitted: doc.view.fitted };
    held.left = { zoom, x, y };
    flyTo(doc, { zoom, x, y }, instant);
  };

  const release = () => {
    if (!held) return;
    const { doc, left, zoom, x, y, fitted } = held;
    held = null;
    if (doc !== app.doc || !left) return;
    // Moved by hand since: it stays where the user put it
    if (Math.abs(doc.view.zoom - left.zoom) > 0.0001 || Math.abs(doc.view.x - left.x) > 1 || Math.abs(doc.view.y - left.y) > 1) return;
    if (fitted) setTimeout(App.fitView, 30);
    else flyTo(doc, { zoom, x, y });
  };

  /* -------------------------------- the panels -------------------------------- */

  const sheet = $("t-sheet");
  const native = (id) => el("section", "tview", { id });
  const NATIVE = { position: native("t-view-position"), pages: native("t-view-pages"), more: native("t-view-more"), export: native("t-view-export") };
  Object.values(NATIVE).forEach((view) => $("app").appendChild(view));

  const VIEWS = {
    tools: { title: "Tools", element: () => $("tools"), icon: "wand" },
    script: { title: "Script", element: () => $("dock-typer"), panel: "script", icon: "script" },
    styles: { title: "Styles", element: () => $("dock-typer"), panel: "styles", icon: "styles" },
    shapes: { title: "TextShapeR", element: () => $("dock-typer"), panel: "top", follows: true },
    panel: { title: "TypeR", element: () => $("dock-typer"), panel: "all", tall: true },
    layers: { title: "Layers", element: () => $("pane-layers"), icon: "layers" },
    text: { title: "Character", element: () => $("pane-character"), icon: "font", follows: true },
    lines: { title: "Line Breaks", element: () => $("breaks"), icon: "lines", follows: true },
    history: { title: "History", element: () => $("pane-history") },
    position: { title: "Position", element: () => NATIVE.position, follows: true },
    pages: { title: "Pages", element: () => NATIVE.pages },
    more: { title: "More", element: () => NATIVE.more, icon: "more", tall: true },
    export: { title: "Export", element: () => NATIVE.export },
  };

  let current = null;
  let tall = false;
  let dragged = null;

  const sheetTitle = el("span", "sheet__title");
  const sheetActions = el("span", "sheet__actions");
  const sheetClose = button("sheet__close", "close", T("Close"), () => closeSheet());
  const sheetGrip = el("span", "sheet__grip");
  const sheetHead = el("div", "sheet__head", null, sheetGrip, sheetTitle, sheetActions, sheetClose);
  sheet.appendChild(sheetHead);

  const roomForSheet = () => {
    const bar = $("t-bar").offsetHeight;
    const nav = Shell.side === "bottom" && Shell.kind === "phone" && !Shell.keyboard ? $("t-nav").offsetHeight : 0;
    return Math.max(200, window.innerHeight - bar - nav - Shell.keyboard);
  };
  const layoutSheet = () => {
    const room = roomForSheet();
    const peek = Math.max(250, Math.round(room * 0.5));
    let height = room;
    if (Shell.side === "bottom") height = dragged !== null ? dragged : tall || Shell.keyboard ? room : peek;
    root.style.setProperty("--sh-h", `${Math.min(room, height)}px`);
    return { room, peek };
  };

  // The panel shows the part the sheet is for. Its own dialogs stay above whatever it shows.
  const syncPanel = () => {
    const doc = panel();
    if (!doc) return;
    const html = doc.documentElement;
    html.classList.toggle("t-touch", Shell.touch);
    html.classList.toggle("t-writing", writing);
    const view = current && VIEWS[current].panel;
    if (!Shell.touch) delete html.dataset.view;
    else if (view) html.dataset.view = view;
  };

  let shownLinked = false;
  const SIZED_SHEETS = new Set(["lines", "position", "shapes"]);
  function renderSheetHead() {
    if (!current) return;
    sheetTitle.textContent = T(VIEWS[current].title);
    sheetActions.textContent = "";
    // Beside the page, the tab that opened the panel already names it: its buttons get the room
    requestAnimationFrame(() => sheetHead.classList.toggle("has-actions", sheetActions.childElementCount > 0));
    if (current === "script") {
      sheetActions.append(
        button("sheet__action", "paste", T("Paste"), pasteScript, true),
        button(`sheet__action${writing ? " is-on" : ""}`, writing ? null : "pencil", T(writing ? "Done" : "Modify"), () => setWriting(!writing, !writing), true),
      );
      const linked = pagesLinked();
      shownLinked = linked;
      const pages = button(`sheet__action${linked ? " is-on" : ""}`, "folder", T("Pages"), () => pressInPanel('[data-tour="import-pages"]'), true);
      pages.title = panelText(linked ? "footerDesyncRepo" : "footerOpenRepo") || T("Pages");
      sheetActions.append(pages);
    }
    if (SIZED_SHEETS.has(current)) {
      sheetActions.append(sheetSizeGroup);
      renderSize();
    }
    if (current === "styles" && Shell.kind === "phone") {
      const line = readScript();
      if (line && line.style) sheetActions.append(el("span", "sheet__note", { textContent: line.style }));
    }
  }

  const RENDER = {};
  function openSheet(name, options = {}) {
    if (current === name && !options.again) return;
    const previous = current;
    if (previous && VIEWS[previous].element() !== VIEWS[name].element()) VIEWS[previous].element().classList.remove("is-sheet");
    current = name;
    tall = Boolean(VIEWS[name].tall || options.tall);
    dragged = null;
    VIEWS[name].element().classList.add("is-sheet");
    root.classList.add("sheet-open");
    sheet.classList.add("is-open");
    if (RENDER[name]) RENDER[name]();
    syncPanel();
    if (name === "script") {
      const line = readScript();
      setWriting(Boolean(line && line.empty) || (writing && previous === "script"));
    } else if (writing) setWriting(false);
    renderSheetHead();
    renderNav();
    layoutSheet();
    if (VIEWS[name].follows) {
      const layer = App.activeTexts()[0];
      if (layer) requestAnimationFrame(() => reveal(layer));
    } else release();
  }
  function closeSheet() {
    if (!current) return;
    VIEWS[current].element().classList.remove("is-sheet");
    current = null;
    dragged = null;
    if (writing) setWriting(false);
    root.classList.remove("sheet-open");
    sheet.classList.remove("is-open");
    renderNav();
    if (!App.isEditing()) release();
  }
  const toggleSheet = (name) => (current === name ? closeSheet() : openSheet(name));

  // The head of a sheet follows the thumb, and stops at half the screen, all of it, or nothing
  sheetHead.addEventListener("pointerdown", (event) => {
    if (Shell.side !== "bottom" || event.target.closest("button")) return;
    const startY = event.clientY;
    const startH = sheet.getBoundingClientRect().height;
    const { room, peek } = layoutSheet();
    sheetHead.setPointerCapture(event.pointerId);
    const move = (next) => {
      dragged = Math.max(120, Math.min(room, startH + startY - next.clientY));
      layoutSheet();
    };
    const up = () => {
      sheetHead.removeEventListener("pointermove", move);
      sheetHead.removeEventListener("pointerup", up);
      sheetHead.removeEventListener("pointercancel", up);
      if (dragged === null) return;
      const end = dragged;
      dragged = null;
      if (end < peek * 0.6) {
        closeSheet();
        return;
      }
      tall = end > (peek + room) / 2;
      layoutSheet();
    };
    sheetHead.addEventListener("pointermove", move);
    sheetHead.addEventListener("pointerup", up);
    sheetHead.addEventListener("pointercancel", up);
  });

  /* ------------------------------- the top bar -------------------------------- */

  const bar = $("t-bar");
  const barUndo = button("tbtn", "undo", T("Undo"), () => ops.undo());
  const barRedo = button("tbtn", "redo", T("Redo"), () => ops.redo());
  const pageBack = button("tbtn tbtn--page", "back", T("Previous page"), () => stepPage(-1));
  const pageNext = button("tbtn tbtn--page", "forward", T("Next page"), () => stepPage(1));
  const pageCount = el("b");
  const pageName = el("span");
  const pagesButton = el("button", "tpages", { type: "button", ariaLabel: T("Pages") }, pageCount, pageName);
  pagesButton.addEventListener("click", () => toggleSheet("pages"));
  const logo = el("img", "tbar__logo", { src: "../assets/brand/sg-logo.png", width: 26, height: 26, alt: "SG" });
  bar.append(logo, pageBack, pagesButton, pageNext, el("span", "tbar__grow"), barUndo, barRedo, button("tbtn tbtn--main", "share", T("Export"), () => toggleSheet("export")));

  // A chapter (Open Pages…, or the pages given to the script) goes page by page, each one opened
  // when it's reached; otherwise the open documents follow one another
  const stepPage = (direction) => {
    if (App.chapter()) {
      App.stepPage(direction);
      return;
    }
    const next = app.docs[app.docs.indexOf(app.doc) + direction];
    if (next) App.switchDoc(next);
  };
  const renderBar = () => {
    const doc = app.doc;
    const book = App.chapter();
    const at = book ? book.at : app.docs.indexOf(doc);
    const count = book ? book.pages.length : app.docs.length;
    barUndo.disabled = !doc || doc.historyIndex <= 0;
    barRedo.disabled = !doc || doc.historyIndex >= doc.history.length - 1;
    // Away from the chapter, either arrow brings back the page last worked on
    pageBack.disabled = book ? at === 0 : at <= 0;
    pageNext.disabled = book ? at === count - 1 : at < 0 || at >= count - 1;
    root.classList.toggle("few-pages", count < 2);
    pageCount.textContent = !doc ? "" : at < 0 ? `–/${count}` : `${at + 1}/${count}`;
    pageName.textContent = doc ? `${doc.name}${PS.isDirty(doc) ? " •" : ""}` : "TypeR";
    root.classList.toggle("no-doc", !doc);
    barExport().disabled = !doc;
  };
  const barExport = () => bar.querySelector(".tbtn--main");

  /* -------------------------- the line, and what's next ------------------------ */

  const bottom = $("t-bottom");
  const ctx = el("div", "tctx");
  const ctxActions = el("div", "tctx__actions");
  const ctxHint = el("p", "tctx__hint");
  ctx.append(ctxActions, ctxHint);

  const cardText = el("span", "tcard__text");
  const cardCount = el("b", "tcard__count");
  const cardDot = el("i", "tcard__dot");
  const cardStyle = el("span", "tcard__style");
  const cardBody = el("button", "tcard__body", { type: "button" }, el("span", "tcard__meta", null, cardCount, cardDot, cardStyle), cardText);
  const cardBack = button("tcard__nav", "back", T("Previous line"), () => pressInPanel(".preview-nav button"));
  const cardNext = button("tcard__nav", "forward", T("Next line"), () => pressInPanel('[data-tour="next-line"]'));
  const cardTap = button("tcard__tap", "tap", T("Paste on tap"), () => {
    pressInPanel('[data-tour="mode-pasteOnClick"]');
    setTimeout(() => {
      const line = readScript();
      if (line) toast(T(line.pasteOnTap ? "A tap on a bubble now pastes the line." : "A tap on a bubble now only selects it."));
    }, 60);
  });
  bottom.append(ctx, el("div", "tcard", null, cardBack, cardBody, cardNext, cardTap));

  // A swipe along the line changes line, a tap opens the script
  let swipe = null;
  cardBody.addEventListener("pointerdown", (event) => { swipe = { x: event.clientX, used: false }; });
  cardBody.addEventListener("pointerup", (event) => {
    if (!swipe) return;
    const moved = event.clientX - swipe.x;
    if (Math.abs(moved) > 36) {
      swipe.used = true;
      pressInPanel(moved < 0 ? '[data-tour="next-line"]' : ".preview-nav button");
    }
  });
  cardBody.addEventListener("click", () => {
    if (swipe && swipe.used) {
      swipe = null;
      return;
    }
    toggleSheet("script");
  });

  const renderCard = () => {
    const line = readScript();
    const blank = !line || line.empty;
    root.classList.toggle("no-script", blank);
    cardCount.textContent = blank ? "" : `${line.at}/${line.total}`;
    cardText.textContent = blank ? T("Add your script to paste it bubble by bubble.") : line.line;
    cardStyle.textContent = line && line.style ? line.style : blank ? T("No script") : T("No style");
    cardDot.style.background = (line && line.color) || "transparent";
    cardDot.hidden = !(line && line.color);
    cardBack.disabled = blank;
    cardNext.disabled = blank;
    const on = Boolean(line && line.pasteOnTap);
    cardTap.classList.toggle("is-on", on);
    cardTap.setAttribute("aria-pressed", String(on));
    if (current === "styles" || (current === "script" && pagesLinked() !== shownLinked)) renderSheetHead();
  };

  const menuItem = (group, label) => {
    const entry = App.MENUS.find(([name]) => name === group);
    return entry && entry[1].find((item) => item && item.label === label);
  };
  const runMenu = (group, label) => {
    const item = menuItem(group, label);
    if (item && (!item.enabled || item.enabled())) item.action();
  };

  const action = (icon, label, run, className) => button(`tact${className ? ` ${className}` : ""}`, icon, label, run, true);

  const stepSize = (sign) => {
    const layer = App.activeTexts()[0];
    if (!layer) return;
    const style = layer.params.layerText.textStyleRange[0].textStyle;
    const size = (style.impliedFontSize || style.size || 14) + sign;
    if (size >= 1) {
      App.applyTextPatch({ size }, null, "size");
    }
  };

  // The size, between its two steps: what's done most to a line just pasted, so it comes first
  // and says where it is. A tap on the number opens the Character panel.
  // The same group heads the panels that adjust a text (Line Breaks, Position…): the size and
  // the breaks are set together until the line fits its bubble.
  const sizeValues = [];
  const sizeStep = (label, sign, text) => {
    const node = repeating(button("tsize__step", null, label, null), () => stepSize(sign));
    node.textContent = text;
    return node;
  };
  const makeSizeGroup = (opensText) => {
    const value = el(opensText ? "button" : "span", "tsize__value", opensText ? { type: "button", title: T("Size") } : null);
    if (opensText) {
      value.setAttribute("aria-label", T("Size"));
      value.addEventListener("click", () => toggleSheet("text"));
    }
    sizeValues.push(value);
    return el("div", "tsize", null, sizeStep(T("Smaller text"), -1, "A−"), value, sizeStep(T("Bigger text"), 1, "A+"));
  };
  const sizeGroup = makeSizeGroup(true);
  const sheetSizeGroup = makeSizeGroup(false);
  const renderSize = () => {
    const layer = App.activeTexts()[0];
    const style = layer && layer.params.layerText.textStyleRange[0].textStyle;
    const size = style ? Math.round((style.impliedFontSize || style.size || 0) * 10) / 10 : 0;
    const text = size ? String(size) : "";
    sizeValues.forEach((value) => {
      if (value.textContent !== text) value.textContent = text;
    });
    sheetSizeGroup.hidden = !layer;
  };

  // In the order they're needed after a paste: the size, the breaks, the place
  const textActions = () => [
    action("pencil", T("Modify"), () => App.beginEdit(App.activeTexts()[0]), "tact--main"),
    sizeGroup,
    action("lines", T("Lines"), () => toggleSheet("lines")),
    // TypeR's own Align: the text to the middle of the selection, or of the bubble tapped
    action("alignMiddle", panelText("alignLayer") || T("Align"), () => pressInPanel('[data-tour="align"]')),
    action("font", T("Text"), () => toggleSheet("text")),
    action("shapes", T("Shapes"), () => toggleSheet("shapes")),
    action("nudge", T("Position"), () => toggleSheet("position")),
    action("copy", T("Duplicate"), () => ops.duplicateLayers()),
    action("warp", T("Perspective"), () => App.enterSurface(App.activeTexts()[0])),
    action("trash", T("Delete"), () => ops.deleteLayers()),
  ];
  const selectionActions = () => [
    action("paste", T("Paste the line"), () => pressInPanel('[data-tour="paste"]'), "tact--main"),
    action("inverse", T("Inverse"), () => runMenu("Select", "Inverse")),
    action("grow", T("Expand…"), () => runMenu("Select", "Expand…")),
    action("shrink", T("Contract…"), () => runMenu("Select", "Contract…")),
    action("fill", T("Fill"), () => runMenu("Edit", "Fill with Foreground Colour")),
    action("stamp", T("Content-Aware Fill"), () => runMenu("Edit", "Content-Aware Fill…")),
    action("trash", T("Clear"), () => runMenu("Edit", "Clear")),
  ];

  // Letting go is always in reach, outside the row that scrolls: a tap on the page to get out
  // of a text would paste the line there.
  // Done with a text, it's done with its bubble's selection too.
  const ctxDone = button("tctx__done", "close", T("Deselect"), () => {
    if (ctxKey === "text") ops.clearActiveLayers();
    if (app.doc && app.doc.state.selection) runMenu("Select", "Deselect");
  });
  ctx.appendChild(ctxDone);

  // A row, or a column, longer than the screen: its ends fade where there's more to scroll to
  const fadeEdges = (node, vertical) => {
    node.classList.add(vertical ? "t-fade-y" : "t-fade-x");
    const render = () => {
      const more = vertical ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
      const at = vertical ? node.scrollTop : node.scrollLeft;
      node.classList.toggle("more-s", more > 1 && at > 1);
      node.classList.toggle("more-e", more > 1 && at < more - 1);
    };
    node.addEventListener("scroll", render, { passive: true });
    new ResizeObserver(render).observe(node);
    return render;
  };
  const renderEdges = fadeEdges(ctxActions);

  const HINT = "Tap a bubble to paste the line. Two fingers zoom and pan; a two-finger tap undoes.";
  let ctxKey = "";
  const renderCtx = () => {
    renderSize();
    const doc = app.doc;
    const tool = app.tool;
    const options = $("options");
    let mode = "hint";
    if (!doc || App.isEditing()) mode = "none";
    else if (App.warpedLayer()) mode = "options";
    else if ((tool === "wand" || tool === "move" || tool === "text") && App.activeTexts().length) mode = "text";
    else if (doc.state.selection) mode = "selection";
    else if (tool !== "wand" || Shell.kind === "tablet") mode = "options";
    if (mode === ctxKey) return;
    ctxKey = mode;
    options.hidden = mode !== "options";
    ctxHint.hidden = mode !== "hint";
    ctxHint.textContent = T(HINT);
    ctxActions.hidden = mode !== "text" && mode !== "selection";
    ctxDone.hidden = ctxActions.hidden;
    ctxActions.textContent = "";
    ctxActions.scrollLeft = 0;
    if (mode === "text") ctxActions.append(...textActions());
    if (mode === "selection") ctxActions.append(...selectionActions());
    renderEdges();
  };

  // The gestures are said once, the first time there's a page to try them on
  const SEEN_GESTURES = "typer.web.touchHint";
  const showGesturesOnce = () => {
    try {
      if (window.localStorage.getItem(SEEN_GESTURES)) return;
      window.localStorage.setItem(SEEN_GESTURES, "1");
    } catch (error) {
      return;
    }
    if (Shell.kind === "tablet") toast(T(HINT), true);
  };

  /* --------------------------------- the nav ---------------------------------- */

  const nav = $("t-nav");
  const navOf = () => (Shell.kind === "phone" ? ["tools", "script", "styles", "layers", "more"] : ["script", "styles", "layers", "text", "lines", "more"]);
  const NAV_LABEL = { tools: "Tools", script: "Script", styles: "Styles", layers: "Layers", text: "Text", lines: "Lines", more: "More" };
  let navKey = "";
  function renderNav() {
    const names = navOf();
    const key = names.join();
    if (navKey !== key) {
      navKey = key;
      nav.textContent = "";
      names.forEach((name) => {
        const item = button("tnav__item", VIEWS[name].icon, T(NAV_LABEL[name]), () => toggleSheet(name), true);
        item.dataset.view = name;
        nav.appendChild(item);
      });
    }
    nav.querySelectorAll(".tnav__item").forEach((item) => {
      const on = item.dataset.view === current;
      item.classList.toggle("is-on", on);
      item.setAttribute("aria-pressed", String(on));
      if (item.dataset.view === "tools") {
        const icon = item.querySelector("svg");
        if (icon && item.dataset.tool !== app.tool) {
          item.dataset.tool = app.tool;
          icon.outerHTML = ICON[app.tool] || ICON.wand;
        }
      }
    });
  }

  /* ----------------------------------- tools ---------------------------------- */

  const toolsExtra = el("div", "tools__opts");
  const renderToolOptions = () => {
    toolsExtra.textContent = "";
    const tolerance = el("input", "", { type: "range", min: 0, max: 255, value: app.tolerance });
    const shown = el("output", "", { textContent: app.tolerance });
    tolerance.addEventListener("input", () => {
      app.tolerance = Number(tolerance.value);
      shown.textContent = tolerance.value;
    });
    const check = (label, on, change) => {
      const input = el("input", "", { type: "checkbox", checked: on });
      input.addEventListener("change", () => change(input.checked));
      return el("label", "tools__check", null, input, el("span", "", { textContent: label }));
    };
    toolsExtra.append(
      el("label", "tools__range", null, el("span", "", { textContent: T("Tolerance") }), tolerance, shown),
      check(T("Contiguous"), app.contiguous !== false, (on) => { app.contiguous = on; }),
      check(T("Sample all layers"), app.sampleAll, (on) => { app.sampleAll = on; }),
    );
  };
  RENDER.tools = renderToolOptions;

  /* ---------------------------------- position -------------------------------- */

  let nudgeStep = 1;
  RENDER.position = () => {
    const view = NATIVE.position;
    view.textContent = "";
    const pad = el("div", "tpad");
    [["up", 0, -1, "tpad__n"], ["back", -1, 0, "tpad__w"], ["forward", 1, 0, "tpad__e"], ["down", 0, 1, "tpad__s"]].forEach(([icon, dx, dy, cls]) => {
      pad.appendChild(repeating(button(`tpad__key ${cls}`, icon, T("Move"), null), () => App.nudge(dx * nudgeStep, dy * nudgeStep)));
    });
    const steps = el("div", "tseg");
    [1, 10].forEach((value) => {
      const step = button(`tseg__item${nudgeStep === value ? " is-on" : ""}`, null, `${value} ${T("px")}`, () => {
        nudgeStep = value;
        RENDER.position();
      }, true);
      steps.appendChild(step);
    });
    const align = button("btn", null, T("Centre in the selection"), () => pressInPanel('[data-tour="align"]'), true);
    align.disabled = !(app.doc && app.doc.state.selection);
    view.append(el("div", "tposition", null, pad, el("div", "tposition__side", null, steps, align)));
  };

  /* ------------------------------------ pages --------------------------------- */

  const thumbs = new WeakMap();
  const thumbnail = (doc) => {
    const known = thumbs.get(doc);
    if (known && known.state === doc.state) return known.canvas;
    const full = App.flattened(doc, "#fff");
    const scale = Math.min(1, 240 / Math.max(doc.width, doc.height));
    const canvas = el("canvas", "", { width: Math.max(1, Math.round(doc.width * scale)), height: Math.max(1, Math.round(doc.height * scale)) });
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(full, 0, 0, canvas.width, canvas.height);
    thumbs.set(doc, { state: doc.state, canvas });
    return canvas;
  };
  let pagesTurn = 0;
  RENDER.pages = () => {
    const view = NATIVE.pages;
    const turn = ++pagesTurn;
    view.textContent = "";
    const grid = el("div", "tpages-grid");
    view.appendChild(grid);
    const after = () => {
      if (Shell.side !== "dock") closeSheet();
      else RENDER.pages();
    };
    // A chapter's pages first, opened or not yet; then what else is open
    const book = App.chapter();
    const entries = [];
    if (book) book.pages.forEach((page, index) => entries.push({ name: page.name, doc: page.doc, number: index + 1, go: () => App.goToPage(index) }));
    app.docs.forEach((doc, index) => {
      if (!entries.some((entry) => entry.doc === doc)) entries.push({ name: doc.name, doc, number: book ? null : index + 1 });
    });
    let drawn = 0;
    entries.forEach((entry) => {
      const { doc } = entry;
      const picture = el("span", "tpage__picture");
      const label = `${entry.number ? `${entry.number}. ` : ""}${doc ? doc.name : entry.name}${doc && PS.isDirty(doc) ? " •" : ""}`;
      const open = el("button", "tpage__open", { type: "button" }, picture, el("span", "tpage__name", { textContent: label }));
      open.addEventListener("click", () => {
        if (entry.go) entry.go();
        else App.switchDoc(doc);
        after();
      });
      const remove = doc && button("tpage__close", "close", `${T("Close")}: ${doc.name}`, async () => {
        await App.closeDoc(doc);
        if (current === "pages") RENDER.pages();
      });
      grid.appendChild(el("div", `tpage${doc && doc === app.doc ? " is-on" : ""}`, null, open, remove));
      // Not open yet: its number stands for it
      if (!doc) {
        picture.appendChild(el("span", "tpage__number", { textContent: entry.number, ariaHidden: "true" }));
        return;
      }
      // One at a time: drawing a page takes a moment, and a chapter has many
      setTimeout(() => {
        if (turn === pagesTurn && app.docs.includes(doc)) picture.appendChild(thumbnail(doc));
      }, 60 * drawn++ + 30);
    });
    grid.appendChild(button("tpage tpage--add", "plus", T("Open a file"), App.openDialog, true));
  };

  /* ----------------------------------- export --------------------------------- */

  const row = (label, run, disabled, icon) => {
    const node = button("trow", icon || null, label, run, true);
    node.disabled = Boolean(disabled);
    return node;
  };
  RENDER.export = () => {
    const view = NATIVE.export;
    view.textContent = "";
    const doc = app.doc;
    const after = (run) => () => {
      closeSheet();
      run();
    };
    view.append(
      row(T("Save"), after(() => App.save()), !doc, "share"),
      row(T("Export as PNG…"), after(() => App.exportImage("image/png")), !doc),
      row(T("Export as JPEG…"), after(() => App.exportImage("image/jpeg")), !doc),
      row(T("Export as WebP…"), after(() => App.exportImage("image/webp")), !doc || !App.canWriteWebp),
    );
    if (app.docs.length > 1) {
      view.append(
        el("p", "tview__label", { textContent: fill(T("All {count} pages"), { count: app.docs.length }) }),
        row("PNG", after(() => App.exportAllPages("image/png"))),
        row("JPEG", after(() => App.exportAllPages("image/jpeg"))),
        ...(App.canWriteWebp ? [row("WebP", after(() => App.exportAllPages("image/webp")))] : []),
        row(T("Batch Save…"), after(() => App.batchSave())),
      );
    }
  };

  /* ------------------------------------ more ---------------------------------- */

  const OUT_OF_PLACE = new Set(["Keyboard Shortcuts", "Support the Project"]);
  const openPanelPart = (selector) => {
    openSheet("panel");
    setTimeout(() => pressInPanel(selector), 60);
  };
  RENDER.more = () => {
    const view = NATIVE.more;
    view.textContent = "";
    App.renderMenusState();
    view.append(
      row(T("Pages"), () => openSheet("pages"), false, "copy"),
      row(T("History"), () => openSheet("history"), false, "undo"),
      row(T("Line Breaks"), () => openSheet("lines"), false, "lines"),
      row(T("Character"), () => openSheet("text"), false, "font"),
      row("TextShapeR", () => openSheet("shapes"), false, "shapes"),
      row(T("TypeR Settings"), () => openPanelPart('[data-tour="settings"]'), false, "tag"),
      row(T("Full TypeR Panel"), () => openSheet("panel"), false, "script"),
    );
    App.MENUS.forEach(([group, items], index) => {
      // TypeR's commands are in its own sheet here, the panel's settings just above
      if (group === "Window" || group === "TypeR") return;
      // A submenu's items come in its place, named after it
      const flat = items.flatMap((item) => (item && item.submenu ? item.submenu.filter(Boolean).map((sub) => ({ sub, parent: item })) : [item && { sub: item }]));
      const shown = flat.filter((entry) => !entry || (!OUT_OF_PLACE.has(entry.sub.label) && !(entry.sub.label === "Use Installed Fonts…" && !Fonts.canListInstalled())));
      const list = el("div", "tgroup__list");
      shown.forEach((entry) => {
        if (!entry) return;
        const item = entry.sub;
        const disabled = item.enabled ? !item.enabled() : false;
        const name = T(item.title ? item.title() : item.label);
        list.appendChild(row(entry.parent ? `${T(entry.parent.label)} › ${name}` : name, () => {
          closeSheet();
          item.action();
        }, disabled));
      });
      const details = el("details", "tgroup", { open: index === 0 }, el("summary", "", { textContent: T(group) }), list);
      view.appendChild(details);
    });
    const language = $("language").cloneNode(true);
    language.removeAttribute("id");
    language.value = $("language").value;
    language.addEventListener("change", () => {
      const url = new URL(window.location.href);
      url.searchParams.set("lang", language.value);
      window.location.href = url.href;
    });
    view.append(el("label", "tview__field", null, el("span", "", { textContent: T("Language") }), language));
    if (document.fullscreenEnabled) {
      view.append(row(T("Full Screen"), () => {
        const done = document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen();
        done.catch((error) => console.warn("SG Typer Studio: full screen refused", error));
      }, false, "fullScreen"));
    }
    view.append(row(T("Desktop Interface"), () => Shell.prefer("desktop")));
  };

  /* ------------------------------ the panel's news ---------------------------- */

  // Its dialogs need room, and what it says must be seen while it's out of sight
  let modalFrom = undefined;
  let lastNotice = "";
  const watchPanel = () => {
    const doc = panel();
    if (!doc || doc.documentElement.dataset.watched) return;
    doc.documentElement.dataset.watched = "1";
    new MutationObserver(() => {
      if (!Shell.touch) return;
      const open = Boolean(doc.querySelector(".app-modal"));
      if (open && modalFrom === undefined) {
        modalFrom = current;
        if (!current || !VIEWS[current].panel) openSheet("panel");
        else {
          tall = true;
          layoutSheet();
        }
      } else if (!open && modalFrom !== undefined) {
        const from = modalFrom;
        modalFrom = undefined;
        if (from === null) closeSheet();
        else if (from !== current) openSheet(from);
        else {
          tall = Boolean(VIEWS[from].tall);
          layoutSheet();
        }
      }
      if (current === "script" && pagesLinked() !== shownLinked) renderSheetHead();
      const notice = doc.querySelector(".typer-notice__text");
      const said = notice ? notice.textContent.trim() : "";
      if (said && said !== lastNotice && (!current || !VIEWS[current].panel)) toast(said);
      lastNotice = said;
    }).observe(doc.body, { childList: true, subtree: true });
  };

  frame.addEventListener("load", () => {
    writing = false;
    syncPanel();
    watchPanel();
    renderCard();
  });

  /* -------------------------------- the whole -------------------------------- */

  const startPractice = async () => {
    const page = "typer-practice-page.png";
    await ops.loadImage("panel/assets/typer-practice-page.png", page).catch((error) => toast(fill(T("{name} can't be read: {error}"), { name: page, error: error.message })));
    const line = readScript();
    if (!line || !line.empty) return;
    const lines = [];
    for (let number = 1; number < 40; number++) {
      const text = panelText(`walkthroughPracticeLine${number}`);
      if (!text) break;
      lines.push(text);
    }
    if (lines.length) setScript(lines.join("\n"));
  };
  $("start-practice").addEventListener("click", startPractice);

  // iOS greys out every file whose extension it doesn't know, .psd included, and the filter
  // can't be fixed from here. So no filter: what can't be opened is refused once picked.
  const FILE_FILTERS = new Map(["file-open", "file-fonts", "file-kit"].map((id) => [$(id), $(id).accept]));
  const applyFileFilters = () => FILE_FILTERS.forEach((accept, input) => { input.accept = Shell.touch ? "" : accept; });

  const home = { parent: null, before: null };
  let optionsMoved = false;
  const applyShell = () => {
    applyFileFilters();
    const options = $("options");
    if (Shell.touch && !optionsMoved) {
      home.parent = options.parentNode;
      home.before = options.nextSibling;
      ctx.appendChild(options);
      optionsMoved = true;
      ctxKey = "";
    } else if (!Shell.touch && optionsMoved) {
      options.hidden = false;
      home.parent.insertBefore(options, home.before);
      optionsMoved = false;
    }
    if (!Shell.touch) {
      closeSheet();
      syncPanel();
      return;
    }
    if (current && !navOf().includes(current) && current === "tools" && Shell.kind !== "phone") closeSheet();
    const tools = $("tools");
    if (Shell.kind === "phone") tools.appendChild(toolsExtra);
    else toolsExtra.remove();
    renderNav();
    layoutSheet();
    syncPanel();
    ctxKey = "";
    renderCtx();
    renderBar();
    // Beside the page, the script waits open
    if (Shell.side === "dock" && !current && !Shell.keyboard && !dockClosedByHand) openSheet("script");
  };
  let dockClosedByHand = false;
  sheetClose.addEventListener("click", () => { dockClosedByHand = true; });
  nav.addEventListener("click", () => { dockClosedByHand = !current; });

  Shell.onChange(() => {
    applyShell();
    if (App.isEditing()) {
      const editing = app.doc && app.doc.state.layers.find((layer) => layer.id === App.editingId());
      if (editing) requestAnimationFrame(() => reveal(editing, true));
    }
  });
  window.addEventListener("resize", () => {
    if (Shell.touch) layoutSheet();
  });

  // Choosing a tool on a phone is one tap, and then the page is back
  $("tools").addEventListener("click", (event) => {
    if (Shell.kind === "phone" && event.target.closest(".tool[data-tool]")) closeSheet();
  });
  new MutationObserver(() => {
    if (!Shell.touch) return;
    renderCtx();
    renderNav();
  }).observe(stage, { attributes: true, attributeFilter: ["data-tool"] });

  // The Done button sits on top of the text being typed
  const done = el("button", "tdone", { type: "button", textContent: T("Done") });
  done.addEventListener("pointerdown", (event) => event.preventDefault());
  done.addEventListener("click", () => App.endEdit());
  stage.parentNode.appendChild(done);
  new ResizeObserver(() => {
    root.style.setProperty("--edit-h", `${$("editor").offsetHeight}px`);
  }).observe($("editor"));

  // How far in, and back to the whole page in one tap
  const zoomPill = el("button", "tzoom", { type: "button" });
  zoomPill.addEventListener("click", () => {
    const doc = app.doc;
    if (!doc) return;
    if (doc.view.fitted) App.zoomTo(1);
    else App.fitView();
  });
  stage.parentNode.appendChild(zoomPill);
  let zoomTimer = 0;
  const renderZoom = () => {
    const doc = app.doc;
    zoomPill.hidden = !doc;
    if (!doc) return;
    const text = `${Math.round(doc.view.zoom * 100)}%`;
    if (zoomPill.textContent === text) return;
    zoomPill.textContent = text;
    zoomPill.classList.add("is-live");
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => zoomPill.classList.remove("is-live"), 900);
  };

  const renderAll = () => {
    if (!Shell.touch) return;
    renderBar();
    renderCtx();
    renderZoom();
    if (current === "position") RENDER.position();
  };

  PS.on((type, detail) => {
    if (!Shell.touch) return;
    if (type === "render" || type === "view") renderZoom();
    if (type === "options" && current === "tools") RENDER.tools();
    if (type === "render" || type === "history" || type === "document" || type === "selection" || type === "saved") {
      renderBar();
      renderCtx();
    }
    if (type === "document") {
      held = null;
      if (detail) showGesturesOnce();
      if (current === "pages") RENDER.pages();
    }
    if (type === "editing") {
      const editing = App.isEditing();
      root.classList.toggle("is-editing", editing);
      renderCtx();
      if (editing) {
        const layer = detail || (app.doc && app.doc.state.layers.find((item) => item.id === App.editingId()));
        // Once the keyboard is up, which takes its time
        [60, 420].forEach((wait) => setTimeout(() => {
          if (App.isEditing()) reveal(layer);
        }, wait));
      } else if (!current || !VIEWS[current].follows) release();
    }
  });
  new ResizeObserver(() => {
    if (Shell.touch && App.isEditing()) {
      const layer = app.doc && app.doc.state.layers.find((item) => item.id === App.editingId());
      if (layer) reveal(layer, true);
    }
    renderZoom();
  }).observe(stage);

  // The script and the style live in the panel: it says when they change (bridge.js)
  let cardWaiting = false;
  const panelChanged = () => {
    if (!Shell.touch || cardWaiting) return;
    cardWaiting = true;
    requestAnimationFrame(() => {
      cardWaiting = false;
      renderCard();
    });
  };

  $("tools").querySelectorAll(".tool:not([data-tool])").forEach((node) => { node.dataset.name = node.getAttribute("aria-label") || ""; });

  // The tool's options change with the tool, and a tablet's column of tools is taller than a
  // landscape screen: both say when there's more of them
  const renderOptionEdges = fadeEdges($("options"));
  new MutationObserver(() => requestAnimationFrame(renderOptionEdges)).observe($("options"), { childList: true, subtree: true });
  const renderToolEdges = fadeEdges($("tools"), true);
  Shell.onChange(() => requestAnimationFrame(renderToolEdges));

  applyShell();
  renderAll();
  renderCard();

  // The chapter changed: a page reached, pages given or let go (app.js)
  const chapterChanged = () => {
    if (!Shell.touch) return;
    renderBar();
    if (current === "pages") RENDER.pages();
  };

  // A tap on the page pastes the line, if there's one to paste (app.js)
  const pastesOnTap = () => {
    const line = readScript();
    return Boolean(line && line.pasteOnTap && !line.empty);
  };

  window.TypeRTouch = { panelChanged, openSheet, closeSheet, chapterChanged, pastesOnTap };
})();
