import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import { legalActions, play } from "../v2/card-game/world.mjs";
import { entityActive, packDefinition } from "../v2/card-game/pack-registry.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { sailTo } from "./helpers/voyage.mjs";

const PATROCLUS = "greek-patroclus";
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

// Buried, then back at the Wine-Dark Harbor with the Charybdis docked there.
// The rules put a resident ashore when the ship docks, so he stands on the
// quay unless a test puts him back aboard first.
const atHarbor = () => walk(funeralJourney().buried, "harbor");
// The rules draw a resident's want afresh when a stuck ship puts him ashore, so
// the bread is set in his hand here, as his pack data and `minTrust` give it.
const wantsBread = (world) => {
  world.actors[PATROCLUS].want = {
    kind: "item",
    target: "greek-bread",
    since: world.turn,
    refusals: 0,
  };
  world.usedUp = (world.usedUp || []).filter((id) => id !== "greek-bread");
  world.items["greek-bread"].holder = "vale";
  return world;
};
const dockShip = (world) => {
  const ship = world.transports["greek-ship"];
  Object.assign(ship, {
    phase: "docked",
    dock: "greek-harbor",
    destination: null,
    riders: [],
    since: world.turn,
  });
  return world;
};

describe("Patroclus aboard the Charybdis", () => {
  it("is a resident of the Greek pack with the Piraeus quays as home", () => {
    const person = pack.avatars[PATROCLUS];
    expect(person.place).toBe("greek-ship");
    expect(person.home).toBe("greek-piraeus");
    expect(person.want).toEqual({
      kind: "item",
      target: "greek-bread",
      minTrust: 1,
    });
    expect(person.requires).toEqual([
      { kind: "flag", key: "greek-burial-performed", value: true },
    ]);
    expect(person.portrait).toMatch(/^assets\/greek-drama\//);
    expect(pack.release.avatars).toContain(PATROCLUS);
  });

  it("is absent before Polynices is buried and aboard once he is", () => {
    const before = funeralJourney().supplied;
    expect(flags(before)["greek-burial-performed"]).toBeFalsy();
    expect(entityActive(before, PATROCLUS)).toBe(false);
    const after = funeralJourney().buried;
    expect(flags(after)["greek-burial-performed"]).toBe(true);
    expect(entityActive(after, PATROCLUS)).toBe(true);
    expect(after.actors[PATROCLUS].place).toBe("greek-ship");
  });

  it("does not hold the ship before the burial", () => {
    const before = funeralJourney().supplied;
    const aboardNow = Object.keys(before.actors).filter(
      (id) =>
        before.actors[id].place === "greek-ship" && entityActive(before, id),
    );
    expect(aboardNow).not.toContain(PATROCLUS);
  });

  it("starts to trust the traveler at the meeting aboard, not at a later gift", () => {
    // He is still aboard, with the ship docked, when the traveler arrives.
    const steps = greekTravelTargets("greek-polynices-hollow", "greek-harbor");
    let world = funeralJourney().buried;
    for (const target of steps.slice(0, -1))
      world = act(world, "move", { target });
    dockShip(world);
    world.actors[PATROCLUS].place = "greek-ship";
    world = act(world, "move", { target: steps.at(-1) });
    expect(world.actors[PATROCLUS].place).toBe("greek-ship");
    expect(trust(world)).toBe(0);
    world = act(world, "move", { target: "greek-ship" });
    expect(received(world, "greek-meet-patroclus")).toBeTruthy();
    expect(received(world, "greek-meet-patroclus-quay")).toBeUndefined();
    expect(trust(world)).toBe(1);
    expect(flags(world)["greek-patroclus-met"]).toBe(true);
  });

  it("starts to trust the traveler on the quay when the ship docked without them", () => {
    const world = atHarbor();
    expect(world.actors[PATROCLUS].place).toBe("greek-harbor");
    expect(received(world, "greek-meet-patroclus-quay")).toBeTruthy();
    expect(trust(world)).toBe(1);
  });

  it("tells that he wants bread at the first Talk, and trusts more for the gift", () => {
    let world = wantsBread(atHarbor());
    world = act(world, "talk", { target: PATROCLUS });
    expect(world.actors[PATROCLUS].want).toMatchObject({
      kind: "item",
      target: "greek-bread",
    });
    expect(trust(world)).toBe(1);
    world = act(world, "give", { item: "greek-bread", target: PATROCLUS });
    expect(trust(world)).toBe(2);
  });

  it("only travels with the traveler once the gift has made him trust them more", () => {
    // At trust 1 and with no bread carried, the trip does not serve him.
    let cold = dockShip(atHarbor());
    expect(trust(cold)).toBe(1);
    const asked = act(cold, "accompany", {
      target: PATROCLUS,
      destination: "greek-ship",
    });
    expect(asked.actors[PATROCLUS].place).not.toBe("greek-ship");
    // After the bread he goes aboard with them.
    let warm = wantsBread(dockShip(atHarbor()));
    warm = act(warm, "give", { item: "greek-bread", target: PATROCLUS });
    expect(trust(warm)).toBe(2);
    warm.items["greek-bread"].holder = PATROCLUS;
    warm = act(warm, "accompany", {
      target: PATROCLUS,
      destination: "greek-ship",
    });
    expect(warm.actors[PATROCLUS].place).toBe("greek-ship");
    expect(warm.actors.vale.place).toBe("greek-ship");
  });

  it("reaches his home at Piraeus with the traveler", () => {
    let world = wantsBread(dockShip(atHarbor()));
    world = act(world, "give", { item: "greek-bread", target: PATROCLUS });
    world.items["greek-bread"].holder = PATROCLUS;
    world = act(world, "accompany", {
      target: PATROCLUS,
      destination: "greek-ship",
    });
    world.usedUp = (world.usedUp || []).filter((id) => id !== "greek-provisions");
    world.items["greek-provisions"].holder = "greek-ship";
    world = sailTo(world, "greek-piraeus");
    expect(world.actors.vale.place).toBe("greek-piraeus");
  });
});
