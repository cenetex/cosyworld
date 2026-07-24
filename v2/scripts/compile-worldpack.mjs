import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_ID_MAPPING_VERSION,
  CONTENT_PACK_CONTRACT,
  resolveContentPackGraph,
  validateContentPackManifest,
  validateWorldEntityResource,
} from "./content-pack-contract.mjs";
import {
  buildContentReferenceMapping,
  collectContentReferenceCandidates,
} from "./content-references.mjs";
import { assertAvatarNamingConfig } from "./avatar-naming-schema.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(v2Root, "..");
const contentRoot = path.join(v2Root, "content");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
function optionValue(name) {
  const index = rawArgs.indexOf(name);
  if (index < 0) return undefined;
  assert(rawArgs[index + 1] && !rawArgs[index + 1].startsWith("--"), `${name} requires a path`);
  return path.resolve(rawArgs[index + 1]);
}
const worldDir = optionValue("--world-dir") ?? path.join(v2Root, "worlds", "official");
const outputDir = optionValue("--output-dir") ?? path.join(contentRoot, "official");
const checkOnly = args.has("--check");
const writeLock = args.has("--write-lock");
const printArtifactDigest = args.has("--artifact-digest");

const resourceFiles = {
  actors: "actors.json",
  actor_facets: "actor_facets.json",
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
  action_vocabulary: "action_vocabulary.json",
  fronts: "fronts.json",
  cards: "cards.json",
  card_bindings: "card_bindings.json",
  lifecycle_hooks: "lifecycle_hooks.json",
  evolution_tracks: "evolution_tracks.json",
  recipes: "recipes.json",
  sentences: "sentences.json",
};
const allowedPackKinds = new Set(["world", "campaign", "catalog", "assets", "rules"]);
const allowedEntitlementAuthorityTypes = new Set(["asset_feed", "solana_collection", "signed_set"]);
const supportedRulesAdapters = new Map([
  ["cosyworld.rules/1", new Set(["conditions", "monster_seeds"])],
  ["cosyworld.rules/2", new Set([
    "profiles",
    "actions",
    "operations",
    "legacy_bindings",
    "abilities",
    "skills",
    "item_roles",
    "equipment_profiles",
    "magic_effects",
    "conformance",
  ])],
]);
const requiredSrdActionIds = new Set([
  "srd5.2.1:attack",
  "srd5.2.1:dash",
  "srd5.2.1:disengage",
  "srd5.2.1:dodge",
  "srd5.2.1:help",
  "srd5.2.1:hide",
  "srd5.2.1:influence",
  "srd5.2.1:magic",
  "srd5.2.1:ready",
  "srd5.2.1:search",
  "srd5.2.1:study",
  "srd5.2.1:utilize",
]);
const contributionKinds = ["reskins", "offers", "variants", "extensions"];
const reskinFields = new Set([
  "id", "based_on", "label", "description", "art", "scope", "compatibility",
  "compose_with", "source_reference",
]);

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

function loadAvatarNaming(world, worldDir) {
  if (world.avatar_naming === undefined) return null;
  assert(
    typeof world.avatar_naming === "string" && world.avatar_naming.trim(),
    "world avatar_naming must be a relative JSON path",
  );
  const filePath = path.resolve(worldDir, world.avatar_naming);
  const worldsRoot = path.resolve(worldDir, "..");
  const relativePath = path.relative(worldsRoot, filePath);
  assert(
    relativePath
      && relativePath !== ".."
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath),
    "world avatar_naming must stay within v2/worlds",
  );
  const config = readJson(filePath);
  assert(
    config && typeof config === "object" && !Array.isArray(config),
    "world avatar_naming must contain an object",
  );
  assertAvatarNamingConfig(config, "world avatar_naming");
  return config;
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
  const repoRelativeDirectory = path.relative(repoRoot, directory);
  const isInsideRepository = repoRelativeDirectory !== ""
    && !repoRelativeDirectory.startsWith(`..${path.sep}`)
    && !path.isAbsolute(repoRelativeDirectory);
  if (isInsideRepository) {
    const trackedOrVisible = spawnSync("git", [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      repoRelativeDirectory,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (trackedOrVisible.status === 0) {
      return trackedOrVisible.stdout
        .split("\0")
        .filter(Boolean)
        .map((filePath) => path.join(repoRoot, filePath))
        .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
        .sort();
    }
  }
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
  for (const relativePath of Object.values(manifest.contributions ?? {})) {
    files.push(path.join(packRoot, relativePath));
  }
  if (manifest.character_creation) files.push(path.join(packRoot, manifest.character_creation));
  if (manifest.attribution?.file) files.push(path.join(packRoot, manifest.attribution.file));
  for (const notice of manifest.notices ?? []) files.push(path.join(packRoot, notice.file));
  if (manifest.external_cards) files.push(path.join(packRoot, manifest.external_cards));
  for (const mount of manifest.assets ?? []) {
    if (mount.manifest) files.push(path.join(packRoot, mount.manifest));
    files.push(...filesBelow(path.join(packRoot, mount.directory)));
  }
  return [...new Set(files)].sort();
}

function bundledNotices(packRoot, manifest) {
  const notices = [];
  if (manifest.attribution) {
    notices.push({
      kind: "attribution",
      title: `${manifest.attribution.source_name} attribution`,
      file: manifest.attribution.file,
      source_name: manifest.attribution.source_name,
      source_url: manifest.attribution.source_url,
      text: fs.readFileSync(path.join(packRoot, manifest.attribution.file), "utf8").trim(),
    });
  }
  for (const notice of manifest.notices ?? []) {
    notices.push({
      kind: notice.kind,
      title: notice.title,
      file: notice.file,
      text: fs.readFileSync(path.join(packRoot, notice.file), "utf8").trim(),
    });
  }
  return notices;
}

function licenseRecord(packRoot, manifest) {
  return {
    pack_id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    license_identifier: manifest.license,
    license_url: manifest.license_url,
    provenance: manifest.provenance,
    notices: bundledNotices(packRoot, manifest),
  };
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

function assetMountIntegrity(packRoot, mount) {
  const files = [
    ...(mount.manifest ? [path.join(packRoot, mount.manifest)] : []),
    ...filesBelow(path.join(packRoot, mount.directory)),
  ];
  if (files.length === 0) return sha256([mount.mount, "missing-optional-provider"]);
  return sha256(files.flatMap((filePath) => [
    path.relative(packRoot, filePath).split(path.sep).join("/"),
    fs.readFileSync(filePath),
  ]));
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

function validateEntitlements(packId, entitlements, capabilities) {
  if (!entitlements) return;
  assert(entitlements.schema_version === 1, `pack ${packId} entitlements schema_version must be 1`);
  assert(Array.isArray(entitlements.authorities), `pack ${packId} entitlements authorities must be an array`);
  assert(Array.isArray(entitlements.grants), `pack ${packId} entitlements grants must be an array`);
  const authorityIds = new Set();
  for (const authority of entitlements.authorities) {
    assert(typeof authority.id === "string" && /^[a-z0-9][a-z0-9.-]*$/.test(authority.id), `pack ${packId} has invalid entitlement authority id`);
    assert(!authorityIds.has(authority.id), `pack ${packId} has duplicate entitlement authority ${authority.id}`);
    assert(allowedEntitlementAuthorityTypes.has(authority.type), `pack ${packId} authority ${authority.id} has unsupported type ${authority.type}`);
    assert(
      capabilities.some((capability) => capability.id === authority.provider && capability.kind === "entitlements"),
      `pack ${packId} authority ${authority.id} references unavailable entitlement provider ${authority.provider}`,
    );
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

function uniqueRows(packId, resource, rows, key = "id") {
  const ids = new Set();
  for (const row of rows) {
    assert(row && typeof row === "object" && !Array.isArray(row), `rules pack ${packId} ${resource} contains a non-object row`);
    assert(typeof row[key] === "string" && row[key].trim(), `rules pack ${packId} ${resource} row is missing ${key}`);
    assert(!ids.has(row[key]), `rules pack ${packId} ${resource} has duplicate ${row[key]}`);
    ids.add(row[key]);
  }
  return ids;
}

function validateRulesV2Resources(packId, profileId, resources) {
  const profiles = resources.profiles ?? [];
  assert(profiles.length === 1, `rules/2 pack ${packId} must declare exactly one profile`);
  assert(profiles[0].id === profileId, `rules/2 pack ${packId} profile does not match ${profileId}`);
  assert(profiles[0].source_version === "5.2.1", `rules/2 profile ${profileId} must identify SRD 5.2.1`);
  assert(profiles[0].license === "CC-BY-4.0", `rules/2 profile ${profileId} must preserve its license`);
  assert(typeof profiles[0].source_reference === "string" && profiles[0].source_reference.trim(), `rules/2 profile ${profileId} is missing source_reference`);

  const actions = resources.actions ?? [];
  const actionIds = uniqueRows(packId, "actions", actions);
  assert(actionIds.size === requiredSrdActionIds.size, `rules/2 profile ${profileId} must declare all twelve SRD actions`);
  for (const actionId of requiredSrdActionIds) {
    assert(actionIds.has(actionId), `rules/2 profile ${profileId} is missing ${actionId}`);
  }
  for (const action of actions) {
    assert(action.namespace === "srd5.2.1" && action.domain === "rules_action", `action ${action.id} has invalid namespace or domain`);
    assert(["kernel", "projection", "unsupported"].includes(action.support_status), `action ${action.id} has invalid support_status`);
    assert(typeof action.label === "string" && action.label.trim(), `action ${action.id} is missing label`);
    assert(typeof action.source_reference === "string" && action.source_reference.trim(), `action ${action.id} is missing source_reference`);
    assert(Array.isArray(action.aliases) && action.aliases.length > 0, `action ${action.id} must declare aliases`);
    if (action.support_status === "unsupported") {
      assert(action.resolver_kind === "none", `unsupported action ${action.id} cannot name a resolver`);
    } else {
      assert(typeof action.resolver_kind === "string" && action.resolver_kind !== "none", `supported action ${action.id} requires a resolver`);
    }
  }

  const operationIds = uniqueRows(packId, "operations", resources.operations ?? []);
  for (const operation of resources.operations ?? []) {
    assert(["movement", "communication", "object_transfer", "procedure", "cosy_advancement", "interface_meta"].includes(operation.domain), `operation ${operation.id} has invalid domain`);
    assert(Array.isArray(operation.aliases) && operation.aliases.length > 0, `operation ${operation.id} must declare aliases`);
    assert(typeof operation.resolver_kind === "string" && operation.resolver_kind.trim(), `operation ${operation.id} requires a resolver`);
  }

  uniqueRows(packId, "abilities", resources.abilities ?? []);
  const abilityIds = new Set((resources.abilities ?? []).map((ability) => ability.id));
  uniqueRows(packId, "skills", resources.skills ?? []);
  for (const skill of resources.skills ?? []) {
    assert(abilityIds.has(skill.ability), `skill ${skill.id} references unknown ability ${skill.ability}`);
  }
  uniqueRows(packId, "item_roles", resources.item_roles ?? []);
  uniqueRows(packId, "equipment_profiles", resources.equipment_profiles ?? []);
  uniqueRows(packId, "magic_effects", resources.magic_effects ?? []);
  for (const effect of resources.magic_effects ?? []) {
    assert(actionIds.has(effect.rules_action), `magic effect ${effect.id} references unknown action ${effect.rules_action}`);
    assert(effect.resolver_kind === "bounded_magic_v1", `magic effect ${effect.id} has unsupported resolver ${effect.resolver_kind}`);
  }

  const conformanceIds = uniqueRows(packId, "conformance", resources.conformance ?? [], "action_id");
  assert(conformanceIds.size === actionIds.size, `rules/2 profile ${profileId} conformance matrix must cover every action`);
  for (const action of actions) {
    const row = (resources.conformance ?? []).find((candidate) => candidate.action_id === action.id);
    assert(row, `rules/2 profile ${profileId} lacks conformance for ${action.id}`);
    assert(row.support_status === action.support_status && row.resolver_kind === action.resolver_kind, `conformance for ${action.id} disagrees with its registry`);
    assert(Array.isArray(row.legal_targets) && Array.isArray(row.event_outputs), `conformance for ${action.id} lacks targets or event outputs`);
    assert(typeof row.safe_behavior === "string" && row.safe_behavior.trim(), `conformance for ${action.id} lacks safe behavior`);
    assert(typeof row.risky_behavior === "string" && row.risky_behavior.trim(), `conformance for ${action.id} lacks risky behavior`);
    assert(typeof row.cosyworld_delta === "string" && row.cosyworld_delta.trim(), `conformance for ${action.id} lacks its delta`);
    if (action.support_status !== "unsupported") {
      assert(typeof row.replay_fixture === "string" && row.replay_fixture.trim(), `supported action ${action.id} lacks replay coverage`);
    }
  }

  uniqueRows(packId, "legacy_bindings", resources.legacy_bindings ?? [], "legacy_kind");
  for (const binding of resources.legacy_bindings ?? []) {
    assert(["rules_action", "operation", "contextual"].includes(binding.binding_kind), `legacy binding ${binding.legacy_kind} has invalid binding_kind`);
    for (const target of String(binding.binding_id || "").split("|")) {
      const valid = binding.binding_kind === "operation" ? operationIds.has(target) : actionIds.has(target);
      assert(valid, `legacy binding ${binding.legacy_kind} references unknown ${target}`);
    }
  }
}

function validateContributions(pack, rowsByKind, knownActionIds) {
  const allIds = new Set();
  for (const kind of contributionKinds) {
    const rows = rowsByKind[kind] ?? [];
    assert(Array.isArray(rows), `pack ${pack.id} contribution ${kind} must be an array`);
    for (const row of rows) {
      assert(row && typeof row === "object" && !Array.isArray(row), `pack ${pack.id} ${kind} contains a non-object row`);
      assert(typeof row.id === "string" && row.id.startsWith(`${pack.id}:`), `pack ${pack.id} ${kind} id must be namespaced by the pack`);
      assert(!allIds.has(row.id), `pack ${pack.id} has duplicate contribution ${row.id}`);
      allIds.add(row.id);
      assert(typeof row.based_on === "string" && knownActionIds.has(row.based_on), `${row.id} references unsupported action ${row.based_on}`);
      assert(typeof row.source_reference === "string" && row.source_reference.trim(), `${row.id} is missing source_reference`);
      if (kind === "reskins") {
        for (const field of Object.keys(row)) {
          assert(reskinFields.has(field), `reskin ${row.id} contains mechanical field ${field}`);
        }
        assert(typeof row.label === "string" && row.label.trim(), `reskin ${row.id} requires label`);
        assert(row.description !== undefined || row.art !== undefined || row.label !== undefined, `reskin ${row.id} has no presentation delta`);
      } else if (kind === "offers") {
        assert(row.subject && ["location", "feature", "actor", "item", "project"].includes(row.subject.kind), `offer ${row.id} requires a typed subject`);
        assert(typeof row.subject.id === "string" || Number.isSafeInteger(row.subject.id), `offer ${row.id} requires subject.id`);
        assert(row.context && typeof row.context === "object" && !Array.isArray(row.context), `offer ${row.id} requires context predicates`);
        assert(typeof row.label === "string" && row.label.trim(), `offer ${row.id} requires a presentation label`);
      } else if (kind === "variants") {
        assert(/^.+\/\d+$/.test(row.id), `variant ${row.id} must be versioned`);
        assert(row.exact_delta && typeof row.exact_delta === "object" && !Array.isArray(row.exact_delta) && Object.keys(row.exact_delta).length, `variant ${row.id} requires exact_delta`);
        for (const field of ["scope", "rationale", "compatibility", "precedence"]) {
          assert(row[field] && typeof row[field] === "object" || typeof row[field] === "string" && row[field].trim(), `variant ${row.id} requires ${field}`);
        }
        assert(Array.isArray(row.fixtures) && row.fixtures.length > 0, `variant ${row.id} requires fixtures`);
      } else if (kind === "extensions") {
        assert(/^.+\/\d+$/.test(row.id), `extension ${row.id} must be versioned`);
        assert(row.resolver_contract && typeof row.resolver_contract === "object", `extension ${row.id} requires resolver_contract`);
        assert(typeof row.resolver_contract.kind === "string" && row.resolver_contract.kind.startsWith(`${pack.id}.`), `extension ${row.id} resolver kind must be pack-namespaced`);
        assert(typeof row.resolver_contract.input_schema === "string" && typeof row.resolver_contract.output_schema === "string", `extension ${row.id} requires input/output schemas`);
        assert(Array.isArray(row.fixtures) && row.fixtures.length > 0, `extension ${row.id} requires fixtures`);
      }
    }
  }
}

function runContributionSchemaMutationTests() {
  const pack = { id: "fixture.pack" };
  const base = {
    id: "fixture.pack:notes",
    based_on: "srd5.2.1:study",
    label: "Review notes",
    source_reference: "fixture",
  };
  let rejectedMechanicalReskin = false;
  try {
    validateContributions(pack, {
      reskins: [{ ...base, scope: { subject_kind: "location", subject_id: 1 }, compatibility: "cosyworld.srd5/1", dc: 9 }],
    }, requiredSrdActionIds);
  } catch {
    rejectedMechanicalReskin = true;
  }
  assert(rejectedMechanicalReskin, "contribution mutation gate failed to reject a mechanical reskin");

  validateContributions(pack, {
    variants: [{
      ...base,
      id: "fixture.pack:careful-study/1",
      exact_delta: { default_ability: { from: "intelligence", to: "wisdom" } },
      scope: { subject_kind: "location", subject_id: 1 },
      rationale: "The fixture subject is read through tracks rather than text.",
      compatibility: { profile: "cosyworld.srd5/1" },
      precedence: { mode: "explicit", priority: 10 },
      fixtures: ["fixture.pack:careful-study-success"],
    }],
  }, requiredSrdActionIds);
}

runContributionSchemaMutationTests();

const engineVersion = readJson(path.resolve(v2Root, "../package.json")).version;
const world = readJson(path.join(worldDir, "world.json"));
const avatarNaming = loadAvatarNaming(world, worldDir);
const lockPath = path.join(worldDir, "pack.lock.json");
const legacyLockPath = path.join(worldDir, "world.lock.json");
const lock = readJson(
  fs.existsSync(lockPath) ? lockPath : writeLock ? legacyLockPath : lockPath,
);
assert(world.schema_version === 1, "world composition schema_version must be 1");
assert(
  typeof world.rules_profile === "string" && /^[a-z0-9][a-z0-9.-]*\/\d+$/.test(world.rules_profile),
  "world composition must select one versioned rules_profile",
);
assert(lock.lock_version === 1, "world composition pack lock_version must be 1");
assert(lock.world_id === world.id, "pack lock does not belong to the official world");
assert(Array.isArray(world.packs) && world.packs.length > 0, "world composition has no packs");
assert(Array.isArray(lock.packs), "world composition pack lock has no packs array");
assert(new Set(world.packs).size === world.packs.length, "world composition has duplicate pack ids");
const persistenceCompatibility = world.persistence_compatibility ?? null;
if (persistenceCompatibility) {
  assert(
    persistenceCompatibility.schema_version === 1,
    "world persistence compatibility schema_version must be 1",
  );
  assert(
    Array.isArray(persistenceCompatibility.replay_compatible_bundle_hashes),
    "world persistence compatibility must declare replay_compatible_bundle_hashes",
  );
  assert(
    persistenceCompatibility.replay_compatible_bundle_hashes.every(
      (value) => /^sha256:[0-9a-f]{64}$/.test(value),
    ),
    "world persistence compatibility contains an invalid bundle hash",
  );
  assert(
    new Set(persistenceCompatibility.replay_compatible_bundle_hashes).size
      === persistenceCompatibility.replay_compatible_bundle_hashes.length,
    "world persistence compatibility contains duplicate bundle hashes",
  );
}

const lockById = new Map(lock.packs.map((entry) => [entry.id, entry]));
assert(lockById.size === lock.packs.length, "pack lock has duplicate pack ids");

const selectedPacks = [];
for (const packId of world.packs) {
  const locked = lockById.get(packId);
  assert(locked, `world pack ${packId} is missing from the lockfile`);
  assert(locked.source?.path, `world pack ${packId} has no materialized source path`);
  const packRoot = path.resolve(worldDir, locked.source.path);
  const manifest = readJson(path.join(packRoot, "pack.json"));
  validateContentPackManifest(manifest, `${packId}/pack.json`);
  assert(manifest.id === packId, `pack path for ${packId} contains ${manifest.id}`);
  if (!writeLock) {
    assert(manifest.version === locked.version, `pack ${packId} version does not match lockfile`);
  }
  assert(allowedPackKinds.has(manifest.kind), `pack ${packId} has unsupported kind ${manifest.kind}`);
  validateDistribution(packId, manifest.distribution);
  validateEntitlements(packId, manifest.entitlements, manifest.capabilities);
  for (const mount of manifest.assets ?? []) {
    assert(
      manifest.capabilities.some((capability) => capability.id === mount.provider && capability.kind === "assets"),
      `pack ${packId} asset mount ${mount.mount} references unavailable asset provider ${mount.provider}`,
    );
  }
  if (manifest.kind === "rules") {
    assert(supportedRulesAdapters.has(manifest.rules_adapter), `rules pack ${packId} has unsupported adapter ${manifest.rules_adapter}`);
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
    if (manifest.rules_adapter === "cosyworld.rules/2") {
      assert(manifest.rules_profile === world.rules_profile, `rules/2 pack ${packId} must provide selected profile ${world.rules_profile}`);
    } else {
      assert(!manifest.rules_profile, `reference rules/1 pack ${packId} cannot activate a rules profile`);
    }
  } else {
    assert(!manifest.rules, `only rules packs may declare rules resources (${packId})`);
    assert(manifest.rules_profile === world.rules_profile, `pack ${packId} must target selected profile ${world.rules_profile}`);
  }
  const srdDerived = /(?:system reference document|\bsrd\b)/i.test(
    `${manifest.provenance.source_name} ${manifest.attribution?.source_name ?? ""}`,
  );
  if (srdDerived) {
    assert(manifest.license === "CC-BY-4.0", `SRD-derived pack ${packId} must use CC-BY-4.0`);
    assert(manifest.license_url === "https://creativecommons.org/licenses/by/4.0/", `SRD-derived pack ${packId} has the wrong license URL`);
    assert(manifest.attribution?.file, `SRD-derived pack ${packId} must bundle its required attribution`);
    assert(manifest.provenance.modification_notice, `SRD-derived pack ${packId} must identify its modifications`);
    const attributionText = fs.readFileSync(path.join(packRoot, manifest.attribution.file), "utf8");
    assert(attributionText.includes("Wizards of the Coast LLC"), `SRD-derived pack ${packId} attribution is missing the source author`);
    assert(attributionText.includes("creativecommons.org/licenses/by/4.0/legalcode"), `SRD-derived pack ${packId} attribution is missing the CC-BY-4.0 legal-code URL`);
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
    assert(supportedRulesAdapters.get(manifest.rules_adapter)?.has(resource), `rules pack ${packId} declares unknown ${manifest.rules_adapter} resource ${resource}`);
  }
  for (const contribution of Object.keys(manifest.contributions ?? {})) {
    assert(contributionKinds.includes(contribution), `pack ${packId} declares unknown contribution kind ${contribution}`);
    assert(manifest.kind !== "rules", `base rules pack ${packId} cannot contribute an implicit override`);
  }
  const integrity = packIntegrity(packRoot, manifest);
  if (!writeLock) {
    assert(locked.integrity === integrity, `pack ${packId} integrity changed; run npm run v2:worldpack:lock`);
  }
  selectedPacks.push({ locked, manifest, packRoot, integrity });
}
assert(lock.packs.length === selectedPacks.length, "pack lock contains packs not selected by world.json");

const resolved = resolveContentPackGraph(
  selectedPacks.map((pack) => pack.manifest),
  engineVersion,
);
const selectedById = new Map(selectedPacks.map((pack) => [pack.manifest.id, pack]));
const packs = resolved.ordered.map((manifest) => selectedById.get(manifest.id));
const activeProfilePacks = packs.filter(
  ({ manifest }) => manifest.kind === "rules" && manifest.rules_profile === world.rules_profile,
);
assert(activeProfilePacks.length === 1, `world must contain exactly one provider for ${world.rules_profile}`);
const nextLock = {
  lock_version: 1,
  manifest_contract: CONTENT_PACK_CONTRACT,
  canonical_id_mapping_version: CANONICAL_ID_MAPPING_VERSION,
  world_id: world.id,
  dependency_order: packs.map((pack) => pack.manifest.id),
  packs: packs.map(({ locked, manifest, integrity }) => ({
    id: manifest.id,
    version: manifest.version,
    source: locked.source,
    integrity,
    dependencies: manifest.dependencies,
    dependency_closure: resolved.dependencyClosure.get(manifest.id),
    capabilities: manifest.capabilities,
    license: manifest.license,
    license_url: manifest.license_url,
    provenance: manifest.provenance,
  })),
  license_records: packs.map(({ manifest, packRoot }) => licenseRecord(packRoot, manifest)),
};

if (writeLock) {
  fs.writeFileSync(lockPath, json(nextLock));
} else {
  assert(
    json(lock) === json(nextLock),
    "pack.lock.json metadata is stale; run npm run v2:worldpack:lock",
  );
}

const resources = Object.fromEntries(Object.keys(resourceFiles).map((key) => [key, []]));
const externalCards = [];
const assets = [];
const ruleBundles = [];
const contributionBundles = [];
const attributions = [];
const licenseRecords = [];
const characterCreationBundles = [];
const resourceCountsByPack = new Map();
const selectedPackIds = new Set(packs.map((pack) => pack.manifest.id));
for (const pack of packs) {
  const resourceCounts = Object.fromEntries(Object.keys(resourceFiles).map((key) => [key, 0]));
  resourceCounts.external_cards = 0;
  resourceCounts.assets = 0;
  resourceCounts.rules = 0;
  resourceCounts.character_creation = 0;
  for (const kind of contributionKinds) resourceCounts[kind] = 0;
  resourceCountsByPack.set(pack.manifest.id, resourceCounts);
  licenseRecords.push(licenseRecord(pack.packRoot, pack.manifest));
  for (const [resource, relativePath] of Object.entries(pack.manifest.resources ?? {})) {
    assert(resource in resources, `pack ${pack.manifest.id} declares unknown resource ${resource}`);
    const rows = readJson(path.join(pack.packRoot, relativePath));
    assert(Array.isArray(rows), `pack ${pack.manifest.id} resource ${resource} must be an array`);
    for (const row of rows) {
      assert(row && typeof row === "object" && !Array.isArray(row), `pack ${pack.manifest.id} resource ${resource} contains a non-object row`);
      validateWorldEntityResource(pack.manifest.id, resource, row);
      assert(!row.pack_id || row.pack_id === pack.manifest.id, `pack ${pack.manifest.id} resource ${resource} contains conflicting pack_id ${row.pack_id}`);
      const { requires_packs: requiresPacks = [], ...compiledRow } = row;
      assert(Array.isArray(requiresPacks), `pack ${pack.manifest.id} resource ${resource} requires_packs must be an array`);
      assert(new Set(requiresPacks).size === requiresPacks.length, `pack ${pack.manifest.id} resource ${resource} repeats a requires_packs id`);
      const dependencyIds = new Set(pack.manifest.dependencies.map((dependency) => dependency.id));
      for (const requiredPackId of requiresPacks) {
        assert(
          typeof requiredPackId === "string" && dependencyIds.has(requiredPackId),
          `pack ${pack.manifest.id} resource ${resource} condition references undeclared dependency ${requiredPackId}`,
        );
      }
      if (requiresPacks.every((requiredPackId) => selectedPackIds.has(requiredPackId))) {
        resources[resource].push({ ...compiledRow, pack_id: pack.manifest.id });
        resourceCounts[resource] += 1;
      }
    }
  }
  if (pack.manifest.rules) {
    const ruleResources = {};
    for (const [resource, relativePath] of Object.entries(pack.manifest.rules)) {
      const rows = readJson(path.join(pack.packRoot, relativePath));
      assert(Array.isArray(rows), `rules pack ${pack.manifest.id} resource ${resource} must be an array`);
      ruleResources[resource] = rows;
    }
    if (pack.manifest.rules_adapter === "cosyworld.rules/2") {
      validateRulesV2Resources(pack.manifest.id, pack.manifest.rules_profile, ruleResources);
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
  if (pack.manifest.contributions) {
    const rowsByKind = {};
    for (const kind of contributionKinds) {
      const relativePath = pack.manifest.contributions[kind];
      rowsByKind[kind] = relativePath ? readJson(path.join(pack.packRoot, relativePath)) : [];
      resourceCounts[kind] = rowsByKind[kind].length;
    }
    validateContributions(pack.manifest, rowsByKind, requiredSrdActionIds);
    contributionBundles.push({
      pack_id: pack.manifest.id,
      pack_version: pack.manifest.version,
      rules_profile: pack.manifest.rules_profile,
      ...rowsByKind,
    });
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
      pack_version: pack.manifest.version,
      pack_integrity: pack.integrity,
      provider: mount.provider,
      mount: mount.mount,
      root: relativeRoot,
      directory: mount.directory,
      public_prefix: mount.public_prefix,
      content_hash: assetMountIntegrity(pack.packRoot, mount),
      optional: Boolean(mount.optional),
      fallback: mount.fallback ?? null,
    });
    resourceCounts.assets += 1;
  }
}

const contributionIdentityOwners = new Map();
const contributionSlots = new Map();
for (const bundle of contributionBundles) {
  for (const kind of contributionKinds) {
    for (const contribution of bundle[kind]) {
      const identity = `${kind}:${contribution.id}`;
      assert(!contributionIdentityOwners.has(identity), `contribution ${contribution.id} is declared by both ${contributionIdentityOwners.get(identity)} and ${bundle.pack_id}`);
      contributionIdentityOwners.set(identity, bundle.pack_id);
      const subject = contribution.scope ?? contribution.subject ?? {};
      const slot = kind === "extensions"
        ? `extension:${contribution.resolver_contract?.kind}`
        : `${kind}:${contribution.based_on}:${subject.kind ?? subject.subject_kind ?? JSON.stringify(subject)}:${subject.id ?? subject.subject_id ?? "global"}`;
      const prior = contributionSlots.get(slot);
      if (prior) {
        const composes = Array.isArray(contribution.compose_with) && contribution.compose_with.includes(prior.id)
          && Array.isArray(prior.row.compose_with) && prior.row.compose_with.includes(contribution.id);
        assert(composes, `contributions ${prior.id} and ${contribution.id} conflict at ${slot}; load order is not precedence`);
      }
      contributionSlots.set(slot, { id: contribution.id, row: contribution });
    }
  }
}
const activeRulesExtensions = contributionBundles.flatMap((bundle) => bundle.extensions.map((row) => row.id)).sort();
const activeRulesVariants = contributionBundles.flatMap((bundle) => bundle.variants.map((row) => row.id)).sort();
const modifiedMaterial = ruleBundles.flatMap((bundle) => {
  if (bundle.adapter !== "cosyworld.rules/2") return [];
  const profile = bundle.resources.profiles?.[0];
  const inherited = {
    pack_id: bundle.pack_id,
    rules_profile: profile?.id,
    source_document: profile?.source_document,
    source_version: profile?.source_version,
    source_pack: profile?.source_pack,
    license: profile?.license,
    attribution_pack: bundle.pack_id,
    import_transform: profile?.import_transform,
    modification_status: "modified",
  };
  const rows = [{ resource_type: "profile", id: profile?.id, source_reference: profile?.source_reference, changes: profile?.cosyworld_deltas ?? [] }];
  for (const [resourceType, resources] of [
    ["action", bundle.resources.actions ?? []],
    ["operation", bundle.resources.operations ?? []],
    ["equipment_profile", bundle.resources.equipment_profiles ?? []],
    ["magic_effect", bundle.resources.magic_effects ?? []],
  ]) {
    for (const resource of resources) {
      if (resource.modified !== true) continue;
      rows.push({
        resource_type: resourceType,
        id: resource.id,
        source_reference: resource.source_reference,
        changes: resource.cosyworld_delta ? [resource.cosyworld_delta] : ["Adapted to the bounded CosyWorld resolver contract."],
      });
    }
  }
  return rows.map((row) => ({ ...inherited, ...row }));
});

const packSummary = packs.map(({ locked, manifest, integrity }) => ({
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  version: manifest.version,
  kind: manifest.kind,
  license: manifest.license,
  license_url: manifest.license_url,
  engine: manifest.engine,
  capabilities: manifest.capabilities,
  dependencies: manifest.dependencies.map((dependency) => dependency.id),
  dependency_requirements: manifest.dependencies,
  dependency_closure: resolved.dependencyClosure.get(manifest.id),
  default_ruleset: manifest.default_ruleset ?? null,
  entry_points: manifest.entry_points ?? [],
  provenance: manifest.provenance,
  resource_counts: resourceCountsByPack.get(manifest.id),
  ...(manifest.distribution ? { distribution: manifest.distribution } : {}),
  ...(manifest.entitlements ? { entitlements: manifest.entitlements } : {}),
  ...(manifest.rules_adapter ? { rules_adapter: manifest.rules_adapter } : {}),
  ...(manifest.rules_namespace ? { rules_namespace: manifest.rules_namespace } : {}),
  ...(manifest.extensions ? { extensions: manifest.extensions } : {}),
  ...(manifest.rules_profile ? { rules_profile: manifest.rules_profile } : {}),
  source: locked.source,
  integrity,
}));
const contentReferences = buildContentReferenceMapping(
  collectContentReferenceCandidates({
    resources,
    packs: packSummary,
    externalCards,
    ruleBundles,
    characterCreationBundles,
  }),
  CANONICAL_ID_MAPPING_VERSION,
);
const {
  persistence_compatibility: _persistenceCompatibility,
  avatar_naming: _avatarNamingSource,
  ...worldIdentity
} = world;
const bundleHash = sha256([
  json(worldIdentity),
  ...(avatarNaming ? [json(avatarNaming)] : []),
  json(packSummary),
  ...Object.values(resources).map(json),
  json(externalCards),
  json(assets),
  json(ruleBundles),
  json(contributionBundles),
  json(activeRulesVariants),
  json(activeRulesExtensions),
  json(attributions),
  json(licenseRecords),
  json(modifiedMaterial),
  json(characterCreationBundles),
  json(contentReferences),
]);
assert(
  !persistenceCompatibility?.replay_compatible_bundle_hashes.includes(bundleHash),
  "world persistence compatibility must not list the active bundle hash",
);
const manifest = {
  schema_version: 2,
  pack_contract: CONTENT_PACK_CONTRACT,
  canonical_id_mapping_version: CANONICAL_ID_MAPPING_VERSION,
  id: world.id,
  name: world.name,
  version: world.version,
  description: world.description,
  entry_location: world.entry_location,
  ...(world.entry_grant_id ? { entry_grant_id: world.entry_grant_id } : {}),
  ...(persistenceCompatibility ? { persistence_compatibility: persistenceCompatibility } : {}),
  rules_profile: world.rules_profile,
  active_rules_variants: activeRulesVariants,
  active_rules_extensions: activeRulesExtensions,
  ...(avatarNaming ? { avatar_naming: avatarNaming } : {}),
  bundle_hash: bundleHash,
  packs: packSummary,
  files: resourceFiles,
  external_cards: "external_cards.json",
  assets: "assets.json",
  rules: "rules.json",
  contributions: "contributions.json",
  attributions: "attributions.json",
  licenses: "licenses.json",
  modified_material: "modified-material.json",
  character_creation: "character_creation.json",
  content_references: "content_refs.json",
  registry: "registry.json",
};

const registry = {
  schema_version: 1,
  manifest,
  resources,
  external_cards: externalCards,
  assets,
  rules: ruleBundles,
  contributions: contributionBundles,
  attributions,
  licenses: licenseRecords,
  modified_material: modifiedMaterial,
  character_creation: characterCreationBundles,
  content_references: contentReferences,
};

const outputs = new Map([
  ["worldpack.json", json(manifest)],
  ["registry.json", json(registry)],
  ["external_cards.json", json(externalCards)],
  ["assets.json", json(assets)],
  ["rules.json", json(ruleBundles)],
  ["contributions.json", json(contributionBundles)],
  ["attributions.json", json(attributions)],
  ["licenses.json", json(licenseRecords)],
  ["modified-material.json", json(modifiedMaterial)],
  ["character_creation.json", json(characterCreationBundles)],
  ["content_refs.json", json(contentReferences)],
  ...Object.entries(resourceFiles).map(([resource, fileName]) => [fileName, json(resources[resource])]),
]);
const artifactDigest = sha256(
  [...outputs].flatMap(([fileName, contents]) => [fileName, contents]),
);

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
if (printArtifactDigest) console.log(`artifact digest ${artifactDigest}`);
