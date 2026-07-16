import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { migrateContentReferenceDocument } from "../../v2/scripts/migrate-content-references.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
const official = read("v2/content/official/registry.json");
const coreOnly = read("v2/content/core-only/registry.json");
const rubyOnly = read("v2/content/ruby-high-only/registry.json");
const rubyManifest = read("v2/content/ruby-high-first-bell/pack.json");

describe("Ruby High: First Bell peer pack", () => {
  it("boots as a standalone world with its own rules context and no mounted Core pack", () => {
    expect(rubyOnly.manifest.packs.map((pack) => pack.id)).toEqual(["ruby-high.first-bell"]);
    expect(rubyOnly.manifest.entry_location).toBe("ruby-high.first-bell:location/11");
    expect(rubyOnly.manifest.entry_grant_id).toBe("ruby-high.first-bell:location-homeroom");
    expect(rubyOnly.manifest.packs[0].kind).toBe("world");
    expect(rubyOnly.manifest.packs[0].default_ruleset).toBe("ruby-high.first-bell/rules");
    expect(rubyOnly.manifest.packs[0].extensions["x-cosyworld-rules-context"].vocabulary.actions)
      .toEqual(["study", "test", "revise", "attend"]);
    expect(rubyOnly.resources.locations).toHaveLength(6);
    expect(rubyOnly.resources.room_sheets).toHaveLength(6);
    expect(rubyOnly.resources.cards).toHaveLength(6);
    expect(rubyOnly.resources.exits).toHaveLength(16);
    expect(rubyOnly.resources.exits.every((exit) =>
      rubyOnly.resources.locations.some((location) => location.id === exit.from_location_id)
      && rubyOnly.resources.locations.some((location) => location.id === exit.to_location_id)))
      .toBe(true);
    expect(rubyOnly.resources.actor_facets).toEqual([]);
    expect(rubyOnly.resources.card_bindings).toEqual([]);
  });

  it("declares Core as optional and activates only its Core-facing bridges and facets when mounted", () => {
    expect(rubyManifest.dependencies).toEqual([{
      id: "cosyworld.core",
      version: ">=1.3.0 <2.0.0",
      capabilities: ["cosyworld.core/world"],
      optional: true,
    }]);
    expect(official.resources.exits.filter((exit) => exit.pack_id === "ruby-high.first-bell")).toHaveLength(24);
    expect(official.resources.actor_facets).toEqual([expect.objectContaining({
      pack_id: "ruby-high.first-bell",
      actor_id: 1001,
      actor_ref: "pack://cosyworld.core/actor/1001",
      faction_ids: ["ruby_high"],
    })]);
    expect(official.resources.card_bindings).toEqual([expect.objectContaining({
      pack_id: "ruby-high.first-bell",
      entity_ref: "pack://cosyworld.core/actor/1001",
      seed_card_id: "rati",
      external_card_id: "rati",
    })]);
    const coreRati = coreOnly.resources.cards.find((card) => card.card_id === "rati");
    expect(coreRati.external_card_id).toBeUndefined();
    expect(coreRati.source).toBe("cosyworld_core");
  });

  it("owns every gated school resource instead of leaking it through Core", () => {
    const gatedLocationIds = new Set(official.resources.access_gates.map((gate) => gate.location_id));
    expect([...gatedLocationIds]).toEqual([10, 11, 12, 13, 14, 15]);
    for (const locationId of gatedLocationIds) {
      expect(official.resources.locations.find((location) => location.id === locationId)?.pack_id)
        .toBe("ruby-high.first-bell");
      expect(official.resources.cards.find((card) =>
        card.subject_kind === "location" && card.subject_id === locationId)?.pack_id)
        .toBe("ruby-high.first-bell");
    }
    expect(official.resources.exits
      .filter((exit) => gatedLocationIds.has(exit.from_location_id) || gatedLocationIds.has(exit.to_location_id))
      .every((exit) => exit.pack_id === "ruby-high.first-bell"))
      .toBe(true);
    expect(official.resources.factions.find((faction) => faction.id === "ruby_high")?.pack_id)
      .toBe("ruby-high.first-bell");

    const forbidden = /ruby|homeroom|science class|cafeteria|greenhouse|courtyard|quiet wing/i;
    for (const fileName of fs.readdirSync(path.join(repoRoot, "v2/content/core"))) {
      if (!fileName.endsWith(".json")) continue;
      expect(fs.readFileSync(path.join(repoRoot, "v2/content/core", fileName), "utf8"), fileName)
        .not.toMatch(forbidden);
    }
  });

  it("preserves legacy numeric location handles while migrating ownership to Ruby", () => {
    const legacy = {
      version: 1,
      world_actors: [],
      world_items: [],
      world_locations: [{ id: 10 }, { id: 11 }, { id: 15 }],
    };
    const { document } = migrateContentReferenceDocument(structuredClone(legacy), official);
    const references = Object.fromEntries(
      document.content_context.references.map((entry) => [entry.runtime_handle, entry.canonical_ref]),
    );
    expect(references[10]).toBe("pack://ruby-high.first-bell/location/10");
    expect(references[11]).toBe("pack://ruby-high.first-bell/location/11");
    expect(references[15]).toBe("pack://ruby-high.first-bell/location/15");
  });
});
