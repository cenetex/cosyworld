import { describe, it, expect } from "vitest";
import {
  createWorld,
  encodeSave,
  decodeSave,
  play,
  publishKnowledgeSpeech,
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
  entityActive,
  hub,
  packDefinition,
  packDefinitions,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";

const pack = packDefinition("hoppycat-archive");
const JETTY = "hoppycat-signal-jetty";
const THREAD = "hoppycat-pond-garden";
const CUP = "hoppycat-halfway-cup";
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
  it("is Piraeus's third lane and the jetty's only one", () => {
    const ship = packDefinition("greek-drama").transports["greek-ship"];
    const lanes = (dock) =>
      ship.lanes.filter((l) => l.from === dock || l.to === dock);
    expect(ship.docks).toContain(JETTY);
    expect(lanes("greek-piraeus")).toHaveLength(3);
    expect(lanes(JETTY)).toEqual([
      expect.objectContaining({ from: "greek-piraeus", to: JETTY }),
    ]);
  });

  it("opens only while a Hoppy Cat thing is aboard; knowing it is not enough", () => {
    let s = setup("greek-piraeus");
    // The lane to the Wine-Dark Harbor waits for the Travel Provisions,
    // which stay ashore.
    // Mara knows the jetty lane too; knowledge alone leaves it closed.
    learnLane(s, "mara", "greek-piraeus", JETTY);
    // Vale waits ashore with a Hoppy Cat thing in hand.
    s.items[CUP].holder = "vale";
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
    s.items[CUP].holder = "greek-ship";
    s = reload(s);
    expect(courses(s, "vale")).toEqual([JETTY]);

    // Carried away ashore, the lane closes, even for Mara who knows it.
    s.items[CUP].holder = "greek-piraeus";
    s = reload(s);
    expect(conditionMet(s, gate)).toBe(false);
    expect(courses(s, "vale")).toEqual([]);
    expect(courses(s, "mara")).toEqual([]);

    // With the cup aboard again, the voyage sails and Vale lands at the jetty.
    s.items[CUP].holder = "vale";
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
    world.log.push({
      ...world.log.at(-1),
      seq: world.eventSeq + 1,
      kind: "dialogue",
      generated: true,
      actorId: "greek-shipmaster",
      locationId: "greek-piraeus",
      cast: ["vale", "greek-shipmaster"],
      text: `Listen. ${disclosure.text}`,
    });
    world.eventSeq += 1;
    expect(
      publishKnowledgeSpeech(world, world.log.at(-1), [disclosure]),
    ).toHaveLength(1);
    expect(knowsLane(world, "vale", "greek-piraeus", JETTY)).toBe(true);
    let s2 = reload(world);
    s2 = act(s2, "vale", "move", "greek-ship");
    expect(courses(s2, "vale")).not.toContain(JETTY);
  });
});

describe("the way in", () => {
  // Every other Hoppy Cat thing starts inside the archive, behind the jetty
  // lane it would open. The spool lies at the empty station, and shows there
  // only while the station holds no oil.
  const SPOOL = "hoppycat-red-thread-spool";
  const takeSpool = (s) =>
    ask(s, "vale").actions.find((a) => a.kind === "take" && a.item === SPOOL);
  const atStation = (oilHolder, keeperAt = "pond") => {
    const s = setup("pond");
    for (const who of players) s.actors[who].place = "station";
    s.actors.keeper.place = keeperAt;
    s.items.oil.holder = oilHolder;
    return reload(s);
  };
  it("starts the spool at the station, where a player takes it aboard", () => {
    const fresh = createWorld();
    const outside = Object.keys(pack.items).filter(
      (id) => !pack.places[fresh.items[id].holder],
    );
    expect(outside).toEqual([SPOOL]);
    expect(fresh.items[SPOOL].holder).toBe("station");
    let s = atStation("pond");
    const take = takeSpool(s);
    expect(take).toBeDefined();
    s = reload(ask(s, "vale", "play", { action: take }).world);
    expect(s.items[SPOOL].holder).toBe("vale");
    // Carried to Piraeus, it opens the jetty lane from the deck.
    for (const who of players) s.actors[who].place = "greek-piraeus";
    summonTransport(s, "greek-ship", "greek-piraeus");
    s = act(reload(s), "vale", "move", "greek-ship");
    expect(courses(s, "vale")).toContain(JETTY);
  });

  it("hides the spool at the station while oil is there", () => {
    expect(takeSpool(atStation("station"))).toBeUndefined();
    // Carried oil counts: the keeper brings it home.
    expect(takeSpool(atStation("keeper", "station"))).toBeUndefined();
    expect(takeSpool(atStation("keeper"))).toBeDefined();
    expect(takeSpool(atStation("pond"))).toBeDefined();
  });

  it("keeps a held spool, and hides it again once set down by the oil", () => {
    let s = atStation("pond");
    s = reload(ask(s, "vale", "play", { action: takeSpool(s) }).world);
    s.items.oil.holder = "station";
    s = reload(s);
    expect(s.items[SPOOL].holder).toBe("vale");
    expect(entityActive(s, SPOOL)).toBe(true);
    const drop = ask(s, "vale").actions.find(
      (a) => a.kind === "drop" && a.item === SPOOL,
    );
    expect(drop).toBeDefined();
    s = reload(ask(s, "vale", "play", { action: drop }).world);
    expect(s.items[SPOOL].holder).toBe("station");
    expect(entityActive(s, SPOOL)).toBe(false);
    expect(takeSpool(s)).toBeUndefined();
    s.items.oil.holder = "pond";
    expect(takeSpool(reload(s))).toBeDefined();
  });

  it("puts the spool on the garden table in a Hoppy Cat landing", () => {
    const landing = reload(createLandingWorld(pack));
    expect(landing.items[SPOOL].holder).toBe(pack.entry);
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
    const lane = (g) => g.transports["greek-ship"].lanes.at(-1);
    expect(problems((g) => (lane(g).opensWith[0].pack = "Not A Pack"))).toMatch(
      /condition/,
    );
    expect(problems((g) => (lane(g).opensWith = []))).toMatch(/opensWith/);
    expect(problems((g, h) => (h.crossings[0].retired = false))).toMatch(
      /only known fields/,
    );
  });
});

describe("the retired red thread", () => {
  it("is closed in a new game and in a pack landing", () => {
    const s = setup("pond");
    expect(s.crossings[THREAD].discovered).toBe(false);
    expect(moves(s, "vale")).not.toContain(pack.entry);
    const landing = reload(createLandingWorld(pack));
    expect(landing.crossings[THREAD].discovered).toBe(false);
    expect(landing.crossings["hoppycat-garden-pond"].discovered).toBe(true);
  });

  it("closes on load where a save had already found it", () => {
    const s = setup("pond");
    s.crossings[THREAD].discovered = true;
    const loaded = reload(s);
    expect(loaded.crossings[THREAD].discovered).toBe(false);
    expect(moves(loaded, "vale")).not.toContain(pack.entry);
  });

  it("an earlier save closes a found thread and teaches the lane to its visitors", () => {
    const s = setup("pond");
    s.crossings[THREAD].discovered = true;
    s.packs[pack.id].revision = 1;
    // Mara stands in the garden; Vale walked through it long ago.
    s.actors.mara.place = pack.entry;
    s.routeKnowledge.vale = [["pond", pack.entry]];
    // A roaming bard keeps every route, and learns no lane without a visit.
    const bard = structuredClone(s.routeKnowledge["greek-rhapsode"]);
    const next = upgrade(s);
    expect(next.packs[pack.id].revision).toBe(3);
    expect(next.crossings[THREAD].discovered).toBe(false);
    for (const who of players)
      expect(knowsLane(next, who, "greek-piraeus", JETTY)).toBe(true);
    // The lane is learned as knowledge; it still opens only with a thing aboard.
    const aboard = structuredClone(next);
    aboard.actors.vale.place = "greek-piraeus";
    summonTransport(aboard, "greek-ship", "greek-piraeus");
    expect(
      courses(act(reload(aboard), "vale", "move", "greek-ship"), "vale"),
    ).not.toContain(JETTY);
    expect(next.routeKnowledge["greek-rhapsode"]).toEqual(bard);
    expect(moves(next, "vale")).not.toContain(pack.entry);

    // An earlier save that never found it loses nothing and gains no door.
    const unfound = setup("pond");
    unfound.packs[pack.id].revision = 1;
    const upgraded = upgrade(unfound);
    expect(upgraded.packs[pack.id].revision).toBe(3);
    expect(knowsLane(upgraded, "vale", "greek-piraeus", JETTY)).toBe(false);
    expect(moves(upgraded, "vale")).not.toContain(pack.entry);
  });
});
