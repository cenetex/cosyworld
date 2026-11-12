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

function intentChange(rows, record, begin, generation) {
  if (
    Number.isSafeInteger(record.generation) &&
    generation !== undefined &&
    generation !== record.generation
  )
    throw new Error(
      "This draft changed in another tab. Open its current version.",
    );
  const saved = rows.find((row) => row.id === record.id);
  if (begin) {
    if (!saved) throw new Error("This draw changed. Check the original card.");
    return {
      record: { ...saved, phase: "submitting" },
      mayPost: saved.phase === "prepared",
    };
  }
  if (
    !saved &&
    rows.filter((row) => row.owner === record.owner && row.requestKey).length >=
      200
  )
    throw new Error("Check your unfinished draws before starting another one.");
  return { record: saved || structuredClone(record) };
}

export function authoringJobStore(db, check = () => {}) {
  function transact(mode, change) {
    check();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("jobs", mode);
      let result;
      try {
        check();
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
  function intent(record, begin) {
    if (!valid(record))
      return Promise.reject(new Error("Check the job intent."));
    return new Promise((resolve, reject) => {
      const checkDraft = Number.isSafeInteger(record.generation);
      const tx = db.transaction(
          checkDraft ? ["jobs", "drafts"] : "jobs",
          "readwrite",
        ),
        store = tx.objectStore("jobs");
      let result, problem, generation;
      if (checkDraft) {
        const draft = tx.objectStore("drafts").get(record.draftKey);
        draft.onsuccess = () => {
          generation = draft.result?.generation ?? 0;
        };
      }
      const read = store.getAll();
      read.onsuccess = () => {
        try {
          result = intentChange(read.result || [], record, begin, generation);
          store.put(result.record);
        } catch (error) {
          problem = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          problem ||
            tx.error ||
            new Error("Save this draw before trying again."),
        );
    });
  }
  return {
    claimJob: (record) => intent(record, false).then((result) => result.record),
    beginJob: (record) => intent(record, true),
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
export function memoryJobStore({ generation = () => undefined } = {}) {
  const rows = new Map();
  return {
    async claimJob(record) {
      if (!valid(record)) throw new Error("Check the job intent.");
      const result = intentChange(
        [...rows.values()],
        record,
        false,
        generation(record.draftKey),
      );
      rows.set(record.id, structuredClone(result.record));
      return structuredClone(result.record);
    },
    async beginJob(record) {
      const result = intentChange(
        [...rows.values()],
        record,
        true,
        generation(record.draftKey),
      );
      rows.set(record.id, structuredClone(result.record));
      return structuredClone(result);
    },
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
