import { MAX_DWELL } from "../v2/card-game/world/dwell.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { worldLife } from "../v2/card-game/resident-home.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";

// Owner direction, 2026-11-11: Antigone's home is the burial Hollow, not the
// gate; she cannot get there while the gate is locked. Nothing scripts her:
// she walks home by the ordinary resident rules when the way is open. The
// world's life is on here (the Greek journeys switch it off to hold the cast).
const HOLLOW = "greek-polynices-hollow";
const GATE = "greek-gate";
const ITEMS = ["greek-oil-flask", "greek-funeral-cloth", "greek-shovel"];
let held;
beforeAll(() => {
  held = worldLife.on;
  worldLife.on = true;
});
afterAll(() => {
  worldLife.on = held;
});

const act = (world, kind, fields = {}) => {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  if (!action) throw new Error(`Missing ${kind} ${JSON.stringify(fields)}`);
  const result = play(world, action, world.revision);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};
const antigone = (world) => world.actors["greek-antigone"];
const walk = (world, place) =>
  greekTravelTargets(world.actors.vale.place, `greek-${place}`).reduce(
    (state, target) => act(state, "move", { target }),
    world,
  );
const holdsNone = (world) =>
  ITEMS.every((item) => world.items[item].holder !== "greek-antigone");

describe("Antigone's home is the Hollow", () => {
  it("is authored with the Hollow as home, the gate as her start, and no scripted home", () => {
    const person = packDefinition("greek-drama").avatars["greek-antigone"];
    expect(person.home).toBe(HOLLOW);
    expect(person.place).toBe(GATE);
    expect(person.homeWhen).toBeUndefined();
  });

  it("stays at the gate while it is locked, with nobody helping", () => {
    let world = createWorld();
    world.crossings["pond-greek-harbor"].discovered = true;
    world.actors.vale.place = "greek-courtyard";
    world.actors.vale.visited.push("pond", "greek-harbor", "greek-courtyard");
    world.items.lamp.lit = false;
    for (let turn = 0; turn < 60; turn++) {
      world = act(world, "wait");
      expect(antigone(world).place).toBe(GATE);
    }
    expect(holdsNone(world)).toBe(true);
  });

  it("walks to the Hollow on her own once the way is open, carrying nothing", () => {
    // The player earns the gate's key: bread, decree, writ, given to the guard.
    let world = createWorld();
    world.crossings["pond-greek-harbor"].discovered = true;
    world.actors.vale.place = "greek-courtyard";
    world.actors.vale.visited.push("pond", "greek-harbor", "greek-courtyard");
    world.items.lamp.lit = false;
    world = walk(world, "well");
    world = act(world, "take", { item: "greek-water-jar" });
    world = walk(world, "courtyard");
    world = act(world, "give", {
      item: "greek-water-jar",
      target: "greek-baker",
    });
    world = act(world, "take", { item: "greek-bread" });
    world = walk(world, "gate");
    world = act(world, "trade", {
      item: "greek-bread",
      receive: "greek-decree",
    });
    world = walk(world, "palace");
    world = act(world, "trade", {
      item: "greek-decree",
      receive: "greek-creon-writ",
    });
    world = walk(
      world,
      world.actors["greek-guard"].place.replace("greek-", ""),
    );
    world = act(world, "give", {
      item: "greek-creon-writ",
      target: "greek-guard",
    });
    // The gate is open, but the way into the Hollow waits on the Shade's word,
    // so she still cannot get there: no script moves her.
    world = walk(world, "battlefield");
    for (let turn = 0; turn < 3; turn++) {
      world = act(world, "wait");
      expect(antigone(world).place).toBe(GATE);
    }
    for (
      let turn = 0;
      turn < 60 &&
      !legalActions(world).some(
        (a) => a.kind === "talk" && a.target === "greek-polynices-shade",
      );
      turn++
    )
      world = act(world, "wait");
    expect(antigone(world).place).toBe(GATE);
    world = act(world, "talk", { target: "greek-polynices-shade" });
    // Each step is a move of her own, so she dwells at the gate and again on
    // the battlefield (rules 133): wait for her, not for a count of turns.
    const talked = world.turn;
    for (let turn = 0; turn < 120 && antigone(world).place !== HOLLOW; turn++)
      world = act(world, "wait");
    expect(antigone(world).place).toBe(HOLLOW);
    expect(world.turn - talked).toBeLessThanOrEqual(2 * MAX_DWELL + 2);
    // She does not fetch or carry the burial items: residents do not yet take
    // or carry toward a want (the next rules batch).
    expect(holdsNone(world)).toBe(true);
    expect(ITEMS.map((item) => world.items[item].holder)).not.toContain(HOLLOW);
  });

  it("still completes the burial, with her at the Hollow for each rite", () => {
    const journey = funeralJourney();
    expect(antigone(journey.beforeAnoint).place).toBe(HOLLOW);
    expect(antigone(journey.buried).place).toBe(HOLLOW);
    expect(
      journey.buried.packs["greek-drama"].flags["greek-burial-performed"],
    ).toBe(true);
  });
});
