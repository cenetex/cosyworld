// Drafts and imported bytes live together in their own browser database.
import {
  assetMetadata,
  exportManifest,
  parseDraft,
} from "./authoring-draft.mjs";

const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyOk = (key) =>
  typeof key === "string" && /^[A-Za-z0-9_-]{1,100}$/u.test(key);

function source(value) {
  const draft = parseDraft(exportManifest(value.draft));
  const launch = value.launch ?? null;
  need(
    launch === null ||
      (Object.keys(launch).length === 2 &&
        launch.schemaVersion === 1 &&
        typeof launch.place === "string" &&
        Object.hasOwn(draft.pack?.places || {}, launch.place)),
    "Choose a starting location in this draft.",
  );
  return { draft, launch: structuredClone(launch) };
}

async function checkedAssets(draft, assets) {
  if (assets === undefined) return;
  need(assets instanceof Map, "Choose the imported asset files.");
  need(assets.size === draft.assets.length, "Keep every declared asset file.");
  const result = new Map();
  for (const meta of draft.assets) {
    const bytes = assets.get(meta.path);
    need(
      bytes instanceof Uint8Array && bytes.byteLength === meta.size,
      `Choose the recorded bytes for ${meta.path}.`,
    );
    const copy = bytes.slice();
    const actual = await assetMetadata(meta.path, meta.mime, copy);
    need(actual.sha256 === meta.sha256, `Check the digest for ${meta.path}.`);
    result.set(meta.path, copy);
  }
  return result;
}

export async function openAuthoringStore() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("cosyworld.authoring", 1);
    let blocked = false;
    request.onupgradeneeded = () =>
      request.result.createObjectStore("drafts", { keyPath: "key" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      blocked ? request.result.close() : resolve(request.result);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Close another editor tab and try again."));
    };
  });
  db.onversionchange = () => db.close();
  function transact(key, mode, change) {
    need(keyOk(key), "Choose a local draft key.");
    return new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", mode),
        store = tx.objectStore("drafts"),
        request = store.get(key);
      let result, problem;
      request.onsuccess = () => {
        try {
          result = change(request.result ?? null, store);
        } catch (error) {
          problem = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          problem || tx.error || new Error("Try saving this draft again."),
        );
    });
  }
  return {
    close: () => db.close(),
    read: (key) => transact(key, "readonly", (record) => record),
    async write(key, value, expectedGeneration = 0, assets) {
      const next = source(value),
        files = await checkedAssets(next.draft, assets);
      need(
        Number.isSafeInteger(expectedGeneration) &&
          expectedGeneration >= 0 &&
          expectedGeneration < Number.MAX_SAFE_INTEGER,
        "Read the current draft before saving.",
      );
      return transact(key, "readwrite", (current, store) => {
        need(
          (current?.generation ?? 0) === expectedGeneration,
          "This draft changed in another tab. Open its current version.",
        );
        need(
          files !== undefined ||
            same(current?.draft.assets ?? [], next.draft.assets),
          "Choose the bytes for the draft's changed assets.",
        );
        const record = {
          key,
          generation: expectedGeneration + 1,
          ...next,
          assets: files ?? current?.assets ?? new Map(),
        };
        store.put(record);
        return record.generation;
      });
    },
  };
}
