#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MARKER = '# cosyworld-version-hook';

function getRepoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function resolveHooksDir(repoRoot) {
  let hooksDir = path.join(repoRoot, '.git', 'hooks');
  try {
    const configured = execFileSync('git', ['config', '--local', 'core.hooksPath'], { encoding: 'utf8' })
      .toString()
      .trim();
    if (configured) {
      hooksDir = path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
    }
  } catch {
    // Ignore missing configuration.
  }
  return hooksDir;
}

function installHooks() {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    return;
  }

  const gitDir = path.join(repoRoot, '.git');
  if (!existsSync(gitDir)) {
    return;
  }

  const sourceDir = path.join(repoRoot, 'git-hooks');
  if (!existsSync(sourceDir)) {
    return;
  }

  const hooksDir = resolveHooksDir(repoRoot);
  mkdirSync(hooksDir, { recursive: true });

  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = path.join(sourceDir, entry);
    const targetPath = path.join(hooksDir, entry);

    if (existsSync(targetPath)) {
      try {
        const existing = readFileSync(targetPath, 'utf8');
        if (!existing.includes(MARKER)) {
          continue;
        }
      } catch {
        continue;
      }
    }

    try {
      copyFileSync(sourcePath, targetPath);
      chmodSync(targetPath, 0o755);
    } catch (_error) {
      console.warn(`[git-hooks] Failed to install ${entry}: ${_error.message}`);
    }
  }
}

installHooks();
