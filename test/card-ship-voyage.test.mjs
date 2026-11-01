import { describe, it, expect } from "vitest";
import {
  createWorld,
  encodeSave,
  decodeSave,
  legalActions,
  plan,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  IDLE_ROUNDS,
  callTransport,
  lanesFrom,
  summonTransport,
  transportExits,
} from "../v2/card-game/pack-transport.mjs";
import { laneProblems, MAX_LANES } from "../v2/card-game/pack-schema.mjs";
import { transports } from "../v2/card-game/pack-registry.mjs";
import { availableCards, cardPlay, playLabel } from "../v2/card-game/cards.mjs";
import bridge from "../v2/worlds/greek-drama/card-bridge.json" with { type: "json" };

const players = ["vale", "mara", "ash"];
const ship = () => transports["greek-ship"];
function setup(dock, full = false) {
  const s = dispatchShared({
    op: "create",
    save: encodeSave(createWorld()),
  }).world;
  for (const id of players) s.actors[id].place = dock;
  s.actors.moth.place = "station";
  s.actors.keeper.place = "attic";
  // BoardyAI's introductions are tested on their own; here he stays home.
  s.actors.boardyai.want = null;
  summonTransport(s, "greek-ship", dock);
  s.crossings["pond-greek-harbor"].discovered = true;
  // A full Greek world has The Open Door: Athens Harbor and Piraeus.
  if (full) s.packs["greek-drama"].scope = "full";
  return s;
}
const ask = (world, actor, op = "view", extra = {}) =>
  dispatchShared({
    world,
    actor,
    op,
    claimed: players,
    present: players,
    ...extra,
  });
const reload = (s) => decodeSave(encodeSave(s));
const upgrade = (s) => decodeSave(JSON.stringify(s));
function act(world, actor, kind, target) {
  const action = ask(world, actor).actions.find(
    (a) => a.kind === kind && (target === undefined || a.target === target),
  );
  expect(action, `${actor} can ${kind} ${target ?? ""}`).toBeDefined();
  const result = ask(world, actor, "play", { action });
  expect(result.ok, result.error).toBe(true);
  return reload(result.world);
}
const state = (s) => s.transports["greek-ship"];
// The Willows mist at the rail is a side crossing, not a port.
const targets = (s, actor, kind) =>
  ask(s, actor)
    .actions.filter((a) => a.kind === kind && a.target !== "willows-landing")
    .map((a) => a.target)
    .sort();

describe("sea lanes", () => {
  it("the authored graph keeps at most four lanes per dock", () => {
    expect(laneProblems(bridge.transports["greek-ship"])).toEqual([]);
    for (const dock of ship().docks)
      expect(lanesFrom(ship(), dock).length).toBeLessThanOrEqual(MAX_LANES);
    // From Black Pond the ship sails only to the Wine-Dark Harbor.
    expect(lanesFrom(ship(), "pond")).toEqual(["greek-harbor"]);
    // Athens Harbor has joined Piraeus and is no longer a dock.
    expect(ship().docks).not.toContain("greek-athens-harbor");
  });

  it("the validator rejects a fifth lane, a stray dock and a dock with no way out", () => {
    const docks = ["a", "b", "c", "d", "e", "f"];
    const star = docks.slice(1).map((to) => ({ from: "a", to }));
    expect(laneProblems({ docks, lanes: star })).toContain(
      "dock a has more than 4 lanes",
    );
    expect(laneProblems({ docks, lanes: star.slice(0, 4) })).toContain(
      "dock f has no lane out",
    );
    expect(
      laneProblems({ docks: ["a", "b"], lanes: [{ from: "a", to: "z" }] }),
    ).toContain("has a lane that does not join two of its docks");
    expect(
      laneProblems({
        docks: ["a", "b"],
        lanes: [{ from: "a", to: "b", oneWay: true }],
      }),
    ).toContain("dock b has no lane out");
  });
});

describe("a real voyage", () => {
  it("boards at the harbour, sets a course, spends one round at sea and arrives", () => {
    let s = setup("pond");
    s = act(s, "vale", "move", "greek-ship");
    expect(state(s)).toMatchObject({ phase: "docked", dock: "pond" });
    // No straight return: the boarding port is never a card aboard.
    expect(targets(s, "vale", "move")).toEqual([]);
    expect(targets(s, "vale", "course")).toEqual(["greek-harbor"]);
    expect(availableCards(ask(s, "vale").world)).toContain("greek-harbor");
    expect(availableCards(ask(s, "vale").world)).not.toContain("pond");
    const play = cardPlay(ask(s, "vale").world, ["greek-harbor"]).action;
    expect(play.kind).toBe("course");
    expect(playLabel(play)).toBe("Set course");
    // A companion can still board while the ship is at its harbour.
    s = act(s, "mara", "move", "greek-ship");
    s = act(s, "vale", "course", "greek-harbor");
    expect(state(s)).toMatchObject({ phase: "sea", destination: "greek-harbor" });
    expect(s.log.some((e) => /casts off for The Wine-Dark Harbor/.test(e.text))).toBe(true);
    // At sea nobody disembarks, nobody boards and no course cards remain.
    for (const actor of ["vale", "mara"]) {
      expect(targets(s, actor, "move")).toEqual([]);
      expect(targets(s, actor, "course")).toEqual([]);
    }
    expect(
      ask(s, "ash").actions.some((a) => a.target === "greek-ship"),
    ).toBe(false);
    s = act(s, "mara", "wait");
    expect(state(s)).toMatchObject({
      phase: "arrived",
      dock: "greek-harbor",
      riders: ["mara", "vale"],
    });
    // On arrival the only Disembark card is that port.
    expect(targets(s, "vale", "move")).toEqual(["greek-harbor"]);
    expect(playLabel(ask(s, "vale").actions.find((a) => a.kind === "move" && a.target === "greek-harbor"))).toBe(
      "Disembark",
    );
    s = act(s, "vale", "move", "greek-harbor");
    expect(s.actors.vale.place).toBe("greek-harbor");
    // The first ashore keeps the ship there; Mara can only get off there.
    expect(state(s)).toMatchObject({ phase: "arrived", dock: "greek-harbor" });
    expect(targets(s, "mara", "move")).toEqual(["greek-harbor"]);
    s = act(s, "mara", "move", "greek-harbor");
    expect(state(s)).toMatchObject({ phase: "docked", dock: "greek-harbor", riders: [] });
  });

  it("a rider can stay aboard for the next course; a new boarder cannot step back", () => {
    let s = setup("pond", true);
    s = act(s, "vale", "move", "greek-ship");
    s = act(s, "vale", "course", "greek-harbor");
    s = act(s, "vale", "wait");
    s.actors.ash.place = "greek-harbor";
    s = reload(s);
    expect(targets(s, "vale", "course")).toEqual(["pond"]);
    // Ash carries the Travel Provisions aboard, which opens the Piraeus lane
    // for everyone on deck. The Trojan camp landing stays closed until
    // Myrto's invitation.
    s = act(s, "ash", "take", undefined);
    expect(s.items["greek-provisions"].holder).toBe("ash");
    s = act(s, "ash", "move", "greek-ship");
    expect(targets(s, "ash", "move")).toEqual([]);
    expect(targets(s, "vale", "move")).toEqual(["greek-harbor"]);
    expect(targets(s, "ash", "course")).toEqual(["greek-piraeus", "pond"]);
    expect(targets(s, "vale", "course")).toEqual(["greek-piraeus", "pond"]);
    s = act(s, "ash", "course", "greek-piraeus");
    expect(targets(s, "vale", "move")).toEqual([]);
    s = act(s, "vale", "wait");
    expect(state(s)).toMatchObject({ phase: "arrived", dock: "greek-piraeus" });
    expect(targets(s, "vale", "move")).toEqual(["greek-piraeus"]);
    // Ash can step off with the provisions or leave them on deck.
    expect(targets(s, "ash", "move")).toEqual(["greek-piraeus", "greek-piraeus"]);
  });

  it("an idle passenger cannot hold the ship: it sails its first lane after three rounds", () => {
    let s = setup("greek-harbor");
    s = act(s, "vale", "move", "greek-ship");
    for (let i = 1; i < IDLE_ROUNDS; i++) {
      s = act(s, "vale", "wait");
      expect(state(s).phase).toBe("docked");
    }
    s = act(s, "vale", "wait");
    expect(state(s)).toMatchObject({ phase: "sea", destination: "pond" });
    expect(s.log.some((e) => /sails on its own for Black pond/i.test(e.text))).toBe(true);
    s = act(s, "vale", "wait");
    expect(state(s)).toMatchObject({ phase: "arrived", dock: "pond" });
  });

  it("an empty ship stays put, and a human waiting at a port brings it one lane closer", () => {
    let s = setup("greek-piraeus");
    for (const id of players) s.actors[id].place = "pond";
    // The Travel Provisions on deck keep the Piraeus lane open.
    s.items["greek-provisions"].holder = "greek-ship";
    s = reload(s);
    // Piraeus to Black Pond is two lanes, through the Wine-Dark Harbor.
    s = act(s, "mara", "wait");
    expect(state(s)).toMatchObject({ phase: "docked", dock: "greek-harbor" });
    s = act(s, "mara", "wait");
    expect(state(s).dock).toBe("pond");
    s = act(s, "mara", "wait");
    expect(state(s).dock).toBe("pond");
    // Waiting where there is no port leaves the empty ship alone.
    s.actors.ash.place = "station";
    const before = structuredClone(state(s));
    s = act(reload(s), "ash", "wait");
    expect(state(s)).toEqual({ ...before, since: state(s).since });
  });

  it("route search plans across several lanes from aboard", () => {
    let s = setup("pond", true);
    s = act(s, "vale", "move", "greek-ship");
    expect(transportExits(s, "greek-ship", null, "vale")).toEqual([
      "greek-harbor",
    ]);
    // Vale knows the Black Pond lane. Piraeus waits for the Travel
    // Provisions aboard.
    expect(transportExits(s, "greek-ship", "@voyage", "vale").sort()).toEqual([
      "greek-harbor",
    ]);
    // Aboard, they open Piraeus, Marathon Bay round the cape, and the east
    // sea's open shores beyond it.
    s.items["greek-provisions"].holder = "greek-ship";
    expect(transportExits(s, "greek-ship", "@voyage", "vale").sort()).toEqual([
      "greek-harbor",
      "greek-lemnos",
      "greek-marathon",
      "greek-piraeus",
      "greek-sicily",
    ]);
  });
});

describe("residents at sea", () => {
  it("a resident sails alone by the same rules and leaves the course to a human aboard", () => {
    let s = setup("greek-harbor");
    s.actors.moth.place = "greek-ship";
    s.actors.vale.place = "greek-ship";
    s = reload(s);
    const courses = (world, actor) =>
      legalActions(ask(world, "vale").world, actor)
        .filter((a) => a.kind === "course")
        .map((a) => a.target);
    expect(courses(s, "moth")).toEqual([]);
    expect(courses(s, "vale")).toEqual(["pond"]);
    s.actors.vale.place = "greek-harbor";
    s = reload(s);
    expect(courses(s, "moth")).toEqual(["pond"]);
    // Pip, alone aboard and bound for the pond, sets the course himself.
    let world = ask(s, "vale").world;
    world.actors.moth.place = "greek-ship";
    expect(
      ["course", "wait"].includes(plan(world, "moth").action.kind),
    ).toBe(true);
  });
});

describe("calling the empty ship", () => {
  it("a resident waiting to board calls it one lane, but never away from a human at its dock", () => {
    const s = setup("pond");
    callTransport(s, "greek-harbor", true);
    // Vale, Mara and Ash stand at the pond beside the ship.
    expect(state(s).dock).toBe("pond");
    for (const id of players) s.actors[id].place = "station";
    s.turn = 1;
    callTransport(s, "greek-harbor", true);
    expect(state(s)).toMatchObject({ dock: "greek-harbor", since: 1 });
    // One lane a round, however many people wait.
    s.actors.vale.place = "pond";
    callTransport(s, "pond");
    expect(state(s).dock).toBe("greek-harbor");
  });
});

describe("transport state version 3", () => {
  it("upgrades an empty version 2 ship", () => {
    const s = setup("pond");
    s.transports["greek-ship"] = {
      version: 2,
      dock: "greek-harbor",
      destination: null,
      recall: null,
    };
    expect(upgrade(s).transports["greek-ship"]).toEqual({
      version: 3,
      phase: "docked",
      dock: "greek-harbor",
      destination: null,
      riders: [],
      since: s.turn,
      recall: null,
    });
  });

  it("upgrades an occupied version 2 leg to a docked ship waiting for its course", () => {
    const s = setup("pond");
    s.actors.vale.place = "greek-ship";
    s.transports["greek-ship"] = {
      version: 2,
      dock: "pond",
      destination: "greek-harbor",
      recall: "pond",
    };
    const up = upgrade(s);
    expect(up.transports["greek-ship"]).toMatchObject({
      phase: "docked",
      dock: "pond",
      recall: "pond",
      riders: [],
    });
    expect(targets(up, "vale", "course")).toEqual(["greek-harbor"]);
  });

  it("upgrades a version 2 ship whose first passenger had landed to an arrival", () => {
    const s = setup("pond");
    s.actors.mara.place = "greek-ship";
    s.transports["greek-ship"] = {
      version: 2,
      dock: "greek-harbor",
      destination: "greek-harbor",
      recall: null,
    };
    const up = upgrade(s);
    expect(up.transports["greek-ship"]).toMatchObject({
      phase: "arrived",
      dock: "greek-harbor",
      riders: ["mara"],
    });
    expect(targets(up, "mara", "move")).toEqual(["greek-harbor"]);
  });

  it("rejects invalid version 3 records", () => {
    const bad = [
      (t) => (t.phase = "flying"),
      (t) => (t.dock = "station"),
      (t) => Object.assign(t, { phase: "sea", destination: "greek-piraeus" }),
      (t) => (t.riders = ["vale", "vale"]),
      (t) => (t.since = 10_000),
      (t) => (t.recall = "pond"),
      (t) => (t.version = 4),
      (t) => (t.extra = 1),
    ];
    for (const edit of bad) {
      const s = setup("pond");
      edit(s.transports["greek-ship"]);
      expect(() => upgrade(s), edit.toString()).toThrow();
    }
  });
});
