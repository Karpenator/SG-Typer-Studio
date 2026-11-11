// SG Typer Studio's tutorial: short lessons on a practice chapter of its own, each step passed by
// doing it in the real workspace. A card says what to do, a ring shows where (a tool, a bubble,
// a button of the panel, a menu), and "Show me" plays the gesture. The chapter is three pages
// drawn here, and its script waits in a tab of the panel's own: the user's pages and scripts
// stay as they are. Help → TypeR Tutorial lists the lessons; the setup assistant opens it.

(function () {
  "use strict";

  const PS = window.TypeRPhotoshop;
  const { app, ops } = PS;
  const App = () => window.TypeRApp;
  const Kit = () => window.TypeRKit;
  const T = (text) => (App() ? App().T(text) : text);
  const fill = (text, values) => Object.keys(values).reduce((out, key) => out.split(`{${key}}`).join(values[key]), text);
  const IS_MAC = /mac/i.test(navigator.platform || "");
  const STORE = "typer.web.guide";
  const TAB_ID = "typer-guide-practice";
  const FILE = (n) => `typer-practice-0${n}.png`;
  const PAGE_OF_PATH = /typer-practice-0(\d)\.png$/;
  const STILL = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --------------------------------- memory --------------------------------- */

  const remembered = () => {
    try {
      const value = JSON.parse(window.localStorage.getItem(STORE) || "null");
      return value && typeof value === "object" ? value : {};
    } catch (error) {
      return {};
    }
  };
  const remember = (change) => {
    const value = Object.assign(remembered(), change);
    try {
      window.localStorage.setItem(STORE, JSON.stringify(value));
    } catch (error) {
      // Private window: the progress is forgotten with the page, nothing else
    }
    return value;
  };
  const doneLessons = () => new Set(remembered().done || []);
  const markDone = (id) => {
    const done = doneLessons();
    done.add(id);
    remember({ done: Array.from(done) });
  };

  const el = (tag, className, parent, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  };

  /* ------------------------------- keys in words ------------------------------ */

  const capOf = (token) => {
    if (token === "Cmd") return IS_MAC ? "⌘" : "Ctrl";
    if (token === "Alt") return IS_MAC ? "⌥" : "Alt";
    if (token === "Shift") return IS_MAC ? "⇧" : "Shift";
    if (token === "Backspace") return IS_MAC ? "⌫" : "Backspace";
    if (token === "Enter") return IS_MAC ? "↩" : "Enter";
    if (token === "Space") return T("Space");
    if (token === "PageDown") return T("Page Down");
    if (token === "PageUp") return T("Page Up");
    return token;
  };
  // "Press {Cmd}{0}": the keys drawn in the sentence, "**word**" in bold
  const sentence = (parent, text) => {
    String(text).split(/(\{[^{}\s]+\}|\*\*[^*]+\*\*)/).forEach((part) => {
      const key = /^\{([^{}\s]+)\}$/.exec(part);
      const bold = /^\*\*([^*]+)\*\*$/.exec(part);
      if (key) el("kbd", "sk__cap", parent, capOf(key[1]));
      else if (bold) el("strong", null, parent, bold[1]);
      else if (part) parent.appendChild(document.createTextNode(part));
    });
    return parent;
  };

  /* ---------------------------- the practice chapter ---------------------------- */

  // Three pages of 1200 × 1700, drawn here. A spot is what a step points at, in page pixels:
  // its middle and half its size.
  const PAGE_W = 1200;
  const PAGE_H = 1700;
  const SPOTS = {
    1: { page: 1, shape: "ellipse", x: 770, y: 345, rx: 275, ry: 200 },
    2: { page: 1, shape: "ellipse", x: 250, y: 235, rx: 160, ry: 100 },
    3: { page: 1, shape: "rect", x: 310, y: 790, rx: 225, ry: 62 },
    4: { page: 1, shape: "spiky", x: 890, y: 965, rx: 215, ry: 195 },
    5: { page: 1, shape: "ellipse", x: 800, y: 1460, rx: 245, ry: 125 },
    6: { page: 2, shape: "ellipse", x: 830, y: 395, rx: 215, ry: 275 },
    7: { page: 2, shape: "ellipse", x: 330, y: 1235, rx: 170, ry: 205 },
    8: { page: 2, shape: "rect", x: 255, y: 360, rx: 80, ry: 225 },
    9: { page: 2, shape: "rect", x: 830, y: 1330, rx: 250, ry: 250 },
    10: { page: 3, shape: "ellipse", x: 600, y: 560, rx: 330, ry: 190 },
    // Text on the sky's gradient, and the sky from top to bottom beside it (the Gradients lesson)
    11: { page: 3, shape: "rect", x: 170, y: 260, rx: 90, ry: 140 },
    12: { page: 3, shape: "rect", x: 170, y: 470, rx: 70, ry: 420 },
  };
  const JP_FONT = "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Meiryo', 'Noto Sans JP', sans-serif";

  const drawPage = (number) => {
    const canvas = PS.newCanvas(PAGE_W, PAGE_H);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.lineJoin = "round";
    // A panel: its art inside, clipped, then its frame
    const panel = (x0, y0, x1, y1, art) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      art(x0, y0, x1, y1);
      ctx.restore();
      ctx.lineWidth = 7;
      ctx.strokeStyle = "#111111";
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    };
    // Screentone: dots growing from `from` to `to` across the area, top to bottom
    const tone = (x0, y0, x1, y1, from, to, step = 13) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = "#9a9a9a";
      for (let y = y0; y < y1 + step; y += step) {
        const r = from + (to - from) * Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
        const shift = (Math.round((y - y0) / step) % 2) * (step / 2);
        for (let x = x0 - step; x < x1 + step; x += step) {
          ctx.beginPath();
          ctx.arc(x + shift, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    const speedLines = (cx, cy, count, inner, outer, width) => {
      ctx.strokeStyle = "#1a1a1a";
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + (i % 3) * 0.013;
        const start = inner + ((i * 37) % 60);
        ctx.lineWidth = width * (0.4 + ((i * 53) % 10) / 10);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * start, cy + Math.sin(a) * start);
        ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
        ctx.stroke();
      }
    };
    const hills = (x0, x1, base, heights, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x0, base + 400);
      heights.forEach(([x, h]) => ctx.lineTo(x, base - h));
      ctx.lineTo(x1, base + 400);
      ctx.closePath();
      ctx.fill();
    };
    // A bubble and its tail drawn as one outline: both stroked twice as thick, then filled,
    // which covers the inner half of every line and the joint
    const ellipse = (spot, tail) => {
      const oval = () => {
        ctx.beginPath();
        ctx.ellipse(spot.x, spot.y, spot.rx, spot.ry, 0, 0, Math.PI * 2);
      };
      const point = () => {
        ctx.beginPath();
        ctx.moveTo(tail[0], tail[1]);
        ctx.lineTo(tail[2], tail[3]);
        ctx.lineTo(tail[4], tail[5]);
        ctx.closePath();
      };
      ctx.lineWidth = 10;
      ctx.strokeStyle = "#111111";
      ctx.fillStyle = "#ffffff";
      oval();
      ctx.stroke();
      if (tail) {
        point();
        ctx.stroke();
      }
      oval();
      ctx.fill();
      if (tail) {
        point();
        ctx.fill();
      }
    };
    const spiky = (spot) => {
      ctx.beginPath();
      const n = 18;
      for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
        const out = i % 2 === 0;
        const k = out ? 1 : 0.74 + ((i * 7) % 5) / 60;
        const x = spot.x + Math.cos(a) * spot.rx * k;
        const y = spot.y + Math.sin(a) * spot.ry * k;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#111111";
      ctx.stroke();
    };
    // Japanese set in columns, read from the right
    const vertical = (columns, cx, cy, size, color = "#111111") => {
      ctx.font = `700 ${size}px ${JP_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      const gap = size * 1.25;
      const right = cx + ((columns.length - 1) * gap) / 2;
      columns.forEach((column, i) => {
        const chars = Array.from(column);
        let y = cy - (chars.length * size * 1.08) / 2 + size * 0.54;
        chars.forEach((ch) => {
          ctx.fillText(ch, right - i * gap, y);
          y += size * 1.08;
        });
      });
    };
    const badge = (n, x, y) => {
      ctx.beginPath();
      ctx.arc(x, y, 27, 0, Math.PI * 2);
      ctx.fillStyle = "#1976d2";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 30px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n), x, y + 1);
    };
    const folio = () => {
      ctx.fillStyle = "#8a8a8a";
      ctx.font = "600 22px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`SG Typer Studio · ${number} / 3`, PAGE_W / 2, PAGE_H - 18);
    };

    if (number === 1) {
      panel(40, 40, 1160, 640, (x0, y0, x1, y1) => {
        tone(x0, y0, x1, y1, 0.6, 3.4);
        hills(x0, x1, 600, [[40, 120], [220, 210], [380, 150], [560, 260], [760, 170], [980, 240], [1160, 140]], "#d9d9d9");
      });
      ellipse(SPOTS[1], [700, 530, 640, 625, 780, 535]);
      ellipse(SPOTS[2], [300, 320, 360, 410, 350, 330]);
      badge(1, 1085, 105);
      badge(2, 95, 120);
      panel(40, 680, 580, 1220, (x0, y0, x1, y1) => {
        const sky = ctx.createLinearGradient(0, y0, 0, y1);
        sky.addColorStop(0, "#f4f4f4");
        sky.addColorStop(1, "#c9c9c9");
        ctx.fillStyle = sky;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        hills(x0, x1, 1150, [[40, 140], [160, 260], [300, 170], [430, 320], [580, 200]], "#7d7d7d");
        hills(x0, x1, 1220, [[40, 60], [200, 120], [380, 70], [580, 130]], "#4a4a4a");
      });
      ctx.setLineDash([16, 10]);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#1976d2";
      const c = SPOTS[3];
      ctx.strokeRect(c.x - c.rx, c.y - c.ry, c.rx * 2, c.ry * 2);
      ctx.setLineDash([]);
      badge(3, 545, 745);
      panel(620, 680, 1160, 1220, () => {
        speedLines(890, 965, 120, 150, 600, 6);
      });
      spiky(SPOTS[4]);
      badge(4, 1110, 735);
      panel(40, 1260, 1160, 1660, (x0, y0, x1, y1) => {
        tone(x0, y0, x1, y1, 3, 0.8, 11);
        hills(x0, x1, 1660, [[40, 160], [180, 250], [330, 190], [520, 120], [1160, 80]], "#bdbdbd");
      });
      ellipse(SPOTS[5], [690, 1570, 600, 1640, 750, 1575]);
      badge(5, 1080, 1330);
    } else if (number === 2) {
      panel(40, 40, 1160, 780, (x0, y0, x1, y1) => {
        // An even screentone: what Content-Aware Fill rebuilds best
        tone(x0, y0, x1, y1, 2.2, 2.2, 12);
        hills(x0, x1, 780, [[40, 70], [200, 40], [420, 150], [600, 80], [880, 200], [1160, 110]], "#3d3d3d");
      });
      // Text on the art itself: a box would show
      vertical(["そのころ︙"], SPOTS[8].x, SPOTS[8].y, 58);
      ellipse(SPOTS[6], [700, 650, 640, 760, 760, 665]);
      vertical(["なんだ", "これは？"], SPOTS[6].x, SPOTS[6].y, 62);
      badge(6, 1095, 110);
      badge(8, 110, 110);
      panel(40, 820, 1160, 1660, (x0, y0, x1, y1) => {
        tone(x0, y0, x1, y1, 0.8, 2.6, 12);
        speedLines(830, 1330, 140, 260, 900, 7);
      });
      ellipse(SPOTS[7], [430, 1420, 520, 1520, 380, 1435]);
      vertical(["いくぞ！"], SPOTS[7].x, SPOTS[7].y, 70);
      // The sound effect: drawn on the art, black with a white edge
      ctx.save();
      ctx.translate(SPOTS[9].x, SPOTS[9].y);
      ctx.rotate(-0.18);
      ctx.font = `900 190px ${JP_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ["ド", "ド", "ド"].forEach((ch, i) => {
        const x = -170 + i * 170;
        const y = -60 + i * 70;
        ctx.lineWidth = 22;
        ctx.strokeStyle = "#ffffff";
        ctx.strokeText(ch, x, y);
        ctx.fillStyle = "#111111";
        ctx.fillText(ch, x, y);
      });
      ctx.restore();
      badge(7, 120, 900);
      badge(9, 1095, 900);
    } else {
      panel(40, 40, 1160, 1000, (x0, y0, x1, y1) => {
        const sky = ctx.createLinearGradient(0, y0, 0, y1);
        sky.addColorStop(0, "#e9e9e9");
        sky.addColorStop(1, "#a9a9a9");
        ctx.fillStyle = sky;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.beginPath();
        ctx.arc(600, 980, 220, Math.PI, 0);
        ctx.fillStyle = "#f7f7f7";
        ctx.fill();
        hills(x0, x1, 1000, [[40, 110], [300, 60], [600, 20], [900, 70], [1160, 120]], "#5a5a5a");
      });
      // A caption on the art, over the sky's gradient: a plain fill would show
      vertical(["静かな", "朝だった"], SPOTS[11].x, SPOTS[11].y, 54);
      ellipse(SPOTS[10], [520, 735, 470, 840, 610, 748]);
      badge(10, 1085, 110);
      badge(11, 330, 100);
      panel(40, 1040, 1160, 1660, (x0, y0, x1, y1) => {
        tone(x0, y0, x1, y1, 0.5, 3, 12);
      });
      vertical(["おわり"], 600, 1350, 110);
    }
    folio();
    return canvas;
  };
  const practiceFiles = async () => {
    const files = [];
    for (let n = 1; n <= 3; n++) {
      const canvas = drawPage(n);
      const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: "image/png" }) : await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      files.push(new File([blob], FILE(n), { type: "image/png", lastModified: Date.now() }));
    }
    return files;
  };

  // The script, one line per spot; "Page n" lines are the panel's page markers
  const SHOUT = () => T("SHOUT:");
  const LINES = {
    note: "Notes for you start with ##: TypeR never pastes them.",
    1: "Welcome to SG Typer Studio! Each line of the script goes into its own bubble.",
    2: "One click, one bubble.",
    3: "Meanwhile, far from here...",
    4: "WATCH OUT!",
    5: "This one is yours: try what you like.",
    6: "What... is this?",
    7: "Here we go!",
    10: "See you in the next chapter!",
  };
  // Where each line of the script is, counted from 0 as the panel counts
  const LINE = { note: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 8, 7: 9, 10: 11 };
  const practiceScript = () => [
    "Page 1",
    // A translation may already start with the ## it talks about
    /^##/.test(T(LINES.note)) ? T(LINES.note) : `## ${T(LINES.note)}`,
    T(LINES[1]),
    T(LINES[2]),
    T(LINES[3]),
    `${SHOUT()} ${T(LINES[4])}`,
    T(LINES[5]),
    "Page 2",
    T(LINES[6]),
    T(LINES[7]),
    "Page 3",
    T(LINES[10]),
  ].join("\n");

  /* ------------------------------ the panel, from here ------------------------------ */

  const frame = () => document.getElementById("panel-frame");
  const panelDoc = () => {
    try {
      const f = frame();
      return f && f.contentDocument && f.contentWindow.__typerWeb ? f.contentDocument : null;
    } catch (error) {
      return null;
    }
  };
  const inPanel = (selector) => {
    const doc = panelDoc();
    return doc ? doc.querySelector(selector) : null;
  };
  const panelLine = () => {
    const node = inPanel(".text-line.m-current");
    return node ? Number(node.dataset.lineIndex) : -1;
  };
  // The panel's own file, as it last wrote it: read once per change
  let storageText = "";
  let storageValue = {};
  const panelStorage = () => {
    let text = null;
    try {
      const bridge = frame() && frame().contentWindow && frame().contentWindow.__typerWeb;
      text = bridge ? bridge.getFile(Kit().activeStoragePath()) : Kit().read(Kit().activeStoragePath());
    } catch (error) {
      text = null;
    }
    if (text && text !== storageText) {
      storageText = text;
      try {
        storageValue = JSON.parse(text) || {};
      } catch (error) {
        storageValue = {};
      }
    }
    return storageValue;
  };
  const styles = () => panelStorage().styles || [];
  const hasTag = (style, tag) => (style.prefixes || []).some((one) => String(one).trim().toLowerCase() === tag.trim().toLowerCase());
  const shoutStyle = () => styles().find((style) => hasTag(style, SHOUT()));
  const onPracticeTab = () => panelStorage().currentTabId === TAB_ID && Boolean(inPanel(".text-line"));
  // A click inside the panel, as the user's would be
  const panelClick = (selector) => {
    const node = inPanel(selector);
    if (node) node.click();
    return Boolean(node);
  };

  const waitFor = (test, timeout = 15000) => new Promise((resolve) => {
    const started = Date.now();
    const look = () => {
      let ok = false;
      try {
        ok = test();
      } catch (error) {
        ok = false;
      }
      if (ok || Date.now() - started > timeout) resolve(ok);
      else setTimeout(look, 120);
    };
    look();
  });

  // The practice script goes in a tab of its own, next to the user's: written into the panel's
  // file while it's closed, as a style kit is
  const openPracticeTab = async () => {
    await App().closePanel();
    const path = Kit().activeStoragePath();
    let storage = null;
    try {
      storage = JSON.parse(Kit().read(path) || "null");
    } catch (error) {
      storage = null;
    }
    storage = storage || Kit().freshStorage(false);
    storage.notFirstTime = true;
    let tabs = Array.isArray(storage.tabs) ? storage.tabs.filter((tab) => tab && tab.id !== TAB_ID) : [];
    // A file from before the tabs: its script becomes their first one, as the panel would do
    if (!tabs.length && storage.text) tabs = [{ id: `tab-${Date.now().toString(36)}`, name: "", autoName: true, text: storage.text, images: storage.images || [], currentLineIndex: storage.currentLineIndex || 0, lastOpenedImagePath: null, usedLineStyles: {} }];
    if (storage.currentTabId && storage.currentTabId !== TAB_ID) remember({ previousTab: storage.currentTabId });
    const text = practiceScript();
    tabs.push({ id: TAB_ID, name: T("TypeR practice"), text, images: [], currentLineIndex: LINE[1], lastOpenedImagePath: null, usedLineStyles: {} });
    Object.assign(storage, { tabs, currentTabId: TAB_ID, text, images: [], currentLineIndex: LINE[1], usedLineStyles: {} });
    await Kit().keep(path, JSON.stringify(storage));
    App().startPanel();
    await waitFor(() => inPanel('[data-tour="paste"]') && inPanel(".text-line"));
  };
  const closePracticeTab = async () => {
    await App().closePanel();
    const path = Kit().activeStoragePath();
    let storage = null;
    try {
      storage = JSON.parse(Kit().read(path) || "null");
    } catch (error) {
      storage = null;
    }
    if (storage && Array.isArray(storage.tabs) && storage.tabs.some((tab) => tab.id === TAB_ID)) {
      storage.tabs = storage.tabs.filter((tab) => tab.id !== TAB_ID);
      if (!storage.tabs.length) storage.tabs = [{ id: `tab-${Date.now().toString(36)}`, name: "", autoName: true, text: "", images: [], currentLineIndex: 0, lastOpenedImagePath: null, usedLineStyles: {} }];
      if (storage.currentTabId === TAB_ID || !storage.tabs.some((tab) => tab.id === storage.currentTabId)) {
        const back = storage.tabs.find((tab) => tab.id === remembered().previousTab) || storage.tabs[0];
        Object.assign(storage, { currentTabId: back.id, text: back.text || "", images: back.images || [], currentLineIndex: back.currentLineIndex || 0, usedLineStyles: back.usedLineStyles || {} });
      }
      await Kit().keep(path, JSON.stringify(storage));
    }
    App().startPanel();
  };

  const practiceDocs = () => app.docs.filter((doc) => PAGE_OF_PATH.test(doc.path || ""));
  const pageOf = (doc) => {
    const found = doc && PAGE_OF_PATH.exec(doc.path || "");
    return found ? Number(found[1]) : 0;
  };
  const docOfPage = (n) => practiceDocs().find((doc) => pageOf(doc) === n) || null;
  let files = null;
  let chapterGiven = false;
  // The chapter, its script and its pages: opened once, then found again. A fresh practice tab,
  // or pages brought back by a reload, are given the chapter again: the pager and the script's
  // page markers follow it.
  const ensurePractice = async () => {
    let fresh = false;
    if (!onPracticeTab()) {
      await openPracticeTab();
      fresh = true;
    }
    if (fresh || !chapterGiven || !practiceDocs().length) {
      files = files || await practiceFiles();
      await App().openChapter(files);
      chapterGiven = true;
    }
    await waitFor(() => practiceDocs().length > 0, 8000);
  };
  const showPage = async (n) => {
    if (pageOf(app.doc) === n) return;
    const open = docOfPage(n);
    if (open) App().switchDoc(open);
    else await App().goToPage(n - 1);
    await waitFor(() => pageOf(app.doc) === n, 5000);
  };
  // Back on a line of the script, as a click on its target
  const goToLine = async (index) => {
    if (panelLine() === index) return;
    // Its icon takes the click, not the whole height of a long line
    const target = inPanel(`.text-line[data-line-index="${index}"] .text-line-select svg`);
    if (target) target.dispatchEvent(new MouseEvent("click", { bubbles: true, view: target.ownerDocument.defaultView }));
    await waitFor(() => panelLine() === index, 3000);
  };
  // Nothing to save on a practice page: it closes without asking
  const markSaved = (doc) => {
    if (doc && doc.history && doc.history[doc.historyIndex]) doc.savedId = doc.history[doc.historyIndex].id;
  };
  const closePractice = async () => {
    endLesson();
    const docs = practiceDocs();
    for (const doc of docs) {
      markSaved(doc);
      await App().closeDoc(doc);
    }
    App().setPages([]);
    chapterGiven = false;
    if (panelStorage().tabs && panelStorage().tabs.some((tab) => tab.id === TAB_ID)) await closePracticeTab();
    else if (Kit().read(Kit().activeStoragePath()) && (Kit().read(Kit().activeStoragePath()) || "").indexOf(TAB_ID) !== -1) await closePracticeTab();
  };

  /* ---------------------------------- what is going on ---------------------------------- */

  const PASTES = ["TyperTools Paste", "TyperTools Smart Paste"];
  // Everything a step looks at, at one moment
  const look = () => {
    const doc = app.doc;
    const storage = panelStorage();
    const modal = document.querySelector("#modal[open] .modal__head");
    const panes = window.TypeRWorkspace;
    return {
      doc,
      page: pageOf(doc),
      tool: app.tool,
      view: doc ? doc.view : null,
      selection: doc && doc.state.selection ? doc.state.selection.bounds : null,
      texts: doc ? doc.state.layers.filter((layer) => layer.kind === "text") : [],
      line: panelLine(),
      storage,
      panelModal: Boolean(inPanel(".app-modal")),
      dialog: modal ? modal.textContent : "",
      panelsShown: panes ? panes.sideVisible() || panes.isVisible("typer") : true,
      pagesMenu: Boolean(document.querySelector(".pages-menu")),
      // A touch screen always shows a text's frame
      transformControls: Boolean(window.TypeRShell && window.TypeRShell.touch) || !App() || App().setup.preferences().transformControls,
    };
  };
  // Free Transform's keys, as a sentence draws them ({Cmd}{T}); its menu if it has none
  const freeTransformKeys = () => {
    const keys = App() ? App().setup.keysOf("Free Transform") : "";
    return keys ? keys.split("+").map((key) => `{${key}}`).join("") : `${T("Edit")} → ${T("Free Transform")}`;
  };
  // What was done since `since`, on the practice pages: [{ name, page, id }]
  const historyIds = () => {
    const ids = new Set();
    practiceDocs().forEach((doc) => doc.history.forEach((entry) => ids.add(entry.id)));
    return ids;
  };
  const actions = (since, page) => practiceDocs()
    .filter((doc) => !page || pageOf(doc) === page)
    .flatMap((doc) => doc.history.slice(0, doc.historyIndex + 1).filter((entry) => !since.has(entry.id)).map((entry) => ({ name: entry.name, page: pageOf(doc), id: entry.id })));
  const did = (since, names, page) => actions(since, page).filter((entry) => names.includes(entry.name)).length;
  const inside = (bounds, spot, slack = 0) => bounds && spot
    && bounds.left < spot.x + spot.rx + slack && bounds.right > spot.x - spot.rx - slack
    && bounds.top < spot.y + spot.ry + slack && bounds.bottom > spot.y - spot.ry - slack;
  const covers = (bounds, spot) => bounds && bounds.left <= spot.x && bounds.right >= spot.x && bounds.top <= spot.y && bounds.bottom >= spot.y;
  const newestText = (ctx) => ctx.texts[ctx.texts.length - 1] || null;
  const textOf = (layer) => (layer && layer.params && layer.params.layerText ? layer.params.layerText.textKey || "" : "");

  /* ------------------------------------ the lessons ------------------------------------ */

  // Wheel words follow the choice made in the setup assistant
  const zoomWords = () => {
    const wheel = App() && App().setup ? App().setup.preferences().wheel : "pan";
    return wheel === "pan"
      ? T("hold {Alt} and turn the wheel, pinch on a trackpad, or press {Cmd}{+}")
      : T("turn the wheel, pinch on a trackpad, or press {Cmd}{+}");
  };
  const menuButton = (name) => Array.from(document.querySelectorAll("#menus .menu__button")).find((button) => button.textContent === T(name)) || null;
  const tool = (id) => () => document.querySelector(`#tools [data-tools~="${id}"]`);
  const byId = (id) => () => document.getElementById(id);
  // After a click in the panel, its keys stay there; a tool's key only lends the tool on the page
  const pageKeys = () => {
    const frame = document.getElementById("panel-frame");
    if (document.activeElement !== frame) return;
    frame.blur();
    const stage = document.getElementById("stage");
    if (stage) stage.focus({ preventScroll: true });
  };
  // The Gradients lesson: the tool's own state (retouch.js), and the texts of page 1
  const retouch = () => window.TypeRRetouch || null;
  const textOnPage1 = () => Boolean(docOfPage(1) && docOfPage(1).state.layers.some((one) => one.kind === "text"));
  const activeTextOf = (ctx) => {
    if (!ctx.doc) return null;
    const id = ctx.doc.state.activeIds[ctx.doc.state.activeIds.length - 1];
    return ctx.texts.find((one) => one.id === id) || null;
  };

  // A step: text (with {Key}), target(s), done(ctx, since, memo) or `next` for a read-only
  // step, result (shown once passed), skip(ctx) when it isn't needed, enter() to set the scene,
  // show: a gesture for "Show me".
  // A target: { el() } in the app, { panel: selector } in the panel, { spot: n } on the page.
  const LESSONS = [
    {
      id: "workspace",
      title: "The workspace",
      about: "Find your way around the page and the chapter.",
      minutes: 3,
      page: 1,
      steps: [
        {
          text: "Welcome to your workspace. The tools are on the left, the page in the middle, and on the right the TypeR panel, which holds your script and your styles, then the layers.",
          targets: [
            { el: byId("tools"), label: "Tools" },
            { el: byId("stage"), label: "Page", inset: 60 },
            { el: byId("dock-typer"), label: "TypeR" },
            { el: byId("pane-layers"), label: "Layers" },
          ],
          next: true,
        },
        {
          text: () => fill(T("Zoom in on bubble ①: {how}."), { how: zoomWords() }),
          targets: [{ spot: 1 }],
          begin: (ctx, memo) => { memo.zoom = ctx.view ? ctx.view.zoom : 1; },
          done: (ctx, since, memo) => Boolean(ctx.view) && ctx.view.zoom > memo.zoom * 1.4,
          result: "The zoom follows the pointer: aim at what you want to see.",
        },
        {
          text: "Hold {Space} and drag the page to move around it.",
          targets: [{ el: byId("stage"), inset: 120 }],
          show: { drag: true },
          begin: (ctx, memo) => { memo.start = ctx.view ? { x: ctx.view.x, y: ctx.view.y, zoom: ctx.view.zoom } : null; },
          done: (ctx, since, memo) => {
            if (!ctx.view || !memo.start) return false;
            const moved = Math.hypot(ctx.view.x - memo.start.x, ctx.view.y - memo.start.y);
            return moved > 80 && Math.abs(ctx.view.zoom / memo.start.zoom - 1) < 0.05;
          },
        },
        {
          text: "Back to the whole page: {Cmd}{0}, or View → Fit on Screen.",
          targets: [{ el: () => menuButton("View") }],
          done: (ctx) => Boolean(ctx.view && ctx.view.fitted),
          result: "{Tab} hides every panel, for the page alone. Window → Reset Workspace puts them all back in place.",
        },
        {
          text: "The practice chapter has three pages: the pager, at the right of the tabs, says where you are. Go to the next page: {PageDown}, or its › arrow.",
          targets: [{ el: byId("pager-next") }],
          done: (ctx) => ctx.page === 2,
          result: "{PageUp} goes back. A page you leave without changes closes by itself: a chapter of 40 pages stays light.",
        },
        {
          text: "Click the page number: every page of the chapter is listed. Pick page 3.",
          targets: [{ el: byId("pager-at") }],
          done: (ctx) => ctx.page === 3,
          result: "For your own chapter: File → Open Pages… ({Shift}{Cmd}{O}), then pick its folder or its files.",
        },
      ],
    },
    {
      id: "clean",
      title: "Clean the raws",
      about: "Erase the original text, in bubbles and on the art.",
      minutes: 2,
      page: 2,
      steps: [
        {
          text: "Page 2 still has its original text. Take the Bubble Cleaner ({J}) and click inside bubbles ⑥ and ⑦: their text goes, painted over in each bubble's own colours.",
          targets: [{ el: tool("clean") }, { spot: 6 }, { spot: 7 }],
          show: { click: 6 },
          done: (ctx, since) => did(since, ["Bubble Cleaner"], 2) > 1,
          result: "One click per bubble. For text on a plain background, drag a box around it instead.",
        },
        {
          text: "At ⑧, the text is on the art itself. Take the Lasso ({L}) and draw around it.",
          targets: [{ spot: 8 }],
          show: { lasso: 8 },
          done: (ctx) => ctx.page === 2 && covers(ctx.selection, SPOTS[8]) && ctx.selection.width < 500,
        },
        {
          text: "Now Edit → Content-Aware Fill… ({Shift}{Backspace}), then OK: TypeR rebuilds what was under the text, from what surrounds it.",
          targets: [{ el: () => menuButton("Edit") }],
          done: (ctx, since) => did(since, ["Content-Aware Fill", "Generative Fill"], 2) > 0,
          result: "{Cmd}{D} deselects. For harder spots, Edit → Generative Fill… redraws the selection, with LaMa Manga for free on this computer.",
        },
      ],
    },
    {
      id: "script",
      title: "The script",
      about: "Lines, notes and page markers.",
      minutes: 2,
      page: 1,
      enter: async () => {
        await goToLine(LINE[1]);
      },
      steps: [
        {
          text: "The practice script waits in its own tab, above the text: your own scripts stay untouched. Paste a translation there and TypeR splits it into lines.",
          targets: [{ panel: ".tab-bar-tab.m-active" }, { panel: ".text-lines", inset: 4 }],
          next: true,
        },
        {
          text: () => fill(T("Click the target ◎ at the start of “{line}”: it becomes the current line, the text of the next paste."), { line: T(LINES[2]) }),
          targets: [{ panel: `.text-line[data-line-index="${LINE[2]}"] .text-line-select svg` }],
          done: (ctx) => ctx.line === LINE[2],
        },
        {
          text: "Go to the next line with the ↓ arrow at the top of the panel.",
          targets: [{ panel: '[data-tour="next-line"]' }],
          done: (ctx) => ctx.line === LINE[3],
          result: "The preview above the script shows the current line as it will be pasted.",
        },
        {
          text: "Lines starting with ## are notes for you: TypeR never pastes them. “Page 1” is a page marker.",
          targets: [{ panel: `.text-line[data-line-index="${LINE.note}"]` }, { panel: '.text-line[data-line-index="0"]' }],
          next: true,
        },
        {
          text: () => fill(T("Click the target of “{line}”, under “Page 2”."), { line: T(LINES[6]) }),
          targets: [{ panel: `.text-line[data-line-index="${LINE[6]}"] .text-line-select svg` }],
          done: (ctx) => ctx.line === LINE[6] && ctx.page === 2,
          result: "TypeR opened page 2 for you: page markers tie the script to your pages, and the right page follows the current line.",
        },
      ],
    },
    {
      id: "styles",
      title: "Your styles",
      about: "Font, size and tags, set once for good.",
      minutes: 3,
      page: 1,
      steps: [
        {
          text: "A style holds everything a text needs: font, size, colour, stroke. Click Add style, at the bottom of the panel.",
          skip: () => styles().length > 0,
          enter: (lesson) => { lesson.flags.creating = true; },
          targets: [{ panel: '[data-tour="add-style"]' }],
          begin: (ctx, memo) => { memo.count = styles().length; },
          done: (ctx, since, memo) => ctx.panelModal || styles().length > memo.count,
        },
        {
          text: "Name it “Dialogue”, pick the font you use for dialogue and a size of about 40 px, then click Save.",
          skip: (ctx, lesson) => !lesson.flags.creating,
          targets: [{ panel: ".style-edit-save" }],
          done: () => styles().length > 0 && !inPanel(".app-modal"),
          result: "Your style is in the list, and active: the next paste uses it.",
        },
        {
          text: "Your styles are at the bottom of the panel. Click the one you use for dialogue: it becomes the active style.",
          skip: (ctx, lesson) => lesson.flags.creating,
          targets: [{ panel: ".styles-block", inset: 2 }],
          canNext: true,
          begin: (ctx, memo) => { memo.style = ctx.storage.currentStyleId || null; },
          done: (ctx, since, memo) => Boolean(ctx.storage.currentStyleId) && ctx.storage.currentStyleId !== memo.style,
        },
        {
          text: "Shouts need their own style. Right-click your dialogue style in the list, then Duplicate style.",
          skip: (ctx, lesson) => lesson.flags.hadShout,
          targets: [{ panel: ".styles-block", inset: 2 }, { panel: '[data-tour="duplicate-style"]' }],
          begin: (ctx, memo) => { memo.count = styles().length; },
          done: (ctx, since, memo) => styles().length > memo.count,
        },
        {
          text: "Click the pencil of the copy to edit it.",
          skip: (ctx, lesson) => lesson.flags.hadShout,
          targets: [{ panel: '[data-tour="edit-style"]' }],
          done: (ctx) => ctx.panelModal,
        },
        {
          text: () => fill(T("Write {tag} in “Tags for automatic style choosing”, pick a bolder font if you like, then Save."), { tag: SHOUT() }),
          skip: (ctx, lesson) => lesson.flags.hadShout,
          targets: [{ panel: '[data-tour="style-prefixes"]' }],
          done: () => Boolean(shoutStyle()) && !inPanel(".app-modal"),
          result: () => fill(T("Every line starting with {tag} now takes this style by itself, and the tag stays out of the text."), { tag: SHOUT() }),
        },
        {
          text: () => fill(T("Your style “{name}” already has the {tag} tag: every line starting with it takes that style by itself."), { name: (shoutStyle() || {}).name || "", tag: SHOUT() }),
          skip: (ctx, lesson) => !lesson.flags.hadShout,
          targets: [{ panel: ".styles-block", inset: 2 }],
          next: true,
        },
      ],
      start: (lesson) => {
        lesson.flags.hadShout = Boolean(shoutStyle());
      },
    },
    {
      id: "typeset",
      title: "Typeset",
      about: "One click per bubble: the heart of TypeR.",
      minutes: 3,
      page: 1,
      enter: async () => {
        await goToLine(LINE[1]);
      },
      steps: [
        {
          text: "Typesetting needs a style. Click Add style at the bottom of the panel, name it, then Save.",
          skip: () => styles().length > 0,
          targets: [{ panel: '[data-tour="add-style"]' }],
          done: () => styles().length > 0 && !inPanel(".app-modal"),
        },
        {
          text: "Take the Magic Wand ({W}) and click inside bubble ① to select it.",
          targets: [{ el: tool("wand") }, { spot: 1 }],
          show: { click: 1 },
          done: (ctx, since) => (ctx.page === 1 && inside(ctx.selection, SPOTS[1]) && covers(ctx.selection, SPOTS[1])) || did(since, PASTES, 1) > 0,
        },
        {
          text: "Click Paste, at the top of the panel.",
          skip: (ctx, lesson) => did(lesson.lessonSince, PASTES, 1) > 0,
          targets: [{ panel: '[data-tour="paste"]' }],
          done: (ctx, since) => did(since, PASTES, 1) > 0,
          result: "A text layer with your style, laid out to the shape of the bubble. And TypeR moved on to the next line by itself.",
        },
        {
          text: "Faster: turn on Click paste, at the bottom of the panel.",
          skip: (ctx) => Boolean(ctx.storage.pasteOnClick),
          targets: [{ panel: '[data-tour="mode-pasteOnClick"]' }],
          done: (ctx) => Boolean(ctx.storage.pasteOnClick),
        },
        {
          text: "Now just click bubble ② with the wand: the click alone pastes the next line.",
          targets: [{ spot: 2 }],
          show: { click: 2 },
          done: (ctx, since) => did(since, PASTES, 1) > 0,
          result: "Click, click, click: a whole page in seconds. Click paste is turned off with the same button.",
        },
        {
          // A tool's key held down lends the tool: let go, the wand comes back
          enter: () => pageKeys(),
          text: "No bubble at ③: borrow the Rectangular Marquee. Hold {M}, draw a box inside the dotted frame, then let go of {M}.",
          targets: [{ spot: 3 }],
          show: { box: 3 },
          // M pressed quickly keeps the marquee: passed all the same, a moment after the paste
          done: (ctx, since, memo) => {
            if (!did(since, PASTES, 1)) return false;
            if (ctx.tool === "wand") return true;
            memo.pasted = memo.pasted || Date.now();
            return Date.now() - memo.pasted > 4000;
          },
          result: (ctx) => (ctx.tool === "wand"
            ? T("The wand came back by itself: a tool's key held lends the tool, pressed quickly it keeps it. A box or a lasso places a text anywhere: captions, text on the art…")
            : T("{M} pressed quickly keeps the marquee. Held, it only lends it: let go, and the previous tool comes back. Take the wand back: {W}.")),
        },
        {
          text: () => fill(T("Bubble ④ is a shout, and its line starts with {tag}. Click it with the wand."), { tag: SHOUT() }),
          targets: [{ spot: 4 }],
          show: { click: 4 },
          done: (ctx, since) => did(since, PASTES, 1) > 0,
          result: (ctx) => (textOf(newestText(ctx)).indexOf(SHOUT().trim()) === -1
            ? T("The tag chose the style, and stayed out of the text.")
            : T("The tag stayed in the text: no style has it yet. The “Your styles” lesson shows how to give it one.")),
        },
      ],
    },
    {
      id: "retouch",
      title: "Retouch a text",
      about: "Move, centre, resize, break lines, restyle.",
      minutes: 4,
      page: 1,
      needsText: true,
      steps: [
        {
          text: "Take the Move tool ({V}) and drag the text of bubble ① off-centre.",
          targets: [{ el: tool("move") }, { spot: 1 }],
          show: { drag: 1 },
          done: (ctx, since) => did(since, ["Move", "Free Transform"], 1) > 0,
          result: "{Cmd}{Z} would undo it, and Window → History lists every step. But there's quicker.",
        },
        {
          text: "Click Align, at the top of the panel: with nothing selected, TypeR finds the bubble around the text and centres it in it.",
          // A selection left over would be what the text centres on
          enter: () => { if (app.doc && app.doc.state.selection) ops.deselect(); },
          targets: [{ panel: '[data-tour="align"]' }],
          done: (ctx, since) => did(since, ["TyperTools Align"], 1) > 0,
          result: "Back in the middle. When TypeR can't find the bubble, Align centres on a selection of yours instead.",
        },
        {
          text: "First turn off Click paste, at the bottom of the panel: on, every selection pastes a line.",
          skip: (ctx) => !ctx.storage.pasteOnClick,
          targets: [{ panel: '[data-tour="mode-pasteOnClick"]' }],
          done: (ctx) => !ctx.storage.pasteOnClick,
        },
        {
          // Keys pressed in the panel never lend a tool: the keyboard goes back to the page
          enter: () => pageKeys(),
          text: "Hold {M} to borrow the Rectangular Marquee, draw a box over the top half of bubble ①, let go, then click Align: the text centres in your box.",
          targets: [{ spot: 1 }, { panel: '[data-tour="align"]' }],
          done: (ctx, since) => Boolean(ctx.selection) && did(since, ["TyperTools Align"], 1) > 0,
          result: "Handy for a text on the art, or a bubble open on one side. {Cmd}{D} deselects, and Align with nothing selected puts it back in its bubble.",
        },
        {
          // Show Transform Controls off: no frame to drag until Free Transform shows one
          text: (ctx) => (ctx.transformControls
            ? T("Drag a corner of the text's frame: the text gets bigger or smaller. The points on its sides change its box.")
            : fill(T("The text's frame is hidden: press {keys} to show it, drag a corner to make the text bigger or smaller, then {Enter}. Or check “{name}” in the options bar to always see the frame."), { keys: freeTransformKeys(), name: T("Show Transform Controls") })),
          targets: [{ spot: 1 }],
          done: (ctx, since) => did(since, ["Character", "Text Box", "Free Transform", "TyperTools Resize"], 1) > 0,
        },
        {
          text: "In the Line Breaks panel, click + or − to try other line breaks for the selected text ({Shift}{L} shows the panel).",
          targets: [{ el: byId("breaks") }],
          done: (ctx, since) => did(since, ["Line Breaks"], 1) > 0,
          result: "TypeR balances the lines for you; you can also cut them by hand in the panel's text.",
        },
        {
          text: "Double-click the text to type in it. Change a word, then {Cmd}{Enter}.",
          targets: [{ spot: 1 }],
          done: (ctx, since) => did(since, ["Edit Type", "Type Tool"], 1) > 0,
        },
        {
          text: "Restyle without retyping: with a text selected, click the ➜ next to a style in the panel.",
          targets: [{ panel: '[data-tour="apply-style"]' }],
          done: (ctx, since) => did(since, ["TyperTools Change"], 1) > 0,
          result: "The text took the style and kept its words. Font, size and colour of a single text are also in the Character panel.",
        },
      ],
    },
    {
      id: "gradient",
      title: "Gradients",
      about: "Redraw a gradient under a text, and give a text a gradient.",
      minutes: 2,
      page: 3,
      steps: [
        {
          // On, Click paste would turn the box into a pasted line
          text: "First turn off Click paste, at the bottom of the panel: on, every selection pastes a line.",
          skip: (ctx) => !ctx.storage.pasteOnClick,
          targets: [{ panel: '[data-tour="mode-pasteOnClick"]' }],
          done: (ctx) => !ctx.storage.pasteOnClick,
        },
        {
          text: "At ⑪, the text lies on the sky's grey gradient: a plain fill would show. Take the Rectangular Marquee ({M}) and draw a box around it.",
          targets: [{ spot: 11 }],
          show: { box: 11 },
          done: (ctx) => ctx.page === 3 && covers(ctx.selection, SPOTS[11]) && ctx.selection.width < 400,
        },
        {
          text: "Take the Gradient tool ({G}) and, in the options bar, pick the last swatch, Match the page: the gradient takes its colours from the page itself.",
          skip: () => Boolean(retouch() && retouch().prefs().colors === "page"),
          targets: [{ el: tool("gradient") }, { el: () => document.querySelector(".grad-swatch:nth-child(4)") }],
          done: (ctx) => ctx.tool === "gradient" && Boolean(retouch() && retouch().prefs().colors === "page"),
        },
        {
          text: "With the Gradient tool ({G}), drag from the top of the sky to its bottom, across the text: the sky's gradient is drawn again under it.",
          targets: [{ spot: 12 }],
          show: { down: 12 },
          done: (ctx, since) => did(since, ["Gradient"], 3) > 0 && !retouch().dragging(),
          result: "Its ends stay on the page: drag them to adjust it. {Enter} lets them go.",
        },
        {
          text: "Deselect: {Cmd}{D}. The text is gone, the sky is whole.",
          done: (ctx) => ctx.page === 3 && !ctx.selection,
        },
        {
          text: "Back on page 1, select the text of bubble ①: click it with the Move tool ({V}), or in the Layers panel.",
          skip: () => !textOnPage1(),
          enter: () => { showPage(1); },
          targets: [{ spot: 1 }, { el: byId("pane-layers") }],
          done: (ctx) => ctx.page === 1 && Boolean(activeTextOf(ctx)),
        },
        {
          text: "Take the Gradient tool ({G}), pick the first swatch, Foreground to Background, and drag across the text.",
          skip: () => !textOnPage1(),
          targets: [{ spot: 1 }],
          show: { across: 1 },
          done: (ctx, since) => did(since, ["Gradient"], 1) > 0 && !retouch().dragging(),
          result: "The gradient went on a new layer clipped to the text: the letters take it, the stroke keeps its colour, and the text stays editable.",
        },
        {
          text: "Drag one of its ends, or try another type in the options bar. {Enter} when it suits you.",
          skip: () => !textOnPage1() || !retouch().editing(),
          targets: [{ el: () => document.querySelector(".grad-type.is-on") }],
          canNext: true,
          // Its ends show as the step starts: Enter may come before the first check
          begin: (ctx, memo) => { memo.seen = retouch().editing(); },
          done: (ctx, since, memo) => {
            if (retouch().editing()) memo.seen = true;
            return Boolean(memo.seen) && !retouch().editing();
          },
          result: "Two colours of your own: the swatches at the bottom of the tools, or {Alt} + click on the page with the Gradient tool.",
        },
        {
          text: "On a text or an SFX, the Gradient tool paints on a new layer clipped to it: the letters take the gradient. Try it once you have typeset a page.",
          skip: () => textOnPage1(),
          next: true,
        },
      ],
    },
    {
      id: "sfx",
      title: "Sound effects",
      about: "Letters along a path, turned and sized one by one.",
      minutes: 2,
      steps: [
        {
          text: "The SFX tool ({K}) lays a word along a path, then lets you turn, size and move each letter. Its practice takes two minutes, on a page of its own.",
          action: { label: "Start the SFX practice", run: () => window.TypeRSFXGuide && window.TypeRSFXGuide.practise() },
          hideWhile: () => Boolean(document.querySelector(".sfxg-coach")),
          // Passed once the SFX practice went to its end; quit before, the card comes back
          done: (ctx, since, memo) => {
            const coach = Boolean(document.querySelector(".sfxg-coach"));
            if (coach) memo.started = true;
            if (!memo.started || coach) return false;
            memo.started = false;
            try {
              return window.localStorage.getItem("typer.web.sfx.guide") === "done";
            } catch (error) {
              return true;
            }
          },
          result: "Help → SFX Guide lists every shortcut of the tool.",
        },
      ],
    },
    {
      id: "finish",
      title: "Finish the chapter",
      about: "Save, export, and every shortcut.",
      minutes: 1,
      steps: [
        {
          text: "File → Batch Save… saves a whole chapter at once, as PSD, PNG, JPEG or WebP. Open it, have a look, then Cancel: the practice pages don't need it.",
          targets: [{ el: () => menuButton("File") }],
          done: (ctx, since, memo) => {
            if (ctx.dialog === T("Batch Save")) memo.opened = true;
            return Boolean(memo.opened) && ctx.dialog !== T("Batch Save");
          },
        },
        {
          text: "{Cmd}{S} saves over the file you opened, File → Save As… makes a copy, and File → Export for InDesign (IDML)… hands the page over to InDesign.",
          targets: [{ el: () => menuButton("File") }],
          next: true,
        },
        {
          text: "Last one: open Help → Keyboard Shortcuts.",
          targets: [{ el: () => menuButton("Help") }],
          done: (ctx) => ctx.dialog === T("Settings"),
          result: "Click a shortcut there to give it other keys.",
        },
      ],
    },
  ];
  const lessonById = (id) => LESSONS.find((lesson) => lesson.id === id);
  const nextLesson = (after) => {
    const done = doneLessons();
    const from = after ? LESSONS.indexOf(lessonById(after)) + 1 : 0;
    return LESSONS.slice(from).find((lesson) => !done.has(lesson.id)) || LESSONS.slice(from)[0] || null;
  };
  const words = (value, ctx) => (typeof value === "function" ? value(ctx) : T(value));

  /* -------------------------------- the ring and the card -------------------------------- */

  let run = null;

  // Where a target is on screen, or null when it can't be seen
  const rectOf = (target) => {
    if (target.spot) {
      const spot = SPOTS[target.spot];
      if (!spot || pageOf(app.doc) !== spot.page) return null;
      const stage = document.getElementById("stage").getBoundingClientRect();
      const [x0, y0] = App().toScreen(spot.x - spot.rx, spot.y - spot.ry);
      const [x1, y1] = App().toScreen(spot.x + spot.rx, spot.y + spot.ry);
      const pad = 8;
      const rect = { left: stage.left + x0 - pad, top: stage.top + y0 - pad, right: stage.left + x1 + pad, bottom: stage.top + y1 + pad, round: spot.shape !== "rect" };
      // Beyond the stage, it isn't shown
      if (rect.right < stage.left || rect.left > stage.right || rect.bottom < stage.top || rect.top > stage.bottom) return null;
      return rect;
    }
    let node = null;
    let offset = { left: 0, top: 0 };
    if (target.panel) {
      node = inPanel(target.panel);
      if (node) {
        const f = frame().getBoundingClientRect();
        offset = { left: f.left, top: f.top };
        // Out of the panel's view
        const r = node.getBoundingClientRect();
        const view = node.ownerDocument.documentElement;
        if (r.bottom < 0 || r.top > view.clientHeight || r.width === 0) return null;
      }
    } else if (target.el) node = target.el();
    if (!node || !node.isConnected) return null;
    const r = node.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    const inset = target.inset || 0;
    const pad = inset ? -inset : 4;
    return { left: offset.left + r.left - pad, top: offset.top + r.top - pad, right: offset.left + r.right + pad, bottom: offset.top + r.bottom + pad };
  };

  const layer = () => {
    let node = document.getElementById("guide-layer");
    if (!node) {
      node = el("div", "guide-layer");
      node.id = "guide-layer";
      node.setAttribute("aria-hidden", "true");
      document.body.appendChild(node);
    }
    return node;
  };
  const drawRings = () => {
    if (!run) return;
    const box = layer();
    const step = run.steps[run.at];
    const targets = (step && !run.passed && step.targets) || [];
    const rects = run.hidden ? [] : targets.map(rectOf);
    // Everything is measured before anything is written: a measure after a write costs a layout,
    // and this runs on every frame of a lesson
    const measured = run.card && !run.moved ? { stage: document.getElementById("stage").getBoundingClientRect(), w: run.card.offsetWidth, h: run.card.offsetHeight } : null;
    while (box.children.length < rects.length) {
      const ring = el("div", "guide-ring", box);
      el("span", "guide-ring__label", ring);
    }
    Array.from(box.children).forEach((ring, i) => {
      if (!ring.classList.contains("guide-ring")) return;
      const rect = rects[i];
      if (!rect) {
        if (!ring.hidden) ring.hidden = true;
        return;
      }
      // Written only when it moved: a ring that stays costs the page nothing
      const label = targets[i] && targets[i].label ? T(targets[i].label) : "";
      const shape = [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right - rect.left), Math.round(rect.bottom - rect.top), rect.round ? 1 : 0, label].join("|");
      if (ring.hidden) ring.hidden = false;
      if (ring.dataset.shape === shape) return;
      ring.dataset.shape = shape;
      ring.style.left = `${Math.round(rect.left)}px`;
      ring.style.top = `${Math.round(rect.top)}px`;
      ring.style.width = `${Math.round(rect.right - rect.left)}px`;
      ring.style.height = `${Math.round(rect.bottom - rect.top)}px`;
      ring.classList.toggle("is-round", Boolean(rect.round));
      ring.firstChild.textContent = label;
      ring.firstChild.hidden = !label;
    });
    run.rects = rects.filter(Boolean);
    placeCard(measured);
  };
  let ringFrame = 0;
  const ringLoop = () => {
    ringFrame = 0;
    if (!run) return;
    drawRings();
    ringFrame = requestAnimationFrame(ringLoop);
  };

  // The card keeps clear of what it points at: bottom left of the page, else top left, else
  // bottom right. Once dragged, it stays where it was put.
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const placeCard = (measured) => {
    if (!run || !run.card) return;
    const card = run.card;
    if (run.moved) return;
    const stage = measured ? measured.stage : document.getElementById("stage").getBoundingClientRect();
    const w = measured ? measured.w : card.offsetWidth;
    const h = measured ? measured.h : card.offsetHeight;
    const spots = [
      { left: stage.left + 14, top: stage.bottom - h - 14 },
      { left: stage.left + 14, top: stage.top + 14 },
      { left: stage.right - w - 14, top: stage.bottom - h - 14 },
      { left: stage.right - w - 14, top: stage.top + 14 },
    ];
    const free = spots.find((spot) => !(run.rects || []).some((rect) => overlaps({ left: spot.left, top: spot.top, right: spot.left + w, bottom: spot.top + h }, rect))) || spots[0];
    if (card.dataset.left !== String(Math.round(free.left)) || card.dataset.top !== String(Math.round(free.top))) {
      card.dataset.left = String(Math.round(free.left));
      card.dataset.top = String(Math.round(free.top));
      card.style.left = `${Math.round(free.left)}px`;
      card.style.top = `${Math.max(8, Math.round(free.top))}px`;
    }
  };

  // Buttons of the card never take the keys away from the page
  const cardButton = (parent, label, action, className = "btn") => {
    const node = el("button", className, parent, label);
    node.type = "button";
    node.addEventListener("pointerdown", (event) => event.preventDefault());
    node.addEventListener("click", () => {
      node.blur();
      action();
    });
    return node;
  };

  // "Show me": a pointer plays the gesture on the target, twice
  const showMe = () => {
    if (!run) return;
    const step = run.steps[run.at];
    const targets = step.targets || [];
    const rect = targets.map(rectOf).find(Boolean);
    if (!rect) {
      App().toast(T("Bring the place back into view: it's out of the window."));
      return;
    }
    const ghost = el("div", "guide-ghost", layer());
    ghost.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 3l0 16 4.2-3.9 3 6.5 2.6-1.2-3-6.4 5.7-.4z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const trail = el("div", "guide-trail", layer());
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    const w = rect.right - rect.left;
    const h = rect.bottom - rect.top;
    const kind = step.show ? Object.keys(step.show)[0] : "click";
    const path = (t) => {
      if (kind === "box") return [rect.left + w * (0.12 + 0.76 * t), rect.top + h * (0.2 + 0.6 * t)];
      if (kind === "lasso") {
        const a = t * Math.PI * 2 - Math.PI / 2;
        return [cx + Math.cos(a) * w * 0.48, cy + Math.sin(a) * h * 0.48];
      }
      if (kind === "drag") return [cx - 40 + 80 * t, cy - 20 + 40 * t];
      // A gradient's drag: top to bottom, or across
      if (kind === "down") return [cx, rect.top + h * (0.06 + 0.88 * t)];
      if (kind === "across") return [rect.left + w * (0.1 + 0.8 * t), cy];
      return [cx, cy];
    };
    const start = performance.now();
    const LOOP = 1700;
    const tick = (now) => {
      const u = (now - start) / LOOP;
      if (u >= 2 || !run) {
        ghost.remove();
        trail.remove();
        return;
      }
      const v = u % 1;
      const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
      let x;
      let y;
      let press = false;
      if (kind === "click") {
        const t = ease(Math.min(1, v / 0.45));
        [x, y] = [cx + (1 - t) * 90, cy + (1 - t) * 70];
        press = v > 0.5 && v < 0.62;
      } else {
        const t = ease((v - 0.15) / 0.6);
        [x, y] = path(t);
        press = v > 0.15 && v < 0.78;
        if (kind === "box") {
          const [x0, y0] = path(0);
          trail.style.cssText = `left:${x0}px;top:${y0}px;width:${Math.max(0, x - x0)}px;height:${Math.max(0, y - y0)}px`;
          trail.hidden = !press;
        } else trail.hidden = true;
      }
      ghost.style.transform = `translate(${x - 5}px, ${y - 3}px)`;
      ghost.classList.toggle("is-pressed", press);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const buildCard = () => {
    const card = el("div", "guide-coach");
    card.setAttribute("role", "status");
    card.setAttribute("popover", "manual");
    const head = el("div", "guide-coach__head", card);
    const title = el("span", "guide-coach__title", head);
    const count = el("span", "guide-coach__count", head);
    const FOLD = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    const UNFOLD = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>';
    const fold = el("button", "guide-coach__icon", head);
    fold.innerHTML = FOLD;
    fold.type = "button";
    fold.title = T("Fold");
    fold.setAttribute("aria-label", T("Fold"));
    const close = el("button", "guide-coach__icon", head);
    close.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    close.type = "button";
    close.title = T("Quit the tutorial");
    close.setAttribute("aria-label", T("Quit the tutorial"));
    const bar = el("div", "guide-coach__bar", card);
    const body = el("div", "guide-coach__body", card);
    // Sentences read from the right in Arabic, as everywhere else in the app
    if (App().setup.lang === "ar") {
      head.dir = "rtl";
      body.dir = "rtl";
    }
    const text = el("p", "guide-coach__text", body);
    const result = el("p", "guide-coach__result", body);
    const foot = el("div", "guide-coach__foot", body);
    fold.addEventListener("pointerdown", (event) => event.preventDefault());
    fold.addEventListener("click", () => {
      card.classList.toggle("is-folded");
      fold.innerHTML = card.classList.contains("is-folded") ? UNFOLD : FOLD;
    });
    close.addEventListener("pointerdown", (event) => event.preventDefault());
    close.addEventListener("click", () => endLesson());
    // Dragged by its head
    head.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      event.preventDefault();
      const r = card.getBoundingClientRect();
      const dx = event.clientX - r.left;
      const dy = event.clientY - r.top;
      head.setPointerCapture(event.pointerId);
      const move = (e) => {
        run.moved = true;
        card.style.left = `${Math.max(0, Math.min(window.innerWidth - r.width, e.clientX - dx))}px`;
        card.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy))}px`;
      };
      const up = () => {
        head.removeEventListener("pointermove", move);
        head.removeEventListener("pointerup", up);
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
    });
    document.body.appendChild(card);
    if (card.showPopover) card.showPopover();
    return { card, title, count, bar, text, result, foot };
  };
  // Above an open dialog too: the newest of the top layer is on top
  let lastDialog = null;
  const keepOnTop = () => {
    if (!run || !run.card || !run.card.showPopover) return;
    const open = Array.from(document.querySelectorAll("dialog[open]")).pop() || null;
    if (open === lastDialog) return;
    lastDialog = open;
    try {
      run.card.hidePopover();
      run.card.showPopover();
    } catch (error) {
      // An older engine: the card stays where it is
    }
  };

  /* ---------------------------------- running a lesson ---------------------------------- */

  const render = () => {
    if (!run) return;
    const { lesson, ui } = run;
    const step = run.steps[run.at];
    ui.title.textContent = T(lesson.title);
    ui.count.textContent = fill(T("Step {n} of {total}"), { n: run.at + 1, total: run.steps.length });
    ui.bar.textContent = "";
    run.steps.forEach((one, i) => el("span", i < run.at ? "is-done" : i === run.at ? "is-on" : "", ui.bar));
    ui.text.textContent = "";
    run.shown = words(step.text, look());
    sentence(ui.text, run.shown);
    ui.result.textContent = "";
    ui.result.hidden = true;
    ui.result.classList.remove("is-keys");
    ui.foot.textContent = "";
    run.card.classList.remove("is-passed");
    if (step.action) cardButton(ui.foot, T(step.action.label), () => step.action.run(), "btn btn--main");
    if ((step.targets || []).some((target) => target.spot || target.panel || target.el) && !step.next) cardButton(ui.foot, T("Show me"), showMe);
    if (step.next || step.canNext) cardButton(ui.foot, T("Next"), () => pass(), "btn btn--main");
    else cardButton(ui.foot, T("Skip"), () => advance());
    drawRings();
  };
  const startStep = async () => {
    if (!run) return;
    // Steps that have nothing to teach here are left out as they come
    while (run.at < run.steps.length && run.steps[run.at].skip && run.steps[run.at].skip(look(), run)) run.at++;
    if (run.at >= run.steps.length) {
      finishLesson();
      return;
    }
    const step = run.steps[run.at];
    run.since = historyIds();
    run.memo = {};
    run.passed = false;
    if (step.enter) step.enter(run);
    if (step.begin) step.begin(look(), run.memo);
    render();
  };
  const advance = () => {
    if (!run) return;
    clearTimeout(run.timer);
    run.at++;
    startStep();
  };
  const pass = (ctx) => {
    if (!run || run.passed) return;
    const step = run.steps[run.at];
    run.passed = true;
    run.card.classList.add("is-passed");
    run.ui.count.textContent = T("Well done!");
    const result = step.result ? words(step.result, ctx || look()) : "";
    run.ui.foot.textContent = "";
    if (result) {
      run.ui.result.textContent = "";
      sentence(run.ui.result, result);
      run.ui.result.hidden = false;
      // Time to read it, or a click to go on
      cardButton(run.ui.foot, T("Next"), () => advance(), "btn btn--main");
      run.timer = setTimeout(advance, Math.min(9000, 2600 + result.length * 45));
    } else run.timer = setTimeout(advance, 900);
    drawRings();
  };
  // The panel's tips about a feature would hide the button a step points at
  const clearPanelTips = (step) => {
    if (!(step.targets || []).some((target) => target.panel)) return;
    const doc = panelDoc();
    if (doc) doc.querySelectorAll(".feature-tip__close").forEach((button) => button.click());
  };
  const check = () => {
    if (!run || run.passed || run.busy) return;
    const step = run.steps[run.at];
    if (!step) return;
    clearPanelTips(step);
    // Its pages closed by hand: the lesson ends with them
    if (run.lesson.page && !practiceDocs().length) {
      endLesson();
      return;
    }
    const hide = Boolean(step.hideWhile && step.hideWhile());
    if (hide !== Boolean(run.hidden)) {
      run.hidden = hide;
      run.card.classList.toggle("is-away", hide);
    }
    keepOnTop();
    const ctx = look();
    // A sentence that depends on a setting follows it while the step is on
    if (typeof step.text === "function") {
      let shown = run.shown;
      try {
        shown = words(step.text, ctx);
      } catch (error) {
        // Kept as it is
      }
      if (shown !== run.shown) {
        run.shown = shown;
        run.ui.text.textContent = "";
        sentence(run.ui.text, shown);
      }
    }
    if (step.next || !step.done) return;
    let ok = false;
    try {
      ok = step.done(ctx, run.since, run.memo);
    } catch (error) {
      ok = false;
    }
    if (ok) pass(ctx);
  };

  // The keys a lesson used, for its last card
  const lessonKeys = (lesson) => {
    const keys = [];
    lesson.steps.forEach((step) => {
      let text = "";
      try {
        text = words(step.text, look());
      } catch (error) {
        text = "";
      }
      const found = String(text).match(/(\{[^{}\s]+\})+/g) || [];
      found.forEach((group) => {
        const combo = group.slice(1, -1).split("}{");
        if (!keys.some((one) => one.join("+") === combo.join("+"))) keys.push(combo);
      });
    });
    return keys;
  };
  // A few bright bits from the card: a lesson is done
  const cheer = (from) => {
    if (STILL || !from) return;
    const r = from.getBoundingClientRect();
    const box = layer();
    const colors = ["#f0a020", "#3fb950", "#288edf", "#e3e4e4", "#f28b82"];
    for (let i = 0; i < 28; i++) {
      const bit = el("span", "guide-bit", box);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
      const d = 90 + Math.random() * 140;
      bit.style.left = `${r.left + r.width * (0.2 + Math.random() * 0.6)}px`;
      bit.style.top = `${r.top + 6}px`;
      bit.style.background = colors[i % colors.length];
      bit.style.setProperty("--dx", `${Math.cos(a) * d}px`);
      bit.style.setProperty("--dy", `${Math.sin(a) * d}px`);
      bit.style.setProperty("--turn", `${(Math.random() - 0.5) * 720}deg`);
      bit.style.animationDelay = `${Math.random() * 0.12}s`;
      setTimeout(() => bit.remove(), 1500);
    }
  };

  const finishLesson = () => {
    const { lesson, ui } = run;
    markDone(lesson.id);
    layer().textContent = "";
    run.passed = true;
    run.card.classList.add("is-passed", "is-finished");
    ui.count.textContent = T("Lesson done!");
    ui.bar.querySelectorAll("span").forEach((dot) => { dot.className = "is-done"; });
    ui.text.textContent = "";
    const after = nextLesson(lesson.id);
    const all = LESSONS.every((one) => doneLessons().has(one.id));
    sentence(ui.text, all ? T("You've done every lesson: SG Typer Studio has no secrets left for you. Help → TypeR Tutorial brings them back at any time.") : fill(T("Next: {lesson}."), { lesson: after ? T(after.title) : "" }));
    ui.result.hidden = true;
    const keys = lessonKeys(lesson);
    if (keys.length) {
      ui.result.textContent = "";
      ui.result.classList.add("is-keys");
      el("span", "guide-coach__keys-title", ui.result, T("Keys of this lesson"));
      const row = el("span", "guide-coach__keys", ui.result);
      keys.forEach((combo) => {
        const one = el("span", "guide-coach__combo", row);
        combo.forEach((key) => el("kbd", "sk__cap", one, capOf(key)));
      });
      ui.result.hidden = false;
    }
    cheer(run.card);
    ui.foot.textContent = "";
    cardButton(ui.foot, T("All lessons"), () => {
      endLesson();
      show();
    });
    if (all) {
      cardButton(ui.foot, T("Close the practice pages"), async () => {
        await closePractice();
      }, "btn btn--main");
    } else if (after) {
      cardButton(ui.foot, T("Next lesson"), () => start(after.id), "btn btn--main");
    }
  };

  function endLesson() {
    if (!run) return;
    clearTimeout(run.timer);
    clearInterval(run.watch);
    if (run.stopEvents) run.stopEvents();
    if (run.card) run.card.remove();
    layer().textContent = "";
    if (ringFrame) cancelAnimationFrame(ringFrame);
    ringFrame = 0;
    run = null;
    lastDialog = null;
    window.removeEventListener("resize", placeCard);
  }

  const start = async (id) => {
    if (!App() || window.TypeRShell.touch) return;
    const lesson = lessonById(id) || nextLesson();
    endLesson();
    if (window.TypeRSFXGuide) window.TypeRSFXGuide.endPractice();
    remember({ last: lesson.id });
    const ui = buildCard();
    run = { lesson, ui, card: ui.card, steps: lesson.steps, at: 0, memo: {}, flags: {}, since: new Set(), lessonSince: new Set(), busy: true };
    ui.title.textContent = T(lesson.title);
    ui.count.textContent = T("Getting the practice chapter ready…");
    ui.text.textContent = "";
    ui.result.hidden = true;
    window.addEventListener("resize", placeCard);
    placeCard();
    try {
      if (lesson.page || lesson.id === "finish") await ensurePractice();
      if (!run || run.lesson !== lesson) return;
      if (lesson.needsText && !(docOfPage(1) && docOfPage(1).state.layers.some((one) => one.kind === "text"))) {
        App().toast(T("This lesson retouches the texts of page 1: first, the Typeset lesson."));
        start("typeset");
        return;
      }
      if (lesson.page) await showPage(lesson.page);
      if (lesson.page && app.doc && !app.doc.view.fitted) App().fitView();
      if (lesson.enter) await lesson.enter();
      if (lesson.start) lesson.start(run);
    } catch (error) {
      console.warn("TypeR tutorial: the practice chapter", error);
    }
    if (!run || run.lesson !== lesson) return;
    run.busy = false;
    run.lessonSince = historyIds();
    run.watch = setInterval(check, 200);
    run.stopEvents = PS.on ? PS.on((type) => { if (type === "history") setTimeout(check, 0); }) : null;
    await startStep();
    if (!ringFrame) ringFrame = requestAnimationFrame(ringLoop);
  };

  /* --------------------------------------- the lessons' list --------------------------------------- */

  const ICONS = {
    workspace: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M16 4v16"/>',
    clean: '<path d="M14 4l6 6-9 9H5v-6z"/><path d="M9 9l6 6"/>',
    script: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h3"/>',
    styles: '<path d="M5 19L12 4l7 15"/><path d="M8 13h8"/>',
    typeset: '<path d="M4 6a8 6 0 0 1 16 0c0 3.3-3.6 6-8 6l-4 4v-4.5C5.6 10.5 4 8.4 4 6z"/>',
    retouch: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
    gradient: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12 12 3"/><path d="M4 20 20 4" stroke-opacity="0.6"/><path d="M12 21 21 12" stroke-opacity="0.25"/>',
    sfx: '<path d="M4 15l4-8 3 6 3-9 3 11 3-4"/>',
    finish: '<path d="M5 12l4 4 10-10"/>',
  };
  let hub = null;
  function show() {
    if (!App() || hub) return;
    if (window.TypeRShell.touch) {
      App().startPanel({ tour: true });
      return;
    }
    const done = doneLessons();
    const modal = el("dialog", "modal guide-hub", document.body);
    hub = modal;
    if (App().setup.lang === "ar") modal.dir = "rtl";
    const head = el("div", "guide-hub__head", modal);
    el("h2", "guide-hub__title", head, T("TypeR Tutorial"));
    el("p", "guide-hub__lead", head, T("Short lessons on a practice chapter of three pages, in the real workspace. Each step checks itself as soon as you do it. Your own pages and scripts stay as they are."));
    const progress = el("div", "guide-hub__progress", head);
    const count = LESSONS.filter((lesson) => done.has(lesson.id)).length;
    el("span", "guide-hub__meter", progress).style.setProperty("--done", String(count / LESSONS.length));
    el("span", "guide-hub__stat", progress, fill(T("{done} of {total} lessons done"), { done: count, total: LESSONS.length }));
    const grid = el("div", "guide-hub__grid", modal);
    const close = (then) => {
      modal.close();
      modal.remove();
      hub = null;
      if (then) then();
    };
    const first = nextLesson();
    LESSONS.forEach((lesson, i) => {
      const card = el("button", "guide-lesson", grid);
      card.type = "button";
      if (done.has(lesson.id)) card.classList.add("is-done");
      if (first && lesson.id === first.id && !done.has(lesson.id)) card.classList.add("is-next");
      const icon = el("span", "guide-lesson__icon", card);
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[lesson.id] || ""}</svg>`;
      const words2 = el("span", "guide-lesson__words", card);
      el("strong", null, words2, `${i + 1}. ${T(lesson.title)}`);
      el("span", "guide-lesson__about", words2, T(lesson.about));
      el("span", "guide-lesson__meta", card, done.has(lesson.id) ? "✓" : fill(T("{n} min"), { n: lesson.minutes }));
      card.addEventListener("click", () => close(() => start(lesson.id)));
    });
    const foot = el("div", "modal__foot guide-hub__foot", modal);
    if (practiceDocs().length || (panelStorage().tabs || []).some((tab) => tab.id === TAB_ID)) {
      const tidy = el("button", "btn guide-hub__tidy", foot, T("Close the practice pages"));
      tidy.type = "button";
      tidy.addEventListener("click", () => close(() => closePractice()));
    }
    const later = el("button", "btn", foot, T("Close"));
    later.type = "button";
    later.addEventListener("click", () => close());
    const go = el("button", "btn btn--main", foot, count === 0 ? T("Start") : count === LESSONS.length ? T("Start again") : T("Continue"));
    go.type = "button";
    go.addEventListener("click", () => close(() => start((first || LESSONS[0]).id)));
    modal.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    modal.showModal();
    go.focus();
  }

  window.TypeRGuide = { show, start, end: endLesson, closePractice, active: () => Boolean(run), lessons: () => LESSONS.map((lesson) => lesson.id), drawPage, SPOTS };
})();
