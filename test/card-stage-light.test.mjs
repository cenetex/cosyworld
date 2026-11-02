import { describe, expect, it } from "vitest";
import {
  GENTLE,
  hourOf,
  isNeutral,
  lightAt,
  lightPath,
  lightStyle,
  LIGHT_TINTS,
  nightness,
  placeLight,
} from "../v2/card-game/stage-light.mjs";
import { DAYLIGHT_TURNS, isNight } from "../v2/card-game/daylight.mjs";

describe("stage time of day", () => {
  it("reads the rules' 48-play day as game hours", () => {
    expect(hourOf(0)).toBe(6);
    expect(hourOf(12)).toBe(12);
    expect(hourOf(DAYLIGHT_TURNS)).toBe(18);
    expect(hourOf(36)).toBe(0);
    expect(hourOf(47)).toBe(5.5);
    expect(hourOf(48 * 3 + 12)).toBe(12);
    // The painted night (rules) always falls between 18:00 and 06:00.
    for (let turn = 0; turn < 96; turn += 1) {
      const hour = hourOf(turn);
      expect(isNight({ turn })).toBe(hour >= 18 || hour < 6);
    }
  });

  it("names eight periods and darkens toward midnight", () => {
    const periods = new Set(
      Array.from({ length: 96 }, (_, i) => lightAt(i / 4).period),
    );
    expect([...periods].sort()).toEqual(
      [
        "afternoon",
        "dawn",
        "dusk",
        "golden hour",
        "midnight",
        "morning",
        "night",
        "noon",
      ].sort(),
    );
    const noon = lightAt(12);
    expect(isNeutral(noon)).toBe(true);
    const golden = lightAt(17);
    expect(golden.shade[0]).toBeGreaterThan(golden.shade[2]);
    const midnight = lightAt(0);
    expect(midnight.light).toBeLessThan(lightAt(21).light);
    expect(midnight.vignette).toBeGreaterThan(0.5);
    expect(Math.max(...midnight.shade)).toBeLessThan(0.6);
  });

  it("changes smoothly between hours", () => {
    for (let h = 0; h < 24; h += 0.05) {
      const a = lightAt(h);
      const b = lightAt(h + 0.05);
      expect(Math.abs(a.light - b.light)).toBeLessThan(0.05);
      for (const i of [0, 1, 2])
        expect(Math.abs(a.shade[i] - b.shade[i])).toBeLessThan(0.08);
    }
  });

  it("keeps only a gentle share of the grade over a painted night", () => {
    const full = lightAt(0);
    const gentle = lightAt(0, GENTLE);
    expect(gentle.light).toBeCloseTo(1 - (1 - full.light) * GENTLE);
    expect(gentle.vignette).toBeCloseTo(full.vignette * GENTLE);
    expect(isNeutral(lightAt(0, 0))).toBe(true);
  });

  it("eases forward, sweeps a long rest and cuts going back", () => {
    expect(lightPath(10, 11)).toMatchObject({ from: 10, to: 11 });
    expect(lightPath(10, 11).duration).toBeGreaterThan(0);
    expect(lightPath(30, 48).duration).toBeGreaterThan(0);
    expect(lightPath(30, 2)).toMatchObject({ from: 2, duration: 0 });
    expect(lightPath(null, 5)).toMatchObject({ from: 5, duration: 0 });
    expect(lightPath(0, 200).duration).toBe(0);
  });

  it("writes the CSS grade", () => {
    expect(lightStyle(lightAt(12))).toEqual({
      "--tod-shade": "rgb(255 255 255)",
      "--tod-desat": "0",
      "--tod-vignette": "0",
      "--tod-figure": "brightness(1) saturate(1)",
      "--light-x": "0.5",
      "--light-y": "0.5",
      "--light-r": "0.3",
      "--light-on": "0",
    });
  });
});

describe("stage light pools", () => {
  it("lights pools only as the hour darkens", () => {
    expect(nightness(12)).toBe(0);
    expect(nightness(0)).toBeCloseTo(1);
    expect(nightness(19)).toBeGreaterThan(0);
  });

  it("keeps authored light conservative and in the painting", () => {
    expect(placeLight("forest-garden")).toEqual({ sky: 1 });
    expect(placeLight("nowhere")).toEqual({});
    expect(placeLight("attic").lights[0]).toMatchObject({ item: "lamp" });
    for (const id of ["attic", "forest-cottage"])
      for (const pool of placeLight(id).lights) {
        expect(pool.x).toBeGreaterThanOrEqual(0);
        expect(pool.x).toBeLessThanOrEqual(100);
        expect(LIGHT_TINTS[pool.tint]).toBeDefined();
      }
  });
});
