#!/usr/bin/env node

// Bump the release version across every file that must stay aligned, in one
// step. The root package.json version is the source of truth for CI's version
// guard, and content_registry pins CARGO_PKG_VERSION to it at test time, so a
// PR must move all four files together or the Rust suite fails late.
//
// Usage:
//   npm run version:bump            # patch bump (1.0.84 -> 1.0.85)
//   npm run version:bump -- 1.1.0   # explicit version

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
}

function writeJson(relative, value) {
  // package-lock.json ships with two-space indentation and a trailing newline.
  writeFileSync(path.join(repoRoot, relative), `${JSON.stringify(value, null, 2)}\n`);
}

function currentVersion() {
  const pkg = readJson('package.json');
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    console.error(`[version:bump] package.json has no valid semver "version" field.`);
    process.exitCode = 1;
    return null;
  }
  return pkg.version;
}

function nextVersion(from, requested) {
  if (requested) {
    if (!/^\d+\.\d+\.\d+$/.test(requested)) {
      console.error(`[version:bump] "${requested}" is not semver (expected MAJOR.MINOR.PATCH).`);
      process.exitCode = 1;
      return null;
    }
    return requested;
  }
  const [major, minor, patch] = from.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function bumpPackageFiles(version) {
  for (const file of ['package.json', 'package-lock.json']) {
    const json = readJson(file);
    let touched = false;
    if (typeof json.version === 'string') {
      json.version = version;
      touched = true;
    }
    if (json.packages && json.packages[''] && typeof json.packages[''].version === 'string') {
      json.packages[''].version = version;
      touched = true;
    }
    if (!touched) {
      console.error(`[version:bump] No version fields found in ${file}.`);
      process.exitCode = 1;
      return false;
    }
    writeJson(file, json);
  }
  return true;
}

function bumpRustFiles(version) {
  const manifest = path.join(repoRoot, 'v2/orchestrator-rust/Cargo.toml');
  const source = readFileSync(manifest, 'utf8');
  const updated = source.replace(
    /^(\[package\][^[]*?^version = )"[^"]+"/ms,
    `$1"${version}"`
  );
  if (updated === source) {
    console.error('[version:bump] Could not find the [package] version in v2/orchestrator-rust/Cargo.toml.');
    process.exitCode = 1;
    return false;
  }
  writeFileSync(manifest, updated);

  // Keep Cargo.lock in lockstep without requiring a local toolchain build.
  const lock = path.join(repoRoot, 'v2/orchestrator-rust/Cargo.lock');
  const lockSource = readFileSync(lock, 'utf8');
  const lockUpdated = lockSource.replace(
    /(name = "cosyworld-orchestrator"\nversion = )"[^"]+"/,
    `$1"${version}"`
  );
  if (lockUpdated === lockSource) {
    console.error('[version:bump] Could not find cosyworld-orchestrator in v2/orchestrator-rust/Cargo.lock.');
    process.exitCode = 1;
    return false;
  }
  writeFileSync(lock, lockUpdated);
  return true;
}

const requested = process.argv[2] || process.env.npm_config_version || '';

const from = currentVersion();
if (!from) {
  process.exit(1);
}
const version = nextVersion(from, requested);
if (!version) {
  process.exit(1);
}
if (version === from) {
  console.error(`[version:bump] Requested version ${version} matches the current version.`);
  process.exit(1);
}

if (!bumpPackageFiles(version) || !bumpRustFiles(version)) {
  process.exit(process.exitCode || 1);
}

console.log(`[version:bump] ${from} -> ${version}`);
console.log('[version:bump] updated: package.json, package-lock.json,');
console.log('[version:bump]          v2/orchestrator-rust/Cargo.toml, v2/orchestrator-rust/Cargo.lock');
