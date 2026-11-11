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
} from "./authoring-jobs.mjs";

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
}) {
  let key = null,
    life = 0,
    active = false,
    again = false,
    last = -Infinity,
    retries = 0,
    timer;
  const watching = new Map();
  // Handed to the tools that start jobs, so a reload can find them again.
  const track = {
    accepted: (record) =>
      store.putJob({ ...record, draftKey: key }).catch(() => {}),
    settled: (id) => store.deleteJob(id).catch(() => {}),
    dropped: (record) =>
      store.putJob({ ...record, draftKey: key, dropped: true }).catch(() => {}),
  };
  async function settle(rec, job) {
    try {
      if ((await adopters[rec.kind].adoptJob(job, rec, run)) === "later")
        return "later";
    } catch (error) {
      if (retriable(error)) return "retry";
    }
    await store.deleteJob(rec.id).catch(() => {});
    return "done";
  }
  function watch(rec, job) {
    if (watching.has(rec.id)) return;
    const adopter = adopters[rec.kind],
      controller = new AbortController(),
      opened = life;
    watching.set(rec.id, controller);
    adopter.progressJob?.(rec, job);
    awaitJob(
      { ...job, kind: rec.kind },
      {
        signal: controller.signal,
        env,
        fetch,
        onUpdate: (next) => adopter.progressJob?.(rec, next),
      },
    ).then(
      () => {
        watching.delete(rec.id);
        if (opened === life) poke({ force: true });
      },
      () => {
        watching.delete(rec.id);
        adopter.progressJob?.(rec, null);
      },
    );
  }
  async function pass() {
    const opened = life;
    const records = (await store.readJobs(key)).filter(
      (rec) => adopters[rec.kind] && !isLive(rec.id),
    );
    if (!records.length) return;
    let jobs;
    try {
      jobs = await listJobs({ fetch });
    } catch {
      return;
    }
    const byId = new Map(jobs.map((job) => [job.id, job]));
    let later = false;
    for (const rec of records) {
      if (opened !== life) return;
      let job = byId.get(rec.id);
      if (!job) {
        try {
          job = await readJob(rec.id, { fetch });
        } catch (error) {
          if (error.status === 404)
            await store.deleteJob(rec.id).catch(() => {});
          continue;
        }
      }
      if (!finished(job)) {
        watch(rec, job);
        continue;
      }
      if ((await settle(rec, job)) === "retry") later = true;
    }
    if (later && retries++ < 40) {
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
      for (const controller of watching.values()) controller.abort();
      watching.clear();
      poke({ force: true });
    },
  };
}
