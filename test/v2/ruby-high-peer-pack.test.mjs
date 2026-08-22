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
    expect(rubyOnly.manifest.packs.map((pack) => pack.id)).toEqual([
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "ruby-high.first-bell",
    ]);
    expect(rubyOnly.manifest.rules_profile).toBe("cosyworld.srd5/1");
    expect(rubyOnly.manifest.entry_location).toBe("ruby-high.first-bell:location/11");
    expect(rubyOnly.manifest.entry_grant_id).toBeUndefined();
    const rubyPack = rubyOnly.manifest.packs.find((pack) => pack.id === "ruby-high.first-bell");
    expect(rubyPack.kind).toBe("world");
    expect(rubyPack.default_ruleset).toBe("ruby-high.first-bell/rules");
    expect(rubyPack.extensions["x-cosyworld-rules-context"].vocabulary.actions)
      .toEqual(["study", "test", "revise", "attend"]);
    expect(rubyOnly.resources.locations).toHaveLength(6);
    expect(rubyOnly.resources.room_sheets).toHaveLength(6);
    expect(rubyOnly.resources.actors).toHaveLength(9);
    expect(rubyOnly.resources.items).toHaveLength(6);
    expect(rubyOnly.resources.cards).toHaveLength(21);
    expect(rubyOnly.resources.exits).toHaveLength(16);
    expect(rubyOnly.resources.exits.every((exit) =>
      rubyOnly.resources.locations.some((location) => location.id === exit.from_location_id)
      && rubyOnly.resources.locations.some((location) => location.id === exit.to_location_id)))
      .toBe(true);
    expect(rubyOnly.resources.actor_facets).toEqual([]);
    expect(rubyOnly.resources.card_bindings).toEqual([]);
  });

  it("populates the school with autonomous residents and borderless world art", () => {
    const residentNames = [
      "Lyra",
      "Sami",
      "Ravi",
      "Indra",
      "Mika",
      "Noor",
      "Ruby",
      "Sally Science",
      "Professor Edward",
    ];
    expect(rubyOnly.resources.actors.map((actor) => actor.name)).toEqual(residentNames);
    expect(rubyOnly.resources.actors.every((actor) =>
      actor.pack_id === "ruby-high.first-bell"
      && actor.event_autonomy === true
      && actor.roaming === true))
      .toBe(true);
    expect(rubyOnly.resources.factions.find((faction) => faction.id === "ruby_high")?.member_actor_ids)
      .toEqual(rubyOnly.resources.actors.map((actor) => actor.id));

    const schoolCards = rubyOnly.resources.cards.filter((card) =>
      ["actor", "item", "location"].includes(card.subject_kind));
    expect(schoolCards).toHaveLength(21);
    for (const card of schoolCards) {
      const external = rubyOnly.external_cards.find((candidate) =>
        candidate.card_id === card.external_card_id);
      expect(external?.image_url).toMatch(/^\/assets\/ruby-high\/world\/(avatars|items|locations)\/.+\.webp$/);
      expect(external?.image_url).not.toContain("/cards/");
    }

    const worldArtMount = rubyOnly.assets.find((asset) =>
      asset.pack_id === "ruby-high.first-bell" && asset.mount === "world-art");
    expect(worldArtMount).toEqual(expect.objectContaining({
      public_prefix: "/assets/ruby-high/world",
      optional: false,
    }));
    const worldArtRoot = path.join(
      repoRoot,
      "v2/content",
      worldArtMount.root,
      worldArtMount.directory,
    );
    for (const external of rubyOnly.external_cards.filter((card) =>
      card.image_url?.startsWith("/assets/ruby-high/world/"))) {
      const relativePath = external.image_url.replace("/assets/ruby-high/world/", "");
      expect(fs.existsSync(path.join(worldArtRoot, relativePath)), relativePath).toBe(true);
    }
    expect(rubyOnly.external_cards).toHaveLength(24);
    expect(rubyOnly.external_cards.every((card) =>
      card.image_url?.startsWith("/assets/ruby-high/world/")))
      .toBe(true);
  });

  it("declares Core as optional while composition owns paths and Ruby owns facets", () => {
    expect(rubyManifest.dependencies).toEqual([
      {
        id: "cosyworld.core",
        version: ">=1.3.0 <2.0.0",
        capabilities: ["cosyworld.core/world"],
        optional: true,
      },
      {
        id: "cosyworld.rules-profile-srd5",
        version: ">=1.0.0 <2.0.0",
        capabilities: ["cosyworld.rules-profile-srd5/rules"],
      },
    ]);
    expect(official.resources.exits.filter((exit) => exit.pack_id === "ruby-high.first-bell")).toHaveLength(16);
    expect(official.resources.exits.filter((exit) =>
      exit.pack_id === "cosyworld.composition.core-ruby")).toHaveLength(8);
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
    expect(coreOnly.resources.actors.find((actor) => actor.id === 1001)).toEqual(
      expect.objectContaining({ pack_id: "cosyworld.core", name: "Rati" }),
    );
    expect(coreRati.external_card_id).toBeUndefined();
    expect(coreRati.source).toBe("cosyworld_core");
  });

  it("owns every public school resource instead of leaking it through Core", () => {
    expect(official.resources.access_gates).toEqual([]);
    const schoolLocationIds = new Set([10, 11, 12, 13, 14, 15]);
    for (const locationId of schoolLocationIds) {
      expect(official.resources.locations.find((location) => location.id === locationId)?.pack_id)
        .toBe("ruby-high.first-bell");
      expect(official.resources.cards.find((card) =>
        card.subject_kind === "location" && card.subject_id === locationId)?.pack_id)
        .toBe("ruby-high.first-bell");
    }
    expect(official.resources.exits
      .filter((exit) => schoolLocationIds.has(exit.from_location_id) || schoolLocationIds.has(exit.to_location_id))
      .every((exit) => [
        "ruby-high.first-bell",
        "cosyworld.composition.core-ruby",
      ].includes(exit.pack_id)))
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
