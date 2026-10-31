import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { backdrop, lampLitHere } from "../v2/card-game/scene.mjs";

// #1422: the attic is painted lit only while the lamp shines in the attic.
const DARK = "./assets/shared/places/attic-dark.webp";
function attic({ lit, holder }) {
  const world = createWorld();
  world.actors.vale.place = "attic";
  world.items.lamp.holder = holder;
  world.items.lamp.lit = lit;
  world.items.lamp.fuel = 12;
  return world;
}

describe("attic backdrop follows the lamp in the attic", () => {
  it("is dark while the lamp in the attic is unlit", () => {
    const world = attic({ lit: false, holder: "attic" });
    expect(lampLitHere(world, "attic")).toBe(false);
    expect(backdrop("attic", world)).toBe(DARK);
  });
  it("is lit while Vale holds the lit lamp in the attic", () => {
    const world = attic({ lit: true, holder: "vale" });
    expect(lampLitHere(world, "attic")).toBe(true);
    expect(backdrop("attic", world)).not.toBe(DARK);
  });
  it("is lit while the lit lamp is put down in the attic", () => {
    const world = attic({ lit: true, holder: "attic" });
    expect(lampLitHere(world, "attic")).toBe(true);
    expect(backdrop("attic", world)).not.toBe(DARK);
  });
  it("is dark while the lit lamp is at the pond", () => {
    const world = attic({ lit: true, holder: "pond" });
    expect(lampLitHere(world, "attic")).toBe(false);
    expect(lampLitHere(world, "pond")).toBe(true);
    expect(backdrop("attic", world)).toBe(DARK);
  });
});
