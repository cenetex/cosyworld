import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { backdrop, lampLitHere, placeCardArt } from "../v2/card-game/scene.mjs";

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

// The Mirror attic card at the Black Pond shows the attic as Vale would find
// it through the mirror: with the lamp Vale carries.
describe("attic card follows the lamp it would arrive with", () => {
  const atPond = (lit) => {
    const world = attic({ lit, holder: "vale" });
    world.actors.vale.place = "pond";
    return world;
  };
  it("is lit while Vale holds the lit lamp at the pond", () => {
    const world = atPond(true);
    expect(placeCardArt(world, "attic")).toBe(LIT);
    expect(backdrop("attic", world)).toBe(DARK);
    expect(world.actors.vale.place).toBe("pond");
  });
  it("is doused while Vale holds the dark lamp at the pond", () => {
    expect(placeCardArt(atPond(false), "attic")).toBe(DOUSED);
  });
  it("is dark when the lit lamp stays at the pond without Vale", () => {
    const world = attic({ lit: true, holder: "pond" });
    world.actors.vale.place = "station";
    expect(placeCardArt(world, "attic")).toBe(DARK);
  });
  it("matches the stage inside the attic", () => {
    for (const lit of [true, false]) {
      const world = attic({ lit, holder: "vale" });
      expect(placeCardArt(world, "attic")).toBe(backdrop("attic", world));
    }
  });
});
