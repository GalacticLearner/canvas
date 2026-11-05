/** IndexedDB caches verified image data without coupling renderer code to local filesystem paths. */
let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("canvas-assets", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
/** Read by content hash; a cache miss safely falls back to TCP asset_get. */
export async function readAsset(hash: string): Promise<string | null> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const request = db.transaction("images").objectStore("images").get(hash);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}
/** Commit immutable data under its verified digest. */
export async function writeAsset(hash: string, data: string) {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("images", "readwrite");
      tx.objectStore("images").put(data, hash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* Disk cache failure never discards the in-memory board or queued operations. */
  }
}
