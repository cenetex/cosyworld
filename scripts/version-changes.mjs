#!/usr/bin/env node
// Release version changes that do not conflict.
//
// A pull request adds one file to .changes/ instead of editing the version
// files. The extension is the bump: .patch, .minor or .major. The file holds a
// one-line summary. After merge, the Version workflow folds every pending file
// into one bump commit on main.
//
//   npm run version:change -- "Keep card pairs steady"          # patch
//   npm run version:change -- minor "Add the Greek ship lanes"
//   node scripts/version-changes.mjs apply                      # CI only
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHANGES_DIR = '.changes';
export const LEVELS = ['patch', 'minor', 'major'];
const changePattern = /^[a-z0-9][a-z0-9.-]*\.(patch|minor|major)$/u;

export const isChangeFile = (name) => changePattern.test(path.basename(name));

export function pendingChanges(root = repoRoot) {
  let names = [];
  try {
    names = readdirSync(path.join(root, CHANGES_DIR));
  } catch {
    return [];
  }
  return names
    .filter(isChangeFile)
    .sort()
    .map((name) => ({
      name,
      level: changePattern.exec(name)[1],
      summary: readFileSync(path.join(root, CHANGES_DIR, name), 'utf8').trim(),
    }));
}

export function nextVersion(version, changes) {
  const [major, minor, patch] = version.split('.').map(Number);
  const level = Math.max(...changes.map((change) => LEVELS.indexOf(change.level)));
  if (level === 2) return `${major + 1}.0.0`;
  if (level === 1) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60) || 'change';

function add(args) {
  const level = LEVELS.includes(args[0]) ? args.shift() : 'patch';
  const summary = args.join(' ').trim();
  if (!summary) {
    console.error('Usage: npm run version:change -- [patch|minor|major] "One-line summary"');
    return 2;
  }
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const name = `${slug(branch.replace(/^[^/]+\//u, ''))}.${level}`;
  mkdirSync(path.join(repoRoot, CHANGES_DIR), { recursive: true });
  writeFileSync(path.join(repoRoot, CHANGES_DIR, name), `${summary}\n`);
  console.log(`[version:change] wrote ${CHANGES_DIR}/${name}`);
  return 0;
}

// Fold every pending change into one version bump. Prints the new version and
// writes the commit message to the path given, or prints nothing when no
// change is pending.
function apply([messagePath]) {
  const changes = pendingChanges();
  if (!changes.length) return 0;
  const current = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  const version = nextVersion(current, changes);
  execFileSync(process.execPath, ['scripts/bump-version.mjs', version], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (const change of changes) rmSync(path.join(repoRoot, CHANGES_DIR, change.name));
  if (messagePath) {
    writeFileSync(
      messagePath,
      `Release ${version}\n\n${changes.map((change) => `- ${change.summary}`).join('\n')}\n`,
    );
  }
  console.log(version);
  return 0;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const args = process.argv.slice(2);
  process.exitCode = args[0] === 'apply' ? apply(args.slice(1)) : add(args);
}
