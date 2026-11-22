import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { audit, lowered } from "../scripts/check-line-ceilings.mjs";

const budget = JSON.parse(readFileSync("scripts/change-budget.json", "utf8"));
const config = { threshold: 100, ceilings: { "a.mjs": 200, "b.rs": 150 } };
const run = (sizes, { files = Object.keys(sizes), changed = null } = {}) =>
  audit({
    config,
    budget,
    files,
    count: (file) => sizes[file] ?? null,
    changed,
  });

describe("line ceilings", () => {
  it("passes files at or under their ceilings and small unlisted files", () => {
    expect(run({ "a.mjs": 200, "b.rs": 150, "c.mjs": 100 })).toEqual({
      errors: [],
      notes: [],
    });
  });

  it("fails a listed file that grows past its ceiling", () => {
    const { errors } = run({ "a.mjs": 201, "b.rs": 150 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^a\.mjs grew from 200 to 201 lines/u);
  });

  it("fails an unlisted code file over the threshold, but not a generated one", () => {
    const { errors } = run({
      "a.mjs": 200,
      "b.rs": 150,
      "c.css": 101,
      "notes.md": 500,
      "v2/orchestrator-rust/src/card_shared/engine-v999.js": 5000,
    });
    expect(errors).toEqual([
      expect.stringMatching(
        /^c\.css has 101 lines, over the 100-line threshold/u,
      ),
    ]);
  });

  it("makes a pull request that shrinks a file lower its ceiling, and only notes others", () => {
    const sizes = { "a.mjs": 180, "b.rs": 140 };
    const { errors, notes } = run(sizes, { changed: new Set(["a.mjs"]) });
    expect(errors).toEqual([
      expect.stringMatching(/^a\.mjs shrank from 200 to 180 lines/u),
    ]);
    expect(notes).toEqual([
      expect.stringMatching(/^b\.rs shrank from 150 to 140 lines/u),
    ]);
    expect(run(sizes).errors).toEqual([]);
  });

  it("drops a deleted file's ceiling and never raises one when lowering", () => {
    expect(
      run({ "a.mjs": 200 }, { changed: new Set(["b.rs"]) }).errors,
    ).toEqual([expect.stringMatching(/^b\.rs is gone/u)]);
    expect(
      lowered(config, (file) => ({ "a.mjs": 250 })[file] ?? null).ceilings,
    ).toEqual({ "a.mjs": 200 });
    expect(
      lowered(config, (file) => ({ "a.mjs": 120, "b.rs": 150 })[file]).ceilings,
    ).toEqual({
      "a.mjs": 120,
      "b.rs": 150,
    });
  });
});
