import { describe, expect, it } from "vitest";

import { migrateContentReferenceDocument } from "../../v2/scripts/migrate-content-references.mjs";

const registry = {
  manifest: {
    packs: [{
      id: "core",
      version: "1.0.0",
      default_ruleset: "rules/core",
      capabilities: [{ id: "rules/core" }],
    }],
  },
  content_references: {
    schema_version: 1,
    mapping_version: 1,
    entries: [
      { canonical_ref: "pack://core/actor/7", pack_id: "core", pack_version: "1.0.0", kind: "actor", local_id: "7", legacy_runtime_id: 7, runtime_handle: 7 },
      { canonical_ref: "pack://core/location/1", pack_id: "core", pack_version: "1.0.0", kind: "location", local_id: "1", legacy_runtime_id: 1, runtime_handle: 1 },
    ],
  },
};

describe("content reference migration", () => {
  it("migrates legacy journals and events without changing numeric ids", () => {
    const source = [{
      version: 3,
      seed: 42,
      action: { actor_id: 7, destination_location_id: 1 },
    }, {
      seq: 9,
      type: "actor.moved",
      actor_id: 7,
      location_id: 1,
    }];
    const { document, migrated } = migrateContentReferenceDocument(structuredClone(source), registry);
    expect(migrated).toBe(2);
    expect(document[0].version).toBe(4);
    expect(document[0].action).toEqual(source[0].action);
    expect(document[0].content_context.references.map((entry) => entry.canonical_ref)).toEqual([
      "pack://core/actor/7",
      "pack://core/location/1",
    ]);
    expect(document[1].content_context.active_rulesets[0].capability_id).toBe("rules/core");
  });

  it("preserves self-contained references when their pack is unavailable", () => {
    const source = {
      version: 4,
      seed: 1,
      action: { actor_id: 7 },
      content_context: {
        mapping_version: 99,
        references: [{ canonical_ref: "pack://missing/actor/7", pack_id: "missing", pack_version: "1.0.0", kind: "actor", local_id: "7", runtime_handle: 7 }],
      },
    };
    const { document, migrated } = migrateContentReferenceDocument(structuredClone(source), registry);
    expect(migrated).toBe(0);
    expect(document).toEqual(source);
  });
});
