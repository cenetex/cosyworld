import { describe, expect, it } from "vitest";
import { createWorld, exits } from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { drawSpecials } from "../v2/card-game/pack-specials.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";

const pack = packDefinition("hoppycat-archive");
const garden = "hoppycat-halfway-tea-garden";
const jetty = "hoppycat-signal-jetty";

// Places Vale can walk to inside the archive, from the garden.
function reachable(world) {
  const seen = new Set([garden]);
  for (const place of seen) {
    world.actors.vale.place = place;
    for (const to of exits(world, place, "vale"))
      if (pack.places[to]) seen.add(to);
  }
  return seen;
}

describe("Hoppy Cat as a small world", () => {
  it("keeps the garden and jetty core with each drawn place within one, for every seed", () => {
    const pool = new Set(pack.specials.pool.map((e) => e.id));
    expect(pool.has(garden) || pool.has(jetty)).toBe(false);
    // The spool starts at the empty station and is never drawn.
    expect(pool.has("hoppycat-red-thread-spool")).toBe(false);
    for (let seed = 0; seed < 1000; seed++) {
      const world = createWorld({ seed });
      const drawn = world.packs[pack.id].specials;
      expect(drawn).toEqual(drawSpecials(pack, seed));
      expect(drawn).toHaveLength(2);
      const places = drawn.filter((id) => pack.places[id]);
      expect(places).toHaveLength(2);
      expect([...reachable(world)].sort()).toEqual(
        [garden, jetty, ...places].sort(),
      );
      // Each drawn place leads back to the garden or the jetty alone.
      for (const id of places) {
        world.actors.vale.place = id;
        const back = exits(world, id, "vale");
        expect(back).toHaveLength(1);
        expect([garden, jetty]).toContain(back[0]);
      }
    }
  });

  it("draws the same run in a shared world and a local game", () => {
    for (const seed of [3, 1622, 4294967295]) {
      const shared = dispatchShared({ op: "create", seed }).world;
      expect(shared.packs[pack.id].specials).toEqual(
        createWorld({ opening: true, seed }).packs[pack.id].specials,
      );
    }
  });

  it("opens the whole archive on its own landing", () => {
    const world = createLandingWorld(pack, 7);
    expect(reachable(world).size).toBe(6);
    for (const [id, a] of Object.entries(pack.avatars))
      expect(world.actors[id].place).toBe(a.place);
  });

  it("keeps every active place within three local links", () => {
    for (const place of Object.values(pack.places).filter((p) => !p.retired))
      expect(place.exits.length).toBeLessThanOrEqual(3);
  });
});
