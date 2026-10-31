import { describe, expect, it } from "vitest";
import {
  classify,
  evaluate,
  loadConfig,
  measure,
  parseNumstat,
} from "../scripts/check-change-budget.mjs";

const config = loadConfig();
const numstat = (rows) =>
  rows.map(([a, d, f]) => `${a}\t${d}\t${f}\0`).join("");
const run = (rows, env = {}) =>
  evaluate(measure(parseNumstat(numstat(rows)), config), config, env);

describe("change budget", () => {
  it("passes and reports the count under budget", () => {
    const result = run([
      [120, 30, "v2/card-game/world.mjs"],
      [40, 0, "test/card-game.test.mjs"],
    ]);
    expect(result.ok).toBe(true);
    expect(result.lines[0]).toContain("190/400");
  });

  it("fails over budget and names the largest files", () => {
    const result = run([
      [300, 50, "v2/card-game/app.mjs"],
      [60, 0, "v2/card-game/style.css"],
    ]);
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toMatch(
      /Over budget by 10 lines\. Split this branch/,
    );
    expect(result.lines.join("\n")).toContain("350\tv2/card-game/app.mjs");
  });

  it("passes an images-only branch", () => {
    const result = run([
      ["-", "-", "v2/card-game/assets/attic/lamp.webp"],
      [5000, 0, "public/art/forest.svg"],
      [900, 0, "v2/card-game/assets/greek-drama/art-provenance.json"],
    ]);
    expect(result.ok).toBe(true);
    expect(result.lines[0]).toContain("0/400");
    expect(result.lines[0]).toContain("binary 0, assets 5900");
  });

  it("passes a generated-only branch", () => {
    const result = run([
      [17000, 200, "v2/card-game/packs.json"],
      [8000, 10, "v2/orchestrator-rust/src/card_assets.rs"],
      [26000, 0, "v2/orchestrator-rust/src/card_shared/engine-v58.js"],
      [3000, 3000, "package-lock.json"],
    ]);
    expect(result.ok).toBe(true);
    expect(result.lines[0]).toMatch(/^\[change-budget\] 0\/400/);
  });

  it("allows an explicit override with a warning", () => {
    const rows = [[900, 0, "v2/card-game/world.mjs"]];
    const local = run(rows, { COSYWORLD_LARGE_CHANGE: "one atomic rename" });
    expect(local.ok).toBe(true);
    expect(local.lines[1]).toMatch(/WARNING: over budget.*one atomic rename/);
    const ci = run(rows, {
      COSYWORLD_PR_BODY: "## Summary\nLarge-Change: replay fixture swap\n",
    });
    expect(ci.ok).toBe(true);
    expect(run(rows, { COSYWORLD_PR_BODY: "Large-Change:   \n" }).ok).toBe(
      false,
    );
  });

  it("reads renames and keeps hand-written Rust counted", () => {
    const [entry] = parseNumstat("3\t1\t\0old/a.mjs\0new/a.mjs\0");
    expect(entry).toEqual({ file: "new/a.mjs", lines: 4, binary: false });
    expect(
      classify("v2/orchestrator-rust/src/card_shared/engine.rs", config),
    ).toBeNull();
    expect(classify("ART/Cover.PNG", config)).toBe("assets");
  });
});
