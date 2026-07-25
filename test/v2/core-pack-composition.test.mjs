import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { migrateContentReferenceDocument } from "../../v2/scripts/migrate-content-references.mjs";
import {
  migratePackRemount,
  migratePackUnmount,
} from "../../v2/scripts/migrate-pack-unmount.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
const official = read("v2/content/official/registry.json");
const coreOnly = read("v2/content/core-only/registry.json");
const servicesOnly = read("v2/content/services-only/registry.json");
const coreManifest = read("v2/content/core/pack.json");

describe("independently mountable CosyWorld Core", () => {
  it("boots with the shared SRD profile, explicit world rules, and typed effects", () => {
    expect(coreOnly.manifest.packs.map((pack) => pack.id)).toEqual([
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "cosyworld.core",
    ]);
    expect(coreOnly.manifest.rules_profile).toBe("cosyworld.srd5/1");
    const corePack = coreOnly.manifest.packs.find((pack) => pack.id === "cosyworld.core");
    expect(corePack.default_ruleset).toBe("cosyworld.core/rules");
    expect(corePack.capabilities).toContainEqual({
      id: "cosyworld.core/rules",
      kind: "rules",
      version: "1.0.0",
    });
    expect(coreOnly.resources.locations.length).toBeGreaterThan(0);
    expect(coreOnly.resources.actors.length).toBeGreaterThan(0);
    expect(coreOnly.resources.cards.length).toBeGreaterThan(0);
    expect(coreOnly.resources.lifecycle_hooks.every((hook) => hook.effects.every((effect) => typeof effect.op === "string"))).toBe(true);
  });

  it("depends on the shared rules profile without mounting Ruby High", () => {
    expect(coreManifest.dependencies).toEqual([{
      id: "cosyworld.rules-profile-srd5",
      version: ">=1.0.0 <2.0.0",
      capabilities: ["cosyworld.rules-profile-srd5/rules"],
    }]);
    expect(coreOnly.manifest.packs).toHaveLength(3);
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

  it("soft-unmounts and remounts Core without losing identities or card zones", () => {
    const vacant = {
      worldpack_bundle_hash: coreOnly.manifest.bundle_hash,
      world_actors: [{ id: 1001, kind: 2, location_id: 1 }],
      world_items: [{
        id: 2001,
        location_id: 3,
        holder_actor_id: 1001,
        zone: 3,
        container_item_id: 0,
      }],
      world_locations: [{ id: 1 }, { id: 3 }],
      world_exits: [{ from_location_id: 1, to_location_id: 3 }],
      world_evolution_tracks: [{ actor_id: 1001 }],
      world_combat_encounters: [{ location_id: 3, participants: [{ actor_id: 1001 }] }],
      actor_meta: { 1001: { name: "Rati" } },
      equipped_charms: { 1001: [2001] },
      item_provenance: { 2001: { item_id: 2001, origin: "seed_pack" } },
      natural_affordances: { 3: { location_id: 3 } },
      clocks: { "natural-investigation:3:survey": { scope_id: 3 } },
      jobs: { "natural-investigation:3": { location_ids: [3] } },
      branches: { 1: { actor_id: 5000, target_actor_id: 1001 } },
      bonds: { bond: { actor_id: 5000, target_actor_id: 1001 } },
      transfer_offers: {
        gift: {
          offered_by_actor_id: 5000,
          offered_to_actor_id: 1001,
          offered_item_id: 2001,
          status: "pending",
        },
      },
      gift_auto_accepts: {
        policy: {
          recipient_actor_id: 1001,
          offered_by_actor_id: 5000,
          item_id: 2001,
          consumed: false,
        },
      },
      resident_continuities: { 1001: { resident_id: 1001 } },
      resident_memories: { memory: { carrier_actor_id: 1001, kind: "item", subject_id: 2001, location_id: 3 } },
      search_memories: { search: { actor_id: 5000, kind: "location", subject_id: 3, location_id: 3 } },
      tags: { tag: { scope_id: 3 } },
      world_simulation: { locations: { 3: {} }, factions: { hearthbound: {} } },
      content_context: {
        mapping_version: 1,
        references: coreOnly.content_references.entries
          .filter((entry) => entry.pack_id === "cosyworld.core")
          .slice(0, 3),
      },
    };
    const source = structuredClone(vacant);
    const result = migratePackUnmount(source, coreOnly, "cosyworld.core", servicesOnly);
    expect(source).toEqual(vacant);
    expect(result.removed).toEqual({ actors: 1, items: 1, locations: 2, exits: 1 });
    expect(result.snapshot.worldpack_bundle_hash).toBe(servicesOnly.manifest.bundle_hash);
    for (const field of ["world_evolution_tracks", "world_combat_encounters"]) {
      expect(result.snapshot[field]).toEqual([]);
    }
    for (const field of ["actor_meta", "natural_affordances", "clocks", "jobs", "branches", "bonds", "resident_continuities", "resident_memories", "search_memories", "tags"]) {
      expect(result.snapshot[field]).toEqual({});
    }
    expect(result.snapshot.world_simulation).toEqual({ locations: {}, factions: {} });
    expect(result.snapshot.transfer_offers.gift.status).toBe("invalidated");
    expect(result.snapshot.gift_auto_accepts.policy.consumed).toBe(true);
    expect(result.snapshot.content_context.references).toEqual([]);
    expect(result.snapshot.pack_mount_state.history).toEqual([
      expect.objectContaining({
        sequence: 1,
        status: "committed",
        operation: "soft_unmount",
        pack_id: "cosyworld.core",
        invalidated: {
          transfer_offers: 1,
          gift_auto_accepts: 1,
        },
      }),
    ]);
    const frozen = result.snapshot.pack_mount_state.frozen["cosyworld.core"];
    expect(frozen.arrays.world_items[0].value).toMatchObject({
      id: 2001,
      holder_actor_id: 1001,
      zone: 3,
    });
    expect(frozen.maps.equipped_charms).toEqual({ 1001: [2001] });
    expect(frozen.maps.item_provenance).toEqual({
      2001: { item_id: 2001, origin: "seed_pack" },
    });
    expect(frozen.invalidated).toEqual({
      transfer_offer_ids: ["gift"],
      gift_auto_accept_ids: ["policy"],
    });
    expect(frozen.maps.transfer_offers).toBeUndefined();
    expect(frozen.maps.gift_auto_accepts).toBeUndefined();

    const occupied = structuredClone(vacant);
    occupied.world_actors.push({ id: 5000, kind: 1, location_id: 1 });
    const occupiedBefore = structuredClone(occupied);
    expect(() => migratePackUnmount(occupied, coreOnly, "cosyworld.core", servicesOnly))
      .toThrow(/human actors 5000 still occupy/);
    expect(occupied).toEqual(occupiedBefore);

    const remounted = migratePackRemount(
      result.snapshot,
      servicesOnly,
      "cosyworld.core",
      coreOnly,
    );
    expect(remounted.restored).toEqual(result.removed);
    expect(remounted.snapshot.worldpack_bundle_hash).toBe(coreOnly.manifest.bundle_hash);
    for (const field of [
      "world_actors",
      "world_items",
      "world_locations",
      "world_exits",
      "world_evolution_tracks",
      "world_combat_encounters",
      "actor_meta",
      "equipped_charms",
      "item_provenance",
      "natural_affordances",
      "clocks",
      "jobs",
      "branches",
      "bonds",
      "resident_continuities",
      "resident_memories",
      "search_memories",
      "tags",
      "world_simulation",
      "content_context",
    ]) expect(remounted.snapshot[field], field).toEqual(vacant[field]);
    expect(remounted.snapshot.transfer_offers.gift.status).toBe("invalidated");
    expect(remounted.snapshot.gift_auto_accepts.policy.consumed).toBe(true);
    expect(remounted.snapshot.pack_mount_state.frozen).toEqual({});
    expect(remounted.snapshot.pack_mount_state.history).toHaveLength(2);
    expect(remounted.transaction).toMatchObject({
      sequence: 2,
      status: "committed",
      operation: "remount",
      pack_id: "cosyworld.core",
      state_hash: result.transaction.state_hash,
    });

    const conflicting = structuredClone(result.snapshot);
    conflicting.world_items.push({ id: 2001, location_id: 0, zone: 1 });
    const conflictingBefore = structuredClone(conflicting);
    expect(() =>
      migratePackRemount(conflicting, servicesOnly, "cosyworld.core", coreOnly))
      .toThrow(/world_items identity 2001 is already active/);
    expect(conflicting).toEqual(conflictingBefore);
  });

  it("provides a non-world services composition without silently mounting Core", () => {
    expect(servicesOnly.manifest.entry_location).toBeUndefined();
    expect(servicesOnly.manifest.packs.map((pack) => pack.id)).toEqual([
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "cosyworld.services-fixture",
    ]);
    expect(servicesOnly.resources.locations).toEqual([]);
    expect(servicesOnly.resources.actors).toEqual([]);
  });
});
