import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { bookProblems } from "../v2/card-game/book-schema.mjs";
import { claimsIn } from "../v2/card-game/claims.mjs";
import { readPage } from "../v2/card-game/read-view.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

const ACCOUNT = "greek-burial-account";
const RITES = ["Funeral Oil", "Black cloth", "Burial Shovel"].map(
  (thing) => `Vale gives the ${thing} to Antigone at Polynices' Hollow.`,
);
const { buried } = funeralJourney();
const holding = (world, book) => {
  const w = structuredClone(world);
  w.items[book].holder = "vale";
  return w;
};
const read = (w, book) =>
  play(w, legalActions(w).find((a) => a.kind === "read" && a.item === book)).state;
const record = (w, pack, ...choices) => {
  for (const [n, choice] of choices.entries())
    w.packs[pack].receipts[choice] = w.turn + n;
  return w;
};

describe("a record book", () => {
  it("writes the Burial Account from the burial, by Antigone", () => {
    expect(claimsIn(ACCOUNT, createWorld())).toEqual([]);
    expect(claimsIn(ACCOUNT, buried).map((c) => [c.text, c.author])).toEqual(
      RITES.map((text) => [text, "greek-antigone"]),
    );
    const w = decodeSave(encodeSave(read(holding(buried, ACCOUNT), ACCOUNT)));
    expect(readPage(w, "vale", 0)).toMatchObject({ author: "Antigone", claims: RITES });
    const later = structuredClone(w);
    later.log = [];
    const kept = decodeSave(encodeSave(later));
    expect(claimsIn(ACCOUNT, kept)[0].text).toMatch(/^An earlier traveler gives/);
    expect(claimsIn(ACCOUNT, kept).map((c) => kept.knowledge.facts[c.id].text)).toEqual(RITES);
  });

  it("writes Hoppy Cat's labels and a witness tablet's delivery as they happen", () => {
    const w = record(createWorld(), "hoppycat-archive", "hoppycat-table-invitation", "hoppycat-table-signal", "hoppycat-table-credit");
    const written = (book) => claimsIn(book, w).map((c) => [c.text, c.author]);
    expect(written("hoppycat-return-path-checklist")).toEqual([
      ["Static writes an Invitation Home for the traveller.", "hoppycat-staticwashere"],
      ["Static signs the Invitation Home and lays it on the bench.", "hoppycat-staticwashere"],
    ]);
    expect(written("hoppycat-provenance-card")).toEqual([
      ["Penny writes Ledger's name beside the display.", "hoppycat-penny-vellum"],
    ]);
    const tablet = "greek-egypt-testimony";
    expect(claimsIn(tablet, w)).toHaveLength(1);
    record(w, "greek-drama", "greek-helen-egypt-passage");
    expect(claimsIn(tablet, w)[1].text).toBe(
      "An earlier traveler gives The Egyptian Witness Tablet to Menelaus at Proteus's Tomb in Egypt.",
    );
  });

  it("is checked against what its book records, and forgets a record its book drops", () => {
    const w = read(holding(buried, ACCOUNT), ACCOUNT);
    const id = claimsIn(ACCOUNT, w)[0].id;
    const forged = structuredClone(w);
    forged.knowledge.facts[id].source.claim = "greek-hear-decree";
    expect(() => validateWorld(forged)).toThrow(expect.objectContaining({ check: "knowledge" }));
    const copied = structuredClone(w);
    copied.knowledge.facts[`${id}:again`] = { ...copied.knowledge.facts[id], id: `${id}:again` };
    expect(() => validateWorld(copied)).toThrow(expect.objectContaining({ check: "knowledge" }));
    const saved = encodeSave(w);
    const account = packDefinition("greek-drama").items[ACCOUNT];
    const records = account.records;
    account.records = records.slice(1);
    try {
      const loaded = decodeSave(saved);
      expect(loaded.knowledge.facts[id]).toBeUndefined();
      expect(loaded.knowledge.known.vale[id]).toBeUndefined();
      expect(Object.keys(loaded.knowledge.known.vale).filter((f) => f.includes(ACCOUNT))).toHaveLength(2);
    } finally {
      account.records = records;
    }
  });

  it("loads a rules 198 world holding the account, locally and shared, for its holder to read", () => {
    const shared = dispatchShared({ op: "create", save: encodeSave(buried) }).world;
    for (const world of [
      decodeSave(encodeSave(holding(buried, ACCOUNT))),
      dispatchShared({ op: "upgrade", from: "full-card-world/198", world: holding(shared, ACCOUNT) }).world,
    ]) {
      expect(world.items[ACCOUNT].holder).toBe("vale");
      const w = read(world, ACCOUNT);
      expect(claimsIn(ACCOUNT, w).every((c) => w.knowledge.known.vale[c.id]?.kind === "read")).toBe(true);
    }
  });
});

describe("the book schema for records", () => {
  const pack = (book) => ({
    id: "sample",
    places: { hall: { name: "The Hall" } },
    avatars: { scribe: { name: "The Scribe" } },
    items: { book: { name: "A Book", holder: "hall", author: "scribe", ...book } },
  });
  it("takes an author and the choices a book records, with or without claims", () => {
    const claim = { id: "visit", text: "The hall is old." };
    expect(bookProblems(pack({ records: ["visit"] }))).toEqual([]);
    expect(bookProblems(pack({ records: ["meet"], claims: [claim] }))).toEqual([]);
    expect(bookProblems(pack({ records: ["meet", "rest", "leave"], claims: [claim] }))).not.toEqual([]);
    expect(bookProblems(pack({ records: ["visit"], claims: [claim] }))).not.toEqual([]);
    expect(bookProblems(pack({ records: ["visit"], claims: [] }))).not.toEqual([]);
  });
});
