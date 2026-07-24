const inputZones = new Set(["carried", "world"]);
const inputDispositions = new Set(["persistent", "consume", "exhaust", "transform"]);
const naturalFeatures = new Set([
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
const locationFeatures = new Set(["generated_place_anchor_site"]);
const outputDestinations = new Set([
  "actor_hand",
  "location_floor",
  "installed_at_location",
]);
const outputEffects = new Set(["portable", "installed_fixture"]);
const outputUniqueness = new Set(["per_receipt", "per_location", "per_world"]);

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(value, allowed) {
  return Array.isArray(value)
    && value.every((entry) => nonEmpty(entry) && (!allowed || allowed.has(entry)))
    && new Set(value).size === value.length;
}

export function versionedRecipeValidationErrors(
  recipe,
  {
    templateIds = new Set(),
    buildingArchetypes = [],
  } = {},
  label = `recipe ${String(recipe?.id ?? "unknown")}`,
) {
  const errors = [];
  if (!object(recipe) || recipe.schema_version !== 2) {
    return [`${label} schema_version must be 2`];
  }
  if (!Array.isArray(recipe.inputs) || recipe.inputs.length < 1 || recipe.inputs.length > 2) {
    errors.push(`${label} must declare one or two physical inputs`);
  }
  const seenTemplates = new Set();
  let physicalInputCount = 0;
  for (const input of recipe.inputs ?? []) {
    const inputLabel = `${label} input ${String(input?.template_id ?? "unknown")}`;
    if (!object(input)
        || !nonEmpty(input.template_id)
        || !templateIds.has(input.template_id)
        || seenTemplates.has(input.template_id)) {
      errors.push(`${inputLabel} has an orphan or duplicate template`);
    }
    seenTemplates.add(input?.template_id);
    if (!Number.isInteger(input?.quantity)
        || input.quantity < 1
        || input.quantity > 2) {
      errors.push(`${inputLabel} quantity must be 1 or 2`);
    } else {
      physicalInputCount += input.quantity;
    }
    if (!uniqueStrings(input?.zones, inputZones)) {
      errors.push(`${inputLabel} has ambiguous zones`);
    }
    if (!inputDispositions.has(input?.disposition)) {
      errors.push(`${inputLabel} has undeclared consumption`);
    }
    if (!Number.isInteger(input?.min_charges ?? 0)
        || (input?.min_charges ?? 0) < 0
        || (input?.min_charges ?? 0) > 20) {
      errors.push(`${inputLabel} has invalid charge requirements`);
    }
  }
  if (physicalInputCount < 1 || physicalInputCount > 2) {
    errors.push(`${label} must resolve to one or two physical items`);
  }

  const requirements = recipe.requires;
  const buildingCapabilities = requirements?.building_capabilities ?? [];
  const recipeTags = requirements?.recipe_tags ?? [];
  const requiredNaturalFeatures = requirements?.natural_features ?? [];
  const requiredLocationFeatures = requirements?.location_features ?? [];
  if (!object(requirements)
      || !Array.isArray(buildingCapabilities)
      || !Array.isArray(recipeTags)
      || !uniqueStrings(requiredNaturalFeatures, naturalFeatures)
      || requiredNaturalFeatures.length > 1
      || !uniqueStrings(requiredLocationFeatures, locationFeatures)
      || requiredLocationFeatures.length > 1
      || (buildingCapabilities.length === 0
        && recipeTags.length === 0
        && requiredNaturalFeatures.length === 0
        && requiredLocationFeatures.length === 0)) {
    errors.push(`${label} has no valid physical place eligibility`);
  }
  if ((buildingCapabilities.length === 0) !== (recipeTags.length === 0)
      || (buildingCapabilities.length > 0
        && !buildingCapabilities.includes("transformation_recipes"))) {
    errors.push(`${label} has missing capability or recipe tags`);
  }
  if (buildingCapabilities.length > 0
      && !buildingArchetypes.some((archetype) =>
        buildingCapabilities.every(
          (capability) => (archetype.capabilities ?? []).includes(capability),
        )
        && recipeTags.every((tag) => (archetype.recipe_tags ?? []).includes(tag)))) {
    errors.push(`${label} has an impossible capability and recipe-tag combination`);
  }

  const output = recipe.output;
  if (!object(output) || !templateIds.has(output?.template_id)) {
    errors.push(`${label} has an orphan output template`);
  }
  if (!outputDestinations.has(output?.destination)) {
    errors.push(`${label} has an impossible destination`);
  }
  if (output?.fallback_destination !== "location_floor") {
    errors.push(`${label} is missing a location_floor fallback`);
  }
  if (!outputEffects.has(output?.effect)
      || !outputUniqueness.has(output?.uniqueness)
      || (output?.destination === "installed_at_location"
        && output?.effect !== "installed_fixture")) {
    errors.push(`${label} has an invalid typed output effect`);
  }
  return errors;
}

export function assertVersionedRecipe(recipe, context, label) {
  const errors = versionedRecipeValidationErrors(recipe, context, label);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return recipe;
}
