import { setImmediate as yieldToRunner } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  plan,
  validateWorld,
} from "../v2/card-game/world.mjs";

// The long soak has its own file so CI can run it beside the other card tests.
describe("the reflected shore card game", () => {
  it("preserves unique objects and valid state across 4000 varied turns", async () => {
    let seed = 109,
      s = createWorld();
    const itemIds = Object.keys(s.items).sort();
    for (let i = 0; i < 4000; i++) {
      // Keep progress messages flowing during the bounded simulation.
      if (i % 100 === 0) await yieldToRunner();
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const actions = legalActions(s);
      const action =
        i % 5 === 0 ? plan(s).action : actions[seed % actions.length];
      const result = play(s, action);
      expect(result.ok).toBe(true);
      s = result.state;
      expect(() => validateWorld(s)).not.toThrow();
      expect(Object.keys(s.items).sort()).toEqual(itemIds);
      if (i % 97 === 0) {
        s = decodeSave(encodeSave(s));
      }
    }
    expect(s.turn).toBe(4000);
  }, 120_000);
});
