import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(scriptDir, "..");
const contentRoot = path.join(v2Root, "content");
const worldDir = path.join(v2Root, "worlds", "official");
const outputDir = path.join(contentRoot, "official");
const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const writeLock = args.has("--write-lock");

const resourceFiles = {
  actors: "actors.json",
  access_gates: "access_gates.json",
  factions: "factions.json",
  items: "items.json",
  locations: "locations.json",
  exits: "exits.json",
  hidden_exits: "hidden_exits.json",
  room_features: "room_features.json",
  room_sheets: "room_sheets.json",
  clocks: "clocks.json",
  jobs: "jobs.json",
  fronts: "fronts.json",
  cards: "cards.json",
  lifecycle_hooks: "lifecycle_hooks.json",
  evolution_tracks: "evolution_tracks.json",
  recipes: "recipes.json",
  sentences: "sentences.json",
};
const allowedPackKinds = new Set(["world", "campaign", "catalog", "assets", "rules"]);
const allowedEntitlementAuthorityTypes = new Set(["asset_feed", "solana_collection", "signed_set"]);
const rulesAdapter = "cosyworld.rules/1";
const supportedRuleResources = new Set(["conditions", "monster_seeds"]);

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${path.relative(v2Root, filePath)}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function filesBelow(directory) {
  if (!fs.existsSync(directory)) return [];
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...filesBelow(entryPath));
    else if (entry.isFile()) results.push(entryPath);
  }
  return results.sort();
}

function declaredPackFiles(packRoot, manifest) {
  const files = [path.join(packRoot, "pack.json")];
  for (const relativePath of Object.values(manifest.resources ?? {})) {
    files.push(path.join(packRoot, relativePath));
  }
  for (const relativePath of Object.values(manifest.rules ?? {})) {
    files.push(path.join(packRoot, relativePath));
  }
  if (manifest.character_creation) files.push(path.join(packRoot, manifest.character_creation));
  if (manifest.attribution?.file) files.push(path.join(packRoot, manifest.attribution.file));
  if (manifest.external_cards) files.push(path.join(packRoot, manifest.external_cards));
  for (const mount of manifest.assets ?? []) {
    if (mount.manifest) files.push(path.join(packRoot, mount.manifest));
    files.push(...filesBelow(path.join(packRoot, mount.directory)));
  }
  return [...new Set(files)].sort();
}

function packIntegrity(packRoot, manifest) {
  const parts = [];
  for (const filePath of declaredPackFiles(packRoot, manifest)) {
    assert(fs.existsSync(filePath), `declared pack file is missing: ${filePath}`);
    parts.push(path.relative(packRoot, filePath).split(path.sep).join("/"));
    parts.push(fs.readFileSync(filePath));
  }
  return sha256(parts);
}

function validateDistribution(packId, distribution) {
  if (!distribution) return;
  assert(distribution.media_type === "application/vnd.cosyworld.pack+json", `pack ${packId} has unsupported distribution media_type`);
  assert(distribution.canonicalization === "jcs", `pack ${packId} distribution must use jcs canonicalization`);
  assert(["content-addressed", "arweave"].includes(distribution.permanence), `pack ${packId} has unsupported distribution permanence`);
  if (distribution.permanent_uri !== undefined) {
    assert(/^ar:\/\/[A-Za-z0-9_-]{43}$/.test(distribution.permanent_uri), `pack ${packId} has invalid Arweave permanent_uri`);
  }
}

function validateEntitlements(packId, entitlements) {
  if (!entitlements) return;
  assert(entitlements.schema_version === 1, `pack ${packId} entitlements schema_version must be 1`);
  assert(Array.isArray(entitlements.authorities), `pack ${packId} entitlements authorities must be an array`);
  assert(Array.isArray(entitlements.grants), `pack ${packId} entitlements grants must be an array`);
  const authorityIds = new Set();
  for (const authority of entitlements.authorities) {
    assert(typeof authority.id === "string" && /^[a-z0-9][a-z0-9.-]*$/.test(authority.id), `pack ${packId} has invalid entitlement authority id`);
    assert(!authorityIds.has(authority.id), `pack ${packId} has duplicate entitlement authority ${authority.id}`);
    assert(allowedEntitlementAuthorityTypes.has(authority.type), `pack ${packId} authority ${authority.id} has unsupported type ${authority.type}`);
    if (authority.type === "solana_collection") {
      assert(authority.network === "mainnet-beta" || authority.network === "devnet", `pack ${packId} authority ${authority.id} has invalid Solana network`);
      assert(authority.standard === "metaplex_core" || authority.standard === "metaplex_token_metadata", `pack ${packId} authority ${authority.id} has invalid Solana standard`);
      assert(typeof authority.collection_address === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(authority.collection_address), `pack ${packId} authority ${authority.id} has invalid collection_address`);
    }
    if (authority.type === "signed_set") {
      assert(authority.algorithm === "ed25519", `pack ${packId} authority ${authority.id} must use ed25519`);
      assert(typeof authority.public_key === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(authority.public_key), `pack ${packId} authority ${authority.id} has invalid public_key`);
    }
    authorityIds.add(authority.id);
  }
  const grantIds = new Set();
  for (const grant of entitlements.grants) {
    assert(typeof grant.id === "string" && grant.id.startsWith(`${packId}:`) && /^[a-z0-9][a-z0-9.:-]*$/.test(grant.id), `pack ${packId} has invalid entitlement grant id ${grant.id}`);
    assert(!grantIds.has(grant.id), `pack ${packId} has duplicate entitlement grant ${grant.id}`);
    assert(authorityIds.has(grant.authority_id), `pack ${packId} grant ${grant.id} references unknown authority ${grant.authority_id}`);
    const authority = entitlements.authorities.find((candidate) => candidate.id === grant.authority_id);
    if (authority.type !== "signed_set") {
      assert(typeof grant.match?.asset_id === "string" && grant.match.asset_id.trim(), `pack ${packId} asset grant ${grant.id} requires match.asset_id`);
    }
    grantIds.add(grant.id);
  }
}

const world = readJson(path.join(worldDir, "world.json"));
const lockPath = path.join(worldDir, "world.lock.json");
const lock = readJson(lockPath);
assert(world.schema_version === 1, "official world schema_version must be 1");
assert(lock.lock_version === 1, "official world lock_version must be 1");
assert(lock.world_id === world.id, "world lock does not belong to the official world");
assert(Array.isArray(world.packs) && world.packs.length > 0, "official world has no packs");
assert(Array.isArray(lock.packs), "official world lock has no packs array");

const lockById = new Map(lock.packs.map((entry) => [entry.id, entry]));
assert(lockById.size === lock.packs.length, "world lock has duplicate pack ids");

const packs = [];
const available = new Set();
for (const packId of world.packs) {
  const locked = lockById.get(packId);
  assert(locked, `world pack ${packId} is missing from the lockfile`);
  assert(locked.source?.path, `world pack ${packId} has no materialized source path`);
  const packRoot = path.resolve(worldDir, locked.source.path);
  const manifest = readJson(path.join(packRoot, "pack.json"));
  assert(manifest.schema_version === 2, `pack ${packId} must use schema_version 2`);
  assert(manifest.id === packId, `pack path for ${packId} contains ${manifest.id}`);
  assert(manifest.version === locked.version, `pack ${packId} version does not match lockfile`);
  assert(allowedPackKinds.has(manifest.kind), `pack ${packId} has unsupported kind ${manifest.kind}`);
  validateDistribution(packId, manifest.distribution);
  validateEntitlements(packId, manifest.entitlements);
  if (manifest.kind === "rules") {
    assert(manifest.rules_adapter === rulesAdapter, `rules pack ${packId} must use ${rulesAdapter}`);
    assert(
      typeof manifest.rules_namespace === "string" && /^[a-z0-9][a-z0-9.-]*$/.test(manifest.rules_namespace),
      `rules pack ${packId} has an invalid rules_namespace`,
    );
    assert(
      manifest.rules && Object.keys(manifest.rules).length > 0,
      `rules pack ${packId} must declare rules resources`,
    );
    assert(
      manifest.attribution?.file && manifest.attribution?.source_name && manifest.attribution?.source_url,
      `rules pack ${packId} must declare attribution`,
    );
  } else {
    assert(!manifest.rules, `only rules packs may declare rules resources (${packId})`);
  }
  if (manifest.kind === "campaign") {
    assert(manifest.character_creation, `campaign pack ${packId} must declare character_creation`);
  }
  if (manifest.character_creation) {
    assert(
      ["world", "campaign"].includes(manifest.kind),
      `only world or campaign packs may declare character_creation (${packId})`,
    );
  }
  for (const resource of Object.keys(manifest.rules ?? {})) {
    assert(supportedRuleResources.has(resource), `rules pack ${packId} declares unknown rules resource ${resource}`);
  }
  for (const dependency of manifest.dependencies ?? []) {
    assert(available.has(dependency), `pack ${packId} dependency ${dependency} must appear earlier`);
  }
  const integrity = packIntegrity(packRoot, manifest);
  if (!writeLock) {
    assert(locked.integrity === integrity, `pack ${packId} integrity changed; run npm run v2:worldpack:lock`);
  }
  locked.integrity = integrity;
  available.add(packId);
  packs.push({ locked, manifest, packRoot, integrity });
}
assert(lock.packs.length === packs.length, "world lock contains packs not selected by world.json");

if (writeLock) fs.writeFileSync(lockPath, json(lock));

const resources = Object.fromEntries(Object.keys(resourceFiles).map((key) => [key, []]));
const externalCards = [];
const assets = [];
const ruleBundles = [];
const attributions = [];
const characterCreationBundles = [];
const resourceCountsByPack = new Map();
for (const pack of packs) {
  const resourceCounts = Object.fromEntries(Object.keys(resourceFiles).map((key) => [key, 0]));
  resourceCounts.external_cards = 0;
  resourceCounts.assets = 0;
  resourceCounts.rules = 0;
  resourceCounts.character_creation = 0;
  resourceCountsByPack.set(pack.manifest.id, resourceCounts);
  for (const [resource, relativePath] of Object.entries(pack.manifest.resources ?? {})) {
    assert(resource in resources, `pack ${pack.manifest.id} declares unknown resource ${resource}`);
    const rows = readJson(path.join(pack.packRoot, relativePath));
    assert(Array.isArray(rows), `pack ${pack.manifest.id} resource ${resource} must be an array`);
    for (const row of rows) {
      assert(row && typeof row === "object" && !Array.isArray(row), `pack ${pack.manifest.id} resource ${resource} contains a non-object row`);
      assert(!row.pack_id || row.pack_id === pack.manifest.id, `pack ${pack.manifest.id} resource ${resource} contains conflicting pack_id ${row.pack_id}`);
      resources[resource].push({ ...row, pack_id: pack.manifest.id });
    }
    resourceCounts[resource] += rows.length;
  }
  if (pack.manifest.rules) {
    const ruleResources = {};
    for (const [resource, relativePath] of Object.entries(pack.manifest.rules)) {
      const rows = readJson(path.join(pack.packRoot, relativePath));
      assert(Array.isArray(rows), `rules pack ${pack.manifest.id} resource ${resource} must be an array`);
      ruleResources[resource] = rows;
    }
    ruleBundles.push({
      pack_id: pack.manifest.id,
      pack_version: pack.manifest.version,
      adapter: pack.manifest.rules_adapter,
      namespace: pack.manifest.rules_namespace,
      resources: ruleResources,
    });
    resourceCounts.rules = Object.values(ruleResources).reduce((count, rows) => count + rows.length, 0);
  }
  if (pack.manifest.attribution) {
    const attributionText = fs.readFileSync(
      path.join(pack.packRoot, pack.manifest.attribution.file),
      "utf8",
    );
    attributions.push({
      pack_id: pack.manifest.id,
      license: pack.manifest.license,
      source_name: pack.manifest.attribution.source_name,
      source_url: pack.manifest.attribution.source_url,
      text: attributionText.trim(),
    });
  }
  if (pack.manifest.character_creation) {
    const profiles = readJson(path.join(pack.packRoot, pack.manifest.character_creation));
    assert(Array.isArray(profiles), `pack ${pack.manifest.id} character_creation must be an array`);
    characterCreationBundles.push({
      pack_id: pack.manifest.id,
      pack_version: pack.manifest.version,
      profiles,
    });
    resourceCounts.character_creation = profiles.length;
  }
  if (pack.manifest.external_cards) {
    const rows = readJson(path.join(pack.packRoot, pack.manifest.external_cards));
    assert(Array.isArray(rows), `pack ${pack.manifest.id} external_cards must be an array`);
    externalCards.push(...rows.map((row) => ({ ...row, pack_id: pack.manifest.id })));
    resourceCounts.external_cards = rows.length;
  }
  const relativeRoot = path.relative(contentRoot, pack.packRoot).split(path.sep).join("/");
  assert(!relativeRoot.startsWith(".."), `pack ${pack.manifest.id} must be materialized below v2/content`);
  for (const mount of pack.manifest.assets ?? []) {
    const directory = path.join(pack.packRoot, mount.directory);
    assert(mount.optional || fs.existsSync(directory), `required asset directory is missing: ${directory}`);
    assets.push({
      pack_id: pack.manifest.id,
      mount: mount.mount,
      root: relativeRoot,
      directory: mount.directory,
      public_prefix: mount.public_prefix,
      optional: Boolean(mount.optional),
      fallback: mount.fallback ?? null,
    });
    resourceCounts.assets += 1;
  }
}

const packSummary = packs.map(({ locked, manifest, integrity }) => ({
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  version: manifest.version,
  kind: manifest.kind,
  license: manifest.license,
  dependencies: manifest.dependencies ?? [],
  resource_counts: resourceCountsByPack.get(manifest.id),
  ...(manifest.distribution ? { distribution: manifest.distribution } : {}),
  ...(manifest.entitlements ? { entitlements: manifest.entitlements } : {}),
  ...(manifest.rules_adapter ? { rules_adapter: manifest.rules_adapter } : {}),
  ...(manifest.rules_namespace ? { rules_namespace: manifest.rules_namespace } : {}),
  source: locked.source,
  integrity,
}));
const bundleHash = sha256([
  json(world),
  json(packSummary),
  ...Object.values(resources).map(json),
  json(externalCards),
  json(assets),
  json(ruleBundles),
  json(attributions),
  json(characterCreationBundles),
]);
const manifest = {
  schema_version: 2,
  id: world.id,
  name: world.name,
  version: world.version,
  description: world.description,
  entry_location: world.entry_location,
  bundle_hash: bundleHash,
  packs: packSummary,
  files: resourceFiles,
  external_cards: "external_cards.json",
  assets: "assets.json",
  rules: "rules.json",
  attributions: "attributions.json",
  character_creation: "character_creation.json",
};

const outputs = new Map([
  ["worldpack.json", json(manifest)],
  ["external_cards.json", json(externalCards)],
  ["assets.json", json(assets)],
  ["rules.json", json(ruleBundles)],
  ["attributions.json", json(attributions)],
  ["character_creation.json", json(characterCreationBundles)],
  ...Object.entries(resourceFiles).map(([resource, fileName]) => [fileName, json(resources[resource])]),
]);

if (checkOnly) {
  const stale = [];
  for (const [fileName, contents] of outputs) {
    const filePath = path.join(outputDir, fileName);
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== contents) stale.push(fileName);
  }
  assert(stale.length === 0, `compiled official world is stale: ${stale.join(", ")}; run npm run v2:worldpack:compile`);
  console.log(`worldpack bundle current: ${world.id} ${bundleHash} (${packs.length} packs)`);
} else {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [fileName, contents] of outputs) fs.writeFileSync(path.join(outputDir, fileName), contents);
  console.log(`compiled worldpack: ${world.id} ${bundleHash} (${packs.length} packs)`);
}
