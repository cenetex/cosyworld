import { describe, it, expect } from "vitest";
import {
  createWorld,
  exits,
  encodeSave,
  decodeSave,
  legalActions,
  nameOf,
  placeText,
  plan,
  play,
} from "../v2/card-game/world.mjs";
import { applyGeneratedText, narrativeContext } from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { sharedContext } from "../v2/card-game/shared-narrator.mjs";
import {
  callTransport,
  learnLane,
  lanesFrom,
  summonTransport,
  transportExits,
  transportScenery,
} from "../v2/card-game/pack-transport.mjs";
import { laneProblems, MAX_LANES } from "../v2/card-game/pack-schema.mjs";
import { transports } from "../v2/card-game/pack-registry.mjs";
import {
  availableCards,
  cardPlay,
  lockWords,
  playLabel,
  restPlays,
} from "../v2/card-game/cards.mjs";
import bridge from "../v2/worlds/greek-drama/card-bridge.json" with { type: "json" };
import { stowProvisions } from "./helpers/provisions.mjs";

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
  it("the two fleets have disjoint docks and at most four lanes per dock", () => {
    const names = ["greek-ship", "greek-scylla"];
    for (const name of names) {
      expect(laneProblems(bridge.transports[name])).toEqual([]);
      for (const dock of transports[name].docks)
        expect(lanesFrom(transports[name], dock).length).toBeLessThanOrEqual(
          MAX_LANES,
        );
    }
    expect(ship().docks).toEqual([
      "pond",
      "greek-harbor",
      "greek-piraeus",
      "hoppycat-signal-jetty",
    ]);
    expect(
      transports["greek-scylla"].docks.some((dock) =>
        ship().docks.includes(dock),
      ),
    ).toBe(false);
    // From Black Pond: the Wine-Dark Harbor, and the jetty with a Hoppy Cat thing.
    expect(lanesFrom(ship(), "pond").sort()).toEqual([
      "greek-harbor",
      "hoppycat-signal-jetty",
    ]);
    // Athens Harbor has joined Piraeus and is no longer a dock.
    expect(ship().docks).not.toContain("greek-athens-harbor");
  });

  it("the validator rejects a fifth lane and a stray dock, and notes a dock with no way out", () => {
    const docks = ["a", "b", "c", "d", "e", "f"];
    const star = docks.slice(1).map((to) => ({ from: "a", to }));
    expect(laneProblems({ docks, lanes: star })).toContain(
      "dock a has more than 4 lanes",
    );
    const notes = [];
    expect(laneProblems({ docks, lanes: star.slice(0, 4) }, notes)).toEqual([]);
    expect(notes).toEqual(["dock f has no lane out"]);
    expect(
      laneProblems({ docks: ["a", "b"], lanes: [{ from: "a", to: "z" }] }),
    ).toContain("has a lane that does not join two of its docks");
    expect(
      laneProblems(
        { docks: ["a", "b"], lanes: [{ from: "a", to: "b", oneWay: true }] },
        notes,
      ),
    ).toEqual([]);
    expect(notes).toContain("dock b has no lane out");
  });

  it("allows explicit empty recall only on a gated lane", () => {
    const lane = { from: "a", to: "b" };
    const opensWith = [{ kind: "item_at", item: "crate", place: "ship" }];
    const problems = (extra) =>
      laneProblems({ docks: ["a", "b"], lanes: [{ ...lane, ...extra }] });
    expect(problems({ opensWith, emptyRecall: true })).toEqual([]);
    expect(problems({ emptyRecall: true })).toHaveLength(1);
    expect(problems({ opensWith, emptyRecall: false })).toHaveLength(1);
  });
});

describe("a real voyage", () => {
  it("boards at the harbour, sets a course, spends one round at sea and arrives", () => {
    let s = setup("pond");
    s = act(s, "vale", "move", "greek-ship");
    expect(state(s)).toMatchObject({ phase: "docked", dock: "pond" });
    expect(targets(s, "vale", "move")).toEqual([]);
    expect(targets(s, "vale", "course")).toEqual(["greek-harbor"]);
    expect(availableCards(ask(s, "vale").world)).toContain("greek-harbor");
    expect(availableCards(ask(s, "vale").world)).not.toContain("pond");
    const play = cardPlay(ask(s, "vale").world, ["greek-harbor"]).action;
    expect(play.kind).toBe("course");
    expect(playLabel(play)).toBe("Set course");
    s = act(s, "mara", "move", "greek-ship");
    s = act(s, "vale", "course", "greek-harbor");
    expect(state(s)).toMatchObject({
      phase: "sea",
      destination: "greek-harbor",
    });
    expect(
      s.log.some((e) => /casts off for The Wine-Dark Harbor/.test(e.text)),
    ).toBe(true);
    for (const actor of ["vale", "mara"]) {
      expect(targets(s, actor, "move")).toEqual([]);
      expect(targets(s, actor, "course")).toEqual([]);
    }
    expect(ask(s, "ash").actions.some((a) => a.target === "greek-ship")).toBe(
      false,
    );
    s = act(s, "mara", "wait");
    expect(state(s)).toMatchObject({
      phase: "arrived",
      dock: "greek-harbor",
      riders: ["mara", "vale"],
    });
    expect(targets(s, "vale", "move")).toEqual(["greek-harbor"]);
    expect(
      playLabel(
        ask(s, "vale").actions.find(
          (a) => a.kind === "move" && a.target === "greek-harbor",
        ),
      ),
    ).toBe("Disembark");
    s = act(s, "vale", "move", "greek-harbor");
    expect(s.actors.vale.place).toBe("greek-harbor");
    expect(state(s)).toMatchObject({ phase: "arrived", dock: "greek-harbor" });
    expect(targets(s, "mara", "move")).toEqual(["greek-harbor"]);
    s = act(s, "mara", "move", "greek-harbor");
    expect(state(s)).toMatchObject({
      phase: "docked",
      dock: "greek-harbor",
      riders: [],
    });
  });

  it("a rider can stay aboard for the next course; a new boarder cannot step back", () => {
    let s = setup("pond", true);
    s = act(s, "vale", "move", "greek-ship");
    s = act(s, "vale", "course", "greek-harbor");
    s = act(s, "vale", "wait");
    s.actors.ash.place = "greek-harbor";
    stowProvisions(s, "greek-harbor");
    s = reload(s);
    expect(targets(s, "vale", "course")).toEqual(["pond"]);
    // Provisions on deck open Piraeus. Troy still requires Myrto's invitation.
    s = act(s, "ash", "take", undefined);
    expect(s.items["greek-provisions"].holder).toBe("ash");
    s = act(s, "ash", "move", "greek-ship");
    expect(targets(s, "ash", "move")).toEqual([]);
    expect(targets(s, "vale", "move")).toEqual(["greek-harbor"]);
    expect(targets(s, "ash", "course")).toEqual(["pond"]);
    expect(targets(s, "vale", "course")).toEqual(["pond"]);
    const drop = ask(s, "ash").actions.find(
      (a) => a.kind === "drop" && a.item === "greek-provisions",
    );
    expect(drop, "ash can drop the provisions").toBeDefined();
    const dropped = ask(s, "ash", "play", { action: drop });
    expect(dropped.ok, dropped.error).toBe(true);
    s = reload(dropped.world);
    expect(s.items["greek-provisions"].holder).toBe("greek-ship");
    expect(targets(s, "ash", "course")).toEqual(["greek-piraeus", "pond"]);
    expect(targets(s, "vale", "course")).toEqual(["greek-piraeus", "pond"]);
    s = act(s, "ash", "course", "greek-piraeus");
    expect(targets(s, "vale", "move")).toEqual([]);
    s = act(s, "vale", "wait");
    expect(state(s)).toMatchObject({ phase: "arrived", dock: "greek-piraeus" });
    expect(targets(s, "vale", "move")).toEqual(["greek-piraeus"]);
    expect(s.usedUp).not.toContain("greek-provisions");
    expect(s.items["greek-provisions"].holder).toBe("greek-ship");
    expect(targets(s, "ash", "move")).toEqual(["greek-piraeus"]);
  });

  it("a ship with riders, a shut cargo lane and no course stays where it is", () => {
    let s = setup("greek-harbor");
    s = act(s, "vale", "move", "greek-ship");
    expect(targets(s, "vale", "course")).toEqual(["pond"]);
    for (let i = 0; i < 6; i++) s = act(s, "vale", "wait");
    expect(state(s)).toMatchObject({ phase: "docked", dock: "greek-harbor" });
    expect(s.actors.vale.place).toBe("greek-ship");
  });

  it("an empty ship stays put, and a human waiting at a port brings it one lane closer", () => {
    let s = setup("greek-piraeus");
    for (const id of players) s.actors[id].place = "pond";
    stowProvisions(s, "greek-ship");
    s = reload(s);
    s = act(s, "mara", "wait");
    expect(state(s)).toMatchObject({ phase: "docked", dock: "greek-harbor" });
    s = act(s, "mara", "wait");
    expect(state(s).dock).toBe("pond");
    s = act(s, "mara", "wait");
    expect(state(s).dock).toBe("pond");
    s.actors.ash.place = "station";
    const before = structuredClone(state(s));
    s = act(reload(s), "ash", "wait");
    expect(state(s)).toEqual({ ...before, since: state(s).since });
  });

  it("lets a sleeper at a port sleep without calling the ship", () => {
    let s = setup("greek-piraeus");
    for (const id of players) s.actors[id].place = "pond";
    stowProvisions(s, "greek-ship");
    s = reload(s);
    // The Wait before Sleep calls the ship one lane; sleeping on calls none.
    s = act(s, "mara", "wait");
    expect(state(s)).toMatchObject({ phase: "docked", dock: "greek-harbor" });
    const sleep = (world) => {
      const action = ask(world, "mara").actions.find((a) => a.sleep);
      return reload(ask(world, "mara", "play", { action }).world);
    };
    // Each Sleep play, falling asleep or sleeping on, leaves the ship be.
    for (let i = 0; i < 4; i++) {
      s = sleep(s);
      expect(state(s).dock).toBe("greek-harbor");
    }
    expect(state(s).dock).toBe("greek-harbor");
  });

  it("route search plans across several lanes from aboard", () => {
    let s = setup("pond", true);
    s = act(s, "vale", "move", "greek-ship");
    expect(transportExits(s, "greek-ship", null, "vale")).toEqual([
      "greek-harbor",
    ]);
    // Vale knows the Black Pond lane. Piraeus requires provisions aboard.
    expect(transportExits(s, "greek-ship", "@voyage", "vale").sort()).toEqual([
      "greek-harbor",
    ]);
    // Aboard, they open Piraeus; the jetty's spool opens the jetty beyond.
    // The Far Shores belong to the Scylla, whose docks do not appear aboard the Charybdis.
    stowProvisions(s, "greek-ship");
    expect(transportExits(s, "greek-ship", "@voyage", "vale").sort()).toEqual([
      "greek-harbor",
      "greek-piraeus",
    ]);
    s.items["hoppycat-red-thread-spool"].holder = "greek-ship";
    expect(transportExits(s, "greek-ship", "@voyage", "vale").sort()).toEqual([
      "greek-harbor",
      "greek-piraeus",
      "hoppycat-signal-jetty",
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
    expect(["course", "wait"].includes(plan(world, "moth").action.kind)).toBe(
      true,
    );
  });
});

describe("calling the empty ship", () => {
  it("a resident waiting to board calls it one lane, but never away from a human at its dock", () => {
    const s = setup("pond");
    callTransport(s, "greek-harbor", true);
    expect(state(s).dock).toBe("pond");
    for (const id of players) s.actors[id].place = "station";
    s.turn = 1;
    callTransport(s, "greek-harbor", true);
    expect(state(s)).toMatchObject({ dock: "greek-harbor", since: 1 });
    s.actors.vale.place = "pond";
    callTransport(s, "pond");
    expect(state(s).dock).toBe("greek-harbor");
  });

  it("recalls either empty ship along its own lanes without moving the other", () => {
    let s = setup("pond");
    const scylla = (world) => world.transports["greek-scylla"];
    for (const id of players) s.actors[id].place = "greek-tauris";
    expect(s.items["greek-provisions"].holder).not.toBe("greek-ship");
    expect(s.items["greek-provisions"].holder).not.toBe("greek-scylla");
    for (const dock of ["greek-lemnos", "greek-thrace", "greek-tauris"]) {
      s = act(s, "vale", "wait");
      expect(scylla(s).dock).toBe(dock);
      expect(state(s).dock).toBe("pond");
    }
    expect(targets(s, "vale", "move")).not.toContain("greek-scylla");
    learnLane(s, "vale", "greek-tauris", "greek-thrace");
    expect(targets(s, "vale", "move")).toContain("greek-scylla");

    s.actors.vale.place = "greek-piraeus";
    for (const dock of ["greek-harbor", "greek-piraeus"]) {
      s = act(s, "vale", "wait");
      expect(state(s).dock).toBe(dock);
      expect(scylla(s).dock).toBe("greek-tauris");
    }
  });

  it("names the call, reports each approaching sea leg, and keeps Sleep separate", () => {
    const tauris = "greek-tauris", scylla = "greek-scylla";
    let s = setup("greek-harbor");
    s.actors.vale.place = tauris;
    const view = () => ask(s, "vale");
    const nextWait = () => view().actions.find((a) => a.kind === "wait" && !a.sleep);
    for (const [distance, dock] of [
      [3, "greek-lemnos"],
      [2, "greek-thrace"],
      [1, tauris],
    ]) {
      const words = `${distance} sea ${distance === 1 ? "leg" : "legs"} away`;
      expect(placeText(view().world, tauris)).toContain(words);
      expect(playLabel(nextWait())).toBe("Wait");
      if (distance < 3)
        expect(restPlays(view().world, [nextWait()], true, ["vale"]).map((a) => playLabel(a)))
          .toEqual(["Wait", "Sleep"]);
      expect(targets(s, "vale", "move")).not.toContain(scylla);
      s = act(s, "vale", "wait");
      expect(s.transports[scylla].dock).toBe(dock);
      expect(s.log.findLast((entry) => entry.kind === "narration" && entry.locationId === tauris)?.text)
        .toContain(distance === 1 ? "has reached the berth" : `${distance - 1} sea leg`);
    }
    expect(playLabel(nextWait())).toBe("Wait");
    expect(placeText(view().world, tauris)).toContain("The Scylla is at the berth");
    expect(targets(s, "vale", "move")).not.toContain(scylla);
    expect(transportScenery(s, "greek-egypt-tomb", nameOf)).toEqual([]);
    expect(transportScenery(s, "greek-ajax-landing", nameOf)).toEqual([]);
  });

  it("says when a shared ship is occupied or underway without naming its destination ashore", () => {
    const tauris = "greek-tauris", pagasae = "greek-pagasae";
    const lemnos = "greek-lemnos", scylla = "greek-scylla";
    let s = setup("greek-harbor");
    s.actors.vale.place = tauris;
    s.actors.mara.place = pagasae;
    learnLane(s, "mara", pagasae, lemnos);
    s = act(s, "mara", "move", scylla);
    expect(placeText(s, tauris)).toContain("has passengers aboard and cannot answer a call");
    const wait = () => ask(s, "vale").actions.find((a) => a.kind === "wait" && !a.sleep);
    expect(playLabel(wait())).toBe("Wait");
    s = act(s, "mara", "course", lemnos);
    expect(placeText(s, tauris)).toContain("is underway and cannot answer a call");
    expect(placeText(s, tauris)).not.toContain("Lemnian Cave");
    expect(playLabel(wait())).toBe("Wait");
    s = act(s, "vale", "wait");
    expect(placeText(s, lemnos)).toContain("has arrived at the berth");
    expect(playLabel(wait())).toBe("Wait");
    s = act(s, "mara", "move", lemnos);
    expect(placeText(s, tauris)).toContain("2 sea legs away");
    expect(playLabel(wait())).toBe("Wait");
  });

  it("keeps the provisions course and unmarked cargo recalls gated", () => {
    const harbor = setup("greek-harbor");
    let aboard = act(harbor, "vale", "move", "greek-ship");
    expect(targets(aboard, "vale", "course")).not.toContain("greek-piraeus");
    aboard = act(aboard, "vale", "wait");
    callTransport(aboard, "greek-piraeus");
    expect(state(aboard).dock).toBe("greek-harbor");
    stowProvisions(aboard, "greek-ship");
    expect(targets(aboard, "vale", "course")).toContain("greek-piraeus");

    for (const id of players) harbor.actors[id].place = "hoppycat-signal-jetty";
    const waiting = act(harbor, "vale", "wait");
    expect(state(waiting).dock).toBe("greek-harbor");
    expect(placeText(waiting, "hoppycat-signal-jetty")).toContain("cannot be called from this berth");
  });

  it("lets a boarder step ashore while their only course still needs cargo", () => {
    const piraeus = "greek-piraeus";
    const jetty = "hoppycat-signal-jetty";
    const deck = "greek-ship";
    let s = setup("greek-harbor");
    for (const actor of ["vale", "mara"]) {
      s.actors[actor].place = piraeus;
      learnLane(s, actor, piraeus, jetty);
    }
    s.items["hoppycat-red-thread-spool"].holder = "mara";
    s = act(s, "vale", "wait");
    expect(state(s)).toMatchObject({ phase: "docked", dock: piraeus });

    s = act(s, "vale", "move", deck);
    expect(targets(s, "vale", "course")).toEqual([]);
    const disembark = ask(s, "vale").actions.find(
      (action) => action.kind === "move" && action.target === piraeus,
    );
    expect(disembark).toBeDefined();
    expect(playLabel(disembark)).toBe("Disembark");
    s = act(s, "vale", "move", piraeus);
    expect(s.actors.vale.place).toBe(piraeus);
    expect(state(s)).toMatchObject({ phase: "docked", dock: piraeus });

    s = act(s, "vale", "move", deck);
    s = act(s, "mara", "move", deck);
    expect(targets(s, "vale", "course")).toEqual([jetty]);
    expect(targets(s, "vale", "move")).toEqual([]);
    s = act(s, "mara", "course", jetty);
    expect(state(s).phase).toBe("sea");
    expect(targets(s, "vale", "move")).toEqual([]);
    s = act(s, "vale", "wait");
    expect(state(s)).toMatchObject({ phase: "arrived", dock: jetty });
    expect(targets(s, "vale", "move")).toEqual([jetty]);
  });
});

describe("a ship at a dock nobody showed you", () => {
  const SHIP = "greek-ship",
    DOCK = "greek-piraeus",
    RHAPSODE = "greek-rhapsode";
  const boards = (s, actor) => exits(s, DOCK, actor).includes(SHIP);
  const routeReply = (context) => {
    const [offered] = context.disclosures;
    expect(offered).toMatchObject({
      factId: "lane:greek-harbor>greek-piraeus",
      speaker: RHAPSODE,
      listener: "vale",
      deferred: true,
    });
    const { factId, speaker, listener, eventSeq } = offered;
    return {
      text: "Load the travel provisions before sailing from the Wine-Dark Harbor to Piraeus.",
      disclosed: { factId, speaker, listener, eventSeq },
    };
  };

  it("is a locked box until the actor learns a lane from that dock", () => {
    let s = setup(DOCK);
    expect(targets(s, "vale", "move")).not.toContain(SHIP);
    const seen = ask(s, "vale").world;
    expect(availableCards(seen)).toContain(SHIP);
    expect(lockWords(seen, SHIP)).not.toBe(null);
    for (let i = 0; i < 4; i++) s = act(s, "vale", "wait");
    expect(targets(s, "vale", "move")).not.toContain(SHIP);
    learnLane(s, "vale", DOCK, "greek-harbor");
    s = reload(s);
    expect(lockWords(ask(s, "vale").world, SHIP)).toBe(null);
    expect(lockWords(ask(s, "mara").world, SHIP)).not.toBe(null);
    s = act(s, "vale", "move", SHIP);
    expect(s.actors.vale.place).toBe(SHIP);
  });

  it("opens for the listener once the Rhapsode reveals the lane in shared play", () => {
    let s = setup(DOCK);
    s.actors[RHAPSODE].place = DOCK;
    s = reload(s);
    const action = ask(s, "vale").actions.find(
      (a) => a.kind === "talk" && a.target === RHAPSODE,
    );
    const played = ask(s, "vale", "play", { action });
    expect(played.ok, played.error).toBe(true);
    expect(lockWords(ask(played.world, "vale").world, SHIP)).not.toBe(null);
    const context = sharedContext({
      world: played.world, actor: "vale", claimed: players, present: players, action,
    });
    s = ask(played.world, "vale", "speech", {
      room: context.location,
      lines: [{ actorId: RHAPSODE, ...routeReply(context) }],
    }).world;
    expect(lockWords(ask(s, "vale").world, SHIP)).toBe(null);
    expect(lockWords(ask(s, "mara").world, SHIP)).not.toBe(null);
    s = act(s, "vale", "move", SHIP);
    expect(targets(s, "vale", "course")).not.toEqual([]);
  });

  it("opens once the Rhapsode reveals the lane in local play", () => {
    const s = setup(DOCK);
    s.actors[RHAPSODE].place = DOCK;
    const seen = ask(reload(s), "vale");
    const talk = seen.actions.find(
      (a) => a.kind === "talk" && a.target === RHAPSODE,
    );
    expect(lockWords(seen.world, SHIP)).not.toBe(null);
    const played = play(seen.world, talk, s.revision, "vale");
    expect(played.ok, played.error).toBe(true);
    expect(lockWords(played.state, SHIP)).not.toBe(null);
    const context = narrativeContext(played.state, talk);
    const told = applyGeneratedText(played.state, context, {
      revision: context.revision,
      model: "fixture",
      entries: [{ id: RHAPSODE, ...routeReply(context) }],
    });
    expect(lockWords(told, SHIP)).toBe(null);
    expect(exits(told, DOCK, "vale")).toContain(SHIP);
  });

  it("names someone at the dock who knows a lane from it", () => {
    const s = setup(DOCK);
    s.actors["greek-rhapsode"].place = DOCK;
    expect(lockWords(ask(s, "vale").world, SHIP, () => true)).toMatch(
      /^Talk with /u,
    );
  });

  it("holds solo residents to the same lane rule and offers a separate invitation", () => {
    const s = setup(DOCK);
    expect(boards(s, "greek-rhapsode")).toBe(true);
    expect(boards(s, "moth")).toBe(false);
    s.actors.moth.place = DOCK;
    expect(boards(s, "moth")).toBe(false);
    learnLane(s, "vale", DOCK, "greek-harbor");
    expect(boards(s, "moth")).toBe(false);
    expect(
      legalActions(s, "vale").some(
        (a) =>
          a.kind === "accompany" &&
          a.target === "moth" &&
          a.destination === SHIP,
      ),
    ).toBe(true);
    learnLane(s, "moth", DOCK, "greek-harbor");
    expect(boards(s, "moth")).toBe(true);
  });

  it("leaves the first boarding at Black Pond open", () => {
    const s = setup("pond");
    for (const id of players)
      expect(targets(s, id, "move"), id).toContain(SHIP);
    expect(lockWords(ask(s, "vale").world, SHIP)).toBe(null);
  });
});

describe("transport state version 3", () => {
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
