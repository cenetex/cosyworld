import { exportManifest, parseDraft } from "./authoring-draft.mjs";

const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const keyOk = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const content = ({ id: _id, revision: _revision, ...source }) => source;
const canonical = (value) =>
  JSON.stringify(value, (_key, next) =>
    next && typeof next === "object" && !Array.isArray(next)
      ? Object.fromEntries(
          Object.keys(next)
            .sort()
            .map((key) => [key, next[key]]),
        )
      : next,
  );

// A saved Create keeps its account, source and bytes until its receipt is durable.
export function authoringCreateStore(db, check = () => {}) {
  function transact(key, owner, mode, change, includeDraft = false) {
    need(keyOk(key) && key.length <= 100, "Choose a local draft key.");
    need(keyOk(owner), "Check your account before creating a pack.");
    check();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
          includeDraft ? ["drafts", "creates"] : ["creates"],
          mode,
        ),
        store = tx.objectStore("creates");
      let draft, result, problem;
      if (includeDraft) {
        const read = tx.objectStore("drafts").get(key);
        read.onsuccess = () => {
          draft = read.result;
        };
      }
      const read = store.get([key, owner]);
      read.onsuccess = () => {
        try {
          check();
          result = change(read.result ?? null, store, draft);
        } catch (error) {
          problem = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(problem || tx.error || new Error("Try saving Create again."));
    });
  }
  return {
    readCreate: (key, owner) =>
      transact(key, owner, "readonly", (value) => value),
    beginCreate(key, owner, expectedGeneration) {
      need(
        Number.isSafeInteger(expectedGeneration) && expectedGeneration > 0,
        "Save this world before creating its private pack.",
      );
      return transact(
        key,
        owner,
        "readwrite",
        (current, store, saved) => {
          if (current) {
            need(
              current.generation === expectedGeneration,
              "Open the saved Create to finish its transfer.",
            );
            return current;
          }
          need(
            saved?.generation === expectedGeneration,
            "This draft changed. Save and review its current version.",
          );
          const draft = parseDraft(exportManifest(saved.draft));
          need(
            saved.assets instanceof Map &&
              saved.assets.size === draft.assets.length &&
              draft.assets.every(
                ({ path, size }) =>
                  saved.assets.get(path) instanceof Uint8Array &&
                  saved.assets.get(path).byteLength === size,
              ),
            "Open the saved files before creating this pack.",
          );
          const value = {
            key: [key, owner],
            draftKey: key,
            owner,
            requestKey: crypto.randomUUID(),
            generation: expectedGeneration,
            draft,
            launch: saved.launch ?? null,
            assets: saved.assets,
            receipt: null,
          };
          store.add(value);
          return value;
        },
        true,
      );
    },
    finishCreate(key, owner, requestKey, value) {
      const receipt = parseDraft(exportManifest(value));
      need(
        receipt.id !== null && receipt.revision === 1,
        "Check the first receipt for this private pack.",
      );
      return transact(key, owner, "readwrite", (current, store) => {
        need(
          current?.requestKey === requestKey,
          "Open the saved Create for this account and world.",
        );
        need(
          canonical(content(current.draft)) === canonical(content(receipt)),
          "The receipt belongs to different world content. Retry the saved Create.",
        );
        if (current.receipt) {
          need(
            canonical(current.receipt) === canonical(receipt),
            "Keep the original receipt for this private pack.",
          );
          return current;
        }
        const saved = { ...current, receipt, assets: new Map() };
        store.put(saved);
        return saved;
      });
    },
  };
}
