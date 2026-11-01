#!/usr/bin/env node

// The production Rust gate reruns the checks CI already runs on the same
// commit. This reads CI's check runs for the commit and lets the gate reuse
// them: it waits while they run, and falls back to running the checks itself
// when CI did not run them, was cancelled, or failed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CI_RUST_CHECKS = ['Rust build and tests', 'Rust architecture and lint'];

// One of 'reuse', 'wait', or 'run', with the reason.
export function decide(checkRuns, { missingIsFinal = false } = {}) {
  const latest = new Map();
  for (const run of checkRuns) {
    if (!CI_RUST_CHECKS.includes(run.name)) continue;
    if (run.app?.slug && run.app.slug !== 'github-actions') continue;
    const seen = latest.get(run.name);
    if (!seen || (run.started_at ?? '') > (seen.started_at ?? '')) {
      latest.set(run.name, run);
    }
  }
  for (const name of CI_RUST_CHECKS) {
    const run = latest.get(name);
    if (!run) {
      return missingIsFinal
        ? { decision: 'run', reason: `CI has no "${name}" check for this commit` }
        : { decision: 'wait', reason: `waiting for CI to start "${name}"` };
    }
    if (run.status !== 'completed') {
      return { decision: 'wait', reason: `waiting for CI "${name}" (${run.status})` };
    }
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
      }
    }
  );
  if (!response.ok) {
    throw new Error(`check-runs request failed with ${response.status}`);
  }
  return (await response.json()).check_runs ?? [];
}

// The full suite runs only by hand, so a tag usually has no CI run, and
// waiting for its checks only delays the gate. Unreadable keeps the wait.
async function ciRunExists(repo, sha, token) {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=1`;
  const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` };
  const response = await fetch(url, { headers }).catch(() => null);
  if (!response?.ok) return true;
  return ((await response.json().catch(() => ({}))).total_count ?? 1) > 0;
}

async function main() {
  const repo = env('GITHUB_REPOSITORY');
  const sha = env('GITHUB_SHA');
  const token = env('GH_TOKEN');
  const waitSecs = Number(env('COSYWORLD_CI_WAIT_SECS', '1200'));
  const missingSecs = Number(env('COSYWORLD_CI_MISSING_SECS', '180'));
  const pollSecs = Number(env('COSYWORLD_CI_POLL_SECS', '20'));
  const started = Date.now();
  let result;
  for (;;) {
    const elapsed = (Date.now() - started) / 1000;
    try {
      result = decide(await checkRuns(repo, sha, token), {
        missingIsFinal: elapsed >= missingSecs || !(await ciRunExists(repo, sha, token))
      });
    } catch (error) {
      result = { decision: 'run', reason: `could not read CI checks: ${error.message}` };
    }
    if (result.decision !== 'wait') break;
    if (elapsed >= waitSecs) {
      result = { decision: 'run', reason: `CI did not finish in ${waitSecs}s` };
      break;
    }
    console.error(`[ci-rust] ${result.reason}`);
    await new Promise((resolve) => setTimeout(resolve, pollSecs * 1000));
  }
  console.error(`[ci-rust] ${result.decision}: ${result.reason}`);
  console.log(`reuse=${result.decision === 'reuse'}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();
