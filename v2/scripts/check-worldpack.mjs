import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const reportText = args.includes("--report");
const reportJson = args.includes("--report-json");
const contentRootArg = args.find((arg) => !arg.startsWith("--"));
const contentRoot = path.resolve(contentRootArg ?? path.join(scriptDir, "../content/core"));

const expectedFiles = {
  actors: "actors.json",
  access_gates: "access_gates.json",
  factions: "factions.json",
  items: "items.json",
  locations: "locations.json",
  exits: "exits.json",
  room_features: "room_features.json",
  room_sheets: "room_sheets.json",
  clocks: "clocks.json",
  jobs: "jobs.json",
  fronts: "fronts.json",
  cards: "cards.json",
  fallback_lines: "fallback_lines.json",
  lifecycle_hooks: "lifecycle_hooks.json",
  evolution_tracks: "evolution_tracks.json",
  recipes: "recipes.json",
};

const failures = [];

function fail(message) {
  failures.push(message);
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
if (!Number.isInteger(manifest.version) || manifest.version <= 0) {
  fail("worldpack manifest version must be a positive integer");
}
if (!isObject(manifest.files)) {
  fail("worldpack manifest files must be an object");
}

for (const [key, fileName] of Object.entries(expectedFiles)) {
  if (manifest.files?.[key] !== fileName) {
    fail(`worldpack manifest must map ${key} to ${fileName}`);
  }
}

const content = {};
for (const [key, fileName] of Object.entries(expectedFiles)) {
  content[key] = asArray(fileName, readJson(fileName));
}

const actors = content.actors;
const accessGates = content.access_gates;
const factions = content.factions;
const items = content.items;
const locations = content.locations;
const exits = content.exits;
const roomFeatures = content.room_features;
const roomSheets = content.room_sheets;
const clocks = content.clocks;
const jobs = content.jobs;
const fronts = content.fronts;
const cards = content.cards;
const fallbackLines = content.fallback_lines;
const lifecycleHooks = content.lifecycle_hooks;
const evolutionTracks = content.evolution_tracks;
const recipes = content.recipes;

const actorIds = idSet("actors", actors, (actor) => actor.id);
const itemIds = idSet("items", items, (item) => item.id);
const locationIds = idSet("locations", locations, (location) => location.id);
const clockIds = idSet("clocks", clocks, (clock) => clock.id);
const jobIds = idSet("jobs", jobs, (job) => job.id);
const frontIds = idSet("fronts", fronts, (front) => front.id);

for (const actor of actors) {
  validateRequiredStrings("actor", actor, ["name", "speech_mode", "title", "description"]);
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
  if (!has(locationIds, gate.location_id) || !isNonEmptyString(gate.required_card_id) || !isNonEmptyString(gate.reason)) {
    fail(`invalid access gate for location ${gate.location_id}`);
    continue;
  }
  const card = cards.find((candidate) => candidate.card_id === gate.required_card_id || candidate.external_card_id === gate.required_card_id);
  if (!card) {
    fail(`access gate for location ${gate.location_id} references missing card ${gate.required_card_id}`);
  } else if (card.subject_kind !== "location" || card.subject_id !== gate.location_id) {
    fail(`access gate for location ${gate.location_id} references non-matching card ${gate.required_card_id}`);
  }
}

const factionIds = idSet("factions", factions, (faction) => faction.id);
for (const faction of factions) {
  validateRequiredStrings("faction", faction, ["id", "name", "axis", "truth", "shadow", "doctrine"]);
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

for (const fallback of fallbackLines) {
  validateRequiredStrings("fallback line", fallback, ["kind", "text"]);
  if (fallback.kind === "resident_reply" && !has(actorIds, fallback.actor_id)) {
    fail(`resident_reply fallback references missing actor ${fallback.actor_id}`);
  } else if (fallback.kind === "avatar_chat" && !has(actorIds, fallback.target_actor_id)) {
    fail(`avatar_chat fallback references missing actor ${fallback.target_actor_id}`);
  } else if (!["resident_reply", "avatar_chat"].includes(fallback.kind)) {
    fail(`fallback line has invalid kind ${fallback.kind}`);
  }
}

const validHooks = new Set(["on_enter", "on_listen", "on_use", "on_give", "on_clock_fill"]);
const validClaimScopes = new Set(["", "event_once", "actor_target_once"]);
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
    const targetKind = placementTargetKind(requirement.target_kind);
    if (!targetKind) {
      fail(`evolution track ${track.actor_id} has invalid target kind ${requirement.target_kind}`);
    } else if (targetKind === "actor_hand" && !has(actorIds, requirement.target_id)) {
      fail(`evolution track ${track.actor_id} references missing actor target ${requirement.target_id}`);
    } else if (targetKind === "location_floor" && !has(locationIds, requirement.target_id)) {
      fail(`evolution track ${track.actor_id} references missing location target ${requirement.target_id}`);
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
      gate: gate ? { required_card_id: gate.required_card_id, reason: gate.reason } : null,
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
  console.log(`manifest: ${report.manifest.id} v${report.manifest.version} (${report.manifest.content_root})`);
  console.log(
    `counts: actors=${report.counts.actors} items=${report.counts.items} factions=${report.counts.factions} gates=${report.counts.access_gates} jobs=${report.counts.jobs} fronts=${report.counts.fronts} hooks=${report.counts.lifecycle_hooks} recipes=${report.counts.recipes}`
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
