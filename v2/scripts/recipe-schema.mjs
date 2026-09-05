const inputZones = new Set(["carried", "world"]);
const inputDispositions = new Set(["persistent", "exhaust", "transform"]);
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
const locationFeatures = new Set([
  "generated_place_anchor_site",
  "seed_room_feature:hearth",
]);
const outputDestinations = new Set([
  "actor_hand",
  "location_floor",
  "installed_at_location",
]);
const outputEffects = new Set([
  "portable",
  "installed_fixture",
  "provisioned_supply",
]);
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
    itemIds = new Set(),
    actorIds = new Set(),
    locationIds = new Set(),
  } = {},
  label = `recipe ${String(recipe?.id ?? "unknown")}`,
) {
  const errors = [];
  if (!object(recipe) || recipe.schema_version !== 2) {
    return [`${label} schema_version must be 2`];
  }
  const exactInputs = Array.isArray(recipe.inputs)
    && recipe.inputs.some((input) => Number.isInteger(input?.item_id));
  if (exactInputs) {
    if (recipe.inputs.length !== 2) {
      errors.push(`${label} exact recipe must declare two physical inputs`);
    }
    const seenItems = new Set();
    for (const input of recipe.inputs ?? []) {
      const inputLabel = `${label} input ${String(input?.item_id ?? "unknown")}`;
      if (!object(input)
          || !Number.isInteger(input.item_id)
          || !itemIds.has(input.item_id)
          || seenItems.has(input.item_id)
          || input.template_id !== undefined) {
        errors.push(`${inputLabel} has an orphan, duplicate, or mixed item binding`);
      }
      seenItems.add(input?.item_id);
      if (input?.quantity !== 1
          || !uniqueStrings(input?.zones, inputZones)
          || !inputDispositions.has(input?.disposition)) {
        errors.push(`${inputLabel} has invalid physical input rules`);
      }
    }
    const exactLocations = recipe.requires?.location_ids;
    if (!object(recipe.requires)
        || !Array.isArray(exactLocations)
        || exactLocations.length !== 1
        || !locationIds.has(exactLocations[0])) {
      errors.push(`${label} must name one valid crafting location`);
    }
    const outcome = recipe.outcome;
    if (!object(outcome)
        || !["location", "avatar", "resident", "covenant", "evolution"].includes(outcome?.kind)
        || !nonEmpty(outcome?.reason)
        || !["actor_hand", "location_floor"].includes(outcome?.target_kind)
        || (outcome?.target_kind === "actor_hand" && !actorIds.has(outcome?.target_id))
        || (outcome?.target_kind === "location_floor" && !locationIds.has(outcome?.target_id))) {
      errors.push(`${label} has an invalid exact outcome`);
    }
    if (recipe.output != null) {
      const output = recipe.output;
      if (!object(output)
          || !Number.isInteger(output.item_id)
          || output.item_id <= 0
          || itemIds.has(output.item_id)
          || !nonEmpty(output.name)
          || !nonEmpty(output.description)
          || !["potion", "evolution", "trinket"].includes(output.kind)
          || !Number.isInteger(output.charges)
          || output.charges <= 0
          || output.target_kind !== outcome?.target_kind
          || output.target_id !== outcome?.target_id) {
        errors.push(`${label} has an invalid fixed output`);
      }
    }
    return errors;
  }
  const provisionedSupply = recipe.output?.effect === "provisioned_supply";
  if (!Array.isArray(recipe.inputs)
      || recipe.inputs.length > 2
      || (recipe.inputs.length === 0 && !provisionedSupply)) {
    errors.push(`${label} must declare one or two physical inputs unless it provisions a supply`);
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
  if (physicalInputCount > 2 || (physicalInputCount === 0 && !provisionedSupply)) {
    errors.push(`${label} must resolve to one or two physical items unless it provisions a supply`);
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
  if (provisionedSupply
      && ((recipe.inputs ?? []).length !== 0
        || buildingCapabilities.length !== 0
        || recipeTags.length !== 0
        || requiredNaturalFeatures.length !== 0
        || requiredLocationFeatures.length !== 1
        || !requiredLocationFeatures[0].startsWith("seed_room_feature:"))) {
    errors.push(`${label} provisioned supply must be inputless and bound to one authored room feature`);
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
