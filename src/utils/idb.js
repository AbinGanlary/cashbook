// Tiny IndexedDB helper shared by every module that keeps its own local store
// (Vendor Bills, Forms). Each module gets an isolated database —
// createIndexedDb() just factors out the boilerplate both previously
// duplicated (open/upgrade + generic getAll/put/delete).
export function createIndexedDb(dbName, stores, version = 1) {
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        stores.forEach(s => {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetAll(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(store, item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(item);
      tx.oncomplete = () => resolve(item);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbDelete(store, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { dbGetAll, dbPut, dbDelete };
}
