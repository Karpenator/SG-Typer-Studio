// Which interface this screen gets, decided in the head so the page never shows the wrong
// one first. A computer gets the Photoshop-like workspace; a tablet and a phone get the one
// made for fingers (touch.js, touch.css). Also keeps the page above the on-screen keyboard.

(function () {
  "use strict";

  const STORE = "typer.web.interface";
  const root = document.documentElement;
  const listeners = new Set();
  const viewport = window.visualViewport;
  const coarse = window.matchMedia("(pointer: coarse)");

  const chosen = () => {
    const query = new URLSearchParams(window.location.search).get("ui");
    if (["phone", "tablet", "desktop"].includes(query)) return query;
    try {
      const saved = window.localStorage.getItem(STORE);
      return ["touch", "desktop"].includes(saved) ? saved : null;
    } catch (error) {
      return null;
    }
  };

  const detect = () => {
    const wish = chosen();
    if (wish === "desktop") return "desktop";
    if (wish === "phone" || wish === "tablet") return wish;
    const width = window.innerWidth;
    const fingers = coarse.matches;
    // A small window on a computer stays a computer's: a mouse has no use for the big buttons,
    // the panels make room instead (app.js)
    if (!fingers && wish !== "touch") return "desktop";
    // The screen's size, not the window's: the keyboard takes half a landscape tablet
    if (width <= 760 || (fingers && Math.min(window.screen.width, window.screen.height) <= 600)) return "phone";
    if ((fingers && width <= 1400) || wish === "touch") return "tablet";
    return "desktop";
  };

  // Where the panels open: under the thumb on a phone, beside the page when there's room
  const sheetSide = (kind) => {
    const width = window.innerWidth;
    if (kind === "phone") return width > window.innerHeight ? "right" : "bottom";
    return width >= 1000 ? "dock" : "bottom";
  };

  const isTyping = () => {
    let active = document.activeElement;
    while (active && active.tagName === "IFRAME") {
      try {
        active = active.contentDocument.activeElement;
      } catch (error) {
        return false;
      }
    }
    return Boolean(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName);
  };

  const Shell = {
    kind: "desktop",
    side: "bottom",
    get touch() { return Shell.kind !== "desktop"; },
    keyboard: 0,
    // iOS doesn't tell the page when a field in TypeR's iframe brings the keyboard up: the
    // iframe says so itself (bridge.js)
    syncKeyboard() {
      followKeyboard();
    },
    onChange(listener) {
      listeners.add(listener);
    },
    // The user's choice: touch or desktop, whatever the screen is
    prefer(wish) {
      try {
        window.localStorage.setItem(STORE, wish);
      } catch (error) {
        console.warn("SG Typer Studio: could not keep the interface", error);
      }
      refresh();
    },
  };

  let lastWidth = 0;
  const refresh = () => {
    const width = window.innerWidth;
    // The keyboard changes the window's height, which says nothing about the device
    if (width === lastWidth && Shell.keyboard && isTyping()) return;
    lastWidth = width;
    const kind = detect();
    const side = sheetSide(kind);
    if (kind === Shell.kind && side === Shell.side) return;
    Shell.kind = kind;
    Shell.side = side;
    root.classList.toggle("touch", kind !== "desktop");
    root.dataset.shell = kind;
    if (kind === "desktop") delete root.dataset.sheet;
    else root.dataset.sheet = side;
    listeners.forEach((listener) => listener());
  };

  // iOS slides the page under the keyboard instead of making it smaller: what the keyboard
  // covers becomes a margin, and the page is put back at the top
  const followKeyboard = () => {
    if (!viewport) return;
    const covered = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
    const keyboard = covered > 100 ? covered : 0;
    if (viewport.offsetTop && !Shell.keyboard && !keyboard) window.scrollTo(0, 0);
    if (keyboard === Shell.keyboard) return;
    Shell.keyboard = keyboard;
    root.style.setProperty("--kb", `${keyboard}px`);
    root.classList.toggle("kb-open", Boolean(keyboard));
    listeners.forEach((listener) => listener());
  };

  refresh();
  window.addEventListener("resize", refresh);
  coarse.addEventListener("change", refresh);
  if (viewport) {
    viewport.addEventListener("resize", followKeyboard);
    viewport.addEventListener("scroll", () => {
      if (Shell.touch && viewport.offsetTop) window.scrollTo(0, 0);
      followKeyboard();
    });
  }

  window.TypeRShell = Shell;
})();
