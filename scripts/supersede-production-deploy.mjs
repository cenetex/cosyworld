#!/usr/bin/env node

// Production runs (v* tags and deploy.yml dispatches) no longer queue behind
// one another. A newer run supersedes an older one: it cancels the older run
// while that run is still in its safe stages (gates, image, guards, backup),
// and otherwise waits only for the older run's Fly rollout to finish. An
// older run that reaches its rollout after a newer run exists skips it.
// See docs/release.md#superseding-production-deploys.
//
//   start            outputs owns=true|false; cancels older runs it covers
//   claim <app>      before a rollout: outputs superseded=true|false, after
//                    waiting for older rollouts of <app> to finish
//   wait <app>       before a backup: waits for every other rollout of <app>
//
// <app> is primary or lonelyforest. Environment: GH_REPO, GH_TOKEN,
// GITHUB_RUN_ID, and optionally COSYWORLD_SUPERSEDE_POLL_SECS (20) and
// COSYWORLD_SUPERSEDE_WAIT_SECS (1800).

import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isProductionRun } from "./promote-train.mjs";

// The jobs that replace a running app. Cancelling one mid-step could leave
// the app half rolled out, so a run with any of them started is never
// cancelled; newer runs wait for them instead.
export const ROLLOUT_JOBS = {
  primary: ["Deploy primary to Fly", "Return .dev to the main commit it ran"],
  lonelyforest: ["Deploy Lonely Forest to Fly"],
};
const ROLLOUT_STEPS = {
  primary: "Deploy primary Fly app",
  lonelyforest: "Deploy Lonely Forest",
};

// The run-name is "Deploy <ref> to <target>"; a tag deploys both apps.
export function runTargets(run) {
  const target =
    String(run.display_title ?? "").match(
      / to (both|primary|lonelyforest)$/,
    )?.[1] ?? "both";
  return target === "both" ? ["primary", "lonelyforest"] : [target];
}

export const isPromotion = (run) =>
  run.event === "workflow_dispatch" &&
  String(run.head_branch ?? "").startsWith("promote/");

// Whether run `a` supersedes run `b`. The later run wins, so the owner's last
// tag or dispatch is what ships, except that a promotion never supersedes a
// run whose commit it does not contain: a scheduled promotion yields to a tag.
// `contains(x, y)` is true when x's commit is y's or a descendant of it.
export function supersedes(a, b, contains) {
  const later =
    a.created_at === b.created_at ? a.id > b.id : a.created_at > b.created_at;
  if (later) return !isPromotion(a) || contains(a, b);
  return isPromotion(b) && !contains(b, a);
}

const listed = (job) => job.conclusion !== "skipped";

// Any rollout job of <app> queued, running, or done: too late to cancel.
export function rolloutStarted(jobs, app) {
  return jobs.some(
    (job) => ROLLOUT_JOBS[app].includes(job.name) && listed(job),
  );
}

// A rollout of <app> that has not finished. A tag's primary rollout lasts
// until its .dev restore finishes, which starts just after it.
export function rolloutInFlight(run, jobs, app) {
  const mine = jobs.filter((job) => ROLLOUT_JOBS[app].includes(job.name));
  if (mine.some((job) => listed(job) && job.status !== "completed"))
    return true;
  if (app !== "primary" || run.status === "completed") return false;
  const restore = mine.find((job) => job.name === ROLLOUT_JOBS.primary[1]);
  return !restore && rolledOut(jobs, app) && /^v/.test(run.head_branch ?? "");
}

// The run's rollout step for <app> ran, so <app> may now serve its commit.
export function rolledOut(jobs, app) {
  return jobs.some(
    (job) =>
      job.name === ROLLOUT_JOBS[app][0] &&
      (job.steps ?? []).some(
        (step) =>
          step.name === ROLLOUT_STEPS[app] &&
          ["success", "failure"].includes(step.conclusion),
      ),
  );
}

const covers = (a, b) =>
  runTargets(b).every((app) => runTargets(a).includes(app));

// At the start of `self`: stop when an active run supersedes it for every
// app, and cancel the active runs it supersedes and covers that have not
// started a rollout.
export function planStart({ self, others, contains, jobsOf }) {
  const cancel = [];
  for (const run of others) {
    if (run.status === "completed") continue;
    if (supersedes(run, self, contains) && covers(run, self)) {
      return { owns: false, by: run, cancel: [] };
    }
    const jobs = jobsOf(run);
    if (
      supersedes(self, run, contains) &&
      covers(self, run) &&
      !runTargets(run).some((app) => rolloutStarted(jobs, app))
    ) {
      cancel.push(run);
    }
  }
  return { owns: true, cancel };
}

// Before `self` rolls out <app>: yield to a run that supersedes it and may
// still deploy <app>, or already did; otherwise wait for the in-flight
// rollouts of runs it supersedes (they yield to it once they look). With
// `waitAll`, used before a backup, wait for every other in-flight rollout.
export function planClaim({
  self,
  others,
  app,
  contains,
  jobsOf,
  waitAll = false,
}) {
  const relevant = others.filter((run) => runTargets(run).includes(app));
  if (!waitAll) {
    const winner = relevant.find(
      (run) =>
        supersedes(run, self, contains) &&
        (run.status !== "completed" || rolledOut(jobsOf(run), app)),
    );
    if (winner) return { decision: "yield", run: winner };
  }
  const busy = relevant.find(
    (run) =>
      run.status !== "completed" &&
      (waitAll || supersedes(self, run, contains)) &&
      rolloutInFlight(run, jobsOf(run), app),
  );
  return busy ? { decision: "wait", run: busy } : { decision: "go" };
}

async function api(route, init = {}) {
  const base = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await fetch(`${base}${route}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.status === 202 || response.status === 204
    ? null
    : response.json();
}

async function snapshot(repo, selfId) {
  const { workflow_runs: runs } = await api(
    `/repos/${repo}/actions/workflows/deploy.yml/runs?per_page=40&exclude_pull_requests=true`,
  );
  const self =
    runs.find((run) => String(run.id) === selfId) ??
    (await api(`/repos/${repo}/actions/runs/${selfId}`));
  // Runs that finished before this one started are already live or failed;
  // the promoter compares with the live /meta commit for those.
  const others = runs.filter(
    (run) =>
      String(run.id) !== selfId &&
      isProductionRun(run) &&
      (run.status !== "completed" || run.created_at > self.created_at),
  );
  const jobs = new Map();
  for (const run of others) {
    jobs.set(
      run.id,
      (await api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`))
        .jobs,
    );
  }
  const statuses = new Map([[`${self.head_sha}:${self.head_sha}`, true]]);
  for (const [a, b] of others.flatMap((run) => [
    [run, self],
    [self, run],
  ])) {
    const key = `${a.head_sha}:${b.head_sha}`;
    if (statuses.has(key)) continue;
    const { status } = await api(
      `/repos/${repo}/compare/${b.head_sha}...${a.head_sha}`,
    );
    statuses.set(key, status === "ahead" || status === "identical");
  }
  return {
    self,
    others,
    jobsOf: (run) => jobs.get(run.id) ?? [],
    contains: (a, b) => statuses.get(`${a.head_sha}:${b.head_sha}`) ?? false,
  };
}

const label = (run) => `run ${run.id} (${run.display_title})`;

async function main() {
  const [mode, app] = process.argv.slice(2);
  const repo = process.env.GH_REPO;
  const selfId = String(process.env.GITHUB_RUN_ID ?? "");
  if (!repo || !process.env.GH_TOKEN || !selfId)
    throw new Error("GH_REPO, GH_TOKEN, and GITHUB_RUN_ID are required");
  const log = (line) => console.error(`[supersede] ${line}`);
  // Step outputs go to $GITHUB_OUTPUT; stdout carries the annotations.
  const output = (line) => {
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
    log(line);
  };

  if (mode === "start") {
    let plan;
    try {
      plan = planStart(await snapshot(repo, selfId));
    } catch (error) {
      // Unreadable: deploy as before; the rollout claim checks again.
      log(`could not read other runs: ${error.message}; continuing`);
      plan = { owns: true, cancel: [] };
    }
    if (!plan.owns) {
      output("owns=false");
      console.log(
        `::warning::Superseded by ${label(plan.by)}; nothing will deploy.`,
      );
      return;
    }
    for (const run of plan.cancel) {
      log(`cancelling older ${label(run)}, still in its gates`);
      await api(`/repos/${repo}/actions/runs/${run.id}/cancel`, {
        method: "POST",
      }).catch((error) =>
        log(`could not cancel run ${run.id}: ${error.message}`),
      );
    }
    output("owns=true");
    return;
  }

  if (!["claim", "wait"].includes(mode) || !ROLLOUT_JOBS[app])
    throw new Error("Use start, claim <app>, or wait <app>");
  const pollSecs = Number(process.env.COSYWORLD_SUPERSEDE_POLL_SECS || 20);
  const waitSecs = Number(process.env.COSYWORLD_SUPERSEDE_WAIT_SECS || 1800);
  const deadline = Date.now() + waitSecs * 1000;
  let errors = 0;
  for (;;) {
    let plan;
    try {
      plan = planClaim({
        ...(await snapshot(repo, selfId)),
        app,
        waitAll: mode === "wait",
      });
      errors = 0;
    } catch (error) {
      // Keep trying a few times, then continue as before this guard.
      log(`could not read other runs: ${error.message}`);
      plan =
        ++errors >= 3
          ? { decision: "go" }
          : { decision: "wait", run: { id: "?", display_title: "unknown" } };
    }
    if (plan.decision === "yield") {
      output("superseded=true");
      console.log(
        `::notice::Skipping the ${app} rollout: ${label(plan.run)} supersedes this run.`,
      );
      return;
    }
    if (plan.decision === "go") {
      if (mode === "claim") output("superseded=false");
      return;
    }
    if (Date.now() >= deadline)
      throw new Error(
        `${label(plan.run)} still rolling out ${app} after ${waitSecs}s`,
      );
    log(`waiting for ${label(plan.run)} to finish rolling out ${app}`);
    await new Promise((resolve) => setTimeout(resolve, pollSecs * 1000));
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[supersede] ${error.message}`);
    process.exitCode = 1;
  });
}
