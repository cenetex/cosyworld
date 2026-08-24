#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const VERSION_FILES = new Set([
  'package.json',
  'package-lock.json',
  'v2/orchestrator-rust/Cargo.toml',
  'v2/orchestrator-rust/Cargo.lock'
]);

export function normalizeVersionFile(file, source) {
  if (file === 'package.json' || file === 'package-lock.json') {
    const value = JSON.parse(source);
    if (typeof value.version === 'string') value.version = '<release-version>';
    if (typeof value.packages?.['']?.version === 'string') {
      value.packages[''].version = '<release-version>';
    }
    return JSON.stringify(value);
  }

  if (file === 'v2/orchestrator-rust/Cargo.toml') {
    return source.replace(
      /^(\[package\][^[]*?^version = )"[^"]+"/ms,
      '$1"<release-version>"'
    );
  }

  if (file === 'v2/orchestrator-rust/Cargo.lock') {
    return source.replace(
      /(name = "cosyworld-orchestrator"\nversion = )"[^"]+"/,
      '$1"<release-version>"'
    );
  }

  return source;
}

export function isKnownNonProductionPath(file) {
  return (
    file.endsWith('.md') ||
    file.startsWith('artifacts/') ||
    file.startsWith('docs/') ||
    file.startsWith('examples/') ||
    file.startsWith('public/') ||
    file.startsWith('reference-library/crpg-mud/') ||
    file.startsWith('sites/') ||
    file.startsWith('test/') ||
    file.startsWith('v2/cli/') ||
    file.startsWith('v2/docs/') ||
    file.startsWith('v2/spine-rust/') ||
    file.startsWith('v2/tests/') ||
    file === '.github/AGENT.md' ||
    file === '.github/PULL_REQUEST_TEMPLATE.md' ||
    file === 'v2/mvp.sh' ||
    file === 'v2/play.sh'
  );
}

export function hasDeploymentImpact(files, readAt) {
  for (const file of files) {
    if (VERSION_FILES.has(file)) {
      const before = readAt('base', file);
      const after = readAt('head', file);
      if (
        before !== null &&
        after !== null &&
        normalizeVersionFile(file, before) === normalizeVersionFile(file, after)
      ) {
        continue;
      }
      return {
        deploy: true,
        reason: `${file} changed beyond its release version`
      };
    }

    if (!isKnownNonProductionPath(file)) {
      return { deploy: true, reason: `${file} can affect production` };
    }
  }

  return {
    deploy: false,
    reason: 'only docs, tests, tooling, or release versions changed'
  };
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function main() {
  const [base, head] = process.argv.slice(2);
  if (!base || !head || /^0+$/.test(base)) {
    console.log('deploy=true');
    console.log('reason=no comparable previous release');
    return;
  }

  if (
    git(['cat-file', '-e', `${base}^{commit}`], { allowFailure: true }) === null
  ) {
    console.log('deploy=true');
    console.log('reason=previous release is outside the checkout');
    return;
  }

  const files = git(['diff', '--name-only', base, head])
    .split('\n')
    .filter(Boolean);
  const readAt = (side, file) =>
    git(['show', `${side === 'base' ? base : head}:${file}`], {
      allowFailure: true
    });
  const result = hasDeploymentImpact(files, readAt);
  console.error(`[deployment-impact] ${result.reason}`);
  console.log(`deploy=${result.deploy}`);
  console.log(`reason=${result.reason}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
