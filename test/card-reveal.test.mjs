import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REVEAL_TIERS, flashRate, revealPlan } from "../v2/card-game/card-reveal.mjs";

describe("covered card reveal", () => {
  it("grows richer from common to legendary within 900 ms", () => {
    const plans = REVEAL_TIERS.map((tier) => revealPlan(tier));
    expect(REVEAL_TIERS).toEqual(["common", "uncommon", "rare", "epic", "legendary"]);
    for (const [a, b] of plans.slice(1).map((plan, i) => [plans[i], plan])) {
      expect(b.ms).toBeGreaterThan(a.ms);
      expect(b.lift).toBeGreaterThanOrEqual(a.lift);
      expect(b.glow).toBeGreaterThan(a.glow);
    }
    expect(plans.at(-1).ms).toBeLessThanOrEqual(900);
    expect(plans[0]).toMatchObject({ pulses: 0, lift: 0, sheen: false });
    expect(plans.at(-1)).toMatchObject({ pulses: 2, sheen: true });
  });

  it("stays under three flashes a second", () => {
    for (const tier of REVEAL_TIERS)
      for (const scares of [true, false])
        expect(flashRate(revealPlan(tier, { scares }))).toBeLessThan(3);
  });

  it("keeps the glow soft when flashes are off", () => {
    const plan = revealPlan("legendary", { scares: false });
    expect(plan).toMatchObject({ sheen: false, pulses: 1 });
    expect(plan.glow).toBeLessThanOrEqual(12);
  });

  it("crossfades without movement under reduced motion", () => {
    for (const tier of REVEAL_TIERS)
      expect(revealPlan(tier, { reduced: true })).toMatchObject({
        crossfade: true, lift: 0, pulses: 0, sheen: false, glow: 0,
      });
  });

  it("treats an unknown tier as common", () => {
    expect(revealPlan("mythic")).toEqual({ ...revealPlan("common"), tier: "mythic" });
  });

  it("glows a covered card with a slow breath and no label", () => {
    const css = readFileSync(new URL("../v2/card-game/card-tiers.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/New card/);
    const [, half] = css.match(/animation: covered-breathe ([\d.]+)s ease-in-out infinite alternate/);
    expect(Number(half) * 2).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^@]*\.covered-glow \{\s*animation: none/);
    expect(css).toMatch(/\.covered-glow\[data-glow="still"\] \{\s*animation: none/);
    const alphas = [...css.matchAll(/--glow-alpha: (\d+)%/g)].map(([, a]) => Number(a));
    expect(alphas).toEqual([...alphas].sort((a, b) => a - b));
    expect(Math.max(...alphas)).toBeLessThanOrEqual(50);
  });
});
