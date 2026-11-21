import { describe, it, expect } from "vitest";
import {
  createWorld,
  encodeSave,
  decodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import {
  knowsLane,
  learnLane,
  summonTransport,
} from "../v2/card-game/pack-transport.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import {
  hub,
  packDefinition,
  packDefinitions,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";

const pack = packDefinition("hoppycat-archive");
const JETTY = "hoppycat-signal-jetty";
const THREAD = "hoppycat-pond-garden";
const CUP = "hoppycat-halfway-cup";
const SPOOL = "hoppycat-red-thread-spool";
const GARDEN = "hoppycat-halfway-tea-garden";
const players = ["vale", "mara"];
const reload = (s) => decodeSave(encodeSave(s));
// An earlier save is not valid under the current rules until it upgrades.
const upgrade = (s) => decodeSave(JSON.stringify(s));
function setup(dock) {
  const s = dispatchShared({
    op: "create",
    save: encodeSave(createWorld({ packScopes: { "greek-drama": "full" } })),
  }).world;
  for (const id of players) s.actors[id].place = dock;
  summonTransport(s, "greek-ship", dock);
  s.crossings["pond-greek-harbor"].discovered = true;
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
function act(world, actor, kind, target) {
  const action = ask(world, actor).actions.find(
    (a) => a.kind === kind && (target === undefined || a.target === target),
  );
  expect(action, `${actor} ${kind} ${target ?? ""}`).toBeDefined();
  const result = ask(world, actor, "play", { action });
  expect(result.ok, result.error).toBe(true);
  return reload(result.world);
}
const courses = (s, actor) =>
  ask(s, actor)
    .actions.filter((a) => a.kind === "course")
    .map((a) => a.target)
    .sort();
const moves = (s, actor) =>
  ask(s, actor)
    .actions.filter((a) => a.kind === "move")
    .map((a) => a.target);

describe("the Signal Jetty lane", () => {
  it("is a lane from Piraeus and from Black Pond, each with a free way back", () => {
    const ship = packDefinition("greek-drama").transports["greek-ship"];
    const lanes = (dock) =>
      ship.lanes.filter((l) => l.from === dock || l.to === dock);
    expect(ship.docks).toContain(JETTY);
    // Piraeus: the harbor and the jetty, each one way out and one back. The
    // way back toward Black Pond is free (rules 94).
    expect(lanes("greek-piraeus")).toHaveLength(4);
    expect(lanes(JETTY)).toEqual([
      expect.objectContaining({ from: "greek-piraeus", to: JETTY }),
      expect.objectContaining({ from: "pond", to: JETTY }),
      { from: JETTY, to: "pond", oneWay: true },
      { from: JETTY, to: "greek-piraeus", oneWay: true },
    ]);
  });

  it("opens only while a Hoppy Cat thing is aboard; knowing it is not enough", () => {
    let s = setup("greek-piraeus");
    // The lane to the Wine-Dark Harbor waits for the Travel Provisions,
    // which stay ashore.
    // Mara knows the jetty lane too; knowledge alone leaves it closed.
    learnLane(s, "mara", "greek-piraeus", JETTY);
    learnLane(s, "vale", "greek-piraeus", JETTY);
    s.items[SPOOL].holder = "vale";
    s = reload(s);
    s = act(s, "mara", "move", "greek-ship");
    const gate = {
      kind: "pack_item_present",
      pack: "hoppycat-archive",
      place: "greek-ship",
    };
    expect(knowsLane(s, "mara", "greek-piraeus", JETTY)).toBe(true);
    expect(conditionMet(s, gate)).toBe(false);
    expect(courses(s, "mara")).toEqual([]);

    // Carried aboard, it opens the lane for everyone on deck.
    s = act(s, "vale", "move", "greek-ship");
    expect(conditionMet(s, gate)).toBe(true);
    expect(courses(s, "vale")).toEqual([JETTY]);
    expect(courses(s, "mara")).toEqual([JETTY]);

    // Resting on deck counts too.
    s.items[SPOOL].holder = "greek-ship";
    s = reload(s);
    expect(courses(s, "vale")).toEqual([JETTY]);

    // Carried away ashore, the lane closes, even for Mara who knows it.
    s.items[SPOOL].holder = "greek-piraeus";
    s = reload(s);
    expect(conditionMet(s, gate)).toBe(false);
    expect(courses(s, "vale")).toEqual([]);
    expect(courses(s, "mara")).toEqual([]);

    s.items["greek-provisions"].holder = "greek-ship";
    s.usedUp = s.usedUp.filter((id) => id !== "greek-provisions");
    s = reload(s);
    expect(courses(s, "vale")).not.toContain(JETTY);

    s.items[CUP].holder = "greek-ship";
    s = reload(s);
    expect(courses(s, "vale")).toContain(JETTY);
    s.items[CUP].holder = "greek-piraeus";

    s.items[SPOOL].holder = "vale";
    s = reload(s);
    s = act(s, "vale", "course", JETTY);
    s = act(s, "mara", "wait");
    expect(knowsLane(s, "vale", "greek-piraeus", JETTY)).toBe(true);
    expect(moves(s, "vale")).toContain(JETTY);
    s = act(s, "vale", "move", JETTY);
    expect(s.actors.vale.place).toBe(JETTY);
  });

  it("Myrto tells the lane and its condition at Piraeus; telling opens nothing", () => {
    let s = setup("greek-piraeus");
    learnLane(s, "vale", "greek-piraeus", "greek-harbor");
    learnLane(s, "vale", "greek-piraeus", "greek-athens-harbor");
    s.actors["greek-shipmaster"].place = "greek-piraeus";
    s = reload(s);
    const talk = ask(s, "vale").actions.find(
      (a) => a.kind === "talk" && a.target === "greek-shipmaster",
    );
    expect(talk).toBeDefined();
    const result = play(ask(s, "vale").world, talk, s.revision, "vale");
    expect(result.ok, result.error).toBe(true);
    const disclosure = narrativeContext(result.state, talk).disclosures?.[0];
    expect(disclosure?.factId).toBe(`lane:greek-piraeus>${JETTY}`);
    expect(disclosure.text).toBe(
      "Ships for Signal Jetty leave from Piraeus Quays only with something from there aboard.",
    );
    const world = result.state;
    expect(knowsLane(world, "vale", "greek-piraeus", JETTY)).toBe(true);
    let s2 = reload(world);
    s2 = act(s2, "vale", "move", "greek-ship");
    expect(courses(s2, "vale")).not.toContain(JETTY);
  });
});

describe("the way in", () => {
  it("starts every Hoppy Cat thing inside the archive, the spool at the jetty", () => {
    const fresh = createWorld();
    const outside = Object.keys(pack.items).filter(
      (id) => !pack.places[fresh.items[id].holder],
    );
    expect(outside).toEqual([]);
    expect(fresh.items[SPOOL].holder).toBe(JETTY);
    const s = setup("pond");
    s.items[SPOOL].holder = "vale";
    for (const who of players) s.actors[who].place = "greek-piraeus";
    learnLane(s, "vale", "greek-piraeus", JETTY);
    summonTransport(s, "greek-ship", "greek-piraeus");
    const aboard = act(reload(s), "vale", "move", "greek-ship");
    expect(courses(aboard, "vale")).toContain(JETTY);
  });

  it("sails from Black Pond to the jetty with a Hoppy Cat thing aboard, and back freely", () => {
    let s = setup("pond");
    s = act(reload(s), "vale", "move", "greek-ship");
    expect(courses(s, "vale")).toEqual(["greek-harbor"]);
    s.items[SPOOL].holder = "greek-ship";
    s = reload(s);
    expect(courses(s, "vale")).toEqual(["greek-harbor", JETTY]);
    s = act(s, "vale", "course", JETTY);
    s = act(s, "mara", "wait");
    s = act(s, "vale", "move", JETTY);
    expect(s.actors.vale.place).toBe(JETTY);
    s = act(s, "vale", "move", "greek-ship");
    expect(courses(s, "vale")).toContain("pond");
  });

  it("keeps the spool at the jetty in a Hoppy Cat landing", () => {
    const landing = reload(createLandingWorld(pack));
    expect(landing.items[SPOOL].holder).toBe(JETTY);
  });
});

describe("gate data", () => {
  const mounted = packDefinitions.flatMap((p) => Object.keys(p.places));
  const problems = (edit) => {
    const greek = structuredClone(packDefinition("greek-drama"));
    const hoppy = structuredClone(pack);
    edit(greek, hoppy);
    return [
      ...packProblems(greek, hub, mounted),
      ...packProblems(hoppy, hub, mounted),
    ].join(" ");
  };
  it("accepts the authored gate and rejects malformed ones", () => {
    expect(problems(() => {})).toBe("");
    const lane = (g) =>
      g.transports["greek-ship"].lanes.find((l) => l.to === JETTY);
    expect(
      problems((g) => (lane(g).opensWith[0].pack = "Not A Pack")),
    ).toMatch(/condition/);
    expect(problems((g) => (lane(g).opensWith = []))).toMatch(/opensWith/);
    expect(problems((g, h) => (h.crossings[0].retired = false))).toMatch(
      /only known fields/,
    );
  });
});

describe("the red thread from Black pond", () => {
  it("is retired both ways: Black Pond and the Halfway Tea Garden never meet", () => {
    const s = setup("pond");
    expect(moves(s, "vale")).not.toContain(GARDEN);
    for (const id of [THREAD, "hoppycat-garden-pond"])
      expect(pack.crossings.find((c) => c.id === id).retired).toBe(true);
    s.actors.vale.place = GARDEN;
    expect(moves(reload(s), "vale")).not.toContain("pond");
  });

  it("lands a Hoppy Cat link at the jetty, with the Charybdis there to sail home", () => {
    let s = reload(createLandingWorld(pack));
    expect(pack.entry).toBe(JETTY);
    expect(s.actors.vale.place).toBe(JETTY);
    expect(s.crossings[THREAD].discovered).toBe(false);
    expect(s.crossings["hoppycat-garden-pond"].discovered).toBe(false);
    const step = (kind, target) => {
      const action = legalActions(s).find(
        (a) => a.kind === kind && (target === undefined || a.target === target),
      );
      expect(action, `${kind} ${target ?? ""}`).toBeDefined();
      const result = play(s, action);
      expect(result.ok, result.error).toBe(true);
      s = reload(result.state);
    };
    step("move", "greek-ship");
    step("course", "pond");
    step("wait");
    step("move", "pond");
    expect(s.actors.vale.place).toBe("pond");
    expect(
      legalActions(s).some((a) => a.kind === "move" && a.target === GARDEN),
    ).toBe(false);
  });
});
