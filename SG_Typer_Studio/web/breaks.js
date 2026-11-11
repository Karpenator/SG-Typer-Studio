// The Line Breaks panel, which Photoshop doesn't have: the lines of the active text,
// and the mouse. Moving over the text shows where a line can break, with the result on
// the page before any click. Click to break, click a mark to join, drag a mark to move
// it. Inside a word the break snaps to its syllables and adds the hyphen; Alt cuts
// anywhere.

(function () {
  "use strict";

  const PS = window.TypeRPhotoshop;
  const App = window.TypeRApp;
  const { app, ops } = PS;
  const T = App.T;
  const $ = (id) => document.getElementById(id);
  const root = $("breaks");
  const lines = $("breaks-lines");
  const sheet = $("breaks-text");
  const caret = $("breaks-caret");
  const badge = $("breaks-badge");
  const count = $("breaks-count");
  const hint = $("breaks-hint");
  const empty = $("breaks-empty");
  const STORE = "typer.web.breaks";
  const Hyphenation = window.TypeRHyphenation;
  const Shell = window.TypeRShell;

  /* --------------------------------- state --------------------------------- */

  // "auto" lets each text decide its own language
  let choice = "auto";
  let showHint = true;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORE) || "{}");
    if (Hyphenation.LANGUAGES.includes(saved.choice)) choice = saved.choice;
    if (saved.hint === false) showHint = false;
  } catch (error) {
    choice = "auto";
  }
  const remember = () => {
    try {
      window.localStorage.setItem(STORE, JSON.stringify({ choice, hint: showHint }));
    } catch (error) {
      console.warn("SG Typer Studio: could not keep the panel's settings", error);
    }
  };

  let language = null;
  let layer = null;
  let model = null;
  let breakSet = new Set();
  let syllableSet = new Set();
  let spans = [];
  let shownKey = "";
  // What the key was made of, to skip making it again: a render of the page costs a
  // look at the text, and the page is drawn at every move of a brush
  let shownDoc = null;
  let shownState = null;
  let shownFonts = -1;
  let shownLoaded = false;
  let hover = null;
  let drag = null;
  let openedMenu = false;
  // No Alt key on a touch screen: this button stands for it
  let cutAnywhere = false;

  const activeText = () => {
    const doc = app.doc;
    if (!doc) return null;
    const id = doc.state.activeIds[doc.state.activeIds.length - 1];
    const found = doc.state.layers.find((item) => item.id === id);
    return found && found.kind === "text" ? found : null;
  };

  const wordBounds = (index) => {
    let start = index;
    let end = index;
    while (start > 0 && model.chars[start - 1].ch !== " ") start--;
    while (end < model.chars.length && model.chars[end].ch !== " ") end++;
    return [start, end];
  };

  // Punctuation, spaces and hyphens end a run of letters: "beaucoup," cuts like "beaucoup"
  const findSyllables = () => {
    syllableSet = new Set();
    const chars = model.chars;
    let start = -1;
    const close = (end) => {
      if (start < 0) return;
      const run = chars.slice(start, end).map((item) => item.ch).join("");
      const from = start;
      Hyphenation.breakPoints(run, language, true).forEach((point) => syllableSet.add(from + point));
      start = -1;
    };
    chars.forEach((item, index) => {
      if (!/[\p{L}\p{M}'’]/u.test(item.ch)) close(index);
      else if (start < 0) start = index;
    });
    close(chars.length);
  };

  /* -------------------------------- drawing -------------------------------- */

  // Bigger on a touch screen: a finger picks between two letters
  const fontSize = () => (Shell.touch ? 26 : 17);
  const smallest = () => (Shell.touch ? 16 : 12);
  // The marks hang in the sides of the lines
  const sides = () => (Shell.touch ? 76 : 44);

  // In a narrow panel the letters get smaller, down to a size that still reads; a line that
  // still doesn't fit never wraps, as a row of the panel is a line of the text: the panel
  // scrolls sideways instead. With the pointer over the text they only get smaller: they
  // don't run away from it with each break.
  const fitLines = () => {
    if (!model || lines.querySelector(".bl__rotated")) return;
    const FONT_SIZE = fontSize();
    const current = parseFloat(lines.style.fontSize) || FONT_SIZE;
    // Measured at the full size; the style is only touched when it changes, so that the
    // measures below cost one layout, and none when the size is already right
    if (current !== FONT_SIZE) lines.style.fontSize = `${FONT_SIZE}px`;
    let widest = 0;
    lines.querySelectorAll(".bl__line").forEach((row) => { widest = Math.max(widest, row.offsetWidth); });
    const room = lines.clientWidth - sides();
    if (room <= 0) return;
    let size = widest > room ? Math.max(smallest(), Math.floor((FONT_SIZE * room) / widest)) : FONT_SIZE;
    if (root.matches(":hover") && !Shell.touch) size = Math.min(size, current);
    if (size !== FONT_SIZE) lines.style.fontSize = `${size}px`;
    showEnds();
  };

  // The sides fade where the text goes on out of sight
  const fades = ["l", "r"].map((side) => {
    const fade = document.createElement("div");
    fade.className = `breaks__fade breaks__fade--${side}`;
    fade.hidden = true;
    root.appendChild(fade);
    return fade;
  });
  function showEnds() {
    // Shown or hidden first, then every measure, then every position: one layout, not one per measure
    const more = [lines.scrollLeft > 1, lines.scrollLeft < lines.scrollWidth - lines.clientWidth - 1];
    fades.forEach((fade, index) => { fade.hidden = !more[index]; });
    const top = `${lines.offsetTop}px`;
    const height = `${lines.clientHeight}px`;
    const left = lines.offsetLeft;
    const width = lines.clientWidth;
    const lefts = fades.map((fade, index) => `${left + (index ? width - fade.offsetWidth : 0)}px`);
    fades.forEach((fade, index) => {
      fade.style.top = top;
      fade.style.height = height;
      fade.style.left = lefts[index];
    });
  }

  const render = () => {
    Array.from(lines.querySelectorAll(".bl__row, .bl__rotated")).forEach((row) => row.remove());
    spans = [];
    hideCaret();
    if (layer.rotated && layer.raster) {
      const note = document.createElement("p");
      note.className = "bl__rotated";
      note.textContent = T("This text is rotated: it keeps Photoshop's pixels, and its lines can't be changed here yet.");
      lines.appendChild(note);
      hint.hidden = true;
      count.textContent = "";
      count.removeAttribute("title");
      $("breaks-fewer").disabled = true;
      $("breaks-more").disabled = true;
      $("breaks-balance").disabled = true;
      showEnds();
      return;
    }
    const lt = layer.params.layerText;
    const style = lt.textStyleRange[0].textStyle;
    const paragraph = lt.paragraphStyleRange[0].paragraphStyle;
    lines.style.font = PS.cssFont(style, fontSize());
    lines.style.lineHeight = "1.25";
    lines.style.textAlign = paragraph.alignment || "center";
    lines.style.textTransform = style.fontCaps === "allCaps" ? "uppercase" : "none";
    // The letters and the uppercase follow the text language, as on the page: a Turkish i becomes İ
    lines.lang = PS.languageTagOf(style);
    let row = null;
    const startRow = () => {
      row = document.createElement("div");
      row.className = "bl__line";
      const wrap = document.createElement("div");
      wrap.className = "bl__row";
      wrap.appendChild(row);
      sheet.appendChild(wrap);
      return wrap;
    };
    startRow();
    const sorted = Array.from(breakSet).sort((a, b) => a - b);
    model.chars.forEach((item, index) => {
      if (breakSet.has(index)) {
        const previous = model.chars[index - 1];
        const mark = document.createElement("button");
        mark.type = "button";
        mark.className = "bl__m" + (previous.ch === " " || previous.ch === "-" ? "" : " bl__m--cut");
        mark.dataset.at = index;
        mark.innerHTML = previous.ch === " " || previous.ch === "-" ? "↵" : "<b>-</b>↵";
        mark.title = T("Click to join these lines. Drag to move the break.");
        mark.setAttribute("aria-label", T("Remove this line break"));
        row.appendChild(mark);
        startRow();
      }
      // The space a break replaced isn't drawn
      if (item.ch === " " && breakSet.has(index + 1)) return;
      const span = document.createElement("span");
      span.className = "bl__c" + (syllableSet.has(index + 1) ? " is-syl" : "");
      span.dataset.i = index;
      span.textContent = item.ch;
      row.appendChild(span);
      spans[index] = span;
    });
    const total = sorted.length + 1;
    count.textContent = total;
    count.title = total > 1 ? fill(T("{count} lines"), { count: total }) : T("1 line");
    $("breaks-fewer").disabled = total <= 1;
    $("breaks-more").disabled = total > allGaps().length;
    $("breaks-balance").disabled = false;
    hint.hidden = !showHint;
    fitLines();
  };
  const fill = (text, values) => Object.keys(values).reduce((out, key) => out.split(`{${key}}`).join(values[key]), text);

  const update = () => {
    const doc = app.doc;
    const next = root.hidden ? null : activeText();
    root.classList.toggle("is-typing", App.isEditing());
    empty.hidden = Boolean(next) || root.hidden;
    root.classList.toggle("is-empty", !next);
    if (!next || !doc) {
      if (layer) clearPreview();
      layer = null;
      model = null;
      shownKey = "";
      shownState = null;
      hint.hidden = true;
      Array.from(lines.querySelectorAll(".bl__row, .bl__rotated")).forEach((row) => row.remove());
      count.textContent = "";
      ["breaks-fewer", "breaks-more", "breaks-balance"].forEach((id) => { $(id).disabled = true; });
      showEnds();
      return;
    }
    // The document's state and its layers are replaced, never changed in place: the same
    // objects as last time mean the same text, before the key below is even made
    if (shownKey && layer === next && doc === shownDoc && doc.state === shownState && window.TypeRFonts.generation === shownFonts && Hyphenation.isLoaded(language) === shownLoaded) return;
    const text = next.params.layerText.textKey;
    language = choice === "auto" ? Hyphenation.resolve(text) : choice;
    const key = JSON.stringify([next.id, text, next.params.layerText.textStyleRange, next.params.layerText.textShape, language, Hyphenation.isLoaded(language)]);
    shownDoc = doc;
    shownState = doc.state;
    shownFonts = window.TypeRFonts.generation;
    shownLoaded = Hyphenation.isLoaded(language);
    if (key === shownKey && layer) {
      layer = next;
      return;
    }
    if (!layer || layer.id !== next.id) lines.scrollLeft = 0;
    layer = next;
    shownKey = key;
    model = PS.lineModel(layer, doc);
    breakSet = new Set(model.breaks);
    findSyllables();
    showLanguage();
    render();
    if (!Hyphenation.isLoaded(language)) {
      Hyphenation.load(language).then(() => {
        shownKey = "";
        update();
      }).catch((error) => console.warn("SG Typer Studio: no hyphenation patterns", error));
    }
  };

  /* -------------------------------- choosing ------------------------------- */

  const boundaryX = (at, reference) => {
    const after = spans[at];
    const before = spans[at - 1];
    if (after && reference && Math.abs(after.getBoundingClientRect().top - reference.top) < 2) return after.getBoundingClientRect().left;
    if (before) return before.getBoundingClientRect().right;
    return after ? after.getBoundingClientRect().left : 0;
  };

  // The break nearest the pointer: between words, after a hyphen, at a syllable.
  // With Alt, between any two letters.
  const pick = (event) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const span = element && element.closest && element.closest(".bl__c");
    if (!span || !model) return null;
    const index = Number(span.dataset.i);
    const rect = span.getBoundingClientRect();
    const chars = model.chars;
    const options = [];
    if (chars[index].ch === " ") options.push(index + 1);
    else {
      const [start, end] = wordBounds(index);
      if (start > 0 && chars[start - 1].ch === " ") options.push(start);
      if (end < chars.length && chars[end].ch === " ") options.push(end + 1);
      for (let at = start + 1; at < end; at++) {
        if (chars[at - 1].ch === "-" || syllableSet.has(at)) options.push(at);
      }
      if (event.altKey || cutAnywhere) {
        const free = event.clientX < rect.left + rect.width / 2 ? index : index + 1;
        if (free > start && free < end) options.splice(0, options.length, free);
      }
    }
    const usable = options.filter((at) => at > 0 && at < chars.length && (!breakSet.has(at) || (drag && drag.at === at)));
    if (!usable.length) return null;
    let best = usable[0];
    let distance = Infinity;
    usable.forEach((at) => {
      const gap = Math.abs(boundaryX(at, rect) - event.clientX);
      if (gap < distance) {
        distance = gap;
        best = at;
      }
    });
    return { at: best, rect };
  };

  const showCaret = (at, rect) => {
    const box = root.getBoundingClientRect();
    const x = boundaryX(at, rect) - box.left;
    const previous = model.chars[at - 1];
    caret.hidden = false;
    caret.style.left = `${x}px`;
    caret.style.top = `${rect.top - box.top}px`;
    caret.style.height = `${rect.height}px`;
    const hyphen = previous.ch !== " " && previous.ch !== "-";
    badge.textContent = hyphen ? "-↵" : "↵";
    badge.classList.toggle("is-cut", hyphen);
  };
  function hideCaret() {
    caret.hidden = true;
  }

  const clearPreview = () => {
    ops.previewBreaks(null);
  };
  const preview = (list) => {
    if (layer) ops.previewBreaks(layer.id, model, list);
  };
  const commit = (list) => {
    if (!layer) return;
    App.warnMissingFont(layer);
    ops.setLineBreaks(layer.id, model, list);
    hover = null;
  };

  /* ---------------------------- the automatic ones --------------------------- */

  const allGaps = () => {
    const out = [];
    model.chars.forEach((item, index) => {
      if (index > 0 && index < model.chars.length && (model.chars[index - 1].ch === " " || model.chars[index - 1].ch === "-") && item.ch !== " ") out.push(index);
    });
    return out;
  };

  // The best breaks for a number of lines: fuller in the middle, as a bubble is
  const balanced = (total) => {
    const gaps = allGaps();
    const take = Math.max(0, Math.min(gaps.length, total - 1));
    if (!take) return [];
    const doc = app.doc;
    const edges = [0].concat(gaps, [model.chars.length]);
    const widthOf = (a, b) => {
      let end = edges[b];
      if (model.chars[end - 1] && model.chars[end - 1].ch === " ") end--;
      return PS.lineWidth(model.chars.slice(edges[a], end), doc);
    };
    const whole = widthOf(0, edges.length - 1);
    const count_ = take + 1;
    const profile = Array.from({ length: count_ }, (_, i) => 0.85 + 0.3 * Math.sin((Math.PI * (i + 0.5)) / count_));
    const sum = profile.reduce((a, b) => a + b, 0);
    const targets = profile.map((value) => (whole * value) / sum);
    const memo = new Map();
    const solve = (line, from) => {
      const key = line * 10000 + from;
      if (memo.has(key)) return memo.get(key);
      let result;
      if (line === count_ - 1) {
        const miss = widthOf(from, edges.length - 1) - targets[line];
        result = { cost: miss * miss, next: -1 };
      } else {
        result = { cost: Infinity, next: -1 };
        const remaining = count_ - 1 - line;
        for (let to = from + 1; to <= edges.length - 1 - remaining; to++) {
          const miss = widthOf(from, to) - targets[line];
          const rest = solve(line + 1, to);
          const cost = miss * miss + rest.cost;
          if (cost < result.cost) result = { cost, next: to };
        }
      }
      memo.set(key, result);
      return result;
    };
    const out = [];
    let at = 0;
    for (let line = 0; line < count_ - 1; line++) {
      const next = solve(line, at).next;
      if (next < 0) break;
      out.push(edges[next]);
      at = next;
    }
    return out;
  };

  /* -------------------------------- gestures ------------------------------- */

  // Where the pointer last was, to follow it when the text scrolls under it
  let pointer = null;

  const track = (event) => {
    if (!layer || !model) return;
    if (drag) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3) drag.moved = true;
      if (!drag.moved) return;
      const found = pick(event);
      if (found) {
        showCaret(found.at, found.rect);
        drag.to = found.at;
        preview(Array.from(breakSet).filter((at) => at !== drag.at).concat(found.at));
      }
      return;
    }
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const mark = element && element.closest && element.closest(".bl__m");
    if (mark) {
      hideCaret();
      const at = Number(mark.dataset.at);
      if (!hover || hover.mark !== at) {
        hover = { mark: at };
        preview(Array.from(breakSet).filter((item) => item !== at));
      }
      return true;
    }
    const found = pick(event);
    if (!found) {
      hideCaret();
      if (hover) {
        hover = null;
        clearPreview();
      }
      return;
    }
    showCaret(found.at, found.rect);
    if (!hover || hover.at !== found.at) {
      hover = { at: found.at };
      preview(Array.from(breakSet).concat(found.at));
    }
  };

  // Near a side, a line too long for the panel scrolls, faster the closer the pointer is to
  // the edge; away from the sides the text stays still under the pointer. A ↵ stops it.
  let panning = 0;
  let panTime = 0;
  const edge = () => (Shell.touch ? 64 : 40);
  const panSpeed = () => {
    if (!pointer || pointer.onMark || lines.scrollWidth <= lines.clientWidth) return 0;
    const box = lines.getBoundingClientRect();
    const zone = edge();
    const left = (zone - (pointer.clientX - box.left)) / zone;
    const right = (zone - (box.right - pointer.clientX)) / zone;
    if (left > 0) return -(150 + 650 * Math.min(1, left));
    if (right > 0) return 150 + 650 * Math.min(1, right);
    return 0;
  };
  const pan = (time) => {
    const speed = panSpeed();
    const end = lines.scrollWidth - lines.clientWidth;
    if (!speed || (speed < 0 ? lines.scrollLeft <= 0 : lines.scrollLeft >= end - 1)) {
      panning = 0;
      panTime = 0;
      return;
    }
    if (panTime) lines.scrollLeft += (speed * Math.min(50, time - panTime)) / 1000;
    panTime = time;
    panning = window.requestAnimationFrame(pan);
  };
  const follow = (event) => {
    pointer = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey, onMark: false };
    pointer.onMark = track(pointer) === true;
    if (!panning && panSpeed()) panning = window.requestAnimationFrame(pan);
  };
  const stopPanning = () => {
    pointer = null;
    if (panning) window.cancelAnimationFrame(panning);
    panning = 0;
    panTime = 0;
  };

  lines.addEventListener("pointermove", follow);
  lines.addEventListener("scroll", () => {
    showEnds();
    if (pointer) pointer.onMark = track(pointer) === true;
  });
  lines.addEventListener("pointerleave", () => {
    if (drag) return;
    stopPanning();
    hideCaret();
    hover = null;
    if (layer) clearPreview();
  });
  lines.addEventListener("pointerdown", (event) => {
    openedMenu = false;
    if (!layer || event.button !== 0) return;
    event.preventDefault();
    const mark = event.target.closest && event.target.closest(".bl__m");
    if (mark) {
      drag = { at: Number(mark.dataset.at), x: event.clientX, y: event.clientY, moved: false, to: null };
      lines.setPointerCapture(event.pointerId);
    }
  });
  lines.addEventListener("pointerup", (event) => {
    if (Shell.touch) stopPanning();
    if (!layer || event.button !== 0 || openedMenu) return;
    if (drag) {
      const current = drag;
      drag = null;
      if (!current.moved) commit(Array.from(breakSet).filter((at) => at !== current.at));
      else if (current.to !== null && current.to !== current.at) commit(Array.from(breakSet).filter((at) => at !== current.at).concat(current.to));
      else clearPreview();
      return;
    }
    const found = pick(event);
    if (found) commit(Array.from(breakSet).concat(found.at));
  });
  lines.addEventListener("pointercancel", () => {
    stopPanning();
    drag = null;
    clearPreview();
  });

  // The break before the line under the pointer, if it's on the line's first word or left of it
  const breakOfLineStart = (event) => {
    const row = Array.from(lines.querySelectorAll(".bl__row")).find((item) => {
      const box = item.getBoundingClientRect();
      return event.clientY >= box.top && event.clientY < box.bottom;
    });
    const first = row && row.querySelector(".bl__c");
    const at = first ? Number(first.dataset.i) : -1;
    if (!breakSet.has(at)) return null;
    let last = at;
    while (last + 1 < model.chars.length && model.chars[last + 1].ch !== " " && !breakSet.has(last + 1)) last++;
    return event.clientX <= spans[last].getBoundingClientRect().right ? at : null;
  };
  // Right-click: the same as clicking the ↵, from the start of the next line. On a Mac,
  // Ctrl+click comes as a left click followed by this, and that click mustn't cut anything.
  lines.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openedMenu = true;
    if (!layer || !model) return;
    const mark = event.target.closest && event.target.closest(".bl__m");
    const at = mark ? Number(mark.dataset.at) : breakOfLineStart(event);
    if (at !== null) commit(Array.from(breakSet).filter((item) => item !== at));
  });

  const footButton = (id, compute) => {
    const button = $(id);
    button.addEventListener("mouseenter", () => {
      if (layer && !button.disabled) preview(compute());
    });
    button.addEventListener("mouseleave", () => {
      if (layer) clearPreview();
    });
    button.addEventListener("click", () => {
      if (layer && !button.disabled) commit(compute());
    });
  };
  footButton("breaks-fewer", () => balanced(breakSet.size));
  footButton("breaks-more", () => balanced(breakSet.size + 2));
  footButton("breaks-balance", () => balanced(breakSet.size + 1));

  // From the keys, the panel open or not: one line less or more on the active text
  const stepLines = (direction) => {
    const doc = app.doc;
    const target = activeText();
    if (!doc || !target || (target.rotated && target.raster)) return;
    const shown = layer && model && layer.id === target.id ? null : { layer, model, breakSet };
    if (shown) {
      layer = target;
      model = PS.lineModel(target, doc);
      breakSet = new Set(model.breaks);
    }
    try {
      const total = breakSet.size + 1;
      if (direction < 0 ? total > 1 : total <= allGaps().length) commit(balanced(total + direction));
    } finally {
      // The panel, closed, shows nothing again
      if (shown && layer === target) ({ layer, model, breakSet } = shown);
    }
  };

  /* ------------------------------- the panel ------------------------------- */

  root.addEventListener("pointerleave", () => {
    if (!drag) fitLines();
  });
  new ResizeObserver(fitLines).observe(lines);

  const languageSelect = $("breaks-language");
  ["auto"].concat(Hyphenation.LANGUAGES).forEach((code) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = code.toUpperCase();
    languageSelect.appendChild(option);
  });
  languageSelect.value = choice;
  languageSelect.title = T("Hyphenation language");
  languageSelect.setAttribute("aria-label", T("Hyphenation language"));
  languageSelect.addEventListener("change", () => {
    choice = languageSelect.value;
    remember();
    shownKey = "";
    update();
  });
  // What "auto" found in this text
  function showLanguage() {
    languageSelect.options[0].textContent = `${T("Auto")} (${language ? language.toUpperCase() : "–"})`;
  }

  root.setAttribute("aria-label", T("Line Breaks"));
  $("breaks-title").textContent = T("Line Breaks");
  $("breaks-balance").title = T("Balance");
  $("breaks-balance").setAttribute("aria-label", T("Balance"));

  // Alt stands out in the explanations: cutting anywhere is the easy one to miss
  const explanations = T("Alt: cut anywhere. Right-click the start of a line or a ↵ to join it to the one above.");
  const helpButton = $("breaks-help");
  const showExplanations = () => {
    hint.textContent = "";
    if (Shell.touch) {
      hint.textContent = T("Slide a finger along the text and lift it where the line should break. Tap a ↵ to join, drag it to move it.");
      helpButton.title = hint.textContent;
      return;
    }
    explanations.split("Alt").forEach((part, index) => {
      if (index) {
        const key = document.createElement("kbd");
        key.textContent = "Alt";
        hint.appendChild(key);
      }
      hint.appendChild(document.createTextNode(part));
    });
    helpButton.title = explanations;
  };
  showExplanations();
  Shell.onChange(() => {
    showExplanations();
    shownKey = "";
    update();
  });
  helpButton.setAttribute("aria-label", T("Help"));
  const showHelpState = () => {
    helpButton.classList.toggle("is-on", showHint);
    helpButton.setAttribute("aria-expanded", String(showHint));
  };
  showHelpState();
  helpButton.addEventListener("click", () => {
    showHint = !showHint;
    hint.hidden = !showHint;
    showHelpState();
    remember();
  });

  const cutButton = $("breaks-cut");
  cutButton.innerHTML = App.ICON.cut;
  cutButton.title = T("Cut anywhere");
  cutButton.setAttribute("aria-label", T("Cut anywhere"));
  cutButton.addEventListener("click", () => {
    cutAnywhere = !cutAnywhere;
    cutButton.classList.toggle("is-on", cutAnywhere);
    cutButton.setAttribute("aria-pressed", String(cutAnywhere));
  });

  $("breaks-fewer").title = T("One line less");
  $("breaks-fewer").setAttribute("aria-label", T("One line less"));
  $("breaks-more").title = T("One line more");
  $("breaks-more").setAttribute("aria-label", T("One line more"));
  empty.textContent = T("Select a text layer to set its line breaks.");

  PS.on((type, detail) => {
    // A render of a part of the page (a brush stroke, a layer dragged) changes no text
    if (type === "render" && detail) return;
    if (type === "render" || type === "history" || type === "document" || type === "editing" || type === "workspace") update();
  });
  update();

  window.TypeRBreaks = {
    get open() { return window.TypeRWorkspace.isVisible("breaks"); },
    toggle: () => window.TypeRWorkspace.toggle("breaks"),
    fewer: () => stepLines(-1),
    more: () => stepLines(1),
    get model() { return model; },
  };
})();
