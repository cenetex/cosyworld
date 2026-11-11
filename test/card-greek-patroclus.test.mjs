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
const REASON =
  "Not aboard until Polynices is buried and the Charybdis lies at Piraeus with provisions aboard.";
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
    turn < 4 && world.transports[SHIP].dock !== "greek-harbor";
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
    expect(person.sealed).toEqual({ at: SHIP, reason: REASON });
    expect(JSON.stringify(person.appearsWhen)).toContain("ship_at");
    expect(person.portrait).toMatch(/^assets\/greek-drama\//);
    expect(pack.release.avatars).toContain(PATROCLUS);
  });

  it("is not aboard before the burial, and shows a locked card with its reason", () => {
    const before = funeralJourney().supplied;
    expect(entityActive(before, PATROCLUS)).toBe(false);
    expect(shutBox(before)).toMatchObject({ kind: "resident", open: false });
    expect(shutBox(before).reason).toBe(REASON);
  });

  it("does not appear before the ship docks at Piraeus, with or without the load", () => {
    const loaded = provisioned();
    expect(entityActive(loaded, PATROCLUS)).toBe(false);
    expect(shutBox(loaded).reason).toBe(REASON);
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

  // Aboard at Piraeus: he appears when the ship docks, and the meeting fires two
  // plays later (a resident is met one play after he is there).
  const atPiraeus = () => {
    let world = act(provisioned(), "move", { target: SHIP });
    expect(entityActive(world, PATROCLUS)).toBe(false);
    world = act(world, "course", { target: "greek-piraeus" });
    world = act(world, "wait");
    expect(world.transports[SHIP].dock).toBe("greek-piraeus");
    return world;
  };

  it("appears at the dock with the traveler aboard, and trusts them at 3 once met", () => {
    let world = atPiraeus();
    expect(entityActive(world, PATROCLUS)).toBe(true);
    expect(world.actors[PATROCLUS].place).toBe(SHIP);
    expect(shutBox(world)).toBeUndefined();
    expect(trust(world)).toBe(0);
    while (!flags(world)["greek-patroclus-met"]) world = act(world, "wait");
    expect(received(world, "greek-meet-patroclus")).toBeTruthy();
    expect(trust(world)).toBe(3);
  });

  it("stays once he has appeared when the provisions go and the ship sails away", () => {
    let world = atPiraeus();
    while (!flags(world)["greek-patroclus-met"]) world = act(world, "wait");
    // The load goes home, as when it is eaten, and the ship sails on.
    world.usedUp = [...(world.usedUp || []), "greek-provisions"];
    world.items["greek-provisions"].holder = "greek-harbor";
    expect(entityActive(world, PATROCLUS)).toBe(true);
    for (let turn = 0; turn < 8; turn++) {
      world = act(world, "wait");
      expect(entityActive(world, PATROCLUS)).toBe(true);
    }
    expect(world.transports[SHIP].dock).not.toBe("greek-piraeus");
    expect(shutBox(world)).toBeUndefined();
  });
});
