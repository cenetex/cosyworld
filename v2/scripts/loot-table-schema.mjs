const itemKinds = new Set(["potion", "evolution", "keepsake"]);
const itemRoles = new Set([
  "generic",
  "consumable",
  "weapon",
  "skill_charm",
  "spell",
  "container",
  "tool",
  "relic",
]);
const itemSizes = new Set(["tiny", "small", "medium", "large"]);
const allocationPolicies = new Set([
  "participant",
  "named_discoverer",
  "party_shared_cache",
  "building_public_cache",
  "location_stockpile",
  "commissioned_recipient",
]);
const alreadyPresentPolicies = new Set(["allow_duplicate", "fallback", "skip"]);
const unavailablePolicies = new Set(["fallback", "fail_closed"]);
const rarities = new Set(["common", "uncommon", "rare", "special"]);
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
const templateIdPattern = /^[a-z][a-z0-9_]{1,47}$/;
const tableIdPattern = /^[a-z][a-z0-9.-]*:loot\/[a-z][a-z0-9-]{1,63}$/;

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueStrings(value, allowed) {
  return Array.isArray(value)
    && value.every((entry) => nonEmpty(entry) && (!allowed || allowed.has(entry)))
    && new Set(value).size === value.length;
}

export function lootTableValidationErrors(config, label = "loot tables") {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [`${label} must be an object`];
  }
  if (config.schema_version !== 1) errors.push(`${label} schema_version must be 1`);
  if (config.replay_version !== "weighted-fnv1a-v1") {
    errors.push(`${label} replay_version must be weighted-fnv1a-v1`);
  }
  if (
    !Array.isArray(config.item_templates)
    || config.item_templates.length < 1
    || config.item_templates.length > 64
  ) {
    errors.push(`${label} item_templates must contain 1-64 entries`);
    return errors;
  }
  if (!Array.isArray(config.tables) || config.tables.length < 1 || config.tables.length > 32) {
    errors.push(`${label} tables must contain 1-32 entries`);
    return errors;
  }

  const templates = new Map();
  for (const template of config.item_templates) {
    const templateLabel = `${label} item template ${String(template?.id ?? "unknown")}`;
    if (!template || typeof template !== "object" || Array.isArray(template)) {
      errors.push(`${templateLabel} must be an object`);
      continue;
    }
    if (!templateIdPattern.test(template.id ?? "") || templates.has(template.id)) {
      errors.push(`${templateLabel} id must be unique stable snake_case`);
    }
    templates.set(template.id, template);
    if (!nonEmpty(template.name) || !nonEmpty(template.description)) {
      errors.push(`${templateLabel} needs authored name and description`);
    }
    if (!itemKinds.has(template.kind)) errors.push(`${templateLabel} kind is invalid`);
    if (!itemRoles.has(template.role ?? "generic")) errors.push(`${templateLabel} role is invalid`);
    if (!itemSizes.has(template.size ?? "small")) errors.push(`${templateLabel} size is invalid`);
    if (!Number.isInteger(template.charges) || template.charges < 0 || template.charges > 20) {
      errors.push(`${templateLabel} charges must be an integer from 0-20`);
    }
    if (
      !Number.isInteger(template.weight_tenths)
      || template.weight_tenths < 1
      || template.weight_tenths > 1000
    ) {
      errors.push(`${templateLabel} weight_tenths must be an integer from 1-1000`);
    }
  }

  const tableIds = new Set();
  for (const table of config.tables) {
    const tableLabel = `${label} table ${String(table?.id ?? "unknown")}`;
    if (!table || typeof table !== "object" || Array.isArray(table)) {
      errors.push(`${tableLabel} must be an object`);
      continue;
    }
    if (!tableIdPattern.test(table.id ?? "") || tableIds.has(table.id)) {
      errors.push(`${tableLabel} id must be a unique canonical loot id`);
    }
    tableIds.add(table.id);
    if (!Number.isInteger(table.version) || table.version < 1 || table.version > 255) {
      errors.push(`${tableLabel} version must be an integer from 1-255`);
    }
    if (!allocationPolicies.has(table.allocation_policy)) {
      errors.push(`${tableLabel} allocation_policy is invalid`);
    }
    if (!alreadyPresentPolicies.has(table.already_present_policy)) {
      errors.push(`${tableLabel} already_present_policy is invalid`);
    }
    if (!unavailablePolicies.has(table.unavailable_policy)) {
      errors.push(`${tableLabel} unavailable_policy is invalid`);
    }
    if (!nonEmpty(table.presentation?.label) || !nonEmpty(table.presentation?.summary)) {
      errors.push(`${tableLabel} needs deterministic presentation`);
    }
    const quantity = table.quantity;
    if (
      !quantity
      || !Number.isInteger(quantity.min)
      || !Number.isInteger(quantity.max)
      || quantity.min < 1
      || quantity.max < quantity.min
      || quantity.max > 4
    ) {
      errors.push(`${tableLabel} quantity must declare a bounded 1-4 range`);
    }
    const eligibility = table.eligibility;
    if (!eligibility || typeof eligibility !== "object" || Array.isArray(eligibility)) {
      errors.push(`${tableLabel} eligibility must be an object`);
    } else {
      if (
        !uniqueStrings(eligibility.quest_templates, null)
        || eligibility.quest_templates.length === 0
      ) {
        errors.push(`${tableLabel} needs at least one quest_template`);
      }
      if (!uniqueStrings(eligibility.natural_resources ?? [], naturalResources)) {
        errors.push(`${tableLabel} natural_resources are invalid`);
      }
      if (!uniqueStrings(eligibility.building_capabilities ?? [], null)) {
        errors.push(`${tableLabel} building_capabilities are invalid`);
      }
      if (!uniqueStrings(eligibility.biome_tags ?? [], null)) {
        errors.push(`${tableLabel} biome_tags are invalid`);
      }
      if (!uniqueStrings(eligibility.seasons ?? [], null)) {
        errors.push(`${tableLabel} seasons are invalid`);
      }
      if (!uniqueStrings(eligibility.danger_tiers ?? [], new Set(["sanctuary", "frontier"]))) {
        errors.push(`${tableLabel} danger_tiers are invalid`);
      }
    }
    if (!Array.isArray(table.entries) || table.entries.length < 1 || table.entries.length > 32) {
      errors.push(`${tableLabel} entries must contain 1-32 rows`);
      continue;
    }
    const entryTemplates = new Set();
    for (const entry of table.entries) {
      if (
        !entry
        || typeof entry !== "object"
        || !templates.has(entry.template_id)
        || entryTemplates.has(entry.template_id)
      ) {
        errors.push(`${tableLabel} entries need unique known template_id values`);
        continue;
      }
      entryTemplates.add(entry.template_id);
      if (!Number.isInteger(entry.weight) || entry.weight < 1 || entry.weight > 10000) {
        errors.push(`${tableLabel} entry ${entry.template_id} has invalid weight`);
      }
      if (!rarities.has(entry.rarity ?? "common")) {
        errors.push(`${tableLabel} entry ${entry.template_id} has invalid rarity`);
      }
      if (entry.unique !== undefined && typeof entry.unique !== "boolean") {
        errors.push(`${tableLabel} entry ${entry.template_id} unique must be boolean`);
      }
    }
    if (!templates.has(table.fallback_template_id)) {
      errors.push(`${tableLabel} fallback_template_id must reference a known template`);
    }
    if (
      (table.unavailable_policy === "fallback" || table.already_present_policy === "fallback")
      && table.entries.some((entry) => entry.template_id === table.fallback_template_id && entry.unique)
    ) {
      errors.push(`${tableLabel} fallback template cannot be unique`);
    }
  }
  return errors;
}

export function assertLootTableConfig(config, label = "loot tables") {
  const errors = lootTableValidationErrors(config, label);
  if (errors.length) throw new Error(errors.join("; "));
  return config;
}
