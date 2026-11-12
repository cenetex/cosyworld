import { describe, it, expect } from "vitest";
import { compare } from "../v2/scripts/equivalence.mjs";

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
