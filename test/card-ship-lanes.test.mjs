import { describe, it, expect } from "vitest";
import {
  createWorld,
  encodeSave,
  decodeSave,
  play,
  laneTalkFacts,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { applyGeneratedText, narrativeContext } from "../v2/card-game/narrative.mjs";
import { sharedContext } from "../v2/card-game/shared-narrator.mjs";
import {
  knowsLane,
  learnLane,
  summonTransport,
} from "../v2/card-game/pack-transport.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { openDoorStart, openSeas } from "./helpers/open-door.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";

const players = ["vale", "mara"];
const reload = (s) => decodeSave(encodeSave(s));
function setup(
  dock,
  packScopes = { "greek-drama": "full" },
  ship = "greek-ship",
) {
  const s = dispatchShared({
    op: "create",
    save: encodeSave(createWorld({ packScopes })),
  }).world;
  for (const id of players) s.actors[id].place = dock;
  summonTransport(s, ship, dock);
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
  // A standoff locks the room; the walkthrough talks its way out first.
  const fight = world.standoffs.find(
    (c) => c.location === world.actors[actor].place,
  );
  const party =
    fight &&
    players.find((id) => [fight.challenger, fight.defender].includes(id));
  if (party && kind !== "talk")
    world = act(
      world,
      party,
      "talk",
      fight.challenger === party ? fight.defender : fight.challenger,
    );
  const action = ask(world, actor).actions.find(
    (a) => a.kind === kind && (target === undefined || a.target === target),
  );
  expect(action, `${actor} ${kind} ${target ?? ""}`).toBeDefined();
  const result = ask(world, actor, "play", { action });
  expect(result.ok, result.error).toBe(true);
  return reload(result.world);
}
// Lay a carried thing down where the actor stands.
function drop(world, actor, item) {
  const action = ask(world, actor).actions.find(
    (a) => a.kind === "drop" && a.item === item,
  );
  expect(action, `${actor} drop ${item}`).toBeDefined();
  const result = ask(world, actor, "play", { action });
  expect(result.ok, result.error).toBe(true);
  return reload(result.world);
}
const courses = (s, actor) =>
  ask(s, actor)
    .actions.filter((a) => a.kind === "course")
    .map((a) => a.target)
    .sort();

describe("knowing a lane is personal", () => {
  it("a shore traveller knows the Black Pond lanes and a Greek resident its home sea", () => {
    const s = setup("pond");
    expect(knowsLane(s, "vale", "pond", "greek-harbor")).toBe(true);
    expect(knowsLane(s, "vale", "greek-harbor", "pond")).toBe(true);
    expect(knowsLane(s, "mara", "greek-harbor", "greek-piraeus")).toBe(false);
    expect(
      knowsLane(s, "greek-antigone", "greek-harbor", "greek-piraeus"),
    ).toBe(true);
    expect(
      knowsLane(s, "greek-shipmaster", "greek-harbor", "greek-piraeus"),
    ).toBe(true);
    expect(
      knowsLane(s, "greek-pagasae-pilot", "greek-pagasae", "greek-lemnos"),
    ).toBe(true);
  });

  it("everyone who sails a lane learns it, both ways", () => {
    let s = dispatchShared({
      op: "create",
      save: encodeSave(openSeas()),
    }).world;
    for (const id of players) s.actors[id].place = "greek-piraeus";
    // Roaming residents, such as the Bard, may be aboard; set them ashore.
    for (const a of Object.values(s.actors))
      if (a.place === "greek-ship") a.place = s.transports["greek-ship"].dock;
    s.transports["greek-ship"].riders = [];
    summonTransport(s, "greek-ship", "greek-piraeus");
    // Vale has sailed home from Piraeus before; Mara knows only the jetty
    // lane, which is enough to board.
    learnLane(s, "vale", "greek-piraeus", "greek-harbor");
    learnLane(s, "mara", "greek-piraeus", "hoppycat-signal-jetty");
    s = reload(s);
    s = act(s, "vale", "move", "greek-ship");
    s = act(s, "mara", "move", "greek-ship");
    expect(courses(s, "vale")).toContain("greek-harbor");
    expect(knowsLane(s, "mara", "greek-piraeus", "greek-harbor")).toBe(false);
    s = act(s, "vale", "course", "greek-harbor");
    s = act(s, "mara", "wait");
    expect(knowsLane(s, "mara", "greek-piraeus", "greek-harbor")).toBe(true);
    expect(knowsLane(s, "mara", "greek-harbor", "greek-piraeus")).toBe(true);
  });

  it("learns the Scylla lane to Lemnos by Talk and sails both ways without provisions", () => {
    const pagasae = "greek-pagasae";
    const lemnos = "greek-lemnos";
    const scylla = "greek-scylla";
    const pilot = "greek-pagasae-pilot";
    let s = setup(pagasae, {}, scylla);
    stowProvisions(s, "greek-harbor");
    const charybdisDock = s.transports["greek-ship"].dock;
    const talk = ask(s, "vale").actions.find(
      (a) => a.kind === "talk" && a.target === pilot,
    );
    expect(talk).toBeDefined();
    const played = ask(s, "vale", "play", { action: talk });
    expect(played.ok, played.error).toBe(true);
    const clue = played.events.find((e) => e.disclosedFactId);
    expect(clue).toMatchObject({
      text: "Ships for The Lemnian Cave leave from Pagasae Anchorage.",
      disclosedFactId: `lane:${pagasae}>${lemnos}`,
      actorId: pilot,
      targetId: "vale",
      witnesses: [pilot, "vale"],
    });
    expect(clue.generated).toBeUndefined();
    s = reload(played.world);
    expect(knowsLane(s, "vale", pagasae, lemnos)).toBe(true);
    expect(knowsLane(s, "vale", lemnos, pagasae)).toBe(true);
    expect(knowsFact(s, "mara", clue.disclosedFactId)).toBe(false);
    const chart = act(s, "vale", "talk", pilot);
    expect(knowsLane(chart, "vale", pagasae, "greek-sicily")).toBe(true);
    const anchorage = act(chart, "vale", "talk", pilot);
    expect(knowsLane(anchorage, "vale", pagasae, "greek-aulis")).toBe(true);
    const outOfDirections = act(anchorage, "vale", "talk", pilot);
    expect(outOfDirections.log.filter((line) => line.actorId === pilot && line.disclosedFactId)
      .map((line) => line.disclosedFactId)).toEqual([
      `lane:${pagasae}>${lemnos}`,
      `lane:${pagasae}>greek-sicily`,
      `lane:${pagasae}>greek-aulis`,
    ]);
    expect(knowsLane(outOfDirections, "vale", pagasae, "greek-egypt-tomb")).toBe(false);
    expect(knowsLane(outOfDirections, "vale", "greek-harbor", "greek-piraeus")).toBe(false);
    learnLane(s, "mara", pagasae, "greek-sicily");
    expect(knowsLane(s, "mara", pagasae, lemnos)).toBe(false);
    expect(ask(s, "vale").exits).not.toContain("greek-ship");
    s = act(s, "vale", "move", scylla);
    s = act(s, "mara", "move", scylla);
    expect(courses(s, "vale")).toContain(lemnos);
    expect(courses(s, "mara")).toEqual(["greek-sicily"]);
    s = act(s, "vale", "course", lemnos);
    s = act(s, "mara", "wait");
    s = act(s, "vale", "move", lemnos);
    expect(s.actors.vale.place).toBe(lemnos);
    expect(knowsLane(s, "mara", lemnos, pagasae)).toBe(true);
    s = act(s, "mara", "course", pagasae);
    s = act(s, "mara", "wait");
    s = act(s, "mara", "move", pagasae);
    expect(s.actors.mara.place).toBe(pagasae);
    expect(s.transports["greek-ship"].dock).toBe(charybdisDock);
    expect(s.items["greek-provisions"].holder).toBe("greek-harbor");
  });

  it("the Travel Provisions aboard open the Wine-Dark Harbor to Piraeus lane for everyone on deck", () => {
    const fresh = (dock, local = createWorld()) => {
      const s = dispatchShared({
        op: "create",
        save: encodeSave(local),
      }).world;
      for (const id of players) s.actors[id].place = dock;
      summonTransport(s, "greek-ship", dock);
      s.crossings["pond-greek-harbor"].discovered = true;
      return reload(s);
    };
    // A default save, without the Open Door.
    let s = act(fresh("pond"), "vale", "move", "greek-ship");
    expect(s.packs["greek-drama"].scope).toBe("opening");
    expect(courses(s, "vale")).toEqual(["greek-harbor"]);
    s = act(fresh("greek-harbor"), "vale", "move", "greek-ship");
    expect(courses(s, "vale")).toEqual(["pond"]);
    // Piraeus is Thebes's sea exit: before Dione's invitation the
    // provisions aboard already sail there (rules 94).
    s = fresh("greek-harbor");
    stowProvisions(s, "greek-ship");
    s = act(reload(s), "vale", "move", "greek-ship");
    expect(courses(s, "vale")).toEqual(["greek-piraeus", "pond"]);
    // After it, Mara carries the provisions aboard. Carried, they open
    // nothing (rules 102); laid on deck they open the lane for both, though
    // Mara has not heard it.
    s = fresh("greek-harbor", openDoorStart());
    stowProvisions(s, "mara");
    s = act(reload(s), "vale", "move", "greek-ship");
    expect(courses(s, "vale")).toEqual(["pond"]);
    s = act(s, "mara", "move", "greek-ship");
    expect(courses(s, "vale")).toEqual(["pond"]);
    expect(courses(s, "mara")).toEqual(["pond"]);
    s = drop(s, "mara", "greek-provisions");
    expect(s.items["greek-provisions"].holder).toBe("greek-ship");
    expect(courses(s, "vale")).toEqual(["greek-piraeus", "pond"]);
    expect(courses(s, "mara")).toEqual(["greek-piraeus", "pond"]);
    expect(knowsLane(s, "mara", "greek-harbor", "greek-piraeus")).toBe(false);
    s = act(s, "vale", "course", "greek-piraeus");
    s = act(s, "mara", "wait");
    s = act(s, "vale", "move", "greek-piraeus");
    expect(s.actors.vale.place).toBe("greek-piraeus");
    expect(knowsLane(s, "vale", "greek-harbor", "greek-piraeus")).toBe(true);
    // The Long Walls inland are open: no burial or truce is needed.
    expect(ask(s, "vale").exits).toContain("greek-road-athens-piraeus");
    // The voyage leaves the provisions whole on deck (rules 102); they do not
    // open the jetty, which waits for a thing of its own.
    expect(s.items["greek-provisions"].holder).toBe("greek-ship");
    expect(courses(s, "mara")).toEqual(["greek-harbor"]);
    // The lane home stays open with the provisions left on the quay; only
    // the onward lane closes.
    stowProvisions(s, "greek-piraeus");
    s = reload(s);
    expect(courses(s, "mara")).toEqual(["greek-harbor"]);
  });

  it("charts a sea lane after Myrto's reply reveals the route", () => {
    let s = setup("greek-harbor");
    s.actors["greek-shipmaster"].place = "greek-harbor";
    s = reload(s);
    const talk = ask(s, "vale").actions.find(
      (a) => a.kind === "talk" && a.target === "greek-shipmaster",
    );
    expect(talk).toBeDefined();
    const result = play(ask(s, "vale").world, talk, s.revision, "vale");
    expect(result.ok, result.error).toBe(true);
    let world = result.state;
    const context = narrativeContext(world, talk);
    const disclosure = context.disclosures?.[0];
    expect(disclosure).toMatchObject({
      speaker: "greek-shipmaster",
      listener: "vale",
    });
    expect(disclosure.factId).toMatch(/^lane:greek-harbor>/);
    // A gated lane is told with the thing that opens it.
    expect(disclosure.text).toBe(
      "Ships for Piraeus Quays leave from The Wine-Dark Harbor only with Travel Provisions aboard.",
    );
    // Talk context names the lanes Myrto knows from here.
    const myrto = context.entities.find((e) => e.id === "greek-shipmaster");
    expect(myrto.facts.some((f) => /^I know ships sail from/.test(f))).toBe(
      true,
    );
    const [from, to] = disclosure.factId.slice(5).split(">");
    expect(knowsLane(world, "vale", from, to)).toBe(false);
    expect(knowsFact(world, "vale", disclosure.factId)).toBe(false);
    const { factId, speaker, listener, eventSeq } = disclosure;
    world = applyGeneratedText(world, context, {
      model: "fixture",
      revision: context.revision,
      entries: [{
        id: speaker,
        text: "You'll need Travel Provisions aboard to sail from this harbor to Piraeus Quays.",
        disclosed: { factId, speaker, listener, eventSeq },
      }],
    });
    expect(knowsLane(world, "vale", from, to)).toBe(true);
    expect(knowsFact(world, "vale", disclosure.factId)).toBe(true);
    expect(reload(world).routeKnowledge.vale).toContainEqual([
      `sea:${from}`,
      `sea:${to}`,
    ]);
    // A save told older words loads with the lane's current words.
    world.knowledge.facts[disclosure.factId].text = "Ships leave at dawn.";
    const saved = decodeSave(JSON.stringify(world)).knowledge.facts;
    expect(saved[disclosure.factId].text).toBe(disclosure.text);
  });

  it("Talk context at a port lists the lanes the speaker knows from it", () => {
    const s = setup("greek-harbor");
    expect(laneTalkFacts(s, "vale")).toEqual([
      "I know ships sail from The Wine-Dark Harbor to Black pond.",
    ]);
    s.actors.vale.place = "station";
    expect(laneTalkFacts(s, "vale")).toEqual([]);
  });

  it("a saved lane must be a real lane", () => {
    const s = setup("pond");
    s.routeKnowledge.vale = [["sea:pond", "sea:greek-piraeus"]];
    expect(() => reload(s)).toThrow();
  });
});
