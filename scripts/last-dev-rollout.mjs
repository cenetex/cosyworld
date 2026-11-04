#!/usr/bin/env node

// Print the commit the primary Fly app last rolled out, from earlier Deploy
// runs, or nothing when none is found. A main push compares with this commit
// rather than the previous push: a superseded run cancels itself, and the
// commit after it may change only docs, so the previous push may never have
// reached .dev. Printing nothing makes the impact check deploy.

import { fileURLToPath } from "node:url";
import path from "node:path";

// A run rolled out the primary app when one of these steps succeeded, even if
// a later verification step failed: that commit is what the app now runs.
export const ROLLOUT_STEPS = [
  { job: "Deploy main to .dev", step: "Roll out .dev" },
  { job: "Deploy primary to Fly", step: "Deploy primary Fly app" },
];
export const RESTORE_JOB = "Return .dev to the main commit it ran";
export const RESTORE_STEP = "Roll .dev forward";

export function rolledOut(jobs) {
  return jobs.some((job) =>
    ROLLOUT_STEPS.some(
      (rollout) =>
        job.name === rollout.job &&
        (job.steps ?? []).some(
          (step) => step.name === rollout.step && step.conclusion === "success",
        ),
    ),
  );
}

// A restore step records its exact commit in its name. Its completion time
// orders it with train and tag rollouts, including reruns of older runs.
// A running train counts once its rollout job is done.
export async function lastRollout({ runs, jobsFor, currentRunId }) {
  const eligible = runs.filter(
    (run) =>
      String(run.id) !== String(currentRunId) &&
      /^[0-9a-f]{40}$/.test(run.head_sha ?? "") &&
      (run.status === "completed" ||
        String(run.display_title ?? "").startsWith(".dev train ")),
  );
  const history = await Promise.all(
    eligible.map(async (run) => {
      let jobs = (await jobsFor(run.id)) ?? [];
      if (run.status !== "completed") {
        jobs = jobs.filter(
          (job) =>
            job.name === ROLLOUT_STEPS[0].job && job.status === "completed",
        );
      }
      return { run, jobs };
    }),
  );
  const events = history.flatMap(({ run, jobs }, index) =>
    jobs.flatMap((job) =>
      (job.steps ?? []).flatMap((step, order) => {
        if (step.conclusion !== "success") return [];
        let sha;
        if (
          ROLLOUT_STEPS.some(
            (rollout) => job.name === rollout.job && step.name === rollout.step,
          )
        ) {
          sha = run.head_sha;
        } else if (job.name === RESTORE_JOB) {
          sha = step.name?.match(/^Roll \.dev forward to ([0-9a-f]{40})$/)?.[1];
          if (step.name === RESTORE_STEP) {
            // Older workflows restored the first earlier rollout's head SHA.
            // Preserve that recorded behavior while their runs remain in view.
            sha =
              history.slice(index + 1).find((entry) => rolledOut(entry.jobs))
                ?.run.head_sha ?? "";
          }
        }
        if (sha === undefined) return [];
        return [
          {
            sha,
            at: step.completed_at ?? "",
            index,
            order,
            restore: job.name === RESTORE_JOB,
          },
        ];
      }),
    ),
  );
  events.sort(
    (a, b) =>
      b.at.localeCompare(a.at) ||
      a.index - b.index ||
      Number(b.restore) - Number(a.restore) ||
      b.order - a.order,
  );
  return events[0]?.sha ?? "";
}

async function api(route) {
  const base = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await fetch(`${base}${route}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const repo = process.env.GH_REPO;
  if (!repo || !process.env.GH_TOKEN)
    throw new Error("GH_REPO and GH_TOKEN are required");
  const { workflow_runs: runs } = await api(
    `/repos/${repo}/actions/workflows/deploy.yml/runs?per_page=40&exclude_pull_requests=true`,
  );
  const sha = await lastRollout({
    runs,
    currentRunId: process.env.GITHUB_RUN_ID,
    jobsFor: async (id) =>
      (
        await api(
          `/repos/${repo}/actions/runs/${id}/jobs?per_page=100&filter=all`,
        )
      ).jobs,
  });
  if (sha) console.log(sha);
  else console.error("[last-dev-rollout] no earlier rollout found; deploying");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Without a known base the impact check deploys, which is the safe side.
    console.error(`[last-dev-rollout] ${error.message}; deploying`);
  });
}
