// Reads the style kits TypeR exports from Photoshop: a .json, or a .zip holding that
// .json next to a fonts/ folder. Their styles join TypeR's storage in this browser,
// following what TypeR itself does when it imports them (new ids, the folders kept).

(function () {
  "use strict";

  const FONT_FILE = /\.(ttf|otf|ttc|otc|woff2?)$/i;
  const MAX_ENTRY = 256 * 1024 * 1024;
  const MAX_TOTAL = 2 * 1024 * 1024 * 1024;
  const MAX_ENTRIES = 5000;
  const ROOT = "/typer";
  const SEED_EDITED = 1761800000000;

  /* ------------------------------- the archive ------------------------------ */

  const inflate = (bytes) => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();

  const zipEntries = (buffer) => {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let end = -1;
    for (let at = buffer.byteLength - 22; at >= Math.max(0, buffer.byteLength - 22 - 65535); at--) {
      if (view.getUint32(at, true) === 0x06054b50) {
        end = at;
        break;
      }
    }
    if (end < 0) throw new Error("not a zip file");
    const count = view.getUint16(end + 10, true);
    if (count > MAX_ENTRIES) throw new Error("too many files in the archive");
    const names = new TextDecoder();
    const entries = [];
    let total = 0;
    let at = view.getUint32(end + 16, true);
    for (let i = 0; i < count; i++) {
      if (view.getUint32(at, true) !== 0x02014b50) throw new Error("damaged zip file");
      const nameLength = view.getUint16(at + 28, true);
      const entry = {
        method: view.getUint16(at + 10, true),
        packed: view.getUint32(at + 20, true),
        size: view.getUint32(at + 24, true),
        local: view.getUint32(at + 42, true),
        name: names.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      };
      at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
      total += entry.size;
      if (entry.size > MAX_ENTRY || total > MAX_TOTAL) throw new Error("the archive is too large");
      if (!entry.name.endsWith("/")) entries.push(entry);
    }
    return {
      entries,
      read(entry) {
        const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
        const data = bytes.subarray(start, start + entry.packed);
        if (entry.method === 0) return Promise.resolve(data.slice().buffer);
        if (entry.method === 8) return inflate(data);
        return Promise.reject(new Error("unsupported compression"));
      },
    };
  };

  const deflate = (bytes) => new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer().then((buffer) => new Uint8Array(buffer));

  const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc32 = (bytes) => {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    return (crc ^ -1) >>> 0;
  };

  // The same archive TypeR writes in Photoshop: { name, data } entries, as a Blob
  const writeArchive = async (entries) => {
    const parts = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const day = (Math.max(now.getFullYear() - 1980, 0) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const entry of entries) {
      const name = new TextEncoder().encode(entry.name);
      const crc = crc32(entry.data);
      // A file that must stay as it is, as an .idml's mimetype
      let packed = entry.store ? entry.data : await deflate(entry.data);
      const method = !entry.store && packed.length < entry.data.length ? 8 : 0;
      if (!method) packed = entry.data;
      const fields = (view, at) => {
        view.setUint16(at, 20, true);
        view.setUint16(at + 2, 0x0800, true); // UTF-8 file names
        view.setUint16(at + 4, method, true);
        view.setUint16(at + 6, time, true);
        view.setUint16(at + 8, day, true);
        view.setUint32(at + 10, crc, true);
        view.setUint32(at + 14, packed.length, true);
        view.setUint32(at + 18, entry.data.length, true);
        view.setUint16(at + 22, name.length, true);
      };
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      fields(local, 4);
      const header = new DataView(new ArrayBuffer(46));
      header.setUint32(0, 0x02014b50, true);
      header.setUint16(4, 20, true);
      fields(header, 6);
      header.setUint32(42, offset, true);
      central.push(header, name);
      parts.push(local, name, packed);
      offset += 30 + name.length + packed.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, central.reduce((size, part) => size + part.byteLength, 0), true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end]);
  };

  const baseName = (name) => name.split(/[\\/]/).pop();

  // { json: [{ name, text }], fonts: [{ name, buffer }] }
  const readArchive = async (file) => {
    if (/\.json$/i.test(file.name)) return { json: [{ name: file.name, text: await file.text() }], fonts: [] };
    const zip = zipEntries(await file.arrayBuffer());
    const json = [];
    const fonts = [];
    for (const entry of zip.entries) {
      const name = baseName(entry.name);
      // Finder adds these when it makes a zip
      if (entry.name.indexOf("__MACOSX/") === 0 || name.indexOf("._") === 0) continue;
      if (/\.json$/i.test(name)) json.push({ name, text: new TextDecoder().decode(await zip.read(entry)) });
      else if (FONT_FILE.test(name)) fonts.push({ name, buffer: await zip.read(entry) });
    }
    return { json, fonts };
  };

  /* -------------------------------- the styles ------------------------------ */

  const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const check = (condition) => {
    if (!condition) throw new Error("invalid style file");
  };
  const checkTree = (value, depth) => {
    check(depth < 60);
    if (!value || typeof value !== "object") return;
    Object.keys(value).forEach((key) => {
      check(key !== "__proto__" && key !== "prototype" && key !== "constructor");
      checkTree(value[key], depth + 1);
    });
  };
  const validate = (data) => {
    check(isObject(data));
    checkTree(data, 0);
    ["folders", "styles", "exportedStyles"].forEach((field) => {
      if (data[field] !== undefined) check(Array.isArray(data[field]));
    });
    check(data.styles || data.exportedStyles);
    (data.styles || data.exportedStyles).forEach((style) => {
      check(isObject(style) && typeof style.name === "string");
      if (style.textProps !== undefined) check(isObject(style.textProps));
      if (style.prefixes !== undefined) check(Array.isArray(style.prefixes));
    });
    (data.folders || []).forEach((folder) => check(isObject(folder) && typeof folder.name === "string"));
    return data;
  };

  const STYLE_FIELDS = ["name", "textType", "textProps", "prefixes", "prefixColor", "prefixesDisabled", "stroke", "sizePresets", "autoSizeByPageWidth", "sizePresetDefaultIndex", "sizePresetMinWidths", "punctuationOnlyScale", "bubbleType"];
  const SETTING_FIELDS = ["ignoreLinePrefixes", "ignoreTags", "autoClosePSD", "currentFolderTagPriority", "pastePointText", "smartPaste", "pasteOnClick", "smartPasteAutoClean", "smartPasteDistribute", "smartPasteMinScale", "smartPasteHyphenation", "readingOrder", "refontRules"];

  const newId = () => Math.random().toString(36).substring(2, 8);

  const copyStyle = (style, folder, stamp) => {
    const out = { id: newId(), folder, edited: stamp, textType: "inherit", prefixes: [] };
    STYLE_FIELDS.forEach((field) => {
      if (style[field] !== undefined) out[field] = style[field];
    });
    giveTypeUnit(out);
    return out;
  };

  // The style window can't open a style that doesn't name its unit
  const giveTypeUnit = (style) => {
    if (!style.textProps || style.textProps.typeUnit) return false;
    style.textProps.typeUnit = "pixelsUnit";
    return true;
  };

  // Earlier versions started with a practice folder: it goes, unless it was edited
  const dropPracticeStyles = (storage) => {
    const kept = (storage.styles || []).filter((style) => !(String(style.id).indexOf("demo-") === 0 && style.edited === SEED_EDITED));
    if (kept.length === (storage.styles || []).length) return;
    storage.styles = kept;
    if (!kept.some((style) => style.folder === "demo-folder")) {
      storage.folders = (storage.folders || []).filter((folder) => folder.id !== "demo-folder");
      storage.openFolders = (storage.openFolders || []).filter((id) => id !== "demo-folder");
    }
  };

  const mergeInto = (storage, data, stats) => {
    storage.folders = storage.folders || [];
    storage.styles = storage.styles || [];
    storage.openFolders = storage.openFolders || [];
    const stamp = Date.now();
    const roots = storage.folders.filter((folder) => !folder.parentId).length;
    const added = [];
    if (data.exportedStyles) {
      const id = newId();
      storage.folders.push({ id, name: data.name || "TypeR", parentId: null, order: roots });
      storage.openFolders.push(id);
      data.exportedStyles.forEach((style) => added.push(copyStyle(style, id, stamp)));
      stats.folders += 1;
    } else {
      const ids = {};
      (data.folders || []).forEach((folder) => { ids[folder.id] = newId(); });
      (data.folders || []).forEach((folder) => {
        const parentId = folder.parentId && ids[folder.parentId] ? ids[folder.parentId] : null;
        const order = typeof folder.order === "number" ? folder.order : undefined;
        storage.folders.push({ id: ids[folder.id], name: folder.name, parentId, order: parentId ? order : roots + (order || 0) });
        storage.openFolders.push(ids[folder.id]);
      });
      const styleIds = {};
      data.styles.forEach((style) => {
        const copy = copyStyle(style, style.folder ? ids[style.folder] || null : null, stamp);
        styleIds[style.id] = copy.id;
        added.push(copy);
      });
      stats.folders += (data.folders || []).length;
      // A profile exported with its settings brings them along
      if (data.includesSettings === true) {
        SETTING_FIELDS.forEach((field) => {
          if (data[field] !== undefined) storage[field] = data[field];
        });
        if (styleIds[data.defaultStyleId]) storage.defaultStyleId = styleIds[data.defaultStyleId];
      }
    }
    storage.styles = storage.styles.concat(added);
    stats.styles += added.length;
    added.forEach((style) => {
      const ranges = style.textProps && style.textProps.layerText && style.textProps.layerText.textStyleRange;
      const ps = ranges && ranges[0] && ranges[0].textStyle && ranges[0].textStyle.fontPostScriptName;
      if (ps) stats.fonts.add(ps);
    });
    if (added.length && !storage.styles.some((style) => style.id === storage.currentStyleId)) storage.currentStyleId = added[0].id;
  };

  /* ------------------------- TypeR's files in the browser -------------------- */

  // TypeR's storage files: the default profile, the list of profiles, one file per
  // other profile. The database is what lasts (it survives a crash and has room);
  // localStorage is a second copy. Whichever is newer wins at start.
  const memory = new Map();
  const keeps = (path) => /^\/typer\/storage(_profiles|_profile_[^.]+)?$/.test(String(path));
  const keyFor = (path) => (path === `${ROOT}/storage` ? "typer.web.storage" : `typer.web.file:${path}`);
  const timeKey = (path) => `typer.web.time:${path}`;

  const loadFiles = async () => {
    try {
      Object.keys(window.localStorage).forEach((key) => {
        let path = null;
        if (key === "typer.web.storage") path = `${ROOT}/storage`;
        else if (key.indexOf("typer.web.file:") === 0) path = key.slice("typer.web.file:".length);
        if (path) memory.set(path, { text: window.localStorage.getItem(key), time: Number(window.localStorage.getItem(timeKey(path))) || 0 });
      });
    } catch (error) {
      console.warn("SG Typer Studio: localStorage is not available", error);
    }
    const db = await window.TypeRFonts.openStore().catch(() => null);
    if (!db) return;
    const rows = await new Promise((done) => {
      const request = db.transaction("files").objectStore("files").getAll();
      request.onsuccess = () => done(request.result || []);
      request.onerror = () => done([]);
    });
    rows.forEach((row) => {
      const known = memory.get(row.path);
      if (!known || row.time >= known.time) memory.set(row.path, { text: row.text, time: row.time });
    });
    cleanPracticeStyles();
    repairTypeUnits();
  };

  // Styles taken from a layer here before the host named the unit
  const repairTypeUnits = () => {
    memory.forEach((entry, path) => {
      if (!/^\/typer\/storage(_profile_.+)?$/.test(path)) return;
      try {
        const storage = JSON.parse(entry.text);
        if ((storage.styles || []).filter(giveTypeUnit).length) keep(path, JSON.stringify(storage));
      } catch (error) {
        console.warn("SG Typer Studio: could not repair a storage file", error);
      }
    });
  };

  const cleanPracticeStyles = () => {
    memory.forEach((entry, path) => {
      if (!/^\/typer\/storage(_profile_.+)?$/.test(path) || entry.text.indexOf('"demo-') < 0) return;
      try {
        const storage = JSON.parse(entry.text);
        dropPracticeStyles(storage);
        if (storage.currentStyleId && !storage.styles.some((style) => style.id === storage.currentStyleId)) storage.currentStyleId = storage.styles[0] ? storage.styles[0].id : null;
        keep(path, JSON.stringify(storage));
      } catch (error) {
        console.warn("SG Typer Studio: could not clean a storage file", error);
      }
    });
  };

  const read = (path) => (memory.has(path) ? memory.get(path).text : null);
  const storedPaths = () => Array.from(memory.keys());

  const keep = async (path, text) => {
    const time = Date.now();
    memory.set(path, { text, time });
    let copies = 0;
    try {
      window.localStorage.setItem(keyFor(path), text);
      window.localStorage.setItem(timeKey(path), String(time));
      copies++;
    } catch (error) {
      console.warn("SG Typer Studio: localStorage is full", error);
    }
    const db = await window.TypeRFonts.openStore().catch(() => null);
    if (db) {
      const saved = await new Promise((done) => {
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put({ path, text, time });
        tx.oncomplete = () => done(true);
        tx.onerror = () => done(false);
        tx.onabort = () => done(false);
      });
      if (saved) copies++;
    }
    if (!copies && window.TypeRPhotoshop) window.TypeRPhotoshop.warnStorage();
    return copies > 0;
  };

  const forget = async (path) => {
    memory.delete(path);
    try {
      window.localStorage.removeItem(keyFor(path));
      window.localStorage.removeItem(timeKey(path));
    } catch (error) {
      console.warn("SG Typer Studio: localStorage is not available", error);
    }
    const db = await window.TypeRFonts.openStore().catch(() => null);
    if (db) db.transaction("files", "readwrite").objectStore("files").delete(path);
  };

  // What TypeR starts from; a user who imports their styles first skips the tutorial
  const freshStorage = (firstTime) => ({ notFirstTime: !firstTime, whatsNewSeen: "3.0", checkUpdates: false, autoUpdate: false, textShapeRPerformanceTipShown: true });

  // A phone starts ready to work: a tap on a bubble pastes, and the text fits it, which takes
  // a style. Typing out a style's settings is no way to start on a phone.
  const freshTouchStorage = (name) => Object.assign(freshStorage(false), {
    pasteOnClick: true,
    currentStyleId: "starter",
    styles: [{
      id: "starter",
      name,
      folder: null,
      textType: "inherit",
      prefixes: [],
      edited: Date.now(),
      textProps: { typeUnit: "pixelsUnit", layerText: { antiAlias: "antiAliasSmooth", textStyleRange: [{ from: 0, to: 1, textStyle: { fontPostScriptName: "WildjessNormal", fontName: "Wildjess", fontStyleName: "Normal", size: 32, autoLeading: true, color: { red: 0, green: 0, blue: 0 } } }], paragraphStyleRange: [{ from: 0, to: 1, paragraphStyle: { alignment: "center" } }] } },
    }],
  });

  const activeStoragePath = () => {
    let active = "default";
    try {
      const registry = JSON.parse(read(`${ROOT}/storage_profiles`) || "{}");
      if (registry.activeProfileId && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(registry.activeProfileId)) active = registry.activeProfileId;
    } catch (error) {
      active = "default";
    }
    return active === "default" ? `${ROOT}/storage` : `${ROOT}/storage_profile_${active}`;
  };

  window.TypeRKit = { readArchive, writeArchive, zipEntries, validate, mergeInto, keeps, loadFiles, read, keep, forget, storedPaths, activeStoragePath, freshStorage, freshTouchStorage, ROOT };
})();
