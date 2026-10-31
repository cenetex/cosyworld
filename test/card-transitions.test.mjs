import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FLASH_MS,
  QUIET_MS,
  apparitionFor,
  blendUniforms,
  isHalloween,
  uncannyAt,
  UNCANNY_PLACES,
  uncannyVariant,
} from "../v2/card-game/transitions.mjs";
import { packDefinitions } from "../v2/card-game/pack-registry.mjs";
import { publicAssets } from "../v2/card-game/public-assets.mjs";

const published = {
  "assets/willows/swede-uncanny.webp": {},
  "assets/willows/swede-seated-uncanny.webp": {},
  "assets/willows/riverbank-uncanny.webp": {},
};
const entry = {
  sources: ["./assets/willows/swede.webp"],
  published,
  entered: true,
  halloween: true,
  reduced: false,
  scares: true,
  now: 100_000,
  random: () => 0,
};

describe("Halloween apparitions", () => {
  it("is Halloween only on 31 October unless forced", () => {
    expect(isHalloween(new Date(2026, 9, 31, 23, 59), "")).toBe(true);
    expect(isHalloween(new Date(2026, 9, 30, 12), "")).toBe(false);
    expect(isHalloween(new Date(2026, 10, 1, 0, 1), "")).toBe(false);
    expect(isHalloween(new Date(2026, 5, 1), "?halloween=1")).toBe(true);
    expect(isHalloween(new Date(2026, 9, 31), "?halloween=0")).toBe(false);
  });

  // The owner made the flicker permanent in the Willows (#1589): every
  // Willows place flickers all year, other places only on Halloween.
  it("keeps the Willows uncanny all year and other places to Halloween", () => {
    const willows = packDefinitions.find((p) => p.id === "willows");
    expect([...UNCANNY_PLACES].sort()).toEqual(
      Object.keys(willows.places).sort(),
    );
    const november = new Date(2026, 10, 1, 12);
    for (const place of UNCANNY_PLACES)
      expect(uncannyAt(place, november, "")).toBe(true);
    expect(uncannyAt("greek-ship", november, "")).toBe(false);
    expect(uncannyAt("greek-ship", new Date(2026, 9, 31), "")).toBe(true);
    expect(uncannyAt("willows-bank", november, "?halloween=0")).toBe(false);
    expect(uncannyAt("greek-ship", november, "?halloween=1")).toBe(true);
  });

  it("flashes at most once per entry and never within 30 seconds", () => {
    expect(FLASH_MS).toBeGreaterThanOrEqual(120);
    expect(FLASH_MS).toBeLessThanOrEqual(200);
    expect(QUIET_MS).toBeGreaterThanOrEqual(30_000);
    expect(apparitionFor(entry)?.variant).toBe(
      "assets/willows/swede-uncanny.webp",
    );
    expect(apparitionFor({ ...entry, entered: false })).toBeNull();
    expect(
      apparitionFor({ ...entry, last: entry.now - QUIET_MS + 1 }),
    ).toBeNull();
    expect(apparitionFor({ ...entry, last: entry.now - QUIET_MS })).not.toBe(
      null,
    );
  });

  it("stays away under reduced motion, with scares off, or off the date", () => {
    expect(apparitionFor({ ...entry, reduced: true })).toBeNull();
    expect(apparitionFor({ ...entry, scares: false })).toBeNull();
    expect(apparitionFor({ ...entry, halloween: false })).toBeNull();
    expect(apparitionFor({ ...entry, random: () => 0.99 })).toBeNull();
  });

  it("chooses one image, sprite or backdrop, never both", () => {
    const sources = [
      "./assets/willows/riverbank.webp",
      "./assets/willows/swede-worried.webp",
      "./assets/willows/swede-seated.webp",
    ];
    const first = apparitionFor({ ...entry, sources, random: () => 0 });
    expect(first).toEqual({
      index: 0,
      variant: "assets/willows/riverbank-uncanny.webp",
    });
    const rolls = [0, 0.9];
    const last = apparitionFor({
      ...entry,
      sources,
      random: () => rolls.shift(),
    });
    expect(last).toEqual({
      index: 2,
      variant: "assets/willows/swede-seated-uncanny.webp",
    });
  });

  it("shows each image's own copy and skips images without one", () => {
    expect(
      uncannyVariant("./assets/willows/swede-seated.webp", published),
    ).toBe("assets/willows/swede-seated-uncanny.webp");
    expect(uncannyVariant("assets/willows/swede-worried.webp", published)).toBe(
      null,
    );
    expect(uncannyVariant("assets/willows/swede-uncanny.webp", published)).toBe(
      null,
    );
    expect(
      apparitionFor({
        ...entry,
        sources: ["assets/willows/swede-worried.webp"],
      }),
    ).toBeNull();
  });

  it("publishes every registered uncanny copy and the module", () => {
    const files = new Set(publicAssets.map(({ file }) => file));
    expect(files.has("transitions.mjs")).toBe(true);
    for (const file of files)
      if (file.endsWith("-uncanny.webp"))
        expect(existsSync(`v2/card-game/${file}`)).toBe(true);
  });
});

describe("weather easing", () => {
  const clear = { rain: 0, cloud: 0, mist: 0, tint: [0, 0, 0], night: 0 };
  const storm = { rain: 1, cloud: 0.75, mist: 0.3, tint: [1, 1, 1], night: 1 };

  it("starts from the shown sky and settles on the new one", () => {
    expect(blendUniforms(clear, storm, 0)).toEqual(clear);
    expect(blendUniforms(clear, storm, 1)).toBe(storm);
    expect(blendUniforms(null, storm, 0)).toBe(storm);
    const half = blendUniforms(clear, storm, 0.5);
    expect(half.rain).toBeCloseTo(0.5);
    expect(half.tint[1]).toBeCloseTo(0.5);
  });
});
