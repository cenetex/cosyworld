import assert from "node:assert/strict";
import test from "node:test";

import {
  actorPrompt,
  DEFAULT_LORA_SCALE,
  locationPrompt,
} from "./generate-holy-land-art.mjs";

const OLD_PROMPT_LABELS = [
  "Use case:",
  "Asset type:",
  "Primary request:",
  "Historical setting:",
  "Period constraint:",
  "Constraints:",
];

test("Holy Land actor art starts in medias res with a compact B43L prompt", () => {
  const prompt = actorPrompt(
    {
      display_name: "Simon Peter",
      title: "Fisherman Learning Steadiness",
      blurb: "Peter steps from the boat before certainty catches up.",
    },
    { description: "A Galilean fisherman." },
  );

  assert.equal(prompt.split("\n").length, 2);
  assert.match(prompt, /^B43L\. Rough unfinished watercolor;/);
  assert.match(prompt, /already mid-journey/);
  assert.match(prompt, /heavy pigment/);
  assert.match(prompt, /raw paper/);
  assert.doesNotMatch(prompt, /\bno\b/i);
  assert.ok(prompt.split(/\s+/).length < 55);
  for (const label of OLD_PROMPT_LABELS) assert.doesNotMatch(prompt, new RegExp(label));
});

test("Holy Land location art uses the same brief unfinished-watercolor direction", () => {
  const prompt = locationPrompt(
    {
      display_name: "Bethlehem",
      title: "Town of the Nativity",
      blurb: "Olive terraces gather around an unexpected arrival.",
    },
    { description: "Pale stone homes gather along a Judean ridge." },
  );

  assert.equal(prompt.split("\n").length, 2);
  assert.match(prompt, /^B43L\. Rough unfinished watercolor;/);
  assert.match(prompt, /Bethlehem, Town of the Nativity, already mid-journey/);
  assert.doesNotMatch(prompt, /\bno\b/i);
  assert.ok(prompt.split(/\s+/).length < 55);
  for (const label of OLD_PROMPT_LABELS) assert.doesNotMatch(prompt, new RegExp(label));
});

test("Holy Land generations give B43L more than neutral LoRA weight", () => {
  assert.equal(DEFAULT_LORA_SCALE, 1.25);
});

test("Holy Land sample runs can isolate one style phrase for A/B testing", () => {
  const prompt = actorPrompt(
    {
      display_name: "Simon Peter",
      title: "Fisherman Learning Steadiness",
      blurb: "Peter steps from the boat before certainty catches up.",
    },
    { description: "A Galilean fisherman." },
    "Half-painted wet watercolor study, raw paper.",
  );

  assert.match(prompt, /^B43L\. Half-painted wet watercolor study, raw paper\./);
  assert.doesNotMatch(prompt, /Rough unfinished watercolor/);
  assert.doesNotMatch(prompt, /\bno\b/i);
});
