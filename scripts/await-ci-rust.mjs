#!/usr/bin/env node

// The production Rust gate reruns the checks CI already runs on the same
// commit. This reads CI's check runs for the commit and lets the gate reuse
// them: it waits while they run, and falls back to running the checks itself
// when CI did not run them, was cancelled, or failed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CI_RUST_CHECKS = ['Rust build and tests', 'Rust architecture and lint'];
// The Deploy workflow's own gate jobs run the same commands. A .dev train
// runs them after its rollout, so a promotion of that train, or a tag that
// only bumps its version, reuses them.
export const GATE_CHECKS = {
  'Production Rust gate': CI_RUST_CHECKS[0],
  'Production Rust architecture and lint': CI_RUST_CHECKS[1]
};

// A release bump changes only these files, and in them only version lines.
export const VERSION_FILES = [
  'package.json',
  'package-lock.json',
  'v2/orchestrator-rust/Cargo.toml',
  'v2/orchestrator-rust/Cargo.lock',
  'v2/desktop/src-tauri/Cargo.toml',
  'v2/desktop/src-tauri/Cargo.lock'
];

// Whether a compare's files show a version bump and nothing else.
export function versionOnly(files) {
  return (
    files.length > 0 &&
    files.every(
      (file) =>
        VERSION_FILES.includes(file.filename) &&
        file.status === 'modified' &&
        typeof file.patch === 'string' &&
        file.patch
          .split('\n')
          .filter((line) => /^[+-]/.test(line))
          .every((line) => /^[+-]\s*"?version"?\s*[:=]/.test(line))
    )
  );
}

// One of 'reuse', 'wait', or 'run', with the reason. Checks from the
// current run (`selfRunId`) never count: they are this gate itself.
export function decide(checkRuns, { missingIsFinal = false, selfRunId = '' } = {}) {
  const latest = new Map();
  for (const run of checkRuns) {
    const name = GATE_CHECKS[run.name] ?? run.name;
    if (!CI_RUST_CHECKS.includes(name)) continue;
    if (run.app?.slug && run.app.slug !== 'github-actions') continue;
    if (selfRunId && String(run.details_url ?? '').includes(`/runs/${selfRunId}/`)) continue;
    const seen = latest.get(name);
    if (!seen || (run.started_at ?? '') > (seen.started_at ?? '')) {
      latest.set(name, run);
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
  return { decision: 'reuse', reason: 'Rust checks passed for this commit' };
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

// The first parent, when this commit only bumps the version over it (a
// release commit on top of the .dev commit). Its checks stand for this one.
async function versionParent(repo, sha, token) {
  const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` };
  const get = async (route) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${route}`, { headers });
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
    return response.json();
  };
  try {
    const parent = (await get(`/commits/${sha}`)).parents?.[0]?.sha;
    if (!parent) return '';
    return versionOnly((await get(`/compare/${parent}...${sha}`)).files ?? []) ? parent : '';
  } catch {
    return '';
  }
}

async function main() {
  const repo = env('GITHUB_REPOSITORY');
  const sha = env('GITHUB_SHA');
  const token = env('GH_TOKEN');
  const selfRunId = env('GITHUB_RUN_ID', '');
  const parent = await versionParent(repo, sha, token);
  const commits = parent ? [sha, parent] : [sha];
  if (parent) console.error(`[ci-rust] ${sha.slice(0, 7)} only bumps the version over ${parent.slice(0, 7)}; its checks count too`);
  const waitSecs = Number(env('COSYWORLD_CI_WAIT_SECS', '1200'));
  const missingSecs = Number(env('COSYWORLD_CI_MISSING_SECS', '180'));
  const pollSecs = Number(env('COSYWORLD_CI_POLL_SECS', '20'));
  const started = Date.now();
  let result;
  for (;;) {
    const elapsed = (Date.now() - started) / 1000;
    try {
      const runs = [];
      let ciExists = false;
      for (const commit of commits) {
        runs.push(...(await checkRuns(repo, commit, token)));
        ciExists ||= await ciRunExists(repo, commit, token);
      }
      result = decide(runs, { missingIsFinal: elapsed >= missingSecs || !ciExists, selfRunId });
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
