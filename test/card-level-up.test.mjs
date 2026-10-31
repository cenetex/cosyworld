import { describe, expect, it } from "vitest";
import { LEVEL_UP_MS, levelUpPlan } from "../v2/card-game/card-level-up.mjs";
import { levelTier } from "../v2/card-game/rarity.mjs";

describe("card level-up", () => {
  it("plays only when a level rises", () => {
    expect(levelUpPlan(3, 3)).toBeNull();
    expect(levelUpPlan(4, 3)).toBeNull();
    expect(levelUpPlan(undefined, 3)).toBeNull();
    expect(levelUpPlan(2, 3)).toMatchObject({
      from: { numeral: "II" },
      to: { numeral: "III" },
    });
  });

  it("shifts the glow from the old tier colour to the new one", () => {
    const plan = levelUpPlan(9, 10);
    expect(plan.from.color).toBe(levelTier(9).color);
    expect(plan.to.color).toBe(levelTier(10).color);
    expect(plan.from.color).not.toBe(plan.to.color);
    expect(plan.lift).toBeGreaterThan(levelUpPlan(2, 3).lift);
  });

  it("stays brief and subtle", () => {
    expect(LEVEL_UP_MS).toBeLessThanOrEqual(1200);
    for (const [a, b] of [
      [1, 2],
      [9, 10],
      [49, 50],
    ])
      expect(levelUpPlan(a, b).lift).toBeLessThanOrEqual(8);
  });

  it("shows the end state at once under reduced motion", () => {
    expect(levelUpPlan(2, 3, { reduced: true })).toBeNull();
  });
});
