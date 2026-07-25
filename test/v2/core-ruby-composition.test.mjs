import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const registry = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "v2/content/core-ruby/registry.json"), "utf8"),
);

describe("Core + Ruby High composition", () => {
  it("mounts the peer worlds with only their explicit bridge resources", () => {
    expect(registry.manifest.id).toBe("cosyworld.core-ruby");
    expect(registry.manifest.packs.map((pack) => pack.id)).toEqual([
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "cosyworld.core",
      "ruby-high.first-bell",
    ]);
    expect(registry.resources.exits.filter((exit) =>
      [1, 11].includes(exit.from_location_id)
      && [1, 11].includes(exit.to_location_id))).toEqual([
      expect.objectContaining({
        from_location_id: 1,
        to_location_id: 11,
        pack_id: "ruby-high.first-bell",
      }),
      expect.objectContaining({
        from_location_id: 11,
        to_location_id: 1,
        pack_id: "ruby-high.first-bell",
      }),
    ]);
    expect(registry.resources.actor_facets).toEqual([
      expect.objectContaining({
        id: "rati-first-bell",
        actor_ref: "pack://cosyworld.core/actor/1001",
        pack_id: "ruby-high.first-bell",
      }),
    ]);
    expect(registry.resources.card_bindings).toEqual([
      expect.objectContaining({
        entity_ref: "pack://cosyworld.core/actor/1001",
        external_card_id: "rati",
        pack_id: "ruby-high.first-bell",
      }),
    ]);
  });

  it("keeps both location rule vocabularies and cards available at the boundary", () => {
    expect(registry.resources.action_vocabulary).toEqual([
      expect.objectContaining({ pack_id: "cosyworld.core", travel: "Travel" }),
      expect.objectContaining({ pack_id: "ruby-high.first-bell", travel: "Head to" }),
    ]);
    expect(registry.resources.cards.find((card) =>
      card.subject_kind === "location" && card.subject_id === 1)).toEqual(
      expect.objectContaining({ card_id: "cosy-cottage", pack_id: "cosyworld.core" }),
    );
    expect(registry.resources.cards.find((card) =>
      card.subject_kind === "location" && card.subject_id === 11)).toEqual(
      expect.objectContaining({
        card_id: "location-homeroom",
        pack_id: "ruby-high.first-bell",
      }),
    );
  });
});
