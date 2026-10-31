// Starts one stopped Fly runner machine per queued GitHub job that asks for
// the Fly labels. GitHub sends `workflow_job` webhooks here; each machine gets
// a single-use just-in-time runner config, runs one job, and stops itself.
import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const LABELS = ["self-hosted", "fly", "cosyworld"];
const STARTING_TTL_MS = 5 * 60 * 1000;

export function verifySignature(secret, body, header) {
  if (!secret || typeof header !== "string") return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function wantsFlyRunner(job) {
  const labels = new Set(job?.labels ?? []);
  return LABELS.every((label) => labels.has(label));
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function appJwt(appId, privateKey, now = Date.now()) {
  const iat = Math.floor(now / 1000) - 60;
  const head = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64url(JSON.stringify({ iat, exp: iat + 540, iss: String(appId) }));
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey, "base64url");
  return `${head}.${body}.${signature}`;
}

export function createDispatcher(env, fetchImpl = fetch) {
  const repo = env.GITHUB_REPOSITORY ?? "cenetex/cosyworld";
  const flyApp = env.FLY_RUNNER_APP ?? "cosyworld-ci-runners";
  const waiting = new Set();
  let starting = [];
  let appToken = null;

  async function call(url, options = {}) {
    const response = await fetchImpl(url, options);
    const text = await response.text();
    if (!response.ok) throw new Error(`${options.method ?? "GET"} ${url} -> ${response.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }

  async function githubToken() {
    if (!env.GITHUB_APP_ID) return env.GITHUB_TOKEN;
    if (appToken && appToken.expires > Date.now() + 60_000) return appToken.token;
    const jwt = appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"));
    const result = await call(
      `https://api.github.com/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`,
      { method: "POST", headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json" } },
    );
    appToken = { token: result.token, expires: Date.parse(result.expires_at) };
    return appToken.token;
  }

  async function github(path, options = {}) {
    const headers = { authorization: `Bearer ${await githubToken()}`, accept: "application/vnd.github+json" };
    return call(`https://api.github.com${path}`, { ...options, headers });
  }

  function fly(path, options = {}, nonce) {
    const headers = { authorization: `Bearer ${env.FLY_API_TOKEN}`, "content-type": "application/json" };
    if (nonce) headers["fly-machine-lease-nonce"] = nonce;
    return call(`https://api.machines.dev/v1/apps/${flyApp}/machines${path}`, { ...options, headers });
  }

  // Fork pull requests can edit the workflow to ask for these labels, so the
  // run itself must come from this repository.
  async function trusted(job) {
    const run = await github(`/repos/${repo}/actions/runs/${job.run_id}`);
    return run.head_repository?.full_name === repo;
  }

  async function startOne() {
    const machines = await fly("");
    for (const machine of machines.filter((m) => m.state === "stopped")) {
      let lease;
      try {
        lease = await fly(`/${machine.id}/lease`, { method: "POST", body: JSON.stringify({ ttl: 60 }) });
      } catch {
        continue; // Another dispatch holds this machine.
      }
      const nonce = lease.data?.nonce ?? lease.nonce;
      try {
        const jit = await github(`/repos/${repo}/actions/runners/generate-jitconfig`, {
          method: "POST",
          body: JSON.stringify({
            name: `fly-${machine.id}-${Date.now()}`,
            runner_group_id: 1,
            labels: LABELS,
            work_folder: "_work",
          }),
        });
        const config = { ...machine.config, env: { ...machine.config.env, RUNNER_JITCONFIG: jit.encoded_jit_config } };
        await fly(`/${machine.id}`, { method: "POST", body: JSON.stringify({ config, skip_launch: true }) }, nonce);
        await fly(`/${machine.id}/start`, { method: "POST" }, nonce);
        return machine.id;
      } finally {
        await fly(`/${machine.id}/lease`, { method: "DELETE" }, nonce).catch(() => {});
      }
    }
    return null;
  }

  async function dispatch() {
    starting = starting.filter((at) => Date.now() - at < STARTING_TTL_MS);
    while (waiting.size > starting.length) {
      const id = await startOne();
      if (!id) {
        console.log(`${waiting.size - starting.length} job(s) waiting for a free runner machine`);
        return;
      }
      starting.push(Date.now());
      console.log(`started runner machine ${id}`);
    }
  }

  async function handle(event, payload) {
    const job = payload.workflow_job;
    if (event !== "workflow_job" || !wantsFlyRunner(job)) return "ignored";
    if (payload.action === "queued") {
      if (!(await trusted(job))) {
        console.log(`refused job ${job.id}: run ${job.run_id} is not from ${repo}`);
        return "refused";
      }
      waiting.add(job.id);
    } else if (payload.action === "in_progress") {
      if (waiting.delete(job.id)) starting.shift();
    } else if (payload.action === "completed") {
      waiting.delete(job.id);
    }
    await dispatch();
    return "ok";
  }

  return { handle, dispatch, state: () => ({ waiting: waiting.size, starting: starting.length }) };
}

function serve(env) {
  const dispatcher = createDispatcher(env);
  let queue = Promise.resolve();
  const serial = (task) => (queue = queue.then(task).catch((error) => console.error(error.message)));
  setInterval(() => serial(() => dispatcher.dispatch()), 30_000);

  createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.end(JSON.stringify(dispatcher.state()));
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (req.method !== "POST" || !verifySignature(env.GITHUB_WEBHOOK_SECRET, body, req.headers["x-hub-signature-256"])) {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(202).end();
      const event = req.headers["x-github-event"];
      serial(() => dispatcher.handle(event, JSON.parse(body.toString("utf8"))));
    });
  }).listen(Number(env.PORT ?? 8080));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) serve(process.env);
