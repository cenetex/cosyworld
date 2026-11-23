import { expect, it } from "vitest";
import { readPage } from "../v2/card-game/read-view.mjs";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";

const BOOK = "willows-notebook";
const book = packDefinition("willows").items[BOOK];

it("shows a book's claims on its pages once, on the turn its reader read it", () => {
  let w = createWorld();
  w.items[BOOK].holder = "vale";
  const seen = w.eventSeq ?? 0;
  const next = (kind) => play(w, legalActions(w).find((a) => a.kind === kind));
  expect(readPage(w, "vale", seen)).toBeNull();
  w = next("read").state;
  expect(readPage(w, "vale", seen)).toEqual({
    seq: expect.any(Number),
    book: BOOK,
    title: "The River Notebook",
    author: "The Swede",
    claims: book.claims.map((claim) => claim.text),
    pages: [1, 2, 3].map((n) => `assets/willows/notebook-page-${n}.png`),
  });
  expect(readPage(w, "moth", seen)).toBeNull();
  expect(readPage(w, "vale", w.eventSeq)).toBeNull();
  w = next("wait").state;
  expect(readPage(w, "vale", seen)).toBeNull();
});
