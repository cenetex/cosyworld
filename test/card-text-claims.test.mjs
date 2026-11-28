import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  nameOf,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { claimsIn } from "../v2/card-game/claims.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { knowledgeFacts } from "../v2/card-game/knowledge.mjs";
import { tableQuest } from "../v2/card-game/quest-hand.mjs";
import { readPage } from "../v2/card-game/read-view.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";

const AUTHORS = {
  "greek-decree": "greek-creon",
  "greek-creon-writ": "greek-creon",
  "greek-household-token": "greek-ismene",
  "greek-olive-branch": "greek-theseus",
  "greek-burial-petition": "greek-argive-mother",
  "greek-ajax-plea": "greek-ajax-teucer",
  "greek-helen-accounts": "greek-rhapsode",
  "greek-atreid-record": "greek-rhapsode",
  "greek-egypt-testimony": "greek-helen-egypt",
  "greek-troy-testimony": "greek-helen-troy",
  "greek-tomb-testimony": "greek-electra-aeschylus",
  "greek-palace-testimony": "greek-electra-sophocles",
  "greek-farm-testimony": "greek-electra-euripides",
  "hoppycat-concordance-compass": "hoppycat-rill-current",
  "ratiradio-station-key": "ratiradio-rati",
  "ratiradio-request-slip": "ratiradio-rati",
  "willows-map": "willows-swede",
  "willows-pipe": "willows-swede",
};
const DECREE = "greek-decree",
  WRIT = "greek-creon-writ";
const TOKEN = "greek-household-token",
  ISMENE = "greek-ismene",
  REQUEST = `quest:${ISMENE}:${TOKEN}`;
const sanctuary = () => {
  const world = greekStart({ full: true });
  const here = "greek-sanctuary";
  world.actors.vale.place = here;
  world.actors.vale.visited.push(here);
  const t = traveler(world).take(TOKEN);
  t.s.actors.moth.place = here;
  return t;
};
const knows = (w, actor, book) =>
  claimsIn(book).every((c) => w.knowledge.known[actor]?.[c.id]?.kind === "read");
const meeting = (place) => {
  const w = createWorld();
  for (const id of ["pond-greek-harbor", "pond-willows-landing"]) w.crossings[id].discovered = true;
  w.actors.vale.place = place;
  return w;
};
const wait = (w) =>
  play(w, legalActions(w).find((a) => a.kind === "wait" && !a.sleep)).state;

describe("text items that teach what they say", () => {
  it("have an author of their pack and one to three claims", () => {
    for (const [book, author] of Object.entries(AUTHORS)) {
      const claims = claimsIn(book);
      expect(claims.length, book).toBeGreaterThan(0);
      expect(claims.every((c) => c.author === author), book).toBe(true);
    }
    expect(claimsIn("greek-helen-accounts").map((c) => c.claim)).toEqual(["egypt", "troy"]);
    expect(claimsIn("greek-atreid-record")).toHaveLength(3);
    expect(claimsIn("hoppycat-loop-token")).toEqual([]);
  });

  it("give a reader of Helen's tablet both accounts, each told as the Bard's from it", () => {
    let w = createWorld({ packScopes: { "greek-drama": "full" } });
    w.crossings["pond-greek-harbor"].discovered = true;
    w.actors.vale.place = "greek-harbor";
    w.items["greek-helen-accounts"].holder = "vale";
    w = play(w, legalActions(w).find((a) => a.kind === "read" && a.item === "greek-helen-accounts")).state;
    const facts = narrativeContext(w).entities.find((e) => e.id === "vale").facts;
    for (const { text } of claimsIn("greek-helen-accounts"))
      expect(facts).toContain(`I read this just now in Helen’s Account Tablet, by The Bard: ${text}`);
  });

  it("are read by the residents who hold them, one a turn, and stay in hand", () => {
    let w = meeting("greek-gate");
    w = wait(w);
    expect(knows(w, "greek-guard", DECREE)).toBe(true);
    w.actors.vale.place = "willows-camp";
    w = wait(wait(w));
    for (const book of ["willows-map", "willows-pipe"])
      expect(knows(w, "willows-swede", book), book).toBe(true);
    expect(w.items[DECREE].holder).toBe("greek-guard");
    expect(knows(w, "vale", DECREE)).toBe(false);
  });

  it("turns Ismene's request face up only for the token's reader", () => {
    const t = sanctuary();
    const seen = t.s.eventSeq;
    expect(tableQuest(t.s, "vale", ISMENE).quest).toBeNull();
    t.act("read", { item: TOKEN });
    const entry = t.s.log.find((e) => e.verb === "read" && e.itemId === TOKEN);
    expect(entry.witnesses).toContain("moth");
    expect(t.s.knowledge.known.moth?.[REQUEST]).toBeUndefined();
    expect(t.s.knowledge.known.vale[REQUEST]).toMatchObject({
      kind: "read",
      book: TOKEN,
      teller: null,
      eventSeq: entry.seq,
    });
    expect(t.s.actors.vale.told ?? []).not.toContain(ISMENE);
    expect(readPage(t.s, "vale", seen).claims).toContainEqual(expect.stringMatching(/^Ismene asks you/u));
    expect(readPage(t.s, "moth", seen)).toBeNull();
    expect(knowledgeFacts(t.s, "vale", nameOf, [REQUEST])[0]).toMatch(/Household Token: Ismene wants/u);
    const wrongBook = structuredClone(t.s);
    wrongBook.knowledge.known.vale[REQUEST].book = WRIT;
    expect(() => validateWorld(wrongBook)).toThrow(expect.objectContaining({ check: "knowledge" }));
    expect(tableQuest(t.s, "vale", ISMENE).quest).toMatchObject({
      target: TOKEN,
      step: { verb: "give", to: ISMENE },
    });
    expect(tableQuest(t.s, "moth", ISMENE).quest).toBeNull();
    t.give(TOKEN, ISMENE);
    expect(t.s.log).toContainEqual(expect.objectContaining({
      verb: "want_met",
      actorId: "vale",
      ownerId: ISMENE,
    }));
  });

  it("still shows the token's written claim when Ismene wants something else", () => {
    const t = sanctuary();
    t.s.actors[ISMENE].want = newWant("person", "greek-theseus", t.s.turn);
    const seen = t.s.eventSeq;
    t.act("read", { item: TOKEN });
    expect(t.s.knowledge.known.vale[REQUEST]).toBeUndefined();
    expect(readPage(t.s, "vale", seen).claims).toEqual(claimsIn(TOKEN).map((c) => c.text));
  });

  it("replays the Read in shared play", () => {
    const run = (request) => dispatchShared(structuredClone(request));
    const started = run({ op: "create", save: encodeSave(sanctuary().s) });
    expect(started.ok, started.error).toBe(true);
    const read = started.actions.find((a) => a.kind === "read" && a.item === TOKEN);
    const request = { op: "play", world: started.world, actor: "vale", action: read.key };
    const played = run(request);
    expect(played.ok, played.error).toBe(true);
    expect(played.world.knowledge.known.vale[REQUEST]).toMatchObject({ kind: "read", book: TOKEN });
    expect(run(request).world).toEqual(played.world);
  });

  it("load from an older save, locally and shared, for their holders to read", () => {
    const played = wait(meeting("greek-gate"));
    played.items[WRIT].holder = "vale";
    const older = (world) => {
      const s = structuredClone(world);
      s.knowledge.facts[claimsIn(DECREE)[0].id].text = "The gate stays shut to the household.";
      s.packs["greek-drama"].revision -= 1;
      return s;
    };
    const shared = dispatchShared({ op: "create", save: encodeSave(played) }).world;
    for (const world of [
      decodeSave(JSON.stringify(older(played))),
      dispatchShared({ op: "upgrade", from: "full-card-world/198", world: older(shared) }).world,
    ]) {
      expect(world.knowledge.facts[claimsIn(DECREE)[0].id].text).toBe(claimsIn(DECREE)[0].text);
      expect(world.items[DECREE].holder).toBe("greek-guard");
      expect(world.packs["greek-drama"].revision).toBe(packDefinition("greek-drama").revision);
      const read = legalActions(world, "vale").find((a) => a.kind === "read" && a.item === WRIT);
      expect(knows(play(world, read).state, "vale", WRIT)).toBe(true);
    }
  });
});
