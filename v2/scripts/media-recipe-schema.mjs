import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const MEDIA_RECIPE_REGISTRY_PATH = path.resolve(scriptDir, "../media/recipes.json");

const OPERATIONS = new Set(["base_generation", "single_reference", "multi_reference"]);
const INTENTS = new Set([
  "avatar_card_art",
  "item_card_art",
  "location_card_art",
  "evolution_card_art",
  "room_scene",
]);
const REFERENCE_SLOTS = new Set(["location", "actor", "item", "prior_level", "style"]);
const RECIPE_STATES = new Set(["enabled", "canary", "disabled"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireUniqueStrings(values, allowed, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string" || !value || (allowed && !allowed.has(value))) {
      throw new Error(`${label} contains unsupported value ${JSON.stringify(value)}`);
    }
    if (seen.has(value)) throw new Error(`${label} repeats ${value}`);
    seen.add(value);
  }
  return seen;
}

function resolveEnabledDefaultRecipe(profile, recipes) {
  const visited = new Set();
  let recipeId = profile.default_recipe;
  while (recipeId !== null) {
    if (visited.has(recipeId)) {
      throw new Error(`media profile ${profile.id} has a fallback cycle at ${recipeId}`);
    }
    visited.add(recipeId);
    const recipe = recipes.get(recipeId);
    if (!recipe) throw new Error(`media profile ${profile.id} references unknown recipe ${recipeId}`);
    if (recipe.state !== "disabled") return recipe;
    recipeId = recipe.fallback_recipe;
  }
  return null;
}

export function loadMediaRecipeRegistry(filePath = MEDIA_RECIPE_REGISTRY_PATH) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function indexMediaRecipeRegistry(document = loadMediaRecipeRegistry()) {
  if (!isRecord(document) || document.schema_version !== 1) {
    throw new Error("media recipe registry schema_version must be 1");
  }
  if (!Array.isArray(document.recipes) || !Array.isArray(document.profiles)) {
    throw new Error("media recipe registry requires profiles and recipes arrays");
  }
  const recipes = new Map();
  for (const recipe of document.recipes) {
    if (!isRecord(recipe) || typeof recipe.id !== "string" || !recipe.id) {
      throw new Error("media recipe id is required");
    }
    if (recipes.has(recipe.id)) throw new Error(`duplicate media recipe ${recipe.id}`);
    if (!RECIPE_STATES.has(recipe.state)) {
      throw new Error(`media recipe ${recipe.id} has unsupported state ${recipe.state}`);
    }
    if (
      !isRecord(recipe.model)
      || typeof recipe.model.owner !== "string"
      || typeof recipe.model.name !== "string"
      || !/^[a-f0-9]{64}$/.test(recipe.model.revision)
      || typeof recipe.model.revision_source !== "string"
      || !recipe.model.revision_source.startsWith("https://")
      || !["official_model", "pinned_version"].includes(recipe.model.invocation)
    ) {
      throw new Error(`media recipe ${recipe.id} lacks an exact model revision`);
    }
    requireUniqueStrings(recipe.operations, OPERATIONS, `media recipe ${recipe.id} operations`);
    requireUniqueStrings(recipe.intents, INTENTS, `media recipe ${recipe.id} intents`);
    if (!isRecord(recipe.references)) {
      throw new Error(`media recipe ${recipe.id} references contract is required`);
    }
    requireUniqueStrings(
      recipe.references.supported_slots,
      REFERENCE_SLOTS,
      `media recipe ${recipe.id} reference slots`,
      { allowEmpty: true },
    );
    if (
      !Number.isSafeInteger(recipe.references.minimum)
      || !Number.isSafeInteger(recipe.references.maximum)
      || recipe.references.minimum < 0
      || recipe.references.minimum > recipe.references.maximum
    ) {
      throw new Error(`media recipe ${recipe.id} has invalid reference limits`);
    }
    if (
      recipe.references.ordering !== "caller"
      || !["none", "indexed_image_1"].includes(recipe.references.prompt_semantics)
      || (recipe.references.maximum === 0 && recipe.references.input_field !== null)
      || (
        recipe.references.maximum > 0
        && (typeof recipe.references.input_field !== "string"
          || !recipe.references.input_field)
      )
    ) {
      throw new Error(`media recipe ${recipe.id} has invalid reference semantics`);
    }
    if (
      recipe.fallback_recipe !== null
      && (typeof recipe.fallback_recipe !== "string" || !recipe.fallback_recipe)
    ) {
      throw new Error(`media recipe ${recipe.id} has an invalid fallback recipe`);
    }
    recipes.set(recipe.id, recipe);
  }

  const profiles = new Map();
  for (const profile of document.profiles) {
    if (!isRecord(profile) || typeof profile.id !== "string" || !profile.id) {
      throw new Error("media profile id is required");
    }
    if (profiles.has(profile.id)) throw new Error(`duplicate media profile ${profile.id}`);
    const allowedRecipes = requireUniqueStrings(
      profile.allowed_recipes,
      null,
      `media profile ${profile.id} allowed recipes`,
    );
    if (!allowedRecipes.has(profile.default_recipe)) {
      throw new Error(
        `media profile ${profile.id} default recipe ${profile.default_recipe} is not allowlisted`,
      );
    }
    for (const recipeId of allowedRecipes) {
      if (!recipes.has(recipeId)) {
        throw new Error(`media profile ${profile.id} references unknown recipe ${recipeId}`);
      }
    }
    requireUniqueStrings(profile.operations, OPERATIONS, `media profile ${profile.id} operations`);
    requireUniqueStrings(profile.intents, INTENTS, `media profile ${profile.id} intents`);
    if (!Array.isArray(profile.reference_slots)) {
      throw new Error(`media profile ${profile.id} reference_slots must be an array`);
    }
    const slotSet = new Set();
    for (const slot of profile.reference_slots) {
      if (!REFERENCE_SLOTS.has(slot) || slotSet.has(slot)) {
        throw new Error(`media profile ${profile.id} has invalid reference slot ${slot}`);
      }
      slotSet.add(slot);
    }
    if (!Number.isSafeInteger(profile.maximum_references) || profile.maximum_references < 0) {
      throw new Error(`media profile ${profile.id} maximum_references must be non-negative`);
    }
    profiles.set(profile.id, profile);
  }
  for (const recipe of recipes.values()) {
    if (recipe.fallback_recipe !== null && !recipes.has(recipe.fallback_recipe)) {
      throw new Error(
        `media recipe ${recipe.id} references unknown fallback ${recipe.fallback_recipe}`,
      );
    }
  }
  for (const recipe of recipes.values()) {
    const visited = new Set();
    let cursor = recipe;
    while (cursor.fallback_recipe !== null) {
      if (visited.has(cursor.id)) {
        throw new Error(`media recipe fallback cycle reached ${cursor.id}`);
      }
      visited.add(cursor.id);
      cursor = recipes.get(cursor.fallback_recipe);
    }
  }
  for (const profile of profiles.values()) {
    const allowedRecipes = new Set(profile.allowed_recipes);
    for (const recipeId of allowedRecipes) {
      const fallback = recipes.get(recipeId).fallback_recipe;
      if (fallback !== null && !allowedRecipes.has(fallback)) {
        throw new Error(
          `media profile ${profile.id} does not allow fallback recipe ${fallback}`,
        );
      }
    }
  }
  return { document, profiles, recipes };
}

export function validatePackMediaProfiles(
  manifest,
  label = "pack.json",
  registry = indexMediaRecipeRegistry(),
) {
  const config = manifest.extensions?.["x-cosyworld-media"];
  if (config === undefined) return manifest;
  if (!isRecord(config) || config.schema_version !== 1 || !Array.isArray(config.profiles)) {
    throw new Error(
      `${label}: x-cosyworld-media requires schema_version 1 and a profiles array`,
    );
  }
  const fields = new Set(["schema_version", "profiles"]);
  for (const field of Object.keys(config)) {
    if (!fields.has(field)) {
      throw new Error(`${label}: x-cosyworld-media has unknown field ${field}`);
    }
  }
  const selectedProfiles = new Set();
  for (const selection of config.profiles) {
    if (!isRecord(selection)) {
      throw new Error(`${label}: x-cosyworld-media profile selection must be an object`);
    }
    const selectionFields = new Set([
      "profile",
      "operations",
      "intents",
      "reference_slots",
      "maximum_references",
    ]);
    for (const field of Object.keys(selection)) {
      if (!selectionFields.has(field)) {
        throw new Error(`${label}: x-cosyworld-media profile has unknown field ${field}`);
      }
    }
    const profile = registry.profiles.get(selection.profile);
    if (!profile) {
      throw new Error(`${label}: unknown media profile ${selection.profile}`);
    }
    if (selectedProfiles.has(profile.id)) {
      throw new Error(`${label}: duplicate media profile ${profile.id}`);
    }
    selectedProfiles.add(profile.id);
    const operations = requireUniqueStrings(
      selection.operations,
      OPERATIONS,
      `${label} media operations`,
    );
    const intents = requireUniqueStrings(
      selection.intents,
      INTENTS,
      `${label} media intents`,
    );
    const slots = Array.isArray(selection.reference_slots)
      ? new Set(selection.reference_slots)
      : null;
    if (!slots || [...slots].some((slot) => !REFERENCE_SLOTS.has(slot))) {
      throw new Error(`${label}: media reference_slots contains an unsupported slot`);
    }
    if (
      !Number.isSafeInteger(selection.maximum_references)
      || selection.maximum_references < 0
    ) {
      throw new Error(`${label}: media maximum_references must be non-negative`);
    }
    const incompatible = [...operations].some((operation) => !profile.operations.includes(operation))
      || [...intents].some((intent) => !profile.intents.includes(intent))
      || [...slots].some((slot) => !profile.reference_slots.includes(slot))
      || selection.maximum_references > profile.maximum_references;
    if (incompatible) {
      throw new Error(
        `${label}: media profile ${profile.id} is incompatible with requested capabilities`,
      );
    }
    const activeRecipe = resolveEnabledDefaultRecipe(profile, registry.recipes);
    const compatible = activeRecipe
      && [...operations].every((operation) => activeRecipe.operations.includes(operation))
      && [...intents].every((intent) => activeRecipe.intents.includes(intent))
      && [...slots].every((slot) => activeRecipe.references.supported_slots.includes(slot))
      && selection.maximum_references <= activeRecipe.references.maximum;
    if (!compatible) {
      throw new Error(
        `${label}: media profile ${profile.id} has no enabled compatible recipe`,
      );
    }
  }
  return manifest;
}
