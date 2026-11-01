import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { backdrop, lampLitHere } from "../v2/card-game/scene.mjs";

// #1422, #1600: the attic is painted lit while the lamp shines in it, doused
// while the dark lamp is there, and dark without it.
const DARK = "./assets/shared/places/attic-dark.webp";
const LIT = "./assets/attic/attic-lit.webp";
const DOUSED = "./assets/attic/attic-doused.webp";
function attic({ lit, holder }) {
  const world = createWorld();
  world.actors.vale.place = "attic";
  world.items.lamp.holder = holder;
  world.items.lamp.lit = lit;
  world.items.lamp.fuel = 12;
  return world;
}

describe("attic backdrop follows the lamp in the attic", () => {
  it("is doused while the lamp in the attic is unlit or covered", () => {
    const world = attic({ lit: false, holder: "attic" });
    expect(lampLitHere(world, "attic")).toBe(false);
    expect(backdrop("attic", world)).toBe(DOUSED);
    const covered = attic({ lit: true, holder: "vale" });
    covered.items.cloth.holder = "lamp";
    expect(backdrop("attic", covered)).toBe(DOUSED);
  });
  it("is lit while Vale holds the lit lamp in the attic", () => {
    const world = attic({ lit: true, holder: "vale" });
    expect(lampLitHere(world, "attic")).toBe(true);
    expect(backdrop("attic", world)).toBe(LIT);
  });
  it("is lit while the lit lamp is put down in the attic", () => {
    const world = attic({ lit: true, holder: "attic" });
    expect(lampLitHere(world, "attic")).toBe(true);
    expect(backdrop("attic", world)).toBe(LIT);
  });
  it("is dark while the lit lamp is at the pond", () => {
    const world = attic({ lit: true, holder: "pond" });
    expect(lampLitHere(world, "attic")).toBe(false);
    expect(lampLitHere(world, "pond")).toBe(true);
    expect(backdrop("attic", world)).toBe(DARK);
  });
});
