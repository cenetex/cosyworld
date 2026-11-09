import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";

const held = (world, item, actor) =>
  conditionMet(world, { kind: "held", item, ...(actor ? { actor } : {}) }, null);
const grounded = (world, item) =>
  conditionMet(world, { kind: "grounded", item }, null);

describe("held and grounded conditions", () => {
  it("held is true only when the current player carries the thing", () => {
    const world = createWorld();
    world.items.lamp.holder = "vale";
    expect(held(world, "lamp")).toBe(true);
    world.items.lamp.holder = "keeper";
    expect(held(world, "lamp")).toBe(false);
    world.items.lamp.holder = "attic";
    expect(held(world, "lamp")).toBe(false);
  });

  it("held accepts a named carrier", () => {
    const world = createWorld();
    world.items.lamp.holder = "keeper";
    expect(held(world, "lamp", "keeper")).toBe(true);
    expect(held(world, "lamp", "vale")).toBe(false);
  });

  it("grounded is true only when the thing rests on a place", () => {
    const world = createWorld();
    world.items.lamp.holder = "attic";
    expect(grounded(world, "lamp")).toBe(true);
    world.items.lamp.holder = "vale";
    expect(grounded(world, "lamp")).toBe(false);
    // Inside another thing is not on the ground.
    world.items.lamp.holder = "cloth";
    expect(grounded(world, "lamp")).toBe(false);
  });
});
