// Minimal IndexedDB key-value store. A write resolves only when the transaction is durable ("complete"), never earlier.
const DB = 'erp-pos', STORE = 'kv';
let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (opened ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => { for (const name of [STORE, 'drafts', 'references']) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { opened = null; reject(r.error); };
  }));
}
export async function idbGet<T>(key: string, store = STORE): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => resolve(q.result as T | undefined); q.onerror = () => reject(q.error); });
}
export async function idbSet(key: string, value: unknown, store = STORE): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
}
export async function idbDel(key: string, store = STORE): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
}
