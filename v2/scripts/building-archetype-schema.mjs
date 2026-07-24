const classifications = new Set(["universal", "special"]);
const naturalResources = new Set([
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
const strategies = new Set(["work", "help", "prepare"]);
const capabilities = new Set([
  "sanctuary",
  "rest",
  "hosting",
  "bonds",
  "resident_arrivals",
  "route_support",
  "delivery_needs",
  "traveler_arrivals",
  "transformation_recipes",
  "repair_jobs",
  "production_quests",
  "public_cache",
  "fishing",
  "preservation",
  "boating",
  "mining",
  "metalworking",
  "prospecting",
  "pottery",
  "carpentry",
  "herbalism",
  "water_power",
  "wind_power",
  "signals",
  "bathing",
  "healing",
  "cultivation",
  "medicine",
  "lore_investigation",
  "knowledge_traces",
  "museum_exhibits",
  "expeditions",
  "stewardship",
  "additional_major_slot",
]);
const cachePolicies = new Set(["none", "public_empty_until_reward"]);
const accessPolicies = new Set(["public", "covenant"]);
const environmentTags = new Set([
  "riverbank",
  "woodland",
  "upland",
  "mountain",
  "wetland",
  "coast",
  "ruins",
  "flowing_river",
  "spring",
  "geothermal",
]);
const idPattern = /^[a-z][a-z0-9_]{1,47}$/;

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringList(value, allowed) {
  return Array.isArray(value)
    && value.every((entry) => nonEmpty(entry) && (!allowed || allowed.has(entry)))
    && new Set(value).size === value.length;
}

export function buildingArchetypeValidationErrors(config, label = "building archetypes") {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [`${label} must be an object`];
  }
  if (config.schema_version !== 1) errors.push(`${label} schema_version must be 1`);
  if (config.footprint_class !== "major") {
    errors.push(`${label} footprint_class must be major`);
  }
  const construction = config.construction;
  if (
    !construction
    || typeof construction !== "object"
    || !Number.isInteger(construction.segments)
    || construction.segments < 2
    || construction.segments > 12
    || !stringList(construction.strategies, strategies)
    || !construction.strategies.includes("work")
  ) {
    errors.push(`${label} construction must declare 2-12 segments and approved strategies including work`);
  }
  const upgrade = config.upgrade;
  if (
    !upgrade
    || typeof upgrade !== "object"
    || !Number.isInteger(upgrade.segments)
    || upgrade.segments < 2
    || upgrade.segments > 12
    || !stringList(upgrade.strategies, strategies)
    || !upgrade.strategies.includes("work")
  ) {
    errors.push(`${label} upgrade must declare 2-12 segments and approved strategies including work`);
  }
  if (!Array.isArray(config.archetypes) || config.archetypes.length < 3 || config.archetypes.length > 32) {
    errors.push(`${label} archetypes must contain 3-32 entries`);
    return errors;
  }

  const ids = new Set();
  for (const archetype of config.archetypes) {
    const archetypeLabel = `${label} archetype ${String(archetype?.id ?? "unknown")}`;
    if (!archetype || typeof archetype !== "object" || Array.isArray(archetype)) {
      errors.push(`${archetypeLabel} must be an object`);
      continue;
    }
    if (!idPattern.test(archetype.id ?? "") || ids.has(archetype.id)) {
      errors.push(`${archetypeLabel} id must be unique stable snake_case`);
    }
    ids.add(archetype.id);
    if (!nonEmpty(archetype.name) || !nonEmpty(archetype.description)) {
      errors.push(`${archetypeLabel} needs authored name and description`);
    }
    if (!classifications.has(archetype.classification)) {
      errors.push(`${archetypeLabel} classification is invalid`);
    }
    if (archetype.classification === "special") {
      if (!naturalResources.has(archetype.natural_resource)) {
        errors.push(`${archetypeLabel} special archetype needs one approved natural_resource`);
      }
    } else if (archetype.natural_resource !== undefined) {
      errors.push(`${archetypeLabel} universal archetype cannot require a natural_resource`);
    }
    if (!stringList(archetype.capabilities, capabilities) || archetype.capabilities.length === 0) {
      errors.push(`${archetypeLabel} capabilities must use the closed vocabulary`);
    }
    if (
      archetype.upgrade_capabilities !== undefined
      && !stringList(archetype.upgrade_capabilities, capabilities)
    ) {
      errors.push(`${archetypeLabel} upgrade_capabilities must use the closed vocabulary`);
    }
    if (!stringList(archetype.quest_templates ?? [], null)) {
      errors.push(`${archetypeLabel} quest_templates must be unique strings`);
    }
    if (!stringList(archetype.recipe_tags ?? [], null)) {
      errors.push(`${archetypeLabel} recipe_tags must be unique strings`);
    }
    if (
      !Array.isArray(archetype.allowed_location_ids ?? [])
      || (archetype.allowed_location_ids ?? []).some(
        (locationId) => !Number.isInteger(locationId) || locationId <= 0,
      )
      || new Set(archetype.allowed_location_ids ?? []).size
        !== (archetype.allowed_location_ids ?? []).length
    ) {
      errors.push(`${archetypeLabel} allowed_location_ids must be unique positive integers`);
    }
    if (!stringList(archetype.environment_tags ?? [], environmentTags)) {
      errors.push(`${archetypeLabel} environment_tags must use the closed vocabulary`);
    }
    if (!stringList(archetype.required_capabilities ?? [], capabilities)) {
      errors.push(`${archetypeLabel} required_capabilities must use the closed vocabulary`);
    }
    if (!accessPolicies.has(archetype.access_policy ?? "public")) {
      errors.push(`${archetypeLabel} access_policy is invalid`);
    }
    if (
      archetype.covenant_required !== undefined
      && typeof archetype.covenant_required !== "boolean"
    ) {
      errors.push(`${archetypeLabel} covenant_required must be boolean`);
    }
    if (!cachePolicies.has(archetype.cache_policy ?? "none")) {
      errors.push(`${archetypeLabel} cache_policy is invalid`);
    }
    if (
      (archetype.cache_policy ?? "none") !== "none"
      && !archetype.capabilities.includes("public_cache")
    ) {
      errors.push(`${archetypeLabel} cache policy requires public_cache capability`);
    }
    if (
      (archetype.quest_templates ?? []).some((id) => id.startsWith("production."))
      && !archetype.capabilities.includes("production_quests")
    ) {
      errors.push(`${archetypeLabel} production quest requires production_quests capability`);
    }
    if (
      (archetype.quest_templates ?? []).some((id) => id.startsWith("production."))
      && !nonEmpty(archetype.loot_table_id)
    ) {
      errors.push(`${archetypeLabel} production quest requires a future loot_table_id seam`);
    }
  }
  return errors;
}

export function assertBuildingArchetypeConfig(config, label = "building archetypes") {
  const errors = buildingArchetypeValidationErrors(config, label);
  if (errors.length) throw new Error(errors.join("; "));
  return config;
}
