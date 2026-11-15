import test from "node:test";
import assert from "node:assert/strict";
import { beats, pause, repeatsOpening } from "../src/beats.mjs";

const LONG =
  "The kettle is on and the cups are by the window. The door sticks in the rain, so lean on it. " +
  "Come and sit by the warm fire when you are all in.";

test("a long line splits at sentence ends into at most three beats", () => {
  assert.deepEqual(beats("Come in. Sit down."), ["Come in. Sit down."]);
  const parts = beats(LONG);
  assert.equal(parts.length, 3);
  assert.equal(parts.join(" "), LONG);
  assert.ok(parts.every((part) => /[.!?]$/.test(part)));
  assert.equal(beats(`${LONG} ${LONG}`).length, 3);
  assert.deepEqual(beats("a".repeat(200)), ["a".repeat(200)]);
});

test("pauses scale with length and stay between one and four seconds", () => {
  assert.equal(pause("Hi."), 1000);
  assert.equal(pause("a".repeat(60)), 2100);
  assert.equal(pause("a".repeat(500)), 4000);
});

test("a repeated opening matches the first words of the resident's last five lines", () => {
  const ring = [
    { resident: "rati", text: "Oh, the kettle is on." },
    { resident: "skull", text: "Well I never did." },
  ];
  assert.ok(repeatsOpening(ring, "rati", "Oh the kettle is cold now."));
  assert.ok(!repeatsOpening(ring, "rati", "Well I never did."));
  assert.ok(!repeatsOpening(ring, "rati", "Oh, the."));
  const old = [{ resident: "rati", text: "Oh the kettle is on." }, ...Array(5).fill({ resident: "rati", text: "Something else here." })];
  assert.ok(!repeatsOpening(old, "rati", "Oh the kettle again."));
});
