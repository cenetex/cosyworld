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
      config.core,
      config.needsRust,
      config.rules.map((r) => r.smokes),
    ];
    for (const smoke of named.flat(2))
      expect(existsSync(`v2/scripts/${smoke}.mjs`), smoke).toBe(true);
  });

  it("runs the core smokes on every change, first and once", () => {
    expect(config.core).toContain("smoke-card-boot");
    expect(config.core.some((s) => config.needsRust.includes(s))).toBe(false);
    for (const changed of [
      [],
      ["docs/release.md"],
      ["v2/scripts/smoke-card-boot.mjs"],
      ["v2/scripts/smoke-card-unveil.mjs", "v2/card-game/card-tiers.css"],
    ]) {
      const smokes = pick(...changed);
      expect(smokes.slice(0, config.core.length)).toEqual(config.core);
      expect(new Set(smokes).size).toBe(smokes.length);
    }
    expect(pick("docs/release.md")).toEqual(config.core);
  });

  it("runs a journey the full suite splits by width one width per job", () => {
    const checks = { "smoke-card-ajax@1440": 1, "smoke-card-ajax@390": 1 };
    expect(
      selectSmokes(["v2/scripts/smoke-card-ajax.mjs"], config, checks),
    ).toEqual([...config.core, "smoke-card-ajax@1440", "smoke-card-ajax@390"]);
  });

  it("chooses smokes by changed path", () => {
    expect(pick("v2/card-game/dialogue.mjs")).toContain(
      "smoke-card-dialogue-timing",
    );
    expect(pick("v2/card-game/hum.mjs")).toEqual([
      ...config.core,
      "smoke-card-music",
    ]);
    // The music smoke drives the opening's Put out and its helper checks.
    for (const file of [
      "v2/card-game/opening.mjs",
      "v2/scripts/music-reveal-check.mjs",
    ])
      expect(pick(file)).toContain("smoke-card-music");
  });

  it("checks dream lifetime when the sleep owner changes", () => {
    for (const owner of ["view", "presentation"])
      expect(pick(`v2/card-game/sleep-${owner}.mjs`)).toContain(
        "smoke-card-sleep-dream",
      );
  });

  it("checks layer fades and reduced motion when transitions change", () => {
    expect(pick("v2/card-game/transitions.mjs")).toEqual([
      ...config.core,
      "smoke-card-ship-fade",
      "smoke-card-reduced-fades",
    ]);
    expect(
      pick(
        "v2/card-game/transitions.mjs",
        "v2/content/ratiradio/card-world.json",
      ).slice(config.core.length),
    ).toEqual([
      "smoke-card-ratiradio",
      "smoke-card-ship-fade",
      "smoke-card-reduced-fades",
    ]);
  });

  it("gives a core smoke a path selects no slot of the cap", () => {
    // beat-stack and actions are core; the rest fill the three slots.
    const smokes = pick(
      "v2/card-game/beats.mjs",
      "v2/card-game/world.mjs",
      "v2/card-game/combat.mjs",
    );
    expect(smokes).toEqual([
      ...config.core,
      "smoke-card-dialogue-timing",
      "smoke-card-combat",
      "smoke-card-pond-access",
    ]);
  });

  it("keeps the RatiRadio route in the integration smoke budget", () => {
    for (const file of [
      "v2/card-game/packs.json",
      "v2/content/ratiradio/card-world.json",
      "v2/card-game/assets/ratiradio/raven.webp",
      "v2/card-game/assets/music/night-shift-on-ratiradio-remastered.mp3",
      "v2/worlds/ratiradio/card-bridge.json",
    ])
      expect(pick(file, "v2/card-game/app.mjs", "v2/card-game/world.mjs",
        "v2/orchestrator-rust/src/card_shared/content.json")[config.core.length])
        .toBe("smoke-card-ratiradio");
  });

  it("runs a changed smoke first, skips Rust smokes, and caps the count", () => {
    const smokes = pick(
      "v2/scripts/smoke-shared-cards.mjs",
      "v2/scripts/smoke-card-weather.mjs",
      "v2/card-game/beats.mjs",
      "v2/card-game/world.mjs",
    );
    expect(smokes).toHaveLength(config.core.length + config.max);
    expect(smokes[config.core.length]).toBe("smoke-card-weather");
    expect(smokes).not.toContain("smoke-shared-cards");
  });
});
