import assert from "node:assert/strict";
import test from "node:test";

import {
  indexMediaRecipeRegistry,
  loadMediaRecipeRegistry,
  validatePackMediaProfiles,
} from "./media-recipe-schema.mjs";

function manifest(profile) {
  return {
    extensions: {
      "x-cosyworld-media": {
        schema_version: 1,
        profiles: [profile],
      },
    },
  };
}

const referenceSelection = {
  profile: "cosyworld.community-art.reference/1",
  operations: ["base_generation", "single_reference", "multi_reference"],
  intents: ["evolution_card_art"],
  reference_slots: ["location", "actor", "item", "prior_level", "style"],
  maximum_references: 4,
};

test("shared registry pins FLUX.2 reference limits and accepts a compatible pack profile", () => {
  const registry = indexMediaRecipeRegistry();
  const recipe = registry.recipes.get("replicate.flux2-dev.references");

  assert.equal(
    recipe.model.revision,
    "7bba46bdde863cfd7aaee87649a5aa49f39f368495dbea500998d1fcbb262050",
  );
  assert.equal(recipe.model.invocation, "pinned_version");
  assert.equal(recipe.references.maximum, 4);
  assert.equal(recipe.references.input_shape, "url_array");
  assert.deepEqual(recipe.dimensions, { minimum: 256, maximum: 1440, multiple: 32 });
  assert.equal(recipe.seed_behavior, "optional");
  assert.equal(recipe.references.ordering, "caller");
  assert.equal(recipe.references.prompt_semantics, "indexed_image_1");
  assert.doesNotThrow(() =>
    validatePackMediaProfiles(manifest(referenceSelection), "fixture/pack.json", registry));
});

test("Project 89 profiles pin the full-strength FLUX.1 base and FLUX.2 refinement", () => {
  const registry = indexMediaRecipeRegistry();
  const base = registry.recipes.get("replicate.ratimics-project89.v95f3d0eb");
  const refinement = registry.recipes.get("replicate.project89-flux2.refinement");

  assert.equal(base.model.owner, "ratimics");
  assert.equal(base.model.name, "project89");
  assert.equal(
    base.model.revision,
    "95f3d0eb7bdceb1262a2824c1a623e01b1902b71420013e6bc7b760e9f9255d6",
  );
  assert.equal(base.references.input_shape, "single_url");
  assert.equal(base.references.input_field, "image");
  assert.equal(base.required_prompt_prefix, "P89, anime style,");
  assert.equal(base.provider_defaults.lora_scale, 1);
  assert.equal(base.provider_defaults.prompt_strength, 0.45);
  assert.equal(base.provider_defaults.model, "dev");

  assert.equal(refinement.model.name, "flux-2-dev");
  assert.equal(refinement.references.input_shape, "url_array");
  assert.equal(refinement.references.minimum, 1);
  assert.equal(refinement.references.maximum, 4);
  assert.equal(refinement.fallback_recipe, null);

  assert.doesNotThrow(() =>
    validatePackMediaProfiles(manifest({
      profile: "project89.world-art.base/1",
      operations: ["base_generation", "single_reference"],
      intents: ["avatar_card_art", "item_card_art", "location_card_art"],
      reference_slots: ["actor", "item", "location"],
      maximum_references: 1,
    }), "project89/pack.json", registry));
  assert.doesNotThrow(() =>
    validatePackMediaProfiles(manifest({
      profile: "project89.world-art.refinement/1",
      operations: ["single_reference", "multi_reference"],
      intents: ["avatar_card_art", "item_card_art", "location_card_art", "room_scene"],
      reference_slots: ["location", "actor", "item", "prior_level", "style"],
      maximum_references: 4,
    }), "project89/pack.json", registry));
});

test("registry rejects malformed provider input shapes and controlled defaults", () => {
  const malformedShape = structuredClone(loadMediaRecipeRegistry());
  malformedShape.recipes.find(
    (recipe) => recipe.id === "replicate.ratimics-project89.v95f3d0eb",
  ).references.input_shape = "none";
  assert.throws(
    () => indexMediaRecipeRegistry(malformedShape),
    /invalid reference input shape/,
  );

  const controlledDefault = structuredClone(loadMediaRecipeRegistry());
  controlledDefault.recipes.find(
    (recipe) => recipe.id === "replicate.ratimics-project89.v95f3d0eb",
  ).provider_defaults.image = "https://untrusted.example/reference.webp";
  assert.throws(
    () => indexMediaRecipeRegistry(controlledDefault),
    /provider_defaults cannot set controlled input image/,
  );
});

test("pack media profiles reject unknown, disabled, fifth-reference, and incompatible capabilities", () => {
  assert.throws(
    () => validatePackMediaProfiles(manifest({
      ...referenceSelection,
      profile: "cosyworld.unknown/1",
    }), "unknown/pack.json"),
    /unknown media profile cosyworld\.unknown\/1/,
  );

  assert.throws(
    () => validatePackMediaProfiles(manifest({
      profile: "cosyworld.community-art.base/1",
      operations: ["single_reference"],
      intents: ["avatar_card_art"],
      reference_slots: ["actor"],
      maximum_references: 1,
    }), "incompatible/pack.json"),
    /is incompatible with requested capabilities/,
  );
  assert.throws(
    () => validatePackMediaProfiles(manifest({
      ...referenceSelection,
      maximum_references: 5,
    }), "fifth-reference/pack.json"),
    /is incompatible with requested capabilities/,
  );

  const disabledDocument = structuredClone(loadMediaRecipeRegistry());
  disabledDocument.recipes.find(
    (recipe) => recipe.id === "replicate.flux2-dev.references",
  ).state = "disabled";
  const disabledRegistry = indexMediaRecipeRegistry(disabledDocument);
  assert.throws(
    () => validatePackMediaProfiles(
      manifest(referenceSelection),
      "disabled/pack.json",
      disabledRegistry,
    ),
    /has no enabled compatible recipe/,
  );

  const noSubstitutionDocument = structuredClone(loadMediaRecipeRegistry());
  noSubstitutionDocument.recipes.find(
    (recipe) => recipe.id === "replicate.flux1-dev-lora.base",
  ).state = "disabled";
  const noSubstitutionRegistry = indexMediaRecipeRegistry(noSubstitutionDocument);
  assert.throws(
    () => validatePackMediaProfiles(manifest({
      profile: "cosyworld.community-art.base/1",
      operations: ["base_generation"],
      intents: ["avatar_card_art"],
      reference_slots: [],
      maximum_references: 0,
    }), "default-disabled/pack.json", noSubstitutionRegistry),
    /has no enabled compatible recipe/,
  );

  const disallowedFallbackDocument = structuredClone(loadMediaRecipeRegistry());
  disallowedFallbackDocument.profiles.find(
    (profile) => profile.id === "cosyworld.community-art.reference/1",
  ).allowed_recipes = ["replicate.flux2-dev.references"];
  assert.throws(
    () => indexMediaRecipeRegistry(disallowedFallbackDocument),
    /does not allow fallback recipe replicate\.flux1-dev-lora\.base/,
  );
});
