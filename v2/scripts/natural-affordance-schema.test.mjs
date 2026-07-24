import assert from "node:assert/strict";
import test from "node:test";

import { naturalAffordanceValidationErrors } from "./natural-affordance-schema.mjs";

function validLocation() {
  return {
    id: 2,
    environment: {
      version: 1,
      climate: "temperate",
      landforms: ["riverbank"],
      geology: ["alluvial"],
      hydrology: ["flowing_river"],
      anomalies: [],
    },
    natural_potentials: [
      {
        resource_kind: "fish_rich_water",
        policy: "guaranteed",
        richness: "rich",
        character: "renewable",
        building_archetypes: ["fishery", "smokehouse", "boathouse"],
        presentation_key: "natural.fish_rich_water.fixture",
      },
      {
        resource_kind: "ore_seam",
        policy: "impossible",
      },
    ],
  };
}

test("accepts typed guaranteed and impossible natural potentials", () => {
  assert.deepEqual(naturalAffordanceValidationErrors(validLocation()), []);
});

test("rejects unknown environment tags", () => {
  const location = validLocation();
  location.environment.hydrology = ["narrated_river"];
  assert.match(
    naturalAffordanceValidationErrors(location).join("\n"),
    /hydrology must contain unique known tags/,
  );
});

test("rejects unknown resource kinds and building references", () => {
  const location = validLocation();
  location.natural_potentials[0].resource_kind = "moon_cheese";
  location.natural_potentials[0].building_archetypes = ["castle"];
  const errors = naturalAffordanceValidationErrors(location).join("\n");
  assert.match(errors, /resource_kind is unknown/);
  assert.match(errors, /building_archetypes must be unique approved references/);
});

test("rejects contradictory guaranteed and impossible rules", () => {
  const location = validLocation();
  location.natural_potentials.push({
    resource_kind: "fish_rich_water",
    policy: "impossible",
  });
  assert.match(
    naturalAffordanceValidationErrors(location).join("\n"),
    /contradicts or duplicates/,
  );
});
