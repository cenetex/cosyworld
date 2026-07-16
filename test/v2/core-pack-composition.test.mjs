import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { migrateContentReferenceDocument } from "../../v2/scripts/migrate-content-references.mjs";
import { migratePackUnmount } from "../../v2/scripts/migrate-pack-unmount.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
const official = read("v2/content/official/registry.json");
const coreOnly = read("v2/content/core-only/registry.json");
const servicesOnly = read("v2/content/services-only/registry.json");
const coreManifest = read("v2/content/core/pack.json");

describe("independently mountable CosyWorld Core", () => {
  it("boots as a one-pack composition with explicit rules and typed effects", () => {
    expect(coreOnly.manifest.packs.map((pack) => pack.id)).toEqual(["cosyworld.core"]);
    expect(coreOnly.manifest.packs[0].default_ruleset).toBe("cosyworld.core/rules");
    expect(coreOnly.manifest.packs[0].capabilities).toContainEqual({
      id: "cosyworld.core/rules",
      kind: "rules",
      version: "1.0.0",
    });
    expect(coreOnly.resources.locations.length).toBeGreaterThan(0);
    expect(coreOnly.resources.actors.length).toBeGreaterThan(0);
    expect(coreOnly.resources.cards.length).toBeGreaterThan(0);
    expect(coreOnly.resources.lifecycle_hooks.every((hook) => hook.effects.every((effect) => typeof effect.op === "string"))).toBe(true);
  });

  it("has no manifest dependency on Ruby High or a 5E rules pack", () => {
    expect(coreManifest.dependencies).toEqual([]);
    expect(coreOnly.manifest.packs).toHaveLength(1);
    expect(coreOnly.resources.access_gates).toEqual([]);
    expect(official.resources.access_gates.every((gate) => gate.pack_id === "ruby-high.first-bell")).toBe(true);
  });

  it("keeps Core-authored gameplay resources byte-equivalent in the official composition", () => {
    for (const resource of ["actors", "factions", "items", "locations", "exits", "hidden_exits", "room_features", "room_sheets", "clocks", "jobs", "fronts", "cards", "lifecycle_hooks", "evolution_tracks", "recipes", "sentences"]) {
      expect(official.resources[resource].filter((row) => row.pack_id === "cosyworld.core"), resource)
        .toEqual(coreOnly.resources[resource]);
    }
  });

  it("migrates legacy numeric Core references without changing their handles", () => {
    const legacy = {
      version: 1,
      world_actors: [{ id: 1001, kind: 2, location_id: 1 }],
      world_items: [{ id: 2001, location_id: 3 }],
      world_locations: [{ id: 1 }, { id: 3 }],
    };
    const { document } = migrateContentReferenceDocument(structuredClone(legacy), coreOnly);
    const handles = Object.fromEntries(document.content_context.references.map((entry) => [entry.canonical_ref, entry.runtime_handle]));
    expect(handles["pack://cosyworld.core/actor/1001"]).toBe(1001);
    expect(handles["pack://cosyworld.core/item/2001"]).toBe(2001);
    expect(handles["pack://cosyworld.core/location/1"]).toBe(1);
  });

  it("allows a safe Core unmount only after every human leaves its locations", () => {
    const vacant = {
      worldpack_bundle_hash: coreOnly.manifest.bundle_hash,
      world_actors: [{ id: 1001, kind: 2, location_id: 1 }],
      world_items: [{ id: 2001, location_id: 3 }],
      world_locations: [{ id: 1 }, { id: 3 }],
      world_exits: [{ from_location_id: 1, to_location_id: 3 }],
      world_evolution_tracks: [{ actor_id: 1001 }],
      world_combat_encounters: [{ location_id: 3, participants: [{ actor_id: 1001 }] }],
      actor_meta: { 1001: { name: "Rati" } },
      branches: { 1: { actor_id: 5000, target_actor_id: 1001 } },
      bonds: { bond: { actor_id: 5000, target_actor_id: 1001 } },
      resident_continuities: { 1001: { resident_id: 1001 } },
      resident_memories: { memory: { carrier_actor_id: 1001, kind: "item", subject_id: 2001, location_id: 3 } },
      search_memories: { search: { actor_id: 5000, kind: "location", subject_id: 3, location_id: 3 } },
      tags: { tag: { scope_id: 3 } },
      world_simulation: { locations: { 3: {} }, factions: { hearthbound: {} } },
      content_context: { mapping_version: 1, references: coreOnly.content_references.entries.slice(0, 3) },
    };
    const result = migratePackUnmount(structuredClone(vacant), coreOnly, "cosyworld.core", servicesOnly);
    expect(result.removed).toEqual({ actors: 1, items: 1, locations: 2, exits: 1 });
    expect(result.snapshot.worldpack_bundle_hash).toBe(servicesOnly.manifest.bundle_hash);
    for (const field of ["world_evolution_tracks", "world_combat_encounters"]) {
      expect(result.snapshot[field]).toEqual([]);
    }
    for (const field of ["actor_meta", "branches", "bonds", "resident_continuities", "resident_memories", "search_memories", "tags"]) {
      expect(result.snapshot[field]).toEqual({});
    }
    expect(result.snapshot.world_simulation).toEqual({ locations: {}, factions: {} });

    const occupied = structuredClone(vacant);
    occupied.world_actors.push({ id: 5000, kind: 1, location_id: 1 });
    expect(() => migratePackUnmount(occupied, coreOnly, "cosyworld.core", servicesOnly))
      .toThrow(/human actors 5000 still occupy/);
  });

  it("provides a non-world services composition without silently mounting Core", () => {
    expect(servicesOnly.manifest.entry_location).toBeUndefined();
    expect(servicesOnly.manifest.packs.map((pack) => pack.id)).toEqual(["cosyworld.services-fixture"]);
    expect(servicesOnly.resources.locations).toEqual([]);
    expect(servicesOnly.resources.actors).toEqual([]);
  });
});
