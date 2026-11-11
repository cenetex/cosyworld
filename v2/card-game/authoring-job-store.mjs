// Which paid jobs belong to which local draft, kept until their result is
// applied, saved to the artwork library or shown as a failure. The server owns
// the result; this only remembers where it was meant to go.
const idOk = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const keyOk = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/u.test(value);
const valid = (record) =>
  idOk(record?.id) &&
  keyOk(record.draftKey) &&
  ["image", "seed", "avatars"].includes(record.kind);

export function authoringJobStore(db) {
  function transact(mode, change) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("jobs", mode);
      let result;
      try {
        result = change(tx.objectStore("jobs"));
      } catch (error) {
        tx.abort();
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result?.result);
      tx.onabort = () =>
        reject(tx.error || new Error("Try saving this job again."));
    });
  }
  return {
    putJob(record) {
      if (!valid(record))
        return Promise.reject(new Error("Check the job record."));
      return transact("readwrite", (store) =>
        store.put(structuredClone(record)),
      );
    },
    deleteJob: (id) => transact("readwrite", (store) => store.delete(id)),
    async readJobs(draftKey) {
      const rows = await transact("readonly", (store) => store.getAll());
      return rows.filter((row) => row.draftKey === draftKey);
    },
  };
}
export function memoryJobStore() {
  const rows = new Map();
  return {
    async putJob(record) {
      if (!valid(record)) throw new Error("Check the job record.");
      rows.set(record.id, structuredClone(record));
    },
    async deleteJob(id) {
      rows.delete(id);
    },
    async readJobs(draftKey) {
      return [...rows.values()]
        .filter((row) => row.draftKey === draftKey)
        .map((row) => structuredClone(row));
    },
  };
}
