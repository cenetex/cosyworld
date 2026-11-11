// Browser-wide game data is not account-scoped. Preferences and auth stay put.
const META = "cosyworld.account-reset";
const PREFIX = "cosyworld.reset-data:";
const DB = "cosyworld.authoring";
const gameKeys = new Set([
  "cosyworld.playing", "cosyworld.invite", "cosyworld.menu", "cosyworld.local.upgrades",
  "cosyworld.world-tier", "cosyworld-card-signed-words", "cosyworld.title-intro",
  "cosyworld.title-logo", "cosyworld.music-revealed",
]);
export const isAccountGameKey = (key) => gameKeys.has(key) ||
  /^(cosyworld\.cards\.|cosyworld\.reflected-shore\.v1|cosyworld\.performance:)/u.test(key);
const metadata = (storage) => JSON.parse(storage.getItem(META) || "{}");
const databaseName = (epoch) => epoch ? `${DB}:${epoch}` : DB;
const physicalKey = (epoch, key) => epoch && isAccountGameKey(key)
  ? `${PREFIX}${epoch}:${key}` : key;
const stale = () => new Error("Account reset changed this browser. Reload to continue.");

export function createAccountStorage(storage, control = storage) {
  const initial = metadata(control);
  function assertCurrent() {
    const now = metadata(control);
    if (initial.pending || now.pending || now.fence !== initial.fence) throw stale();
  }
  return {
    assertCurrent,
    databaseName: databaseName(initial.epoch),
    keyFor: (key) => physicalKey(initial.epoch, key),
    getItem(key) {
      if (isAccountGameKey(key)) assertCurrent();
      return storage.getItem(physicalKey(initial.epoch, key));
    },
    setItem(key, value) {
      if (isAccountGameKey(key)) assertCurrent();
      storage.setItem(physicalKey(initial.epoch, key), value);
    },
    removeItem(key) {
      if (isAccountGameKey(key)) assertCurrent();
      storage.removeItem(physicalKey(initial.epoch, key));
    },
  };
}
let browserStore;
try {
  if (globalThis.localStorage) browserStore = createAccountStorage(globalThis.localStorage);
} catch { /* Storage-disabled play remains available. */ }
// Lazy access preserves play in browsers that deny storage entirely.
export function browserAccountStorage() {
  return browserStore ??= createAccountStorage(globalThis.localStorage);
}
export const accountStorage = {
  getItem: (key) => browserAccountStorage().getItem(key),
  setItem: (key, value) => browserAccountStorage().setItem(key, value),
  removeItem: (key) => browserAccountStorage().removeItem(key),
};
export const accountStorageKey = (key) => browserAccountStorage().keyFor(key);
export const pendingBrowserReset = (storage = globalThis.localStorage) =>
  metadata(storage).pending ?? null;
// Call reset mutations under the exclusive cosyworld.account-reset Web Lock.
export function beginBrowserReset(request, storage = globalThis.localStorage) {
  const meta = metadata(storage);
  if (meta.pending) {
    if (JSON.stringify(meta.pending) !== JSON.stringify(request)) throw stale();
    return;
  }
  storage.setItem(META, JSON.stringify({ ...meta, fence: request.id, pending: request }));
}
function pendingMeta(id, storage) {
  const meta = metadata(storage);
  if (meta.pending?.id !== id) throw stale();
  return meta;
}
export async function clearBrowserAccountData(id, storage = globalThis.localStorage,
  databases = globalThis.indexedDB) {
  const meta = pendingMeta(id, storage);
  storage.setItem(META, JSON.stringify({ ...meta, clearing: true }));
  const names = databases.databases
    ? (await databases.databases()).map(({ name }) => name)
      .filter((name) => name === DB || name?.startsWith(`${DB}:`))
    : [databaseName(meta.epoch)];
  for (const name of names) await new Promise((resolve, reject) => {
    const request = databases.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other CosyWorld tabs, then retry Reset account."));
  });
  pendingMeta(id, storage);
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys)
    if (isAccountGameKey(key) || key?.startsWith(PREFIX)) storage.removeItem(key);
  storage.setItem(META, JSON.stringify({ ...meta, cleared: true }));
}
export function finishBrowserReset(id, storage = globalThis.localStorage) {
  const meta = pendingMeta(id, storage);
  if (!meta.cleared) throw new Error("Finish clearing this browser before continuing.");
  storage.setItem(META, JSON.stringify({ epoch: id, fence: id }));
}
export function cancelBrowserReset(id, storage = globalThis.localStorage) {
  const meta = pendingMeta(id, storage);
  if (meta.clearing || meta.cleared) throw stale();
  storage.setItem(META, JSON.stringify({ epoch: meta.epoch, fence: id }));
}

let sessionStore;
try {
  if (globalThis.sessionStorage && globalThis.localStorage)
    sessionStore = createAccountStorage(globalThis.sessionStorage, globalThis.localStorage);
} catch { /* Session storage is optional. */ }
export const accountSessionStorage = {
  getItem: (key) => sessionStore?.getItem(key) ?? null,
  setItem: (key, value) => sessionStore?.setItem(key, value),
  removeItem: (key) => sessionStore?.removeItem(key),
};
export function clearBrowserSessionData(storage = globalThis.sessionStorage) {
  if (!storage) return;
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys)
    if (isAccountGameKey(key) || key === "cosyworld.page-fade" || key?.startsWith(PREFIX))
      storage.removeItem(key);
}
