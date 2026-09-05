import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_ID_MAPPING_VERSION,
  CONTENT_PACK_CONTRACT,
  packAcceptsRulesProfile,
  packDeclaresRuleset,
  resolveContentPackGraph,
  rulesContextValidationErrors,
  validateWorldEntityResource,
} from "./content-pack-contract.mjs";
import {
  buildContentReferenceMapping,
  collectContentReferenceCandidates,
  parseCanonicalContentReference,
} from "./content-references.mjs";
import { avatarNamingValidationErrors } from "./avatar-naming-schema.mjs";
import { actorModelBindingValidationErrors } from "./actor-model-binding-schema.mjs";
import { avatarLevelSchemaValidationErrors } from "./avatar-level-schema.mjs";
import { buildingArchetypeValidationErrors } from "./building-archetype-schema.mjs";
import { lootTableValidationErrors } from "./loot-table-schema.mjs";
import { lanternClockEffectValidationErrors } from "./lantern-clock-contract.mjs";
import { naturalAffordanceValidationErrors } from "./natural-affordance-schema.mjs";
import { firstTaleValidationErrors } from "./first-tale-schema.mjs";
import { versionedRecipeValidationErrors } from "./recipe-schema.mjs";
import {
  generationPolicyForPack,
  validateCompiledGenerationPolicies,
  worldpackMediaRegistry,
} from "./world-generation-policy.mjs";
import { roomFeatureSchemaValidationErrors } from "./room-feature-schema.mjs";
import {
  routeDirectionValidationErrors,
  routeDiscoveryValidationErrors,
} from "./route-direction.mjs";
import { progressionSafetyWorldValidationErrors } from "./progression-safety-schema.mjs";
import { spatialSceneValidationErrors } from "./spatial-scene-schema.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const reportText = args.includes("--report");
const reportJson = args.includes("--report-json");
const contentRootArg = args.find((arg) => !arg.startsWith("--"));
const contentRoot = path.resolve(contentRootArg ?? path.join(scriptDir, "../content/official"));
const engineVersion = fs
  .readFileSync(path.resolve(scriptDir, "../content-engine-version.txt"), "utf8")
  .trim();

const expectedFiles = {
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
const environmentRegisterFields = new Set(["description", "look", "search"]);
const bannedEnvironmentTells = [
  ["as if", /\bas if\b/i],
  ["seems to", /\bseems to\b/i],
  ["meant for", /\bmeant for\b/i],
];
const secondPersonPattern = /\b(?:you|your|yours|yourself)\b/i;
const objectSentimentPattern = /\b(?:pleased|approves|approving|delights|remembers)\b/i;
const allowedSentenceShelves = new Set([
  "quiet-wing",
  "great-library",
  "restricted",
  "drowned",
  "hearth",
]);
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
const allowedItemRoles = new Set(["generic", "consumable", "weapon", "skill_charm", "spell", "container", "tool", "relic"]);
const allowedItemCapabilities = new Set(["camp_shelter"]);
const allowedItemSizes = new Set(["tiny", "small", "medium", "large"]);
const routableJobContributionActionKinds = new Set([
  "work",
  "help",
  "check",
  "study",
  "use_item",
]);

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function readJson(fileName) {
  const filePath = path.join(contentRoot, fileName);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${fileName}: ${error.message}`);
    return null;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function asArray(label, value) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
    return [];
  }
  return value;
}

function idSet(label, rows, idOf) {
  const ids = new Set();
  for (const row of rows) {
    const id = idOf(row);
    if (id === undefined || id === null || id === "" || ids.has(id)) {
      fail(`${label} has missing or duplicate id ${String(id)}`);
      continue;
    }
    ids.add(id);
  }
  return ids;
}

function has(set, id) {
  return set.has(id);
}

function validateRequiredStrings(label, row, fields) {
  for (const field of fields) {
    if (!isNonEmptyString(row[field])) {
      fail(`${label} ${String(row.id ?? row.card_id ?? row.location_id ?? "")} is missing ${field}`);
    }
  }
}

function visitStrings(value, visitor, trail = []) {
  if (typeof value === "string") {
    visitor(value, trail);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitStrings(entry, visitor, [...trail, index]));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    visitStrings(entry, visitor, [...trail, key]);
  }
}

function contentRowLabel(fileName, row, index, trail) {
  const rowId = row.id ?? row.card_id ?? row.location_id ?? index;
  return `${fileName} row ${String(rowId)} ${trail.join(".")}`;
}

function validateWritingRegister(contentCollections) {
  for (const [collection, rows] of Object.entries(contentCollections)) {
    if (collection === "actors" || collection === "cards" || collection === "sentences") continue;
    const fileName = expectedFiles[collection];
    rows.forEach((row, index) => {
      visitStrings(row, (value, trail) => {
        const label = contentRowLabel(fileName, row, index, trail);
        const field = trail.at(-1);
        if (environmentRegisterFields.has(field)) {
          for (const [tell, pattern] of bannedEnvironmentTells) {
            if (pattern.test(value)) fail(`${label} uses banned environment tell "${tell}"`);
          }
        }
        const isUseText = trail.at(-1) === "text" && trail.at(-3) === "uses";
        if (secondPersonPattern.test(value) && !isUseText) {
          fail(`${label} uses second person outside the sentences register`);
        }
      });
    });
  }

  for (const [index, location] of contentCollections.locations.entries()) {
    for (const [memoryIndex, memory] of (location.memory ?? []).entries()) {
      const label = contentRowLabel("locations.json", location, index, ["memory", memoryIndex]);
      for (const [tell, pattern] of bannedEnvironmentTells) {
        if (pattern.test(memory)) fail(`${label} uses banned environment tell "${tell}"`);
      }
    }
  }

  for (const feature of contentCollections.room_features) {
    for (const use of feature.uses ?? []) {
      if (objectSentimentPattern.test(use.text ?? "")) {
        fail(
          `room_features.json location ${feature.location_id} feature ${feature.key} item ${use.item_id} use text assigns sentiment to an object`,
        );
      }
    }
  }
}

function reportWritingRegisterAdvisories({ actors, cards, locations }) {
  const formulaByPack = new Map();
  const formulaPattern = /\b(?:is|are)\s+[^.!?]*,\s+[^.!?]*,\s+and\b/i;
  for (const entry of [
    ...actors.map((actor) => ({ pack_id: actor.pack_id, text: actor.description })),
    ...cards.map((card) => ({ pack_id: card.pack_id, text: card.blurb })),
    ...locations.map((location) => ({ pack_id: location.pack_id, text: location.persona })),
  ]) {
    if (!formulaPattern.test(entry.text ?? "")) continue;
    formulaByPack.set(entry.pack_id, (formulaByPack.get(entry.pack_id) ?? 0) + 1);
  }
  for (const [packId, count] of formulaByPack) {
    if (count > 4) {
      warn(`writing register advisory: pack ${packId} uses the "X is A, B, and ..." formula ${count} times (threshold 4)`);
    }
  }

  const indexPath = path.join(scriptDir, "../orchestrator-rust/src/index.html");
  let indexSource = "";
  try {
    indexSource = fs.readFileSync(indexPath, "utf8");
  } catch (error) {
    warn(`writing register advisory: could not inspect browser chrome: ${error.message}`);
    return;
  }
  const longChrome = [];
  const indexLines = indexSource.split("\n");
  for (const [index, line] of indexLines.entries()) {
    const assignment = line.match(/\bmodalSummary:(.*)$/);
    if (!assignment) continue;
    // Required authority and input-boundary disclosures may opt out explicitly.
    if (indexLines[index - 1]?.includes("writing-register: allow-long-modal-summary")) continue;
    const literal = assignment[1].match(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`]*)`/);
    if (literal) {
      const text = (literal[1] ?? literal[2] ?? literal[3])
        .replace(/\$\{[^}]+\}/g, "value")
        .trim();
      const words = text.split(/\s+/).filter(Boolean).length;
      if (words > 8) longChrome.push({ line: index + 1, words, text });
    }
  }
  if (longChrome.length) {
    const examples = longChrome
      .slice(0, 8)
      .map((entry) => `${entry.line} (${entry.words} words): ${entry.text}`)
      .join(" | ");
    warn(`writing register advisory: ${longChrome.length} static modal summaries exceed 8 words; ${examples}`);
  }
}

function reportGenreAdvisories(content) {
  // Case-sensitive: gothic diction is a lowercase phenomenon; capitalized
  // matches are proper nouns (the Dark Abyss is a place, not a mood).
  const gothicVocabulary = [
    ["whisper", /\bwhisper\b/],
    ["eternal", /\beternal\b/],
    ["void", /\bvoid\b/],
    ["abyss", /\babyss\b/],
    ["veil", /\bveil\b/],
    ["hush", /\bhush\b/],
    ["sacred", /\bsacred\b/],
  ];
  const kernelVocabulary = [
    ["journal", /\bjournal\b/i],
    ["replay", /\breplay\b/i],
    ["seed", /\bseed\b/i],
    ["tick", /\btick\b/i],
    ["deterministic", /\bdeterministic\b/i],
  ];

  // Both advisories scan prose fields only: enum/id fields (rarity "seed",
  // source names) and steering fields (persona) are not player-facing prose.
  const proseFields = new Set([
    ...environmentRegisterFields,
    "memory",
    "blurb",
    "premise",
    "stakes",
    "consequence",
    "discovery_text",
    "text",
  ]);
  // Accepted existing lines; the words stay watched in new content.
  const advisoryAllowlist = new Set([
    "Tall shelves and a deep hush.",
    "Stone arches and a deep hush.",
  ]);

  for (const [collection, rows] of Object.entries(content)) {
    if (collection === "sentences") continue;
    const fileName = expectedFiles[collection];
    rows.forEach((row, index) => {
      visitStrings(row, (value, trail) => {
        const field = trail.at(-1);
        const inProse =
          proseFields.has(field) || (typeof field === "number" && proseFields.has(trail.at(-2)));
        if (!inProse || advisoryAllowlist.has(value.trim())) return;
        const label = contentRowLabel(fileName, row, index, trail);
        for (const [word, pattern] of gothicVocabulary) {
          if (pattern.test(value)) {
            warn(`genre advisory: ${label} uses gothic vocabulary "${word}" in prose — horror in the content, whimsy in the diction (canon rule 4)`);
          }
        }
        for (const [word, pattern] of kernelVocabulary) {
          if (pattern.test(value)) {
            warn(`genre advisory: ${label} uses kernel vocabulary "${word}" outside sentences.json — the machinery is the mythology, not the lore (canon rule 5)`);
          }
        }
      });
    });
  }
}

function jobRewardLabel(reward) {
  if (isNonEmptyString(reward)) {
    return reward;
  }
  if (isObject(reward) && isNonEmptyString(reward.label)) {
    return reward.label;
  }
  return "";
}

function jobRewardOrbs(reward) {
  if (isObject(reward) && Number.isInteger(reward.orbs)) {
    return reward.orbs;
  }
  return 0;
}

function validateJobReward(job) {
  if (!jobRewardLabel(job.reward)) {
    fail(`job ${job.id} is missing reward`);
    return;
  }
  if (isObject(job.reward) && job.reward.orbs !== undefined && (!Number.isInteger(job.reward.orbs) || job.reward.orbs < 0)) {
    fail(`job ${job.id} has invalid reward orbs`);
  }
}

function placementTargetKind(kind) {
  return kind === "actor_hand" || kind === "location_floor" ? kind : null;
}

const manifest = readJson("worldpack.json");
if (manifest?.files?.actor_model_bindings === "actor_model_bindings.json") {
  expectedFiles.actor_model_bindings = "actor_model_bindings.json";
}
if (manifest?.files?.avatar_level_tracks === "avatar_level_tracks.json") {
  expectedFiles.avatar_level_tracks = "avatar_level_tracks.json";
}
if (manifest?.files?.spatial_scenes === "spatial_scenes.json") {
  expectedFiles.spatial_scenes = "spatial_scenes.json";
}
if (!isObject(manifest)) {
  throw new Error("worldpack.json could not be parsed");
}
const registry = readJson("registry.json");
if (!isObject(registry) || registry.schema_version !== 1) {
  fail("registry.json must be a schema-version-1 object");
}
if (JSON.stringify(registry?.manifest) !== JSON.stringify(manifest)) {
  fail("registry.json manifest does not match worldpack.json");
}

validateRequiredStrings("worldpack manifest", manifest, ["id", "name", "description"]);
if (manifest.schema_version !== 2) {
  fail("worldpack manifest schema_version must be 2");
}
if (manifest.pack_contract !== CONTENT_PACK_CONTRACT) {
  fail(`worldpack manifest pack_contract must be ${CONTENT_PACK_CONTRACT}`);
}
if (manifest.canonical_id_mapping_version !== CANONICAL_ID_MAPPING_VERSION) {
  fail(
    `worldpack manifest canonical_id_mapping_version must be ${CANONICAL_ID_MAPPING_VERSION}`,
  );
}
if (!Number.isInteger(manifest.version) || manifest.version <= 0) {
  fail("worldpack manifest version must be a positive integer");
}
if (!isNonEmptyString(manifest.rules_profile) || !/^[a-z0-9][a-z0-9.-]*\/\d+$/.test(manifest.rules_profile)) {
  fail("worldpack manifest is missing a versioned rules_profile");
}
if (!isNonEmptyString(manifest.bundle_hash) || !/^sha256:[0-9a-f]{64}$/.test(manifest.bundle_hash)) {
  fail("worldpack manifest has an invalid bundle_hash");
}
const packs = asArray("worldpack manifest packs", manifest.packs);
const packIds = idSet("worldpack manifest packs", packs, (pack) => pack.id);
const worldBearingPacks = packs.filter((pack) => ["world", "campaign"].includes(pack.kind));
if (worldBearingPacks.length > 0 && !isNonEmptyString(manifest.entry_location)) {
  fail("world-bearing worldpack manifest is missing entry_location");
}
if (worldBearingPacks.length === 0 && manifest.entry_location !== undefined) {
  fail("services-only worldpack manifest must not invent an entry_location");
}
if (manifest.avatar_naming !== undefined) {
  for (const error of avatarNamingValidationErrors(manifest.avatar_naming, "worldpack avatar_naming")) {
    fail(error);
  }
}
if (manifest.first_tale !== undefined) {
  for (const error of firstTaleValidationErrors(
    manifest.first_tale,
    "worldpack first_tale",
  )) {
    fail(error);
  }
}
const entitlementGrants = new Map();
for (const pack of packs) {
  validateRequiredStrings("worldpack pack", pack, ["name", "description", "version", "kind", "license", "integrity"]);
  if (pack.rules_profile !== undefined && pack.rules_compatibility !== undefined) {
    fail(`pack ${pack.id} combines legacy rules_profile with rules_compatibility`);
  }
  const buildingArchetypes = pack.extensions?.["x-cosyworld-building-archetypes"];
  if (buildingArchetypes !== undefined) {
    for (const error of buildingArchetypeValidationErrors(
      buildingArchetypes,
      `pack ${pack.id} x-cosyworld-building-archetypes`,
    )) {
      fail(error);
    }
  }
  const lootTables = pack.extensions?.["x-cosyworld-loot-tables"];
  if (lootTables !== undefined) {
    for (const error of lootTableValidationErrors(
      lootTables,
      `pack ${pack.id} x-cosyworld-loot-tables`,
    )) {
      fail(error);
    }
    for (const table of lootTables.tables ?? []) {
      if (!table.id.startsWith(`${pack.id}:loot/`)) {
        fail(`pack ${pack.id} owns foreign loot table ${table.id}`);
      }
    }
  }
  for (const error of rulesContextValidationErrors(pack, `pack ${pack.id}`)) {
    fail(error);
  }
  if (!allowedPackKinds.has(pack.kind)) {
    fail(`worldpack pack ${pack.id} has unsupported kind ${pack.kind}`);
  }
  if (pack.kind === "rules") {
    if (!supportedRulesAdapters.has(pack.rules_adapter)) {
      fail(`rules pack ${pack.id} has unsupported adapter ${pack.rules_adapter}`);
    }
    if (!isNonEmptyString(pack.rules_namespace) || !/^[a-z0-9][a-z0-9.-]*$/.test(pack.rules_namespace)) {
      fail(`rules pack ${pack.id} has an invalid rules_namespace`);
    }
    if (pack.rules_adapter === "cosyworld.rules/2" && pack.rules_profile !== manifest.rules_profile) {
      fail(`rules/2 pack ${pack.id} provides ${pack.rules_profile ?? "no profile"} but world selects ${manifest.rules_profile}`);
    }
    if (pack.rules_adapter === "cosyworld.rules/1" && pack.rules_profile !== undefined) {
      fail(`reference rules/1 pack ${pack.id} cannot activate a rules profile`);
    }
    if (pack.rules_adapter === "cosyworld.rules/1" && pack.rules_compatibility !== undefined) {
      fail(`reference rules/1 pack ${pack.id} cannot declare rules compatibility`);
    }
  } else if (!packAcceptsRulesProfile(pack, manifest.rules_profile)) {
    fail(
      `pack ${pack.id} is incompatible with selected profile ${manifest.rules_profile}; `
      + `accepted profiles: ${JSON.stringify(pack.rules_compatibility?.profiles ?? (pack.rules_profile ? [pack.rules_profile] : []))}`,
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(pack.integrity ?? "")) {
    fail(`worldpack pack ${pack.id} has an invalid integrity hash`);
  }
  if (!Array.isArray(pack.dependencies) || !isObject(pack.resource_counts)) {
    fail(`worldpack pack ${pack.id} is missing dependencies or resource_counts`);
  }
  if (
    !isNonEmptyString(pack.engine)
    || !Array.isArray(pack.capabilities)
    || !Array.isArray(pack.dependency_requirements)
    || !Array.isArray(pack.dependency_closure)
    || !Array.isArray(pack.entry_points)
    || !isObject(pack.provenance)
    || !isNonEmptyString(pack.license_url)
    || !isNonEmptyString(pack.provenance.author)
    || !isNonEmptyString(pack.provenance.source_name)
    || !isNonEmptyString(pack.provenance.source_url)
  ) {
    fail(`worldpack pack ${pack.id} is missing Manifest v1 contract metadata`);
  }
  if (pack.distribution) {
    if (
      pack.distribution.media_type !== "application/vnd.cosyworld.pack+json"
      || pack.distribution.canonicalization !== "jcs"
      || !["content-addressed", "arweave"].includes(pack.distribution.permanence)
    ) {
      fail(`worldpack pack ${pack.id} has invalid distribution metadata`);
    }
    if (pack.distribution.permanent_uri !== undefined && !/^ar:\/\/[A-Za-z0-9_-]{43}$/.test(pack.distribution.permanent_uri)) {
      fail(`worldpack pack ${pack.id} has invalid Arweave permanent_uri`);
    }
  }
  if (pack.entitlements) {
    const authorities = asArray(`pack ${pack.id} entitlement authorities`, pack.entitlements.authorities);
    const grants = asArray(`pack ${pack.id} entitlement grants`, pack.entitlements.grants);
    const authorityIds = idSet(`pack ${pack.id} entitlement authorities`, authorities, (authority) => authority.id);
    if (pack.entitlements.schema_version !== 1) fail(`pack ${pack.id} entitlements schema_version must be 1`);
    for (const authority of authorities) {
      if (!allowedEntitlementAuthorityTypes.has(authority.type)) fail(`pack ${pack.id} authority ${authority.id} has invalid type`);
      if (!pack.capabilities.some((capability) => capability.id === authority.provider && capability.kind === "entitlements")) {
        fail(`pack ${pack.id} authority ${authority.id} has unavailable provider ${authority.provider}`);
      }
      if (authority.type === "solana_collection" && (!isNonEmptyString(authority.collection_address) || !isNonEmptyString(authority.network) || !isNonEmptyString(authority.standard))) {
        fail(`pack ${pack.id} authority ${authority.id} has incomplete Solana collection metadata`);
      }
      if (authority.type === "signed_set" && (authority.algorithm !== "ed25519" || !isNonEmptyString(authority.public_key))) {
        fail(`pack ${pack.id} authority ${authority.id} has invalid signed-set metadata`);
      }
    }
    for (const grant of grants) {
      if (!isNonEmptyString(grant.id) || !grant.id.startsWith(`${pack.id}:`) || entitlementGrants.has(grant.id)) {
        fail(`pack ${pack.id} has invalid or duplicate grant ${grant.id}`);
        continue;
      }
      if (!has(authorityIds, grant.authority_id)) fail(`pack ${pack.id} grant ${grant.id} references unknown authority`);
      entitlementGrants.set(grant.id, { ...grant, pack_id: pack.id });
    }
  }
}

const mountedLootTableIds = new Set();
const mountedLootTemplateIds = new Set();
const mountedLootDeliveryTags = new Set();
const mountedBuildingCapabilities = new Set();
const mountedBuildingRecipeTags = new Set();
const mountedBuildingArchetypes = [];
// Items a discovery slot may reveal. These are authored unplaced -- the kernel's
// reveal requires holder 0 and location 0 -- so they are the only items allowed
// to name no location. Anything else unplaced is a broken reference.
const discoveryHiddenItemIds = new Set();
for (const pack of packs) {
  const discovery = pack.extensions?.["x-cosyworld-discovery-slots"];
  if (!discovery) continue;
  const collect = (targetKind, resultIds) => {
    if (targetKind !== "item") return;
    for (const resultId of resultIds ?? []) {
      const localId = String(resultId).split(":").at(-1)?.split("/").at(-1);
      const numeric = Number(localId);
      if (Number.isInteger(numeric)) discoveryHiddenItemIds.add(numeric);
    }
  };
  for (const slot of discovery.slots ?? []) {
    collect(slot.target_kind, slot.stocking?.result_ids);
  }
  for (const table of discovery.stocking_tables ?? []) {
    for (const row of table.rows ?? []) collect(table.target_kind, row.result_ids);
  }
}

for (const pack of packs) {
  for (const template of pack.extensions?.["x-cosyworld-loot-tables"]?.item_templates ?? []) {
    if (mountedLootTemplateIds.has(template.id)) {
      fail(`loot item template ${template.id} is mounted more than once`);
    }
    mountedLootTemplateIds.add(template.id);
    for (const tag of template.delivery_tags ?? []) mountedLootDeliveryTags.add(tag);
  }
  for (const table of pack.extensions?.["x-cosyworld-loot-tables"]?.tables ?? []) {
    if (mountedLootTableIds.has(table.id)) {
      fail(`loot table ${table.id} is mounted more than once`);
    }
    mountedLootTableIds.add(table.id);
  }
}
for (const pack of packs) {
  for (
    const archetype
    of pack.extensions?.["x-cosyworld-building-archetypes"]?.archetypes ?? []
  ) {
    mountedBuildingArchetypes.push(archetype);
    for (const capability of archetype.capabilities ?? []) {
      mountedBuildingCapabilities.add(capability);
    }
    for (const tag of archetype.recipe_tags ?? []) {
      mountedBuildingRecipeTags.add(tag);
    }
    if (
      archetype.loot_table_id !== undefined
      && !mountedLootTableIds.has(archetype.loot_table_id)
    ) {
      fail(`building ${archetype.id} references missing loot table ${archetype.loot_table_id}`);
    }
  }
}

try {
  const resolved = resolveContentPackGraph(
    packs.map((pack) => ({
      schema_version: 1,
      id: pack.id,
      name: pack.name,
      version: pack.version,
      kind: pack.kind,
      description: pack.description,
      license: pack.license,
      license_url: pack.license_url,
      engine: pack.engine,
      capabilities: pack.capabilities,
      dependencies: pack.dependency_requirements,
      default_ruleset: pack.default_ruleset,
      entry_points: pack.entry_points,
      provenance: pack.provenance,
    })),
    engineVersion,
  );
  const resolvedIds = resolved.ordered.map((pack) => pack.id);
  if (JSON.stringify(resolvedIds) !== JSON.stringify(packs.map((pack) => pack.id))) {
    fail(`worldpack packs are not in deterministic dependency order: ${resolvedIds.join(", ")}`);
  }
  for (const pack of packs) {
    if (
      JSON.stringify(pack.dependency_closure)
      !== JSON.stringify(resolved.dependencyClosure.get(pack.id))
    ) {
      fail(`worldpack pack ${pack.id} has stale dependency_closure`);
    }
  }
} catch (error) {
  fail(error.message);
}
if (!isObject(manifest.files)) {
  fail("worldpack manifest files must be an object");
}
if (
  manifest.external_cards !== "external_cards.json"
  || manifest.assets !== "assets.json"
  || manifest.rules !== "rules.json"
  || manifest.contributions !== "contributions.json"
  || manifest.attributions !== "attributions.json"
  || manifest.licenses !== "licenses.json"
  || manifest.modified_material !== "modified-material.json"
  || manifest.character_creation !== "character_creation.json"
  || manifest.content_references !== "content_refs.json"
  || manifest.registry !== "registry.json"
) {
  fail("worldpack manifest must map the registry, licensing, rules, contribution, and compatibility artifacts to compiled files");
}

for (const [key, fileName] of Object.entries(expectedFiles)) {
  if (manifest.files?.[key] !== fileName) {
    fail(`worldpack manifest must map ${key} to ${fileName}`);
  }
}

const content = {};
for (const [key, fileName] of Object.entries(expectedFiles)) {
  content[key] = asArray(fileName, readJson(fileName));
  for (const row of content[key]) {
    if (!isNonEmptyString(row.pack_id) || !has(packIds, row.pack_id)) {
      fail(`${fileName} row ${String(row.id ?? row.card_id ?? row.location_id ?? "")} has invalid pack_id`);
    }
  }
  for (const pack of packs) {
    const actual = content[key].filter((row) => row.pack_id === pack.id).length;
    if (pack.resource_counts?.[key] !== actual) {
      fail(`worldpack pack ${pack.id} resource_counts.${key} is ${pack.resource_counts?.[key]}, expected ${actual}`);
    }
  }
}
if (JSON.stringify(registry?.resources) !== JSON.stringify(content)) {
  fail("registry.json resources do not match the compatibility resource files");
}

const externalCards = asArray("external_cards.json", readJson("external_cards.json"));
if (JSON.stringify(registry?.external_cards) !== JSON.stringify(externalCards)) {
  fail("registry.json external_cards do not match external_cards.json");
}
idSet("external cards", externalCards, (card) => card.card_id);
for (const card of externalCards) {
  if (!isNonEmptyString(card.pack_id) || !has(packIds, card.pack_id)) {
    fail(`external card ${card.card_id} has invalid pack_id`);
  }
  validateRequiredStrings("external card", card, [
    "display_name",
    "role",
    "rarity",
    "title",
    "blurb",
    "aspect",
    "set_number",
    "profile_id",
    "subject",
    "image_url",
    "chain_image_uri",
  ]);
}
for (const pack of packs) {
  const actual = externalCards.filter((card) => card.pack_id === pack.id).length;
  if (pack.resource_counts?.external_cards !== actual) {
    fail(`worldpack pack ${pack.id} resource_counts.external_cards is ${pack.resource_counts?.external_cards}, expected ${actual}`);
  }
}
const assetMounts = asArray("assets.json", readJson("assets.json"));
if (JSON.stringify(registry?.assets) !== JSON.stringify(assetMounts)) {
  fail("registry.json assets do not match assets.json");
}
idSet("asset mounts", assetMounts, (mount) => `${mount.pack_id}:${mount.mount}`);
idSet("asset public prefixes", assetMounts, (mount) => mount.public_prefix);
for (const mount of assetMounts) {
  validateRequiredStrings("asset mount", mount, [
    "pack_id",
    "pack_version",
    "pack_integrity",
    "provider",
    "mount",
    "root",
    "directory",
    "public_prefix",
    "content_hash",
  ]);
  if (!has(packIds, mount.pack_id)) {
    fail(`asset mount ${mount.pack_id}:${mount.mount} references a pack outside this bundle`);
  }
  const pack = packs.find((candidate) => candidate.id === mount.pack_id);
  if (mount.pack_version !== pack?.version || mount.pack_integrity !== pack?.integrity) {
    fail(`asset mount ${mount.pack_id}:${mount.mount} has stale pack identity`);
  }
  if (!pack?.capabilities.some((capability) => capability.id === mount.provider && capability.kind === "assets")) {
    fail(`asset mount ${mount.pack_id}:${mount.mount} has unavailable provider ${mount.provider}`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(mount.content_hash)) {
    fail(`asset mount ${mount.pack_id}:${mount.mount} has invalid content_hash`);
  }
  if (mount.root.includes("..") || mount.directory.includes("..") || !mount.public_prefix.startsWith("/assets/")) {
    fail(`asset mount ${mount.pack_id}:${mount.mount} has an unsafe path`);
  }
  const assetDirectory = path.resolve(contentRoot, "..", mount.root, mount.directory);
  if (!mount.optional && !fs.existsSync(assetDirectory)) {
    fail(`required asset mount ${mount.pack_id}:${mount.mount} is missing ${assetDirectory}`);
  }
}

const ruleBundles = asArray("rules.json", readJson("rules.json"));
if (JSON.stringify(registry?.rules) !== JSON.stringify(ruleBundles)) {
  fail("registry.json rules do not match rules.json");
}
const rulePackIds = new Set();
const ruleNamespaces = new Set();
let ruleConditionCount = 0;
let ruleMonsterSeedCount = 0;
let ruleActionCount = 0;
let activeRulesProfile = null;
let rulesConformance = [];
const activeActionIds = new Set();
const playableBindingIds = new Set();
const equipmentProfileIds = new Set();
const magicEffectIds = new Set();
for (const bundle of ruleBundles) {
  validateRequiredStrings("rules bundle", bundle, ["pack_id", "pack_version", "adapter", "namespace"]);
  if (!has(packIds, bundle.pack_id)) {
    fail(`rules bundle references pack outside this bundle: ${bundle.pack_id}`);
  }
  const pack = packs.find((candidate) => candidate.id === bundle.pack_id);
  if (pack?.kind !== "rules") {
    fail(`rules bundle ${bundle.pack_id} does not belong to a rules pack`);
  }
  if (!supportedRulesAdapters.has(bundle.adapter) || bundle.adapter !== pack?.rules_adapter) {
    fail(`rules bundle ${bundle.pack_id} has an unsupported adapter`);
  }
  if (bundle.namespace !== pack?.rules_namespace) {
    fail(`rules bundle ${bundle.pack_id} namespace does not match its pack`);
  }
  if (rulePackIds.has(bundle.pack_id)) {
    fail(`rules pack ${bundle.pack_id} has more than one compiled bundle`);
  }
  rulePackIds.add(bundle.pack_id);
  if (ruleNamespaces.has(bundle.namespace)) {
    fail(`rules namespace ${bundle.namespace} is used by more than one pack`);
  }
  ruleNamespaces.add(bundle.namespace);
  if (!isObject(bundle.resources)) {
    fail(`rules bundle ${bundle.pack_id} has no resources object`);
    continue;
  }
  for (const resource of Object.keys(bundle.resources)) {
    if (!supportedRulesAdapters.get(bundle.adapter)?.has(resource)) {
      fail(`rules bundle ${bundle.pack_id} contains unsupported resource ${resource}`);
    }
  }

  if (bundle.adapter === "cosyworld.rules/2") {
    const profiles = asArray(`rules bundle ${bundle.pack_id} profiles`, bundle.resources.profiles ?? []);
    if (profiles.length !== 1 || profiles[0]?.id !== manifest.rules_profile) {
      fail(`rules/2 bundle ${bundle.pack_id} must contain selected profile ${manifest.rules_profile}`);
    } else if (activeRulesProfile) {
      fail(`more than one rules bundle provides active profile ${manifest.rules_profile}`);
    } else {
      activeRulesProfile = profiles[0];
    }
    for (const profile of profiles) {
      validateRequiredStrings("rules profile", profile, ["source_document", "source_version", "source_pack", "license", "compatibility_claim", "source_reference", "import_transform"]);
      if (profile.modified !== true) {
        fail(`rules profile ${profile.id} has invalid source or modification metadata`);
      }
    }

    const actions = asArray(`rules bundle ${bundle.pack_id} actions`, bundle.resources.actions ?? []);
    const actionIds = idSet(`rules bundle ${bundle.pack_id} actions`, actions, (action) => action.id);
    ruleActionCount += actions.length;
    if (actionIds.size === 0) fail(`profile ${manifest.rules_profile} must contain at least one action`);
    for (const actionId of actionIds) activeActionIds.add(actionId);
    for (const action of actions) {
      playableBindingIds.add(action.id);
      validateRequiredStrings("rules action", action, ["namespace", "domain", "label", "source_reference", "support_status", "resolver_kind", "cosyworld_delta"]);
      if (!action.id.startsWith(`${action.namespace}:`) || action.domain !== "rules_action" || !Array.isArray(action.aliases) || action.aliases.length === 0) {
        fail(`rules action ${action.id} has invalid identity, domain, or aliases`);
      }
      if (!["kernel", "projection", "unsupported"].includes(action.support_status)) {
        fail(`rules action ${action.id} has invalid support_status`);
      } else if (action.support_status === "unsupported" && action.resolver_kind !== "none") {
        fail(`unsupported action ${action.id} cannot name a resolver`);
      } else if (action.support_status !== "unsupported" && action.resolver_kind === "none") {
        fail(`supported action ${action.id} must name a resolver`);
      }
    }

    const operations = asArray(`rules bundle ${bundle.pack_id} operations`, bundle.resources.operations ?? []);
    const operationIds = idSet(`rules bundle ${bundle.pack_id} operations`, operations, (operation) => operation.id);
    for (const operation of operations) {
      playableBindingIds.add(operation.id);
      validateRequiredStrings("rules operation", operation, ["domain", "label", "resolver_kind", "source_reference"]);
      if (!["movement", "communication", "object_transfer", "procedure", "cosy_advancement", "interface_meta"].includes(operation.domain)) {
        fail(`operation ${operation.id} has invalid domain`);
      }
    }

    const abilities = asArray(`rules bundle ${bundle.pack_id} abilities`, bundle.resources.abilities ?? []);
    const abilityIds = idSet(`rules bundle ${bundle.pack_id} abilities`, abilities, (ability) => ability.id);
    const skills = asArray(`rules bundle ${bundle.pack_id} skills`, bundle.resources.skills ?? []);
    idSet(`rules bundle ${bundle.pack_id} skills`, skills, (skill) => skill.id);
    for (const skill of skills) {
      if (!has(abilityIds, skill.ability)) fail(`skill ${skill.id} references unknown ability ${skill.ability}`);
    }
    idSet(`rules bundle ${bundle.pack_id} item_roles`, asArray(`rules bundle ${bundle.pack_id} item_roles`, bundle.resources.item_roles ?? []), (role) => role.id);
    const equipmentProfiles = asArray(`rules bundle ${bundle.pack_id} equipment_profiles`, bundle.resources.equipment_profiles ?? []);
    idSet(`rules bundle ${bundle.pack_id} equipment_profiles`, equipmentProfiles, (profile) => profile.id);
    for (const profile of equipmentProfiles) equipmentProfileIds.add(profile.id);
    const magicEffects = asArray(`rules bundle ${bundle.pack_id} magic_effects`, bundle.resources.magic_effects ?? []);
    idSet(`rules bundle ${bundle.pack_id} magic_effects`, magicEffects, (effect) => effect.id);
    for (const effect of magicEffects) {
      magicEffectIds.add(effect.id);
      if (!has(actionIds, effect.rules_action) || effect.resolver_kind !== "bounded_magic_v1") {
        fail(`magic effect ${effect.id} has an invalid action or resolver`);
      }
    }
    const bindings = asArray(`rules bundle ${bundle.pack_id} legacy_bindings`, bundle.resources.legacy_bindings ?? []);
    idSet(`rules bundle ${bundle.pack_id} legacy_bindings`, bindings, (binding) => binding.legacy_kind);
    for (const binding of bindings) {
      for (const target of String(binding.binding_id || "").split("|")) {
        const valid = binding.binding_kind === "operation" ? has(operationIds, target) : has(actionIds, target);
        if (!valid) fail(`legacy binding ${binding.legacy_kind} references unknown ${target}`);
      }
    }
    rulesConformance = asArray(
      `rules bundle ${bundle.pack_id} conformance`,
      bundle.resources.conformance ?? [],
    );
    const conformanceIds = idSet(
      `rules bundle ${bundle.pack_id} conformance`,
      rulesConformance,
      (row) => row.action_id,
    );
    if (conformanceIds.size !== actionIds.size) {
      fail(`profile ${manifest.rules_profile} conformance matrix must cover every action`);
    }
    for (const action of actions) {
      const row = rulesConformance.find((candidate) => candidate.action_id === action.id);
      if (!row
        || row.support_status !== action.support_status
        || row.resolver_kind !== action.resolver_kind
        || !Array.isArray(row.legal_targets)
        || !Array.isArray(row.event_outputs)
        || !isNonEmptyString(row.safe_behavior)
        || !isNonEmptyString(row.risky_behavior)
        || !isNonEmptyString(row.cosyworld_delta)) {
        fail(`conformance for ${action.id} is missing or disagrees with its registry`);
      } else if (action.support_status !== "unsupported" && !isNonEmptyString(row.replay_fixture)) {
        fail(`supported action ${action.id} lacks replay coverage`);
      }
    }
    continue;
  }

  const conditions = asArray(
    `rules bundle ${bundle.pack_id} conditions`,
    bundle.resources.conditions ?? [],
  );
  idSet(`rules bundle ${bundle.pack_id} conditions`, conditions, (condition) => condition.id);
  ruleConditionCount += conditions.length;
  for (const condition of conditions) {
    validateRequiredStrings("rules condition", condition, ["name", "source_section", "source_text"]);
    if (!/^condition\/[a-z0-9][a-z0-9-]*$/.test(condition.id ?? "")) {
      fail(`rules condition ${condition.id} has an invalid id`);
    }
    if (!isObject(condition.mapping) || !["reference_only", "kernel"].includes(condition.mapping.status)) {
      fail(`rules condition ${condition.id} has an invalid mapping`);
    } else if (
      condition.mapping.status === "kernel"
      && !(condition.id === "condition/unconscious" && condition.mapping.kernel_condition === "unconscious")
    ) {
      fail(`rules condition ${condition.id} maps to an unsupported kernel condition`);
    } else if (condition.mapping.status === "reference_only" && condition.mapping.kernel_condition !== undefined) {
      fail(`reference-only condition ${condition.id} may not name a kernel condition`);
    }
  }

  const monsterSeeds = asArray(
    `rules bundle ${bundle.pack_id} monster_seeds`,
    bundle.resources.monster_seeds ?? [],
  );
  idSet(`rules bundle ${bundle.pack_id} monster seeds`, monsterSeeds, (monster) => monster.id);
  ruleMonsterSeedCount += monsterSeeds.length;
  for (const monster of monsterSeeds) {
    validateRequiredStrings("rules monster seed", monster, [
      "name",
      "source_name",
      "size",
      "creature_type",
      "alignment",
      "armor_class",
      "hit_points",
      "speed",
      "challenge",
    ]);
    if (!/^monster\/[a-z0-9][a-z0-9-]*$/.test(monster.id ?? "")) {
      fail(`rules monster seed ${monster.id} has an invalid id`);
    }
    if (!isObject(monster.ability_scores)) {
      fail(`rules monster seed ${monster.id} has no ability_scores`);
    } else {
      for (const ability of ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]) {
        if (!Number.isInteger(monster.ability_scores[ability]) || monster.ability_scores[ability] < 1 || monster.ability_scores[ability] > 30) {
          fail(`rules monster seed ${monster.id} has invalid ${ability}`);
        }
      }
    }
    const features = asArray(`rules monster seed ${monster.id} features`, monster.features);
    for (const feature of features) {
      validateRequiredStrings(`rules monster seed ${monster.id} feature`, feature, ["name", "description"]);
    }
    if (!isObject(monster.mapping) || monster.mapping.status !== "reference_only") {
      fail(`rules monster seed ${monster.id} must remain reference_only`);
    }
  }
}
if (!activeRulesProfile) fail(`no rules bundle provides active profile ${manifest.rules_profile}`);
for (const pack of packs.filter((candidate) => candidate.kind === "rules")) {
  if (!has(rulePackIds, pack.id)) fail(`rules pack ${pack.id} has no compiled rules bundle`);
}

const contributionKinds = ["reskins", "offers", "variants", "extensions"];
const presentationOnlyReskinFields = new Set([
  "id", "based_on", "label", "description", "art", "scope", "compatibility",
  "compose_with", "source_reference",
]);
const contributionBundles = asArray("contributions.json", readJson("contributions.json"));
const contributionIds = new Set();
const compiledVariants = [];
const compiledExtensions = [];
for (const bundle of contributionBundles) {
  validateRequiredStrings("contribution bundle", bundle, ["pack_id", "pack_version", "rules_profile"]);
  const pack = packs.find((candidate) => candidate.id === bundle.pack_id);
  if (!pack || pack.kind === "rules" || pack.version !== bundle.pack_version || bundle.rules_profile !== manifest.rules_profile) {
    fail(`contribution bundle ${bundle.pack_id} has invalid pack/profile provenance`);
  }
  for (const kind of contributionKinds) {
    const rows = asArray(`contribution bundle ${bundle.pack_id} ${kind}`, bundle[kind]);
    if (pack?.resource_counts?.[kind] !== rows.length) {
      fail(`pack ${bundle.pack_id} resource_counts.${kind} does not match compiled contributions`);
    }
    for (const row of rows) {
      if (!isNonEmptyString(row.id) || !row.id.startsWith(`${bundle.pack_id}:`) || contributionIds.has(row.id)) {
        fail(`invalid or conflicting contribution ${row.id}`);
      }
      contributionIds.add(row.id);
      if (!has(activeActionIds, row.based_on) || !isNonEmptyString(row.source_reference)) {
        fail(`contribution ${row.id} has invalid base action or source reference`);
      }
      if (kind === "reskins") {
        for (const field of Object.keys(row)) {
          if (!presentationOnlyReskinFields.has(field)) fail(`reskin ${row.id} contains mechanical field ${field}`);
        }
        if (!isNonEmptyString(row.label)) fail(`reskin ${row.id} requires label`);
      } else if (kind === "offers") {
        if (!isObject(row.subject) || !isObject(row.context) || !isNonEmptyString(row.label)) {
          fail(`contextual offer ${row.id} is incomplete`);
        }
        if (row.cooperation !== undefined
          && (!isObject(row.cooperation)
            || row.cooperation.kind !== "local_lead"
            || row.based_on !== "srd5.2.1:influence"
            || row.subject?.kind !== "location"
            || !Number.isSafeInteger(row.cooperation.destination_location_id)
            || row.cooperation.destination_location_id <= 0
            || !isNonEmptyString(row.cooperation.destination_hint))) {
          fail(`contextual offer ${row.id} has an invalid typed cooperation payload`);
        }
      } else if (kind === "variants") {
        compiledVariants.push(row.id);
        if (!/^.+\/\d+$/.test(row.id) || !isObject(row.exact_delta) || !Object.keys(row.exact_delta).length || !Array.isArray(row.fixtures) || !row.fixtures.length) {
          fail(`variant ${row.id} lacks version, exact delta, or fixtures`);
        }
      } else if (kind === "extensions") {
        compiledExtensions.push(row.id);
        if (!/^.+\/\d+$/.test(row.id) || !isObject(row.resolver_contract) || !String(row.resolver_contract.kind || "").startsWith(`${bundle.pack_id}.`) || !Array.isArray(row.fixtures) || !row.fixtures.length) {
          fail(`extension ${row.id} lacks a namespaced resolver contract or fixtures`);
        }
      }
    }
  }
}
const declaredVariants = asArray("worldpack active_rules_variants", manifest.active_rules_variants).slice().sort();
const declaredExtensions = asArray("worldpack active_rules_extensions", manifest.active_rules_extensions).slice().sort();
if (JSON.stringify(declaredVariants) !== JSON.stringify(compiledVariants.sort())) fail("worldpack active_rules_variants identity is stale");
if (JSON.stringify(declaredExtensions) !== JSON.stringify(compiledExtensions.sort())) fail("worldpack active_rules_extensions identity is stale");

const attributions = asArray("attributions.json", readJson("attributions.json"));
if (JSON.stringify(registry?.attributions) !== JSON.stringify(attributions)) {
  fail("registry.json attributions do not match attributions.json");
}
const attributedPackIds = idSet("attributions", attributions, (attribution) => attribution.pack_id);
for (const attribution of attributions) {
  validateRequiredStrings("attribution", attribution, ["license", "source_name", "source_url", "text"]);
  if (!has(packIds, attribution.pack_id)) {
    fail(`attribution references pack outside this bundle: ${attribution.pack_id}`);
  }
  if (attribution.license !== packs.find((pack) => pack.id === attribution.pack_id)?.license) {
    fail(`attribution license does not match pack ${attribution.pack_id}`);
  }
}
for (const pack of packs.filter((candidate) => candidate.kind === "rules")) {
  if (!has(attributedPackIds, pack.id)) fail(`rules pack ${pack.id} has no compiled attribution`);
}

const licenses = asArray("licenses.json", readJson("licenses.json"));
if (JSON.stringify(registry?.licenses) !== JSON.stringify(licenses)) {
  fail("registry.json licenses do not match licenses.json");
}
const licensedPackIds = idSet("license records", licenses, (record) => record.pack_id);
for (const record of licenses) {
  validateRequiredStrings("license record", record, [
    "name",
    "version",
    "license_identifier",
    "license_url",
  ]);
  const pack = packs.find((candidate) => candidate.id === record.pack_id);
  if (!pack) {
    fail(`license record references pack outside this bundle: ${record.pack_id}`);
    continue;
  }
  if (
    record.name !== pack.name
    || record.version !== pack.version
    || record.license_identifier !== pack.license
    || record.license_url !== pack.license_url
    || JSON.stringify(record.provenance) !== JSON.stringify(pack.provenance)
  ) {
    fail(`license record does not match mounted pack ${record.pack_id}`);
  }
  validateRequiredStrings(`license record ${record.pack_id} provenance`, record.provenance, [
    "author",
    "source_name",
    "source_url",
  ]);
  const notices = asArray(`license record ${record.pack_id} notices`, record.notices);
  for (const notice of notices) {
    validateRequiredStrings(`license record ${record.pack_id} notice`, notice, [
      "kind",
      "title",
      "file",
      "text",
    ]);
    if (!["attribution", "license", "notice"].includes(notice.kind)) {
      fail(`license record ${record.pack_id} has unsupported notice kind ${notice.kind}`);
    }
  }
  const sourceNames = [
    record.provenance?.source_name,
    ...notices.map((notice) => notice.source_name),
  ].filter(Boolean).join(" ");
  if (/(?:system reference document|\bsrd\b)/i.test(sourceNames)) {
    const requiredAttribution = notices.find((notice) => notice.kind === "attribution");
    if (
      record.license_identifier !== "CC-BY-4.0"
      || record.license_url !== "https://creativecommons.org/licenses/by/4.0/"
      || !isNonEmptyString(record.provenance?.modification_notice)
      || !requiredAttribution?.text?.includes("Wizards of the Coast LLC")
      || !requiredAttribution?.text?.includes("creativecommons.org/licenses/by/4.0/legalcode")
    ) {
      fail(`SRD-derived pack ${record.pack_id} has incomplete license or attribution metadata`);
    }
  }
}
for (const pack of packs) {
  if (!has(licensedPackIds, pack.id)) fail(`pack ${pack.id} has no compiled license record`);
}

const modifiedMaterial = asArray("modified-material.json", readJson("modified-material.json"));
if (JSON.stringify(registry?.modified_material) !== JSON.stringify(modifiedMaterial)) {
  fail("registry.json modified_material does not match modified-material.json");
}
const modifiedMaterialKeys = new Set();
for (const row of modifiedMaterial) {
  validateRequiredStrings("modified material", row, [
    "pack_id", "rules_profile", "resource_type", "id", "source_document",
    "source_version", "source_pack", "source_reference", "license",
    "attribution_pack", "import_transform", "modification_status",
  ]);
  const key = `${row.resource_type}:${row.id}`;
  if (modifiedMaterialKeys.has(key)) fail(`duplicate modified-material entry ${key}`);
  modifiedMaterialKeys.add(key);
  if (row.rules_profile !== manifest.rules_profile
    || row.source_version !== "5.2.1"
    || row.license !== "CC-BY-4.0"
    || row.modification_status !== "modified"
    || !has(attributedPackIds, row.attribution_pack)
    || !Array.isArray(row.changes)
    || row.changes.length === 0) {
    fail(`modified-material entry ${key} has incomplete provenance`);
  }
}
for (const actionId of activeActionIds) {
  if (!modifiedMaterialKeys.has(`action:${actionId}`)) {
    fail(`modified-material report is missing action ${actionId}`);
  }
}
const srdPack = packs.find((pack) => pack.id === "cosyworld.rules-srd-5.1");
if (srdPack) {
  const srdBundle = ruleBundles.find((bundle) => bundle.pack_id === srdPack.id);
  const srdAttribution = attributions.find((attribution) => attribution.pack_id === srdPack.id);
  if (srdPack.license !== "CC-BY-4.0") fail("SRD 5.1 pack must use CC-BY-4.0");
  if ((srdBundle?.resources?.conditions ?? []).length !== 15) fail("SRD 5.1 pack must contain 15 conditions");
  if ((srdBundle?.resources?.monster_seeds ?? []).length < 1) fail("SRD 5.1 pack must contain monster seeds");
  if (!srdAttribution?.text?.includes("System Reference Document 5.1") || !srdAttribution?.text?.includes("creativecommons.org/licenses/by/4.0/legalcode")) {
    fail("SRD 5.1 pack is missing its required CC-BY-4.0 attribution statement");
  }
}
const revisedSrdPack = packs.find((pack) => pack.id === "cosyworld.rules-srd-5.2.1");
if (revisedSrdPack) {
  const revisedSrdBundle = ruleBundles.find((bundle) => bundle.pack_id === revisedSrdPack.id);
  const revisedSrdAttribution = attributions.find((attribution) => attribution.pack_id === revisedSrdPack.id);
  if (revisedSrdPack.license !== "CC-BY-4.0") fail("SRD 5.2.1 pack must use CC-BY-4.0");
  if (revisedSrdBundle?.namespace !== "srd5.2.1") fail("SRD 5.2.1 pack must use its versioned namespace");
  if ((revisedSrdBundle?.resources?.conditions ?? []).length !== 15) fail("SRD 5.2.1 pack must contain 15 conditions");
  if ((revisedSrdBundle?.resources?.monster_seeds ?? []).length !== 3) fail("SRD 5.2.1 pack must contain 3 monster seeds");
  if (!revisedSrdAttribution?.text?.includes("System Reference Document 5.2.1") || !revisedSrdAttribution?.text?.includes("creativecommons.org/licenses/by/4.0/legalcode")) {
    fail("SRD 5.2.1 pack is missing its required CC-BY-4.0 attribution statement");
  }
}

const characterCreationBundles = asArray("character_creation.json", readJson("character_creation.json"));
if (JSON.stringify(registry?.character_creation) !== JSON.stringify(characterCreationBundles)) {
  fail("registry.json character_creation does not match character_creation.json");
}
const characterCreationPackIds = new Set();
const characterCreationProfiles = [];
for (const bundle of characterCreationBundles) {
  validateRequiredStrings("character creation bundle", bundle, ["pack_id", "pack_version"]);
  const pack = packs.find((candidate) => candidate.id === bundle.pack_id);
  if (!pack || !["world", "campaign"].includes(pack.kind) || pack.version !== bundle.pack_version) {
    fail(`character creation bundle ${bundle.pack_id} does not match a world or campaign pack`);
  }
  if (characterCreationPackIds.has(bundle.pack_id)) {
    fail(`pack ${bundle.pack_id} has more than one character creation bundle`);
  }
  characterCreationPackIds.add(bundle.pack_id);
  const profiles = asArray(`character creation bundle ${bundle.pack_id} profiles`, bundle.profiles);
  for (const profile of profiles) characterCreationProfiles.push({ ...profile, pack_id: bundle.pack_id });
}

const contentReferences = readJson("content_refs.json");
if (JSON.stringify(registry?.content_references) !== JSON.stringify(contentReferences)) {
  fail("registry.json content_references do not match content_refs.json");
}
if (
  !isObject(contentReferences)
  || contentReferences.schema_version !== 1
  || contentReferences.mapping_version !== CANONICAL_ID_MAPPING_VERSION
  || !Array.isArray(contentReferences.entries)
) {
  fail("content_refs.json has an unsupported schema or mapping version");
} else {
  const canonicalRefs = new Set();
  const runtimeHandles = new Set();
  let previousReference = "";
  for (const entry of contentReferences.entries) {
    let parsed;
    try {
      parsed = parseCanonicalContentReference(entry.canonical_ref);
    } catch (error) {
      fail(error.message);
      continue;
    }
    if (
      entry.pack_id !== parsed.pack_id
      || entry.kind !== parsed.kind
      || entry.local_id !== parsed.local_id
      || packs.find((pack) => pack.id === entry.pack_id)?.version !== entry.pack_version
    ) {
      fail(`content reference ${entry.canonical_ref} has inconsistent identity or pack version`);
    }
    if (entry.canonical_ref <= previousReference) {
      fail("content_refs.json entries are not in deterministic canonical order");
    }
    previousReference = entry.canonical_ref;
    if (canonicalRefs.has(entry.canonical_ref)) fail(`duplicate canonical content reference ${entry.canonical_ref}`);
    if (!Number.isSafeInteger(entry.runtime_handle) || entry.runtime_handle <= 0 || runtimeHandles.has(entry.runtime_handle)) {
      fail(`content reference ${entry.canonical_ref} has an invalid or duplicate runtime handle`);
    }
    if (entry.legacy_runtime_id !== undefined && entry.legacy_runtime_id !== entry.runtime_handle) {
      fail(`legacy content reference ${entry.canonical_ref} changed runtime handle`);
    }
    canonicalRefs.add(entry.canonical_ref);
    runtimeHandles.add(entry.runtime_handle);
  }
  try {
    const expectedContentReferences = buildContentReferenceMapping(
      collectContentReferenceCandidates({
        resources: content,
        packs,
        externalCards,
        ruleBundles,
        characterCreationBundles,
      }),
      CANONICAL_ID_MAPPING_VERSION,
    );
    if (JSON.stringify(contentReferences) !== JSON.stringify(expectedContentReferences)) {
      fail("content_refs.json is not the deterministic mapping for the compiled content");
    }
  } catch (error) {
    fail(error.message);
  }
}
for (const pack of packs.filter((candidate) => candidate.kind === "campaign")) {
  if (!has(characterCreationPackIds, pack.id)) {
    fail(`campaign pack ${pack.id} has no compiled character creation profile`);
  }
}

const actors = content.actors;
const actorModelBindings = content.actor_model_bindings ?? [];
for (const pack of packs) {
  for (const error of actorModelBindingValidationErrors(
    pack,
    actors,
    actorModelBindings.filter((row) => row.pack_id === pack.id),
  )) {
    fail(error);
  }
}
for (const error of avatarLevelSchemaValidationErrors({
  actors,
  tracks: content.avatar_level_tracks,
  actorModelBindings,
})) {
  fail(error);
}
const actorFacets = content.actor_facets;
const accessGates = content.access_gates;
const factions = content.factions;
const items = content.items;
const locations = content.locations;
const exits = content.exits;
const hiddenExits = content.hidden_exits;
const roomFeatures = content.room_features;
const spatialScenes = content.spatial_scenes ?? [];
const roomSheets = content.room_sheets;
const clocks = content.clocks;
const jobs = content.jobs;
const actionVocabulary = content.action_vocabulary;
const fronts = content.fronts;
const cards = content.cards;
const cardBindings = content.card_bindings;
const lifecycleHooks = content.lifecycle_hooks;
const evolutionTracks = content.evolution_tracks;
const recipes = content.recipes;
const sentences = content.sentences;

for (const error of spatialSceneValidationErrors({
  scenes: spatialScenes,
  locations,
  actors,
  roomFeatures,
  exits,
})) {
  fail(error);
}

validateWritingRegister(content);
reportWritingRegisterAdvisories({ actors, cards, locations });
reportGenreAdvisories(content);

const actorIds = idSet("actors", actors, (actor) => actor.id);
const actorById = new Map(actors.map((actor) => [actor.id, actor]));
const itemIds = idSet("items", items, (item) => item.id);
const locationIds = idSet("locations", locations, (location) => location.id);
const locationPackById = new Map(locations.map((location) => [location.id, location.pack_id]));
const packById = new Map(packs.map((pack) => [pack.id, pack]));
function dependentUnmountClosure(packId) {
  return new Set(
    packs
      .filter((pack) =>
        pack.id === packId || (pack.dependency_closure ?? []).includes(packId))
      .map((pack) => pack.id),
  );
}
idSet("sentences", sentences, (sentence) => sentence.id);
const clockIds = idSet("clocks", clocks, (clock) => clock.id);
const jobIds = idSet("jobs", jobs, (job) => job.id);
const frontIds = idSet("fronts", fronts, (front) => front.id);
const characterCreationProfileIds = idSet(
  "character creation profiles",
  characterCreationProfiles,
  (profile) => profile.id,
);
const gateByLocationId = new Map();

const vocabularyPackIds = new Set();
for (const vocabulary of actionVocabulary) {
  const labels = ["notice", "inspect", "scout", "travel", "contribute", "push", "help"];
  if (!packs.some((pack) => pack.id === vocabulary.pack_id)
      || vocabularyPackIds.has(vocabulary.pack_id)
      || labels.some((label) => !isNonEmptyString(vocabulary[label]))) {
    fail(`invalid action vocabulary for pack ${vocabulary.pack_id || "unknown"}`);
  }
  vocabularyPackIds.add(vocabulary.pack_id);
}

for (const sentence of sentences) {
  validateRequiredStrings("sentence", sentence, ["id", "shelf", "text"]);
  if (!allowedSentenceShelves.has(sentence.shelf)) {
    fail(`sentence ${sentence.id} has invalid shelf ${String(sentence.shelf)}`);
  }
  const sentenceLocationIds = asArray(`sentence ${sentence.id} location_ids`, sentence.location_ids);
  if (sentenceLocationIds.length === 0) {
    fail(`sentence ${sentence.id} must declare at least one location_id`);
  }
  const seenLocationIds = new Set();
  for (const locationId of sentenceLocationIds) {
    if (!Number.isInteger(locationId) || !has(locationIds, locationId)) {
      fail(`sentence ${sentence.id} references missing location ${String(locationId)}`);
    } else if (seenLocationIds.has(locationId)) {
      fail(`sentence ${sentence.id} repeats location ${locationId}`);
    }
    seenLocationIds.add(locationId);
  }
  if (typeof sentence.weight !== "number" || !Number.isFinite(sentence.weight) || sentence.weight <= 0) {
    fail(`sentence ${sentence.id} must declare a positive weight`);
  }
}

for (const gate of accessGates) {
  if (gateByLocationId.has(gate.location_id)) {
    fail(`duplicate access gate for location ${gate.location_id}`);
  } else {
    gateByLocationId.set(gate.location_id, gate);
  }
}

if (manifest.pack_lifecycle !== undefined) {
  const lifecycle = manifest.pack_lifecycle;
  if (!isObject(lifecycle) || lifecycle.schema_version !== 1) {
    fail("worldpack pack_lifecycle must be a schema-version-1 object");
  } else if (
    Object.keys(lifecycle).some((field) => !["schema_version", "unmount"].includes(field))
  ) {
    fail("worldpack pack_lifecycle has unknown fields");
  } else {
    const policies = asArray("worldpack pack_lifecycle unmount", lifecycle.unmount);
    if (policies.length === 0) {
      fail("worldpack pack_lifecycle unmount policies cannot be empty");
    }
    const policyPackIds = new Set();
    for (const policy of policies) {
      if (!isObject(policy) || !isNonEmptyString(policy.pack_id) || !isObject(policy.evacuation)) {
        fail("worldpack pack_lifecycle contains a malformed unmount policy");
        continue;
      }
      if (Object.keys(policy).some((field) => !["pack_id", "evacuation"].includes(field))) {
        fail(`worldpack pack_lifecycle ${policy.pack_id} policy has unknown fields`);
      }
      if (!has(packIds, policy.pack_id)) {
        fail(`worldpack pack_lifecycle references missing pack ${policy.pack_id}`);
      }
      if (policyPackIds.has(policy.pack_id)) {
        fail(`worldpack pack_lifecycle duplicates unmount policy for ${policy.pack_id}`);
      }
      policyPackIds.add(policy.pack_id);
      const evacuation = policy.evacuation;
      if (
        Object.keys(evacuation).some((field) =>
          ![
            "mode",
            "destination_location",
            "destination_pack_id",
            "destination_location_id",
          ].includes(field))
      ) {
        fail(`worldpack pack_lifecycle ${policy.pack_id} evacuation has unknown fields`);
      }
      if (evacuation.mode !== "move_occupants") {
        fail(`worldpack pack_lifecycle ${policy.pack_id} has invalid evacuation mode`);
      }
      const destinationId = Number(evacuation.destination_location_id);
      const destinationPackId = locationPackById.get(destinationId);
      const removedPackIds = dependentUnmountClosure(policy.pack_id);
      const expectedReference = `${destinationPackId}:location/${destinationId}`;
      if (!Number.isInteger(destinationId) || !has(locationIds, destinationId)) {
        fail(`worldpack pack_lifecycle ${policy.pack_id} references missing evacuation destination`);
      } else if (
        evacuation.destination_pack_id !== destinationPackId
          || evacuation.destination_location !== expectedReference
      ) {
        fail(`worldpack pack_lifecycle ${policy.pack_id} evacuation destination identity does not match`);
      } else if (removedPackIds.has(destinationPackId)) {
        fail(`worldpack pack_lifecycle ${policy.pack_id} evacuation destination would unmount`);
      } else if (gateByLocationId.has(destinationId)) {
        fail(`worldpack pack_lifecycle ${policy.pack_id} evacuation destination must be public`);
      }
    }
  }
}
try {
  for (const error of progressionSafetyWorldValidationErrors(
    packs,
    content,
    "compiled worldpack",
  )) {
    fail(error);
  }
  validateCompiledGenerationPolicies(
    packs,
    { locations, exits, hidden_exits: hiddenExits },
    manifest.pack_lifecycle,
    "compiled worldpack",
  );
  const requiresGenerationMediaRegistry = packs.some((pack) => {
    const policy = generationPolicyForPack(pack);
    return policy?.media || policy?.cross_pack_routes?.length > 0;
  });
  if (requiresGenerationMediaRegistry) {
    if (
      JSON.stringify(manifest.generation_media_registry)
      !== JSON.stringify(worldpackMediaRegistry())
    ) {
      fail("worldpack generation_media_registry does not match the reviewed registry");
    }
  } else if (manifest.generation_media_registry !== undefined) {
    fail("worldpack must not publish an unused generation_media_registry");
  }
} catch (error) {
  fail(error.message);
}

for (const profile of characterCreationProfiles) {
  validateRequiredStrings("character creation profile", profile, [
    "name",
    "description",
    "prompt",
    "default_choice_id",
  ]);
  if (![1, 2].includes(profile.schema_version)) {
    fail(`character creation profile ${profile.id} must use schema_version 1 or 2`);
  }
  if (!has(locationIds, profile.entry_location_id)) {
    fail(`character creation profile ${profile.id} references missing entry location ${profile.entry_location_id}`);
  }
  const choices = asArray(`character creation profile ${profile.id} choices`, profile.choices);
  if (choices.length < 2 || choices.length > 6) {
    fail(`character creation profile ${profile.id} must declare 2-6 choices`);
  }
  const choiceIds = idSet(`character creation profile ${profile.id} choices`, choices, (choice) => choice.id);
  if (!has(choiceIds, profile.default_choice_id)) {
    fail(`character creation profile ${profile.id} has missing default choice ${profile.default_choice_id}`);
  }
  for (const choice of choices) {
    validateRequiredStrings(`character creation choice ${profile.id}`, choice, [
      "label",
      "detail",
      "calling",
      "title",
      "description",
      "starting_skill_id",
    ]);
    if (!new Set(["listening", "kindness", "lorecraft", "steadiness", "nimble_hands", "lifting"]).has(choice.starting_skill_id)) {
      fail(`character creation choice ${profile.id}:${choice.id} has invalid starting_skill_id ${choice.starting_skill_id}`);
    }
  }
  if (profile.schema_version === 2) {
    validateRequiredStrings("staged character creation profile", profile, [
      "class_prompt",
      "default_species_id",
      "default_origin_id",
    ]);
    for (const choice of choices) {
      validateRequiredStrings(`staged character creation choice ${profile.id}`, choice, [
        "campaign_use",
      ]);
    }
    for (const [slot, cards, defaultId] of [
      ["species", profile.species, profile.default_species_id],
      ["origin", profile.origins, profile.default_origin_id],
    ]) {
      const entries = asArray(`character creation profile ${profile.id} ${slot}`, cards);
      if (entries.length < 3 || entries.length > 12) {
        fail(`character creation profile ${profile.id} must declare 3-12 ${slot} cards`);
      }
      const cardIds = idSet(`character creation profile ${profile.id} ${slot}`, entries, (card) => card.id);
      if (!has(cardIds, defaultId)) {
        fail(`character creation profile ${profile.id} has missing default ${slot} ${defaultId}`);
      }
      for (const card of entries) {
        validateRequiredStrings(`character creation ${slot} ${profile.id}`, card, [
          "label",
          "detail",
          "title",
          "description",
          "visual_prompt",
          "campaign_rule",
        ]);
      }
    }
    const recommendations = asArray(
      `character creation profile ${profile.id} class_recommendations`,
      profile.class_recommendations,
    );
    if (recommendations.length < 1 || recommendations.length > choices.length) {
      fail(`character creation profile ${profile.id} must declare 1-${choices.length} class recommendations`);
    }
    const recommendationOffers = new Set();
    for (const recommendation of recommendations) {
      validateRequiredStrings(
        `character creation recommendation ${profile.id}`,
        recommendation,
        ["offer_kind", "class_id", "explanation"],
      );
      if (!new Set(["work", "help", "search"]).has(recommendation.offer_kind)) {
        fail(`character creation recommendation ${profile.id} has invalid offer_kind ${recommendation.offer_kind}`);
      }
      if (recommendationOffers.has(recommendation.offer_kind)) {
        fail(`character creation profile ${profile.id} repeats recommendation offer_kind ${recommendation.offer_kind}`);
      }
      recommendationOffers.add(recommendation.offer_kind);
      if (!has(choiceIds, recommendation.class_id)) {
        fail(`character creation recommendation ${profile.id} references missing class ${recommendation.class_id}`);
      }
    }
  }
}

for (const actor of actors) {
  try {
    validateWorldEntityResource(actor.pack_id, "actors", actor);
  } catch (error) {
    fail(error.message);
  }
  validateRequiredStrings("actor", actor, ["name", "speech_mode", "title", "description"]);
  if (actor.voice !== undefined
      && (!isNonEmptyString(actor.voice) || [...actor.voice].length > 500)) {
    fail(`actor ${actor.id} voice must contain 1-500 characters`);
  }
  if (actor.control_mode !== undefined
      && !new Set(["direct_input", "reactive_ai", "local_ai", "roaming_ai", "delegated_ai"])
        .has(actor.control_mode)) {
    fail(`actor ${actor.id} has invalid control_mode`);
  }
  if (actor.event_autonomy !== undefined && typeof actor.event_autonomy !== "boolean") {
    fail(`actor ${actor.id} has invalid event_autonomy`);
  }
  if (actor.roaming !== undefined && typeof actor.roaming !== "boolean") {
    fail(`actor ${actor.id} has invalid roaming`);
  }
  if (actor.roaming === true && actor.event_autonomy === false) {
    fail(`actor ${actor.id} cannot roam while event_autonomy is disabled`);
  }
  if (!has(locationIds, actor.location_id)) {
    fail(`actor ${actor.id} references missing location ${actor.location_id}`);
  }
  if (!isObject(actor.stats)) {
    fail(`actor ${actor.id} must declare stats`);
  } else {
    for (const ability of ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]) {
      if (!Number.isInteger(actor.stats[ability]) || actor.stats[ability] < 1 || actor.stats[ability] > 30) {
        fail(`actor ${actor.id} has invalid ${ability}`);
      }
    }
    if (!Number.isInteger(actor.stats.hp_base) || actor.stats.hp_base <= 0) {
      fail(`actor ${actor.id} has invalid hp_base`);
    }
    if (!Number.isInteger(actor.stats.level) || actor.stats.level <= 0) {
      fail(`actor ${actor.id} has invalid level`);
    }
  }
  const goals = actor.goals === undefined
    ? []
    : asArray(`actor ${actor.id} goals`, actor.goals);
  for (const [goalIndex, goal] of goals.entries()) {
    if (!isObject(goal)) {
      fail(`actor ${actor.id} goal ${goalIndex} must be an object`);
      continue;
    }
    for (const field of Object.keys(goal)) {
      if (!["objective", "motivation"].includes(field)) {
        fail(`actor ${actor.id} goal ${goalIndex} has unknown field ${field}`);
      }
    }
    validateRequiredStrings(`actor ${actor.id} goal ${goalIndex}`, goal, [
      "objective",
      "motivation",
    ]);
  }
  const desiredItemIds = new Set();
  if (actor.relationship !== undefined) {
    if (!isObject(actor.relationship)) {
      fail(`actor ${actor.id} has invalid relationship`);
    } else {
      validateRequiredStrings(`actor ${actor.id} relationship`, actor.relationship, [
        "intent",
        "statement",
        "first_beat",
        "reply_prompt",
        "active_beat",
      ]);
      if (!has(itemIds, actor.relationship.active_on_gift_item_id)) {
        fail(`actor ${actor.id} relationship references missing gift item ${actor.relationship.active_on_gift_item_id}`);
      }
    }
  }
  for (const desire of actor.desires ?? []) {
    if (!has(itemIds, desire.item_id) || !isNonEmptyString(desire.reason) || desiredItemIds.has(desire.item_id)) {
      fail(`actor ${actor.id} has invalid desire for item ${desire.item_id}`);
    }
    desiredItemIds.add(desire.item_id);
  }
  const attachedItemIds = new Set();
  for (const attachment of actor.attachments ?? []) {
    if (!has(itemIds, attachment.item_id) || !isNonEmptyString(attachment.reason) || attachedItemIds.has(attachment.item_id)) {
      fail(`actor ${actor.id} has invalid attachment to item ${attachment.item_id}`);
    }
    attachedItemIds.add(attachment.item_id);
  }
}

for (const item of items) {
  try {
    validateWorldEntityResource(item.pack_id, "items", item);
  } catch (error) {
    fail(error.message);
  }
  validateRequiredStrings("item", item, ["name", "description", "kind", "role", "size"]);
  if (!["potion", "evolution", "trinket"].includes(item.kind)) {
    fail(`item ${item.id} has invalid kind ${item.kind}`);
  }
  if (!Number.isInteger(item.charges) || item.charges <= 0) {
    fail(`item ${item.id} must declare positive charges`);
  }
  if (!allowedItemRoles.has(item.role)) {
    fail(`item ${item.id} has invalid role ${item.role}`);
  }
  const itemCapabilities = item.capabilities ?? [];
  if (!Array.isArray(itemCapabilities)
    || new Set(itemCapabilities).size !== itemCapabilities.length
    || itemCapabilities.some((capability) => !allowedItemCapabilities.has(capability))) {
    fail(`item ${item.id} has invalid capabilities`);
  }
  if (itemCapabilities.length && !["tool", "consumable"].includes(item.role)) {
    fail(`item ${item.id} capabilities require the tool or consumable role`);
  }
  if (!allowedItemSizes.has(item.size)) {
    fail(`item ${item.id} has invalid size ${item.size}`);
  }
  if (!Number.isInteger(item.weight_tenths) || item.weight_tenths <= 0) {
    fail(`item ${item.id} must declare positive weight_tenths`);
  }
  if (item.role === "container") {
    if (!Number.isInteger(item.container_capacity_tenths) || item.container_capacity_tenths <= 0) {
      fail(`container item ${item.id} must declare positive container_capacity_tenths`);
    }
    if (!allowedItemSizes.has(item.container_opening_size) || !Array.isArray(item.allowed_contents) || !item.allowed_contents.length || !item.allowed_contents.includes("container") || item.nested_containers !== "empty_storage_only" || !isNonEmptyString(item.access_cost)) {
      fail(`container item ${item.id} has an invalid opening, contents, access cost, or nested-container policy`);
    }
  } else if (item.container_capacity_tenths !== undefined && item.container_capacity_tenths !== 0) {
    fail(`non-container item ${item.id} cannot add container capacity`);
  }
  if (item.role === "skill_charm") {
    if (!isNonEmptyString(item.skill_id) || !Number.isInteger(item.skill_bonus) || item.skill_bonus === 0) {
      fail(`skill charm ${item.id} must declare skill_id and non-zero skill_bonus`);
    }
  }
  if (["consumable", "weapon", "skill_charm", "spell", "container"].includes(item.role)) {
    const mechanics = item.mechanics;
    if (!isObject(mechanics)
      || !(playableBindingIds.has(mechanics.binding) || mechanics.binding === "ability_check_modifier")
      || !(equipmentProfileIds.has(mechanics.equipment_profile) || mechanics.equipment_profile === "carried")
      || !isNonEmptyString(mechanics.target_predicate)
      || !isNonEmptyString(mechanics.resolver)
      || !isObject(mechanics.effect_budget)
      || !Number.isInteger(mechanics.uses)
      || !isNonEmptyString(mechanics.exhaustion)
      || !isNonEmptyString(mechanics.recovery)
      || !["transferable", "bound"].includes(mechanics.transfer_policy)
      || !["eligible_when_carried", "ineligible"].includes(mechanics.theft_policy)) {
      fail(`mechanical item ${item.id} lacks a validated playable-item descriptor`);
    }
    if (item.role === "spell" && !magicEffectIds.has(mechanics?.magic_effect)) {
      fail(`spell item ${item.id} references unsupported magic effect ${mechanics?.magic_effect}`);
    }
  }
  if (!item.location_id) {
    if (!discoveryHiddenItemIds.has(item.id)) {
      fail(`item ${item.id} is unplaced but no discovery slot reveals it`);
    }
  } else if (!has(locationIds, item.location_id)) {
    fail(`item ${item.id} references missing location ${item.location_id}`);
  }
}
const itemById = new Map(items.map((item) => [item.id, item]));
for (const location of locations) {
  try {
    validateWorldEntityResource(location.pack_id, "locations", location);
  } catch (error) {
    fail(error.message);
  }
  validateRequiredStrings("location", location, ["name", "title", "description", "persona"]);
  if (!Array.isArray(location.memory) || location.memory.some((entry) => !isNonEmptyString(entry))) {
    fail(`location ${location.id} must have non-empty memory strings`);
  }
  const knowledgeRows = location.knowledge === undefined
    ? []
    : asArray(`location ${location.id} knowledge`, location.knowledge);
  const knowledgeFields = new Set([
    "text",
    "scope",
    "owner_actor_id",
    "shared_actor_ids",
    "visibility",
    "reveal_event",
    "sayability",
    "visuality",
    "salience",
  ]);
  for (const [knowledgeIndex, knowledge] of knowledgeRows.entries()) {
    const label = `location ${location.id} knowledge ${knowledgeIndex}`;
    if (!isObject(knowledge)) {
      fail(`${label} must be an object`);
      continue;
    }
    for (const field of Object.keys(knowledge)) {
      if (!knowledgeFields.has(field)) fail(`${label} has unknown field ${field}`);
    }
    if (!isNonEmptyString(knowledge.text) || [...knowledge.text].length > 500) {
      fail(`${label} text must contain 1-500 characters`);
    }
    if (knowledge.scope !== undefined
        && !["self", "relationship", "room", "location", "world"].includes(knowledge.scope)) {
      fail(`${label} has invalid scope ${knowledge.scope}`);
    }
    if (knowledge.visibility !== undefined
        && !["private", "shared", "public", "revealed_after_event"].includes(knowledge.visibility)) {
      fail(`${label} has invalid visibility ${knowledge.visibility}`);
    }
    if (knowledge.sayability !== undefined
        && !["influence_only", "disclosable", "sealed"].includes(knowledge.sayability)) {
      fail(`${label} has invalid sayability ${knowledge.sayability}`);
    }
    if (knowledge.visuality !== undefined
        && !["visible", "subtext_only", "never_render"].includes(knowledge.visuality)) {
      fail(`${label} has invalid visuality ${knowledge.visuality}`);
    }
    if (knowledge.salience !== undefined
        && (!Number.isInteger(knowledge.salience) || knowledge.salience < 0 || knowledge.salience > 100)) {
      fail(`${label} salience must be an integer from 0 to 100`);
    }
    if (knowledge.owner_actor_id !== undefined
        && (!Number.isInteger(knowledge.owner_actor_id) || knowledge.owner_actor_id <= 0)) {
      fail(`${label} owner_actor_id must be a positive integer`);
    }
    if (knowledge.shared_actor_ids !== undefined
        && (!Array.isArray(knowledge.shared_actor_ids)
          || knowledge.shared_actor_ids.length === 0
          || knowledge.shared_actor_ids.some((actorId) => !Number.isInteger(actorId) || actorId <= 0))) {
      fail(`${label} shared_actor_ids must contain positive integers`);
    }
    if (knowledge.visibility === "private" && knowledge.owner_actor_id === undefined) {
      fail(`${label} private knowledge needs owner_actor_id`);
    }
    if (knowledge.visibility === "shared"
        && (!Array.isArray(knowledge.shared_actor_ids) || knowledge.shared_actor_ids.length === 0)) {
      fail(`${label} shared knowledge needs shared_actor_ids`);
    }
    if (knowledge.visibility === "revealed_after_event" && !isNonEmptyString(knowledge.reveal_event)) {
      fail(`${label} revealed_after_event knowledge needs reveal_event`);
    }
  }
  if (typeof location.allow_combat !== "boolean") {
    fail(`location ${location.id} must declare allow_combat`);
  }
  if (
    location.interior_view !== undefined
    && !["hex", "close", "isometric"].includes(location.interior_view)
  ) {
    fail(`location ${location.id} has invalid interior_view ${location.interior_view}`);
  }
  const pack = packs.find((candidate) => candidate.id === location.pack_id);
  if (location.ruleset !== undefined
      && (!pack || !packDeclaresRuleset(pack, location.ruleset))) {
    fail(`location ${location.id} selects unavailable ruleset ${location.ruleset}`);
  }
  for (const error of naturalAffordanceValidationErrors(
    location,
    `location ${location.id}`,
  )) {
    fail(error);
  }
}

const exitPairs = new Set();
const exitOwnerByEndpoints = new Map();
const exitsByPair = new Map();
const maximumAuthoredPathwayDistance = 89;
for (const exit of exits) {
  if (!has(locationIds, exit.from_location_id) || !has(locationIds, exit.to_location_id)) {
    fail(`exit ${exit.from_location_id}->${exit.to_location_id} references missing location`);
  }
  if (exit.from_location_id === exit.to_location_id) {
    fail(`exit ${exit.from_location_id}->${exit.to_location_id} cannot return to the same location`);
  }
  const distance = exit.distance ?? 1;
  if (
    !Number.isInteger(distance)
    || distance < 1
    || distance > maximumAuthoredPathwayDistance
  ) {
    fail(`exit ${exit.from_location_id}->${exit.to_location_id} has invalid distance ${exit.distance}`);
  }
  const directionality = exit.directionality ?? "reciprocal";
  if (!["reciprocal", "one_way"].includes(directionality)) {
    fail(`exit ${exit.from_location_id}->${exit.to_location_id} has invalid directionality ${directionality}`);
  }
  if (!isNonEmptyString(exit.direction)) {
    fail(`exit ${exit.from_location_id}->${exit.to_location_id} must declare a direction`);
  }
  if (directionality === "one_way") {
    if (!Number.isInteger(exit.fallback_location_id)
        || !has(locationIds, exit.fallback_location_id)) {
      fail(`one-way exit ${exit.from_location_id}->${exit.to_location_id} must declare a valid fallback_location_id`);
    }
  } else if (exit.fallback_location_id !== undefined) {
    fail(`reciprocal exit ${exit.from_location_id}->${exit.to_location_id} must not declare fallback_location_id`);
  }
  const fromPackId = locationPackById.get(exit.from_location_id);
  const toPackId = locationPackById.get(exit.to_location_id);
  if (fromPackId && toPackId && fromPackId !== toPackId) {
    const owner = packById.get(exit.pack_id);
    if (owner?.extensions?.["x-cosyworld-composition"]?.role !== "bridge") {
      fail(`exit ${exit.from_location_id}->${exit.to_location_id} crosses ${fromPackId} and ${toPackId} outside a composition bridge pack`);
    } else {
      const dependencyIds = new Set(owner.dependencies);
      if (!dependencyIds.has(fromPackId) || !dependencyIds.has(toPackId)) {
        fail(`composition bridge ${owner.id} must depend on both ${fromPackId} and ${toPackId}`);
      }
    }
  }
  const pair = `${exit.from_location_id}->${exit.to_location_id}`;
  if (exitPairs.has(pair)) {
    fail(`duplicate exit ${pair}`);
  }
  exitPairs.add(pair);
  exitsByPair.set(pair, exit);
  const endpointKey = [
    Number(exit.from_location_id),
    Number(exit.to_location_id),
  ].sort((left, right) => left - right).join(":");
  const reciprocalOwner = exitOwnerByEndpoints.get(endpointKey);
  if (reciprocalOwner !== undefined && reciprocalOwner !== exit.pack_id) {
    fail(
      `reciprocal exits between ${endpointKey} have different owners ${reciprocalOwner} and ${exit.pack_id}`,
    );
  } else {
    exitOwnerByEndpoints.set(endpointKey, exit.pack_id);
  }
}

for (const exit of exits) {
  const pair = `${exit.from_location_id}->${exit.to_location_id}`;
  const reverse = exitsByPair.get(`${exit.to_location_id}->${exit.from_location_id}`);
  const directionality = exit.directionality ?? "reciprocal";
  if (directionality === "reciprocal" && !reverse) {
    fail(`reciprocal exit ${pair} is missing its return direction`);
  } else if (directionality === "reciprocal"
      && reverse
      && (reverse.directionality ?? "reciprocal") !== "reciprocal") {
    fail(`reciprocal exit ${pair} has a one-way return`);
  } else if (directionality === "reciprocal"
      && reverse
      && (reverse.distance ?? 1) !== (exit.distance ?? 1)) {
    fail(`reciprocal exits ${pair} and ${exit.to_location_id}->${exit.from_location_id} have different distances`);
  } else if (directionality === "one_way" && reverse) {
    fail(`one-way exit ${pair} must not declare a reciprocal edge`);
  }
}

for (const bundle of contributionBundles) {
  for (const offer of bundle.offers ?? []) {
    if (offer.cooperation?.kind !== "local_lead") continue;
    const destinationId = offer.cooperation.destination_location_id;
    const originId = Number(offer.subject?.id);
    if (!has(locationIds, destinationId)
        || originId === destinationId
        || !exitPairs.has(`${originId}->${destinationId}`)) {
      fail(`contextual offer ${offer.id} local lead must name an authored outbound destination`);
    }
  }
}

const featureKeys = new Set();
for (const feature of roomFeatures) {
  validateRequiredStrings("room feature", feature, ["key", "name", "look", "search"]);
  for (const error of roomFeatureSchemaValidationErrors(
    feature,
    `room feature ${feature.location_id}:${feature.key}`,
  )) {
    fail(error);
  }
  if (!has(locationIds, feature.location_id)) {
    fail(`feature ${feature.key} references missing location ${feature.location_id}`);
  }
  const featureKey = `${feature.location_id}:${feature.key}`;
  if (featureKeys.has(featureKey)) {
    fail(`duplicate feature ${featureKey}`);
  }
  featureKeys.add(featureKey);
  for (const use of feature.uses ?? []) {
    if (!has(itemIds, use.item_id) || !isNonEmptyString(use.text)) {
      fail(`feature ${feature.key} has invalid use for item ${use.item_id}`);
    }
  }
}

const hiddenExitIds = new Set();
for (const hiddenExit of hiddenExits) {
  validateRequiredStrings("hidden exit", hiddenExit, ["id", "feature_key", "direction", "return_direction", "source", "discovery_text"]);
  if (hiddenExitIds.has(hiddenExit.id)) {
    fail(`duplicate hidden exit ${hiddenExit.id}`);
  }
  hiddenExitIds.add(hiddenExit.id);
  if (!has(locationIds, hiddenExit.from_location_id) || !has(locationIds, hiddenExit.to_location_id)) {
    fail(`hidden exit ${hiddenExit.id} references missing location`);
  }
  const fromPackId = locationPackById.get(hiddenExit.from_location_id);
  const toPackId = locationPackById.get(hiddenExit.to_location_id);
  if (fromPackId && toPackId && fromPackId !== toPackId) {
    const owner = packById.get(hiddenExit.pack_id);
    if (owner?.extensions?.["x-cosyworld-composition"]?.role !== "bridge") {
      fail(`hidden exit ${hiddenExit.id} crosses ${fromPackId} and ${toPackId} outside a composition bridge pack`);
    } else {
      const dependencyIds = new Set(owner.dependencies);
      if (!dependencyIds.has(fromPackId) || !dependencyIds.has(toPackId)) {
        fail(`composition bridge ${owner.id} must depend on both ${fromPackId} and ${toPackId}`);
      }
    }
  }
  if (hiddenExit.from_location_id === hiddenExit.to_location_id) {
    fail(`hidden exit ${hiddenExit.id} cannot return to the same location`);
  }
  if (!Number.isInteger(hiddenExit.reveal_chance_percent) || hiddenExit.reveal_chance_percent < 1 || hiddenExit.reveal_chance_percent > 100) {
    fail(`hidden exit ${hiddenExit.id} has invalid reveal chance`);
  }
  const featureKey = `${hiddenExit.from_location_id}:${hiddenExit.feature_key}`;
  if (!featureKeys.has(featureKey)) {
    fail(`hidden exit ${hiddenExit.id} references missing feature ${featureKey}`);
  }
}

for (const error of routeDirectionValidationErrors(exits, hiddenExits)) {
  fail(error);
}
for (const error of routeDiscoveryValidationErrors(exits)) {
  fail(error);
}

const entryLocationMatch = String(manifest.entry_location).match(/location\/(\d+)$/);
const entryLocationId = Number(entryLocationMatch?.[1] ?? 0);
const topologyAdjacency = new Map(
  [...locationIds].map((locationId) => [locationId, new Set()]),
);
const topologyUndirected = new Map(
  [...locationIds].map((locationId) => [locationId, new Set()]),
);
function addTopologyEdge(fromLocationId, toLocationId) {
  topologyAdjacency.get(fromLocationId)?.add(toLocationId);
  topologyUndirected.get(fromLocationId)?.add(toLocationId);
  topologyUndirected.get(toLocationId)?.add(fromLocationId);
}
for (const exit of exits) addTopologyEdge(exit.from_location_id, exit.to_location_id);
for (const hiddenExit of hiddenExits) {
  addTopologyEdge(hiddenExit.from_location_id, hiddenExit.to_location_id);
  addTopologyEdge(hiddenExit.to_location_id, hiddenExit.from_location_id);
}

function publicAuthoredTopology(removedPackIds = new Set()) {
  const adjacency = new Map();
  for (const locationId of locationIds) {
    const locationPackId = locationPackById.get(locationId);
    if (!removedPackIds.has(locationPackId) && !gateByLocationId.has(locationId)) {
      adjacency.set(locationId, new Set());
    }
  }
  for (const exit of exits) {
    if (removedPackIds.has(exit.pack_id)
        || !adjacency.has(exit.from_location_id)
        || !adjacency.has(exit.to_location_id)) {
      continue;
    }
    adjacency.get(exit.from_location_id).add(exit.to_location_id);
  }
  return adjacency;
}

function canReachInTopology(adjacency, startLocationId, destinationLocationId) {
  if (!adjacency.has(startLocationId) || !adjacency.has(destinationLocationId)) {
    return false;
  }
  const pending = [startLocationId];
  const visited = new Set([startLocationId]);
  while (pending.length > 0) {
    const locationId = pending.shift();
    if (locationId === destinationLocationId) return true;
    for (const nextLocationId of adjacency.get(locationId) ?? []) {
      if (!visited.has(nextLocationId)) {
        visited.add(nextLocationId);
        pending.push(nextLocationId);
      }
    }
  }
  return false;
}

const topologyRoots = new Map();
for (const pack of packs) {
  for (const entryPoint of pack.entry_points ?? []) {
    if (entryPoint.kind !== "location") continue;
    const match = String(entryPoint.id).match(/^location\/([1-9]\d*)$/);
    const locationId = Number(match?.[1] ?? 0);
    if (!match || !has(locationIds, locationId)
        || locationPackById.get(locationId) !== pack.id) {
      fail(`pack ${pack.id} has invalid topology root ${entryPoint.id}`);
      continue;
    }
    topologyRoots.set(locationId, pack.id);
  }
}
if (has(locationIds, entryLocationId)) {
  topologyRoots.set(entryLocationId, locationPackById.get(entryLocationId));
}

function canReachTopologyRoot(startLocationId, candidateRoots) {
  const pending = [startLocationId];
  const visited = new Set([startLocationId]);
  while (pending.length > 0) {
    const locationId = pending.shift();
    if (candidateRoots.has(locationId)) return true;
    for (const nextLocationId of topologyAdjacency.get(locationId) ?? []) {
      if (!visited.has(nextLocationId)) {
        visited.add(nextLocationId);
        pending.push(nextLocationId);
      }
    }
  }
  return false;
}

const unmountPolicyPackIds = new Set(
  (manifest.pack_lifecycle?.unmount ?? []).map((policy) => policy.pack_id),
);
const unvisitedTopologyLocations = new Set(locationIds);
while (unvisitedTopologyLocations.size > 0) {
  const firstLocationId = unvisitedTopologyLocations.values().next().value;
  const component = new Set([firstLocationId]);
  const pending = [firstLocationId];
  unvisitedTopologyLocations.delete(firstLocationId);
  while (pending.length > 0) {
    const locationId = pending.shift();
    for (const nextLocationId of topologyUndirected.get(locationId) ?? []) {
      if (unvisitedTopologyLocations.delete(nextLocationId)) {
        component.add(nextLocationId);
        pending.push(nextLocationId);
      }
    }
  }
  const componentRoots = new Set(
    [...component].filter((locationId) => topologyRoots.has(locationId)),
  );
  if (componentRoots.size === 0) {
    fail(`isolated topology component ${[...component].sort((left, right) => left - right).join(",")} has no declared entry root`);
    continue;
  }
  if (!component.has(entryLocationId)) {
    const componentPackIds = new Set(
      [...component].map((locationId) => locationPackById.get(locationId)),
    );
    for (const packId of componentPackIds) {
      if (!unmountPolicyPackIds.has(packId)) {
        fail(`isolated topology component rooted at ${[...componentRoots].join(",")} has no exit/evacuation policy for ${packId}`);
      }
    }
  }
  for (const locationId of component) {
    if (!canReachTopologyRoot(locationId, componentRoots)) {
      fail(`location ${locationId} has no directed return/egress path to a topology root`);
    }
  }
}

for (const exit of exits.filter((candidate) =>
  (candidate.directionality ?? "reciprocal") === "one_way")) {
  if (!canReachInTopology(
    publicAuthoredTopology(),
    exit.to_location_id,
    exit.fallback_location_id,
  )) {
    fail(`one-way exit ${exit.from_location_id}->${exit.to_location_id} cannot reach fallback ${exit.fallback_location_id} over public authored topology`);
  }
}

for (const policy of manifest.pack_lifecycle?.unmount ?? []) {
  const destinationId = Number(policy.evacuation?.destination_location_id);
  const survivingTopology = publicAuthoredTopology(
    dependentUnmountClosure(policy.pack_id),
  );
  if (has(locationIds, destinationId)
      && has(locationIds, entryLocationId)
      && !canReachInTopology(survivingTopology, destinationId, entryLocationId)) {
    fail(`worldpack pack_lifecycle ${policy.pack_id} evacuation destination has no surviving public authored egress to world root ${entryLocationId}`);
  }
}
const publicReachableLocationIds = new Set();
if (worldBearingPacks.length === 0 && locationIds.size === 0) {
  // A services-only composition intentionally has no playable entry point.
} else if (!has(locationIds, entryLocationId)) {
  fail(`worldpack entry location ${manifest.entry_location} does not reference a compiled location`);
} else if (gateByLocationId.has(entryLocationId)) {
  const entryGate = gateByLocationId.get(entryLocationId);
  if (manifest.entry_grant_id !== entryGate.required_grant_id) {
    fail(`worldpack entry location ${entryLocationId} must be public or declare entry_grant_id ${entryGate.required_grant_id}`);
  } else {
    publicReachableLocationIds.add(entryLocationId);
  }
} else {
  if (manifest.entry_grant_id !== undefined) {
    fail(`worldpack public entry location ${entryLocationId} must not declare entry_grant_id`);
  }
  publicReachableLocationIds.add(entryLocationId);
  const pendingLocations = [entryLocationId];
  const traversableExits = [
    ...exits,
    ...hiddenExits.map((hiddenExit) => ({
      from_location_id: hiddenExit.from_location_id,
      to_location_id: hiddenExit.to_location_id,
    })),
  ];
  while (pendingLocations.length > 0) {
    const fromLocationId = pendingLocations.shift();
    for (const exit of traversableExits) {
      if (
        exit.from_location_id !== fromLocationId
        || gateByLocationId.has(exit.to_location_id)
        || publicReachableLocationIds.has(exit.to_location_id)
      ) {
        continue;
      }
      publicReachableLocationIds.add(exit.to_location_id);
      pendingLocations.push(exit.to_location_id);
    }
  }
}

function validateProgressionLocationAccess(owner, locationId, requiredGrantId) {
  if (publicReachableLocationIds.has(locationId)) {
    if (requiredGrantId !== undefined && !entitlementGrants.has(requiredGrantId)) {
      fail(`${owner} declares missing required_grant_id ${requiredGrantId}`);
    }
    return;
  }

  const directGate = gateByLocationId.get(locationId);
  if (!isNonEmptyString(requiredGrantId)) {
    fail(`${owner} uses gated or unreachable location ${locationId} without required_grant_id`);
    return;
  }
  if (!entitlementGrants.has(requiredGrantId)) {
    fail(`${owner} declares missing required_grant_id ${requiredGrantId}`);
  }
  if (directGate && directGate.required_grant_id !== requiredGrantId) {
    fail(`${owner} required_grant_id ${requiredGrantId} does not match location ${locationId} gate ${directGate.required_grant_id}`);
  }
}

const sheetLocations = new Set();
for (const sheet of roomSheets) {
  validateRequiredStrings("room sheet", sheet, ["id", "name", "safety", "zone"]);
  if (!has(locationIds, sheet.location_id)) {
    fail(`room sheet ${sheet.id} references missing location ${sheet.location_id}`);
  }
  if (sheetLocations.has(sheet.location_id)) {
    fail(`duplicate room sheet for location ${sheet.location_id}`);
  }
  sheetLocations.add(sheet.location_id);
  if (!["safe", "risky", "dangerous"].includes(sheet.safety)) {
    fail(`room sheet ${sheet.id} has invalid safety ${sheet.safety}`);
  }
  if (!["sanctuary", "frontier"].includes(sheet.zone)) {
    fail(`room sheet ${sheet.id} has invalid zone ${sheet.zone}`);
  }
  for (const field of ["aspects", "boons", "hooks"]) {
    if (!Array.isArray(sheet[field]) || sheet[field].length === 0 || sheet[field].some((entry) => !isNonEmptyString(entry))) {
      fail(`room sheet ${sheet.id} must have non-empty ${field}`);
    }
  }
  if (!isObject(sheet.resources) || Object.keys(sheet.resources).length === 0) {
    fail(`room sheet ${sheet.id} must declare resources`);
  } else {
    for (const [resource, amount] of Object.entries(sheet.resources)) {
      if (!isNonEmptyString(resource) || !Number.isInteger(amount)) {
        fail(`room sheet ${sheet.id} has invalid resource ${resource}`);
      }
    }
  }
  for (const projectId of sheet.projects ?? []) {
    if (!has(jobIds, projectId)) {
      fail(`room sheet ${sheet.id} references missing project ${projectId}`);
    }
  }
}
for (const location of locations) {
  if (!sheetLocations.has(location.id)) {
    fail(`location ${location.id} (${location.name}) is missing a room sheet`);
  }
  const sheet = roomSheets.find((candidate) => candidate.location_id === location.id);
  if (location.allow_combat && sheet && sheet.zone !== "frontier") {
    fail(`combat-capable location ${location.id} must use a frontier room sheet`);
  }
}

for (const clock of clocks) {
  validateRequiredStrings("clock", clock, ["id", "scope", "kind", "zone", "label"]);
  if (!Number.isInteger(clock.segments) || clock.segments <= 0 || !Number.isInteger(clock.filled) || clock.filled > clock.segments) {
    fail(`clock ${clock.id} has invalid fill state`);
  }
  if (clock.scope === "room" && !has(locationIds, clock.scope_id)) {
    fail(`clock ${clock.id} references missing room ${clock.scope_id}`);
  }
  if (clock.on_fill !== undefined && !Array.isArray(clock.on_fill)) {
    fail(`clock ${clock.id} on_fill must be an array`);
  }
  if (clock.visible_to_players) {
    const presentation = clock.presentation;
    if (
      !isObject(presentation)
      || presentation.version !== 1
      || !isNonEmptyString(presentation.question)
      || ![
        "immediate",
        "session",
        "multi_session",
        "construction",
        "civic",
        "seasonal",
      ].includes(presentation.rhythm)
      || !["immediate", "local", "communal", "background"].includes(
        presentation.attention,
      )
      || !Number.isInteger(presentation.priority)
      || presentation.priority < 0
      || presentation.priority > 100
      || !isNonEmptyString(presentation.situation)
      || !isNonEmptyString(presentation.stakes)
      || !isNonEmptyString(presentation.outcome)
      || !isNonEmptyString(presentation.completion_memory)
    ) {
      fail(`player-visible clock ${clock.id} has invalid presentation v1`);
    }
  }
}

for (const job of jobs) {
  validateRequiredStrings("job", job, ["id", "premise", "stakes", "progress_clock_id", "danger_clock_id", "consequence"]);
  validateJobReward(job);
  if (job.action_copy !== undefined
      && (!isObject(job.action_copy)
        || !isNonEmptyString(job.action_copy.label)
        || !isNonEmptyString(job.action_copy.summary))) {
    fail(`job ${job.id} has invalid action_copy`);
  }
  if (!has(clockIds, job.progress_clock_id) || !has(clockIds, job.danger_clock_id)) {
    fail(`job ${job.id} references missing clock`);
  }
  if (job.delivery !== undefined) {
    const delivery = job.delivery;
    const requirement = delivery?.requirement;
    const deliveryFields = new Set([
      "resource",
      "origin_location_id",
      "destination_location_id",
      "requirement",
      "created_world_tick",
      "updated_world_tick",
    ]);
    if (!isObject(delivery)
        || Object.keys(delivery).some((field) => !deliveryFields.has(field))
        || !isNonEmptyString(delivery.resource)
        || !has(locationIds, delivery.origin_location_id)
        || !has(locationIds, delivery.destination_location_id)
        || !Number.isSafeInteger(delivery.created_world_tick)
        || delivery.created_world_tick < 0
        || !Number.isSafeInteger(delivery.updated_world_tick)
        || delivery.updated_world_tick < delivery.created_world_tick
        || !isObject(requirement)) {
      fail(`job ${job.id} has an invalid typed delivery specification`);
    } else {
      const expectedFields = {
        exact_item: new Set(["kind", "item_id"]),
        exact_template: new Set(["kind", "template_id"]),
        item_tag: new Set(["kind", "tag"]),
      }[requirement.kind];
      const matcherIsValid = expectedFields !== undefined
        && Object.keys(requirement).every((field) => expectedFields.has(field))
        && Object.keys(requirement).length === expectedFields.size
        && (
          (requirement.kind === "exact_item" && has(itemIds, requirement.item_id))
          || (requirement.kind === "exact_template"
            && mountedLootTemplateIds.has(requirement.template_id))
          || (requirement.kind === "item_tag"
            && mountedLootDeliveryTags.has(requirement.tag))
        );
      if (!matcherIsValid) {
        fail(`job ${job.id} has an unsupported delivery matcher`);
      }
    }
  }
  if (job.contribution_schema_version !== 1
      || !Array.isArray(job.contribution_strategies)
      || job.contribution_strategies.length === 0) {
    fail(`job ${job.id} is missing contribution schema v1`);
  }
  for (const strategy of job.contribution_strategies ?? []) {
    if (!routableJobContributionActionKinds.has(strategy.action_kind)) {
      fail(`job ${job.id} strategy ${strategy.id} has unroutable action_kind ${strategy.action_kind}`);
      continue;
    }
    const ownerPack = packs.find((candidate) => candidate.id === strategy.pack_id);
    const rulesPack = packs.find((candidate) => candidate.id === strategy.rules_pack_id);
    if (strategy.pack_id !== job.pack_id
        || ownerPack?.version !== strategy.pack_version
        || strategy.rules_profile !== manifest.rules_profile
        || rulesPack?.version !== strategy.rules_pack_version) {
      fail(`job ${job.id} strategy ${strategy.id} has stale pack or rules provenance`);
    }
    const resolutionKind = strategy.resolution?.kind;
    if (["work", "help"].includes(strategy.action_kind) && resolutionKind !== "certain") {
      fail(`job ${job.id} strategy ${strategy.id} must use certain resolution`);
    }
    if (["check", "study"].includes(strategy.action_kind)
        && (resolutionKind !== "srd_check"
          || !isNonEmptyString(strategy.resolution?.ability)
          || !Number.isInteger(strategy.resolution?.dc)
          || strategy.resolution.dc <= 0)) {
      fail(`job ${job.id} strategy ${strategy.id} must supply an SRD ability and DC`);
    }
    if (strategy.action_kind === "use_item"
        && (resolutionKind !== "existing_kernel_outcome"
          || strategy.resolution?.event_type !== "item.used"
          || strategy.target?.kind !== "item"
          || !isNonEmptyString(strategy.target?.id))) {
      fail(`job ${job.id} strategy ${strategy.id} must target an item.used outcome`);
    }
    for (const requirement of strategy.requirements ?? []) {
      const locationId = requirement.location_id;
      const feature = roomFeatures.find((candidate) =>
        candidate.location_id === locationId
        && candidate.key === requirement.feature_key);
      let valid = false;
      switch (requirement.kind) {
        case "at_location":
          valid = has(locationIds, locationId)
            && (job.location_ids ?? []).includes(locationId);
          break;
        case "held_item":
          valid = has(itemIds, requirement.item_id);
          break;
        case "active_tag":
          valid = isNonEmptyString(requirement.tag_id);
          break;
        case "room_feature":
        case "feature_searched":
          valid = (job.location_ids ?? []).includes(locationId)
            && feature !== undefined;
          break;
        case "feature_used":
          valid = has(itemIds, requirement.item_id)
            && (job.location_ids ?? []).includes(locationId)
            && feature?.uses?.some((use) => use.item_id === requirement.item_id);
          break;
        case "encounter_resolved": {
          const encounterJob = jobs.find((candidate) =>
            candidate.id === requirement.job_id);
          valid = [1, 2].includes(requirement.winning_side)
            && encounterJob !== undefined
            && (encounterJob.location_ids ?? []).some((encounterLocationId) =>
              locations.some((location) =>
                location.id === encounterLocationId && location.allow_combat)
              && (encounterJob.participant_ids ?? []).some((actorId) =>
                actorById.get(actorId)?.location_id === encounterLocationId));
          break;
        }
        default:
          valid = false;
      }
      if (!valid) {
        fail(`job ${job.id} strategy ${strategy.id} has invalid ${requirement.kind} requirement`);
      }
    }
  }
  for (const locationId of job.location_ids ?? []) {
    if (!has(locationIds, locationId)) {
      fail(`job ${job.id} references missing location ${locationId}`);
    }
  }
  for (const actorId of job.participant_ids ?? []) {
    if (!has(actorIds, actorId)) {
      fail(`job ${job.id} references missing participant ${actorId}`);
    }
  }
}

for (const location of locations) {
  if (!location.allow_combat) continue;
  const hasLocalEncounter = jobs.some((job) => {
    const active = !isNonEmptyString(job.status) || job.status === "active";
    return active
      && (job.location_ids ?? []).includes(location.id)
      && (job.participant_ids ?? []).some((actorId) => actorById.get(actorId)?.location_id === location.id);
  });
  if (!hasLocalEncounter) {
    warn(`combat-capable location ${location.id} (${location.name}) has no active job with a participant in the room`);
  }
}

for (const front of fronts) {
  validateRequiredStrings("front", front, ["id", "premise", "zone", "status", "portent_clock_id", "impending_outcome"]);
  if (!["frontier"].includes(front.zone)) {
    fail(`front ${front.id} must use frontier zone`);
  }
  if (!["active", "dormant", "completed", "failed"].includes(front.status)) {
    fail(`front ${front.id} has invalid status ${front.status}`);
  }
  if (!has(clockIds, front.portent_clock_id)) {
    fail(`front ${front.id} references missing portent clock ${front.portent_clock_id}`);
  } else {
    const clock = clocks.find((candidate) => candidate.id === front.portent_clock_id);
    if (clock?.zone !== "frontier" || clock?.kind !== "danger") {
      fail(`front ${front.id} portent clock must be a frontier danger clock`);
    }
  }
  if (!Array.isArray(front.location_ids) || front.location_ids.length === 0) {
    fail(`front ${front.id} must reference at least one location`);
  }
  for (const locationId of front.location_ids ?? []) {
    if (!has(locationIds, locationId)) {
      fail(`front ${front.id} references missing location ${locationId}`);
    }
    const sheet = roomSheets.find((candidate) => candidate.location_id === locationId);
    if (sheet?.zone !== "frontier") {
      fail(`front ${front.id} location ${locationId} must be frontier`);
    }
  }
  if (!Array.isArray(front.participant_ids) || front.participant_ids.length === 0) {
    fail(`front ${front.id} must reference at least one participant`);
  }
  for (const actorId of front.participant_ids ?? []) {
    if (!has(actorIds, actorId)) {
      fail(`front ${front.id} references missing participant ${actorId}`);
    }
  }
  if (!Array.isArray(front.job_ids) || front.job_ids.length === 0) {
    fail(`front ${front.id} must spawn at least one job`);
  }
  for (const jobId of front.job_ids ?? []) {
    if (!has(jobIds, jobId)) {
      fail(`front ${front.id} references missing job ${jobId}`);
    }
  }
  if (!Array.isArray(front.stakes_questions) || front.stakes_questions.length === 0 || front.stakes_questions.some((question) => !isNonEmptyString(question))) {
    fail(`front ${front.id} must declare stakes questions`);
  }
}

const cardIds = new Set();
const cardSubjects = new Set();
for (const card of cards) {
  validateRequiredStrings("card", card, ["subject_kind", "card_id", "display_name", "role", "rarity", "title", "blurb", "aspect", "source", "asset_status"]);
  if (cardIds.has(card.card_id)) {
    fail(`duplicate card id ${card.card_id}`);
  }
  cardIds.add(card.card_id);
  const subjectKey = `${card.subject_kind}:${card.subject_id}`;
  if (cardSubjects.has(subjectKey)) {
    fail(`duplicate card subject ${subjectKey}`);
  }
  cardSubjects.add(subjectKey);
  const subjectExists =
    (card.subject_kind === "actor" && has(actorIds, card.subject_id)) ||
    (card.subject_kind === "item" && has(itemIds, card.subject_id)) ||
    (card.subject_kind === "location" && has(locationIds, card.subject_id));
  if (!subjectExists) {
    fail(`card ${card.card_id} references missing ${card.subject_kind} ${card.subject_id}`);
  }
  if (card.asset_status !== "generated_art") continue;
  if (!isNonEmptyString(card.image_url)) {
    fail(`generated-art card ${card.card_id} is missing image_url`);
    continue;
  }
  const matchingMounts = assetMounts.filter((mount) => (
    mount.pack_id === card.pack_id
      && (card.image_url === mount.public_prefix
        || card.image_url.startsWith(`${mount.public_prefix}/`))
  ));
  if (matchingMounts.length !== 1) {
    fail(`generated-art card ${card.card_id} image_url is not owned by exactly one pack asset mount`);
    continue;
  }
  const mount = matchingMounts[0];
  if (mount.optional) continue;
  const assetDirectory = path.resolve(contentRoot, "..", mount.root, mount.directory);
  const relativeAssetPath = card.image_url.slice(mount.public_prefix.length + 1);
  const assetPath = path.resolve(assetDirectory, relativeAssetPath);
  if (!assetPath.startsWith(`${assetDirectory}${path.sep}`)) {
    fail(`generated-art card ${card.card_id} image_url escapes its pack asset mount`);
  } else if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    fail(`generated-art card ${card.card_id} is missing required asset ${assetPath}`);
  }
}

const externalCardById = new Map(externalCards.map((card) => [card.card_id, card]));
for (const card of cards) {
  if (!card.external_card_id) continue;
  const externalCard = externalCardById.get(card.external_card_id);
  if (!externalCard) {
    fail(`card ${card.card_id} references missing external card ${card.external_card_id}`);
  } else if (externalCard.pack_id !== card.pack_id) {
    fail(`card ${card.card_id} may not bind an external card owned by ${externalCard.pack_id}`);
  }
}

idSet("card bindings", cardBindings, (binding) => binding.id);
const boundSeedCards = new Set();
const boundExternalCards = new Set();
for (const binding of cardBindings) {
  validateRequiredStrings("card binding", binding, [
    "id",
    "entity_ref",
    "subject_kind",
    "seed_card_id",
    "external_card_id",
  ]);
  const seedCard = cards.find((card) => card.card_id === binding.seed_card_id);
  if (!seedCard || seedCard.subject_kind !== binding.subject_kind || seedCard.subject_id !== binding.subject_id) {
    fail(`card binding ${binding.id} does not resolve seed card ${binding.seed_card_id}`);
    continue;
  }
  const subject = binding.subject_kind === "actor"
    ? actorById.get(binding.subject_id)
    : binding.subject_kind === "location"
      ? locations.find((location) => location.id === binding.subject_id)
      : binding.subject_kind === "item"
        ? items.find((item) => item.id === binding.subject_id)
        : null;
  if (!subject) {
    fail(`card binding ${binding.id} references missing ${binding.subject_kind} ${binding.subject_id}`);
  } else {
    const expectedRef = `pack://${subject.pack_id}/${binding.subject_kind}/${binding.subject_id}`;
    if (binding.entity_ref !== expectedRef) fail(`card binding ${binding.id} must use entity_ref ${expectedRef}`);
  }
  const externalCard = externalCardById.get(binding.external_card_id);
  if (!externalCard || externalCard.pack_id !== binding.pack_id) {
    fail(`card binding ${binding.id} must bind an external card owned by ${binding.pack_id}`);
  }
  if (boundSeedCards.has(binding.seed_card_id)) fail(`seed card ${binding.seed_card_id} has more than one external binding`);
  boundSeedCards.add(binding.seed_card_id);
  if (boundExternalCards.has(binding.external_card_id)) fail(`external card ${binding.external_card_id} binds more than one world entity`);
  boundExternalCards.add(binding.external_card_id);
}

for (const gate of accessGates) {
  if (!has(locationIds, gate.location_id) || !isNonEmptyString(gate.required_grant_id) || !isNonEmptyString(gate.reason)) {
    fail(`invalid access gate for location ${gate.location_id}`);
    continue;
  }
  const grant = entitlementGrants.get(gate.required_grant_id);
  if (!grant) {
    fail(`access gate for location ${gate.location_id} references missing grant ${gate.required_grant_id}`);
    continue;
  }
  const requiredAssetId = grant.match?.asset_id;
  if (gate.required_card_id !== undefined && gate.required_card_id !== requiredAssetId) {
    fail(`access gate for location ${gate.location_id} card compatibility id does not match grant ${gate.required_grant_id}`);
  }
  if (!requiredAssetId) continue;
  const card = cards.find((candidate) => candidate.card_id === requiredAssetId || candidate.external_card_id === requiredAssetId);
  if (!card) {
    fail(`access gate for location ${gate.location_id} references missing card ${requiredAssetId}`);
  } else if (card.subject_kind !== "location" || card.subject_id !== gate.location_id) {
    fail(`access gate for location ${gate.location_id} references non-matching card ${requiredAssetId}`);
  }
}

const factionIds = idSet("factions", factions, (faction) => faction.id);
for (const faction of factions) {
  validateRequiredStrings("faction", faction, ["id", "name", "axis", "truth", "shadow", "doctrine"]);
  if (faction.player_facing !== undefined && typeof faction.player_facing !== "boolean") {
    fail(`faction ${faction.id} player_facing must be a boolean`);
  }
  if ((faction.member_actor_ids ?? []).length === 0 && faction.player_facing !== true) {
    warn(`faction ${faction.id} has no member actors and is not marked player_facing`);
  }
  for (const locationId of faction.home_location_ids ?? []) {
    if (!has(locationIds, locationId)) {
      fail(`faction ${faction.id} references missing home location ${locationId}`);
    }
  }
  for (const actorId of faction.member_actor_ids ?? []) {
    if (!has(actorIds, actorId)) {
      fail(`faction ${faction.id} references missing member actor ${actorId}`);
    }
  }
  for (const opposedId of faction.opposes ?? []) {
    if (opposedId === faction.id || !has(factionIds, opposedId)) {
      fail(`faction ${faction.id} has invalid opposition ${opposedId}`);
    }
  }
}

idSet("actor facets", actorFacets, (facet) => facet.id);
const actorFacetKeys = new Set();
for (const facet of actorFacets) {
  validateRequiredStrings("actor facet", facet, ["id", "actor_ref"]);
  const actor = actorById.get(facet.actor_id);
  if (!actor) {
    fail(`actor facet ${facet.id} references missing actor ${facet.actor_id}`);
    continue;
  }
  const expectedRef = `pack://${actor.pack_id}/actor/${facet.actor_id}`;
  if (facet.actor_ref !== expectedRef) fail(`actor facet ${facet.id} must use actor_ref ${expectedRef}`);
  for (const factionId of asArray(`actor facet ${facet.id} faction_ids`, facet.faction_ids)) {
    if (!factions.some((faction) => faction.id === factionId)) {
      fail(`actor facet ${facet.id} references missing faction ${factionId}`);
    }
    const key = `${facet.actor_id}:${factionId}`;
    if (actorFacetKeys.has(key)) fail(`actor ${facet.actor_id} repeats faction facet ${factionId}`);
    actorFacetKeys.add(key);
  }
  if (!Array.isArray(facet.vocabulary) || facet.vocabulary.some((term) => !isNonEmptyString(term))) {
    fail(`actor facet ${facet.id} has invalid vocabulary`);
  }
}

const validHooks = new Set(["on_enter", "on_listen", "on_use", "on_give", "on_clock_fill"]);
const validClaimScopes = new Set(["", "event_once", "actor_target_once", "world_target_once"]);
const validTagScopes = new Set(["actor", "room", "resident", "faction", "job", "season", "shard"]);
const validTagKinds = new Set(["aspect", "condition", "memory", "bond", "boon", "hook"]);

function validateEffectDescriptor(owner, effect) {
  if (!isObject(effect) || !isNonEmptyString(effect.op)) {
    fail(`${owner} has invalid effect`);
    return;
  }
  if (!isNonEmptyString(effect.reason)) {
    fail(`${owner} effect ${effect.op} must declare reason`);
  }
  if (effect.op === "advance_clock") {
    if (!has(clockIds, effect.clock_id) || !Number.isInteger(effect.amount) || effect.amount <= 0) {
      fail(`${owner} has invalid clock effect ${effect.clock_id}`);
    }
  } else if (effect.op === "set_tag") {
    if (!isNonEmptyString(effect.tag_id) || !isNonEmptyString(effect.label) || !validTagScopes.has(effect.scope) || !validTagKinds.has(effect.kind)) {
      fail(`${owner} has invalid tag effect`);
    }
    if ((effect.scope === "actor" || effect.scope === "resident") && !has(actorIds, effect.scope_id)) {
      fail(`${owner} tag references missing actor ${effect.scope_id}`);
    }
    if (effect.scope === "room" && !has(locationIds, effect.scope_id)) {
      fail(`${owner} tag references missing room ${effect.scope_id}`);
    }
  } else if (effect.op === "clear_tag") {
    if (!isNonEmptyString(effect.tag_id)) {
      fail(`${owner} has invalid clear tag effect`);
    }
  } else if (effect.op === "set_job_status") {
    if (!has(jobIds, effect.job_id) || !["complete", "completed", "fail", "failed"].includes(effect.status)) {
      fail(`${owner} has invalid job status effect ${effect.job_id}`);
    }
  } else if (effect.op === "unlock_exit") {
    const exit = exits.find((candidate) =>
      candidate.from_location_id === effect.from_location_id
      && candidate.to_location_id === effect.to_location_id);
    if (!exit || (Number(exit.flags) & 1) === 0) {
      fail(
        `${owner} unlocks missing or initially unlocked exit `
        + `${effect.from_location_id}->${effect.to_location_id}`,
      );
    }
  } else if (effect.op === "reveal_item") {
    if (!has(itemIds, effect.item_id) || !has(locationIds, effect.location_id)) {
      fail(`${owner} has invalid reveal item effect ${effect.item_id}@${effect.location_id}`);
    }
  } else {
    fail(`${owner} has invalid effect op ${effect.op}`);
  }
}

for (const clock of clocks) {
  for (const effect of clock.on_fill ?? []) {
    validateEffectDescriptor(`clock ${clock.id} on_fill`, effect);
  }
}

for (const hook of lifecycleHooks) {
  if (!validHooks.has(hook.hook)) {
    fail(`invalid lifecycle hook ${hook.hook}`);
  }
  if (!validClaimScopes.has(hook.claim_scope ?? "")) {
    fail(`hook ${hook.hook} has invalid claim scope ${hook.claim_scope}`);
  }
  if (!Array.isArray(hook.effects) || hook.effects.length === 0) {
    fail(`hook ${hook.hook} has no effects`);
  }
  if (!Array.isArray(hook.requirements ?? [])) {
    fail(`hook ${hook.hook} requirements must be an array`);
  }
  if (hook.hook === "on_clock_fill" && (hook.requirements ?? []).length > 0) {
    fail(`hook ${hook.hook} cannot declare dynamic requirements`);
  }
  for (const requirement of hook.requirements ?? []) {
    if (
      !isObject(requirement)
      || requirement.kind !== "active_tag"
      || typeof requirement.tag_id !== "string"
      || requirement.tag_id.trim().length === 0
    ) {
      fail(`hook ${hook.hook} has an invalid active_tag requirement`);
    }
  }
  const targetId = Number(hook.target_id);
  if (hook.target_kind === "room" && !has(locationIds, targetId)) {
    fail(`hook ${hook.hook} references missing room ${hook.target_id}`);
  } else if (hook.target_kind === "actor" && !has(actorIds, targetId)) {
    fail(`hook ${hook.hook} references missing actor ${hook.target_id}`);
  } else if (hook.target_kind === "item" && !has(itemIds, targetId)) {
    fail(`hook ${hook.hook} references missing item ${hook.target_id}`);
  } else if (hook.target_kind === "clock" && !has(clockIds, hook.target_id)) {
    fail(`hook ${hook.hook} references missing clock ${hook.target_id}`);
  } else if (!["room", "actor", "item", "clock"].includes(hook.target_kind)) {
    fail(`hook ${hook.hook} has invalid target kind ${hook.target_kind}`);
  }
  for (const effect of hook.effects ?? []) {
    validateEffectDescriptor(`hook ${hook.hook}`, effect);
  }
}

for (const error of lanternClockEffectValidationErrors({
  clocks,
  lifecycleHooks,
  packs: manifest.packs,
})) {
  fail(error);
}

const allItemIds = new Set(itemIds);
const recipeOutputById = new Map();
const recipeIds = new Set();
for (const recipe of recipes) {
  if (!Number.isInteger(recipe.id) || recipe.id <= 0 || recipeIds.has(recipe.id)) {
    fail(`invalid or duplicate recipe ${recipe.id}`);
    continue;
  }
  recipeIds.add(recipe.id);
  validateRequiredStrings("recipe", recipe, ["key", "name", "description"]);
  if (recipe.schema_version !== 2) {
    fail(`recipe ${recipe.id} schema_version must be 2`);
    continue;
  }
  {
    for (const error of versionedRecipeValidationErrors(
      recipe,
      {
        templateIds: mountedLootTemplateIds,
        buildingArchetypes: mountedBuildingArchetypes,
        itemIds,
        actorIds,
        locationIds,
      },
      `recipe ${recipe.id}`,
    )) {
      fail(error);
    }
    const exactRecipe = (recipe.inputs ?? []).some((input) => Number.isInteger(input?.item_id));
    if (exactRecipe) {
      if (isObject(recipe.output)) {
        if (allItemIds.has(recipe.output.item_id)) {
          fail(`recipe ${recipe.id} has duplicate fixed output item ${recipe.output.item_id}`);
        } else {
          allItemIds.add(recipe.output.item_id);
          recipeOutputById.set(recipe.output.item_id, recipe.output);
        }
      }
      continue;
    }
    const provisionedSupply = recipe.output?.effect === "provisioned_supply";
    if (!Array.isArray(recipe.inputs)
        || recipe.inputs.length > 2
        || (recipe.inputs.length === 0 && !provisionedSupply)) {
      fail(`recipe ${recipe.id} must declare one or two physical inputs unless it provisions a supply`);
    }
    const inputTemplates = new Set();
    let physicalInputCount = 0;
    for (const input of recipe.inputs ?? []) {
      if (!isObject(input)
          || !isNonEmptyString(input.template_id)
          || !mountedLootTemplateIds.has(input.template_id)
          || inputTemplates.has(input.template_id)) {
        fail(`recipe ${recipe.id} has an orphan or duplicate input template ${input?.template_id}`);
      }
      inputTemplates.add(input?.template_id);
      if (!Number.isInteger(input?.quantity)
          || input.quantity < 1
          || input.quantity > 2) {
        fail(`recipe ${recipe.id} input ${input?.template_id} must use supported quantity 1 or 2`);
      } else {
        physicalInputCount += input.quantity;
      }
      if (!Number.isInteger(input?.min_charges ?? 0)
          || (input?.min_charges ?? 0) < 0
          || (input?.min_charges ?? 0) > 20) {
        fail(`recipe ${recipe.id} input ${input?.template_id} has invalid charge requirements`);
      }
      if (!Array.isArray(input?.zones)
          || input.zones.length === 0
          || new Set(input.zones).size !== input.zones.length
          || input.zones.some((zone) => !["carried", "world"].includes(zone))) {
        fail(`recipe ${recipe.id} input ${input?.template_id} has ambiguous zones`);
      }
      if (!["persistent", "exhaust", "transform"].includes(input?.disposition)) {
        fail(`recipe ${recipe.id} input ${input?.template_id} has undeclared consumption`);
      }
    }
    if (physicalInputCount > 2 || (physicalInputCount === 0 && !provisionedSupply)) {
      fail(`recipe ${recipe.id} must resolve to one or two physical items unless it provisions a supply`);
    }
    const requirements = recipe.requires;
    const buildingCapabilities = requirements?.building_capabilities ?? [];
    const buildingRecipeTags = requirements?.recipe_tags ?? [];
    const naturalFeatures = requirements?.natural_features ?? [];
    const locationFeatures = requirements?.location_features ?? [];
    if (!isObject(requirements)
        || !Array.isArray(buildingCapabilities)
        || !Array.isArray(buildingRecipeTags)
        || !Array.isArray(naturalFeatures)
        || !Array.isArray(locationFeatures)
        || (buildingCapabilities.length === 0
          && buildingRecipeTags.length === 0
          && naturalFeatures.length === 0
          && locationFeatures.length === 0)) {
      fail(`recipe ${recipe.id} has no physical place eligibility`);
    }
    if ((buildingCapabilities.length === 0) !== (buildingRecipeTags.length === 0)
        || (buildingCapabilities.length > 0
          && !buildingCapabilities.includes("transformation_recipes"))
        || buildingCapabilities.some(
          (capability) => !mountedBuildingCapabilities.has(capability),
        )) {
      fail(`recipe ${recipe.id} has missing or unknown capability tags`);
    }
    if (buildingRecipeTags.some((tag) => !mountedBuildingRecipeTags.has(tag))) {
      fail(`recipe ${recipe.id} has missing or unknown building recipe tags`);
    }
    if (buildingCapabilities.length > 0
        && !mountedBuildingArchetypes.some((archetype) =>
      buildingCapabilities.every(
        (capability) => (archetype.capabilities ?? []).includes(capability),
      )
      && buildingRecipeTags.every(
        (tag) => (archetype.recipe_tags ?? []).includes(tag),
      ))) {
      fail(`recipe ${recipe.id} has an impossible capability and recipe-tag combination`);
    }
    const validNaturalFeatures = new Set([
      "fish_rich_water",
      "ore_seam",
      "clay_bank",
      "ancient_woodland",
      "fast_river",
      "reliable_upland_wind",
      "hot_spring",
      "rich_soil",
      "rare_herb_habitat",
      "old_ruins",
    ]);
    if (!Array.isArray(naturalFeatures)
        || naturalFeatures.length > 1
        || naturalFeatures.some((feature) => !validNaturalFeatures.has(feature))) {
      fail(`recipe ${recipe.id} names ambiguous or unknown natural features`);
    }
    if (locationFeatures.length > 1
        || locationFeatures.some((feature) =>
          feature !== "generated_place_anchor_site"
          && feature !== "seed_room_feature:hearth")) {
      fail(`recipe ${recipe.id} names ambiguous or unknown location features`);
    }
    const output = recipe.output;
    if (!isObject(output) || !mountedLootTemplateIds.has(output?.template_id)) {
      fail(`recipe ${recipe.id} has an orphan output template ${output?.template_id}`);
    }
    if (!["actor_hand", "location_floor", "installed_at_location"].includes(output?.destination)) {
      fail(`recipe ${recipe.id} has impossible destination ${output?.destination}`);
    }
    if (output?.fallback_destination !== "location_floor") {
      fail(`recipe ${recipe.id} is missing a location_floor fallback`);
    }
    if (!["portable", "installed_fixture", "provisioned_supply"].includes(output?.effect)
        || !["per_receipt", "per_location", "per_world"].includes(output?.uniqueness)
        || (output?.destination === "installed_at_location"
          && output?.effect !== "installed_fixture")) {
      fail(`recipe ${recipe.id} has an invalid typed output effect`);
    }
    if (provisionedSupply
        && ((recipe.inputs ?? []).length !== 0
          || buildingCapabilities.length !== 0
          || buildingRecipeTags.length !== 0
          || naturalFeatures.length !== 0
          || locationFeatures.length !== 1
          || !locationFeatures[0].startsWith("seed_room_feature:"))) {
      fail(`recipe ${recipe.id} provisioned supply must be inputless and bound to one authored room feature`);
    }
    continue;
  }
}

const evolutionActors = new Set();
for (const track of evolutionTracks) {
  if (!has(actorIds, track.actor_id) || evolutionActors.has(track.actor_id)) {
    fail(`invalid or duplicate evolution track actor ${track.actor_id}`);
  }
  evolutionActors.add(track.actor_id);
  if (!Array.isArray(track.requirements) || track.requirements.length === 0 || track.requirements.length > 4) {
    fail(`evolution track ${track.actor_id} has invalid requirement count`);
  }
  const trackItemIds = new Set();
  for (const requirement of track.requirements ?? []) {
    if (!isObject(requirement)) {
      fail(`evolution track ${track.actor_id} has invalid requirement`);
      continue;
    }
    if (trackItemIds.has(requirement.item_id) || !has(allItemIds, requirement.item_id)) {
      fail(`evolution track ${track.actor_id} references missing item ${requirement.item_id}`);
    }
    trackItemIds.add(requirement.item_id);
    const sourceItem = itemById.get(requirement.item_id);
    if (sourceItem && has(locationIds, sourceItem.location_id)) {
      validateProgressionLocationAccess(
        `evolution track ${track.actor_id} requirement item ${requirement.item_id}`,
        sourceItem.location_id,
        requirement.required_grant_id,
      );
    }
    const targetKind = placementTargetKind(requirement.target_kind);
    if (!targetKind) {
      fail(`evolution track ${track.actor_id} has invalid target kind ${requirement.target_kind}`);
    } else if (targetKind === "actor_hand" && !has(actorIds, requirement.target_id)) {
      fail(`evolution track ${track.actor_id} references missing actor target ${requirement.target_id}`);
    } else if (targetKind === "location_floor" && !has(locationIds, requirement.target_id)) {
      fail(`evolution track ${track.actor_id} references missing location target ${requirement.target_id}`);
    }
    if (targetKind === "location_floor" && has(locationIds, requirement.target_id)) {
      validateProgressionLocationAccess(
        `evolution track ${track.actor_id} requirement target`,
        requirement.target_id,
        requirement.required_grant_id,
      );
    } else if (targetKind === "actor_hand" && has(actorIds, requirement.target_id)) {
      const targetActor = actors.find((actor) => actor.id === requirement.target_id);
      if (targetActor && has(locationIds, targetActor.location_id)) {
        validateProgressionLocationAccess(
          `evolution track ${track.actor_id} requirement target actor ${requirement.target_id}`,
          targetActor.location_id,
          requirement.required_grant_id,
        );
      }
    }
  }
}

function byNumberThenName(left, right) {
  const leftId = Number(left.id ?? left.location_id ?? left.scope_id ?? 0);
  const rightId = Number(right.id ?? right.location_id ?? right.scope_id ?? 0);
  if (leftId !== rightId) return leftId - rightId;
  return String(left.name ?? left.id ?? "").localeCompare(String(right.name ?? right.id ?? ""));
}

function sorted(rows, compare) {
  return [...rows].sort(compare);
}

function groupBy(rows, keyOf) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }
  return grouped;
}

function cardIdForSubject(subjectKind, subjectId) {
  return cards.find((card) => card.subject_kind === subjectKind && card.subject_id === subjectId)?.card_id ?? null;
}

function effectSummary(effect) {
  let summary;
  if (effect.op === "advance_clock") {
    summary = `advance ${effect.clock_id} +${effect.amount}`;
  } else if (effect.op === "set_tag") {
    summary = `set ${effect.scope}:${effect.scope_id} tag ${effect.label}`;
  } else if (effect.op === "clear_tag") {
    summary = `clear tag ${effect.tag_id}`;
  } else if (effect.op === "set_job_status") {
    summary = `set job ${effect.job_id} ${effect.status}`;
  } else if (effect.op === "unlock_exit") {
    summary = `unlock exit ${effect.from_location_id}->${effect.to_location_id}`;
  } else if (effect.op === "reveal_item") {
    summary = `reveal item ${effect.item_id} at ${effect.location_id}`;
  } else {
    summary = `unknown ${effect.op}`;
  }
  return isNonEmptyString(effect.reason) ? `${summary} (${effect.reason})` : summary;
}

function effectSummaries(effects) {
  return (effects ?? []).map(effectSummary);
}

function buildWorldpackReport() {
  const sheetByLocation = new Map(roomSheets.map((sheet) => [sheet.location_id, sheet]));
  const gateByLocation = new Map(accessGates.map((gate) => [gate.location_id, gate]));
  const actorsByLocation = groupBy(actors, (actor) => actor.location_id);
  const itemsByLocation = groupBy(items, (item) => item.location_id);
  const exitsByLocation = groupBy(exits, (exit) => exit.from_location_id);
  const featuresByLocation = groupBy(roomFeatures, (feature) => feature.location_id);
  const clocksByLocation = groupBy(clocks.filter((clock) => clock.scope === "room"), (clock) => clock.scope_id);
  const jobsByLocation = new Map();
  for (const job of jobs) {
    for (const locationId of job.location_ids ?? []) {
      const bucket = jobsByLocation.get(locationId) ?? [];
      bucket.push(job);
      jobsByLocation.set(locationId, bucket);
    }
  }
  const frontsByLocation = new Map();
  for (const front of fronts) {
    for (const locationId of front.location_ids ?? []) {
      const bucket = frontsByLocation.get(locationId) ?? [];
      bucket.push(front);
      frontsByLocation.set(locationId, bucket);
    }
  }
  const factionsByLocation = new Map();
  const factionsByActor = new Map();
  for (const faction of factions) {
    for (const locationId of faction.home_location_ids ?? []) {
      const bucket = factionsByLocation.get(locationId) ?? [];
      bucket.push(faction);
      factionsByLocation.set(locationId, bucket);
    }
    for (const actorId of faction.member_actor_ids ?? []) {
      const bucket = factionsByActor.get(actorId) ?? [];
      bucket.push(faction);
      factionsByActor.set(actorId, bucket);
    }
  }
  const hooksByTarget = groupBy(lifecycleHooks, (hook) => `${hook.target_kind}:${hook.target_id}`);
  const worldItemEconomy = sorted(items, byNumberThenName).map((item) => {
    const desires = actors
      .filter((actor) => (actor.desires ?? []).some((desire) => desire.item_id === item.id))
      .map((actor) => ({ actor_id: actor.id, actor_name: actor.name }));
    const attachments = actors
      .filter((actor) => (actor.attachments ?? []).some((attachment) => attachment.item_id === item.id))
      .map((actor) => ({ actor_id: actor.id, actor_name: actor.name }));
    const evolutionRequirements = evolutionTracks
      .filter((track) => (track.requirements ?? []).some((requirement) => requirement.item_id === item.id))
      .map((track) => ({ actor_id: track.actor_id, actor_name: actors.find((actor) => actor.id === track.actor_id)?.name ?? null }));
    const recipeInputs = recipes
      .filter((recipe) => (recipe.inputs ?? []).some((input) => input.item_id === item.id))
      .map((recipe) => ({ recipe_id: recipe.id, recipe_name: recipe.name }));
    const demand = desires.length + attachments.length + evolutionRequirements.length + recipeInputs.length;
    return {
      item_id: item.id,
      item_name: item.name,
      pack_id: item.pack_id ?? null,
      world_supply: 1,
      demand,
      contested: demand > 1,
      desires,
      attachments,
      evolution_requirements: evolutionRequirements,
      recipe_inputs: recipeInputs,
    };
  });

  const locationReports = sorted(locations, byNumberThenName).map((location) => {
    const sheet = sheetByLocation.get(location.id) ?? null;
    const gate = gateByLocation.get(location.id) ?? null;
    const roomActors = sorted(actorsByLocation.get(location.id) ?? [], byNumberThenName);
    const roomItems = sorted(itemsByLocation.get(location.id) ?? [], byNumberThenName);
    const roomClocks = sorted(clocksByLocation.get(location.id) ?? [], (a, b) => a.id.localeCompare(b.id));
    const roomJobs = sorted(jobsByLocation.get(location.id) ?? [], (a, b) => a.id.localeCompare(b.id));
    const roomFronts = sorted(frontsByLocation.get(location.id) ?? [], (a, b) => a.id.localeCompare(b.id));
    const roomFeatures = sorted(featuresByLocation.get(location.id) ?? [], (a, b) => a.key.localeCompare(b.key));
    const roomHooks = hooksByTarget.get(`room:${location.id}`) ?? [];
    return {
      id: location.id,
      name: location.name,
      card_id: cardIdForSubject("location", location.id),
      zone: sheet?.zone ?? "unknown",
      safety: sheet?.safety ?? "unknown",
      public: !gate,
      gate: gate ? { required_grant_id: gate.required_grant_id, required_card_id: gate.required_card_id ?? null, reason: gate.reason } : null,
      allow_combat: location.allow_combat,
      factions: (factionsByLocation.get(location.id) ?? []).map((faction) => faction.id),
      exits: sorted(exitsByLocation.get(location.id) ?? [], (a, b) => String(a.direction ?? "").localeCompare(String(b.direction ?? "")))
        .map((exit) => ({
          direction: exit.direction ?? null,
          to_location_id: exit.to_location_id,
          to_name: locations.find((candidate) => candidate.id === exit.to_location_id)?.name ?? null,
        })),
      actors: roomActors.map((actor) => ({
        id: actor.id,
        name: actor.name,
        factions: (factionsByActor.get(actor.id) ?? []).map((faction) => faction.id),
      })),
      items: roomItems.map((item) => ({ id: item.id, name: item.name, kind: item.kind, charges: item.charges })),
      features: roomFeatures.map((feature) => ({
        key: feature.key,
        name: feature.name,
        uses: (feature.uses ?? []).map((use) => ({ item_id: use.item_id, text: use.text })),
      })),
      clocks: roomClocks.map((clock) => ({
        id: clock.id,
        kind: clock.kind,
        filled: clock.filled,
        segments: clock.segments,
        on_fill: effectSummaries(clock.on_fill),
      })),
      jobs: roomJobs.map((job) => ({
        id: job.id,
        status: job.status || "active",
        progress_clock_id: job.progress_clock_id,
        danger_clock_id: job.danger_clock_id,
      })),
      fronts: roomFronts.map((front) => ({
        id: front.id,
        status: front.status,
        portent_clock_id: front.portent_clock_id,
        stakes_questions: front.stakes_questions,
      })),
      lifecycle_hooks: roomHooks.map((hook) => ({
        hook: hook.hook,
        claim_scope: hook.claim_scope,
        effects: effectSummaries(hook.effects),
      })),
    };
  });

  return {
    manifest: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      bundle_hash: manifest.bundle_hash,
      rules_profile: manifest.rules_profile,
      packs: packs.map((pack) => ({ id: pack.id, version: pack.version, integrity: pack.integrity })),
      content_root: contentRoot,
    },
    counts: {
      actors: actors.length,
      access_gates: accessGates.length,
      factions: factions.length,
      items: items.length,
      locations: locations.length,
      room_features: roomFeatures.length,
      room_sheets: roomSheets.length,
      clocks: clocks.length,
      jobs: jobs.length,
      action_vocabulary: actionVocabulary.length,
      fronts: fronts.length,
      cards: cards.length,
      actor_facets: actorFacets.length,
      card_bindings: cardBindings.length,
      external_cards: externalCards.length,
      asset_mounts: assetMounts.length,
      rules_bundles: ruleBundles.length,
      rule_conditions: ruleConditionCount,
      rule_monster_seeds: ruleMonsterSeedCount,
      rule_actions: ruleActionCount,
      attributions: attributions.length,
      modified_material: modifiedMaterial.length,
      character_creation_profiles: characterCreationProfileIds.size,
      action_contributions: contributionBundles.reduce((count, bundle) => count + contributionKinds.reduce((subtotal, kind) => subtotal + bundle[kind].length, 0), 0),
      lifecycle_hooks: lifecycleHooks.length,
      evolution_tracks: evolutionTracks.length,
      recipes: recipes.length,
    },
    locations: locationReports,
    action_contributions: contributionBundles.flatMap((bundle) => contributionKinds.flatMap((kind) => bundle[kind].map((row) => ({
      kind: kind.slice(0, -1),
      id: row.id,
      pack_id: bundle.pack_id,
      based_on: row.based_on,
      label: row.label ?? null,
      exact_delta: row.exact_delta ?? null,
      resolver_contract: row.resolver_contract ?? null,
      source_reference: row.source_reference,
    })))),
    rules_conformance: rulesConformance,
    modified_material: modifiedMaterial,
    jobs: sorted(jobs, (a, b) => a.id.localeCompare(b.id)).map((job) => ({
      id: job.id,
      status: job.status || "active",
      locations: job.location_ids,
      participants: job.participant_ids,
      progress_clock_id: job.progress_clock_id,
      danger_clock_id: job.danger_clock_id,
      reward: jobRewardLabel(job.reward),
      reward_orbs: jobRewardOrbs(job.reward),
      consequence: job.consequence,
    })),
    world_item_economy: worldItemEconomy,
    fronts: sorted(fronts, (a, b) => a.id.localeCompare(b.id)).map((front) => ({
      id: front.id,
      status: front.status,
      zone: front.zone,
      locations: front.location_ids,
      participants: front.participant_ids,
      stakes_questions: front.stakes_questions,
      portent_clock_id: front.portent_clock_id,
      job_ids: front.job_ids,
      impending_outcome: front.impending_outcome,
    })),
    lifecycle_hooks: lifecycleHooks.map((hook) => ({
      hook: hook.hook,
      target: `${hook.target_kind}:${hook.target_id}`,
      claim_scope: hook.claim_scope,
      effects: effectSummaries(hook.effects),
    })),
    recipes: recipes.map((recipe) => ({
      ...(() => {
        const exactInputIds = (recipe.inputs ?? [])
          .map((input) => input.item_id)
          .filter(Number.isInteger);
        return {
          input_item_ids: exactInputIds,
          input_item_names: exactInputIds.map(
            (itemId) => itemById.get(itemId)?.name ?? null,
          ),
        };
      })(),
      id: recipe.id,
      key: recipe.key,
      schema_version: recipe.schema_version,
      input_templates: (recipe.inputs ?? []).map((input) => ({
        template_id: input.template_id,
        zones: input.zones,
        disposition: input.disposition,
      })),
      output_item_id: recipe.output?.item_id ?? null,
      output_item_name: recipe.output?.name ?? null,
      output_template_id: recipe.output?.template_id ?? null,
      output_destination: recipe.output?.destination ?? recipe.output?.target_kind ?? null,
      requirements: recipe.requires ?? null,
      outcome: recipe.outcome ? `${recipe.outcome.kind}:${recipe.outcome.target_kind}:${recipe.outcome.target_id}` : null,
    })),
    evolution_tracks: evolutionTracks.map((track) => ({
      actor_id: track.actor_id,
      actor_name: actors.find((actor) => actor.id === track.actor_id)?.name ?? null,
      requirements: (track.requirements ?? []).map((requirement) => ({
        item_id: requirement.item_id,
        item_name: itemById.get(requirement.item_id)?.name ?? recipeOutputById.get(requirement.item_id)?.name ?? null,
        target: `${requirement.target_kind}:${requirement.target_id}`,
      })),
    })),
  };
}

function printWorldpackReport(report) {
  console.log(`worldpack ok: ${report.counts.locations} locations, ${report.counts.room_sheets} room sheets, ${report.counts.cards} cards`);
  console.log(`manifest: ${report.manifest.id} v${report.manifest.version} ${report.manifest.bundle_hash} profile=${report.manifest.rules_profile} (${report.manifest.packs.length} packs; ${report.manifest.content_root})`);
  console.log(
    `counts: actors=${report.counts.actors} items=${report.counts.items} factions=${report.counts.factions} gates=${report.counts.access_gates} jobs=${report.counts.jobs} fronts=${report.counts.fronts} hooks=${report.counts.lifecycle_hooks} recipes=${report.counts.recipes} rules=${report.counts.rules_bundles} actions=${report.counts.rule_actions} contributions=${report.counts.action_contributions} conditions=${report.counts.rule_conditions} monster_seeds=${report.counts.rule_monster_seeds} character_creation=${report.counts.character_creation_profiles}`
  );
  if (report.action_contributions.length) {
    console.log("action contributions:");
    for (const contribution of report.action_contributions) {
      const detail = contribution.exact_delta
        ? ` delta=${JSON.stringify(contribution.exact_delta)}`
        : contribution.resolver_contract
          ? ` resolver=${contribution.resolver_contract.kind}`
          : contribution.label
            ? ` label=${JSON.stringify(contribution.label)}`
            : "";
      console.log(`- ${contribution.kind} ${contribution.id} -> ${contribution.based_on}${detail} [${contribution.pack_id}; ${contribution.source_reference}]`);
    }
  }
  if (report.rules_conformance.length) {
    console.log("rules conformance:");
    for (const row of report.rules_conformance) {
      console.log(`- ${row.action_id} ${row.support_status} resolver=${row.resolver_kind} targets=${row.legal_targets.join(",") || "none"} fixture=${row.replay_fixture || "not-applicable"}`);
    }
  }
  console.log(`modified material: ${report.modified_material.length} traceable resources (machine-readable modified-material.json)`);
  console.log(`collectible power warnings: ${report.collectible_power_warnings.length}`);
  console.log("locations:");
  for (const location of report.locations) {
    const gate = location.gate ? ` gate=${location.gate.required_card_id}` : " public";
    const exitsText = location.exits.map((exit) => `${exit.direction ?? "?"}->${exit.to_location_id}`).join(",");
    const clocksText = location.clocks.map((clock) => `${clock.id}:${clock.filled}/${clock.segments}`).join(",");
    const jobsText = location.jobs.map((job) => job.id).join(",");
    const frontsText = location.fronts.map((front) => front.id).join(",");
    console.log(
      `- ${location.id} ${location.name} [${location.zone}/${location.safety}]${gate} exits=${exitsText || "-"} actors=${location.actors.length} items=${location.items.length} features=${location.features.length} clocks=${clocksText || "-"} jobs=${jobsText || "-"} fronts=${frontsText || "-"}`
    );
  }
  if (report.fronts.length) {
    console.log("fronts:");
    for (const front of report.fronts) {
      console.log(`- ${front.id} ${front.status} portent=${front.portent_clock_id} jobs=${front.job_ids.join(",")}`);
    }
  }
  const demandedItems = report.world_item_economy.filter((item) => item.demand > 0);
  if (demandedItems.length) {
    console.log("world item economy (shard-local supply only):");
    for (const item of demandedItems) {
      console.log(
        `- ${item.item_id} ${item.item_name} supply=${item.world_supply} demand=${item.demand} desires=${item.desires.length} attachments=${item.attachments.length} evolution=${item.evolution_requirements.length} recipes=${item.recipe_inputs.length}${item.contested ? " contested" : ""}`
      );
    }
  }
  if (report.lifecycle_hooks.length) {
    console.log("lifecycle hooks:");
    for (const hook of report.lifecycle_hooks) {
      console.log(`- ${hook.hook} ${hook.target} ${hook.claim_scope || "unclaimed"} => ${hook.effects.join("; ")}`);
    }
  }
  if (report.evolution_tracks.length) {
    console.log("evolution tracks:");
    for (const track of report.evolution_tracks) {
      console.log(`- ${track.actor_id} ${track.actor_name}: ${track.requirements.map((requirement) => `${requirement.item_name ?? requirement.item_id}@${requirement.target}`).join(", ")}`);
    }
  }
  if (report.recipes.length) {
    console.log("recipes:");
    for (const recipe of report.recipes) {
      console.log(`- ${recipe.id} ${recipe.key}: ${recipe.input_item_names.join(" + ")} -> ${recipe.output_item_name ?? "event"} (${recipe.outcome})`);
    }
  }
}

if (failures.length > 0) {
  console.error(`worldpack check failed for ${contentRoot}:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

for (const warning of warnings) {
  console.warn(`worldpack warning: ${warning}`);
}

if (reportText || reportJson) {
  const report = buildWorldpackReport();
  if (reportJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printWorldpackReport(report);
  }
} else {
  console.log(`worldpack ok: ${locations.length} locations, ${roomSheets.length} room sheets, ${cards.length} cards`);
}
