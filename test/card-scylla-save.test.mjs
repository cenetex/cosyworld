import { describe, expect, it } from "vitest";
import {
  addLog,
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { rememberRoutes } from "../v2/card-game/roaming-routes.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";

const charybdis = "greek-ship";
const scylla = "greek-scylla";
const piraeus = "greek-piraeus";
const lemnos = "greek-lemnos";
const thrace = "greek-thrace";
const sicily = "greek-sicily";
const egypt = "greek-egypt-tomb";
const pagasae = "greek-pagasae";

function previousSave(
  dock,
  { phase, destination = null, riders = [], recall = null },
) {
  const world = createWorld();
  world.packs["greek-drama"].revision = 36;
  delete world.transports[scylla];
  world.crossings["pond-greek-harbor"].discovered = true;
  world.transports[charybdis] = {
    ...world.transports[charybdis],
    phase,
    dock,
    destination,
    riders,
    recall,
  };
  world.actors.vale.place = charybdis;
  world.actors.moth.place = thrace;
  world.items.oil.holder = "vale";
  world.items.bell.holder = charybdis;
  world.items.cloth.holder = "bell";
  stowProvisions(world, charybdis);
  rememberRoutes(world, "vale", [
    [charybdis, lemnos],
    [lemnos, charybdis],
    [`sea:${piraeus}`, `sea:${lemnos}`],
    [`sea:${lemnos}`, `sea:${piraeus}`],
    [`sea:${lemnos}`, `sea:${thrace}`],
    ["sea:greek-harbor", "sea:pond"],
  ]);
  return world;
}

const load = (world) => decodeSave(JSON.stringify(world));
function act(world, kind, target) {
  const card = legalActions(world).find(
    (action) =>
      action.kind === kind &&
      (target === undefined || action.target === target),
  );
  expect(card, `${kind} ${target ?? ""}`).toBeDefined();
  const result = play(world, card);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

describe("the Scylla takes the Charybdis's far ports", () => {
  it("keeps an arrived passenger, cargo and fellow passengers at the transferred berth", () => {
    const previous = previousSave(lemnos, {
      phase: "arrived",
      riders: ["vale"],
      recall: piraeus,
    });
    const world = load(previous);
    expect(world.actors.vale.place).toBe(scylla);
    expect(world.actors.moth.place).toBe(thrace);
    expect(world.transports[scylla]).toMatchObject({
      phase: "arrived",
      dock: lemnos,
      riders: ["vale"],
      recall: null,
    });
    expect(world.transports[charybdis]).toMatchObject({
      phase: "docked",
      dock: piraeus,
    });
    expect(world.items.oil.holder).toBe("vale");
    expect(world.items.bell.holder).toBe(scylla);
    expect(world.items.cloth.holder).toBe("bell");
    expect(world.items["greek-provisions"].holder).toBe(scylla);
    expect(legalActions(world)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "move", target: lemnos }),
      ]),
    );
    expect(world.routeKnowledge.vale).toEqual([
      ["sea:greek-harbor", "sea:pond"],
      [`sea:${lemnos}`, `sea:${thrace}`],
    ]);
    expect(world.log).toEqual(previous.log);
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });

  it("continues a voyage whose lane remains on the Scylla", () => {
    const previous = previousSave(lemnos, {
      phase: "sea",
      destination: thrace,
    });
    const world = load(previous);
    expect(world.actors.vale.place).toBe(scylla);
    expect(world.transports[scylla]).toMatchObject({
      phase: "sea",
      dock: lemnos,
      destination: thrace,
      riders: [],
    });
  });

  it("retains an old deck dispute in history and leaves its passengers together", () => {
    const fresh = createWorld();
    fresh.actors.vale.place = charybdis;
    fresh.actors.moth.place = charybdis;
    const threat = legalActions(fresh).find(
      (action) => action.kind === "threaten" && action.target === "moth",
    );
    expect(threat).toBeDefined();
    const result = play(fresh, threat);
    expect(result.ok).toBe(true);
    const previous = result.state;
    expect(previous.standoffs).toHaveLength(1);
    previous.packs["greek-drama"].revision = 36;
    delete previous.transports[scylla];
    previous.transports[charybdis].dock = lemnos;

    const world = load(previous);
    expect(world.actors.vale.place).toBe(scylla);
    expect(world.actors.moth.place).toBe(scylla);
    expect(world.standoffs).toEqual([]);
    expect(world.log).toEqual(previous.log);
  });

  it.each([
    [piraeus, lemnos, charybdis],
    [sicily, piraeus, scylla],
  ])(
    "lets travelers disembark at %s after a removed voyage to %s",
    (dock, destination, ship) => {
      const previous = previousSave(dock, { phase: "sea", destination });
      const world = load(previous);
      expect(world.actors.vale.place).toBe(ship);
      expect(world.transports[ship]).toMatchObject({
        phase: "arrived",
        dock,
        destination: null,
        riders: ["vale"],
      });
      expect(world.items.bell.holder).toBe(ship);
      expect(legalActions(world)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "move", target: dock }),
        ]),
      );
      expect(world.log).toEqual(previous.log);
    },
  );

  it("rejects a current save with a removed berth", () => {
    const world = createWorld();
    world.transports[charybdis].dock = lemnos;
    expect(() => load(world)).toThrow();
  });

  it("keeps a saved traveler in Egypt and lets them sail back to Pagasae", () => {
    const fresh = createWorld();
    const harbor = "greek-harbor";
    const pilot = "greek-pagasae-pilot";
    fresh.actors.vale.place = harbor;
    fresh.actors.vale.visited.push(harbor);
    fresh.crossings["pond-greek-harbor"].discovered = true;
    fresh.items["greek-helen-accounts"].holder = "vale";
    const previous = act(fresh, "give", "greek-shipmaster");
    expect(previous.packs["greek-drama"].choices["greek-helen-account"]).toBe(
      "egypt",
    );
    previous.actors.vale.place = egypt;
    previous.packs["greek-drama"].revision = 36;
    delete previous.transports[scylla];
    delete previous.actors[pilot];
    delete previous.memories[pilot];
    delete previous.peaceUntil[pilot];
    delete previous.routeKnowledge[pilot];
    for (const actor of Object.values(previous.actors))
      delete actor.trust[pilot];
    rememberRoutes(previous, "vale", [
      [harbor, egypt],
      [egypt, harbor],
    ]);

    let world = load(previous);
    expect(world.actors.vale.place).toBe(egypt);
    expect(world.actors[pilot].place).toBe(pagasae);
    expect(world.actors["greek-helen-egypt"].place).toBe(egypt);
    expect(world.routeKnowledge.vale).not.toContainEqual([egypt, harbor]);
    expect(world.routeKnowledge.vale).not.toContainEqual([harbor, egypt]);
    world = act(world, "wait");
    world = act(world, "move", scylla);
    world = act(world, "course", pagasae);
    world = act(world, "wait");
    world = act(world, "move", pagasae);
    expect(decodeSave(encodeSave(world)).actors.vale.place).toBe(pagasae);
  });
});

describe("Ajax's landing moves off the Northern Road", () => {
  const harbor = "greek-harbor";
  const north = "greek-road-north";
  const landing = "greek-ajax-landing";
  const surviving = [harbor, "greek-road-thebes"];

  it("returns an older traveler and their cargo to Harbor and keeps its road history", () => {
    const previous = createWorld();
    previous.packs["greek-drama"].revision = 37;
    previous.crossings["pond-greek-harbor"].discovered = true;
    previous.actors.vale.place = north;
    previous.actors.vale.visited.push(north);
    previous.actors.moth.place = north;
    previous.items.oil.holder = "vale";
    previous.items.bell.holder = north;
    previous.items.cloth.holder = "bell";
    const former = [
      [harbor, north],
      [north, harbor],
      [landing, north],
      [north, landing],
    ];
    rememberRoutes(previous, "vale", [...former, surviving]);
    rememberRoutes(previous, "greek-rhapsode", former);
    addLog(previous, "Vale", "Vale arrives on the Northern Road.", {
      kind: "action",
      verb: "move",
      actorId: "vale",
      targetId: north,
      fromLocationId: harbor,
      locationId: north,
      witnesses: ["moth"],
    });

    const world = load(previous);
    expect(world.actors.vale.place).toBe(harbor);
    expect(world.actors.moth.place).toBe(harbor);
    expect(world.actors.vale.visited).toContain(north);
    expect(world.items.oil.holder).toBe("vale");
    expect(world.items.bell.holder).toBe(harbor);
    expect(world.items.cloth.holder).toBe("bell");
    expect(world.routeKnowledge.vale).toEqual([surviving]);
    expect(world.routeKnowledge["greek-rhapsode"].flat()).not.toContain(north);
    expect(world.log).toEqual(previous.log);
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });

  it("rejects revision 38 route knowledge pointing into the retired road", () => {
    const world = createWorld();
    rememberRoutes(world, "vale", [[harbor, north]]);
    expect(() => load(world)).toThrow();
  });
});
