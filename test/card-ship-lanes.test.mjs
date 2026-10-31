import { describe, it, expect } from "vitest";
import {
  createWorld,
  encodeSave,
  decodeSave,
  legalActions,
  play,
  laneTalkFacts,
  publishKnowledgeSpeech,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import {
  knowsLane,
  learnLane,
  summonTransport,
} from "../v2/card-game/pack-transport.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { openSeas } from "./helpers/open-door.mjs";

const players = ["vale", "mara"];
const reload = (s) => decodeSave(encodeSave(s));
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

describe("knowing a lane is personal", () => {
  it("a shore traveller knows the Black Pond lanes, a Greek resident its home sea, Myrto every lane", () => {
    const s = setup("pond");
    expect(knowsLane(s, "vale", "pond", "greek-harbor")).toBe(true);
    expect(knowsLane(s, "vale", "greek-harbor", "pond")).toBe(true);
    expect(knowsLane(s, "mara", "greek-harbor", "greek-piraeus")).toBe(false);
    expect(knowsLane(s, "greek-antigone", "greek-harbor", "greek-piraeus")).toBe(
      true,
    );
    for (const [from, to] of [
      ["greek-athens-harbor", "greek-piraeus"],
      ["greek-harbor", "greek-ajax-landing"],
    ])
      expect(knowsLane(s, "greek-shipmaster", from, to)).toBe(true);
  });

  // Every lane past the Wine-Dark Harbor now opens with a condition or a
  // story dock, so knowing one changes what Myrto tells, not the course cards.
  it("everyone who sails a lane learns it, both ways", () => {
    let s = dispatchShared({ op: "create", save: encodeSave(openSeas()) })
      .world;
    for (const id of players) s.actors[id].place = "greek-athens-harbor";
    summonTransport(s, "greek-ship", "greek-athens-harbor");
    s = reload(s);
    s = act(s, "vale", "move", "greek-ship");
    s = act(s, "mara", "move", "greek-ship");
    // The plea at the Agora opens the lane for both, known or not.
    expect(courses(s, "vale")).toEqual(["greek-piraeus"]);
    expect(knowsLane(s, "mara", "greek-athens-harbor", "greek-piraeus")).toBe(
      false,
    );
    s = act(s, "vale", "course", "greek-piraeus");
    s = act(s, "mara", "wait");
    expect(knowsLane(s, "mara", "greek-athens-harbor", "greek-piraeus")).toBe(
      true,
    );
    expect(knowsLane(s, "mara", "greek-piraeus", "greek-athens-harbor")).toBe(
      true,
    );
  });

  it("before the Open Door the Travel Provisions aboard leave the Piraeus lane closed", () => {
    const fresh = (dock) => {
      const s = dispatchShared({
        op: "create",
        save: encodeSave(createWorld()),
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
    // Mara carries the provisions aboard. Neither has heard the lane; the
    // thing aboard opens it for both.
    s = fresh("greek-harbor");
    s.items["greek-provisions"].holder = "mara";
    s = act(reload(s), "vale", "move", "greek-ship");
    expect(courses(s, "vale")).toEqual(["pond"]);
    s = act(s, "mara", "move", "greek-ship");
    // The lane also waits for the Open Door (test/card-open-door-lanes).
    expect(courses(s, "vale")).toEqual(["pond"]);
    expect(courses(s, "mara")).toEqual(["pond"]);
  });

  it("Myrto tells a lane through Talk; only published speech puts it on the chart", () => {
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
    // Speech without the fact teaches nothing.
    world.log.push({
      ...world.log.at(-1),
      seq: world.eventSeq + 1,
      kind: "dialogue",
      generated: true,
      actorId: "greek-shipmaster",
      locationId: "greek-harbor",
      cast: ["vale", "greek-shipmaster"],
      text: "The sea is wide tonight.",
    });
    world.eventSeq += 1;
    expect(publishKnowledgeSpeech(world, world.log.at(-1), [disclosure])).toEqual(
      [],
    );
    world.log.at(-1).text = `Listen. ${disclosure.text} Go well.`;
    expect(
      publishKnowledgeSpeech(world, world.log.at(-1), [disclosure]),
    ).toHaveLength(1);
    expect(knowsLane(world, "vale", from, to)).toBe(true);
    expect(knowsFact(world, "vale", disclosure.factId)).toBe(true);
    expect(reload(world).routeKnowledge.vale).toContainEqual([
      `sea:${from}`,
      `sea:${to}`,
    ]);
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
