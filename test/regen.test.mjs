import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATED_FILES, classify, steps } from "../scripts/regen.mjs";

const read = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const scripts = JSON.parse(read("package.json")).scripts;

describe("regen", () => {
  it("sorts files into rebuilt outputs, rules wiring and real work", () => {
    expect(classify("v2/orchestrator-rust/src/card_shared/narrator.js")).toBe(
      "generated",
    );
    expect(
      classify("v2/orchestrator-rust/src/card_shared/engine-v133.js"),
    ).toBe("generated");
    expect(classify("test/journeys/checkpoints.json")).toBe("generated");
    expect(classify("v2/orchestrator-rust/src/card_shared/engine.rs")).toBe(
      "wiring",
    );
    expect(classify("test/card-released-rules.test.mjs")).toBe("wiring");
    expect(classify("v2/card-game/world.mjs")).toBe("other");
    expect(classify("v2/card-game/public-assets.mjs")).toBe("other");
  });

  it("names real generated files", () => {
    for (const file of GENERATED_FILES)
      expect(existsSync(new URL(`../${file}`, import.meta.url)), file).toBe(
        true,
      );
  });

  it("runs every generator the pack scripts run, and checks what it builds", () => {
    const list = steps("origin/main");
    for (const { name, build, check } of list) {
      expect(
        existsSync(new URL(`../${build.script}`, import.meta.url)),
        `${name} build`,
      ).toBe(true);
      expect(
        existsSync(new URL(`../${check.script}`, import.meta.url)),
        `${name} check`,
      ).toBe(true);
      expect(check.args, name).toContain("--check");
    }
    const used = new Set(
      list.flatMap(({ build, check }) => [build.script, check.script]),
    );
    for (const script of ["pack:build", "pack:check"].map(
      (name) => scripts[`v2:card:${name}`],
    )) {
      for (const file of script.match(/v2\/scripts\/[\w-]+\.mjs/gu) ?? [])
        expect(used, file).toContain(file);
    }
    // Rules are minted from main's wiring before any bundle is rebuilt.
    const order = list.map((s) => s.name);
    expect(order.indexOf("rules")).toBeLessThan(order.indexOf("narrator"));
    expect(order.indexOf("packs")).toBeLessThan(order.indexOf("authored-text"));
    expect(order.indexOf("packs")).toBeLessThan(order.indexOf("journeys"));
  });

  it("keeps the authored text catalog in the pack checks", () => {
    expect(scripts["v2:card:pack:check"]).toContain("v2:card:authored:check");
    expect(scripts["v2:card:pack:build"]).toContain("v2:card:authored:build");
  });
});
