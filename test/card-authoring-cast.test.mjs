import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  sampleSource,
  nameKey,
  readCharacter,
  characterLabel,
  addDistinctCharacters,
} from "../v2/card-game/authoring-cast.mjs";

const book = Array.from(
  { length: 6000 },
  (_, i) => `Chapter ${i}. Vale meets Pip. 🌲\n\n`,
).join("");
const character = (name, aliases = []) => ({
  name,
  aliases,
  specialAbility: "The Lightbearer",
});
describe("authoring source draws", () => {
  it("covers six separate sections with reproducible bounded samples", () => {
    const samples = sampleSource(book, { seed: 42 });
    assert.equal(samples.length, 6);
    assert.deepEqual(sampleSource(book, { seed: 42 }), samples);
    assert.notDeepEqual(sampleSource(book, { seed: 43 }), samples);
    for (const [i, sample] of samples.entries()) {
      assert.equal(sample.section, i);
      assert.ok(sample.start >= Math.floor((book.length * i) / 6) - 1);
      assert.ok(sample.end <= Math.floor((book.length * (i + 1)) / 6));
      assert.ok(sample.text.length > 3500 && sample.text.length <= 6000);
      assert.equal(sample.text, book.slice(sample.start, sample.end));
      assert.ok(sample.text.isWellFormed());
    }
  });
  it("keeps a short source together and uses up to six sections", () => {
    assert.deepEqual(sampleSource("Vale meets Pip.", { seed: 0 }), [
      { section: 0, start: 0, end: 15, text: "Vale meets Pip." },
    ]);
    assert.equal(sampleSource("x".repeat(7000), { seed: 0 }).length, 2);
    const emoji = sampleSource("🌲".repeat(100000), {
      seed: 0,
      chunkSize: 601,
    });
    assert.ok(
      emoji.every((s) => s.text.length <= 601 && s.text.isWellFormed()),
    );
  });
  it("checks source size and draw parameters", () => {
    for (const source of [
      "\ud800",
      null,
      "",
      "  ",
      "é".repeat(4 * 1024 * 1024 + 1),
    ])
      assert.throws(() => sampleSource(source, { seed: 0 }));
    for (const seed of [undefined, -1, 0.5, 4294967296])
      assert.throws(() => sampleSource("A story", { seed }));
    assert.throws(() => sampleSource("A story", { seed: 0, chunkSize: 0 }));
  });
});
describe("authoring characters", () => {
  const sample = { section: 0, start: 0, end: 15, text: "Vale meets Pip." };
  const result = {
    name: " Vale ",
    specialAbility: "The Lightbearer",
    description: "A lantern keeper.",
    aliases: ["Válé"],
    evidence: "Vale",
  };
  it("keeps source evidence and forms the card label", () => {
    const value = readCharacter(result, sample);
    assert.equal(characterLabel(value), "Vale // The Lightbearer");
    assert.deepEqual(value.source, { section: 0, start: 0, end: 15 });
    assert.equal(value.name, "Vale");
    assert.throws(() => readCharacter({ ...result, evidence: "Ash" }, sample));
    assert.throws(() =>
      readCharacter({ ...result, name: "Ash", aliases: [] }, sample),
    );
    assert.throws(() =>
      readCharacter({ ...result, prompt: "override" }, sample),
    );
    assert.throws(() => readCharacter({ ...result, name: "🌲" }, sample));
    assert.throws(() => readCharacter({ ...result, aliases: [""] }, sample));
  });
  it("deduplicates normalized names and aliases while preserving kept art", () => {
    assert.equal(nameKey("ＶÁLE"), nameKey("Vale"));
    assert.equal(nameKey("O’Brien"), nameKey("O'BRIEN"));
    const kept = {
      ...character("Vale", ["The Keeper"]),
      portrait: "chosen.png",
      poses: ["happy.png"],
    };
    const proposals = [
      character("Válé"),
      character("Keeper", ["The Keeper"]),
      character("Pip"),
    ];
    const draw = addDistinctCharacters([kept], proposals);
    assert.equal(draw.characters[0].portrait, kept.portrait);
    assert.equal(draw.characters[0].poses, kept.poses);
    assert.deepEqual(
      draw.characters.map((c) => c.name),
      ["Vale", "Pip"],
    );
    assert.deepEqual(draw.rejected, proposals.slice(0, 2));
    assert.throws(() => addDistinctCharacters([kept, character("VALE")], []));
  });
  it("resolves alias chains across earlier and later proposals", () => {
    const draw = addDistinctCharacters(
      [],
      [
        character("Aragorn", ["Strider"]),
        character("Strider", ["Estel"]),
        character("Estel"),
      ],
    );
    assert.equal(draw.characters.length, 1);
    assert.ok(draw.characters[0].aliases.includes("Estel"));
    assert.equal(
      addDistinctCharacters(draw.characters, [character("Estel")]).characters
        .length,
      1,
    );
    const later = addDistinctCharacters(
      [],
      [
        character("Aragorn"),
        character("Strider"),
        character("Aragorn", ["Strider"]),
      ],
    );
    assert.equal(later.characters.length, 1);
  });
  it("fills six slots and returns excess or repeated proposals for retry", () => {
    const proposals = Array.from({ length: 9 }, (_, i) =>
      character(`Person ${i}`),
    );
    const draw = addDistinctCharacters([], proposals);
    assert.equal(draw.characters.length, 6);
    assert.deepEqual(draw.rejected, proposals.slice(6));
    assert.equal(proposals.length, 9);
    assert.equal(
      addDistinctCharacters([], [character("Vale"), character("VALE")])
        .characters.length,
      1,
    );
  });
});
