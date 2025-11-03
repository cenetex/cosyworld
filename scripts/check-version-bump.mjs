#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function runGit(args, { allowFailure = false, trim = true } = {}) {
  try {
    const stdout = execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return trim ? stdout.trim() : stdout;
  } catch (error) {
    if (allowFailure) {
      return null;
    }
    throw error;
  }
}

function determineRepoRoot() {
  const root = runGit(['rev-parse', '--show-toplevel'], { allowFailure: true });
  return root || null;
}

function determineCurrentBranch() {
  if (process.env.GITHUB_HEAD_REF) {
    return process.env.GITHUB_HEAD_REF;
  }
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true });
  return branch && branch !== 'HEAD' ? branch : null;
}

function determineBaseBranch(remote) {
  if (process.env.VERSION_BASE_BRANCH) {
    return process.env.VERSION_BASE_BRANCH;
  }
  if (process.env.GITHUB_BASE_REF) {
    return process.env.GITHUB_BASE_REF;
  }
  const symbolic = runGit(['symbolic-ref', `refs/remotes/${remote}/HEAD`], { allowFailure: true });
  if (symbolic) {
    const match = symbolic.match(new RegExp(`^refs/remotes/${remote}/(.+)$`));
    if (match && match[1]) {
      return match[1];
    }
  }
  const mainExists = runGit(['show-ref', '--verify', '--quiet', `refs/heads/main`], { allowFailure: true }) !== null;
  if (mainExists) {
    return 'main';
  }
  const masterExists = runGit(['show-ref', '--verify', '--quiet', `refs/heads/master`], { allowFailure: true }) !== null;
  if (masterExists) {
    return 'master';
  }
  return 'main';
}

function ensureRemoteBranchAvailable(remote, branch) {
  const ref = `${remote}/${branch}`;
  const hasLocalTracking = runGit(['rev-parse', '--verify', ref], { allowFailure: true });
  if (hasLocalTracking) {
    return true;
  }
  const fetchArgs = ['fetch'];
  if (!process.env.VERSION_FETCH_FULL_HISTORY) {
    fetchArgs.push('--depth=1');
  }
  fetchArgs.push(remote, branch);
  const fetched = runGit(fetchArgs, { allowFailure: true });
  return fetched !== null;
}

function getVersionFromRef(ref, versionFile) {
  const file = runGit(['show', `${ref}:${versionFile}`], { allowFailure: true, trim: false });
  if (file === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(file);
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch (error) {
    console.error(`[version-check] Failed to parse ${versionFile} from ${ref}: ${error.message}`);
    return null;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function main() {
  const repoRoot = determineRepoRoot();
  if (!repoRoot) {
    console.warn('[version-check] Not in a git repository. Skipping version enforcement.');
    return 0;
  }

  const versionFile = process.env.VERSION_FILE || 'package.json';
  const versionPath = path.resolve(repoRoot, versionFile);

  let currentVersion;
  try {
    const contents = readFileSync(versionPath, 'utf8');
    const parsed = JSON.parse(contents);
    if (typeof parsed.version !== 'string') {
      console.error(`[version-check] Missing "version" in ${versionFile}.`);
      return 1;
    }
    currentVersion = parsed.version;
  } catch (error) {
    console.error(`[version-check] Unable to read ${versionFile}: ${error.message}`);
    return 1;
  }

  const remote = process.env.VERSION_REMOTE || 'origin';
  const baseBranch = determineBaseBranch(remote);
  const currentBranch = determineCurrentBranch();

  if (currentBranch && baseBranch && currentBranch === baseBranch) {
    return 0;
  }

  const candidateRefs = unique([
    process.env.VERSION_BASE_REF,
    baseBranch && `${remote}/${baseBranch}`,
    baseBranch && `refs/remotes/${remote}/${baseBranch}`,
    baseBranch
  ]);

  let baseVersion = null;
  let referenceUsed = null;
  let lastTriedRef = null;

  for (const ref of candidateRefs) {
    if (!ref) {
      continue;
    }
    lastTriedRef = ref;
    if (ref.startsWith(`${remote}/`)) {
      const branchName = ref.slice(remote.length + 1);
      ensureRemoteBranchAvailable(remote, branchName);
    }
    const version = getVersionFromRef(ref, versionFile);
    if (version) {
      baseVersion = version;
      referenceUsed = ref;
      break;
    }
  }
  if (!baseVersion) {
    const note = lastTriedRef ? ` (${lastTriedRef})` : '';
    console.warn(`[version-check] Unable to find ${versionFile} on the base reference${note}. Skipping.`);
    return 0;
  }

  if (currentVersion === baseVersion) {
    console.error(
      `[version-check] ${versionFile} version (${currentVersion}) matches ${referenceUsed}. Please bump the version before committing.`
    );
    return 1;
  }

  return 0;
}

process.exitCode = main();
