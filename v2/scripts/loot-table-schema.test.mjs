import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLootTableConfig,
  lootTableValidationErrors,
} from "./loot-table-schema.mjs";

const valid = {
  schema_version: 1,
  replay_version: "weighted-fnv1a-v1",
  item_templates: [
    {
      id: "river_sprat",
      name: "River Sprat",
      description: "A small silver fish.",
      kind: "keepsake",
      charges: 1,
      role: "generic",
      weight_tenths: 4,
      size: "small",
    },
    {
      id: "bright_scale",
      name: "Bright Scale",
      description: "A single bright scale.",
      kind: "keepsake",
      charges: 1,
      role: "generic",
      weight_tenths: 1,
      size: "tiny",
    },
  ],
  tables: [
    {
      id: "cosyworld.core:loot/fishery-catch",
      version: 1,
      allocation_policy: "building_public_cache",
      quantity: { min: 1, max: 1 },
      eligibility: {
        quest_templates: ["production.fishery"],
        natural_resources: ["fish_rich_water"],
        building_capabilities: ["fishing"],
      },
      entries: [
        { template_id: "river_sprat", weight: 8, rarity: "common" },
        { template_id: "bright_scale", weight: 2, rarity: "uncommon", unique: true },
      ],
      fallback_template_id: "river_sprat",
      already_present_policy: "fallback",
      unavailable_policy: "fallback",
      presentation: {
        label: "Fishery catch",
        summary: "The completed fishing work leaves a physical catch in the public cache.",
      },
    },
  ],
};

test("accepts bounded deterministic physical loot tables", () => {
  assert.equal(assertLootTableConfig(valid), valid);
});

test("rejects orphan templates, unbounded quantity, and ambiguous allocation", () => {
  const invalid = structuredClone(valid);
  invalid.tables[0].allocation_policy = "somewhere";
  invalid.tables[0].quantity.max = 99;
  invalid.tables[0].entries[0].template_id = "missing";
  assert.match(
    lootTableValidationErrors(invalid).join("\n"),
    /allocation_policy|bounded 1-4|known template_id/,
  );
});

test("rejects a unique fallback that could make retries reroll", () => {
  const invalid = structuredClone(valid);
  invalid.tables[0].fallback_template_id = "bright_scale";
  assert.match(
    lootTableValidationErrors(invalid).join("\n"),
    /fallback template cannot be unique/,
  );
});
