import { afterEach, describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import {
  crossings,
  hub,
  packDefinition,
  packPeople,
  packPlaces,
  transports,
  packJourneyDestination,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  passengers,
  summonTransport,
  waitForTransport,
  validTransports,
} from "../v2/card-game/pack-transport.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  aulisWitness,
  bookBoard,
  bookMove,
  bookPlay,
} from "./helpers/greek-book-three.mjs";

const pack = packDefinition("greek-drama");
const shipId = "greek-ship";
const companion = "greek-aulis-iphigenia";
const originalFive = [
  "pond",
  "greek-harbor",
  "greek-athens-harbor",
  "greek-piraeus",
  "greek-ajax-landing",
];
const fullPortPlan = [
  ...originalFive,
  "greek-aulis",
  "greek-lemnos-landing",
  "greek-thrace",
  "greek-book-iv-helen-landing",
  "greek-tauris-shore",
  "greek-sicily-shore",
];
const problems = (data) => packProblems(data, hub, Object.keys(packPlaces));

let portWitness;
function witnessWithEgyptianPort() {
  if (!portWitness) {
    let world = bookMove(bookBoard(aulisWitness()), "greek-harbor");
    world = bookPlay(world, "choose", {
      choiceId: "greek-book-iv-invitation-accept",
    });
    world = bookPlay(world, "choose", { choiceId: "greek-helen-egypt" });
    portWitness = bookMove(bookBoard(world), "greek-aulis");
  }
  return structuredClone(portWitness);
}

function expanded(count) {
  const result = structuredClone(pack);
  const ship = result.transports[shipId];
  const extra = Object.keys(result.places).filter(
    (id) => id !== ship.place && !ship.docks.includes(id),
  );
  ship.docks.push(...extra.slice(0, count - ship.docks.length));
  for (const dock of ship.docks)
    if (
      !result.crossings.some((c) => c.transport === shipId && c.from === dock)
    )
      result.crossings.push({
        id: `greek-test-ship-${dock}`,
        from: dock,
        to: "pond",
        travelers: "any",
        travel: "aboard the ship",
        travelLabel: "Board",
        requires: [],
        transport: shipId,
      });
  return result;
}

function withTwelvePorts(world, run) {
  const fixture = expanded(12);
  const saved = {
    docks: pack.transports[shipId].docks,
    liveDocks: transports[shipId].docks,
    packCrossings: pack.crossings.length,
    crossings: crossings.length,
    path: packPeople[companion].journey.path,
  };
  try {
    pack.transports[shipId].docks = fixture.transports[shipId].docks;
    transports[shipId].docks = fixture.transports[shipId].docks;
    for (const crossing of fixture.crossings.slice(saved.packCrossings)) {
      pack.crossings.push(crossing);
      crossings.push({ ...crossing, packId: pack.id });
      world.crossings[crossing.id] = structuredClone(
        world.crossings["greek-aulis-ship"],
      );
    }
    packPeople[companion].journey.path = [
      "greek-aulis-household",
      "greek-aulis",
      shipId,
      "greek-harbor",
      "greek-courtyard",
    ];
    world.packs[pack.id].scope = "full";
    expect(problems(pack)).toEqual([]);
    return run(world, fixture.transports[shipId].docks);
  } finally {
    pack.transports[shipId].docks = saved.docks;
    transports[shipId].docks = saved.liveDocks;
    pack.crossings.length = saved.packCrossings;
    crossings.length = saved.crossings;
    packPeople[companion].journey.path = saved.path;
  }
}

afterEach(() => new Promise((resolve) => setImmediate(resolve)));

describe("the bounded Greek ship contract", { timeout: 60000 }, () => {
  it("accepts twelve distinct docks with their crossings and keeps the original five", () => {
    const fixture = expanded(12);
    expect(fixture.transports[shipId].docks).toHaveLength(12);
    expect(fixture.transports[shipId].docks.slice(0, 5)).toEqual(originalFive);
    expect(problems(fixture)).toEqual([]);
  });

  it("accepts the eleven owned port IDs and one explicit capacity fixture", () => {
    const fixture = structuredClone(pack);
    const docks = [...fullPortPlan, "greek-test-twelfth-port"];
    fixture.transports[shipId].docks = docks;
    for (const dock of docks) {
      if (dock === "pond") continue;
      fixture.places[dock] ??= {
        name: "The Port Fixture",
        text: "A landing joins the shared ship in the full map fixture.",
        persona: "The owning book supplies this port’s complete scene.",
        exits: ["greek-harbor"],
        backdrop: "assets/greek-drama/harbor.svg",
      };
      if (
        !fixture.crossings.some(
          (c) => c.transport === shipId && c.from === dock,
        )
      )
        fixture.crossings.push({
          id: `greek-test-ship-${dock}`,
          from: dock,
          to: "pond",
          travelers: "any",
          travel: "aboard the ship",
          requires: [],
          transport: shipId,
        });
    }
    expect(docks).toHaveLength(12);
    expect(problems(fixture)).toEqual([]);
  });

  it("rejects a thirteenth dock", () => {
    expect(problems(expanded(13))).toContain(
      "greek-drama: transport greek-ship needs its own place, two to twelve docks and an initial dock",
    );
  });

  it.each(["duplicate", "unknown", "missing-crossing"])(
    "keeps the %s dock guard at the expanded bound",
    (kind) => {
      const fixture = expanded(12);
      if (kind === "duplicate")
        fixture.transports[shipId].docks[11] =
          fixture.transports[shipId].docks[10];
      if (kind === "unknown")
        fixture.transports[shipId].docks[11] = "greek-test-missing-port";
      if (kind === "missing-crossing") fixture.crossings.pop();
      expect(problems(fixture).length).toBeGreaterThan(0);
    },
  );

  it("makes the full empty-ship circuit and restores its single position", () => {
    const start = witnessWithEgyptianPort();
    withTwelvePorts(start, (world, docks) => {
      for (const actor of Object.values(world.actors))
        if (actor.place === shipId) actor.place = "greek-aulis";
      summonTransport(world, shipId, docks[0]);
      const visited = [world.transports[shipId].dock];
      for (let i = 1; i < docks.length; i++) {
        waitForTransport(world, docks.at(-1), "vale");
        visited.push(world.transports[shipId].dock);
      }
      expect(visited).toEqual(docks);
      const atPort = structuredClone(world.transports[shipId]);
      waitForTransport(world, docks.at(-1), "vale");
      expect(world.transports[shipId]).toEqual(atPort);
      waitForTransport(world, docks[0], "vale");
      expect(world.transports[shipId].dock).toBe(docks[0]);
      expect(validTransports(world)).toBe(true);
      expect(decodeSave(encodeSave(world)).transports).toEqual(
        world.transports,
      );
    });
  });

  it("keeps a consenting companion aboard through another human’s different stop", () => {
    const start = bookMove(witnessWithEgyptianPort(), "greek-aulis-household");
    withTwelvePorts(start, (initial) => {
      let world = dispatchShared({
        op: "create",
        save: encodeSave(initial),
      }).world;
      const players = ["vale", "mara", "ash", "nell"];
      world.actors.mara.place = "greek-aulis";
      world.actors.ash.place = "greek-aulis";
      world.actors.nell.place = "greek-harbor";
      const request = (op, actor, fields = {}) => {
        const result = dispatchShared({
          op,
          actor,
          world,
          claimed: players,
          present: players,
          ...fields,
        });
        expect(result.ok, result.error).toBe(true);
        world = result.world;
        return result;
      };
      const act = (actor, kind, fields = {}) => {
        const action = request("view", actor).actions.find(
          (candidate) =>
            candidate.kind === kind &&
            Object.entries(fields).every(
              ([key, value]) => candidate[key] === value,
            ),
        );
        expect(
          action,
          `${actor} ${kind} ${JSON.stringify(fields)}`,
        ).toBeTruthy();
        return request("play", actor, { action });
      };
      expect(
        request("view", "vale").actions.some(
          (a) => a.kind === "accompany" && a.target === companion,
        ),
      ).toBe(false);
      act("vale", "choose", { choiceId: "greek-aulis-choose-escape" });
      act("vale", "accompany", {
        target: companion,
        destination: "greek-aulis",
      });
      act("vale", "accompany", { target: companion, destination: shipId });
      expect(world.actors[companion].place).toBe(shipId);
      expect(packJourneyDestination(world, companion)).toBe("greek-harbor");
      expect(passengers(world, shipId).length).toBeGreaterThanOrEqual(2);
      const occupied = structuredClone(world.transports[shipId]);
      act("nell", "wait");
      expect(world.transports[shipId]).toEqual(occupied);
      const staleBoard = request("view", "ash").actions.find(
        (a) => a.kind === "move" && a.target === shipId,
      );
      expect(staleBoard).toBeTruthy();
      act("mara", "move", { target: shipId });
      act("mara", "move", { target: "greek-athens-harbor" });
      expect(world.transports[shipId].dock).toBe("greek-athens-harbor");
      expect(world.actors[companion].place).toBe(shipId);
      expect(
        request("view", "vale").actions.some(
          (a) =>
            a.kind === "accompany" &&
            a.target === companion &&
            a.destination === "greek-athens-harbor",
        ),
      ).toBe(false);
      expect(
        dispatchShared({
          op: "play",
          world,
          actor: "ash",
          action: staleBoard,
          claimed: players,
          present: players,
        }).ok,
      ).toBe(false);
      act("vale", "move", { target: "greek-athens-harbor" });
      act("nell", "wait");
      expect(world.actors[companion].place).toBe(shipId);
      expect(decodeSave(encodeSave(world)).actors[companion].place).toBe(
        shipId,
      );
      act("vale", "move", { target: shipId });
      act("vale", "accompany", {
        target: companion,
        destination: "greek-harbor",
      });
      expect(world.actors[companion].place).toBe("greek-harbor");
      expect(world.transports[shipId].dock).toBe("greek-harbor");
      act("vale", "accompany", {
        target: companion,
        destination: "greek-courtyard",
      });
      expect(world.actors[companion].place).toBe("greek-courtyard");
      expect(packJourneyDestination(world, companion)).toBeNull();
      expect(decodeSave(encodeSave(world)).actors[companion]).toEqual(
        world.actors[companion],
      );
    });
  });
});
