import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import { legalActions, play } from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { boxesAt } from "../v2/card-game/world/boxes.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";

const PATROCLUS = "greek-patroclus";
const SHIP = "greek-ship";
const pack = packDefinition("greek-drama");

const act = (world, kind, fields = {}) => {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  if (!action)
    throw new Error(
      `Missing ${kind} ${JSON.stringify(fields)} at ${world.actors.vale.place}`,
    );
  const result = play(world, action, world.revision);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};
const walk = (world, place) =>
  greekTravelTargets(world.actors.vale.place, `greek-${place}`).reduce(
    (state, target) => act(state, "move", { target }),
    world,
  );
const trust = (world) => world.actors[PATROCLUS].trust?.vale || 0;
const flags = (world) => world.packs["greek-drama"].flags;
const received = (world, id) => world.packs["greek-drama"].receipts[id];
const shutBox = (world) =>
  boxesAt(world, SHIP, "vale").find((box) => box.id === PATROCLUS);

// Buried, at the Wine-Dark Harbor with the Charybdis docked there and Myrto's
// packed provisions on deck (made from bread, figs and wine elsewhere).
const provisioned = () => {
  let world = walk(funeralJourney().buried, "harbor");
  for (
    let turn = 0;
    turn < 8 &&
    (world.transports[SHIP].dock !== "greek-harbor" ||
      world.transports[SHIP].phase !== "docked");
    turn++
  )
    world = act(world, "wait");
  return stowProvisions(world, SHIP);
};

describe("Patroclus unlocks on the Charybdis at Piraeus", () => {
  it("is a sealed resident of the ship that opens on the ship, the dock and the load", () => {
    const person = pack.avatars[PATROCLUS];
    expect(person.place).toBe(SHIP);
    expect(person.home).toBe("greek-piraeus");
    expect(person.want).toEqual({
      kind: "item",
      target: "greek-bread",
      minTrust: 1,
    });
    expect(person.requires).toEqual([
      { kind: "flag", key: "greek-burial-performed", value: true },
    ]);
    expect(person.sealed).toEqual({ at: SHIP });
    expect(JSON.stringify(person.appearsWhen)).toContain("ship_at");
    expect(person.portrait).toMatch(/^assets\/greek-drama\//);
    expect(pack.release.avatars).toContain(PATROCLUS);
  });

  it("is not aboard before the burial, and shows a locked card", () => {
    const before = funeralJourney().supplied;
    expect(entityActive(before, PATROCLUS)).toBe(false);
    expect(shutBox(before)).toMatchObject({ kind: "resident", open: false });
    expect(shutBox(before).goals).toBeInstanceOf(Array);
  });

  it("does not appear before the ship docks at Piraeus, with or without the load", () => {
    const loaded = provisioned();
    expect(entityActive(loaded, PATROCLUS)).toBe(false);
    expect(shutBox(loaded)).toMatchObject({ open: false });
    // Without the provisions the ship cannot sail to Piraeus at all.
    const bare = walk(funeralJourney().buried, "harbor");
    for (let turn = 0; turn < 3; turn++) {
      expect(entityActive(act(bare, "wait"), PATROCLUS)).toBe(false);
    }
    expect(
      legalActions(bare).some((a) => a.kind === "course" && a.target),
    ).toBe(false);
    expect(trust(loaded)).toBe(0);
  });

  // At Piraeus the ship docks and his card opens aboard; he is a rider of that
  // arrival and steps ashore on the quay, his home, one round later. A meeting
  // is applied inside a play, before the round, and a Wait applies none, so
  // it fires on the quay when the traveler steps ashore (or on deck, if the
  // traveler's first play after docking is not a Wait).
  const docked = () => {
    let world = act(provisioned(), "move", { target: SHIP });
    expect(entityActive(world, PATROCLUS)).toBe(false);
    world = act(world, "course", { target: "greek-piraeus" });
    world = act(world, "wait");
    expect(world.transports[SHIP].dock).toBe("greek-piraeus");
    return world;
  };
  const ashore = () => act(docked(), "move", { target: "greek-piraeus" });
  // His landing is a resident's move in the round after the traveler's play,
  // which applies no meeting, so the meeting comes with the next play that is
  // not a Wait: a Talk.
  const metOnQuay = () => act(ashore(), "talk", { target: PATROCLUS });

  it("appears at the dock as a rider, and steps ashore at Piraeus", () => {
    let world = docked();
    expect(entityActive(world, PATROCLUS)).toBe(true);
    expect(world.transports[SHIP].riders).toContain(PATROCLUS);
    expect(shutBox(world)).toBeUndefined();
    expect(world.actors[PATROCLUS].place).toBe(SHIP);
    world = act(world, "wait");
    expect(world.actors[PATROCLUS].place).toBe("greek-piraeus");
    // A rider who was aboard is not counted twice.
    expect(
      world.transports[SHIP].riders.filter((id) => id === PATROCLUS).length,
    ).toBeLessThanOrEqual(1);
  });

  it("keeps his bread want until the traveler meets him", () => {
    const world = docked();
    expect(world.actors[PATROCLUS].want).toMatchObject({
      kind: "item",
      target: "greek-bread",
    });
  });

  it("trusts the traveler at 3 when they step ashore at once", () => {
    const stepped = ashore();
    expect(trust(stepped)).toBe(0);
    const world = act(stepped, "talk", { target: PATROCLUS });
    expect(world.actors.vale.place).toBe("greek-piraeus");
    expect(received(world, "greek-meet-patroclus")).toBeTruthy();
    expect(trust(world)).toBe(3);
    expect(flags(world)["greek-patroclus-met"]).toBe(true);
  });

  it("meets a traveler who comes back to the quay after a while", () => {
    let world = docked();
    // The traveler lingers aboard on a Wait, then steps ashore.
    world = act(world, "wait");
    world = act(world, "move", { target: "greek-piraeus" });
    world = act(world, "talk", { target: PATROCLUS });
    expect(trust(world)).toBe(3);
  });

  it("tells that he wants bread, and the gift at trust 3 pays 1 XP without error", () => {
    let world = metOnQuay();
    world = act(world, "talk", { target: PATROCLUS });
    expect(world.actors[PATROCLUS].want).toMatchObject({
      kind: "item",
      target: "greek-bread",
    });
    world.usedUp = (world.usedUp || []).filter((id) => id !== "greek-bread");
    world.items["greek-bread"].holder = "vale";
    const before = world.actors.vale.xp;
    world = act(world, "give", { item: "greek-bread", target: PATROCLUS });
    expect(trust(world)).toBe(3);
    // One for helping him, and one for the held quest he told (a give of
    // the bread, held when the Talk ended, rules 134), met by the same gift.
    expect(world.actors.vale.xp - before).toBe(2);
  });

  it("is offered Accompany at once, and one joint move works", () => {
    let world = metOnQuay();
    const ask = legalActions(world).find(
      (a) => a.kind === "accompany" && a.target === PATROCLUS,
    );
    expect(ask).toBeTruthy();
    world = act(world, "accompany", {
      target: PATROCLUS,
      destination: ask.destination,
    });
    expect(world.actors.vale.place).toBe(ask.destination);
    expect(world.actors[PATROCLUS].place).toBe(ask.destination);
  });

  it("stays once he has appeared when the provisions go and the ship sails away", () => {
    let world = metOnQuay();
    // The load goes home, as when it is eaten, and the ship sails on.
    world.usedUp = [...(world.usedUp || []), "greek-provisions"];
    world.items["greek-provisions"].holder = "greek-harbor";
    expect(entityActive(world, PATROCLUS)).toBe(true);
    for (let turn = 0; turn < 8; turn++) {
      world = act(world, "wait");
      expect(entityActive(world, PATROCLUS)).toBe(true);
    }
    expect(shutBox(world)).toBeUndefined();
  });
});
