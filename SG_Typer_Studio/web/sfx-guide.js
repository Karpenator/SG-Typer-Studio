// The SFX tool's guide: every shortcut on one card, each shown by a small looping drawing, and
// a practice of ten steps on a page of its own, each step passed by doing it. The practice is
// offered once, the first time the tool is picked; Help → SFX Guide and the ? of the options bar
// bring both back.

(function () {
  "use strict";

  const PS = window.TypeRPhotoshop;
  const { app, ops } = PS;
  const SFX = () => window.TypeRSFX;
  const App = () => window.TypeRApp;
  const T = (text) => (App() ? App().T(text) : text);
  const IS_MAC = /mac/i.test(navigator.platform || "");
  const STORE = "typer.web.sfx.guide";
  const SVGNS = "http://www.w3.org/2000/svg";

  const remembered = () => {
    try {
      return window.localStorage.getItem(STORE) || "";
    } catch (error) {
      return "";
    }
  };
  const remember = (value) => {
    try {
      window.localStorage.setItem(STORE, value);
    } catch (error) {
      // Private window: the offer may come again, nothing else
    }
  };

  const el = (tag, className, parent, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  };

  /* ------------------------------- the keys ------------------------------- */

  // A key as this computer names it; the mouse's part in words
  const MOUSE = { click: "click", drag: "drag", dblclick: "double-click" };
  const capOf = (token) => {
    if (token === "Cmd") return IS_MAC ? "⌘" : "Ctrl";
    if (token === "Alt") return IS_MAC ? "⌥" : "Alt";
    if (token === "Shift") return IS_MAC ? "⇧" : "Shift";
    if (token === "Backspace") return IS_MAC ? "⌫" : "Backspace";
    if (token === "Space") return T("Space");
    return token;
  };
  // ["Alt", "drag"]: Alt + drag. "/" between two keys: either one.
  const capsInto = (parent, keys) => {
    keys.forEach((token, index) => {
      if (token === "/") {
        el("span", "sfxg__or", parent, "/");
        return;
      }
      if (index && keys[index - 1] !== "/") el("span", "sfxg__plus", parent, "+");
      if (MOUSE[token]) el("span", "sfxg__mouse", parent, T(MOUSE[token]));
      else el("kbd", "sk__cap", parent, capOf(token));
    });
    return parent;
  };
  const keysText = (keys) => keys.map((token, index) => (token === "/" ? " / " : (index && keys[index - 1] !== "/" ? " + " : "") + (MOUSE[token] ? T(MOUSE[token]) : capOf(token)))).join("");
  // "Hold {Shift} and drag": the keys drawn in the sentence
  const sentence = (parent, text) => {
    String(text).split(/(\{[^{}\s]+\})/).forEach((part) => {
      const key = /^\{([^{}\s]+)\}$/.exec(part);
      if (key) el("kbd", "sk__cap", parent, capOf(key[1]));
      else if (part) parent.appendChild(document.createTextNode(part));
    });
    return parent;
  };

  /* --------------------------- the small drawings --------------------------- */

  // A word on a path, 110 × 44, drawn again and again: `p` goes 0 → 1 → 0 in each loop
  const W = 110;
  const H = 44;
  const A = [14, 24];
  const B = [82, 24];
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const phase = (u) => (u < 0.12 ? 0 : u < 0.55 ? ease((u - 0.12) / 0.43) : u < 0.8 ? 1 : 1 - ease((u - 0.8) / 0.2));
  const notches = (p, n) => Math.round(p * n) / n;
  const between = (u, a, b) => u >= a && u < b;
  // The letters of BOOM between two points, sized with the distance
  const onLine = (a, b, word = "BOOM") => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const k = len / 68;
    return word.split("").map((ch, i) => {
      const d = (10 + 16 * i) * k;
      return { ch, x: a[0] + Math.cos(angle) * d, y: a[1] + Math.sin(angle) * d, r: (angle * 180) / Math.PI, s: k, o: 1 };
    });
  };
  const still = () => onLine(A, B);
  // Along a curve given as a function of t in 0..1
  const onCurve = (at, word = "BOOM") => word.split("").map((ch, i) => {
    const t = (10 + 16 * i) / 68;
    const [x, y] = at(t);
    const [x2, y2] = at(Math.min(1, t + 0.01));
    const [x1, y1] = at(Math.max(0, t - 0.01));
    return { ch, x, y, r: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI, s: 1, o: 1 };
  });
  const curvePoints = (at, upTo = 1) => {
    const points = [];
    for (let i = 0; i <= 24; i++) points.push(at((i / 24) * upTo));
    return points;
  };
  // Created, then gone again before the next loop
  const shown = (u, from) => (u < from ? 0 : u < 0.86 ? 1 : 1 - ease((u - 0.86) / 0.12));
  const pop = (u, from) => (u < from ? 0 : ease((u - from) / 0.1));

  const DEMOS = {
    "make-click": (u) => {
      const o = shown(u, 0.18);
      return { L: still().map((l) => Object.assign(l, { s: 0.6 + 0.4 * pop(u, 0.18), o })), ptr: [50, 31], press: between(u, 0.1, 0.18) };
    },
    "make-line": (u) => {
      const a = [16, 32];
      const end = [86, 14];
      const p = ease((u - 0.12) / 0.38);
      const b = lerp(a, end, p);
      const o = shown(u, 0.52);
      return { guide: u < 0.52 && u > 0.12 ? [a, b] : null, L: o ? onLine(a, end).map((l) => Object.assign(l, { o })) : [], ptr: u < 0.52 ? b : end, press: between(u, 0.1, 0.52) };
    },
    "make-free": (u) => {
      const at = (t) => [16 + 70 * t, 26 - 11 * Math.sin(Math.PI * t * 1.15)];
      const p = ease((u - 0.12) / 0.38);
      const o = shown(u, 0.52);
      return { guide: u < 0.52 && u > 0.12 ? curvePoints(at, p) : null, L: o ? onCurve(at).map((l) => Object.assign(l, { o })) : [], ptr: at(u < 0.52 ? p : 1), press: between(u, 0.1, 0.52) };
    },
    "make-bubble": (u) => {
      const o = shown(u, 0.2);
      return { bubble: true, L: o ? onLine([22, 23], [90, 23]).map((l) => Object.assign(l, { s: 1.12 * (0.7 + 0.3 * pop(u, 0.2)), o })) : [], ptr: [56, 30], press: between(u, 0.1, 0.18) };
    },
    "end-path": (u) => {
      const b = lerp(B, [90, 10], phase(u));
      return { L: onLine(A, b), ends: [A, b], ptr: b, press: phase(u) > 0 };
    },
    "end-shift": (u) => {
      const p = phase(u);
      const sizes = [0, 1, 2, 3].map((i) => 1 + p * 0.5 * (i / 3));
      const L = [];
      let x = A[0] + 10 * sizes[0];
      "BOOM".split("").forEach((ch, i) => {
        if (i) x += 8 * (sizes[i - 1] + sizes[i]);
        L.push({ ch, x, y: 24, r: 0, s: sizes[i], o: 1 });
      });
      const end = [x + 10 * sizes[3], 24];
      return { L, ends: [A, end], ptr: end, press: p > 0 };
    },
    "end-alt": (u) => {
      const p = phase(u);
      return { L: still().map((l) => Object.assign(l, { r: 40 * p })), ends: [A, B], ptr: [B[0] + 4 * p, B[1] - 10 * p], press: p > 0 };
    },
    "end-cmd": (u) => {
      const p = phase(u);
      const L = still().map((l, i) => Object.assign(l, { x: 24 + i * (16 + 6 * p) }));
      const end = [L[3].x + 10, 24];
      return { L, ends: [A, end], ptr: end, press: p > 0 };
    },
    "end-cmdshift": (u) => {
      const f = 1 + 0.22 * phase(u);
      const L = still().map((l) => Object.assign(l, { x: A[0] + (l.x - A[0]) * f, s: f }));
      const end = [A[0] + 68 * f, 24];
      return { L, ends: [A, end], ptr: end, press: f > 1 };
    },
    "end-space": (u) => {
      const p = phase(u);
      const d = [10 * p, -7 * p];
      const move = (q) => [q[0] + d[0], q[1] + d[1]];
      return { L: still().map((l) => Object.assign(l, { x: l.x + d[0], y: l.y + d[1] })), ends: [move(A), move(B)], ptr: move(B), press: p > 0 };
    },
    "end-bend": (u) => {
      const p = phase(u);
      const lift = 26 * p;
      const at = (t) => [A[0] + 68 * t, 24 + 6 * p - lift * 4 * t * (1 - t) * 0.5 * 2];
      const mid = at(0.5);
      return { L: onCurve(at), ends: [at(0), at(1)], guide: curvePoints(at), bend: mid, ptr: mid, press: p > 0 };
    },
    "letter-pick": (u) => ({ L: still(), box: u > 0.17 && u < 0.92 ? 1 : null, ptr: [40, 27], press: between(u, 0.1, 0.17) }),
    "letter-drag": (u) => {
      const p = phase(u);
      const L = still();
      L[1].x += 7 * p;
      L[1].y -= 9 * p;
      return { L, box: 1, ptr: [40 + 7 * p, 27 - 9 * p], press: p > 0 };
    },
    "letter-altdrag": (u) => {
      const p = phase(u);
      const d = [10 * p, -7 * p];
      return { L: still().map((l) => Object.assign(l, { x: l.x + d[0], y: l.y + d[1] })), ptr: [40 + d[0], 27 + d[1]], press: p > 0 };
    },
    "letter-dblclick": (u) => {
      const L = still();
      if (u > 0.42 && u < 0.9) L[2].ch = "U";
      return { L, box: u > 0.22 ? 2 : null, ptr: [56, 27], press: between(u, 0.1, 0.14) || between(u, 0.18, 0.22), caret: u > 0.22 && u < 0.42 ? 2 : null };
    },
    "letter-knob": (u) => {
      const p = phase(u);
      const L = still();
      L[1].r = 35 * p;
      const a = ((35 * p - 90) * Math.PI) / 180;
      return { L, box: 1, knob: true, ptr: [L[1].x + Math.cos(a) * 17, L[1].y + Math.sin(a) * 17], press: p > 0 };
    },
    "letter-corner": (u) => {
      const p = phase(u);
      const L = still();
      L[1].s = 1 + 0.45 * p;
      return { L, box: 1, corner: true, ptr: [L[1].x + 6.5 * L[1].s, L[1].y + 9 * L[1].s], press: p > 0 };
    },
    "key-arrows": (u) => {
      const q = notches(phase(u), 4);
      const L = still();
      L[1].x += 8 * q;
      L[1].y -= 4 * q;
      return { L, box: 1 };
    },
    "key-brackets": (u) => {
      const L = still();
      L[1].r = 30 * notches(phase(u), 3);
      return { L, box: 1 };
    },
    "key-plus": (u) => {
      const L = still();
      L[1].s = 1 + 0.45 * notches(phase(u), 3);
      return { L, box: 1 };
    },
    "key-tab": (u) => ({ L: still(), box: 1 + Math.min(2, Math.floor(phase(u) * 3)) }),
    "key-enter": (u) => {
      const L = still();
      if (u > 0.42 && u < 0.9) L[2].ch = "U";
      return { L, box: 2, caret: u > 0.15 && u < 0.42 ? 2 : null };
    },
    "key-delete": (u) => {
      const p = phase(u);
      const L = still();
      L[1].o = 1 - ease(p * 2);
      L[2].x -= 16 * ease(p * 2 - 0.6);
      L[3].x -= 16 * ease(p * 2 - 0.6);
      return { L, box: p < 0.3 ? 1 : null };
    },
    "key-esc": (u) => ({ L: still(), box: phase(u) < 0.5 ? 1 : null, ends: phase(u) >= 0.5 ? [A, B] : null }),
  };

  const n1 = (value) => Math.round(value * 10) / 10;
  const letterBox = (l) => `<rect x="${n1(l.x - 6.5 * l.s)}" y="${n1(l.y - 9 * l.s)}" width="${n1(13 * l.s)}" height="${n1(18 * l.s)}" transform="rotate(${n1(l.r)} ${n1(l.x)} ${n1(l.y)})" class="sfxg__box"/>`;
  const drawScene = (scene) => {
    let out = "";
    if (scene.bubble) out += '<ellipse cx="56" cy="23" rx="46" ry="18" class="sfxg__bubble"/>';
    if (scene.guide) out += `<polyline points="${scene.guide.map((q) => `${n1(q[0])},${n1(q[1])}`).join(" ")}" class="sfxg__guide"/>`;
    else if (scene.ends) out += `<line x1="${n1(scene.ends[0][0])}" y1="${n1(scene.ends[0][1])}" x2="${n1(scene.ends[1][0])}" y2="${n1(scene.ends[1][1])}" class="sfxg__guide"/>`;
    (scene.L || []).forEach((l) => {
      if (l.o <= 0.01) return;
      out += `<text x="${n1(l.x)}" y="${n1(l.y)}" font-size="${n1(18 * l.s)}" opacity="${n1(l.o)}" transform="rotate(${n1(l.r)} ${n1(l.x)} ${n1(l.y)})" class="sfxg__letter">${l.ch}</text>`;
    });
    const boxed = scene.box !== null && scene.box !== undefined ? scene.L[scene.box] : null;
    if (boxed) {
      out += letterBox(boxed);
      if (scene.knob) {
        const a = ((boxed.r - 90) * Math.PI) / 180;
        const top = [boxed.x + Math.cos(a) * 9 * boxed.s, boxed.y + Math.sin(a) * 9 * boxed.s];
        const knob = [boxed.x + Math.cos(a) * 17, boxed.y + Math.sin(a) * 17];
        out += `<line x1="${n1(top[0])}" y1="${n1(top[1])}" x2="${n1(knob[0])}" y2="${n1(knob[1])}" class="sfxg__stem"/><circle cx="${n1(knob[0])}" cy="${n1(knob[1])}" r="2.4" class="sfxg__knob"/>`;
      }
      if (scene.corner) out += `<rect x="${n1(boxed.x + 6.5 * boxed.s - 2)}" y="${n1(boxed.y + 9 * boxed.s - 2)}" width="4" height="4" class="sfxg__end"/>`;
    }
    if (scene.caret !== null && scene.caret !== undefined) {
      const l = scene.L[scene.caret];
      out += `<rect x="${n1(l.x - 6)}" y="${n1(l.y - 9)}" width="12" height="18" class="sfxg__typed"/>`;
    }
    if (scene.ends) scene.ends.forEach((q) => { out += `<rect x="${n1(q[0] - 2.5)}" y="${n1(q[1] - 2.5)}" width="5" height="5" class="sfxg__end"/>`; });
    if (scene.bend) out += `<circle cx="${n1(scene.bend[0])}" cy="${n1(scene.bend[1])}" r="2.6" class="sfxg__knob"/>`;
    if (scene.ptr) {
      const [x, y] = scene.ptr;
      if (scene.press) out += `<circle cx="${n1(x)}" cy="${n1(y)}" r="4.5" class="sfxg__press"/>`;
      out += `<path d="M${n1(x)} ${n1(y)}l0 10.5 2.6-2.4 2.3 4.8 1.8-.9-2.3-4.7 3.6-.3z" class="sfxg__ptr"/>`;
    }
    return out;
  };

  // One loop of frames for every drawing on screen; none when there is none
  const LOOP = 2600;
  const still2 = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const live = new Set();
  let frame = 0;
  let lastDrawn = 0;
  const tick = (now) => {
    frame = 0;
    live.forEach((node) => { if (!node.isConnected) live.delete(node); });
    if (!live.size) return;
    if (now - lastDrawn > 33) {
      lastDrawn = now;
      const u = (now % LOOP) / LOOP;
      live.forEach((node) => { node.innerHTML = drawScene(DEMOS[node.dataset.demo](u)); });
    }
    frame = requestAnimationFrame(tick);
  };
  const demo = (parent, name, className) => {
    const node = document.createElementNS(SVGNS, "svg");
    node.setAttribute("viewBox", `0 0 ${W} ${H}`);
    node.setAttribute("class", `sfxg__demo${className ? ` ${className}` : ""}`);
    node.setAttribute("aria-hidden", "true");
    node.dataset.demo = name;
    node.innerHTML = drawScene(DEMOS[name](0.6));
    parent.appendChild(node);
    if (!still2) {
      live.add(node);
      if (!frame) frame = requestAnimationFrame(tick);
    }
    return node;
  };

  /* --------------------------------- the card --------------------------------- */

  const GROUPS = [
    ["Make an SFX", "On the page, away from any SFX", [
      [["click"], "An SFX right there", "make-click"],
      [["drag"], "An SFX along the line you drag", "make-line"],
      [["Alt", "drag"], "Along a path you draw by hand", "make-free"],
      [["Shift", "click"], "Inside a bubble: the SFX fills it", "make-bubble"],
    ]],
    ["An end of the path", "The white squares at both ends", [
      [["drag"], "The path turns and stretches", "end-path"],
      [["Shift", "drag"], "This end bigger or smaller: the word grows or shrinks", "end-shift"],
      [["Alt", "drag"], "Every letter turns on itself", "end-alt"],
      [["Cmd", "drag"], "The letters further apart or closer", "end-cmd"],
      [["Cmd", "Shift", "drag"], "Every letter bigger or smaller", "end-cmdshift"],
      [["drag", "Space"], "Space pressed during the drag: the whole SFX moves", "end-space"],
      [["drag"], "The ● in the middle of an arc or a wave bends it", "end-bend"],
    ]],
    ["A letter, with the mouse", "Click a letter to pick it", [
      [["click"], "Picks it: its own bar opens", "letter-pick"],
      [["drag"], "Moves it", "letter-drag"],
      [["Alt", "drag"], "Moves the whole SFX", "letter-altdrag"],
      [["drag"], "Its ● turns it", "letter-knob"],
      [["drag"], "Its corner resizes it", "letter-corner"],
      [["dblclick"], "Type over it", "letter-dblclick"],
    ]],
    ["A letter, with the keyboard", "Once it is picked", [
      [["← ↑ → ↓"], "Moves it (Shift: 10 px)", "key-arrows"],
      [["[", "/", "]"], "Turns it (Shift: 15° at a time)", "key-brackets"],
      [["+", "/", "−"], "Bigger or smaller (Shift: faster)", "key-plus"],
      [["Tab"], "The next letter (Shift + Tab: the one before)", "key-tab"],
      [["Enter"], "Type over it", "key-enter"],
      [["Backspace"], "Takes it out of the word", "key-delete"],
      [["Esc"], "Back to the whole SFX", "key-esc"],
    ]],
  ];

  // Every shortcut as one line, for the Keyboard Shortcuts window
  const rows = () => GROUPS.flatMap(([group, , items]) => items.map(([keys, label]) => ({ keys, text: keysText(keys), label: `${T(label)} (${T(group)})` })));

  const show = async () => {
    if (!App()) return;
    const body = el("div", "sfxg");
    const top = el("div", "sfxg__top", body);
    el("p", "sfxg__intro", top, T("Every shortcut of the SFX tool (K). Undo works as everywhere: Cmd + Z.").replace(/Cmd/g, IS_MAC ? "Cmd" : "Ctrl"));
    const grid = el("div", "sfxg__grid", body);
    GROUPS.forEach(([title, about, items]) => {
      const box = el("section", "sfxg__group", grid);
      el("h3", "sfxg__title", box, T(title));
      el("p", "sfxg__about", box, T(about));
      items.forEach(([keys, label, name]) => {
        const row = el("div", "sfxg__row", box);
        demo(row, name);
        const text = el("div", "sfxg__text", row);
        capsInto(el("div", "sfxg__keys", text), keys);
        el("div", "sfxg__label", text, T(label));
      });
    });
    const pending = App().dialog({
      title: T("SFX Guide"),
      body,
      cancel: false,
      also: T("Practice (2 min)"),
      ok: T("Close"),
    });
    // Open by now: wider than a question
    const modal = body.closest("dialog");
    if (modal) modal.classList.add("modal--sfxguide");
    const answer = await pending;
    if (answer && answer.also) practise();
  };

  /* ------------------------------- the practice ------------------------------- */

  const STEPS = [
    { text: "Drag the white square at the right end of the path: the word turns and stretches with it.", demo: "end-path", mark: "end1", done: (d) => /^end/.test(d.mode) && d.ways.includes("path") },
    { text: "Now hold {Shift} while you drag an end: that end gets bigger or smaller, and the word grows or shrinks along its length.", demo: "end-shift", mark: "end1", done: (d) => /^end/.test(d.mode) && d.ways.includes("curve") },
    { text: "Hold {Alt} and drag an end: every letter turns on itself, the path stays.", demo: "end-alt", mark: "end1", done: (d) => /^end/.test(d.mode) && d.ways.includes("turn") },
    { text: "Hold {Cmd} and drag an end: the letters move apart or closer. With {Cmd} {Shift}, they all get bigger or smaller.", demo: "end-cmd", mark: "end1", done: (d) => /^end/.test(d.mode) && (d.ways.includes("spacing") || d.ways.includes("size")) },
    { text: "Start dragging an end, then press {Space} without letting go: the whole SFX moves.", demo: "end-space", mark: "end1", done: (d) => /^end/.test(d.mode) && d.ways.includes("move") },
    { text: "Click a letter to pick it, then move it with the arrow keys. {Tab} goes to the next letter.", demo: "key-arrows", mark: "letter", done: (d) => (d.mode === "key" && d.action === "move") || d.mode === "letter" },
    { text: "{[} and {]} turn the picked letter ({Shift}: 15° at a time). Its ● does the same with the mouse.", demo: "key-brackets", mark: "knob", done: (d) => (d.mode === "key" && d.action === "turn") || d.mode === "letterTurn" },
    { text: "{+} and {−} make it bigger or smaller. Its corner does the same with the mouse.", demo: "key-plus", mark: "corner", done: (d) => (d.mode === "key" && d.action === "size") || d.mode === "letterSize" },
    { text: "{Enter} or a double-click: type over the letter. Type another one, then {Enter}.", demo: "key-enter", mark: "letter", done: (d) => d.mode === "key" && d.action === "retype" },
    { text: "{Esc} lets the letter go. Last one: drag on an empty spot of the page, and a new SFX follows your line.", demo: "make-line", mark: null, done: (d) => d.mode === "create" },
  ];

  // A page of its own: a panel with a bubble, nothing to save
  const practicePage = () => {
    const canvas = PS.newCanvas(1400, 900);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1400, 900);
    ctx.fillStyle = "#dedede";
    ctx.fillRect(40, 40, 1320, 820);
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#111111";
    ctx.strokeRect(40, 40, 1320, 820);
    ctx.beginPath();
    ctx.ellipse(1110, 680, 170, 110, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.stroke();
    return canvas;
  };

  let coach = null;
  const endPractice = () => {
    if (!coach) return;
    const { card, stop, watch, before } = coach;
    coach = null;
    stop();
    clearInterval(watch);
    card.remove();
    window.removeEventListener("resize", placeCard);
    if (SFX()) {
      SFX().setMark(null);
      SFX().restoreDefaults(before);
    }
  };
  const placeCard = () => {
    if (!coach) return;
    const stage = document.getElementById("stage");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    coach.card.style.left = `${Math.round(rect.left + 12)}px`;
    coach.card.style.bottom = `${Math.round(window.innerHeight - rect.bottom + 12)}px`;
  };
  // Buttons of the card never keep the keys from the page
  const cardButton = (parent, label, action, main) => {
    const node = el("button", `btn${main ? " btn--main" : ""}`, parent, label);
    node.type = "button";
    node.addEventListener("pointerdown", (event) => event.preventDefault());
    node.addEventListener("click", () => {
      node.blur();
      action();
    });
    return node;
  };

  const practise = async () => {
    if (!App()) return;
    endPractice();
    remember("seen");
    // What the tool remembers for the next SFX (word, look) stays as it was before the practice
    const before = SFX().defaultsSnapshot();
    const name = `${T("SFX practice")}.psd`;
    const doc = ops.imageDocument(practicePage(), name, `new://sfx-practice-${PS.newId()}`);
    const page = doc || app.doc;
    App().setTool("sfx");
    // From the tool's own settings, not the ones kept from the last SFX: a letter turn or a wave
    // kept from it would make the word unlike the pictures of the steps
    await SFX().newSfx({ line: [[420, 400], [800, 400]], text: "BOOM", look: SFX().startingLook() });
    // Nothing to save until the practice changes it
    if (page && page.history && page.history[page.historyIndex]) page.savedId = page.history[page.historyIndex].id;
    SFX().drawOverlay();
    App().renderOptions();

    const card = el("div", "sfxg-coach");
    card.setAttribute("role", "status");
    const head = el("div", "sfxg-coach__head", card);
    const count = el("span", "sfxg-coach__count", head);
    const bar = el("div", "sfxg-coach__bar", head);
    const fillBar = el("span", "", bar);
    const text = el("p", "sfxg-coach__text", card);
    const art = el("div", "sfxg-coach__art", card);
    const foot = el("div", "sfxg-coach__foot", card);
    document.body.appendChild(card);
    let at = 0;
    let passing = false;
    const render = () => {
      const step = STEPS[at];
      count.textContent = App().fill(T("Step {n} of {total}"), { n: at + 1, total: STEPS.length });
      fillBar.style.width = `${(at / STEPS.length) * 100}%`;
      text.textContent = "";
      sentence(text, T(step.text));
      art.textContent = "";
      demo(art, step.demo, "sfxg__demo--big");
      foot.textContent = "";
      cardButton(foot, T("Skip this step"), next);
      cardButton(foot, T("Quit"), endPractice);
      card.classList.remove("is-passed");
      SFX().setMark(step.mark);
    };
    const finish = () => {
      SFX().setMark(null);
      remember("done");
      fillBar.style.width = "100%";
      count.textContent = T("Done!");
      text.textContent = T("You know the SFX tool. The whole list stays in Help → SFX Guide, and behind the ? of the options bar.");
      art.textContent = "";
      foot.textContent = "";
      cardButton(foot, T("Keep the page"), endPractice);
      cardButton(foot, T("Close the practice page"), async () => {
        const open = app.docs.find((one) => one === page);
        if (open) {
          if (open.history && open.history[open.historyIndex]) open.savedId = open.history[open.historyIndex].id;
          await App().closeDoc(open);
        }
        endPractice();
      }, true);
    };
    function next() {
      passing = false;
      at++;
      if (at >= STEPS.length) finish();
      else render();
    }
    const stop = SFX().onGesture((detail) => {
      if (passing || at >= STEPS.length) return;
      const d = Object.assign({ ways: [] }, detail);
      if (!STEPS[at].done(d)) return;
      passing = true;
      card.classList.add("is-passed");
      count.textContent = T("Well done!");
      setTimeout(next, 900);
    });
    // The practice ends with its page
    const watch = setInterval(() => {
      if (coach && page && !app.docs.includes(page)) endPractice();
    }, 500);
    coach = { card, stop, watch, before };
    window.addEventListener("resize", placeCard);
    placeCard();
    render();
  };

  /* --------------------------------- the offer --------------------------------- */

  // The first time the tool is picked, once: the practice is offered, never pushed
  let offered = false;
  const toolChosen = () => {
    if (offered || coach || window.TypeRShell.touch || remembered()) return;
    offered = true;
    setTimeout(async () => {
      if (app.tool !== "sfx" || coach || !App() || document.querySelector("dialog[open]")) {
        offered = false;
        return;
      }
      remember("offered");
      const answer = await App().dialog({
        title: T("New: the SFX tool"),
        body: T("Learn its shortcuts in 2 minutes, on a page of its own? Ten short steps, each passed by doing it."),
        cancel: T("Not now"),
        also: T("See the shortcuts"),
        ok: T("Start the practice"),
      });
      if (!answer) return;
      if (answer.also) show();
      else practise();
    }, 350);
  };

  window.TypeRSFXGuide = { show, practise, toolChosen, rows, capsInto, endPractice };
})();
