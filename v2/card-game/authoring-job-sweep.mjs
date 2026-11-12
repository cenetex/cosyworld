// Reattach: finds the jobs this draft asked for, watches the running ones and
// hands each finished one to the tool that asked, once. A tab that waited for
// its own job holds it (see authoring-jobs.mjs), so this never handles one twice.
import {
  awaitJob,
  browserEnv,
  finished,
  isLive,
  listJobs,
  readJob,
  readRequest,
} from "./authoring-jobs.mjs";

import { prepareJobIntent } from "./authoring-job-intent.mjs";

const BUSY = /Wait for the current (action|save)|editor changed/u;
const retriable = (error) =>
  BUSY.test(error.message) || error.code === "network" || error.status >= 500;

export function createJobSweep({
  store,
  adopters,
  run,
  env = browserEnv,
  fetch,
  retryMs = 1500,
  throttleMs = 1500,
  identity = async () => {
    const response = await (fetch || globalThis.fetch)("/auth/account", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Check your account before drawing.");
    const value = await response.json();
    return value;
  },
}) {
  let key = null,
    life = 0,
    active = false,
    again = false,
    last = -Infinity,
    retries = 0,
    timer;
  const watching = new Map(),
    intentIds = new Map();
  const owns = async (rec) => {
    if (!rec.owner) return true; // Older records predate account-bound intents.
    const account = await identity();
    return (
      account.authenticated &&
      account.user_id === rec.owner &&
      account.account_revision === rec.revision
    );
  };
  // Handed to the tools that start jobs, so a reload can find them again.
  const track = {
    prepare: (metadata) => {
      const binding = { draftKey: key, ...metadata };
      return async (kind, request) =>
        prepareJobIntent(store, await identity(), binding, kind, request);
    },
    begin: (record) => store.beginJob(record),
    refused: (record) => store.putJob({ ...record, phase: "prepared" }),
    accepted: async (record) => {
      const intentId = record.intentId;
      if (intentId) intentIds.set(record.id, intentId);
      try {
        await store.putJob({
          draftKey: key,
          ...record,
          ...(intentId ? { id: intentId, jobId: record.id } : {}),
        });
      } catch (error) {
        throw Object.assign(error, { code: "generation_waiting" });
      }
    },
    settled: (id) => store.deleteJob(intentIds.get(id) || id).catch(() => {}),
    dropped: (record) => track.accepted({ ...record, dropped: true }),
  };
  async function settle(rec, job, current) {
    const guardedRun = (callback) => {
      if (!current()) throw new Error("This editor changed.");
      return run(async (context) => {
        if (
          !(await owns(rec)) ||
          !current() ||
          context.snapshot().key !== rec.draftKey
        )
          throw new Error("This editor changed.");
        return callback(context);
      });
    };
    try {
      if ((await adopters[rec.kind].adoptJob(job, rec, guardedRun)) === "later")
        return "later";
    } catch (error) {
      if (retriable(error)) return "retry";
    }
    if (!current()) return "later";
    await store.deleteJob(rec.intentId || rec.id).catch(() => {});
    return "done";
  }
  function watch(rec, job) {
    if (watching.has(rec.id)) return;
    const adopter = adopters[rec.kind],
      controller = new AbortController(),
      opened = life;
    watching.set(rec.id, {
      controller,
      clear: () => adopter.progressJob?.(rec, null),
    });
    const forget = () => {
      if (watching.get(rec.id)?.controller === controller)
        watching.delete(rec.id);
    };
    adopter.progressJob?.(rec, job);
    awaitJob(
      { ...job, kind: rec.kind },
      {
        signal: controller.signal,
        env,
        fetch,
        identity: rec,
        onUpdate: (next) => opened === life && adopter.progressJob?.(rec, next),
      },
    ).then(
      () => {
        forget();
        if (opened === life) poke({ force: true });
      },
      () => {
        forget();
        if (opened === life) adopter.progressJob?.(rec, null);
      },
    );
  }
  async function pass() {
    const opened = life,
      draftKey = key,
      current = () => opened === life && draftKey === key;
    const records = (await store.readJobs(draftKey)).filter(
      (rec) => adopters[rec.kind] && !isLive(rec.id),
    );
    if (!current() || !records.length) return;
    let jobs;
    try {
      jobs = await listJobs({ fetch });
    } catch {
      return;
    }
    if (!current()) return;
    const byId = new Map(jobs.map((job) => [job.id, job]));
    let later = false;
    for (let rec of records) {
      if (!current()) return;
      if (!(await owns(rec)) || isLive(rec.id)) continue;
      if (rec.requestKey) {
        const intentId = rec.id;
        let recovered;
        try {
          recovered = await readRequest(rec.requestKey, {
            fetch,
            identity: rec,
          });
        } catch {
          continue;
        } // Even 404 may be delayed acceptance or pruning. Never POST.
        if (!current() || !(await owns(rec)) || isLive(intentId)) continue;
        rec = { ...rec, id: recovered.id, intentId };
        intentIds.set(rec.id, intentId);
        await track.accepted(rec);
        byId.set(recovered.id, recovered);
        if (isLive(intentId) || isLive(rec.id)) continue;
      }
      let job = byId.get(rec.id);
      if (!job) {
        try {
          job = await readJob(rec.id, { fetch });
        } catch (error) {
          if (!current()) return;
          if (error.status === 404)
            await store.deleteJob(rec.intentId || rec.id).catch(() => {});
          continue;
        }
      }
      if (!current()) return;
      const available = () =>
        current() && !isLive(rec.intentId || rec.id) && !isLive(rec.id);
      if (!available()) continue;
      if (!finished(job)) {
        watch(rec, job);
        continue;
      }
      if ((await settle(rec, job, available)) === "retry") later = true;
    }
    if (current() && later && retries++ < 40) {
      clearTimeout(timer);
      timer = setTimeout(() => poke({ force: true }), retryMs);
    }
  }
  function poke({ force = false } = {}) {
    if (key === null) return;
    const now = env.now();
    if (!force && now - last < throttleMs) return;
    if (active) {
      again = true;
      return;
    }
    active = true;
    last = now;
    void (async () => {
      try {
        do {
          again = false;
          await pass();
        } while (again);
      } catch {
        // A later poke tries again.
      } finally {
        active = false;
      }
    })();
  }
  return {
    track,
    poke,
    open(status) {
      life++;
      key = status.key;
      retries = 0;
      clearTimeout(timer);
      for (const { controller, clear } of watching.values()) {
        clear();
        controller.abort();
      }
      watching.clear();
      poke({ force: true });
    },
  };
}
