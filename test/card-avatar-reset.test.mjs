import { describe, expect, it } from "vitest";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { newWant, levelOf } from "../v2/card-game/want.mjs";
import { validateWorld } from "../v2/card-game/world.mjs";

// A world some turns along, so the experience below is reachable.
const along = () => {
  const world = dispatchShared({ op: "create" }).world;
  world.turn = 10;
  world.revision = 10;
  return world;
};
const ask = (world, op, actor, claimed = humanAvatarIds, extra = {}) =>
  dispatchShared({ world, op, actor, claimed, present: claimed, ...extra });

describe("an owner deletes an avatar from a shared world (#1825)", () => {
  it("starts the avatar over at level 1 and drops what it held where it stood", () => {
    const start = along();
    const world = structuredClone(start);
    const mara = world.actors.mara;
    mara.place = "pond";
    mara.xp = 6;
    mara.level = 4;
    mara.want = {
      ...newWant("place", "attic", 0),
      quest: { level: 5, left: 2 },
    };
    mara.trust.vale = 2;
    world.actors.vale.trust.mara = 3;
    world.items.lamp.holder = "mara";
    world.items.mask.holder = "mara";
    const result = ask(world, "reset", "mara");
    expect(result.ok).toBe(true);
    const after = result.world;
    expect(after.actors.mara).toEqual(start.actors.mara);
    expect(levelOf(after, "mara")).toBe(1);
    expect(after.items.lamp.holder).toBe("pond");
    expect(after.items.mask.holder).toBe("pond");
    expect(after.actors.vale.trust.mara).toBe(0);
    expect(after.memories.mara).toEqual(start.memories.mara);
    expect(after.revision).toBe(world.revision + 1);
    // Nobody else changes.
    expect(after.actors.vale.place).toBe(world.actors.vale.place);
    expect(() => validateWorld(after)).not.toThrow();
  });

  it("ends a standoff the avatar was in", () => {
    const world = along();
    world.actors.mara.place = world.actors.vale.place;
    world.standoffs = [
      {
        challenger: "vale",
        defender: "mara",
        location: world.actors.vale.place,
        item: null,
        answered: false,
        opened: 1,
        resolve: { vale: 4, mara: 4 },
        guarding: { vale: false, mara: false },
        struck: { vale: false, mara: false },
      },
    ];
    const after = ask(world, "reset", "mara").world;
    expect(after.standoffs).toEqual([]);
  });

  it("is deterministic for replay", () => {
    const world = along();
    world.actors.ash.xp = 3;
    expect(ask(world, "reset", "ash")).toEqual(ask(world, "reset", "ash"));
  });
});
