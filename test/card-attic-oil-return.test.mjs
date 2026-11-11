// The attic gate's rescue path when the oil flask is shut inside it with the
// lamp empty outside. These read exits and physical plays only.
import { describe, expect, it } from "vitest";
import {
  createWorld,
  holdChoice,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { roomFuelFromTurns } from "../v2/card-game/lamp-room-fuel.mjs";
import { settleLamp } from "../v2/card-game/lamp-state.mjs";

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
  Object.assign(world.items.lamp, roomFuelFromTurns(0, "pond"));
  world.items.lamp.fuel = 0;
  world.items.lamp.lit = false;
  world.items.oil.holder = "attic";
  world.items.cloth.holder = "pond";
  return world;
}

describe("an oil flask trapped behind the attic gate", () => {
  it("recovers the flask by a saved physical journey and refuels the empty lamp", () => {
    const world = trappedOil(), items = structuredClone(world.items);
    expect(exits(world, "pond", "vale")).toContain("attic");
    const restored = decodeSave(encodeSave(world));
    expect(restored.items).toEqual(items);
    const action = legalActions(restored).find((a) => a.kind === "move" && a.target === "attic");
    expect(action.text).toContain("along a narrow path");
    let next = commit(restored, "move", { target: "attic" });
    expect(next.actors.vale.place).toBe("attic");
    expect(next.items.lamp.fuel).toBe(0);
    // Taking the flask with the empty lamp in hand fills it at once.
    next = commit(next, "take", { item: "oil" });
    expect(next.items.lamp.fuel).toBe(12);
    expect(next.items.oil.holder).toBe("station");
    expect(next.log.find((e) => e.verb === "refuel")).toMatchObject({
      actorId: "vale",
      locationId: "attic",
      returnLocationId: "station",
    });
    // Refilling a held lamp lights it; stowing quietly reopens the mirror.
    expect(next.items.lamp.lit).toBe(true);
    expect(exits(next, "attic", "vale")).not.toContain("pond");
    holdChoice(next, "vale", { item: null, revision: next.revision });
    expect(exits(next, "attic", "vale")).toContain("pond");
    holdChoice(next, "vale", { item: "lamp", revision: next.revision });
    expect(exits(next, "attic", "vale")).not.toContain("pond");
  });

  it.each(["fuel", "reachable oil", "helper inside"])("keeps ordinary %s recovery in use", (kind) => {
    const world = trappedOil();
    if (kind === "fuel") {
      Object.assign(world.items.lamp, roomFuelFromTurns(4, "pond"));
      settleLamp(world);
    }
    if (kind === "reachable oil") world.items.oil.holder = "station";
    if (kind === "helper inside") world.actors.keeper.place = "attic";
    expect(exits(world, "pond", "vale")).not.toContain("attic");
  });
});
