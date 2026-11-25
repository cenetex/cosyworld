import { afterEach, expect, it, vi } from "vitest";
import {
  TEST_SEED_KEY,
  createLandingWorld,
  newRunSeed,
} from "../v2/card-game/pack-landing.mjs";

const browser = (webdriver, value) => {
  vi.stubGlobal("navigator", { webdriver });
  vi.stubGlobal("localStorage", {
    getItem: (key) => (key === TEST_SEED_KEY ? value : null),
  });
};
const draws = () => new Set(Array.from({ length: 8 }, () => newRunSeed()));
afterEach(() => vi.unstubAllGlobals());

it("lets an automated browser pin a new world's run seed", () => {
  browser(true, "17");
  expect(newRunSeed()).toBe(17);
  expect(createLandingWorld().run.seed).toBe(17);
  browser(true, "4294967295");
  expect(newRunSeed()).toBe(4294967295);
});

it("never pins a player's world", () => {
  browser(false, "17");
  expect(draws().size).toBeGreaterThan(1);
  browser(undefined, "17");
  expect(draws().size).toBeGreaterThan(1);
});

it("draws at random when the pin is missing, malformed or unreadable", () => {
  for (const value of [null, "", "seed", "-1", "1.5", "4294967296"]) {
    browser(true, value);
    expect(draws().size, String(value)).toBeGreaterThan(1);
  }
  vi.stubGlobal("navigator", { webdriver: true });
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new DOMException("Blocked", "SecurityError");
    },
  });
  expect(draws().size).toBeGreaterThan(1);
});
