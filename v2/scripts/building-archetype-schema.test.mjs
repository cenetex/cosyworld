import assert from "node:assert/strict";
import test from "node:test";

import {
  assertBuildingArchetypeConfig,
  buildingArchetypeValidationErrors,
} from "./building-archetype-schema.mjs";

const valid = {
  schema_version: 1,
  footprint_class: "major",
  construction: { segments: 4, strategies: ["work", "help"] },
  upgrade: { segments: 3, strategies: ["work"] },
  archetypes: [
    {
      id: "dwelling",
      name: "Cosy Cottage",
      description: "A shared home.",
      classification: "universal",
      capabilities: ["sanctuary", "stewardship"],
      quest_templates: ["stewardship.cottage"],
      recipe_tags: [],
      cache_policy: "none",
    },
    {
      id: "workshop",
      name: "Workshop",
      description: "A place for declared transformations.",
      classification: "universal",
      capabilities: ["transformation_recipes", "repair_jobs"],
      quest_templates: ["stewardship.workshop"],
      recipe_tags: ["workshop"],
      cache_policy: "none",
    },
    {
      id: "fishery",
      name: "Fishery",
      description: "A public fishing place.",
      classification: "special",
      natural_resource: "fish_rich_water",
      capabilities: ["production_quests", "public_cache", "fishing"],
      quest_templates: ["production.fishery"],
      loot_table_id: "cosyworld.core:loot/fishery-catch",
      recipe_tags: ["fishery"],
      cache_policy: "public_empty_until_reward",
    },
  ],
};

test("accepts versioned building archetypes with closed capabilities", () => {
  assert.equal(assertBuildingArchetypeConfig(valid), valid);
});

test("rejects passive caches and unbound natural prerequisites", () => {
  const invalid = structuredClone(valid);
  invalid.archetypes[2].natural_resource = "anything";
  invalid.archetypes[2].capabilities = ["fishing"];
  assert.match(
    buildingArchetypeValidationErrors(invalid).join("\n"),
    /approved natural_resource|public_cache capability/,
  );
});
