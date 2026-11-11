import { createHash } from "node:crypto";

// A fake generation-jobs server (#2623) plus a virtual clock for the client's
// polling, so tests run in order without real waits.
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (body, status = 200) => Response.json(body, { status });

export function fakeJobs({ auto, polls = 1 } = {}) {
  const jobs = new Map(),
    keys = new Map(),
    assets = new Map(),
    posts = [],
    waits = [];
  let count = 0,
    clock = 1_700_000_000_000,
    hidden = false,
    drop = 0,
    refuse = [],
    resume,
    offline = false;
  const server = {
    jobs,
    posts,
    waits,
    assets,
    // A refusal for the next create (no job is made).
    refuseNext: (status, body) => refuse.push({ status, body }),
    // The next create makes its job but the reply never arrives.
    dropNextReply: () => drop++,
    offline: (value) => {
      offline = value;
    },
    hide: () => {
      hidden = true;
    },
    show: () => {
      hidden = false;
      resume?.();
    },
    get clock() {
      return clock;
    },
    advance: (ms) => {
      clock += ms;
    },
    put(bytes) {
      const digest = sha(bytes);
      assets.set(digest, bytes);
      return { sha256: digest, size: bytes.length, mime: "image/png" };
    },
    complete(id, result) {
      Object.assign(jobs.get(id), {
        status: "done",
        result,
        updatedAt: clock,
      });
    },
    fail(id, error) {
      Object.assign(jobs.get(id), {
        status: "failed",
        error,
        updatedAt: clock,
      });
    },
    status(id, status) {
      jobs.get(id).status = status;
    },
    fetch: async (url, init = {}) => {
      if (offline) throw new TypeError("offline");
      const method = init.method || "GET";
      const path = String(url).replace("/card-game/authoring", "");
      if (method === "POST" && path === "/jobs") {
        const body = JSON.parse(init.body),
          key = init.headers["Idempotency-Key"];
        posts.push({ key, ...body });
        if (refuse.length) {
          const next = refuse.shift();
          return json({ ok: false, ...next.body }, next.status);
        }
        const text = JSON.stringify(body);
        if (keys.has(key)) {
          const old = jobs.get(keys.get(key));
          if (old.text !== text)
            return json(
              { ok: false, code: "idempotency_conflict", error: "no" },
              409,
            );
          return json(view(old), 200);
        }
        const job = {
          id: `job-${++count}`,
          kind: body.kind,
          status: "queued",
          createdAt: clock,
          updatedAt: clock,
          text,
          request: body.request,
          polled: 0,
        };
        jobs.set(job.id, job);
        keys.set(key, job.id);
        if (drop) {
          drop--;
          throw new TypeError("connection closed");
        }
        return json(
          { id: job.id, kind: job.kind, status: "queued", createdAt: clock },
          202,
        );
      }
      if (method === "GET" && path === "/jobs")
        return json({ jobs: [...jobs.values()].reverse().map(view) });
      const one = /^\/jobs\/([^/]+)$/u.exec(path);
      if (method === "GET" && one) {
        const job = jobs.get(one[1]);
        if (!job)
          return json({ ok: false, code: "job_not_found", error: "none" }, 404);
        if (auto && job.status !== "done" && job.status !== "failed") {
          job.polled++;
          if (job.polled === 1) job.status = "running";
          if (job.polled > polls) {
            const out = await auto(job.kind, job.request, server);
            if (out?.error) server.fail(job.id, out.error);
            else server.complete(job.id, out);
          }
        }
        return json(view(job));
      }
      const file = /^\/assets\/([a-f0-9]{64})$/u.exec(path);
      if (method === "GET" && file) {
        const bytes = assets.get(file[1]);
        return bytes ? new Response(bytes) : json({ error: "missing" }, 404);
      }
      return json({ error: "unknown" }, 404);
    },
    env: {
      now: () => clock,
      wait: async (ms, signal) => {
        signal?.throwIfAborted();
        waits.push(ms);
        // Time moves only when a test says so (server.advance).
        clock += 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        signal?.throwIfAborted();
      },
      hidden: () => hidden,
      visible: (signal) =>
        new Promise((resolve, reject) => {
          signal?.throwIfAborted();
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          resume = resolve;
        }),
    },
  };
  function view({ text: _text, request: _request, polled: _polled, ...job }) {
    return structuredClone(job);
  }
  return server;
}
