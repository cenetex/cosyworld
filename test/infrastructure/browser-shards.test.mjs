import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSource, planShards } from "../../scripts/plan-browser-shards.mjs";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const config = JSON.parse(read("scripts/browser-shards.json"));
const checks = Object.keys(config.checks);

describe("full-suite browser shards", () => {
  it("names an existing journey for every check", () => {
    for (const check of checks) {
      const { script } = checkSource(check);
      expect(
        existsSync(new URL(`../../${script}`, import.meta.url)),
        check,
      ).toBe(true);
    }
    expect(() => checkSource("rm -rf")).toThrow();
  });

  it("runs every check exactly once in shards no longer than the target", () => {
    const shards = planShards(config);
    expect(shards.flatMap((shard) => shard.checks).sort()).toEqual(
      [...checks].sort(),
    );
    for (const shard of shards)
      expect(
        shard.seconds <= config.targetSeconds || shard.checks.length === 1,
      ).toBe(true);
  });

  it("splits a journey only into every width it loops over", () => {
    const split = new Map();
    for (const check of checks) {
      const { script, width } = checkSource(check);
      if (width) split.set(script, [...(split.get(script) || []), width]);
    }
    for (const [script, widths] of split) {
      const source = read(script);
      const loop = source.match(/smokeWidths\(\[([\d, ]+)\]\)/);
      expect(loop, script).toBeTruthy();
      expect(widths.sort()).toEqual(loop[1].split(/,\s*/).sort());
      expect(checks).not.toContain(script.match(/([\w-]+)\.mjs$/)[1]);
    }
  });

  it("runs each journey that smoke-card-hand bundles", () => {
    const hand = read("v2/scripts/smoke-card-hand.mjs");
    const bundled = [...hand.matchAll(/"\.\/([\w-]+)\.mjs"/g)].map(
      ([, name]) => name,
    );
    expect(bundled.length).toBeGreaterThan(1);
    for (const name of bundled) expect(checks).toContain(name);
  });
});
