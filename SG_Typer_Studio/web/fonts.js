// The workspace fonts. Four faces ship with the application. Fonts installed
// on the computer are reached by name through local(), and font files the user
// loads are kept in the browser (IndexedDB). Nothing is uploaded anywhere.

(function () {
  "use strict";

  const BUILTIN = [
    { name: "Wildjess Normal", postScriptName: "WildjessNormal", family: "Wildjess", style: "Normal", weight: 400, italic: false, file: "wildjess-normal" },
    { name: "Wildjess Italic", postScriptName: "WildjessItalic", family: "Wildjess", style: "Italic", weight: 400, italic: true, file: "wildjess-italic" },
    { name: "Wildjess BoldItalic", postScriptName: "WildjessBoldItalic", family: "Wildjess", style: "BoldItalic", weight: 700, italic: true, file: "wildjess-bolditalic" },
    { name: "Bangers", postScriptName: "Bangers-Regular", family: "Bangers", style: "Regular", weight: 400, italic: false, file: "bangers-400" },
  ];

  const fonts = new Map(); // PostScript name -> font
  const normalize = (value) => String(value || "").toLowerCase().replace(/[\s\-_.,]+/g, "");
  const missing = new Set();
  const pending = new Map();
  const listeners = new Set();
  let generation = 0;
  // Counts each change of the Map itself, even between two changed(): what is computed from
  // it below (the names index, resolve's answers, the list) is never behind it
  let version = 0;
  const put = (ps, font) => {
    fonts.set(ps, font);
    version++;
  };
  const drop = (ps) => {
    fonts.delete(ps);
    version++;
  };

  BUILTIN.forEach((font) => put(font.postScriptName, Object.assign({ source: "builtin", css: font.family, ready: true }, font)));

  const changed = () => {
    generation++;
    listeners.forEach((listener) => listener());
  };

  const cssNameOf = (ps) => "TR-" + String(ps).replace(/[^\w-]/g, "_");
  const quote = (name) => `"${String(name).replace(/["\\]/g, "")}"`;

  // A font known by name but not loaded yet: the browser looks it up on the computer
  const ensure = (ps, fullName) => {
    if (!ps) return Promise.resolve(false);
    const known = fonts.get(ps);
    if (known && known.ready) return Promise.resolve(true);
    if (sameFont(ps)) return Promise.resolve(true);
    if (pending.has(ps)) return pending.get(ps);
    const stored = known && known.source === "file" ? known : storedFont(ps, fullName);
    if (stored) return loadStored(stored.postScriptName);
    if (missing.has(ps)) return Promise.resolve(false);
    const names = [ps, fullName, known && known.name].filter(Boolean);
    const css = cssNameOf(ps);
    const src = names.map((name) => `local(${quote(name)})`).join(", ");
    const face = new FontFace(css, src);
    const promise = face.load().then(() => {
      document.fonts.add(face);
      put(ps, Object.assign({ name: fullName || ps, postScriptName: ps, family: ps, style: "Regular", source: "local", weight: 400, italic: false }, known, { css, src, ready: true }));
      missing.delete(ps);
      pending.delete(ps);
      changed();
      return true;
    }, () => {
      missing.add(ps);
      pending.delete(ps);
      changed();
      return false;
    });
    pending.set(ps, promise);
    return promise;
  };

  // The fonts by their names, as TypeR matches them (spelling differences aside), and by
  // their exact family and style. A text is looked up for each run drawn, and the computer
  // can have thousands of fonts: the index is built once per change of the Map, not per look-up
  let index = null;
  let indexVersion = -1;
  const indexOf = () => {
    if (index && indexVersion === version) return index;
    const ready = { ps: new Map(), name: new Map(), familyStyle: new Map(), family: new Map(), exact: new Map() };
    const stored = { ps: new Map(), name: new Map(), familyStyle: new Map() };
    const order = new Map();
    const add = (map, key, font) => {
      if (key && !map.has(key)) map.set(key, font);
    };
    let at = 0;
    for (const font of fonts.values()) {
      order.set(font, at++);
      const into = font.ready ? ready : font.source === "file" ? stored : null;
      if (!into) continue;
      add(into.ps, normalize(font.postScriptName), font);
      add(into.name, normalize(font.name), font);
      add(into.familyStyle, normalize(`${font.family}${font.style}`), font);
      if (!font.ready) continue;
      if (!ready.family.has(font.family)) ready.family.set(font.family, font);
      const exact = `${font.family}\u0000${font.style}`;
      if (!ready.exact.has(exact)) ready.exact.set(exact, font);
    }
    index = { ready, stored, order };
    indexVersion = version;
    return index;
  };
  // The first font added that matches by one of its names
  const firstNamed = (maps, ps, family, style) => {
    const wanted = normalize(ps);
    const full = normalize(`${family || ""}${style || ""}`);
    const { order } = indexOf();
    let best = null;
    const consider = (font) => {
      if (font && (!best || order.get(font) < order.get(best))) best = font;
    };
    if (wanted) consider(maps.ps.get(wanted));
    if (full) {
      consider(maps.name.get(full));
      consider(maps.familyStyle.get(full));
    }
    return best;
  };

  // A file kept in this browser, known by its name until it's needed
  const storedFont = (ps, family, style) => firstNamed(indexOf().stored, ps, family, style);
  const loadStored = (ps) => {
    if (pending.has(ps)) return pending.get(ps);
    const promise = (async () => {
      const db = await openStore();
      const row = await new Promise((done, fail) => {
        const request = db.transaction(STORE).objectStore(STORE).get(ps);
        request.onsuccess = () => done(request.result);
        request.onerror = () => fail(request.error);
      });
      if (!row) throw new Error("This font's file is gone");
      await addBuffer(row.buffer.slice(0), row.name);
      return true;
    })().catch((error) => {
      console.warn("SG Typer Studio: could not load a kept font", ps, error);
      drop(ps);
      missing.add(ps);
      return false;
    }).then((loaded) => {
      pending.delete(ps);
      changed();
      return loaded;
    });
    pending.set(ps, promise);
    return promise;
  };

  // The same font under a slightly different spelling, as TypeR matches them
  const sameFont = (ps, family, style) => firstNamed(indexOf().ready, ps, family, style);

  // What to draw a text style with, right now. An unknown font starts loading and
  // the page is drawn again when it arrives. The answer for a font that isn't there is
  // kept until the fonts change: it's asked for each run drawn, and the loading it
  // starts is only started once.
  const resolved = new Map();
  let resolvedVersion = -1;
  const resolve = (textStyle) => {
    const ps = textStyle.fontPostScriptName;
    const known = ps && fonts.get(ps);
    if (known && known.ready) return known;
    if (resolvedVersion !== version) {
      resolved.clear();
      resolvedVersion = version;
    }
    const key = `${ps || ""}\u0000${textStyle.fontName || ""}\u0000${textStyle.fontStyleName || ""}`;
    const kept = resolved.get(key);
    if (kept) return kept;
    let found = sameFont(ps, textStyle.fontName, textStyle.fontStyleName);
    if (!found) {
      const stored = storedFont(ps, textStyle.fontName, textStyle.fontStyleName);
      if (stored) loadStored(stored.postScriptName);
      else if (ps) ensure(ps, textStyle.fontName);
      const { ready } = indexOf();
      const name = textStyle.fontName || "";
      const byName = textStyle.fontStyleName ? ready.exact.get(`${name}\u0000${textStyle.fontStyleName}`) : ready.family.get(name);
      found = byName || { css: "Wildjess", weight: 400, italic: false, fallback: true };
    }
    resolved.set(key, found);
    return found;
  };

  // With Standard ligatures off, Photoshop turns off the font's whole "liga" feature, and with it
  // the letter variants some lettering fonts keep there (a doubled letter drawn another way).
  // Canvas has no switch for it: such text is drawn with a twin of the font that has it off.
  // Until the twin is there, the font itself is used, and the page is drawn again after.
  const twins = new Map(); // PostScript name -> the twin's CSS name, null while it loads, false if it can't
  const sourceOf = (font) => {
    if (font.source === "builtin") return `url("../assets/fonts/${font.file}.woff2")`;
    if (font.source === "file") return font.url ? `url(${quote(font.url)})` : null;
    return font.src || null;
  };
  const withoutLigatures = (font) => {
    const ps = font && font.ready && font.postScriptName;
    if (!ps) return null;
    if (twins.has(ps)) return twins.get(ps) || null;
    const src = sourceOf(font);
    if (!src) {
      twins.set(ps, false);
      return null;
    }
    const css = `${font.css}--noliga`;
    twins.set(ps, null);
    const descriptors = { featureSettings: '"liga" 0' };
    if (font.source === "builtin") Object.assign(descriptors, { weight: String(font.weight), style: font.italic ? "italic" : "normal" });
    const face = new FontFace(css, src, descriptors);
    face.load().then(() => {
      document.fonts.add(face);
      twins.set(ps, css);
      changed();
    }, (error) => {
      console.warn("SG Typer Studio: could not turn a font's ligatures off", ps, error);
      twins.set(ps, false);
    });
    return null;
  };

  const isMissing = (ps) => Boolean(ps) && missing.has(ps) && !(fonts.get(ps) && fonts.get(ps).ready) && !sameFont(ps);

  const ready = (names) => Promise.all(Array.from(new Set(names)).filter(Boolean).map((ps) => ensure(ps)));

  const builtinsLoaded = () => Promise.all(BUILTIN.map((font) => document.fonts.load(`${font.italic ? "italic " : ""}${font.weight} 32px "${font.family}"`))).catch(() => []);

  // Sorted once per change of the fonts: the menus ask for it often
  let listed = null;
  let listedVersion = -1;
  const list = () => {
    if (!listed || listedVersion !== version) {
      listed = Array.from(fonts.values()).filter((font) => font.source !== "local" || font.listed !== false).sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style));
      listedVersion = version;
    }
    return listed;
  };

  /* ---------------------- fonts installed on the computer ---------------------- */

  const canListInstalled = () => typeof window.queryLocalFonts === "function";

  // Only news is told: listing the same fonts again changes nothing
  const addInstalled = (entries, first) => {
    let added = 0;
    entries.forEach((entry) => {
      const ps = entry.postscriptName;
      if (!ps || fonts.has(ps)) return;
      put(ps, { name: entry.fullName || ps, postScriptName: ps, family: entry.family || ps, style: entry.style || "Regular", source: "local", css: cssNameOf(ps), weight: 400, italic: false, ready: false });
      added++;
    });
    if (added || first) changed();
  };

  let installedListed = false;
  const useInstalled = async () => {
    if (!canListInstalled()) return 0;
    const entries = await window.queryLocalFonts();
    const first = !installedListed;
    installedListed = true;
    addInstalled(entries, first);
    return entries.length;
  };

  /* ------------------------- font files, kept in the browser ------------------------- */

  // The name table of a TrueType or OpenType file
  const readNames = (buffer) => {
    const data = new DataView(buffer);
    const tag = (at) => String.fromCharCode(data.getUint8(at), data.getUint8(at + 1), data.getUint8(at + 2), data.getUint8(at + 3));
    const count = data.getUint16(4);
    for (let i = 0; i < count; i++) {
      const at = 12 + i * 16;
      if (tag(at) !== "name") continue;
      const table = data.getUint32(at + 8);
      const records = data.getUint16(table + 2);
      const strings = table + data.getUint16(table + 4);
      const out = {};
      for (let r = 0; r < records; r++) {
        const entry = table + 6 + r * 12;
        const platform = data.getUint16(entry);
        const id = data.getUint16(entry + 6);
        const length = data.getUint16(entry + 8);
        const offset = strings + data.getUint16(entry + 10);
        if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
        let text = "";
        if (platform === 1) {
          for (let c = 0; c < length; c++) text += String.fromCharCode(data.getUint8(offset + c));
        } else {
          for (let c = 0; c + 1 < length; c += 2) text += String.fromCharCode(data.getUint16(offset + c));
        }
        if (!out[id] || platform === 3) out[id] = text;
      }
      return { family: out[16] || out[1], style: out[17] || out[2], full: out[4], ps: out[6] };
    }
    return {};
  };

  // The browser's database: font files here, TypeR's own files in kit.js
  const STORE = "fonts";
  let opening = null;
  const openStore = () => {
    if (!opening) {
      opening = new Promise((done, fail) => {
        const request = indexedDB.open("typer-web", 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "ps" });
          if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "path" });
        };
        request.onsuccess = () => done(request.result);
        request.onerror = () => fail(request.error);
      });
      opening.catch(() => { opening = null; });
    }
    return opening;
  };

  // A .ttc holds several fonts: each one becomes a font file of its own
  const splitCollection = (buffer) => {
    const data = new DataView(buffer);
    if (data.getUint32(0) !== 0x74746366) return [buffer]; // 'ttcf'
    const out = [];
    const count = Math.min(data.getUint32(8), 64);
    for (let i = 0; i < count; i++) {
      const base = data.getUint32(12 + i * 4);
      const tables = data.getUint16(base + 4);
      let size = 12 + tables * 16;
      for (let t = 0; t < tables; t++) size += (data.getUint32(base + 12 + t * 16 + 12) + 3) & ~3;
      const piece = new Uint8Array(size);
      const target = new DataView(piece.buffer);
      piece.set(new Uint8Array(buffer, base, 12 + tables * 16), 0);
      let at = 12 + tables * 16;
      for (let t = 0; t < tables; t++) {
        const record = base + 12 + t * 16;
        const length = data.getUint32(record + 12);
        piece.set(new Uint8Array(buffer, data.getUint32(record + 8), length), at);
        target.setUint32(12 + t * 16 + 8, at);
        at += (length + 3) & ~3;
      }
      out.push(piece.buffer);
    }
    return out;
  };

  const addBuffer = async (buffer, fallbackName) => {
    let names = {};
    try {
      names = readNames(buffer);
    } catch (error) {
      names = {};
    }
    const base = String(fallbackName || "Font").replace(/\.[^.]+$/, "");
    const ps = names.ps || base.replace(/\s+/g, "");
    const css = cssNameOf(ps);
    const face = new FontFace(css, buffer);
    await face.load();
    document.fonts.add(face);
    const font = { name: names.full || base, postScriptName: ps, family: names.family || base, style: names.style || "Regular", source: "file", css, weight: 400, italic: false, ready: true, size: buffer.byteLength, url: URL.createObjectURL(new Blob([buffer])) };
    put(ps, font);
    missing.delete(ps);
    return font;
  };

  // Files or { name, buffer }. A font that can't be read doesn't stop the others.
  const addFiles = async (files) => {
    const added = [];
    const failed = [];
    const notKept = [];
    const db = await openStore().catch(() => null);
    for (const file of Array.from(files)) {
      const buffer = file.buffer || await file.arrayBuffer();
      let pieces;
      try {
        pieces = splitCollection(buffer);
      } catch (error) {
        failed.push(file.name);
        continue;
      }
      for (const piece of pieces) {
        try {
          const font = await addBuffer(piece.slice(0), file.name);
          added.push(font);
          if (db) {
            const kept = await new Promise((done) => {
              const tx = db.transaction(STORE, "readwrite");
              tx.objectStore(STORE).put({ ps: font.postScriptName, name: file.name, buffer: piece });
              tx.oncomplete = () => done(true);
              tx.onerror = () => done(false);
              tx.onabort = () => done(false);
            });
            if (kept) await keepInfo(infoOf(font, file.name));
            else notKept.push(file.name);
          }
        } catch (error) {
          failed.push(file.name);
        }
      }
    }
    if (added.length && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => false);
    changed();
    if (!db) notKept.push(...added.map((font) => font.name));
    return { added, failed, notKept };
  };

  const removeFile = async (ps) => {
    const font = fonts.get(ps);
    if (font && font.url) URL.revokeObjectURL(font.url);
    drop(ps);
    const db = await openStore().catch(() => null);
    if (db) await new Promise((done) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(ps);
      tx.oncomplete = done;
      tx.onerror = done;
    });
    await inInfo("readwrite", (store) => store.delete(ps)).catch(() => null);
    changed();
  };

  // What a kept font is called, apart from its file: starting the page reads this short list,
  // and a file only when a text or the font menu needs it.
  let infoDb = null;
  const openInfo = () => {
    if (!infoDb) {
      infoDb = new Promise((done, fail) => {
        const request = indexedDB.open("typer-web-font-info", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("info", { keyPath: "ps" });
        request.onsuccess = () => done(request.result);
        request.onerror = () => fail(request.error);
      });
    }
    return infoDb;
  };
  const inInfo = async (mode, act) => {
    const db = await openInfo();
    return new Promise((done, fail) => {
      const tx = db.transaction("info", mode);
      const request = act(tx.objectStore("info"));
      tx.oncomplete = () => done(request.result);
      tx.onerror = () => fail(tx.error);
      tx.onabort = () => fail(tx.error);
    });
  };
  const infoOf = (font, fileName) => ({ ps: font.postScriptName, file: fileName, name: font.name, family: font.family, style: font.style, size: font.size });
  const keepInfo = (info) => inInfo("readwrite", (store) => store.put(info)).catch(() => null);
  const listStored = (info) => {
    if (fonts.has(info.ps)) return;
    put(info.ps, { name: info.name, postScriptName: info.ps, family: info.family, style: info.style, source: "file", css: cssNameOf(info.ps), weight: 400, italic: false, ready: false, size: info.size, file: info.file });
  };

  // Font files loaded in an earlier session, and the installed fonts if already allowed
  const restore = async () => {
    const db = await openStore().catch(() => null);
    if (db) {
      const inFiles = (act) => new Promise((done, fail) => {
        const request = act(db.transaction(STORE).objectStore(STORE));
        request.onsuccess = () => done(request.result);
        request.onerror = () => fail(request.error);
      });
      const keys = await inFiles((store) => store.getAllKeys()).catch(() => []);
      const infos = await inInfo("readonly", (store) => store.getAll()).catch(() => null);
      const known = new Map((infos || []).map((info) => [info.ps, info]));
      for (const key of keys) {
        let info = known.get(key);
        // A file kept before this list existed is read once to get its names
        if (!info) {
          const row = await inFiles((store) => store.get(key)).catch(() => null);
          if (!row) continue;
          let names = {};
          try {
            names = readNames(row.buffer);
          } catch (error) {
            names = {};
          }
          const base = String(row.name || key).replace(/\.[^.]+$/, "");
          info = { ps: key, file: row.name, name: names.full || base, family: names.family || base, style: names.style || "Regular", size: row.buffer.byteLength };
          keepInfo(info);
        }
        listStored(info);
      }
    }
    if (canListInstalled() && navigator.permissions) {
      const status = await navigator.permissions.query({ name: "local-fonts" }).catch(() => null);
      if (status && status.state === "granted") await useInstalled().catch(() => 0);
    }
    changed();
  };

  window.TypeRFonts = {
    BUILTIN,
    get generation() { return generation; },
    openStore,
    get: (ps) => fonts.get(ps),
    list,
    resolve,
    withoutLigatures,
    ensure,
    ready,
    isMissing,
    builtinsLoaded,
    canListInstalled,
    useInstalled,
    installedListed: () => installedListed,
    addFiles,
    removeFile,
    loadedFiles: () => Array.from(fonts.values()).filter((font) => font.source === "file").sort((a, b) => a.name.localeCompare(b.name)),
    restore,
    // Draws the text again, for what changes its layout besides a font (hyphenation patterns)
    refresh: () => changed(),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // The file behind a name, for the panel's previews
    urlOf(name) {
      for (const font of fonts.values()) {
        if (font.postScriptName !== name && font.name !== name && `${font.family} ${font.style}` !== name) continue;
        if (font.url) return font.url;
        // Not read yet: this starts it, and onChange says when it's there
        if (font.source === "file") loadStored(font.postScriptName);
      }
      return null;
    },
  };
})();
