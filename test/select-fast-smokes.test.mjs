import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectSmokes } from "../scripts/select-fast-smokes.mjs";

const config = JSON.parse(
  readFileSync(new URL("../scripts/fast-smokes.json", import.meta.url), "utf8"),
);

describe("fast check smoke selection", () => {
  it("names only smoke scripts that exist", () => {
    const named = [
      ...config.default,
      ...config.needsRust,
      ...config.rules.flatMap((rule) => rule.smokes),
    ];
    for (const smoke of named)
      expect(
        existsSync(new URL(`../v2/scripts/${smoke}.mjs`, import.meta.url)),
      ).toBe(true);
  });

  it("runs the core smokes when no rule matches", () => {
    expect(selectSmokes(["docs/release.md"], config)).toEqual(config.default);
  });

  it("chooses smokes by changed path", () => {
    expect(selectSmokes(["v2/card-game/dialogue.mjs"], config)).toEqual([
      "smoke-card-beat-stack",
      "smoke-card-dialogue-timing",
    ]);
    expect(selectSmokes(["v2/card-game/card-tiers.css"], config)).toEqual([
      "smoke-card-unveil",
      "smoke-card-actions",
    ]);
    expect(selectSmokes(["v2/card-game/hum.mjs"], config)).toEqual([
      "smoke-card-music",
    ]);
  });

  it("runs a changed smoke first, skips Rust smokes, and caps the count", () => {
    expect(
      selectSmokes(
        [
          "v2/scripts/smoke-shared-cards.mjs",
          "v2/scripts/smoke-card-weather.mjs",
          "v2/card-game/beats.mjs",
          "v2/card-game/world.mjs",
        ],
        config,
      ),
    ).toEqual([
      "smoke-card-weather",
      "smoke-card-beat-stack",
      "smoke-card-dialogue-timing",
    ]);
  });
});
