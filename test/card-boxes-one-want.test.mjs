// Rules 133: package 2 (boxes) with package 1 (one want). Opening a box pays
// its one XP without raising a level, the save validates at turn 0, and the
// gate play of a sealed way takes the one want only from a player holding none.
import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  holdChoice,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { levelOf } from "../v2/card-game/want.mjs";

describe("boxes and the one want", () => {
  it("credits a box at turn 0 with no XP or level, and validates", () => {
    const world = createWorld({ opening: true, seed: 17 });
    expect(world.turn).toBe(0);
    const xp = world.actors.vale.xp;
    holdChoice(world, "vale", { item: null, revision: world.revision });
    expect(world.opened).toEqual({ pond: ["vale"] });
    expect(world.actors.vale.xp).toBe(xp);
    expect(levelOf(world, "vale")).toBe(0);
    validateWorld(decodeSave(encodeSave(world)));
    world.turn = 1;
    world.actors.vale.xp += 1;
    validateWorld(decodeSave(encodeSave(world)));
    world.actors.vale.xp = 40;
    expect(() => validateWorld(decodeSave(encodeSave(world)))).toThrow();
  });
});
