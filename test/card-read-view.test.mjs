import { afterEach, beforeEach, expect, it } from "vitest";
import { readPage } from "../v2/card-game/read-view.mjs";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";

const writ = packDefinition("greek-drama").items["greek-creon-writ"];
const claims = ["The bearer may pass the gate.", "The king alone may open it."];
beforeEach(() => {
  writ.author = "greek-creon";
  writ.claims = claims.map((text, n) => ({ id: `c${n}`, text }));
});
afterEach(() => {
  delete writ.author;
  delete writ.claims;
});

it("shows a book's claims once, on the turn its reader read it", () => {
  let w = createWorld();
  w.items["greek-creon-writ"].holder = "vale";
  const seen = w.eventSeq ?? 0;
  const next = (kind) => play(w, legalActions(w).find((a) => a.kind === kind));
  expect(readPage(w, "vale", seen)).toBeNull();
  w = next("read").state;
  expect(readPage(w, "vale", seen)).toEqual({
    seq: expect.any(Number),
    title: "Creon's Writ",
    author: "Creon",
    claims,
  });
  expect(readPage(w, "moth", seen)).toBeNull();
  expect(readPage(w, "vale", w.eventSeq)).toBeNull();
  w = next("wait").state;
  expect(readPage(w, "vale", seen)).toBeNull();
});
