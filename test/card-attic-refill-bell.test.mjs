// The attic gate's rescue path when the refill bell is shut inside it. These
// read exits and physical plays only; no quest drives them.
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
  world.items.lamp.holder = "moth";
  world.items.lamp.fuel = 0;
  world.items.lamp.lit = false;
  world.items.oil.holder = "attic";
  world.items.oil.doses = 2;
  world.items.cloth.holder = "pond";
  return world;
}

function trappedRefillBell() {
  const world = trappedOil();
  world.items.lamp.holder = world.items.oil.holder = "vale";
  world.items.oil.doses = 0;
  world.items.bell.holder = "attic";
  return world;
}

describe("a refill bell trapped behind the attic gate", () => {
  it("recovers the bell by a saved physical journey after both fuel supplies run out", () => {
    const world = trappedRefillBell(), items = structuredClone(world.items);
    expect(exits(world, "pond", "vale")).toContain("attic");
    expect(exits(world, "attic", "vale")).not.toContain("forest-cottage");
    const restored = decodeSave(encodeSave(world));
    expect(restored.items).toEqual(items);
    const action = legalActions(restored).find((a) => a.kind === "move" && a.target === "attic");
    expect(action.text).toContain("along a narrow path");
    const next = commit(restored, "move", { target: "attic" });
    expect(next.actors.vale.place).toBe("attic");
    expect(next.items.bell.holder).toBe("attic");
    expect(next.items.lamp.fuel).toBe(0);
    expect(next.items.oil.doses).toBe(0);
    expect(legalActions(next)).toContainEqual(expect.objectContaining({ kind: "take", item: "bell" }));
    expect(exits(next, "attic", "vale")).not.toContain("forest-cottage");
  });

  it.each(["fuel", "reachable oil", "reachable bell", "helper inside", "bell carrier inside"])("keeps ordinary %s recovery in use", (kind) => {
    const world = trappedRefillBell();
    if (kind === "fuel") world.items.lamp.fuel = 4;
    if (kind === "reachable oil") world.items.oil.doses = 1;
    if (kind === "reachable bell") world.items.bell.holder = "station";
    if (kind === "helper inside") world.actors.keeper.place = "attic";
    if (kind === "bell carrier inside") {
      world.actors.moth.place = "attic";
      world.items.bell.holder = "moth";
    }
    expect(exits(world, "pond", "vale")).not.toContain("attic");
  });

});
