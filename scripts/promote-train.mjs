#!/usr/bin/env node

// Promote the .dev train that has soaked on .dev to Lonely Forest
// (production). The primary app is .dev, so it already runs every train;
// promotion deploys only Lonely Forest, by dispatching deploy.yml with
// target=lonelyforest on a `promote/<sha>` branch at the train's commit.
// That run keeps every production gate (Node, Rust, lint, worldpack
// compatibility, volume space, backup), so a commit that fails one never
// reaches production. See docs/release.md#production-promotion.
//
// Environment: GH_REPO, GH_TOKEN, and optionally
//   COSYWORLD_PROMOTE_SOAK_MINUTES  minutes a train must be live (default 20)
//   COSYWORLD_PROMOTE_NOW           "true" skips the soak (manual promote)
//   COSYWORLD_PROMOTE_DRY_RUN       "true" reports without dispatching

import { fileURLToPath } from "node:url";
import path from "node:path";

export const TRAIN_JOB = "Deploy main to .dev";
export const TRAIN_ROLLOUT_STEP = "Roll out .dev";
export const PRODUCTION_URL = "https://lonelyforest.com/meta";

const SHA = /^[0-9a-f]{40}$/;

// A train rolled out when its rollout step succeeded; it passed when the
// whole job, including the readiness and card-game smokes, succeeded.
export function trainRollout(run, jobs) {
  const job = jobs.find((candidate) => candidate.name === TRAIN_JOB);
  const step = job?.steps?.find(
    (candidate) =>
      candidate.name === TRAIN_ROLLOUT_STEP &&
      candidate.conclusion === "success",
  );
  if (!job || !step || !SHA.test(run.head_sha ?? "")) return null;
  return {
    sha: run.head_sha,
    runId: run.id,
    rolledAt: Date.parse(
      step.completed_at ?? job.completed_at ?? run.updated_at,
    ),
    passed: job.conclusion === "success",
  };
}

export function isProductionRun(run) {
  if (run.event === "schedule") return false;
  if (String(run.display_title ?? "").startsWith(".dev train ")) return false;
  return (
    run.event === "workflow_dispatch" ||
    (run.event === "push" && /^v/.test(run.head_branch ?? ""))
  );
}

// Trains arrive newest first. The newest train must have passed: a failing
// train is a stop signal for everything behind it. The candidate is the
// newest passing train that stayed live on .dev for the soak, measured until
// the next train replaced it (or now, for the newest).
export function chooseTrain({ trains, now, soakMs }) {
  if (!trains.length) return { reason: "No .dev train has rolled out yet." };
  if (!trains[0].passed) {
    return {
      reason: `The newest train ${trains[0].sha.slice(0, 7)} failed its .dev checks; holding.`,
    };
  }
  for (const [index, train] of trains.entries()) {
    const liveUntil = index === 0 ? now : trains[index - 1].rolledAt;
    if (train.passed && liveUntil - train.rolledAt >= soakMs) return { train };
  }
  return { reason: "No passing train has soaked on .dev long enough yet." };
}

// Why `sha` must not be promoted now, or null. A queued or running production
// run comes first: a tag deploy may be about to ship something newer, and it
// supersedes a promotion anyway. A commit whose production run failed waits
// for a newer train.
export function promotionBlock({ runs, sha }) {
  const active = runs.find(
    (run) => run.status !== "completed" && isProductionRun(run),
  );
  if (active)
    return `A production deploy is active (run ${active.id}); trying again next time.`;
  const failed = runs.find(
    (run) =>
      isProductionRun(run) &&
      run.head_sha === sha &&
      run.conclusion === "failure",
  );
  if (failed)
    return `Train ${sha.slice(0, 7)} already failed a production run (${failed.id}); waiting for a newer train.`;
  return null;
}

// Promote only forward of the commit Lonely Forest's /meta reports. `status`
// is GitHub's compare status of live...sha; anything but "ahead" (the same,
// behind, or diverged) would replace production with an older or unrelated
// commit.
export function liveBlock({ live, sha, status }) {
  if (sha.startsWith(live))
    return `Lonely Forest already runs train ${sha.slice(0, 7)}.`;
  if (status !== "ahead")
    return `Train ${sha.slice(0, 7)} is not ahead of Lonely Forest's ${live.slice(0, 7)} (${status}); not promoting.`;
  return null;
}

async function api(route, init = {}) {
  const base = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await fetch(`${base}${route}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function main() {
  const repo = process.env.GH_REPO;
  if (!repo || !process.env.GH_TOKEN)
    throw new Error("GH_REPO and GH_TOKEN are required");
  const soakMinutes = Number(process.env.COSYWORLD_PROMOTE_SOAK_MINUTES || 20);
  if (!Number.isFinite(soakMinutes) || soakMinutes < 0)
    throw new Error("Bad soak minutes");
  const now = Date.now();
  const soakMs =
    process.env.COSYWORLD_PROMOTE_NOW === "true" ? 0 : soakMinutes * 60_000;
  const dryRun = process.env.COSYWORLD_PROMOTE_DRY_RUN === "true";
  const say = (line) => console.log(line);

  const { workflow_runs: runs } = await api(
    `/repos/${repo}/actions/workflows/deploy.yml/runs?per_page=60&exclude_pull_requests=true`,
  );

  // At most one production deploy at a time, and none while one is queued.
  const busy = promotionBlock({ runs, sha: "" });
  if (busy) {
    say(busy);
    return;
  }

  const trains = [];
  for (const run of runs) {
    if (run.status !== "completed" || isProductionRun(run)) continue;
    const rollout = trainRollout(
      run,
      (await api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`))
        .jobs,
    );
    if (rollout) trains.push(rollout);
  }
  const { train, reason } = chooseTrain({ trains, now, soakMs });
  if (!train) {
    say(reason);
    return;
  }
  const short = train.sha.slice(0, 7);

  const blocked = promotionBlock({ runs, sha: train.sha });
  if (blocked) {
    say(blocked);
    return;
  }

  // Promote only forward of what Lonely Forest runs, once per train.
  const meta = await (
    await fetch(PRODUCTION_URL, { signal: AbortSignal.timeout(15_000) })
  ).json();
  const live = String(meta.commit ?? "");
  if (!/^[0-9a-f]{7,40}$/.test(live))
    throw new Error(`Lonely Forest /meta has no commit: ${live}`);
  const status = train.sha.startsWith(live)
    ? "identical"
    : (await api(`/repos/${repo}/compare/${live}...${train.sha}`)).status;
  const stale = liveBlock({ live, sha: train.sha, status });
  if (stale) {
    say(stale);
    return;
  }
  // Recheck just before dispatching: a tag pushed while this ran takes
  // priority. A tag pushed after the dispatch supersedes the promotion run
  // (scripts/supersede-production-deploy.mjs).
  const { workflow_runs: latest } = await api(
    `/repos/${repo}/actions/workflows/deploy.yml/runs?per_page=20&exclude_pull_requests=true`,
  );
  const raced = promotionBlock({ runs: latest, sha: train.sha });
  if (raced) {
    say(raced);
    return;
  }

  const branch = `promote/${train.sha}`;
  say(
    `Promoting train ${short} (run ${train.runId}) to Lonely Forest, which runs ${live.slice(0, 7)}.`,
  );
  if (dryRun) return;

  // Clear earlier promotion branches; no production run is active.
  const refs = await api(`/repos/${repo}/git/matching-refs/heads/promote/`);
  for (const ref of refs) {
    if (ref.ref !== `refs/heads/${branch}`) {
      await api(`/repos/${repo}/git/${ref.ref}`, { method: "DELETE" }).catch(
        () => {},
      );
    }
  }
  if (!refs.some((ref) => ref.ref === `refs/heads/${branch}`)) {
    await api(`/repos/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: train.sha }),
    });
  }
  await api(`/repos/${repo}/actions/workflows/deploy.yml/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: branch, inputs: { target: "lonelyforest" } }),
  });
  say(`Dispatched deploy.yml on ${branch} with target=lonelyforest.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[promote-train] ${error.message}`);
    process.exitCode = 1;
  });
}
