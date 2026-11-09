import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  radioSources,
  validateRadioCatalog,
} from "../v2/scripts/build-card-radio.mjs";

const root = new URL("../v2/card-game/assets/music/", import.meta.url);
const catalog = JSON.parse(readFileSync(new URL("radio-catalog.json", root)));
describe("RatiRadio's measured catalog", () => {
  it("includes every original song once and matches the current authored titles and bytes", () => {
    expect(validateRadioCatalog(catalog)).toBe(catalog);
    const files = catalog.tracks.map(({ file }) => file);
    expect(files).toEqual(
      readdirSync(root)
        .filter((file) => /\.(mp3|m4a)$/.test(file))
        .sort(),
    );
    expect(new Set(files).size).toBe(files.length);
    expect(catalog.tracks.map(({ durationMs, ...source }) => source)).toEqual(
      radioSources(),
    );
    expect(
      catalog.tracks.every(
        ({ durationMs }) => durationMs > 1000 && durationMs < 3600000,
      ),
    ).toBe(true);
  });
  it.each(["file", "title", "sourceHash", "durationMs"])(
    "detects a stale %s",
    (field) => {
      const stale = structuredClone(catalog);
      stale.tracks[0][field] = field === "durationMs" ? 0 : "stale";
      expect(() => validateRadioCatalog(stale)).toThrow(
        /Rebuild the radio catalog/,
      );
    },
  );
  it("detects removed songs and a changed catalog identity", () => {
    expect(() =>
      validateRadioCatalog({ ...catalog, tracks: catalog.tracks.slice(1) }),
    ).toThrow();
    expect(() =>
      validateRadioCatalog({ ...catalog, version: "wrong" }),
    ).toThrow();
  });
});
