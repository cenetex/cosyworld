// The attic gate's rescue path when the oil flask is shut inside it with the
// lamp outside. These read exits and physical plays only.
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";

function commit(world, kind, fields = {}) {
  const action = legalActions(world).find((a) => a.kind === kind &&
    Object.entries(fields).every(([key, value]) => a[key] === value));
  expect(action).toBeDefined();
  const result = play(world, action);
  expect(result.ok).toBe(true);
  expect(play(decodeSave(encodeSave(world)), action)).toEqual(result);
  return result.state;
}

function trappedOil() {
  const world = createWorld();
  for (const id of ["vale", "moth", "keeper"]) world.actors[id].place = "pond";
  world.items.lamp.holder = "vale";
  world.items.oil.holder = "attic";
  world.items.cloth.holder = "pond";
  return world;
}

describe("an oil flask trapped behind the attic gate", () => {
  it("recovers the flask by a saved physical journey and lights the lamp on reunion", () => {
    const world = trappedOil(), items = structuredClone(world.items);
    expect(exits(world, "pond", "vale")).toContain("attic");
    const restored = decodeSave(encodeSave(world));
    expect(restored.items).toEqual(items);
    const action = legalActions(restored).find((a) => a.kind === "move" && a.target === "attic");
    expect(action.text).toContain("along a narrow path");
    let next = commit(restored, "move", { target: "attic" });
    expect(next.actors.vale.place).toBe("attic");
    // The flask waits here, so the lamp lights at once and the mirror shuts.
    expect(exits(next, "attic", "vale")).not.toContain("pond");
    next = commit(next, "take", { item: "oil" });
    expect(next.items.oil.holder).toBe("vale");
    expect(exits(next, "attic", "vale")).not.toContain("pond");
  });

  it("keeps ordinary reachable-oil recovery in use", () => {
    const world = trappedOil();
    world.items.oil.holder = "station";
    expect(exits(world, "pond", "vale")).not.toContain("attic");
  });
});
