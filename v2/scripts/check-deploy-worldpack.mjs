#!/usr/bin/env node
/**
 * Pre-deploy worldpack bundle compatibility gate.
 *
 * The runtime fails closed when the persisted journal/snapshot bundle hash
 * does not match the active bundle and is not declared replay-compatible.
 * That is correct — but discovering the mismatch only after the new machine
 * boots turns every stale-checkout, wrong-branch, or cross-migration deploy
 * into an outage (2026-07-29: both production worlds crash-looped to the
 * restart limit and recovered by rollback).
 *
 * This script performs the same comparison before the image is swapped:
 *
 *   candidate bundle hash (the checkout about to deploy)
 *     == live bundle hash (the bundle the target app's journal was written
 *        under, read from the running app's public /meta)
 *   OR the candidate bundle declares the live hash in
 *      persistence_compatibility.replay_compatible_bundle_hashes
 *
 * Anything else — mismatch, unreachable /meta, unverifiable identity — exits
 * non-zero so the deploy stops before the old machine is replaced. A rollback
 * across a migration boundary fails this gate by construction: the older
 * bundle cannot declare a newer hash.
 *
 * Usage:
 *   node v2/scripts/check-deploy-worldpack.mjs <fly-app | https://base-url>
 *     [--registry v2/content/official/registry.json]
 *     [--meta-file captured-meta.json]   # read /meta from disk instead of HTTP
 *     [--recovery-capture ops/capture.json]  # audited stand-in for an
 *                                            # unreachable /meta; see below
 *     [--timeout-ms 15000]
 *
 * Exit codes: 0 compatible; 1 incompatible or live identity unreadable
 * (fail closed); 2 usage or local registry error.
 *
 * When the target app is unreachable, failing closed blocks the deploy that
 * would fix it. `--recovery-capture` accepts a committed, reviewable capture of
 * the last known /meta so recovery stays possible without weakening the gate:
 * the captured hash is evaluated exactly like a live identity.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
const DEFAULT_REGISTRY_PATH = path.join(
  repoRoot,
  "v2/content/official/registry.json",
);
const DEFAULT_TIMEOUT_MS = 15_000;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const REMEDIATION =
  "Either deploy the bundle the live journal was written under, or author an "
  + "explicit migration that declares the live hash replay-compatible "
  + "(v2/worlds/official/world.json persistence_compatibility, then "
  + "npm run v2:worldpack:lock && npm run v2:worldpack), or follow the "
  + "documented fresh-seed path in v2/docs/worldpacks.md "
  + "('Identity and persistence') — a fresh seed is only allowed for "
  + "isolated installs, never the official world. Never blank a recorded "
  + "bundle hash to force a load.";

class UsageError extends Error {}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

export function resolveBaseUrl(target) {
  if (!target) {
    throw new UsageError("a fly app name or https:// base URL is required");
  }
  if (target.startsWith("https://") || target.startsWith("http://")) {
    return target.replace(/\/+$/, "");
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(target)) {
    throw new UsageError(
      `target must be a fly app name or https:// base URL, got '${target}'`,
    );
  }
  return `https://${target}.fly.dev`;
}

export function candidateFromRegistry(registry) {
  const bundleHash = registry?.manifest?.bundle_hash;
  if (typeof bundleHash !== "string" || !SHA256_PATTERN.test(bundleHash)) {
    throw new UsageError(
      "candidate registry manifest has no valid bundle hash — run "
      + "npm run v2:worldpack and commit the compiled bundle",
    );
  }
  const declared = registry.manifest.persistence_compatibility
    ?.replay_compatible_bundle_hashes ?? [];
  if (!Array.isArray(declared)) {
    throw new UsageError(
      "registry persistence_compatibility.replay_compatible_bundle_hashes "
      + "must be an array",
    );
  }
  for (const hash of declared) {
    if (typeof hash !== "string" || !SHA256_PATTERN.test(hash)) {
      throw new UsageError(
        `declared replay-compatible hash is not a sha256 digest: ${hash}`,
      );
    }
  }
  return { bundleHash, replayCompatible: declared };
}

export function evaluateWorldpackGate({ candidateHash, candidateReplayCompatible, liveHash }) {
  if (typeof liveHash !== "string" || !SHA256_PATTERN.test(liveHash)) {
    return {
      ok: false,
      status: "unverifiable",
      reason:
        "the live app did not report a verifiable worldpack bundle hash — "
        + "refusing to deploy blind",
    };
  }
  if (liveHash === candidateHash) {
    return {
      ok: true,
      status: "exact",
      reason: "candidate bundle matches the bundle the live journal was written under",
    };
  }
  if (candidateReplayCompatible.includes(liveHash)) {
    return {
      ok: true,
      status: "declared_migration",
      reason:
        "candidate bundle declares the live journal's bundle hash "
        + "replay-compatible",
    };
  }
  return {
    ok: false,
    status: "incompatible",
    reason:
      `candidate worldpack ${candidateHash} does not match the live journal's `
      + `worldpack ${liveHash} and does not declare it replay-compatible`,
  };
}

export async function fetchLiveWorldpackHash({
  baseUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  requestHost,
}) {
  const url = `${baseUrl}/meta`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(requestHost ? { host: requestHost } : {}),
      },
    });
  } catch (error) {
    throw new Error(
      `could not read live worldpack identity from ${url}: ${error.message}`,
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(
      `could not read live worldpack identity from ${url}: HTTP ${response.status}`,
    );
  }
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(
      `could not read live worldpack identity from ${url}: ${error.message}`,
    );
  }
  const liveHash = body?.worldpack?.bundle_hash;
  return typeof liveHash === "string" ? liveHash : "";
}

function currentCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

const VALUE_OPTIONS = new Set([
  "--registry",
  "--meta-file",
  "--recovery-capture",
  "--timeout-ms",
]);

const CAPTURE_SOURCES = new Set(["app-volume", "operator-capture"]);

/**
 * Read the audited recovery capture that stands in for an unreachable /meta.
 *
 * Failing closed on an unreachable app is correct for a stale-checkout deploy,
 * but it deadlocks the case that matters most: the app is unreachable *because*
 * it needs the deploy. That blocked production recovery twice (v557 on
 * 2026-08-05 and again on 2026-08-07, a ~2.5 day outage) because the primary
 * app had no recovery path while Lonely Forest did.
 *
 * This is an audited recovery path, not a bypass. The capture must be a
 * committed, reviewable file recording its source, timestamp, and the
 * unmodified /meta response, and the hash it carries is evaluated against the
 * candidate registry exactly like a live identity — a genuine mismatch still
 * fails. Mirrors `--recovery-capture` in check-lonelyforest-worldpacks.mjs.
 */
function recoveryCaptureHash(capturePath) {
  const absolutePath = path.resolve(repoRoot, capturePath);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new UsageError(
      `--recovery-capture must be a reviewed file inside the committed checkout, got ${capturePath}`,
    );
  }
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", relativePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (tracked.status !== 0) {
    throw new UsageError(
      `--recovery-capture must be committed and reviewable at ${relativePath} before a production deploy`,
    );
  }
  let capture;
  try {
    capture = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new UsageError(`cannot read --recovery-capture ${capturePath}: ${error.message}`);
  }
  if (capture?.schema_version !== 1
    || !CAPTURE_SOURCES.has(capture?.source)
    || typeof capture?.captured_at !== "string"
    || Number.isNaN(Date.parse(capture.captured_at))) {
    throw new UsageError(
      `--recovery-capture ${relativePath} must contain schema_version: 1, source `
      + "('app-volume' or 'operator-capture'), and an ISO captured_at",
    );
  }
  const liveHash = capture?.meta?.worldpack?.bundle_hash;
  if (typeof liveHash !== "string" || !SHA256_PATTERN.test(liveHash)) {
    throw new UsageError(
      `--recovery-capture ${relativePath} has no sha256 meta.worldpack.bundle_hash`,
    );
  }
  console.log(
    `::notice::using audited recovery capture ${relativePath} `
    + `(source=${capture.source}, captured_at=${capture.captured_at}) instead of a live /meta read`,
  );
  return liveHash;
}

function positionalTarget(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (VALUE_OPTIONS.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) return arg;
  }
  return undefined;
}

async function main(args) {
  const target = positionalTarget(args);
  const registryPath = option(args, "--registry") ?? DEFAULT_REGISTRY_PATH;
  const metaFile = option(args, "--meta-file");
  const recoveryCapture = option(args, "--recovery-capture");
  if (metaFile && recoveryCapture) {
    throw new UsageError("--meta-file and --recovery-capture are mutually exclusive");
  }
  const timeoutOption = option(args, "--timeout-ms");
  const timeoutMs = timeoutOption === undefined
    ? DEFAULT_TIMEOUT_MS
    : Number(timeoutOption);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new UsageError("--timeout-ms must be an integer from 1000 through 120000");
  }

  const baseUrl = resolveBaseUrl(target);
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(path.resolve(registryPath), "utf8"));
  } catch (error) {
    throw new UsageError(
      `cannot read candidate registry at ${registryPath}: ${error.message}`,
    );
  }
  const candidate = candidateFromRegistry(registry);

  let liveHash;
  if (recoveryCapture) {
    liveHash = recoveryCaptureHash(recoveryCapture);
  } else if (metaFile) {
    try {
      const body = JSON.parse(fs.readFileSync(path.resolve(metaFile), "utf8"));
      const reported = body?.worldpack?.bundle_hash;
      liveHash = typeof reported === "string" ? reported : "";
    } catch (error) {
      throw new UsageError(`cannot read --meta-file ${metaFile}: ${error.message}`);
    }
  } else {
    liveHash = await fetchLiveWorldpackHash({ baseUrl, timeoutMs });
  }

  const decision = evaluateWorldpackGate({
    candidateHash: candidate.bundleHash,
    candidateReplayCompatible: candidate.replayCompatible,
    liveHash,
  });

  console.log(
    `worldpack deploy gate: target=${baseUrl} status=${decision.status}\n`
    + `  live journal worldpack: ${liveHash || "(none reported)"}\n`
    + `  candidate worldpack:    ${candidate.bundleHash}\n`
    + `  candidate commit:       ${currentCommit()}`,
  );
  if (!decision.ok) {
    console.error(
      `::error::${decision.reason}. The new machine would fail its `
      + "production continuity check and crash-loop after the old one is "
      + `gone. ${REMEDIATION}`,
    );
    return 1;
  }
  if (decision.status === "declared_migration") {
    console.log(
      "::notice::deploy crosses a declared worldpack migration: "
      + `${liveHash} -> ${candidate.bundleHash}`,
    );
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      const prefix = error instanceof UsageError ? "usage error" : "worldpack deploy gate failed";
      console.error(`::error::${prefix}: ${error.message}`);
      if (error instanceof UsageError) {
        console.error(
          "usage: check-deploy-worldpack.mjs <fly-app | https://base-url> "
          + "[--registry registry.json] [--meta-file meta.json] "
          + "[--recovery-capture ops/capture.json] [--timeout-ms N]",
        );
        process.exit(2);
      }
      process.exit(1);
    });
}
