#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function isKnownNonProductionPath(file) {
  return (
    file.endsWith('.md') ||
    file.startsWith('docs/') ||
    file.startsWith('sites/') ||
    file.startsWith('test/') ||
    file.startsWith('v2/docs/') ||
    file.startsWith('v2/tests/') ||
    file === 'v2/mvp.sh'
  );
}

// A version bump counts, so .dev builds the image a release tag promotes.
export function hasDeploymentImpact(files) {
  const file = files.find((name) => !isKnownNonProductionPath(name));
  return file
    ? { deploy: true, reason: `${file} can affect production` }
    : { deploy: false, reason: 'only docs, tests, or tooling changed' };
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

  const files = git(['diff', '--name-only', '--no-renames', base, head])
    .split('\n')
    .filter(Boolean);
  const result = hasDeploymentImpact(files);
  console.error(`[deployment-impact] ${result.reason}`);
  console.log(`deploy=${result.deploy}`);
  console.log(`reason=${result.reason}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
