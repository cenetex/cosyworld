import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
export const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
export const TENANTS_PATH = path.join(repoRoot, "deploy/lonelyforest/tenants.tsv");
const REQUIRED_COLUMNS = 11;
const VALID_SLUG = /^[a-z0-9][a-z0-9-]*$/;
const VALID_UPSTREAM = /^[a-z_][a-z0-9_]*$/;
const VALID_PORT = /^[1-9][0-9]{3,4}$/;
const VALID_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export class TenantConfigError extends Error {}

function configError(message) {
  throw new TenantConfigError(`Lonely Forest tenant configuration: ${message}`);
}

function canonicalContainerPath(value, root, label) {
  if (typeof value !== "string" || !value.startsWith(`${root}/`)) {
    configError(`${label} must be an absolute path below ${root}`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || value.includes("//") || value.endsWith("/")) {
    configError(`${label} must be a canonical path without traversal or normalization aliases: ${value}`);
  }
  return value;
}

function overlappingPath(a, b) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function candidateRegistryPath(tenant, root = repoRoot) {
  if (!tenant.registry.startsWith("/app/")) {
    configError(`${tenant.slug} registry must be rooted at /app/, got ${tenant.registry}`);
  }
  return path.join(root, tenant.registry.slice("/app/".length));
}

export function readLonelyForestTenants(file = TENANTS_PATH) {
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    configError(`cannot read ${file}: ${error.message}`);
  }
  const tenants = [];
  const slugs = new Set();
  const hosts = new Set();
  const ports = new Set();
  const upstreams = new Set();
  const persistenceTargets = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line || line.startsWith("#")) continue;
    const columns = line.split("|");
    if (columns.length !== REQUIRED_COLUMNS) {
      configError(`line ${index + 1} must have ${REQUIRED_COLUMNS} pipe-separated columns`);
    }
    const [slug, requirement, hostList, upstream, port, registry, entryLocation,
      snapshotPath, eventDbPath, generatedAssetDir, extraOrigins] = columns;
    if (!VALID_SLUG.test(slug) || slugs.has(slug)) configError(`invalid or duplicate slug '${slug}'`);
    if (!new Set(["required", "optional"]).has(requirement)) {
      configError(`${slug} must be required or optional`);
    }
    const hostsForTenant = hostList.split(",");
    if (hostsForTenant.length === 0 || hostsForTenant.some((host) => !VALID_HOST.test(host) || hosts.has(host))) {
      configError(`${slug} has an invalid or duplicate public host`);
    }
    if (!VALID_UPSTREAM.test(upstream) || upstreams.has(upstream)) configError(`${slug} has an invalid or duplicate nginx upstream`);
    if (!VALID_PORT.test(port) || ports.has(port)) configError(`${slug} has an invalid or duplicate port`);
    canonicalContainerPath(registry, "/app/v2/content", `${slug} registry`);
    if (!registry.endsWith("/registry.json")) configError(`${slug} registry must name registry.json`);
    for (const [field, target] of [
      ["snapshot path", snapshotPath],
      ["event database path", eventDbPath],
      ["generated asset directory", generatedAssetDir],
    ]) {
      canonicalContainerPath(target, "/data", `${slug} ${field}`);
      const existing = persistenceTargets.find((entry) => overlappingPath(entry.target, target));
      if (existing) {
        configError(`${slug} ${field} ${target} overlaps ${existing.slug} ${existing.field} ${existing.target}`);
      }
      persistenceTargets.push({ slug, field, target });
    }
    if (entryLocation !== "-" && !/^[1-9][0-9]*$/.test(entryLocation)) configError(`${slug} has an invalid entry location`);
    slugs.add(slug);
    hostsForTenant.forEach((host) => hosts.add(host));
    ports.add(port);
    upstreams.add(upstream);
    tenants.push({
      slug,
      requirement,
      required: requirement === "required",
      hosts: hostsForTenant,
      upstream,
      port,
      registry,
      entryLocation,
      snapshotPath,
      eventDbPath,
      generatedAssetDir,
      extraOrigins: extraOrigins ? extraOrigins.split(",") : [],
    });
  }
  if (tenants.length === 0 || tenants[0]?.slug !== "root" || !tenants[0].required) {
    configError("must begin with the required root tenant");
  }
  return tenants;
}
