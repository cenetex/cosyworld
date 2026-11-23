import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  nameOf,
  play,
} from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { bookProblems } from "../v2/card-game/book-schema.mjs";
import { knowledgeFacts } from "../v2/card-game/knowledge.mjs";

const items = packDefinition("greek-drama").items;
const WRIT = "greek-creon-writ",
  DECREE = "greek-decree";
const claim = (book) => `claim:greek-drama:${book}:c0`;
const said = (book) => `${items[book].name} says the gate stays shut.`;
beforeEach(() => {
  for (const book of [WRIT, DECREE]) {
    items[book].author = "greek-creon";
    items[book].claims = [{ id: "c0", text: said(book) }];
  }
});
afterEach(() => {
  for (const book of [WRIT, DECREE])
    for (const key of ["author", "claims", "lifecycle"]) delete items[book][key];
});

const at = (holders) => {
  const w = createWorld();
  for (const a of ["moth", "keeper"]) w.actors[a].place = "station";
  for (const [book, holder] of Object.entries(holders))
    w.items[book].holder = holder;
  return w;
};
const offers = (w, item, actor) =>
  legalActions(w, actor)
    .filter((a) => a.item === item)
    .map((a) => a.kind);
const step = (w, test) => {
  const result = play(w, legalActions(w).find(test));
  expect(result.ok).toBe(true);
  return result.state;
};
const read = (w) => step(w, (a) => a.kind === "read");
const wait = (w) => step(w, (a) => a.kind === "wait" && !a.sleep);
const readers = (w) =>
  w.log
    .filter((e) => e.turn === w.turn && e.verb === "read")
    .map((e) => e.actorId);
const knows = (w, actor, id) => w.knowledge.known[actor]?.[id]?.kind;

describe("the read play", () => {
  it("teaches a held book's claims; others see only the reading", () => {
    let w = at({ [WRIT]: "vale" });
    expect(legalActions(w).find((a) => a.kind === "read")).toMatchObject({
      item: WRIT,
      label: "Read",
      text: "Vale reads Creon's Writ.",
    });
    w = decodeSave(encodeSave(read(w)));
    expect(knows(w, "vale", claim(WRIT))).toBe("read");
    expect(knows(w, "moth", claim(WRIT))).toBeUndefined();
    const news = Object.values(w.knowledge.facts).find(
      (f) => f.text === "Vale reads Creon's Writ.",
    );
    expect(knows(w, "moth", news.id)).toBe("witnessed");
    expect(w.items[WRIT].holder).toBe("vale");
    expect(offers(w, WRIT)).toContain("read");
  });

  it("lets a reader whose memory was reset read the book again", () => {
    let w = read(at({ [WRIT]: "vale" }));
    delete w.knowledge.known.vale;
    w = read(w);
    expect(knows(w, "vale", claim(WRIT))).toBe("read");
    expect(w.knowledge.facts[claim(WRIT)].source.witnesses).toEqual(["vale"]);
  });

  it("uses up a spent book once it is read", () => {
    items[WRIT].lifecycle = "spent";
    const w = read(at({ [WRIT]: "vale" }));
    expect(knows(w, "vale", claim(WRIT))).toBe("read");
    expect(w.usedUp).toContain(WRIT);
    expect(offers(w, WRIT)).toEqual([]);
  });

  it("lets one resident a turn read a book it holds, once", () => {
    let w = at({ [WRIT]: "moth", [DECREE]: "keeper" });
    const first = [];
    for (let turn = 0; turn < 3; turn++) {
      w = wait(w);
      first.push(readers(w));
    }
    expect(first.map((r) => r.length)).toEqual([1, 1, 0]);
    expect(new Set(first.flat())).toEqual(new Set(["moth", "keeper"]));
    expect(knows(w, "moth", claim(WRIT))).toBe("read");
    expect(knows(w, "keeper", claim(DECREE))).toBe("read");
    w = read(at({ [WRIT]: "vale", [DECREE]: "moth" }));
    expect(readers(w)).toEqual(["vale", "moth"]);
  });

  it("offers residents a claim book like any other thing", () => {
    const w = at({ [WRIT]: "moth", [DECREE]: "station" });
    expect(offers(w, WRIT, "moth")).toEqual(
      expect.arrayContaining(["read", "drop", "give"]),
    );
    expect(offers(w, DECREE, "moth")).toContain("take");
    expect(offers(w, WRIT, "keeper")).toContain("ask");
    w.items["greek-songbook"].holder = "station";
    expect(offers(w, "greek-songbook", "moth")).toEqual([]);
    expect(offers(w, "greek-songbook")).toContain("take");
  });
});

describe("a told claim", () => {
  it("drops its teller before the line would cut the claim", () => {
    const w = read(at({ [WRIT]: "vale" }));
    const text = `${"The gate stays shut ".repeat(8)}today.`;
    w.knowledge.facts[claim(WRIT)].text = text;
    const { eventSeq, learnedTurn } = w.knowledge.known.vale[claim(WRIT)];
    w.knowledge.known.moth = {
      [claim(WRIT)]: { kind: "heard", teller: "vale", eventSeq, learnedTurn },
    };
    const name = (id) => (id === "vale" ? "V".repeat(60) : nameOf(id));
    expect(knowledgeFacts(w, "moth", name)).toEqual([
      `I heard what Creon wrote: ${text}`,
    ]);
    expect(knowledgeFacts(w, "moth", nameOf)[0]).toMatch(/^Vale told me this/);
  });
});

describe("book schema", () => {
  const pack = (book) => ({
    id: "sample",
    places: { hall: { name: "The Hall" } },
    avatars: { scribe: { name: "The Scribe" } },
    items: { book: { name: "A Book", holder: "hall", ...book } },
  });
  const ok = { author: "scribe", claims: [{ id: "a", text: "The hall is old." }] };
  it("accepts a book with an author and one to three claims", () => {
    expect(bookProblems(pack(ok))).toEqual([]);
    expect(bookProblems(pack({ ...ok, lifecycle: "spent", author: "hall" }))).toEqual([]);
    expect(bookProblems(pack({}))).toEqual([]);
  });
  it("rejects books that cannot be read or told whole", () => {
    const claims = (n) =>
      Array.from({ length: n }, (_, i) => ({ id: `c${i}`, text: "The hall is old." }));
    const long = `${"The hall is very old ".repeat(8)}indeed.`;
    for (const book of [
      { claims: ok.claims },
      { ...ok, author: "nobody" },
      { ...ok, claims: [] },
      { ...ok, claims: claims(4) },
      { ...ok, claims: [ok.claims[0], ok.claims[0]] },
      { ...ok, claims: [{ id: "a", text: "Two. Sentences." }] },
      { ...ok, claims: [{ ...ok.claims[0], about: "elsewhere" }] },
      { ...ok, claims: [{ ...ok.claims[0], page: 1 }] },
      { ...ok, lifecycle: "fixed" },
      { ...ok, lore: [{ text: "A page." }] },
      { author: "scribe" },
    ])
      expect(bookProblems(pack(book))).not.toEqual([]);
    const named = pack({ ...ok, claims: [{ id: "a", text: long }] });
    expect(bookProblems(named)).toEqual([]);
    named.avatars.scribe.name = "S".repeat(60);
    expect(bookProblems(named)).toEqual([
      "sample: item book claims[0] is too long to tell whole with its author's name",
    ]);
  });
});

describe("a save from before a claim changed", () => {
  const older = (w) => {
    const s = JSON.parse(encodeSave(w));
    s.packs["greek-drama"].revision -= 1;
    return JSON.stringify(s);
  };
  it.each([
    ["an earlier", older],
    ["the same", encodeSave],
  ])("follows a reworded claim and a new author, and forgets a retired one, at %s pack revision", (_, save) => {
    const saved = save(read(at({ [WRIT]: "vale" })));
    items[WRIT].claims[0].text = "The gate opens only for the king.";
    items[WRIT].author = "greek-guard";
    const fact = decodeSave(saved).knowledge.facts[claim(WRIT)];
    expect(fact.text).toBe("The gate opens only for the king.");
    expect(fact.source.author).toBe("greek-guard");
    delete items[WRIT].claims;
    const w = decodeSave(saved);
    expect(w.knowledge.facts[claim(WRIT)]).toBeUndefined();
    expect(w.knowledge.known.vale[claim(WRIT)]).toBeUndefined();
  });
});
