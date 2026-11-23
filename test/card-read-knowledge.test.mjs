import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KNOWLEDGE_FACT_LIMIT,
  PROTECTED_FACT_LIMIT,
  knowledgeDisclosures,
  knowledgeFacts,
  newKnowledge,
  protectedFact,
  readClaim,
  reserveKnowledge,
  validKnowledge,
  witnessKnowledge,
} from "../v2/card-game/knowledge.mjs";
import {
  addLog,
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  nameOf,
  play,
} from "../v2/card-game/world.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { authoredClaim, bookClaims } from "../v2/card-game/claims.mjs";

const writ = packDefinition("greek-drama").items["greek-creon-writ"];
const texts = [
  "The bearer of this writ may pass the Theban gate.",
  "No one may bury the traitor outside the walls.",
  "The guard answers to the king alone.",
];
const id = (n) => `claim:greek-drama:greek-creon-writ:c${n}`;
const from = "in Creon's Writ, by Creon:";
beforeEach(() => {
  writ.author = "greek-creon";
  writ.claims = texts.map((text, n) => ({ id: `c${n}`, text }));
  writ.claims[2].about = "keeper";
});
afterEach(() => {
  delete writ.author;
  delete writ.claims;
});

const actors = ["vale", "moth", "keeper"];
const bare = () => ({
  turn: 1,
  eventSeq: 1,
  actors: Object.fromEntries(actors.map((a) => [a, { place: "station" }])),
  knowledge: newKnowledge(),
});
const entry = (w) => ({ seq: ++w.eventSeq, turn: w.turn });
const read = (w, reader, at = entry(w)) =>
  bookClaims("greek-drama", "greek-creon-writ").forEach((c) =>
    readClaim(w, reader, c, at),
  );
const talk = (w, speaker, listener, topics) => {
  reserveKnowledge(w, speaker, listener, entry(w), topics);
  return knowledgeDisclosures(w, [speaker], [speaker, listener], "station");
};
const news = (w, text, actorId = "moth") =>
  witnessKnowledge(w, {
    ...entry(w),
    kind: "action",
    verb: "give",
    actorId,
    locationId: "station",
    cast: [actorId],
    text,
  });
const valid = (w, claimOf = authoredClaim) =>
  validKnowledge(w, actors, ["station"], [], undefined, claimOf);

describe("claims learned by reading", () => {
  it("keeps the book and author, and every reader shares one fact", () => {
    const w = bare();
    read(w, "vale");
    read(w, "moth");
    expect(Object.keys(w.knowledge.facts)).toEqual([0, 1, 2].map(id));
    expect(w.knowledge.facts[id(0)].source).toMatchObject({
      kind: "claim",
      book: "greek-creon-writ",
      author: "greek-creon",
      witnesses: ["moth", "vale"],
    });
    expect(w.knowledge.known.moth[id(2)]).toEqual({
      kind: "read",
      teller: null,
      book: "greek-creon-writ",
      eventSeq: 3,
      learnedTurn: 1,
    });
    expect(readClaim(w, "vale", authoredClaim(id(0)), entry(w))).toBeNull();
    expect(valid(w)).toBe(true);
    expect(valid(w, () => null)).toBe(false);
  });

  it("tells a read claim on a later turn, with its book and author", () => {
    const w = bare();
    read(w, "moth");
    expect(talk(w, "moth", "vale")).toEqual([]);
    w.turn = 3;
    expect(talk(w, "moth", "vale")[0].text).toBe(texts[0]);
    expect(w.knowledge.known.vale[id(0)].teller).toBe("moth");
    expect(valid(w)).toBe(true);
    expect(knowledgeFacts(w, "vale", nameOf)).toEqual([
      `Pip told me this just now, from Creon's Writ, by Creon: ${texts[0]}`,
    ]);
    const lines = (...args) => knowledgeFacts(w, "moth", nameOf, ...args);
    expect(lines([], 10)).toEqual([
      `I read this a little while ago ${from} ${texts[0]}`,
      `I read this a little while ago ${from} ${texts[1]}`,
    ]);
    expect(lines([], 10, ["keeper"])[0]).toContain(texts[2]);
    expect(lines([id(1)], 10, ["keeper"])[0]).toContain(texts[1]);
    talk(w, "moth", "vale");
    read(w, "vale");
    expect(knowledgeFacts(w, "vale", nameOf, [id(2)])[0]).toContain(texts[2]);
  });

  it("shortens the attribution so a long claim stays whole", () => {
    const w = bare();
    const long = `The bearer may pass ${"and pass again ".repeat(9)}the gate.`;
    writ.claims[0].text = long;
    read(w, "moth");
    w.turn = 2;
    talk(w, "moth", "vale");
    const name = (a) => (a === "greek-creon-writ" ? "A".repeat(60) : nameOf(a));
    expect(knowledgeFacts(w, "moth", name, [id(0)])[0]).toBe(
      `I read what Creon wrote: ${long}`,
    );
    expect(knowledgeFacts(w, "vale", name)).toEqual([
      `Pip told me what Creon wrote: ${long}`,
    ]);
  });

  it("rejects a read memory or claim that does not match its book", () => {
    const w = bare();
    read(w, "vale");
    w.turn = 2;
    talk(w, "vale", "moth");
    const event = news(w, "The keeper gives the lamp to Pip.", "keeper").id;
    expect(valid(w)).toBe(true);
    const memory = (v) => v.knowledge.known.vale[id(0)];
    for (const change of [
      (v) => (memory(v).teller = "moth"),
      (v) => (memory(v).book = "greek-decree"),
      (v) => delete memory(v).book,
      (v) => delete Object.assign(memory(v), { kind: "witnessed" }).book,
      (v) => (v.knowledge.facts[id(0)].source.witnesses = ["moth"]),
      (v) => (v.knowledge.facts[id(0)].text = "The gate is open to all."),
      (v) => (v.knowledge.facts[id(2)].source.about = null),
      (v) =>
        (v.knowledge.known.keeper[event] = {
          ...memory(v),
          eventSeq: w.eventSeq,
          learnedTurn: 2,
        }),
    ]) {
      const copy = structuredClone(w);
      change(copy);
      expect(valid(copy)).toBe(false);
    }
  });

  it("keeps topics and claims within half the store, oldest out first", () => {
    const w = bare();
    const topic = {
      id: "public-petition",
      speaker: "moth",
      at: "station",
      text: "The families ask the city for a burial.",
      packId: "sample",
    };
    talk(w, "moth", "vale", [topic]);
    writ.claims = Array.from({ length: PROTECTED_FACT_LIMIT + 1 }, (_, n) => ({
      id: `c${n}`,
      text: `The writ says claim ${n} holds.`,
    }));
    for (const claim of bookClaims("greek-drama", "greek-creon-writ"))
      readClaim(w, "vale", claim, entry(w));
    for (let n = 0; n < KNOWLEDGE_FACT_LIMIT; n++)
      news(w, `Pip carried shell number ${n} to the pond.`);
    const facts = Object.values(w.knowledge.facts);
    expect(facts).toHaveLength(KNOWLEDGE_FACT_LIMIT);
    expect(facts.filter(protectedFact)).toHaveLength(PROTECTED_FACT_LIMIT);
    const known = Object.keys(w.knowledge.known.vale);
    expect(known).not.toContain(topic.id);
    expect(known).not.toContain(id(0));
    expect(known).toContain(id(1));
    expect(valid(w)).toBe(true);
    const event = facts.find((f) => !protectedFact(f)).id;
    delete w.knowledge.facts[event];
    delete w.knowledge.known.moth[event];
    const source = { ...w.knowledge.facts[id(1)].source, claim: "c0" };
    w.knowledge.facts[id(0)] = { id: id(0), text: writ.claims[0].text, source };
    expect(valid(w)).toBe(false);
  });

  it("brings a read claim into the reader's scene and saves it", () => {
    let w = createWorld();
    for (const a of ["vale", "moth"]) w.actors[a].place = "station";
    addLog(w, "World", "Vale reads Creon's Writ.");
    read(w, "vale", w.log.at(-1));
    w = decodeSave(encodeSave(w));
    const wait = legalActions(w).find((a) => a.kind === "wait");
    w = play(w, wait).state;
    const { facts } = narrativeContext(w, wait).entities.find(
      (e) => e.id === "vale",
    );
    expect(facts).toContain(`I read this just now ${from} ${texts[0]}`);
  });
});
