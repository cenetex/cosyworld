import { describe, expect, it } from "vitest";
import {
  LEVEL_CAP,
  levelTier,
  rankOf,
  tiers,
  trackLevel,
} from "../v2/card-game/level-tiers.mjs";
import { levelFor, levelOf, rankXp, startXp } from "../v2/card-game/want.mjs";
import { createWorld } from "../v2/card-game/world.mjs";
import { packPeople } from "../v2/card-game/pack-registry.mjs";

describe("level bands on the 0-21 track", () => {
  it("round-trips every level through its rank", () => {
    for (let level = 0; level <= LEVEL_CAP; level++)
      expect(trackLevel(rankOf(level))).toBe(level);
  });

  it("keeps ranks one to five as the same level", () => {
    for (let rank = 1; rank <= 5; rank++) expect(trackLevel(rank)).toBe(rank);
  });

  it("starts each band at the old tier thresholds", () => {
    expect([10, 20, 30, 50, 100].map(trackLevel)).toEqual([6, 11, 15, 19, 21]);
    expect(
      [10, 20, 30, 50, 100].map((r) => levelTier(trackLevel(r)).id),
    ).toEqual(tiers.slice(1).map((tier) => tier.id));
    expect([9, 19, 29, 49, 99].map(trackLevel)).toEqual([5, 10, 14, 18, 20]);
  });

  it("reads the bands 0-5, 6-10, 11-14, 15-18, 19-20 and 21", () => {
    const bands = tiers.map((tier) =>
      Array.from({ length: LEVEL_CAP + 1 }, (_, level) => level).filter(
        (level) => levelTier(level) === tier,
      ),
    );
    expect(bands.map((b) => [b[0], b.at(-1)])).toEqual([
      [0, 5],
      [6, 10],
      [11, 14],
      [15, 18],
      [19, 20],
      [21, 21],
    ]);
  });

  it("caps at 21", () => {
    expect(LEVEL_CAP).toBe(21);
    for (const rank of [100, 144, 5050, 1e9]) expect(trackLevel(rank)).toBe(21);
    expect(rankOf(40)).toBe(rankOf(21));
  });

  it("starts a level-6 resident with the experience of rank ten", () => {
    const s = createWorld();
    const id = Object.keys(s.actors)
      .sort()
      .find((key) => packPeople[key]?.startLevel === 6);
    expect(id).toBeTruthy();
    expect(startXp(id)).toBe(rankXp(10));
    expect(s.actors[id].xp).toBe(rankXp(10));
    expect(levelFor(rankXp(10))).toBe(10);
    expect(levelOf(s, id)).toBe(6);
  });
});
