#!/usr/bin/env node
// Pre-deploy guard: refuse to swap a machine onto an image that cannot replay
// the journal the target app already holds.
//
// The 2026-07-29 outage was exactly this. The deploy tree was 14 commits behind
// origin/main and therefore missing the migration the live journal had been
// written under, so every boot failed continuity:
//
//   production continuity cannot replay action journal ...:
//   action journal worldpack sha256:29e213d6... does not match
//   active worldpack  sha256:9b955ecb... and is not declared replay-compatible
//
// Both apps crash-looped to Fly's restart limit and recovery was an image
// rollback. The fail-closed boot was correct — CLAUDE.md forbids erasing a
// mismatched hash to force a load — but nothing checked compatibility before
// the image was swapped, so the mismatch surfaced only once the old machine was
// already gone. This check is cheap and almost entirely offline.
//
// Usage: check-worldpack-deploy-compat.mjs <fly-app> [meta-url] [worldpack-json]
//
// Fails closed, matching scripts/check-fly-volume-space.sh: an unreadable live
// worldpack identity refuses the deploy rather than deploying blind. During an
// incident, when the app may be unreachable and a deploy is the recovery, set
// COSYWORLD_SKIP_WORLDPACK_DEPLOY_GATE=1 to override deliberately.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_COMPILED_WORLDPACK = path.join(
  repoRoot,
  'v2',
  'content',
  'official',
  'worldpack.json'
);

/**
 * Decide whether the compiled bundle can replay what the target app holds.
 *
 * `liveBundleHash` is the running image's active worldpack, which is the hash
 * the app is currently stamping onto new journal records. If the incoming
 * bundle neither matches it nor declares it replay-compatible, the new image
 * cannot replay records the current image is still writing.
 *
 * An empty live hash is a legacy unversioned world, which the runtime accepts.
 */
export function evaluateWorldpackDeployCompat({
  app,
  compiledBundleHash,
  replayCompatibleHashes = [],
  liveBundleHash,
  compiledRulesProfile,
  liveRulesProfile
}) {
  if (!compiledBundleHash) {
    return {
      ok: false,
      message:
        'compiled worldpack has no bundle_hash — run `npm run v2:worldpack` and commit the generated bundle'
    };
  }
  if (liveBundleHash === undefined || liveBundleHash === null) {
    return {
      ok: false,
      message:
        `could not read the live worldpack identity for ${app} — refusing to deploy blind. ` +
        'If the app is already down and this deploy is the recovery, re-run with ' +
        'COSYWORLD_SKIP_WORLDPACK_DEPLOY_GATE=1'
    };
  }
  if (liveBundleHash === '') {
    return {
      ok: true,
      message: `${app} reports a legacy unversioned worldpack; replay accepts it`
    };
  }
  if (liveRulesProfile && compiledRulesProfile && liveRulesProfile !== compiledRulesProfile) {
    return {
      ok: false,
      message:
        `${app} runs rules profile ${liveRulesProfile} but this tree compiles ` +
        `${compiledRulesProfile}. Replay rejects a rules-profile change, so every boot ` +
        'would fail continuity.'
    };
  }
  if (liveBundleHash === compiledBundleHash) {
    return {
      ok: true,
      message: `${app} worldpack ${compiledBundleHash} is unchanged by this deploy`
    };
  }
  if (replayCompatibleHashes.includes(liveBundleHash)) {
    return {
      ok: true,
      message:
        `${app} worldpack ${liveBundleHash} is declared replay-compatible with ` +
        `the incoming ${compiledBundleHash}`
    };
  }
  return {
    ok: false,
    message:
      `${app} would crash-loop on boot.\n` +
      `  live worldpack     : ${liveBundleHash}\n` +
      `  incoming worldpack : ${compiledBundleHash}\n` +
      'The incoming bundle does not declare the live one replay-compatible, so continuity ' +
      'fails on every boot and the release restarts until Fly gives up — the 2026-07-29 ' +
      'outage. Resolve it one of these documented ways:\n' +
      '  1. Deploy a tree that contains the migration the live world was written under. ' +
      'A checkout behind origin/main is the usual cause — fetch and rebase.\n' +
      '  2. Declare the migration: add the live hash to the pack\'s ' +
      'persistence_compatibility.replay_compatible_bundle_hashes, run `npm run v2:worldpack`, ' +
      'and commit the regenerated bundle.\n' +
      '  3. Take the documented fresh-seed path if this world is meant to restart.\n' +
      'Never erase the persisted hash to force a load.'
  };
}

export function readCompiledWorldpack(worldpackPath = DEFAULT_COMPILED_WORLDPACK) {
  const manifest = JSON.parse(readFileSync(worldpackPath, 'utf8'));
  return {
    compiledBundleHash: manifest.bundle_hash ?? '',
    replayCompatibleHashes:
      manifest.persistence_compatibility?.replay_compatible_bundle_hashes ?? [],
    compiledRulesProfile: manifest.rules_profile ?? ''
  };
}

async function readLiveWorldpack(metaUrl) {
  try {
    const response = await fetch(metaUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      process.stderr.write(`${metaUrl} responded ${response.status}\n`);
      return {};
    }
    const meta = await response.json();
    return {
      liveBundleHash: meta?.worldpack?.bundle_hash,
      liveRulesProfile: meta?.worldpack?.rules_profile
    };
  } catch (error) {
    process.stderr.write(`reading ${metaUrl} failed: ${error.message}\n`);
    return {};
  }
}

async function main() {
  const [app, metaUrlArg, worldpackArg] = process.argv.slice(2);
  if (!app) {
    process.stderr.write(
      'usage: check-worldpack-deploy-compat.mjs <fly-app> [meta-url] [worldpack-json]\n'
    );
    process.exit(2);
  }
  if (process.env.COSYWORLD_SKIP_WORLDPACK_DEPLOY_GATE === '1') {
    process.stdout.write(
      `worldpack deploy gate skipped for ${app} by COSYWORLD_SKIP_WORLDPACK_DEPLOY_GATE\n`
    );
    process.exit(0);
  }
  const metaUrl = metaUrlArg || `https://${app}.fly.dev/meta`;
  const compiled = readCompiledWorldpack(worldpackArg || DEFAULT_COMPILED_WORLDPACK);
  const live = await readLiveWorldpack(metaUrl);
  const verdict = evaluateWorldpackDeployCompat({ app, ...compiled, ...live });
  if (verdict.ok) {
    process.stdout.write(`${verdict.message}\n`);
    process.exit(0);
  }
  process.stderr.write(`::error::${verdict.message}\n`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
