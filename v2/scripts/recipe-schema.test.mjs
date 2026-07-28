import assert from "node:assert/strict";
import test from "node:test";

import {
  assertVersionedRecipe,
  versionedRecipeValidationErrors,
} from "./recipe-schema.mjs";

const context = {
  templateIds: new Set(["iron_nodule", "iron_bloom", "hearth_tonic"]),
  buildingArchetypes: [
    {
      capabilities: ["transformation_recipes", "metalworking"],
      recipe_tags: ["smithy", "refinement"],
    },
  ],
};

const valid = {
  schema_version: 2,
  id: 3101,
  inputs: [
    {
      template_id: "iron_nodule",
      quantity: 1,
      zones: ["carried", "world"],
      min_charges: 1,
      disposition: "transform",
    },
  ],
  requires: {
    building_capabilities: ["transformation_recipes", "metalworking"],
    recipe_tags: ["smithy", "refinement"],
  },
  output: {
    template_id: "iron_bloom",
    destination: "actor_hand",
    fallback_destination: "location_floor",
    effect: "portable",
    uniqueness: "per_receipt",
  },
};

test("accepts physical capability-bound transformations", () => {
  assert.equal(assertVersionedRecipe(valid, context), valid);
  const pair = structuredClone(valid);
  pair.inputs[0].quantity = 2;
  assert.equal(assertVersionedRecipe(pair, context), pair);
});

test("rejects orphan outputs, ambiguous zones, and undeclared consumption", () => {
  const invalid = structuredClone(valid);
  invalid.inputs[0].zones = ["carried", "carried"];
  invalid.inputs[0].disposition = "maybe";
  invalid.output.template_id = "imaginary";
  assert.match(
    versionedRecipeValidationErrors(invalid, context).join("\n"),
    /ambiguous zones|undeclared consumption|orphan output/,
  );
});

test("rejects missing capabilities, impossible destinations, and missing fallbacks", () => {
  const invalid = structuredClone(valid);
  invalid.requires.building_capabilities = ["metalworking"];
  invalid.output.destination = "global_inventory";
  delete invalid.output.fallback_destination;
  assert.match(
    versionedRecipeValidationErrors(invalid, context).join("\n"),
    /missing capability|impossible destination|missing a location_floor fallback/,
  );
});

test("accepts typed generated-place installation without a building", () => {
  const installation = structuredClone(valid);
  installation.inputs[0].template_id = "iron_bloom";
  installation.requires = {
    location_features: ["generated_place_anchor_site"],
  };
  installation.output = {
    template_id: "iron_bloom",
    destination: "installed_at_location",
    fallback_destination: "location_floor",
    effect: "installed_fixture",
    uniqueness: "per_location",
  };
  assert.equal(assertVersionedRecipe(installation, context), installation);
});

test("accepts an inputless supply only at one authored room feature", () => {
  const supply = structuredClone(valid);
  supply.inputs = [];
  supply.requires = {
    location_features: ["seed_room_feature:hearth"],
  };
  supply.output = {
    template_id: "hearth_tonic",
    destination: "actor_hand",
    fallback_destination: "location_floor",
    effect: "provisioned_supply",
    uniqueness: "per_receipt",
  };
  assert.equal(assertVersionedRecipe(supply, context), supply);

  supply.requires = {location_features: ["generated_place_anchor_site"]};
  assert.match(
    versionedRecipeValidationErrors(supply, context).join("\n"),
    /bound to one authored room feature/,
  );
});
