import assert from "node:assert/strict";
import test from "node:test";
import { sceneryActsWithIntent, writingRegisterErrors } from "./writing-register.mjs";

test("checks character notes, card blurbs, quest memories, and scenery fields", () => {
  const cases = [
    ["actors", { attachments: [{ reason: "The cottage learned to welcome guests." }] }],
    ["cards", { blurb: "The kettle remembers every argument." }],
    ["locations", { persona: "The circle listens as if each guest were royalty." }],
    ["jobs", { narrated_thresholds: [{ text: "The line seems to carry weight." }] }],
    ["fronts", { premise: "The road wants a keeper." }],
    ["clocks", { presentation: { completion_memory: "The cave learned to distrust every promise." } }],
  ];
  for (const [collection, row] of cases) {
    const errors = writingRegisterErrors({ [collection]: [{ id: "fixture", ...row }] });
    assert.equal(errors.length, 1, `${collection}: ${errors}`);
    assert.match(errors[0], new RegExp(`^${collection}\\.json row fixture `));
  }
  for (const field of ["description", "look", "search", "persona", "memory", "text"]) {
    assert.equal(writingRegisterErrors({ room_features: [{ [field]: "The charm is pleased." }] }).length, 1);
  }
});

test("lyric sentences keep direct address and imagery while rejecting hedging", () => {
  assert.deepEqual(writingRegisterErrors({ sentences: [
    { text: "You remember a door meant for the rain." },
    { text: "The clouds remember your footsteps." },
  ] }), []);
  for (const text of ["You stand as if the rain knew you.", "The rain seems to follow you."]) {
    assert.equal(writingRegisterErrors({ sentences: [{ text }] }).length, 1);
  }
});

test("keeps personal agency, character address, and instructions in their own fields", () => {
  assert.deepEqual(writingRegisterErrors({
    actors: [{ description: "Elsie remembers your boots.", persona: "You keep the kettle warm." }],
    cards: [{ blurb: "I remember the kettle, and I want it back." }],
    locations: [{ description: "The path is steep and the stones are wet.", memory: ["Elsie welcomed the guest."] }],
    room_features: [{ uses: [{ text: "The charm cools in your palm." }] }],
    jobs: [{ narration_key: "you.remember", id: "as if" }],
  }), []);
  assert.equal(sceneryActsWithIntent("I found the cottage. Remember the key."), false);
  assert.equal(sceneryActsWithIntent("These hills recruit me."), true);
  assert.equal(writingRegisterErrors({ locations: [{ description: "You enter the cottage." }] }).length, 1);
});
