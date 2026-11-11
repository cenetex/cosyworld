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
import { levelFor } from "../v2/card-game/want.mjs";

describe("boxes and the one want", () => {
  it("pays a box's XP at turn 0 without raising a level, and validates", () => {
    const world = createWorld({ opening: true, seed: 17 });
    expect(world.turn).toBe(0);
    const xp = world.actors.vale.xp;
    holdChoice(world, "vale", { item: null, revision: world.revision });
    expect(world.opened).toEqual({ pond: ["vale"] });
    expect(world.actors.vale.xp).toBe(xp + 1);
    expect(world.actors.vale.level).toBe(levelFor(xp));
    // Box XP plus the XP a want pays on its play stay within the cap.
    validateWorld(decodeSave(encodeSave(world)));
    world.turn = 1;
    world.actors.vale.xp += 1;
    validateWorld(decodeSave(encodeSave(world)));
    // Enough XP for the next level still does not level an avatar up.
    world.actors.vale.xp = 40;
    expect(() => validateWorld(decodeSave(encodeSave(world)))).toThrow();
  });
});
