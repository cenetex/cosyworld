#!/usr/bin/env node

// Where Deploy runs spend their time, from GitHub's job and step timings.
//
//   node scripts/deploy-timings.mjs [--limit 30]   table of recent runs
//   node scripts/deploy-timings.mjs --run <id>     one-line summary of a run
//
// For each run kind (tag, promotion, dispatch, .dev train) it reports p50 and
// p90 wall time, the wait before the first job started, the critical path,
// and how often the Rust gate reused a CI run and the image was reused
// rather than built. Needs the `gh` CLI, authenticated, and GH_REPO or a
// checkout of the repository.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ms = (value) => (value ? Date.parse(value) : NaN);
const minutes = (value) =>
  Number.isFinite(value) ? `${(value / 60_000).toFixed(1)}m` : "-";

export function runKind(run) {
  const title = String(run.displayTitle ?? run.display_title ?? "");
  const branch = String(run.headBranch ?? run.head_branch ?? "");
  if (run.event === "schedule" || title.startsWith(".dev train "))
    return "train";
  // Before the scheduled train, every main push deployed .dev.
  if (run.event === "push") return /^v/.test(branch) ? "tag" : "train";
  if (branch.startsWith("promote/")) return "promotion";
  return "dispatch";
}

// Jobs that ran (not skipped), with start and end times.
const ran = (jobs) =>
  jobs.filter(
    (job) =>
      job.conclusion !== "skipped" &&
      Number.isFinite(ms(job.startedAt)) &&
      ms(job.completedAt) >= ms(job.startedAt),
  );

// The chain of jobs that set the run's length: from the job that finished
// last, step back to the job that finished latest before it started.
export function criticalPath(jobs) {
  const done = ran(jobs);
  const chain = [];
  let next = done.reduce(
    (last, job) =>
      !last || ms(job.completedAt) > ms(last.completedAt) ? job : last,
    null,
  );
  while (next) {
    chain.unshift(next);
    const start = ms(next.startedAt);
    next = done
      .filter((job) => ms(job.completedAt) <= start + 1000 && job !== next)
      .reduce(
        (last, job) =>
          !last || ms(job.completedAt) > ms(last.completedAt) ? job : last,
        null,
      );
  }
  return chain.map((job) => ({
    name: job.name,
    ms: ms(job.completedAt) - ms(job.startedAt),
  }));
}

const step = (jobs, jobName, stepName) =>
  jobs
    .find((job) => job.name === jobName)
    ?.steps?.find((s) => s.name === stepName);
const stepMs = (s) => (s ? ms(s.completedAt) - ms(s.startedAt) : NaN);

// An image step that took under two minutes found an existing image or
// copied one; a build takes seven or more.
export const IMAGE_REUSE_MS = 120_000;

export function summarize(run, jobs) {
  const done = ran(jobs);
  const created = ms(run.createdAt);
  const firstStart = Math.min(...done.map((job) => ms(job.startedAt)));
  const lastEnd = Math.max(...done.map((job) => ms(job.completedAt)));
  const rust = step(
    jobs,
    "Production Rust gate",
    "Verify Rust orchestrator tests",
  );
  const images = [
    step(jobs, "Prepare primary image", "Prepare primary image"),
    step(jobs, "Prepare Lonely Forest image", "Prepare Lonely Forest image"),
    step(jobs, "Deploy main to .dev", "Prepare primary image"),
  ].filter((s) => s && s.conclusion === "success");
  return {
    id: run.databaseId ?? run.id,
    kind: runKind(run),
    title: run.displayTitle ?? run.display_title,
    conclusion: run.conclusion,
    wallMs: lastEnd - created,
    queueMs: firstStart - created,
    critical: criticalPath(jobs),
    rustReused: rust ? rust.conclusion === "skipped" : null,
    rustMs: stepMs(rust),
    imageReused: images.length
      ? images.every((s) => stepMs(s) < IMAGE_REUSE_MS)
      : null,
    imageMs: images.length ? Math.max(...images.map(stepMs)) : NaN,
  };
}

export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
}

export function oneLine(summary) {
  const path = summary.critical
    .map((job) => `${job.name} ${minutes(job.ms)}`)
    .join(" → ");
  const rust =
    summary.rustReused === null
      ? ""
      : ` · Rust gate ${summary.rustReused ? "reused CI" : `ran ${minutes(summary.rustMs)}`}`;
  const image =
    summary.imageReused === null
      ? ""
      : ` · image ${summary.imageReused ? "reused" : "built"} ${minutes(summary.imageMs)}`;
  return `Deploy timing: ${minutes(summary.wallMs)} total, ${minutes(summary.queueMs)} queued${rust}${image} · critical path: ${path}`;
}

export function report(summaries) {
  const lines = [
    "| Kind | Runs | Wall p50 | Wall p90 | Queue p50 | Queue p90 | Rust gate reused CI | Image reused | Longest critical job (p50) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const kind of ["tag", "promotion", "dispatch", "train"]) {
    const runs = summaries.filter(
      (s) =>
        s.kind === kind && s.conclusion === "success" && s.critical.length > 1,
    );
    if (!runs.length) continue;
    const rust = runs.filter((s) => s.rustReused !== null);
    const image = runs.filter((s) => s.imageReused !== null);
    const longest = new Map();
    for (const s of runs) {
      const top = s.critical.reduce((a, b) => (b.ms > a.ms ? b : a));
      longest.set(top.name, [...(longest.get(top.name) ?? []), top.ms]);
    }
    const [name, values] = [...longest].sort(
      (a, b) => b[1].length - a[1].length,
    )[0];
    lines.push(
      `| ${kind} | ${runs.length} | ${minutes(
        percentile(
          runs.map((s) => s.wallMs),
          50,
        ),
      )} | ${minutes(
        percentile(
          runs.map((s) => s.wallMs),
          90,
        ),
      )} | ${minutes(
        percentile(
          runs.map((s) => s.queueMs),
          50,
        ),
      )} | ${minutes(
        percentile(
          runs.map((s) => s.queueMs),
          90,
        ),
      )} | ${rust.length ? `${rust.filter((s) => s.rustReused).length}/${rust.length}` : "-"} | ${image.length ? `${image.filter((s) => s.imageReused).length}/${image.length}` : "-"} | ${name} ${minutes(percentile(values, 50))} (${values.length}/${runs.length}) |`,
    );
  }
  return lines.join("\n");
}

const gh = (...args) => {
  const repo = process.env.GH_REPO ? ["--repo", process.env.GH_REPO] : [];
  return JSON.parse(
    execFileSync("gh", [...args, ...repo], {
      encoding: "utf8",
      maxBuffer: 64 << 20,
    }),
  );
};
const RUN_FIELDS =
  "databaseId,displayTitle,event,headBranch,createdAt,conclusion,status";
const view = (id) =>
  gh("run", "view", String(id), "--json", `${RUN_FIELDS},jobs`);

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args[args.indexOf(name) + 1];
  if (args.includes("--run")) {
    const run = view(flag("--run"));
    console.log(oneLine(summarize(run, run.jobs)));
    return;
  }
  const limit = Number(args.includes("--limit") ? flag("--limit") : 30);
  const runs = gh(
    "run",
    "list",
    "--workflow",
    "deploy.yml",
    "--limit",
    String(limit),
    "--json",
    RUN_FIELDS,
  );
  const summaries = [];
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const full = view(run.databaseId);
    const summary = summarize(full, full.jobs);
    if (Number.isFinite(summary.wallMs)) summaries.push(summary);
  }
  console.log(report(summaries));
  console.log();
  for (const s of summaries.filter(
    (s) => s.kind !== "train" || s.critical.length > 1,
  )) {
    console.log(
      `- ${s.id} ${s.kind} ${s.conclusion}: ${oneLine(s).replace("Deploy timing: ", "")}`,
    );
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();
