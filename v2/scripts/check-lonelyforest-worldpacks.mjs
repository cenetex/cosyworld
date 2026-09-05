#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  candidateFromRegistry,
  evaluateWorldpackGate,
  fetchLiveWorldpackHash,
} from "./check-deploy-worldpack.mjs";
import {
  TenantConfigError,
  candidateRegistryPath,
  readLonelyForestTenants,
  repoRoot,
} from "./lonelyforest-tenants.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_LIVE_FETCH_ATTEMPTS = 3;
const DEFAULT_LIVE_FETCH_RETRY_DELAY_MS = 1_000;
const CAPTURE_SOURCES = new Set(["tenant-volume", "operator-capture"]);

export class LonelyForestGateError extends Error {}

function fail(message) {
  throw new LonelyForestGateError(message);
}

function parseCaptureArgument(value) {
  const separator = value.indexOf("=");
  if (separator < 1 || separator === value.length - 1) {
    fail("--recovery-capture must be tenant=path/to/captured-meta.json");
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

export function recoveryCapturesFromArgs(args, root = repoRoot) {
  const captures = new Map();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--recovery-capture") continue;
    const value = args[index + 1];
    if (!value) fail("--recovery-capture requires tenant=path");
    const [slug, capturePath] = parseCaptureArgument(value);
    if (captures.has(slug)) fail(`duplicate recovery capture for tenant '${slug}'`);
    let capture;
    try {
      capture = JSON.parse(fs.readFileSync(path.resolve(root, capturePath), "utf8"));
    } catch (error) {
      fail(`cannot read recovery capture for ${slug} at ${capturePath}: ${error.message}`);
    }
    if (capture?.schema_version !== 1 || capture?.tenant !== slug
      || !CAPTURE_SOURCES.has(capture?.source)
      || typeof capture?.captured_at !== "string" || Number.isNaN(Date.parse(capture.captured_at))) {
      fail(`recovery capture for ${slug} must contain schema_version: 1, matching tenant, source ('tenant-volume' or 'operator-capture'), and captured_at`);
    }
    const liveHash = capture?.meta?.worldpack?.bundle_hash;
    if (typeof liveHash !== "string") {
      fail(`recovery capture for ${slug} has no meta.worldpack.bundle_hash`);
    }
    captures.set(slug, {
      path: capturePath,
      absolutePath: path.resolve(root, capturePath),
      source: capture.source,
      capturedAt: capture.captured_at,
      liveHash,
    });
  }
  return captures;
}

function requireTrackedRecoveryCaptures(captures) {
  for (const [slug, capture] of captures) {
    const relativePath = path.relative(repoRoot, capture.absolutePath);
    if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      fail(`recovery capture for ${slug} must be a reviewed file inside the committed checkout, got ${capture.path}`);
    }
    const result = spawnSync("git", ["ls-files", "--error-unmatch", "--", relativePath], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      fail(`recovery capture for ${slug} must be committed and reviewable at ${relativePath} before a production deploy`);
    }
  }
}

function registryForTenant(tenant, root) {
  const registryPath = candidateRegistryPath(tenant, root);
  try {
    return candidateFromRegistry(JSON.parse(fs.readFileSync(registryPath, "utf8")));
  } catch (error) {
    if (error instanceof TenantConfigError) throw error;
    fail(`tenant=${tenant.slug} cannot read candidate registry ${registryPath}: ${error.message}`);
  }
}

export function fetchThroughSharedTransport(url, { signal, headers = {} } = {}) {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      ...(target.protocol === "https:" ? { servername: target.hostname } : {}),
      method: "GET",
      path: `${target.pathname}${target.search}`,
      headers,
      signal,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const status = response.statusCode ?? 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: async () => JSON.parse(body),
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchLiveWorldpackHashWithRetries({
  baseUrl,
  timeoutMs,
  fetchImpl,
  attempts,
  retryDelayMs,
  tenant,
  log,
  requestHost,
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchLiveWorldpackHash({
        baseUrl,
        timeoutMs,
        fetchImpl,
        requestHost,
      });
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      log(`::warning::tenant=${tenant.slug} live /meta read attempt ${attempt}/${attempts} failed (${error.message}); retrying in ${retryDelayMs}ms`);
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw lastError;
}

export async function verifyLonelyForestTenants({
  tenants = readLonelyForestTenants(),
  root = repoRoot,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  recoveryCaptures = new Map(),
  freshEmptyTenants = new Set(),
  fetchImpl = fetch,
  log = console.log,
  liveFetchAttempts = DEFAULT_LIVE_FETCH_ATTEMPTS,
  liveFetchRetryDelayMs = DEFAULT_LIVE_FETCH_RETRY_DELAY_MS,
  transportBaseUrl,
  transportFetchImpl = fetchThroughSharedTransport,
}) {
  const results = [];
  const usedRecoveryCaptures = new Set();
  const usedFreshEmptyTenants = new Set();
  for (const tenant of tenants) {
    const registryPath = candidateRegistryPath(tenant, root);
    if (!fs.existsSync(registryPath)) {
      if (!tenant.required) {
        log(`::notice::tenant=${tenant.slug} policy=optional candidate registry absent; it is intentionally not installed in this release`);
        results.push({ tenant, status: "optional_absent", ok: true });
        continue;
      }
      fail(`tenant=${tenant.slug} required candidate registry is missing: ${registryPath}`);
    }
    const candidate = registryForTenant(tenant, root);
    const baseUrl = transportBaseUrl ?? `https://${tenant.hosts[0]}`;
    const requestHost = transportBaseUrl ? tenant.hosts[0] : undefined;
    let liveHash;
    let identitySource = "live /meta";
    try {
      liveHash = await fetchLiveWorldpackHashWithRetries({
        baseUrl,
        timeoutMs,
        fetchImpl: transportBaseUrl ? transportFetchImpl : fetchImpl,
        attempts: liveFetchAttempts,
        retryDelayMs: liveFetchRetryDelayMs,
        tenant,
        log,
        requestHost,
      });
    } catch (error) {
      if (freshEmptyTenants.has(tenant.slug)) {
        usedFreshEmptyTenants.add(tenant.slug);
        log(`::warning::tenant=${tenant.slug} live /meta unavailable; accepting a one-time fresh install after the deployment workflow proved its snapshot and event database are absent`);
        results.push({
          tenant,
          status: "fresh_install",
          ok: true,
          candidateHash: candidate.bundleHash,
          identitySource: "workflow-attested empty persistence paths",
        });
        continue;
      }
      const capture = recoveryCaptures.get(tenant.slug);
      if (!capture) {
        fail(`tenant=${tenant.slug} host=${tenant.hosts[0]} candidate=${candidate.bundleHash} could not read live /meta (${error.message}). Refusing to replace the image without this tenant's persisted bundle identity. Restore the tenant or pass an explicit reviewed --recovery-capture ${tenant.slug}=path from its volume.`);
      }
      liveHash = capture.liveHash;
      usedRecoveryCaptures.add(tenant.slug);
      identitySource = `recovery capture ${capture.path} source=${capture.source} captured_at=${capture.capturedAt}`;
      log(`::warning::tenant=${tenant.slug} live /meta unavailable; using ${identitySource}`);
    }
    const decision = evaluateWorldpackGate({
      candidateHash: candidate.bundleHash,
      candidateReplayCompatible: candidate.replayCompatible,
      liveHash,
    });
    log(`Lonely Forest worldpack gate: tenant=${tenant.slug} host=${tenant.hosts[0]} status=${decision.status}\n`
      + `  identity source:         ${identitySource}\n`
      + `  live journal worldpack: ${liveHash || "(none reported)"}\n`
      + `  candidate worldpack:    ${candidate.bundleHash}`);
    if (!decision.ok) {
      fail(`tenant=${tenant.slug} host=${tenant.hosts[0]} live=${liveHash || "(none reported)"} candidate=${candidate.bundleHash}: ${decision.reason}. Author an explicit replay compatibility migration for this tenant or deploy the bundle its persisted journal requires; an older rollback image is unsafe after a forward snapshot migration.`);
    }
    results.push({ tenant, status: decision.status, ok: true, liveHash, candidateHash: candidate.bundleHash, identitySource });
  }
  for (const slug of freshEmptyTenants) {
    if (!tenants.some((tenant) => tenant.slug === slug)) fail(`fresh install names unknown tenant '${slug}'`);
    if (!usedFreshEmptyTenants.has(slug)) {
      fail(`fresh install for ${slug} was supplied but live /meta was available; remove it so bootstrap remains one-time and explicit`);
    }
  }
  for (const slug of recoveryCaptures.keys()) {
    if (!tenants.some((tenant) => tenant.slug === slug)) fail(`recovery capture names unknown tenant '${slug}'`);
    if (!usedRecoveryCaptures.has(slug)) {
      fail(`recovery capture for ${slug} was supplied but live /meta was available; remove it so recovery use remains explicit and auditable`);
    }
  }
  return results;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

async function main(args) {
  const timeoutOption = option(args, "--timeout-ms");
  const timeoutMs = timeoutOption === undefined ? DEFAULT_TIMEOUT_MS : Number(timeoutOption);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    fail("--timeout-ms must be an integer from 1000 through 120000");
  }
  const captures = recoveryCapturesFromArgs(args);
  const transportBaseUrlOption = option(args, "--transport-base-url");
  let transportBaseUrl;
  if (transportBaseUrlOption !== undefined) {
    let parsed;
    try {
      parsed = new URL(transportBaseUrlOption);
    } catch {
      fail("--transport-base-url must be a valid HTTPS URL");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password
      || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
      fail("--transport-base-url must be an HTTPS origin without credentials, path, query, or fragment");
    }
    transportBaseUrl = parsed.origin;
  }
  const freshEmptyTenants = new Set();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--fresh-empty-tenant") continue;
    const slug = args[index + 1];
    if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      fail("--fresh-empty-tenant requires a valid tenant slug");
    }
    if (freshEmptyTenants.has(slug)) fail(`duplicate fresh install for tenant '${slug}'`);
    freshEmptyTenants.add(slug);
  }
  requireTrackedRecoveryCaptures(captures);
  return verifyLonelyForestTenants({
    timeoutMs,
    recoveryCaptures: captures,
    freshEmptyTenants,
    transportBaseUrl,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((error) => {
      const prefix = error instanceof TenantConfigError || error instanceof LonelyForestGateError
        ? "Lonely Forest worldpack deploy gate failed"
        : "Lonely Forest worldpack deploy gate crashed";
      console.error(`::error::${prefix}: ${error.message}`);
      console.error("usage: check-lonelyforest-worldpacks.mjs [--timeout-ms N] [--transport-base-url https://app.fly.dev] [--recovery-capture tenant=path/to/captured-meta.json] [--fresh-empty-tenant slug]");
      process.exit(1);
    });
}
