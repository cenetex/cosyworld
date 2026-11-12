// Client for server-managed generation jobs (#2623). A paid request is
// accepted once, runs on the server and is read back by id, so a reload or a
// dropped connection cannot lose it. Request bodies are the ones the server
// validates; this module only creates, polls, lists and fetches.
import { accountRevision } from "./account-revision.mjs";
const MAX_IMAGE = 8 * 1024 * 1024;
export const JOB_LIMIT = Object.freeze({
  image: 180_000,
  seed: 90_000,
  avatars: 90_000,
});
const MARGIN = 30_000,
  FIRST = 1000,
  SLOWEST = 5000;
const base = "/card-game/authoring";
const hex = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const digest = async (bytes) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
export const poolOf = (kind) => (kind === "image" ? "image" : "text");

function abortable(signal, work) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stop = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = work(resolve, reject, () =>
      signal?.removeEventListener("abort", stop),
    );
    signal?.addEventListener("abort", stop, { once: true });
  });
}
// Timers and tab visibility, replaceable in tests.
export const browserEnv = {
  now: () => Date.now(),
  wait: (ms, signal) =>
    abortable(signal, (resolve, _reject, off) => {
      const timer = setTimeout(() => {
        off();
        resolve();
      }, ms);
      return () => clearTimeout(timer);
    }),
  hidden: () => globalThis.document?.hidden === true,
  visible: (signal) =>
    abortable(signal, (resolve, _reject, off) => {
      const seen = () => {
        if (document.hidden) return;
        off();
        document.removeEventListener("visibilitychange", seen);
        resolve();
      };
      document.addEventListener("visibilitychange", seen);
      return () => document.removeEventListener("visibilitychange", seen);
    }),
};

export function humanWait(ms) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds <= 90) return `${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 90) return `${minutes} min`;
  return `${Math.ceil(minutes / 60)} h`;
}
const COOLING = /^(generation_busy|generation_rate|inference_daily_spend)/u;
export const refusal = (failure) =>
  failure?.status === 429 || COOLING.test(failure?.code || "");
// One error shape for a refused request and a failed job.
export function jobFailure(body, status) {
  const value =
    body?.error && typeof body.error === "object" ? body.error : body;
  const raw = typeof body?.error === "string" ? body.error : value?.message;
  const retryAfterMs =
    Number.isFinite(value?.retryAfterMs) && value.retryAfterMs > 0
      ? Math.min(value.retryAfterMs, 7 * 24 * 3600_000)
      : 0;
  const text =
    typeof raw === "string" && raw.trim()
      ? raw.trim().slice(0, 500)
      : "This did not finish. Try again.";
  const error = new Error(
    retryAfterMs && refusal({ status, code: value?.code })
      ? `${text.replace(/\s*$/u, "")} Try again in ${humanWait(retryAfterMs)}.`
      : text,
  );
  if (status) error.status = status;
  if (typeof value?.code === "string") error.code = value.code;
  if (retryAfterMs) error.retryAfterMs = retryAfterMs;
  return error;
}
const transient = (error) =>
  error.status === undefined || error.status >= 500 || error.status === 408;
const unreachable = () =>
  Object.assign(new Error("Could not reach the server. Try again."), {
    code: "network",
  });

// A repeated request keeps its key until the server answers definitively, so a
// dropped response is retried without a second paid job.
const keys = new Map();
// A job is held while this tab is waiting for it or applying its result, so a
// reattach pass never handles the same job twice.
const held = new Map();
export const isLive = (id) => held.has(id);
export function holdJob(id) {
  held.set(id, (held.get(id) || 0) + 1);
}
export function releaseJob(id) {
  const count = (held.get(id) || 0) - 1;
  if (count > 0) held.set(id, count);
  else held.delete(id);
}

const identityHeaders = (identity) =>
  identity
    ? {
        "X-Account-User": identity.owner,
        "X-Account-Revision": String(identity.revision),
      }
    : {};

async function send(fetcher, path, init, signal) {
  const response = await fetcher(path, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
    ...init,
    headers: { ...init.headers, ...accountRevision.headers() },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}
export async function createJob(kind, request, options = {}) {
  if (options.requestKey) return createDurableJob(kind, request, options);
  const {
    fetch: fetcher = globalThis.fetch,
    signal,
    env = browserEnv,
  } = options;
  const text = JSON.stringify({ kind, request });
  const bytes = new TextEncoder().encode(text);
  const fingerprint = await digest(bytes);
  if (!keys.has(fingerprint)) keys.set(fingerprint, crypto.randomUUID());
  const key = keys.get(fingerprint);
  let last = unreachable();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await env.wait(attempt === 1 ? 400 : 1200, signal);
    signal?.throwIfAborted();
    let sent;
    try {
      sent = await send(
        fetcher,
        `${base}/jobs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: text,
        },
        signal,
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      last = unreachable();
      continue;
    }
    const { response, body } = sent;
    if (response.status >= 500 || (!body && !response.ok)) {
      last = Object.assign(jobFailure(body, response.status), {
        status: response.status,
      });
      continue;
    }
    keys.delete(fingerprint);
    if (!response.ok) throw jobFailure(body, response.status);
    if (typeof body?.id !== "string" || !body.id)
      throw new Error("The server did not accept this request. Try again.");
    return body;
  }
  throw last;
}
async function createDurableJob(kind, request, options) {
  const { fetch: fetcher = globalThis.fetch, signal } = options;
  signal?.throwIfAborted();
  let sent;
  try {
    sent = await send(
      fetcher,
      `${base}/jobs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": options.requestKey,
          ...identityHeaders(options.identity),
        },
        body: JSON.stringify({ kind, request }),
      },
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw unreachable();
  }
  if (!sent.response.ok) throw jobFailure(sent.body, sent.response.status);
  if (typeof sent.body?.id !== "string" || !sent.body.id) throw unreachable();
  return sent.body;
}
export async function readRequest(requestKey, options = {}) {
  const { fetch: fetcher = globalThis.fetch, signal } = options;
  const sent = await send(
    fetcher,
    `${base}/jobs/by-request`,
    {
      method: "GET",
      headers: {
        "Idempotency-Key": requestKey,
        ...identityHeaders(options.identity),
      },
    },
    signal,
  );
  if (!sent.response.ok) throw jobFailure(sent.body, sent.response.status);
  if (typeof sent.body?.id !== "string" || !sent.body.id) throw unreachable();
  return sent.body;
}

export async function readJob(id, options = {}) {
  const { fetch: fetcher = globalThis.fetch, signal } = options;
  let sent;
  try {
    sent = await send(
      fetcher,
      `${base}/jobs/${encodeURIComponent(id)}`,
      { method: "GET", headers: identityHeaders(options.identity) },
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw unreachable();
  }
  if (!sent.response.ok) throw jobFailure(sent.body, sent.response.status);
  if (sent.body?.id !== id) throw unreachable();
  return sent.body;
}
export async function listJobs(options = {}) {
  const { fetch: fetcher = globalThis.fetch, signal } = options;
  let sent;
  try {
    sent = await send(fetcher, `${base}/jobs`, { method: "GET" }, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw unreachable();
  }
  if (!sent.response.ok) throw jobFailure(sent.body, sent.response.status);
  return Array.isArray(sent.body?.jobs) ? sent.body.jobs : [];
}
export const finished = (job) =>
  job.status === "done" || job.status === "failed";
// Poll with a rising delay, pause while the tab is hidden, keep the id through
// network blips, and give up only at the server's own deadline plus a margin.
export async function awaitJob(job, options = {}) {
  const { signal, onUpdate, env = browserEnv } = options;
  const limit = (JOB_LIMIT[job.kind] ?? JOB_LIMIT.image) + MARGIN;
  const created = Number.isFinite(job.createdAt) ? job.createdAt : env.now();
  const since = options.fresh ? env.now() : Math.min(created, env.now());
  let delay = FIRST,
    current = job;
  holdJob(job.id);
  try {
    while (true) {
      signal?.throwIfAborted();
      if (env.hidden()) {
        await env.visible(signal);
        delay = FIRST;
      }
      try {
        current = await readJob(job.id, options);
        onUpdate?.(current);
        if (finished(current)) return current;
      } catch (error) {
        if (signal?.aborted || !transient(error)) throw error;
      }
      if (env.now() - since > limit)
        throw Object.assign(
          new Error(
            "Still waiting for the server. Come back to this card in a moment.",
          ),
          { code: "generation_waiting" },
        );
      await env.wait(delay, signal);
      delay = Math.min(SLOWEST, Math.round(delay * 1.5));
    }
  } finally {
    releaseJob(job.id);
  }
}
// Create a job, report its id as soon as it is accepted, wait, and return the
// result or throw the server's message. `onJob` runs before the first poll so a
// reload can find the job again.
export async function runJob(kind, request, options = {}) {
  const intent = await options.prepareJob?.(kind, request);
  if (intent)
    options = {
      ...options,
      requestKey: intent.requestKey,
      identity: intent,
      basis: request.basis,
    };
  if (intent) holdJob(intent.id);
  try {
    options.signal?.throwIfAborted();
    options.beforePost?.();
    const attempt = intent ? await options.beginJob(intent) : { mayPost: true };
    let job;
    if (attempt.mayPost) {
      try {
        job = await createJob(kind, request, options);
      } catch (error) {
        if (
          intent &&
          [400, 401, 403, 413, 415, 422, 429].includes(error.status)
        )
          await options.refusedJob?.(attempt.record);
        throw error;
      }
    } else {
      try {
        job = await readRequest(intent.requestKey, options);
      } catch {
        throw Object.assign(
          new Error(
            "This draw may already have started. Check this card again; no new paid request was sent.",
          ),
          { code: "generation_waiting" },
        );
      }
    }
    if (intent) job.intent = attempt.record;
    await options.onJob?.(job);
    options.onUpdate?.(job);
    const done = finished(job)
      ? job
      : await awaitJob({ ...job, kind }, { ...options, fresh: true });
    if (done.status === "failed") throw failedJob(done);
    return done.result;
  } finally {
    if (intent) releaseJob(intent.id);
  }
}
export function failedJob(job) {
  return jobFailure(job.error ? { error: job.error } : job, undefined);
}
export async function fetchJobImage(image, options = {}) {
  const {
    fetch: fetcher = globalThis.fetch,
    signal,
    env = browserEnv,
  } = options;
  if (
    !hex(image?.sha256) ||
    !Number.isSafeInteger(image.size) ||
    image.size <= 0 ||
    image.size > MAX_IMAGE
  )
    throw new Error("Check the image response size.");
  let last = unreachable();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await env.wait(600 * attempt, signal);
    let response;
    try {
      response = await fetcher(`${base}/assets/${image.sha256}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      continue;
    }
    if (!response.ok) {
      last = jobFailure(
        await response.json().catch(() => null),
        response.status,
      );
      if (!transient(last)) throw last;
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== image.size || (await digest(bytes)) !== image.sha256)
      throw new Error("Check the image size and digest.");
    return bytes;
  }
  throw last;
}

// A refusal disables the button's pool until the server says it may be tried
// again. The label counts down in whole units, ticking only as often as needed.
export function createCooldown({
  changed = () => {},
  now = () => Date.now(),
} = {}) {
  const until = { text: 0, image: 0 },
    timers = {};
  const left = (pool) => Math.max(0, until[pool] - now());
  function tick(pool) {
    clearTimeout(timers[pool]);
    const rest = left(pool);
    if (!rest) return;
    timers[pool] = setTimeout(
      () => {
        changed();
        tick(pool);
      },
      rest <= 90_000 ? Math.min(rest, 1000) : 30_000,
    );
  }
  return {
    set(kind, failure) {
      if (!refusal(failure) || !failure.retryAfterMs) return;
      const pool = poolOf(kind);
      until[pool] = now() + failure.retryAfterMs;
      tick(pool);
    },
    label(kind) {
      const rest = left(poolOf(kind));
      return rest ? `Try again in ${humanWait(rest)}` : "";
    },
    clear() {
      for (const pool of Object.keys(timers)) clearTimeout(timers[pool]);
      until.text = until.image = 0;
    },
  };
}
