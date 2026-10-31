#!/usr/bin/env node
// Land a ready branch on top of main without hand-resolving generated files.
//
// Every prepared branch bumps the release version, and most change the
// embedded card asset manifest or claim the next shared rules version. Those
// lines always conflict once main moves. This applies only the branch's own
// work onto main, folds dependency changes in the version files, then
// regenerates the outputs and takes the next version once:
//
//   node scripts/land-branch.mjs claude/prep-dark-attic
//   npm run land -- claude/prep-dark-attic [--base origin/main] [--name claude/land-dark-attic]
//
// It stops on any conflict in the branch's real work. It never pushes.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The checkout being landed into: the current directory's repository.
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const rulesDir = 'v2/orchestrator-rust/src/card_shared';

// Files whose release version line every branch edits.
export const VERSION_FILES = [
  'package.json',
  'package-lock.json',
  'v2/orchestrator-rust/Cargo.toml',
  'v2/orchestrator-rust/Cargo.lock',
  'v2/desktop/src-tauri/Cargo.toml',
  'v2/desktop/src-tauri/Cargo.lock',
];

// Shared rules version wiring, as v2/scripts/next-shared-rules.mjs restores it.
export const RULES_WIRING = [
  `${rulesDir}/engine.rs`,
  `${rulesDir}/full_world.rs`,
  'test/card-released-rules.test.mjs',
  'v2/scripts/build-card-shared-engine.mjs',
];

// Always rebuilt from source after the branch's work is applied.
export const GENERATED = [
  'v2/orchestrator-rust/src/card_assets.rs',
  `${rulesDir}/narrator.js`,
  `${rulesDir}/content.json`,
];
export const isRulesBundle = (file) => /^v2\/orchestrator-rust\/src\/card_shared\/engine-v\d+\.js$/u.test(file);

// Same test as next-shared-rules.mjs: a version line, a bundle path or a
// pinned hash is wiring; anything else is real work.
export const isWiringLine = (line) =>
  /VERSION|SOURCE|engine-v\d+\.js|^\s*\d+: "[0-9a-f]{64}",$|^\/\/ Rules /u.test(line);

// Put `version` on the release version lines of one file.
export function setVersion(file, source, version) {
  switch (file) {
    case 'package.json':
      return source.replace(/^(\{\s*"name": "[^"]+",\s*"version": )"[^"]+"/u, `$1"${version}"`);
    case 'package-lock.json':
      return source
        .replace(/^(\{\s*"name": "[^"]+",\s*"version": )"[^"]+"/u, `$1"${version}"`)
        .replace(/("packages": \{\s*"": \{\s*"name": "[^"]+",\s*"version": )"[^"]+"/u, `$1"${version}"`);
    case 'v2/orchestrator-rust/Cargo.toml':
    case 'v2/desktop/src-tauri/Cargo.toml':
      return source.replace(/^(\[package\][^[]*?^version = )"[^"]+"/msu, `$1"${version}"`);
    case 'v2/orchestrator-rust/Cargo.lock':
      return source.replace(/(name = "cosyworld-orchestrator"\nversion = )"[^"]+"/u, `$1"${version}"`);
    case 'v2/desktop/src-tauri/Cargo.lock':
      return source.replace(/(name = "cosyworld-desktop"\nversion = )"[^"]+"/u, `$1"${version}"`);
    default:
      throw new Error(`${file} is not a release version file.`);
  }
}

// Changed lines in a unified diff that are not rules version wiring.
export function realWiringChanges(diff) {
  return diff
    .split('\n')
    .filter((line) => /^[+-](?![+-])/u.test(line))
    .map((line) => line.slice(1).trim())
    .filter((line) => line && !isWiringLine(line));
}

const git = (args, options = {}) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30, ...options });
const show = (ref, file) => {
  try {
    return git(['show', `${ref}:${file}`]);
  } catch {
    return null;
  }
};
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
};
const versionOf = (ref) => JSON.parse(show(ref, 'package.json')).version;

function parseArgs(argv) {
  const options = { base: 'origin/main', branch: null, name: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') options.base = argv[++i];
    else if (argv[i] === '--name') options.name = argv[++i];
    else if (!options.branch) options.branch = argv[i];
    else throw new Error(`Unexpected argument ${argv[i]}.`);
  }
  if (!options.branch) throw new Error('Usage: node scripts/land-branch.mjs <branch> [--base origin/main] [--name local-branch]');
  options.branch = options.branch.replace(/^origin\//u, '');
  const slug = options.branch.replace(/^[^/]+\//u, '').replace(/^(prep|land)-/u, '');
  options.name ||= `claude/land-${slug}`;
  return options;
}

function land({ base, branch, name }) {
  if (git(['status', '--porcelain', '--untracked-files=no']).trim()) {
    throw new Error('Commit or stash tracked changes first.');
  }
  // A remote base is fetched with the branch; a local base (a stack of
  // landings not yet pushed) is used as it is.
  const remotes = git(['remote']).split('\n').filter(Boolean);
  const [remote, ...rest] = base.split('/');
  const baseIsRemote = remotes.includes(remote) && rest.length > 0;
  const branchRemote = baseIsRemote ? remote : 'origin';
  git(['fetch', '--quiet', branchRemote, ...(baseIsRemote ? [rest.join('/')] : []), branch]);
  const tip = `${branchRemote}/${branch}`;
  const mergeBase = git(['merge-base', base, tip]).trim();
  const changed = git(['diff', '--name-only', mergeBase, tip]).split('\n').filter(Boolean);

  // Wiring files carry real work only when they change more than wiring.
  const realWiring = RULES_WIRING.filter(
    (file) => changed.includes(file) && realWiringChanges(git(['diff', '-U0', mergeBase, tip, '--', file])).length,
  );
  const skipped = new Set([
    ...VERSION_FILES,
    ...GENERATED,
    ...RULES_WIRING.filter((file) => !realWiring.includes(file)),
    ...changed.filter(isRulesBundle),
  ]);
  const work = changed.filter((file) => !skipped.has(file));

  git(['checkout', '--quiet', '-B', name, base]);
  const mainVersion = versionOf(base);

  if (work.length) {
    const patchDir = mkdtempSync(path.join(tmpdir(), 'cosyworld-land-'));
    const patch = path.join(patchDir, 'work.patch');
    try {
      writeFileSync(patch, git(['diff', '--binary', '--full-index', mergeBase, tip, '--', ...work]));
      const applied = spawnSync('git', ['apply', '--3way', '--index', '--whitespace=nowarn', patch], {
        cwd: repoRoot,
        stdio: 'inherit',
      });
      if (applied.status !== 0) {
        throw new Error(`The branch's own work conflicts with ${base}. Resolve the files above, then rerun the rules and asset builds and npm run version:bump.`);
      }
    } finally {
      rmSync(patchDir, { recursive: true, force: true });
    }
  }

  // Keep dependency edits in the version files; drop only the version lines.
  const scratch = mkdtempSync(path.join(tmpdir(), 'cosyworld-land-'));
  try {
    for (const file of VERSION_FILES.filter((f) => changed.includes(f))) {
      const before = show(mergeBase, file);
      const after = show(tip, file);
      if (before === null || after === null) throw new Error(`${file} was added or removed on ${branch}.`);
      const baseText = setVersion(file, before, mainVersion);
      const theirs = setVersion(file, after, mainVersion);
      if (theirs === baseText) continue;
      const files = ['base', 'theirs'].map((part) => path.join(scratch, `${part}-${path.basename(file)}`));
      writeFileSync(files[0], baseText);
      writeFileSync(files[1], theirs);
      const merged = spawnSync('git', ['merge-file', '-p', file, files[0], files[1]], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 1 << 30,
      });
      if (merged.status !== 0) throw new Error(`${file}: the branch's dependency changes conflict with ${base}.`);
      writeFileSync(path.join(repoRoot, file), merged.stdout);
      console.log(`[land] kept ${branch}'s changes in ${file}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  run(process.execPath, ['v2/scripts/next-shared-rules.mjs', base]);
  run(process.execPath, ['v2/scripts/build-card-shared-narrator.mjs']);
  run(process.execPath, ['v2/scripts/build-card-shared-content.mjs']);
  run(process.execPath, ['v2/scripts/build-card-assets.mjs']);
  run(process.execPath, ['scripts/bump-version.mjs']);

  const subjects = git(['log', '--reverse', '--format=%s', `${mergeBase}..${tip}`])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/\s*\[READY\]\s*$/u, ''));
  const bodies = git(['log', '--reverse', '--format=%b', `${mergeBase}..${tip}`])
    .split('\n')
    .filter((line) => !/^Co-Authored-By:/iu.test(line))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  const coAuthors = [...new Set(git(['log', '--format=%b', `${mergeBase}..${tip}`]).match(/^Co-Authored-By:.*$/gimu) || [])];
  const message = [subjects.at(-1) || `Land ${branch}`, '', bodies, '', ...coAuthors].join('\n').replace(/\n{3,}/gu, '\n\n').trim();
  git(['add', '--update']);
  git(['add', '--', rulesDir]);
  const messageDir = mkdtempSync(path.join(tmpdir(), 'cosyworld-land-'));
  try {
    writeFileSync(path.join(messageDir, 'message'), `${message}\n`);
    run('git', ['commit', '--quiet', '-F', path.join(messageDir, 'message')]);
  } finally {
    rmSync(messageDir, { recursive: true, force: true });
  }

  const rules = git(['diff', '--name-only', base, 'HEAD', '--', rulesDir]).split('\n').some(isRulesBundle);
  console.log(`[land] ${name} = ${branch} on ${base} at ${versionOf('HEAD')}.`);
  if (rules) {
    console.log('[land] Claimed new shared rules. Run: npx vitest run test/card-released-rules.test.mjs');
    console.log('[land]   and (cd v2/orchestrator-rust && cargo test --locked -- card_shared::)');
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    land(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`[land] ${error.message}`);
    process.exitCode = 1;
  }
}

export { parseArgs };
