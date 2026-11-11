// Keeps the open documents in the browser, saved or not, so that they come back with the
// page: layers, masks, selection, history, tabs and zoom. Each document is one record;
// its pixels are stored apart, each canvas once, as the app never draws on a canvas again
// after filling it. So typing a word rewrites a small record, and no pixels at all.

(function () {
  "use strict";

  const PS = window.TypeRPhotoshop;
  const { app, ops } = PS;
  const ACTIVE = "typer.web.activeDocument";
  const WAIT = 400;
  // Bigger arrays (a whole page's selection) are stored apart, like the canvases
  const LARGE_ARRAY = 65536;
  const TAG = "__typerPixels";

  /* ------------------------------ the database ------------------------------ */

  let opening = null;
  const openDb = () => {
    if (!opening) {
      opening = new Promise((done, fail) => {
        const request = indexedDB.open("typer-web-documents", 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("documents", { keyPath: "uid" });
          request.result.createObjectStore("pixels", { keyPath: "key" });
        };
        request.onsuccess = () => done(request.result);
        request.onerror = () => fail(request.error);
      });
    }
    return opening;
  };

  const inStore = async (name, mode, act) => {
    const db = await openDb();
    return new Promise((done, fail) => {
      const tx = db.transaction(name, mode);
      const request = act(tx.objectStore(name));
      tx.oncomplete = () => done(request.result);
      tx.onabort = () => fail(tx.error || new Error("The browser refused to keep this document"));
      tx.onerror = () => fail(tx.error || new Error("The browser refused to keep this document"));
    });
  };
  const pixelsOf = (uid) => IDBKeyRange.bound([uid], [uid, []]);

  // Two tabs keep their own documents: the one that has a document holds its lock, and a
  // new page only takes the documents nobody holds. Reloading hands them over.
  const takeLock = (uid) => new Promise((resolve) => {
    if (!navigator.locks) {
      resolve(() => {});
      return;
    }
    navigator.locks.request(`typer-document-${uid}`, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return null;
      }
      return new Promise((release) => resolve(release));
    }).catch(() => resolve(null));
  });

  /* --------------------------------- saving --------------------------------- */

  const kept = new Map();
  const newKeep = (uid) => ({ uid, ids: new WeakMap(), next: 1, written: new Set(), content: null, view: "", release: null });
  const newUid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  // What makes a document differ from its record. Every change makes a new state.
  const contentOf = (doc) => [doc.state, doc.historyIndex, doc.history.length, doc.history[doc.historyIndex], doc.savedId, doc.name, doc.path, doc.stamp, doc.handle, app.docs.indexOf(doc)];
  const viewOf = (doc) => `${doc.view.zoom}:${doc.view.x}:${doc.view.y}`;
  const isKept = (doc) => {
    const keep = kept.get(doc);
    if (!keep || !keep.content) return false;
    const now = contentOf(doc);
    return keep.content.every((item, index) => item === now[index]);
  };

  // A copy of the document where canvases and large arrays are references. Objects shared
  // between states stay shared: the history costs its differences, not 150 copies.
  const packer = (keep, used) => {
    const seen = new Map();
    const pack = (value) => {
      if (typeof value === "function" || typeof value === "symbol") return undefined;
      if (value === null || typeof value !== "object") return value;
      if (seen.has(value)) return seen.get(value);
      let out = value;
      if (value instanceof HTMLCanvasElement || (ArrayBuffer.isView(value) && value.byteLength > LARGE_ARRAY)) {
        if (!keep.ids.has(value)) keep.ids.set(value, keep.next++);
        used.set(keep.ids.get(value), value);
        out = { [TAG]: keep.ids.get(value) };
      } else if (Array.isArray(value)) {
        out = [];
        seen.set(value, out);
        value.forEach((item, index) => { out[index] = pack(item); });
      } else if ([Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        out = {};
        seen.set(value, out);
        Object.keys(value).forEach((key) => {
          const item = pack(value[key]);
          if (item !== undefined) out[key] = item;
        });
      }
      seen.set(value, out);
      return out;
    };
    return pack;
  };

  const encoded = (source) => new Promise((done, fail) => {
    if (ArrayBuffer.isView(source)) {
      done({ ctor: source.constructor.name, blob: new Blob([source]) });
      return;
    }
    const row = { width: source.width, height: source.height, blob: null };
    if (!source.width || !source.height) {
      done(row);
      return;
    }
    source.toBlob((blob) => {
      if (blob) done(Object.assign(row, { blob }));
      else fail(new Error("A layer's pixels could not be stored"));
    }, "image/png");
  });

  const saveDoc = async (doc) => {
    let keep = kept.get(doc);
    if (!keep) {
      keep = newKeep(newUid());
      keep.release = await takeLock(keep.uid);
      kept.set(doc, keep);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => false);
    }
    const content = contentOf(doc);
    const view = viewOf(doc);
    const used = new Map();
    const record = packer(keep, used)({
      uid: keep.uid,
      at: app.docs.indexOf(doc),
      nextId: PS.newId(),
      name: doc.name,
      path: doc.path,
      stamp: doc.stamp,
      handle: doc.handle,
      width: doc.width,
      height: doc.height,
      resolution: doc.resolution,
      psd: doc.psd,
      idml: doc.idml,
      state: doc.state,
      history: doc.history,
      historyIndex: doc.historyIndex,
      savedId: doc.savedId,
      view: doc.view,
    });
    record.next = keep.next;
    // The pixels first: a record never points at something that isn't there
    for (const [number, source] of used) {
      if (keep.written.has(number)) continue;
      const row = await encoded(source);
      if (!app.docs.includes(doc)) return;
      await inStore("pixels", "readwrite", (store) => store.put(Object.assign(row, { key: [keep.uid, number] })));
      keep.written.add(number);
    }
    await inStore("documents", "readwrite", (store) => store.put(record));
    keep.content = content;
    keep.view = view;
    const gone = Array.from(keep.written).filter((number) => !used.has(number));
    if (gone.length) {
      await inStore("pixels", "readwrite", (store) => {
        let last = null;
        gone.forEach((number) => { last = store.delete([keep.uid, number]); });
        return last;
      });
      gone.forEach((number) => keep.written.delete(number));
    }
  };

  const forget = async (uid) => {
    await inStore("documents", "readwrite", (store) => store.delete(uid));
    await inStore("pixels", "readwrite", (store) => store.delete(pixelsOf(uid)));
  };

  const MAX_WAIT = 5000;
  let timer = 0;
  let waitingSince = 0;
  let lastEstimate = 0;
  let sweeping = false;
  let again = false;
  let failing = false;

  // Said once, while there's still room to do something about it
  let warnedLow = false;
  const warnWhenStorageIsLow = async () => {
    if (warnedLow || !navigator.storage || !navigator.storage.estimate || Date.now() - lastEstimate < 60000) return;
    lastEstimate = Date.now();
    const { usage, quota } = await navigator.storage.estimate().catch(() => ({}));
    if (usage && quota && usage / quota > 0.9) {
      warnedLow = true;
      PS.announce("storage-low");
    }
  };

  const sweep = async () => {
    if (sweeping) {
      again = true;
      return;
    }
    sweeping = true;
    waitingSince = 0;
    try {
      for (const [doc, keep] of Array.from(kept)) {
        if (app.docs.includes(doc)) continue;
        kept.delete(doc);
        await forget(keep.uid);
        if (keep.release) keep.release();
      }
      // The page on screen first, and a page that doesn't fit leaves its turn to the others
      let refused = null;
      for (const doc of [app.doc, ...app.docs.filter((other) => other !== app.doc)]) {
        if (!doc) continue;
        const keep = kept.get(doc);
        if (isKept(doc) && keep.view === viewOf(doc)) continue;
        try {
          await saveDoc(doc);
        } catch (error) {
          refused = refused || error;
        }
      }
      const active = app.doc && kept.get(app.doc);
      if (active) window.localStorage.setItem(ACTIVE, active.uid);
      if (refused) throw refused;
      failing = false;
      warnWhenStorageIsLow();
    } catch (error) {
      console.warn("SG Typer Studio: could not keep the open documents", error);
      if (!failing) PS.announce("documents-not-kept");
      failing = true;
    }
    sweeping = false;
    if (again) {
      again = false;
      schedule();
    }
  };

  // Each change starts the wait over, up to this: work without a pause still gets kept
  function schedule() {
    clearTimeout(timer);
    if (!waitingSince) waitingSince = Date.now();
    timer = setTimeout(sweep, Math.max(0, Math.min(WAIT, waitingSince + MAX_WAIT - Date.now())));
  }
  const flush = () => {
    clearTimeout(timer);
    sweep();
  };

  PS.on((type) => {
    if (type === "render" || type === "history" || type === "document" || type === "saved" || type === "selection" || type === "tabs") schedule();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  /* -------------------------------- restoring ------------------------------- */

  const decoded = async (row) => {
    if (row.ctor) return new window[row.ctor](await row.blob.arrayBuffer());
    const canvas = PS.newCanvas(row.width, row.height);
    if (row.blob) {
      const bitmap = await createImageBitmap(row.blob, { colorSpaceConversion: "none" });
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
    }
    return canvas;
  };

  const unpacked = async (record, keep) => {
    const rows = await inStore("pixels", "readonly", (store) => store.getAll(pixelsOf(record.uid)));
    const byNumber = new Map(rows.map((row) => [row.key[1], row]));
    const spots = [];
    const seen = new Set();
    const visit = (value) => {
      if (value === null || typeof value !== "object" || ArrayBuffer.isView(value) || seen.has(value)) return;
      seen.add(value);
      Object.keys(value).forEach((key) => {
        const item = value[key];
        if (item && item[TAG] !== undefined) spots.push({ parent: value, key, number: item[TAG] });
        else visit(item);
      });
    };
    visit(record);
    const numbers = Array.from(new Set(spots.map((spot) => spot.number)));
    const made = new Map();
    // A few at a time: decoding happens away from the page
    for (let at = 0; at < numbers.length; at += 4) {
      await Promise.all(numbers.slice(at, at + 4).map(async (number) => {
        const row = byNumber.get(number);
        if (!row) throw Object.assign(new Error("Some of its pixels are missing"), { missing: true });
        const made_ = await decoded(row);
        made.set(number, made_);
        keep.ids.set(made_, number);
        keep.written.add(number);
      }));
    }
    spots.forEach((spot) => { spot.parent[spot.key] = made.get(spot.number); });
    rows.forEach((row) => { if (!made.has(row.key[1])) keep.written.add(row.key[1]); });
    keep.next = record.next;
  };

  const fontsOf = (record) => {
    const names = new Set();
    record.history.concat({ state: record.state }).forEach((entry) => {
      entry.state.layers.forEach((layer) => {
        if (layer.kind !== "text") return;
        layer.params.layerText.textStyleRange.forEach((range) => names.add(range.textStyle.fontPostScriptName));
      });
    });
    return Array.from(names).filter(Boolean);
  };

  // What another tab still holds stays there. A reloading page has just let go of its
  // documents, which can take a moment.
  const claim = async (uid) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const release = await takeLock(uid);
      if (release) return release;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  };

  // Pixels whose document never got its record: the page left during the first save
  const cleanLeftovers = async () => {
    const records = await inStore("documents", "readonly", (store) => store.getAllKeys());
    const keys = await inStore("pixels", "readonly", (store) => store.getAllKeys());
    const owners = new Set(keys.map((key) => key[0]).filter((uid) => !records.includes(uid)));
    for (const uid of owners) {
      const release = await takeLock(uid);
      if (!release) continue;
      await inStore("pixels", "readwrite", (store) => store.delete(pixelsOf(uid)));
      release();
    }
  };

  // The active document first, so there's something to work on at once. The others join
  // their tabs as they come.
  const restoreAll = async ({ progress, failed, elsewhere }) => {
    let records = [];
    try {
      records = await inStore("documents", "readonly", (store) => store.getAll());
    } catch (error) {
      console.warn("SG Typer Studio: no kept documents", error);
      return;
    }
    records.sort((a, b) => a.at - b.at);
    const place = new Map(records.map((record) => [record.uid, record.at]));
    let active = null;
    try {
      active = window.localStorage.getItem(ACTIVE);
    } catch (error) {
      active = null;
    }
    const wanted = records.find((record) => record.uid === active) || records[0];
    const order = wanted ? [wanted].concat(records.filter((record) => record !== wanted)) : [];
    const rank = new Map();
    let first = null;
    let held = false;
    for (const record of order) {
      const release = await claim(record.uid);
      if (!release) {
        held = true;
        continue;
      }
      if (!first) {
        first = record;
        progress(record.name);
      }
      try {
        const keep = newKeep(record.uid);
        keep.release = release;
        await unpacked(record, keep);
        await window.TypeRFonts.ready(fontsOf(record));
        const doc = ops.restoreDoc(record, record === first);
        rank.set(doc, place.get(record.uid));
        kept.set(doc, keep);
        app.docs.sort((a, b) => (rank.has(a) ? rank.get(a) : Infinity) - (rank.has(b) ? rank.get(b) : Infinity));
        keep.content = contentOf(doc);
        keep.view = viewOf(doc);
      } catch (error) {
        console.error(error);
        failed(record.name, error);
        release();
        if (error.missing) await forget(record.uid);
      }
      if (record === first) progress(null);
    }
    if (first) schedule();
    if (held) elsewhere();
    await cleanLeftovers().catch((error) => console.warn("SG Typer Studio: could not clean the kept documents", error));
  };

  // The panel starts while they come back: a page it asks for meanwhile waits for them
  // (openFile in photoshop.js)
  let restoring = null;
  const restore = (callbacks) => {
    restoring = restoreAll(callbacks).finally(() => { restoring = null; });
    return restoring;
  };

  window.TypeRSession = { restore, restoring: () => restoring, flush, isKept };
})();
