import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import addFormats from "ajv-formats";

export const CONTENT_PACK_CONTRACT = "cosyworld.content-pack/1";
export const CANONICAL_ID_MAPPING_VERSION = 1;
export const CAPABILITY_KINDS = Object.freeze([
  "world",
  "rules",
  "cards",
  "assets",
  "entitlements",
  "reference",
]);

const WORLD_ENTITY_FIELDS = Object.freeze({
  actors: new Set([
    "pack_id",
    "requires_packs",
    "id",
    "name",
    "speech_mode",
    "title",
    "description",
    "ambient_autonomy",
    "location_id",
    "stats",
    "desires",
    "attachments",
  ]),
  items: new Set([
    "pack_id",
    "requires_packs",
    "id",
    "name",
    "description",
    "kind",
    "charges",
    "location_id",
  ]),
  locations: new Set([
    "pack_id",
    "requires_packs",
    "id",
    "name",
    "title",
    "description",
    "persona",
    "memory",
    "biome",
    "terrain",
    "allow_combat",
  ]),
});

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(scriptDir, "../schemas/content-pack-manifest-v1.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function contractError(message) {
  throw new Error(`content pack contract: ${message}`);
}

function formatSchemaErrors(errors) {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

export function validateWorldEntityResource(packId, resource, row) {
  const allowedFields = WORLD_ENTITY_FIELDS[resource];
  if (!allowedFields) return row;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    contractError(`pack ${packId} ${resource} resource must be an object`);
  }
  for (const field of Object.keys(row)) {
    if (!allowedFields.has(field)) {
      contractError(
        `pack ${packId} ${resource} resource ${String(row.id ?? "unknown")} has unknown field ${field}; `
        + "wallet cards and entitlements must use card_bindings and entitlement grants, not world entity state",
      );
    }
  }
  return row;
}

export function parseSemver(version, label = "version") {
  const match = String(version).match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) contractError(`${label} ${JSON.stringify(version)} is not semantic versioning`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function compareSemver(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

export function versionSatisfies(version, range, label = "version range") {
  const candidate = parseSemver(version, label);
  const comparators = String(range).trim().split(/\s+/);
  if (comparators.length === 0) contractError(`${label} is empty`);
  return comparators.every((comparator) => {
    const match = comparator.match(/^(>=|<=|>|<|=)?(.+)$/);
    if (!match) contractError(`${label} ${JSON.stringify(range)} is invalid`);
    const operator = match[1] ?? "=";
    const expected = parseSemver(match[2], label);
    const comparison = compareSemver(candidate, expected);
    if (operator === ">=") return comparison >= 0;
    if (operator === "<=") return comparison <= 0;
    if (operator === ">") return comparison > 0;
    if (operator === "<") return comparison < 0;
    return comparison === 0;
  });
}

export function validateContentPackManifest(manifest, label = "pack.json") {
  if (!validateSchema(manifest)) {
    contractError(`${label}: ${formatSchemaErrors(validateSchema.errors ?? [])}`);
  }

  const capabilityIds = new Set();
  for (const capability of manifest.capabilities) {
    parseSemver(capability.version, `${label} capability ${capability.id}`);
    if (capabilityIds.has(capability.id)) {
      contractError(`${label}: duplicate capability declaration ${capability.id}`);
    }
    capabilityIds.add(capability.id);
  }

  const dependencyIds = new Set();
  for (const dependency of manifest.dependencies) {
    if (dependency.id === manifest.id) {
      contractError(`${label}: pack ${manifest.id} cannot depend on itself`);
    }
    if (dependencyIds.has(dependency.id)) {
      contractError(`${label}: duplicate dependency declaration ${dependency.id}`);
    }
    dependencyIds.add(dependency.id);
    for (const capabilityId of dependency.capabilities) {
      if (capabilityIds.has(capabilityId)) {
        contractError(
          `${label}: dependency ${dependency.id} requests self-provided capability ${capabilityId}`,
        );
      }
    }
  }

  const entryPointKeys = new Set();
  for (const entryPoint of manifest.entry_points ?? []) {
    const key = `${entryPoint.kind}:${entryPoint.id}`;
    if (entryPointKeys.has(key)) contractError(`${label}: duplicate entry point ${key}`);
    entryPointKeys.add(key);
  }

  const providedKinds = new Set(manifest.capabilities.map((capability) => capability.kind));
  if (["world", "campaign"].includes(manifest.kind) && !providedKinds.has("world")) {
    contractError(`${label}: ${manifest.kind} pack ${manifest.id} must provide a world capability`);
  }
  if (manifest.kind === "rules" && !providedKinds.has("rules")) {
    contractError(`${label}: rules pack ${manifest.id} must provide a rules capability`);
  }
  if ((manifest.assets ?? []).length > 0 && !providedKinds.has("assets")) {
    contractError(`${label}: pack ${manifest.id} declares assets without an assets capability`);
  }
  for (const mount of manifest.assets ?? []) {
    if (!manifest.capabilities.some(
      (capability) => capability.id === mount.provider && capability.kind === "assets",
    )) {
      contractError(
        `${label}: asset mount ${mount.mount} references unavailable provider ${mount.provider}`,
      );
    }
  }
  if (manifest.external_cards && !providedKinds.has("cards")) {
    contractError(`${label}: pack ${manifest.id} declares external cards without a cards capability`);
  }
  if (manifest.entitlements && !providedKinds.has("entitlements")) {
    contractError(
      `${label}: pack ${manifest.id} declares entitlement providers without an entitlements capability`,
    );
  }
  for (const authority of manifest.entitlements?.authorities ?? []) {
    if (!manifest.capabilities.some(
      (capability) => capability.id === authority.provider && capability.kind === "entitlements",
    )) {
      contractError(
        `${label}: entitlement authority ${authority.id} references unavailable provider ${authority.provider}`,
      );
    }
  }
  if (manifest.default_ruleset !== undefined && manifest.default_ruleset !== null) {
    const local = manifest.capabilities.find(
      (capability) => capability.id === manifest.default_ruleset && capability.kind === "rules",
    );
    const dependency = manifest.dependencies.some((candidate) =>
      candidate.capabilities.includes(manifest.default_ruleset),
    );
    if (!local && !dependency) {
      contractError(
        `${label}: default_ruleset ${manifest.default_ruleset} is not provided or required`,
      );
    }
  }
  return manifest;
}

export function resolveContentPackGraph(manifests, engineVersion) {
  parseSemver(engineVersion, "engine version");
  const byId = new Map();
  const capabilityProviders = new Map();

  for (const manifest of manifests) {
    validateContentPackManifest(manifest, `${manifest.id || "unknown"}/pack.json`);
    if (byId.has(manifest.id)) contractError(`duplicate pack declaration ${manifest.id}`);
    if (!versionSatisfies(engineVersion, manifest.engine, `pack ${manifest.id} engine range`)) {
      contractError(
        `pack ${manifest.id}@${manifest.version} requires engine ${manifest.engine}, current engine is ${engineVersion}`,
      );
    }
    byId.set(manifest.id, manifest);
    for (const capability of manifest.capabilities) {
      const existing = capabilityProviders.get(capability.id);
      if (existing) {
        contractError(
          `duplicate capability ${capability.id} provided by ${existing.pack.id}@${existing.pack.version} and ${manifest.id}@${manifest.version}`,
        );
      }
      capabilityProviders.set(capability.id, { pack: manifest, capability });
    }
  }

  for (const manifest of manifests) {
    for (const dependency of manifest.dependencies) {
      const target = byId.get(dependency.id);
      if (!target) {
        if (dependency.optional) continue;
        contractError(
          `pack ${manifest.id}@${manifest.version} is missing dependency ${dependency.id} (${dependency.version})`,
        );
      }
      if (!versionSatisfies(target.version, dependency.version, `dependency ${dependency.id} range`)) {
        contractError(
          `pack ${manifest.id}@${manifest.version} requires ${dependency.id} ${dependency.version}, mounted ${target.version}`,
        );
      }
      const targetCapabilities = new Set(target.capabilities.map((capability) => capability.id));
      for (const capabilityId of dependency.capabilities) {
        if (!targetCapabilities.has(capabilityId)) {
          contractError(
            `pack ${manifest.id}@${manifest.version} requires missing capability ${capabilityId} from ${target.id}@${target.version}`,
          );
        }
      }
    }
  }

  const ordered = [];
  const visiting = [];
  const visited = new Set();
  function visit(packId) {
    if (visited.has(packId)) return;
    const cycleStart = visiting.indexOf(packId);
    if (cycleStart !== -1) {
      const cycle = [...visiting.slice(cycleStart), packId].join(" -> ");
      contractError(`dependency cycle ${cycle}`);
    }
    visiting.push(packId);
    const manifest = byId.get(packId);
    const dependencies = manifest.dependencies
      .filter((dependency) => byId.has(dependency.id))
      .map((dependency) => dependency.id)
      .sort();
    for (const dependencyId of dependencies) visit(dependencyId);
    visiting.pop();
    visited.add(packId);
    ordered.push(manifest);
  }
  for (const packId of [...byId.keys()].sort()) visit(packId);

  const dependencyClosure = new Map();
  function closureFor(packId, found = new Set()) {
    const manifest = byId.get(packId);
    for (const dependency of manifest.dependencies) {
      if (!byId.has(dependency.id) || found.has(dependency.id)) continue;
      found.add(dependency.id);
      closureFor(dependency.id, found);
    }
    return found;
  }
  const orderIndex = new Map(ordered.map((manifest, index) => [manifest.id, index]));
  for (const manifest of ordered) {
    dependencyClosure.set(
      manifest.id,
      [...closureFor(manifest.id)].sort((left, right) => orderIndex.get(left) - orderIndex.get(right)),
    );
  }

  for (const manifest of ordered) {
    if (manifest.default_ruleset === undefined || manifest.default_ruleset === null) continue;
    const provider = capabilityProviders.get(manifest.default_ruleset);
    if (!provider || provider.capability.kind !== "rules") {
      contractError(
        `pack ${manifest.id}@${manifest.version} selects unavailable rules capability ${manifest.default_ruleset}`,
      );
    }
  }

  return { ordered, dependencyClosure, capabilityProviders };
}
