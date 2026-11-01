#!/usr/bin/env node

// Print the commit the primary Fly app last rolled out, from earlier Deploy
// runs, or nothing when none is found. A main push compares with this commit
// rather than the previous push: a superseded run cancels itself, and the
// commit after it may change only docs, so the previous push may never have
// reached .dev. Printing nothing makes the impact check deploy.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A run rolled out the primary app when one of these steps succeeded, even if
// a later verification step failed: that commit is what the app now runs.
export const ROLLOUT_STEPS = [
  { job: 'Deploy main to .dev', step: 'Roll out .dev' },
  { job: 'Deploy primary to Fly', step: 'Deploy primary Fly app' }
];

export function rolledOut(jobs) {
  return jobs.some((job) =>
    ROLLOUT_STEPS.some(
      (rollout) =>
        job.name === rollout.job &&
        (job.steps ?? []).some(
          (step) => step.name === rollout.step && step.conclusion === 'success'
        )
    )
  );
}

// Runs arrive newest first; the newest completed run with a successful
// rollout is what the app runs. A train keeps running its Rust checks after
// its rollout job finishes, so a running train counts once that job is done.
export async function lastRollout({ runs, jobsFor, currentRunId }) {
  for (const run of runs) {
    if (String(run.id) === String(currentRunId)) continue;
    if (!/^[0-9a-f]{40}$/.test(run.head_sha ?? '')) continue;
    if (run.status !== 'completed' && !String(run.display_title ?? '').startsWith('.dev train ')) continue;
    let jobs = (await jobsFor(run.id)) ?? [];
    if (run.status !== 'completed') {
      jobs = jobs.filter((job) => job.name === ROLLOUT_STEPS[0].job && job.status === 'completed');
    }
    if (rolledOut(jobs)) return run.head_sha;
  }
  return '';
}

async function api(route) {
  const base = process.env.GITHUB_API_URL || 'https://api.github.com';
  const response = await fetch(`${base}${route}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      'x-github-api-version': '2022-11-28'
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const repo = process.env.GH_REPO;
  if (!repo || !process.env.GH_TOKEN) throw new Error('GH_REPO and GH_TOKEN are required');
  const { workflow_runs: runs } = await api(
    `/repos/${repo}/actions/workflows/deploy.yml/runs?per_page=40&exclude_pull_requests=true`
  );
  const sha = await lastRollout({
    runs,
    currentRunId: process.env.GITHUB_RUN_ID,
    jobsFor: async (id) =>
      (await api(`/repos/${repo}/actions/runs/${id}/jobs?per_page=100`)).jobs
  });
  if (sha) console.log(sha);
  else console.error('[last-dev-rollout] no earlier rollout found; deploying');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Without a known base the impact check deploys, which is the safe side.
    console.error(`[last-dev-rollout] ${error.message}; deploying`);
  });
}
