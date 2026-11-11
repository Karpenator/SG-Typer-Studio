// The files opened or saved lately, to get back to them without looking for them. Only the
// browsers that can hand out a lasting access to a file have this list.

(function () {
  "use strict";

  const MAX = 20;
  const available = typeof window.showOpenFilePicker === "function";

  let opening = null;
  const openDb = () => {
    if (!opening) {
      opening = new Promise((done, fail) => {
        const request = indexedDB.open("typer-web-recent", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "id", autoIncrement: true });
        request.onsuccess = () => done(request.result);
        request.onerror = () => fail(request.error);
      });
    }
    return opening;
  };
  const inStore = async (mode, act) => {
    const db = await openDb();
    return new Promise((done, fail) => {
      const tx = db.transaction("files", mode);
      const request = act(tx.objectStore("files"));
      tx.oncomplete = () => done(request && request.result);
      tx.onabort = () => fail(tx.error);
      tx.onerror = () => fail(tx.error);
    });
  };

  // The newest first
  const list = async () => {
    if (!available) return [];
    const rows = await inStore("readonly", (store) => store.getAll());
    return rows.sort((a, b) => b.at - a.at);
  };
  const remove = (id) => inStore("readwrite", (store) => store.delete(id));

  // A list of a recent file can never be worth a failed opening or saving
  const add = async (handles) => {
    if (!available) return;
    try {
      const fresh = handles.filter((handle) => handle && handle.kind === "file");
      if (!fresh.length) return;
      const rows = await list();
      for (const row of rows) {
        const same = await Promise.all(fresh.map((handle) => handle.isSameEntry(row.handle).catch(() => false)));
        if (same.some(Boolean)) await remove(row.id);
      }
      const now = Date.now();
      for (const [index, handle] of fresh.entries()) {
        await inStore("readwrite", (store) => store.put({ name: handle.name, handle, at: now - index }));
      }
      const kept = await list();
      for (const row of kept.slice(MAX)) await remove(row.id);
    } catch (error) {
      console.warn("SG Typer Studio: could not keep the list of recent files", error);
    }
  };

  window.TypeRRecent = { available, list, add, remove };
})();
