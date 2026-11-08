import { it, expect } from "vitest";
import { places, people } from "../v2/card-game/world.mjs";
import core from "../v2/card-game/assets/staging/core.json" with { type: "json" };
import greek from "../v2/card-game/assets/staging/greek.json" with { type: "json" };
import worlds from "../v2/card-game/assets/staging/worlds.json" with { type: "json" };

it("covers each current place with valid painted standing spots", () => {
  const catalog = { ...core.places, ...greek.places, ...worlds.places };
  expect(Object.keys(places).filter((id) => !catalog[id])).toEqual([]);
  for (const [place, entry] of Object.entries(catalog)) {
    for (const variant of [entry, ...Object.values(entry.backdrops || {})]) {
      expect(variant.spots).toHaveLength(6);
      for (const [x, y, scale] of variant.spots) {
        expect([x, y, scale].every(Number.isFinite)).toBe(true);
        expect(x >= 0 && x <= 100 && y >= 0 && y <= 100 && scale > 0).toBe(
          true,
        );
      }
      for (const [id, index] of Object.entries(variant.avatars || {})) {
        if (places[place]) expect(people[id]).toBeDefined();
        expect(Number.isInteger(index) && index >= 0 && index < 6).toBe(true);
      }
    }
  }
});
