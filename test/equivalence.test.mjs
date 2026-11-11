import { describe, it, expect } from "vitest";
import { compare } from "../v2/scripts/equivalence.mjs";

// The current rules, compared against themselves. Until the world.mjs facade
// split (#1390) lands there is no second version; this proves the game is
// deterministic under a fixed seed and that the harness machinery runs.
const world = new URL("../v2/card-game/world.mjs", import.meta.url);

describe("equivalence harness (#1387)", () => {
  it(
    "plays the current rules deterministically (self-equivalence)",
    async () => {
      const reports = await compare(world, world, {
        seeds: [7, 42],
        steps: 200,
      });
      for (const r of reports) {
        expect(r.equal, `seed ${r.seed}`).toBe(true);
      }
    },
    120_000,
  );
});
