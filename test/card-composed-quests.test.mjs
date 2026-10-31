import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  nameOf,
  play,
  plan,
  stranded,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  QUEST_VERBS,
  newWant,
  nextWant,
  questFromData,
  wantCandidates,
  wantMet,
} from "../v2/card-game/want.mjs";
import { wantFact } from "../v2/card-game/want-talk.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";

const find = (s, kind, fields = {}, actor) =>
  legalActions(s, actor).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
const api = (s, reach = []) => ({
  carried: (id) =>
    Object.keys(s.items).filter((item) => s.items[item].holder === id),
  rootHolder: (item) => s.items[item].holder,
  valueOf: () => 5,
  reachable: () => reach,
});
// Pip and Vale in the attic with an empty lamp. The oil is here, so no
// path opens on its own; someone has to fill and light the lamp.
const darkAttic = () => {
  const s = createWorld();
  s.actors.moth.place = "attic";
  s.actors.vale.place = "attic";
  Object.assign(s.items.lamp, { holder: "attic", lit: false, fuel: 0 });
  s.items.oil.holder = "attic";
  return validateWorld(s);
};

describe("quests composed from verbs and the world's entities", () => {
  it("maps first-generation starter data onto verbs", () => {
    expect(questFromData({ kind: "item", target: "lamp" })).toEqual({
      verb: "have",
      target: "lamp",
    });
    expect(questFromData({ kind: "place", target: "pond" }).verb).toBe("visit");
    expect(questFromData({ kind: "person", target: "vale" }).verb).toBe("find");
    expect(
      questFromData({ verb: "travel_with", target: "keeper", with: "pond" }),
    ).toEqual({ verb: "travel_with", target: "keeper", with: "pond" });
  });

  it("composes candidates for every verb from what the actor knows", () => {
    const s = createWorld();
    for (const id of ["moth", "keeper", "vale"]) s.actors[id].place = "station";
    s.actors.moth.visited = ["station"];
    s.items.bell.holder = "moth";
    const pool = wantCandidates(s, "moth", api(s, ["pond"]));
    for (const verb of ["visit", "talk", "give", "travel_with"])
      expect(
        pool.some((c) => c.startsWith(`${verb}:`)),
        verb,
      ).toBe(true);
    expect(pool).toContain("travel_with:keeper:pond");
    expect(pool).toContain("give:bell:keeper");
    // Someone elsewhere, where Pip has been, can be looked for.
    s.actors.keeper.place = "pond";
    s.actors.moth.visited = ["station", "pond"];
    expect(wantCandidates(s, "moth", api(s, ["pond"]))).toContain(
      "find:keeper",
    );
  });

  it("draws each verb fairly rather than mostly fetches", () => {
    const s = createWorld();
    for (const id of ["moth", "keeper", "vale"]) s.actors[id].place = "station";
    s.actors.moth.visited = ["station"];
    s.items.bell.holder = "moth";
    // Many items are held nearby, so fetches dominate the raw pool.
    for (const id of ["lamp", "oil", "cloth"]) s.items[id].holder = "keeper";
    const reads = {
      ...api(s, ["pond"]),
      valueOf: (_, id) => (id === "bell" ? 1 : 5),
    };
    const pool = wantCandidates(s, "moth", reads);
    expect(pool.filter((c) => c.startsWith("have:")).length).toBe(3);
    const counts = {};
    for (let turn = 0; turn < 300; turn++) {
      s.turn = turn;
      const w = nextWant(s, "moth", reads);
      counts[w.verb] = (counts[w.verb] || 0) + 1;
    }
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(5);
    expect(counts.have).toBeGreaterThan(0);
    expect(counts.have).toBeLessThan(300 / 3);
    expect(Object.keys(counts).every((v) => QUEST_VERBS.includes(v))).toBe(
      true,
    );
  });

  it("meets find, give and travel_with from world facts and committed plays", () => {
    const s = createWorld();
    s.actors.moth.want = newWant("find", "keeper", 0);
    s.actors.moth.place = "pond";
    s.actors.keeper.place = "station";
    expect(wantMet(s, "moth")).toBe(false);
    s.actors.moth.place = "station";
    expect(wantMet(s, "moth")).toBe(true);

    s.actors.moth.want = newWant("give", "bell", 0, "keeper");
    const gift = {
      kind: "give",
      actor: "moth",
      target: "keeper",
      item: "bell",
    };
    expect(wantMet(s, "moth", { ...gift, accepted: false })).toBe(false);
    expect(wantMet(s, "moth", { ...gift, accepted: true })).toBe(true);

    s.actors.moth.want = newWant("travel_with", "keeper", 0, "pond");
    const trip = {
      kind: "accompany",
      actor: "keeper",
      target: "moth",
      destination: "pond",
      accepted: true,
    };
    expect(wantMet(s, "moth", trip)).toBe(false);
    s.actors.moth.place = "pond";
    expect(wantMet(s, "moth", trip)).toBe(true);
    expect(wantMet(s, "moth", { ...trip, accepted: false })).toBe(false);
  });

  it("pursues a trip together with Invite along and meets it on arrival", () => {
    let s = createWorld();
    for (const id of ["moth", "keeper", "vale"]) s.actors[id].place = "station";
    s.actors.moth.want = newWant("travel_with", "keeper", 0, "pond");
    // The keeper is bound for the pond too, so the trip suits them.
    s.actors.keeper.want = newWant("visit", "pond", 0);
    expect(plan(s, "moth").action).toMatchObject({
      kind: "accompany",
      target: "keeper",
      destination: "pond",
    });
    s = play(s, find(s, "wait")).state;
    expect(
      s.log.some(
        (e) =>
          e.verb === "want_met" &&
          e.actorId === "moth" &&
          e.wantMet.verb === "travel_with",
      ),
    ).toBe(true);
    expect(validateWorld(s)).toBe(s);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("says the quest in one line in the speaker's words", () => {
    const s = createWorld();
    s.actors.moth.want = newWant("find", "keeper", 0);
    s.actors.moth.place = "station";
    s.actors.keeper.place = "pond";
    expect(wantFact(s, "moth", nameOf)).toBe("I want to find The keeper.");
    s.actors.moth.want = newWant("travel_with", "keeper", 0, "pond");
    expect(wantFact(s, "moth", nameOf)).toBe(
      `I want to travel with The keeper to ${nameOf("pond")}.`,
    );
    s.actors.moth.want = newWant("give", "bell", 0, "vale");
    expect(wantFact(s, "moth", nameOf)).toBe(
      "I want to give the Bell to Vale.",
    );
  });
});

describe("a stranded traveller needs nothing special", () => {
  it("is stranded in the dark attic and free once the light opens a way", () => {
    const s = darkAttic();
    expect(stranded(s, "moth")).toBe(true);
    // A pack resident who keeps to its scene is never stranded.
    expect(stranded(s, "greek-antigone")).toBe(false);
    Object.assign(s.items.lamp, { lit: true, fuel: 4 });
    expect(stranded(s, "moth")).toBe(false);
  });

  it("says it is stuck when someone talks with it", () => {
    const s = darkAttic();
    s.actors.moth.want = newWant("visit", "pond", 0);
    const talk = find(s, "talk", { target: "moth" });
    const result = play(s, talk);
    const pip = narrativeContext(result.state, talk).entities.find(
      (e) => e.id === "moth",
    );
    expect(pip.facts).toContain(
      `I'm stuck here. I can't find a way out. I want to be at ${nameOf("pond")}.`,
    );
    // Vale, the player, is never told she is stuck.
    const vale = narrativeContext(result.state, talk).entities.find(
      (e) => e.id === "vale",
    );
    expect(vale.facts.some((f) => f.startsWith("I'm stuck"))).toBe(false);
  });

  it("can be found by anyone whose own quest is to find it", () => {
    let s = createWorld();
    s.actors.moth.place = "pond";
    s.actors.keeper.place = "station";
    s.actors.vale.place = "station";
    s.actors.keeper.visited = ["station", "pond"];
    expect(wantCandidates(s, "keeper", api(s, ["pond"]))).toContain(
      "find:moth",
    );
    s.actors.keeper.want = newWant("find", "moth", 0);
    s.actors.moth.want = newWant("visit", "pond", 0);
    expect(plan(s, "keeper").action).toMatchObject({
      kind: "move",
      target: "pond",
    });
    s = play(s, find(s, "wait")).state;
    expect(
      s.log.some(
        (e) =>
          e.verb === "want_met" &&
          e.actorId === "keeper" &&
          e.wantMet.verb === "find",
      ),
    ).toBe(true);
  });

  it("moves an old save's first-generation want onto a verb", () => {
    const s = createWorld();
    const legacy = JSON.parse(encodeSave(s));
    legacy.actors.moth.want = {
      kind: "person",
      target: "vale",
      since: 0,
      refusals: 0,
    };
    legacy.actors.keeper.want = {
      kind: "item",
      target: "bell",
      since: 0,
      refusals: 0,
    };
    const loaded = decodeSave(JSON.stringify(legacy));
    expect(loaded.actors.moth.want).toEqual(newWant("talk", "vale", 0));
    expect(loaded.actors.keeper.want).toEqual(newWant("have", "bell", 0));
  });
});
