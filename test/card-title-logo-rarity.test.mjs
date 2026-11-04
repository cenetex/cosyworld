import { test } from "vitest";
import assert from "node:assert/strict";
import { RARITY_WEIGHTS } from "../v2/card-game/pack-specials.mjs";
import { tiers } from "../v2/card-game/level-tiers.mjs";
import { LOGOS, chooseLogo, logoWeight } from "../v2/card-game/title-logo.mjs";

const bySrc = (src) => LOGOS.findIndex((logo) => logo.src === src);
const draw = (logos, count = 10_000) => {
  const hits = logos.map(() => 0);
  for (let i = 0; i < count; i++)
    hits[chooseLogo(`world:seed-${i}`, {}, logos)]++;
  return hits.map((hit) => (hit / count) * 100);
};

test("every logo carries a game tier id and the owner's tiers", () => {
  const ids = new Set(tiers.map(({ id }) => id));
  for (const logo of LOGOS) assert.ok(ids.has(logo.rarity), logo.src);
  const rarity = (file) => LOGOS[bySrc(`assets/title/${file}.webp`)].rarity;
  assert.equal(rarity("lonely-forest-1"), "epic");
  assert.equal(rarity("lonely-forest-2"), "uncommon");
  assert.equal(rarity("lonely-forest-hearth-and-oak"), "common");
  assert.equal(rarity("lonely-forest-listening-wood"), "common");
  assert.equal(rarity("lonely-forest-black-pond"), "rare");
});

test("the draw is seeded by the world and weighted like the card tiers", () => {
  for (let i = 0; i < 50; i++)
    assert.equal(chooseLogo(`world:w${i}`), chooseLogo(`world:w${i}`));
  const total = LOGOS.reduce((sum, logo) => sum + logoWeight(logo), 0);
  const odds = draw(LOGOS);
  LOGOS.forEach((logo, index) => {
    const expected = (RARITY_WEIGHTS[logo.rarity] / total) * 100;
    assert.ok(
      Math.abs(odds[index] - expected) <= 1.5,
      `${logo.src}: ${odds[index].toFixed(1)}% vs ${expected.toFixed(1)}%`,
    );
  });
});

test("legendary and retired logos are never drawn but remembered picks stay", () => {
  const logos = [
    { ...LOGOS[0], rarity: "legendary" },
    { ...LOGOS[1], retired: true },
    ...LOGOS.slice(2),
  ];
  const odds = draw(logos, 2_000);
  assert.equal(odds[0], 0);
  assert.equal(odds[1], 0);
  for (let i = 0; i < 500; i++) {
    const key = `world:avoid-${i}`;
    const index = chooseLogo(key, {}, logos);
    const next = chooseLogo(key, { last: index }, logos);
    assert.ok(next > 1 && next !== index, `${key} walked to ${next}`);
  }
  assert.equal(
    chooseLogo("world:old", { worlds: { "world:old": 1 } }, logos),
    1,
  );
  assert.equal(logoWeight({ rarity: "toString" }), 0);
});
