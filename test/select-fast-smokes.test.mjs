import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectSmokes } from "../scripts/select-fast-smokes.mjs";

const config = JSON.parse(
  readFileSync(new URL("../scripts/fast-smokes.json", import.meta.url), "utf8"),
);
const pick = (...changed) => selectSmokes(changed, config);

describe("fast check smoke selection", () => {
  it("names only smoke scripts that exist", () => {
    const named = [
      config.always,
      config.default,
      config.needsRust,
      config.rules.map((r) => r.smokes),
    ];
    for (const smoke of named.flat(2))
      expect(existsSync(`v2/scripts/${smoke}.mjs`), smoke).toBe(true);
  });

  it("runs a journey the full suite splits by width one width per job", () => {
    const checks = { "smoke-card-ajax@1440": 1, "smoke-card-ajax@390": 1 };
    expect(
      selectSmokes(["v2/scripts/smoke-card-ajax.mjs"], config, checks),
    ).toEqual([
      ...config.always,
      "smoke-card-ajax@1440",
      "smoke-card-ajax@390",
    ]);
  });

  it("chooses smokes by changed path, with a core default", () => {
    expect(pick("docs/release.md")).toEqual([
      ...config.always,
      ...config.default,
    ]);
    expect(pick("v2/card-game/dialogue.mjs")).toContain(
      "smoke-card-dialogue-timing",
    );
    expect(pick("v2/card-game/card-tiers.css")).toContain("smoke-card-unveil");
    expect(pick("v2/card-game/hum.mjs")).toEqual([
      ...config.always,
      "smoke-card-music",
    ]);
  });

  it("runs a changed smoke first, skips Rust smokes, and caps the count", () => {
    const smokes = pick(
      "v2/scripts/smoke-shared-cards.mjs",
      "v2/scripts/smoke-card-weather.mjs",
      "v2/card-game/beats.mjs",
      "v2/card-game/world.mjs",
    );
    expect(smokes).toHaveLength(config.always.length + config.max);
    expect(smokes.slice(0, config.always.length)).toEqual(config.always);
    expect(smokes[config.always.length]).toBe("smoke-card-weather");
    expect(smokes).not.toContain("smoke-shared-cards");
  });

  it("runs the boot smoke on every change, once", () => {
    expect(config.always).toContain("smoke-card-boot");
    for (const changed of [
      [],
      ["docs/release.md"],
      ["v2/scripts/smoke-card-boot.mjs"],
    ])
      expect(
        pick(...changed).filter((s) => s === "smoke-card-boot"),
      ).toHaveLength(1);
  });
});
