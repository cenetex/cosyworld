#!/usr/bin/env node

// The production Rust gate reruns the checks CI already runs on the same
// commit. This reads CI's check runs for the commit and lets the gate reuse
// them: it waits while they run, and falls back to running the checks itself
// when CI did not run them, was cancelled, or failed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CI_RUST_CHECKS = ['Rust build and tests', 'Rust architecture and lint'];
export const CI_WAIT_SECS = 7200;

// One of 'reuse', 'wait', or 'run', with the reason.
export function decide(checkRuns, { missingIsFinal = false } = {}) {
  const latest = new Map();
  for (const run of checkRuns) {
    if (!CI_RUST_CHECKS.includes(run.name)) continue;
    if (run.app?.slug && run.app.slug !== 'github-actions') continue;
    const seen = latest.get(run.name);
    // A queued rerun can have no start time yet. GitHub's increasing IDs
    // still place it after the completed attempt.
    const newer = seen && Number.isFinite(run.id) && Number.isFinite(seen.id)
      ? run.id > seen.id
      : (run.started_at ?? '') > (seen?.started_at ?? '');
    if (!seen || newer) {
      latest.set(run.name, run);
    }
  }
  // Observe every active check before choosing a fallback for a missing or
  // failed sibling. The fallback has its own job after CI finishes.
  for (const name of CI_RUST_CHECKS) {
    const run = latest.get(name);
    if (run && run.status !== 'completed') {
      return { decision: 'wait', reason: `waiting for CI "${name}" (${run.status})` };
    }
  }
  for (const name of CI_RUST_CHECKS) {
    if (!latest.has(name)) {
      return missingIsFinal
        ? { decision: 'run', reason: `CI has no "${name}" check for this commit` }
        : { decision: 'wait', reason: `waiting for CI to start "${name}"` };
    }
  }
  for (const name of CI_RUST_CHECKS) {
    const run = latest.get(name);
    if (run.conclusion !== 'success') {
      return {
        decision: 'run',
        reason: `CI "${name}" concluded ${run.conclusion}`
      };
    }
  }
  return { decision: 'reuse', reason: 'CI passed the Rust checks for this commit' };
}

const env = (name, fallback) => process.env[name] ?? fallback;

async function checkRuns(repo, sha, token) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`
      },
      signal: globalThis.AbortSignal.timeout(30_000)
    }
  );
  if (!response.ok) {
    throw new Error(`check-runs request failed with ${response.status}`);
  }
  return (await response.json()).check_runs ?? [];
}

export async function waitForChecks({
  readChecks,
  waitSecs = CI_WAIT_SECS,
  missingSecs = 180,
  pollSecs = 20,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (message) => console.error(message)
}) {
  for (const [name, value] of Object.entries({ waitSecs, missingSecs, pollSecs })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive number of seconds.`);
    }
  }
  const started = now();
  for (;;) {
    let result;
    try {
      result = decide(await readChecks(), {
        missingIsFinal: (now() - started) / 1000 >= missingSecs
      });
    } catch (error) {
      result = { decision: 'wait', reason: `CI status needs another read: ${error.message}` };
    }
    if (result.decision !== 'wait') return result;
    const elapsed = (now() - started) / 1000;
    if (elapsed >= waitSecs) {
      throw new Error(`CI wait reached ${waitSecs}s: ${result.reason}. Retry this release after CI finishes.`);
    }
    log(`[ci-rust] ${result.reason}`);
    await sleep(Math.min(pollSecs, waitSecs - elapsed) * 1000);
  }
}

async function main() {
  const repo = env('GITHUB_REPOSITORY');
  const sha = env('GITHUB_SHA');
  const token = env('GH_TOKEN');
  const result = await waitForChecks({
    readChecks: () => checkRuns(repo, sha, token),
    waitSecs: Number(env('COSYWORLD_CI_WAIT_SECS', String(CI_WAIT_SECS))),
    missingSecs: Number(env('COSYWORLD_CI_MISSING_SECS', '180')),
    pollSecs: Number(env('COSYWORLD_CI_POLL_SECS', '20'))
  });
  console.error(`[ci-rust] ${result.decision}: ${result.reason}`);
  console.log(`reuse=${result.decision === 'reuse'}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();
