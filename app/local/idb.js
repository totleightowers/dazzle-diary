/** Minimal promise wrapper over IndexedDB. Enough for one app, nothing more. */
const DB_NAME = 'logbook';
const DB_VERSION = 3;   // 2 added sessions, 3 added progress history

let dbp = null;
export function open() {
  if (dbp) return dbp;
  dbp = new Promise((ok, bad) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        const s = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
        s.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        s.createIndex('project_id', 'project_id');
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        s.createIndex('project_id', 'project_id');
      }
      /* Every change to a project's progress, so "diamonds placed in March" can
         be answered. Only the current percentage was ever kept, which says
         where a canvas is but nothing about when the work happened. */
      if (!db.objectStoreNames.contains('progress')) {
        const s = db.createObjectStore('progress', { keyPath: 'id', autoIncrement: true });
        s.createIndex('project_id', 'project_id');
      }
      if (!db.objectStoreNames.contains('catalogue')) {
        const s = db.createObjectStore('catalogue', { keyPath: ['shop', 'handle'] });
        s.createIndex('shop', 'shop');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => bad(req.error);
  });
  return dbp;
}

const run = async (store, mode, fn) => {
  const db = await open();
  return new Promise((ok, bad) => {
    const tx = db.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    tx.oncomplete = () => ok(out && out.__req ? out.__req.result : out);
    tx.onerror = () => bad(tx.error);
    tx.onabort = () => bad(tx.error);
  });
};
const wrap = (req) => ({ __req: req });

export const get = (store, key) => run(store, 'readonly', (s) => wrap(s.get(key)));
export const all = (store) => run(store, 'readonly', (s) => wrap(s.getAll()));
export const put = (store, value, key) => run(store, 'readwrite', (s) => wrap(key === undefined ? s.put(value) : s.put(value, key)));
export const del = (store, key) => run(store, 'readwrite', (s) => wrap(s.delete(key)));
export const clear = (store) => run(store, 'readwrite', (s) => wrap(s.clear()));

export const byIndex = (store, index, value) =>
  run(store, 'readonly', (s) => wrap(s.index(index).getAll(value)));

/** Replace every row for one shop in a single transaction. */
export async function replaceShop(shopId, rows) {
  const db = await open();
  return new Promise((ok, bad) => {
    const tx = db.transaction('catalogue', 'readwrite');
    const s = tx.objectStore('catalogue');
    const cur = s.index('shop').openKeyCursor(IDBKeyRange.only(shopId));
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { s.delete(c.primaryKey); c.continue(); }
      else for (const r of rows) s.put(r);
    };
    tx.oncomplete = () => ok(rows.length);
    tx.onerror = () => bad(tx.error);
  });
}
