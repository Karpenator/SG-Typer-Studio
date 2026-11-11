// A key that stands for a mouse button, for those who can't click where they work: a library,
// a train, a shared office. Held down, the key is the button held down: a click, a drag, a
// stroke of the brush, a right click for the menu. The pointer still comes from the trackpad or
// the mouse, moved without a click. The keys are chosen in Settings › Keyboard Shortcuts
// (app.js), none by default.
//
// The browser lets a page send its own pointer and mouse events, not move the real button, so
// this plays the part of the button: the events a click sends, in their order, at the pointer,
// in the page or in the panel's frame. What the browser does by itself on a real click is done
// here too where it counts: the focus, a list that opens, a slider that follows. A drag in the
// page asks for the pointer (setPointerCapture), which only a real button can have: that ask
// is kept here, and the moves go where it says.
(() => {
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const POINTER_ID = 1;
  const BUTTONS = { 0: 1, 2: 2 };
  const FOCUSABLE = "input, textarea, select, button, a[href], [tabindex], [contenteditable=''], [contenteditable='true'], summary";
  const DOUBLE_TIME = 500;
  const DOUBLE_GAP = 5;

  let options = { keys: () => ({}), keyOf: () => null, skip: () => false };
  // Where the pointer is, in the page's coordinates, and which key holds which button
  let pointer = null;
  let held = null;
  let lastClick = null;

  const frameOf = (win) => {
    if (win === window) return null;
    return Array.from(document.querySelectorAll("iframe")).find((frame) => {
      try {
        return frame.contentWindow === win;
      } catch (error) {
        return false;
      }
    }) || null;
  };
  const frameOffset = (win) => {
    const frame = frameOf(win);
    if (!frame) return [0, 0];
    const rect = frame.getBoundingClientRect();
    return [rect.left + frame.clientLeft, rect.top + frame.clientTop];
  };
  // What a real click would land on, through the panel's frame
  const hitAt = (x, y) => {
    let win = window;
    let localX = x;
    let localY = y;
    let el = document.elementFromPoint(x, y);
    while (el && el.tagName === "IFRAME") {
      let inner = null;
      try {
        inner = el.contentWindow && el.contentWindow.document;
      } catch (error) {
        inner = null;
      }
      if (!inner) break;
      const rect = el.getBoundingClientRect();
      localX -= rect.left + el.clientLeft;
      localY -= rect.top + el.clientTop;
      win = el.contentWindow;
      el = inner.elementFromPoint(localX, localY);
    }
    return el ? { el, win, x: localX, y: localY } : null;
  };
  const localTo = (win, x, y) => {
    const [dx, dy] = frameOffset(win);
    return [x - dx, y - dy];
  };

  const send = (type, target, win, x, y, extra) => {
    const Pointer = /^(mouse|dblclick)/.test(type) ? win.MouseEvent : win.PointerEvent || win.MouseEvent;
    const mods = held ? held.mods : { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
    const init = Object.assign({
      bubbles: true,
      cancelable: type !== "lostpointercapture",
      composed: true,
      view: win,
      clientX: x,
      clientY: y,
      screenX: x + (win.screenX || 0),
      screenY: y + (win.screenY || 0),
      pointerId: POINTER_ID,
      pointerType: "mouse",
      isPrimary: true,
      width: 1,
      height: 1,
    }, mods, extra);
    const event = new Pointer(type, init);
    target.dispatchEvent(event);
    return event;
  };

  const commonAncestor = (a, b) => {
    if (!a || !b || a.ownerDocument !== b.ownerDocument) return null;
    for (let node = a; node; node = node.parentNode) if (node.contains(b)) return node;
    return null;
  };

  // A slider follows the pointer, as it would under a held button
  const slide = (input, win, x) => {
    const rect = input.getBoundingClientRect();
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const step = input.step === "any" ? 0 : Number(input.step || 1);
    const style = win.getComputedStyle(input);
    let ratio = rect.width ? (x - rect.left) / rect.width : 0;
    if (style.direction === "rtl") ratio = 1 - ratio;
    let value = min + Math.min(1, Math.max(0, ratio)) * (max - min);
    if (step) value = min + Math.round((value - min) / step) * step;
    const text = String(Math.min(max, Math.max(min, value)));
    if (input.value === text) return;
    input.value = text;
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  };

  // What the browser does by itself when a button goes down where nothing stopped it
  const pressDefault = (hit) => {
    const doc = hit.win.document;
    const focusable = hit.el.closest(FOCUSABLE);
    if (focusable && !focusable.disabled) {
      focusable.focus({ preventScroll: true });
      if (focusable.isContentEditable && doc.caretRangeFromPoint) {
        const range = doc.caretRangeFromPoint(hit.x, hit.y);
        if (range) {
          const selection = hit.win.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      if (held.button === 0 && focusable.tagName === "SELECT" && focusable.showPicker) {
        try {
          focusable.showPicker();
        } catch (error) {
          // A list that can't open from here still has the focus, and its arrow keys
        }
      }
      if (held.button === 0 && focusable.tagName === "INPUT" && focusable.type === "range") {
        held.slider = focusable;
        held.sliderStart = focusable.value;
        slide(focusable, hit.win, hit.x);
      }
      return;
    }
    // A click on nothing takes the focus away from a field, and out of the panel's frame
    if (doc.activeElement && doc.activeElement !== doc.body) doc.activeElement.blur();
    if (hit.win === window && document.activeElement && document.activeElement.tagName === "IFRAME") document.activeElement.blur();
    if (hit.win !== window) hit.win.focus();
  };

  const press = (button, mods, code) => {
    if (held || !pointer) return false;
    const hit = hitAt(pointer.x, pointer.y);
    if (!hit) return false;
    const now = performance.now();
    const again = lastClick && lastClick.button === button && now - lastClick.time < DOUBLE_TIME && Math.hypot(pointer.x - lastClick.x, pointer.y - lastClick.y) < DOUBLE_GAP;
    const detail = again ? lastClick.detail + 1 : 1;
    held = { button, code, mods, down: hit.el, downWin: hit.win, capture: null, mouse: true, detail, slider: null };
    const extra = { button, buttons: BUTTONS[button], pressure: 0.5, detail };
    const down = send("pointerdown", hit.el, hit.win, hit.x, hit.y, extra);
    // A pointerdown turned down keeps the mouse events away until the button is let go
    if (down.defaultPrevented) held.mouse = false;
    const mouseDown = held.mouse ? send("mousedown", hit.el, hit.win, hit.x, hit.y, extra) : null;
    if (!mouseDown || !mouseDown.defaultPrevented) pressDefault(hit);
    // On a Mac the menu comes with the button going down, and with Ctrl + click
    if (IS_MAC && held && (button === 2 || (button === 0 && mods.ctrlKey))) {
      send("contextmenu", hit.el, hit.win, hit.x, hit.y, { button: 2, buttons: BUTTONS[button], detail });
    }
    return true;
  };

  const move = () => {
    if (!held || !pointer) return;
    const extra = { button: -1, buttons: BUTTONS[held.button], pressure: 0.5 };
    if (held.slider) {
      const [x] = localTo(held.slider.ownerDocument.defaultView, pointer.x, pointer.y);
      slide(held.slider, held.slider.ownerDocument.defaultView, x);
      return;
    }
    const capture = held.capture && held.capture.isConnected ? held.capture : null;
    if (capture) {
      const win = capture.ownerDocument.defaultView;
      const [x, y] = localTo(win, pointer.x, pointer.y);
      send("pointermove", capture, win, x, y, extra);
      if (held.mouse) send("mousemove", capture, win, x, y, extra);
      return;
    }
    const hit = hitAt(pointer.x, pointer.y);
    if (!hit) return;
    send("pointermove", hit.el, hit.win, hit.x, hit.y, extra);
    if (held.mouse) send("mousemove", hit.el, hit.win, hit.x, hit.y, extra);
  };

  const release = (click) => {
    if (!held) return;
    const was = held;
    const extra = { button: was.button, buttons: 0, pressure: 0, detail: was.detail };
    const at = pointer || { x: 0, y: 0 };
    const capture = was.capture && was.capture.isConnected ? was.capture : null;
    let target;
    let win;
    let x;
    let y;
    if (capture) {
      target = capture;
      win = capture.ownerDocument.defaultView;
      [x, y] = localTo(win, at.x, at.y);
    } else {
      const hit = hitAt(at.x, at.y);
      if (!hit) {
        held = null;
        return;
      }
      ({ el: target, win, x, y } = hit);
    }
    send("pointerup", target, win, x, y, extra);
    if (capture) send("lostpointercapture", capture, win, x, y, extra);
    held.capture = null;
    if (was.mouse) send("mouseup", target, win, x, y, extra);
    if (was.slider) {
      if (was.slider.value !== was.sliderStart) was.slider.dispatchEvent(new (was.slider.ownerDocument.defaultView.Event)("change", { bubbles: true }));
    }
    if (click) {
      const where = was.slider || commonAncestor(was.down, target);
      if (where) {
        if (was.button === 0) {
          send("click", where, win, x, y, extra);
          if (was.detail === 2) send("dblclick", where, win, x, y, extra);
        } else {
          send("auxclick", where, win, x, y, extra);
          if (!IS_MAC) send("contextmenu", target, win, x, y, { button: 2, buttons: 0, detail: was.detail });
        }
      }
      lastClick = { button: was.button, time: performance.now(), x: at.x, y: at.y, detail: was.detail };
    }
    held = null;
  };

  // A drag asks for the pointer: the page or the panel gets it from here while a key holds it
  const patchCapture = (win) => {
    const proto = win.Element && win.Element.prototype;
    if (!proto || proto.__typerKeyClick) return;
    const set = proto.setPointerCapture;
    const free = proto.releasePointerCapture;
    const has = proto.hasPointerCapture;
    proto.setPointerCapture = function (id) {
      if (held && id === POINTER_ID) {
        held.capture = this;
        return undefined;
      }
      return set.call(this, id);
    };
    proto.releasePointerCapture = function (id) {
      if (held && id === POINTER_ID) {
        if (held.capture === this) held.capture = null;
        return undefined;
      }
      return free.call(this, id);
    };
    proto.hasPointerCapture = function (id) {
      if (held && id === POINTER_ID) return held.capture === this;
      return has.call(this, id);
    };
    proto.__typerKeyClick = true;
  };

  const buttonOf = (event) => {
    const keys = options.keys() || {};
    const name = options.keyOf(event);
    if (!name) return null;
    if (keys[0] === name) return 0;
    if (keys[2] === name) return 2;
    return null;
  };

  // A frame that loads again may keep its window or get a new one: the mark goes with the window
  const watch = (win) => {
    if (!win || win.__typerKeyClick) return;
    win.__typerKeyClick = true;
    patchCapture(win);
    const track = (event) => {
      // Ours, or a real button: the real one goes its own way
      if (!event.isTrusted || event.pointerType === "touch" || event.pointerType === "pen") return;
      const [dx, dy] = frameOffset(win);
      pointer = { x: event.clientX + dx, y: event.clientY + dy };
      // While a key holds the button, the real moves (no button) give way to the held ones
      if (held && (event.type === "pointermove" || event.type === "mousemove")) {
        event.stopImmediatePropagation();
        if (event.type === "pointermove") move();
      }
    };
    win.addEventListener("pointermove", track, true);
    win.addEventListener("mousemove", track, true);
    win.addEventListener("pointerdown", track, true);
    win.addEventListener("keydown", (event) => {
      if (!event.isTrusted) return;
      // Its repeats while held, and the key itself, are the button's: never a shortcut too
      if (held && event.code === held.code) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const button = buttonOf(event);
      if (button === null || options.skip(event, win)) return;
      if (event.repeat) return;
      const mods = { shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey };
      if (!press(button, mods, event.code)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    win.addEventListener("keyup", (event) => {
      if (!held || event.code !== held.code) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      release(true);
    }, true);
    // Shift, Alt, Ctrl and Cmd while the button is held: as with a real one, they count from then
    const modifiers = (event) => {
      if (!held || !/^(Shift|Alt|Control|Meta)$/.test(event.key)) return;
      held.mods = { shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey };
    };
    win.addEventListener("keydown", modifiers, true);
    win.addEventListener("keyup", modifiers, true);
    // Cmd+Tab, another window: the key is never let go here, the button goes up
    win.addEventListener("blur", () => {
      if (held && document.hasFocus && !document.hasFocus()) release(false);
    });
  };

  const watchFrames = () => {
    document.querySelectorAll("iframe").forEach((frame) => {
      const hook = () => {
        try {
          if (frame.contentWindow && frame.contentWindow.document) watch(frame.contentWindow);
        } catch (error) {
          // Another origin: its clicks are its own
        }
      };
      if (!frame.__typerKeyClick) {
        frame.__typerKeyClick = true;
        frame.addEventListener("load", hook);
      }
      hook();
    });
  };

  watch(window);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchFrames);
  else watchFrames();

  window.TypeRKeyClick = {
    // keys: () => ({ 0: "F", 2: "G" }); keyOf: the key an event names; skip: a key to leave alone
    configure: (given) => {
      options = Object.assign({}, options, given);
      watchFrames();
    },
    // The panel's frame signs up itself (bridge.js), before its own scripts run
    watch,
    held: () => Boolean(held),
  };
})();
