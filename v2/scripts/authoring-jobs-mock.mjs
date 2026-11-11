import { createHash } from "node:crypto";

// A stand-in for the generation-jobs API (#2623) for browser smokes. A handler
// returns a result, or { refuse: { status, json } } to refuse the create, or
// { fail: { message, code } } to fail the job. Jobs finish on their first read
// unless held, so a smoke can reload the page while one is still running.
export async function mockJobs(page, handlers) {
  const jobs = new Map(),
    keys = new Map(),
    assets = new Map(),
    posts = [];
  let count = 0,
    holding = null;
  const view = ({ final: _final, hold: _hold, ...job }) => job;
  const api = {
    posts,
    // The next job of this kind stays running until release().
    hold(kind) {
      const gate = { kind };
      gate.seen = new Promise((resolve) => (gate.reached = resolve));
      gate.release = () => {
        gate.job.hold = false;
        Object.assign(gate.job, gate.job.final);
      };
      holding = gate;
      return gate;
    },
    store(bytes) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      assets.set(sha256, bytes);
      return { sha256, size: bytes.length, mime: "image/png" };
    },
  };
  await page.route("**/card-game/authoring/jobs", async (route) => {
    const request = route.request();
    if (request.method() === "GET")
      return route.fulfill({ json: { jobs: [...jobs.values()].reverse().map(view) } });
    const body = request.postDataJSON(),
      key = request.headers()["idempotency-key"];
    posts.push({ key, ...body });
    if (keys.has(key)) return route.fulfill({ json: view(jobs.get(keys.get(key))) });
    const out = await handlers[body.kind](body.request, api);
    if (out?.refuse)
      return route.fulfill({
        status: out.refuse.status,
        json: { ok: false, ...out.refuse.json },
      });
    const job = {
      id: `job-${++count}`,
      kind: body.kind,
      status: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      final: out?.fail
        ? {
            status: "failed",
            error: { retryAfterMs: 0, code: "generation_timeout", ...out.fail },
          }
        : { status: "done", result: out },
    };
    jobs.set(job.id, job);
    keys.set(key, job.id);
    if (holding?.kind === body.kind) {
      job.hold = true;
      holding.job = job;
      holding.reached();
      holding = null;
    }
    return route.fulfill({
      status: 202,
      json: { id: job.id, kind: job.kind, status: "queued", createdAt: job.createdAt },
    });
  });
  await page.route("**/card-game/authoring/jobs/*", (route) => {
    const job = jobs.get(route.request().url().split("/").pop());
    if (!job)
      return route.fulfill({
        status: 404,
        json: { ok: false, code: "job_not_found", error: "No such job." },
      });
    if (job.status === "queued") {
      if (job.hold) job.status = "running";
      else Object.assign(job, job.final);
    }
    return route.fulfill({ json: view(job) });
  });
  await page.route("**/card-game/authoring/assets/*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const bytes = assets.get(route.request().url().split("/").pop());
    return bytes
      ? route.fulfill({ body: bytes, contentType: "application/octet-stream" })
      : route.fulfill({ status: 404, json: { error: "missing" } });
  });
  return api;
}
