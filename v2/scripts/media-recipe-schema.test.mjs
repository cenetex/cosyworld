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
  assert.deepEqual(recipe.dimensions, { minimum: 256, maximum: 1440, multiple: 32 });
  assert.equal(recipe.seed_behavior, "optional");
  assert.equal(recipe.references.ordering, "caller");
  assert.equal(recipe.references.prompt_semantics, "indexed_image_1");
  assert.doesNotThrow(() =>
    validatePackMediaProfiles(manifest(referenceSelection), "fixture/pack.json", registry));
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
