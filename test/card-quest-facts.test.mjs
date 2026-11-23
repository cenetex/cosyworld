import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_FACT_LIMIT,
  PROTECTED_FACT_LIMIT,
  knowledgeDisclosures,
  knowledgeFacts,
  knowsFact,
  newKnowledge,
  protectedFact,
  reserveKnowledge,
  validKnowledge,
  witnessKnowledge,
} from "../v2/card-game/knowledge.mjs";
import {
  learnTold,
  questOwners,
  questText,
} from "../v2/card-game/quest-learn.mjs";
import { toldWant } from "../v2/card-game/talk-quest.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  nameOf,
  play,
} from "../v2/card-game/world.mjs";
import { theName } from "../v2/card-game/world/catalog.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";

const Q = "quest:moth:lamp";
const cast = Array.from({ length: PROTECTED_FACT_LIMIT }, (_, n) => `r${n}`);
const actors = ["vale", "moth", "keeper", ...cast];
const bare = () => ({
  turn: 1,
  eventSeq: 1,
  actors: Object.fromEntries(
    actors.map((a) => [a, { place: "station", want: null }]),
  ),
  items: {},
  knowledge: newKnowledge(),
});
const told = (w) => {
  w.actors.moth.want = newWant("item", "lamp", w.turn);
  learnTold(w, "moth", "vale");
  return w;
};
const entry = (w) => ({ seq: ++w.eventSeq, turn: w.turn });
const news = (w, n) =>
  witnessKnowledge(w, {
    ...entry(w),
    kind: "action",
    verb: "give",
    actorId: "keeper",
    locationId: "station",
    cast: ["keeper"],
    text: `The keeper carried shell number ${n} to the pond.`,
  });
const valid = (w) => validKnowledge(w, actors, ["station"]);

describe("quest facts", () => {
  it("are learned by a Talk, heard from their owner, and saved", () => {
    let s = createWorld();
    for (const id of ["vale", "moth"]) s.actors[id].place = "station";
    s.items.lamp.holder = "vale";
    s.actors.moth.want = newWant("item", "lamp", s.turn);
    const talk = legalActions(s).find(
      (a) => a.kind === "talk" && a.target === "moth",
    );
    s = decodeSave(encodeSave(play(s, talk).state));
    expect(s.knowledge.facts[Q]).toMatchObject({
      text: `${nameOf("moth")} wants ${theName("lamp")}.`,
      source: { kind: "quest", actorId: "moth", witnesses: [] },
    });
    expect(s.knowledge.known.vale[Q]).toMatchObject({
      kind: "heard",
      teller: "moth",
    });
    expect(knowsFact(s, "moth", Q)).toBe(false);
  });

  it("are learned by a Talk when a name holds a decimal point", () => {
    const ledger = "hoppycat-ledger-opus";
    const act = (w, kind, target) => {
      const a = legalActions(w).find(
        (x) => x.kind === kind && x.target === target,
      );
      return decodeSave(encodeSave(play(w, a).state));
    };
    let s = createLandingWorld(packDefinition("hoppycat-archive"), 7);
    for (const to of ["halfway-tea-garden", "meraki-atelier"])
      s = act(s, "move", `hoppycat-${to}`);
    s = act(s, "talk", "hoppycat-mira-meraki");
    s.actors[ledger].want = newWant("item", "lamp", s.turn);
    s = act(s, "talk", ledger);
    expect(s.knowledge.facts[`quest:${ledger}:lamp`].text).toBe(
      "Ledger (Opus 4.7) wants the Lamp.",
    );
    expect(toldWant(s, "vale", ledger)).toBe(true);
    expect(
      legalActions(s).some((a) => a.kind === "accept" && a.target === ledger),
    ).toBe(true);
  });

  it("word the owner's want in one sentence", () => {
    const w = createWorld();
    const said = (want) => questText(w, "moth", want);
    expect(said(newWant("place", "pond", 0))).toBe(
      `${nameOf("moth")} wants to be at ${nameOf("pond")}.`,
    );
    expect(said(newWant("person", "keeper", 0))).toBe(
      `${nameOf("moth")} wants to see ${nameOf("keeper")}.`,
    );
    expect(
      said({
        ...newWant("item", "lamp", 0),
        step: { verb: "give", to: "keeper" },
      }),
    ).toBe(
      `${nameOf("moth")} wants ${theName("lamp")} given to ${nameOf("keeper")}.`,
    );
  });

  it("are spared while live, and age out once the card is done", () => {
    const w = told(bare());
    for (let n = 0; n < KNOWLEDGE_FACT_LIMIT; n++) news(w, n);
    expect(protectedFact(w.knowledge.facts[Q], w)).toBe(true);
    expect(knowsFact(w, "vale", Q)).toBe(true);
    w.actors.moth.want = newWant("place", "pond", w.turn);
    expect(protectedFact(w.knowledge.facts[Q], w)).toBe(false);
    news(w, KNOWLEDGE_FACT_LIMIT);
    expect(w.knowledge.facts[Q]).toBeUndefined();
    expect(valid(w)).toBe(true);
    expect(questOwners(w, "vale")).toEqual(["moth"]);
  });

  it("share the protected cap, which trims a card that came back", () => {
    const w = told(bare());
    w.actors.moth.want = null;
    for (const id of cast) {
      w.eventSeq += 1;
      w.actors[id] = { place: "station", want: newWant("item", "lamp", 1) };
      learnTold(w, id, "vale");
    }
    w.actors.moth.want = newWant("item", "lamp", w.turn);
    const live = () =>
      Object.values(w.knowledge.facts).filter((f) => protectedFact(f, w));
    expect(live()).toHaveLength(PROTECTED_FACT_LIMIT + 1);
    expect(valid(w)).toBe(true);
    w.eventSeq += 1;
    w.actors.keeper.want = newWant("item", "lamp", w.turn);
    learnTold(w, "keeper", "vale");
    expect(live()).toHaveLength(PROTECTED_FACT_LIMIT);
    expect(w.knowledge.facts[Q]).toBeUndefined();
    expect(w.knowledge.facts["quest:r0:lamp"]).toBeUndefined();
    expect(w.knowledge.facts["quest:r1:lamp"]).toBeDefined();
  });

  it("pass on second-hand while live, never back to their owner", () => {
    const w = told(bare());
    w.turn = 2;
    const tell = (speaker, listener) => {
      reserveKnowledge(w, speaker, listener, entry(w));
      return knowledgeDisclosures(w, [speaker], [speaker, listener], "station");
    };
    expect(tell("vale", "moth")).toEqual([]);
    expect(tell("vale", "keeper")[0].factId).toBe(Q);
    expect(w.knowledge.known.keeper[Q]).toMatchObject({ teller: "vale" });
    expect(knowledgeFacts(w, "keeper", nameOf)).toEqual([
      `${nameOf("vale")} told me this just now at ${nameOf("station")}: ${w.knowledge.facts[Q].text}`,
    ]);
    w.actors.moth.want = null;
    expect(knowledgeFacts(w, "keeper", nameOf)[0]).toMatch(
      / Things may have changed since\.$/u,
    );
    w.turn = 3;
    delete w.knowledge.known.keeper[Q];
    expect(tell("vale", "keeper")).toEqual([]);
    expect(valid(w)).toBe(true);
  });

  it("count as told when learned second-hand, but not toward II", () => {
    const w = told(bare());
    w.turn = 2;
    reserveKnowledge(w, "vale", "keeper", entry(w));
    expect(toldWant(w, "keeper", "moth")).toBe(true);
    expect(questOwners(w, "keeper")).toEqual([]);
    expect(questOwners(w, "vale")).toEqual(["moth"]);
  });

  it("validate their owner, id and memories", () => {
    const w = told(bare());
    w.knowledge.known.keeper = {
      [Q]: {
        ...w.knowledge.known.vale[Q],
        kind: "read",
        teller: null,
        book: "letter",
      },
    };
    w.knowledge.facts[Q].source.witnesses = ["keeper"];
    expect(valid(w)).toBe(true);
    for (const change of [
      (v) => (v.knowledge.facts[Q].source.actorId = "keeper"),
      (v) => (v.knowledge.facts[Q].source.topic = {}),
      (v) =>
        (v.knowledge.known.moth = {
          [Q]: { ...v.knowledge.known.vale[Q], teller: "vale" },
        }),
      (v) => {
        v.knowledge.facts["quest:moth:"] = {
          ...v.knowledge.facts[Q],
          id: "quest:moth:",
        };
      },
    ]) {
      const copy = structuredClone(w);
      change(copy);
      expect(valid(copy)).toBe(false);
    }
  });
});
