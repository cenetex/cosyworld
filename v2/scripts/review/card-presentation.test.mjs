import { describe, it, expect } from "vitest";
import { cardObservation } from "../v2/card-game/cards.mjs";
import { createWorld, encodeSave } from "../v2/card-game/world.mjs";

describe("observable card descriptions", () => {
  it("describes the flame without revealing fuel arithmetic", () => {
    const world = createWorld();
    world.items.lamp.lit = true;
    for (const fuel of [1, 5, 12]) {
      world.items.lamp.fuel = fuel;
      expect(cardObservation(world, "lamp")).toMatch(/^Lit\./);
      expect(cardObservation(world, "lamp")).not.toMatch(/\d|fuel|turn|signal/i);
    }
    world.items.lamp.lit = false;
    expect(cardObservation(world, "lamp")).toMatch(/^Unlit\./);
  });
  it("describes sound and the cloth without counting down", () => {
    const world = createWorld();
    world.items.bell.ringing = 3;
    expect(cardObservation(world, "bell")).toMatch(/^Ringing\./);
    world.items.bell.ringing = 1;
    expect(cardObservation(world, "bell")).not.toMatch(/\d|left|again/);
    world.items.cloth.holder = "bell";
    expect(cardObservation(world, "bell")).toMatch(/^Silent\. Covered by Black cloth/);
    expect(cardObservation(world, "cloth")).toBe("On Bell.");
  });
  it("does not disclose hidden ritual phases", () => {
    const world = createWorld();
    const before = cardObservation(world, "pond");
    for (const phase of [0, 1, 2, 3, 4]) {
      world.locations.pond.shipSignal = phase;
      expect(cardObservation(world, "pond")).toBe(before);
    }
  });
  it("never treats a person's internal progress as visible description", () => {
    const world = createWorld();
    const before = cardObservation(world, "vale");
    world.actors.vale.progress.step = 99;
    expect(cardObservation(world, "vale")).toBe(before);
    expect(before).not.toMatch(/quest|level|inspiration|hope|\d/i);
  });
  it("does not change the world or spend a turn", () => {
    const world = createWorld();
    const before = encodeSave(world);
    for (const id of ["lamp", "cloth", "bell", "oil", "vale", "pond"])
      cardObservation(world, id);
    expect(encodeSave(world)).toBe(before);
  });
});
