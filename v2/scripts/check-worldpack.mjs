import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const reportText = args.includes("--report");
const reportJson = args.includes("--report-json");
const contentRootArg = args.find((arg) => !arg.startsWith("--"));
const contentRoot = path.resolve(contentRootArg ?? path.join(scriptDir, "../content/official"));

const expectedFiles = {
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
};
const allowedPackKinds = new Set(["world", "campaign", "catalog", "assets", "rules"]);
const allowedEntitlementAuthorityTypes = new Set(["asset_feed", "solana_collection", "signed_set"]);
const supportedRuleResources = new Set(["conditions", "monster_seeds"]);
const environmentRegisterFields = new Set(["description", "look", "search"]);
const bannedEnvironmentTells = [
  ["as if", /\bas if\b/i],
  ["seems to", /\bseems to\b/i],
  ["meant for", /\bmeant for\b/i],
];
const secondPersonPattern = /\b(?:you|your|yours|yourself)\b/i;
const objectSentimentPattern = /\b(?:pleased|approves|approving|delights|remembers)\b/i;

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
    if (collection === "actors" || collection === "cards") continue;
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
  for (const [index, line] of indexSource.split("\n").entries()) {
    const assignment = line.match(/\bmodalSummary:(.*)$/);
    if (!assignment) continue;
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
if (!isObject(manifest)) {
  throw new Error("worldpack.json could not be parsed");
}

validateRequiredStrings("worldpack manifest", manifest, ["id", "name", "description"]);
if (manifest.schema_version !== 2) {
  fail("worldpack manifest schema_version must be 2");
}
if (!Number.isInteger(manifest.version) || manifest.version <= 0) {
  fail("worldpack manifest version must be a positive integer");
}
if (!isNonEmptyString(manifest.entry_location)) {
  fail("worldpack manifest is missing entry_location");
}
if (!isNonEmptyString(manifest.bundle_hash) || !/^sha256:[0-9a-f]{64}$/.test(manifest.bundle_hash)) {
  fail("worldpack manifest has an invalid bundle_hash");
}
const packs = asArray("worldpack manifest packs", manifest.packs);
const packIds = idSet("worldpack manifest packs", packs, (pack) => pack.id);
const entitlementGrants = new Map();
for (const pack of packs) {
  validateRequiredStrings("worldpack pack", pack, ["name", "description", "version", "kind", "license", "integrity"]);
  if (!allowedPackKinds.has(pack.kind)) {
    fail(`worldpack pack ${pack.id} has unsupported kind ${pack.kind}`);
  }
  if (pack.kind === "rules") {
    if (pack.rules_adapter !== "cosyworld.rules/1") {
      fail(`rules pack ${pack.id} must use cosyworld.rules/1`);
    }
    if (!isNonEmptyString(pack.rules_namespace) || !/^[a-z0-9][a-z0-9.-]*$/.test(pack.rules_namespace)) {
      fail(`rules pack ${pack.id} has an invalid rules_namespace`);
    }
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(pack.integrity ?? "")) {
    fail(`worldpack pack ${pack.id} has an invalid integrity hash`);
  }
  if (!Array.isArray(pack.dependencies) || !isObject(pack.resource_counts)) {
    fail(`worldpack pack ${pack.id} is missing dependencies or resource_counts`);
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
if (!isObject(manifest.files)) {
  fail("worldpack manifest files must be an object");
}
if (
  manifest.external_cards !== "external_cards.json"
  || manifest.assets !== "assets.json"
  || manifest.rules !== "rules.json"
  || manifest.attributions !== "attributions.json"
  || manifest.character_creation !== "character_creation.json"
) {
  fail("worldpack manifest must map external_cards, assets, rules, attributions, and character_creation to compiled files");
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

const externalCards = asArray("external_cards.json", readJson("external_cards.json"));
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
idSet("asset mounts", assetMounts, (mount) => `${mount.pack_id}:${mount.mount}`);
idSet("asset public prefixes", assetMounts, (mount) => mount.public_prefix);
for (const mount of assetMounts) {
  validateRequiredStrings("asset mount", mount, ["pack_id", "mount", "root", "directory", "public_prefix"]);
  if (!has(packIds, mount.pack_id)) {
    fail(`asset mount ${mount.pack_id}:${mount.mount} references a pack outside this bundle`);
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
const rulePackIds = new Set();
const ruleNamespaces = new Set();
let ruleConditionCount = 0;
let ruleMonsterSeedCount = 0;
for (const bundle of ruleBundles) {
  validateRequiredStrings("rules bundle", bundle, ["pack_id", "pack_version", "adapter", "namespace"]);
  if (!has(packIds, bundle.pack_id)) {
    fail(`rules bundle references pack outside this bundle: ${bundle.pack_id}`);
  }
  const pack = packs.find((candidate) => candidate.id === bundle.pack_id);
  if (pack?.kind !== "rules") {
    fail(`rules bundle ${bundle.pack_id} does not belong to a rules pack`);
  }
  if (bundle.adapter !== "cosyworld.rules/1" || bundle.adapter !== pack?.rules_adapter) {
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
    if (!supportedRuleResources.has(resource)) {
      fail(`rules bundle ${bundle.pack_id} contains unsupported resource ${resource}`);
    }
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
for (const pack of packs.filter((candidate) => candidate.kind === "rules")) {
  if (!has(rulePackIds, pack.id)) fail(`rules pack ${pack.id} has no compiled rules bundle`);
}

const attributions = asArray("attributions.json", readJson("attributions.json"));
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
for (const pack of packs.filter((candidate) => candidate.kind === "campaign")) {
  if (!has(characterCreationPackIds, pack.id)) {
    fail(`campaign pack ${pack.id} has no compiled character creation profile`);
  }
}

const actors = content.actors;
const accessGates = content.access_gates;
const factions = content.factions;
const items = content.items;
const locations = content.locations;
const exits = content.exits;
const hiddenExits = content.hidden_exits;
const roomFeatures = content.room_features;
const roomSheets = content.room_sheets;
const clocks = content.clocks;
const jobs = content.jobs;
const fronts = content.fronts;
const cards = content.cards;
const lifecycleHooks = content.lifecycle_hooks;
const evolutionTracks = content.evolution_tracks;
const recipes = content.recipes;

validateWritingRegister(content);
reportWritingRegisterAdvisories({ actors, cards, locations });

const actorIds = idSet("actors", actors, (actor) => actor.id);
const actorById = new Map(actors.map((actor) => [actor.id, actor]));
const itemIds = idSet("items", items, (item) => item.id);
const locationIds = idSet("locations", locations, (location) => location.id);
const clockIds = idSet("clocks", clocks, (clock) => clock.id);
const jobIds = idSet("jobs", jobs, (job) => job.id);
const frontIds = idSet("fronts", fronts, (front) => front.id);
const characterCreationProfileIds = idSet(
  "character creation profiles",
  characterCreationProfiles,
  (profile) => profile.id,
);
const gateByLocationId = new Map();
for (const gate of accessGates) {
  if (gateByLocationId.has(gate.location_id)) {
    fail(`duplicate access gate for location ${gate.location_id}`);
  } else {
    gateByLocationId.set(gate.location_id, gate);
  }
}

for (const profile of characterCreationProfiles) {
  validateRequiredStrings("character creation profile", profile, [
    "name",
    "description",
    "prompt",
    "default_choice_id",
  ]);
  if (profile.schema_version !== 1) {
    fail(`character creation profile ${profile.id} must use schema_version 1`);
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
}

for (const actor of actors) {
  validateRequiredStrings("actor", actor, ["name", "speech_mode", "title", "description"]);
  if (actor.ambient_autonomy !== undefined && typeof actor.ambient_autonomy !== "boolean") {
    fail(`actor ${actor.id} has invalid ambient_autonomy`);
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
  const desiredItemIds = new Set();
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
  validateRequiredStrings("item", item, ["name", "description", "kind"]);
  if (!["potion", "evolution", "keepsake"].includes(item.kind)) {
    fail(`item ${item.id} has invalid kind ${item.kind}`);
  }
  if (!Number.isInteger(item.charges) || item.charges <= 0) {
    fail(`item ${item.id} must declare positive charges`);
  }
  if (!has(locationIds, item.location_id)) {
    fail(`item ${item.id} references missing location ${item.location_id}`);
  }
}
const itemById = new Map(items.map((item) => [item.id, item]));

for (const location of locations) {
  validateRequiredStrings("location", location, ["name", "title", "description", "persona"]);
  if (!Array.isArray(location.memory) || location.memory.some((entry) => !isNonEmptyString(entry))) {
    fail(`location ${location.id} must have non-empty memory strings`);
  }
  if (typeof location.allow_combat !== "boolean") {
    fail(`location ${location.id} must declare allow_combat`);
  }
}

const exitPairs = new Set();
const exitDirections = new Set();
for (const exit of exits) {
  if (!has(locationIds, exit.from_location_id) || !has(locationIds, exit.to_location_id)) {
    fail(`exit ${exit.from_location_id}->${exit.to_location_id} references missing location`);
  }
  const pair = `${exit.from_location_id}->${exit.to_location_id}`;
  if (exitPairs.has(pair)) {
    fail(`duplicate exit ${pair}`);
  }
  exitPairs.add(pair);
  if (isNonEmptyString(exit.direction)) {
    const directionKey = `${exit.from_location_id}:${exit.direction.trim().toLowerCase()}`;
    if (exitDirections.has(directionKey)) {
      fail(`duplicate direction ${exit.direction} from location ${exit.from_location_id}`);
    }
    exitDirections.add(directionKey);
  }
}

const featureKeys = new Set();
for (const feature of roomFeatures) {
  validateRequiredStrings("room feature", feature, ["key", "name", "look", "search"]);
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
  const outboundDirection = `${hiddenExit.from_location_id}:${String(hiddenExit.direction || "").trim().toLowerCase()}`;
  if (exitDirections.has(outboundDirection)) {
    fail(`hidden exit ${hiddenExit.id} duplicates visible direction ${hiddenExit.direction} from location ${hiddenExit.from_location_id}`);
  }
  const returnDirection = `${hiddenExit.to_location_id}:${String(hiddenExit.return_direction || "").trim().toLowerCase()}`;
  if (exitDirections.has(returnDirection)) {
    fail(`hidden exit ${hiddenExit.id} duplicates visible direction ${hiddenExit.return_direction} from location ${hiddenExit.to_location_id}`);
  }
}

const entryLocationMatch = String(manifest.entry_location).match(/location\/(\d+)$/);
const entryLocationId = Number(entryLocationMatch?.[1] ?? 0);
const publicReachableLocationIds = new Set();
if (!has(locationIds, entryLocationId)) {
  fail(`worldpack entry location ${manifest.entry_location} does not reference a compiled location`);
} else if (gateByLocationId.has(entryLocationId)) {
  fail(`worldpack entry location ${entryLocationId} must not require an access gate`);
} else {
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
}

for (const job of jobs) {
  validateRequiredStrings("job", job, ["id", "premise", "stakes", "progress_clock_id", "danger_clock_id", "consequence"]);
  validateJobReward(job);
  if (!has(clockIds, job.progress_clock_id) || !has(clockIds, job.danger_clock_id)) {
    fail(`job ${job.id} references missing clock`);
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
  if (!Array.isArray(recipe.input_item_ids) || recipe.input_item_ids.length !== 2 || recipe.input_item_ids[0] === recipe.input_item_ids[1]) {
    fail(`recipe ${recipe.id} must declare exactly two distinct input_item_ids`);
  }
  for (const itemId of recipe.input_item_ids ?? []) {
    if (!has(itemIds, itemId)) {
      fail(`recipe ${recipe.id} references missing input item ${itemId}`);
    }
  }
  if (!isObject(recipe.balance)) {
    fail(`recipe ${recipe.id} is missing balance declaration`);
  } else {
    if (!["location", "avatar", "resident", "covenant", "evolution"].includes(recipe.balance.kind)) {
      fail(`recipe ${recipe.id} has invalid balance kind ${recipe.balance.kind}`);
    }
    if (!isNonEmptyString(recipe.balance.reason)) {
      fail(`recipe ${recipe.id} balance is missing reason`);
    }
    const targetKind = placementTargetKind(recipe.balance.target_kind);
    if (!targetKind) {
      fail(`recipe ${recipe.id} balance has invalid target kind ${recipe.balance.target_kind}`);
    } else if (targetKind === "actor_hand" && !has(actorIds, recipe.balance.target_id)) {
      fail(`recipe ${recipe.id} balance references missing actor ${recipe.balance.target_id}`);
    } else if (targetKind === "location_floor" && !has(locationIds, recipe.balance.target_id)) {
      fail(`recipe ${recipe.id} balance references missing location ${recipe.balance.target_id}`);
    }
  }
  if (recipe.output !== undefined && recipe.output !== null) {
    if (!isObject(recipe.output)) {
      fail(`recipe ${recipe.id} output must be an object`);
      continue;
    }
    validateRequiredStrings(`recipe ${recipe.id} output`, recipe.output, ["name", "description", "kind", "target_kind"]);
    if (!Number.isInteger(recipe.output.item_id) || recipe.output.item_id <= 0 || has(itemIds, recipe.output.item_id) || allItemIds.has(recipe.output.item_id)) {
      fail(`recipe ${recipe.id} has invalid or duplicate output item ${recipe.output.item_id}`);
    } else {
      allItemIds.add(recipe.output.item_id);
      recipeOutputById.set(recipe.output.item_id, recipe.output);
    }
    if (!["potion", "evolution", "keepsake"].includes(recipe.output.kind)) {
      fail(`recipe ${recipe.id} output has invalid item kind ${recipe.output.kind}`);
    }
    if (!Number.isInteger(recipe.output.charges) || recipe.output.charges <= 0) {
      fail(`recipe ${recipe.id} output has invalid charges`);
    }
    const outputTargetKind = placementTargetKind(recipe.output.target_kind);
    if (!outputTargetKind) {
      fail(`recipe ${recipe.id} output has invalid target kind ${recipe.output.target_kind}`);
    } else if (outputTargetKind === "actor_hand" && !has(actorIds, recipe.output.target_id)) {
      fail(`recipe ${recipe.id} output references missing actor ${recipe.output.target_id}`);
    } else if (outputTargetKind === "location_floor" && !has(locationIds, recipe.output.target_id)) {
      fail(`recipe ${recipe.id} output references missing location ${recipe.output.target_id}`);
    }
    if (outputTargetKind === "location_floor" && has(locationIds, recipe.output.target_id)) {
      validateProgressionLocationAccess(
        `recipe ${recipe.id} output`,
        recipe.output.target_id,
        recipe.output.required_grant_id,
      );
    }
    if (isObject(recipe.balance) && (recipe.output.target_kind !== recipe.balance.target_kind || recipe.output.target_id !== recipe.balance.target_id)) {
      fail(`recipe ${recipe.id} output slot must match its balance declaration`);
    }
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
      .filter((recipe) => (recipe.input_item_ids ?? []).includes(item.id))
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
      fronts: fronts.length,
      cards: cards.length,
      external_cards: externalCards.length,
      asset_mounts: assetMounts.length,
      rules_bundles: ruleBundles.length,
      rule_conditions: ruleConditionCount,
      rule_monster_seeds: ruleMonsterSeedCount,
      attributions: attributions.length,
      character_creation_profiles: characterCreationProfileIds.size,
      lifecycle_hooks: lifecycleHooks.length,
      evolution_tracks: evolutionTracks.length,
      recipes: recipes.length,
    },
    locations: locationReports,
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
      id: recipe.id,
      key: recipe.key,
      input_item_ids: recipe.input_item_ids,
      input_item_names: (recipe.input_item_ids ?? []).map((itemId) => itemById.get(itemId)?.name ?? null),
      output_item_id: recipe.output?.item_id ?? null,
      output_item_name: recipe.output?.name ?? null,
      balance: recipe.balance ? `${recipe.balance.kind}:${recipe.balance.target_kind}:${recipe.balance.target_id}` : null,
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
  console.log(`manifest: ${report.manifest.id} v${report.manifest.version} ${report.manifest.bundle_hash} (${report.manifest.packs.length} packs; ${report.manifest.content_root})`);
  console.log(
    `counts: actors=${report.counts.actors} items=${report.counts.items} factions=${report.counts.factions} gates=${report.counts.access_gates} jobs=${report.counts.jobs} fronts=${report.counts.fronts} hooks=${report.counts.lifecycle_hooks} recipes=${report.counts.recipes} rules=${report.counts.rules_bundles} conditions=${report.counts.rule_conditions} monster_seeds=${report.counts.rule_monster_seeds} character_creation=${report.counts.character_creation_profiles}`
  );
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
      console.log(`- ${recipe.id} ${recipe.key}: ${recipe.input_item_names.join(" + ")} -> ${recipe.output_item_name ?? "event"} (${recipe.balance})`);
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
