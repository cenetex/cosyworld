import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { hub, packDefinitions } from "../v2/card-game/pack-registry.mjs";

const condition = { kind: "item_present", item: "cloth", place: "attic" };
const present = (world) => conditionMet(world, condition, null);

describe("physical items at a crossing", () => {
  it("accepts an item on the room floor or carried by someone in that room", () => {
    const world = createWorld();
    world.items.cloth.holder = "attic";
    expect(present(world)).toBe(true);
    for (const actor of ["vale", "keeper", "mara"]) {
      world.actors[actor].place = "attic";
      world.items.cloth.holder = actor;
      expect(present(world), actor).toBe(true);
      world.actors[actor].place = "pond";
      expect(present(world), actor).toBe(false);
    }
  });

  it("follows an item covering another item through its carrier", () => {
    const world = createWorld();
    world.items.cloth.holder = "lamp";
    world.items.lamp.holder = "vale";
    world.actors.vale.place = "attic";
    expect(present(world)).toBe(true);
    world.actors.vale.place = "pond";
    expect(present(world)).toBe(false);
    world.items.lamp.holder = "attic";
    expect(present(world)).toBe(true);
    world.items.lamp.lit = false;
    world.items.lamp.fuel = 0;
    expect(present(world)).toBe(true);
  });

  it("rejects missing items and custody cycles while retaining ground-only item_at", () => {
    const world = createWorld();
    expect(conditionMet(world, { ...condition, item: "missing" }, null)).toBe(
      false,
    );
    world.items.cloth.holder = "lamp";
    world.items.lamp.holder = "cloth";
    expect(present(world)).toBe(false);
    world.items.cloth.holder = "vale";
    world.actors.vale.place = "attic";
    expect(conditionMet(world, { ...condition, kind: "item_at" }, null)).toBe(
      false,
    );
    world.items.cloth.holder = "attic";
    expect(conditionMet(world, { ...condition, kind: "item_at" }, null)).toBe(
      true,
    );
  });

  it("validates hub item and room references in crossing data", () => {
    const pack = structuredClone(
      packDefinitions.find((p) => p.id === "badger-forest"),
    );
    pack.crossings[0].requires = [condition];
    expect(packProblems(pack, hub)).toEqual([]);
    for (const invalid of [
      { ...condition, item: "missing" },
      { ...condition, place: "missing" },
      { ...condition, extra: true },
    ]) {
      pack.crossings[0].requires = [invalid];
      expect(packProblems(pack, hub).join(" ")).toMatch(/condition/);
    }
  });
});
