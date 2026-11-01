#!/usr/bin/env node
// Checks that every file carrying the release version agrees with
// package.json. Pull requests do not bump the version; a release does, once,
// with `npm run version:bump` (see docs/release.md).

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

function main() {
  const repoRoot = determineRepoRoot();
  if (!repoRoot) {
    console.warn('[version-check] Not in a git repository. Skipping version alignment.');
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

  // The Rust crate pins CARGO_PKG_VERSION to the root release at test time
  // (content_registry::tests::official_registry_exposes_pack_aware_indexes),
  // so a mismatch would only surface deep in the suite. Fail here instead,
  // with the exact files to fix.
  const manifestPath = path.resolve(repoRoot, 'v2/orchestrator-rust/Cargo.toml');
  try {
    const manifest = readFileSync(manifestPath, 'utf8');
    const match = manifest.match(/^version = "([^"]+)"$/m);
    if (!match) {
      console.error('[version-check] Could not read the [package] version from v2/orchestrator-rust/Cargo.toml.');
      return 1;
    }
    if (match[1] !== currentVersion) {
      console.error(
        `[version-check] v2/orchestrator-rust/Cargo.toml version (${match[1]}) does not match ${versionFile} (${currentVersion}).`
      );
      console.error('[version-check] Run `npm run version:bump` to move all four files together.');
      return 1;
    }
  } catch (error) {
    console.error(`[version-check] Unable to read v2/orchestrator-rust/Cargo.toml: ${error.message}`);
    return 1;
  }

  for (const [directory, name] of [
    ['v2/orchestrator-rust', 'cosyworld-orchestrator'],
    ['v2/desktop/src-tauri', 'cosyworld-desktop'],
  ]) {
    for (const file of ['Cargo.toml', 'Cargo.lock']) {
      const source = readFileSync(path.join(repoRoot, directory, file), 'utf8');
      const pattern = file === 'Cargo.toml'
        ? /^\[package\][^[]*?^version = "([^"]+)"/ms
        : new RegExp(`name = "${name}"\\nversion = "([^"]+)"`);
      if (source.match(pattern)?.[1] !== currentVersion) {
        console.error(`[version-check] Align ${directory}/${file} with ${currentVersion}. Run npm run version:bump.`);
        return 1;
      }
    }
  }
  for (const version of [
    JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')).version,
    JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')).packages[''].version,
  ]) {
    if (version !== currentVersion) {
      console.error('[version-check] Align package-lock.json with package.json. Run npm run version:bump.');
      return 1;
    }
  }
  const desktopConfig = JSON.parse(readFileSync(path.join(repoRoot, 'v2/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  if (desktopConfig.version !== '../../../package.json') {
    console.error('[version-check] Read the desktop app version from ../../../package.json.');
    return 1;
  }

  return 0;
}

process.exitCode = main();
