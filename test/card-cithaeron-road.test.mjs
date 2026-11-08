import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  exits,
  sealedWays,
} from "../v2/card-game/world.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

const PACK = "greek-drama",
  FIELD = "greek-battlefield",
  ROAD = "greek-cithaeron",
  ROAD_KEY = `${FIELD}>${ROAD}`;
const reload = (world) => decodeSave(JSON.stringify(world));
function atBattlefield() {
  const world = createWorld({ packScopes: { [PACK]: "full" } });
  world.crossings["pond-greek-harbor"].discovered = true;
  world.actors.vale.place = FIELD;
  world.actors["greek-antigone"].place = FIELD;
  world.turn = world.revision = 36;
  return world;
}
const flagMet = (world, key) =>
  conditionMet(world, { kind: "flag", key, value: true }, null, PACK);

describe("the Cithaeron road from the Exposed Battlefield", () => {
  it.each(["vale", "greek-antigone"])(
    "stays open for %s before and after Polynices is buried",
    (actor) => {
      const world = atBattlefield();
      expect(flagMet(world, "greek-burial-performed")).toBe(false);
      expect(exits(reload(world), FIELD, actor)).toContain(ROAD);
      expect(sealedWays(reload(world), actor).map((way) => way.to)).not.toContain(
        ROAD,
      );

      world.packs[PACK].flags["greek-burial-performed"] = true;
      expect(exits(world, FIELD, actor)).toContain(ROAD);
    },
  );

  it("opens for a rev22 save that has no burial or gate progress", () => {
    const old = atBattlefield();
    old.packs[PACK].revision = 22;
    expect(flagMet(old, "greek-burial-performed")).toBe(false);
    expect(flagMet(old, "greek-guard-warned")).toBe(false);
    expect(old.items["greek-creon-writ"].holder).toBe("greek-creon");
    expect(old.items["greek-guard-tablet"].holder).toBe("greek-gate");

    const current = reload(old);
    expect(current.packs[PACK].revision).toBe(24);
    expect(flagMet(current, "greek-burial-performed")).toBe(false);
    expect(flagMet(current, "greek-guard-warned")).toBe(false);
    for (const actor of ["vale", "greek-antigone"])
      expect(exits(current, FIELD, actor)).toContain(ROAD);
  });

  it("drops only the retired road latch from a lawfully buried rev22 save", () => {
    const old = structuredClone(funeralJourney().buried);
    const burial = {
        kind: "flag",
        key: "greek-burial-performed",
        value: true,
      },
      accountAt = (place) => ({
        kind: "item_near",
        item: "greek-burial-account",
        place,
      });
    expect(conditionMet(old, burial, null, PACK)).toBe(true);
    expect(
      [FIELD, "greek-courtyard"].some((place) =>
        conditionMet(old, accountAt(place), null, PACK),
      ),
    ).toBe(true);
    old.packs[PACK].revision = 22;
    old.openedRoutes = [...new Set([...(old.openedRoutes || []), ROAD_KEY])].sort();
    const flags = structuredClone(old.packs[PACK].flags);
    const receipts = structuredClone(old.packs[PACK].receipts);
    const items = Object.fromEntries(
      ["greek-burial-account", "greek-creon-writ", "greek-guard-tablet"].map(
        (id) => [id, old.items[id].holder],
      ),
    );

    const current = reload(old);
    expect(current.packs[PACK].revision).toBe(24);
    expect(current.packs[PACK].flags).toEqual(flags);
    expect(current.packs[PACK].receipts).toEqual(receipts);
    expect(current.openedRoutes).toContain(
      `${FIELD}>greek-polynices-hollow`,
    );
    expect(current.openedRoutes).not.toContain(ROAD_KEY);
    for (const [id, holder] of Object.entries(items))
      expect(current.items[id].holder).toBe(holder);
    for (const actor of ["vale", "greek-antigone"])
      expect(exits(current, FIELD, actor)).toContain(ROAD);
  });
});
