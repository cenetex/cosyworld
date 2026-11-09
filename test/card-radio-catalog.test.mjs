import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { once } from "node:events";
import { createServer, radioSchedule } from "../v2/card-game/serve.mjs";
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

it("uses the same epoch, boundary and loop contract on the local server", async () => {
  const total = catalog.tracks.reduce(
    (sum, track) => sum + track.durationMs,
    0,
  );
  const first = catalog.tracks[0],
    second = catalog.tracks[1];
  for (const [now, track, start] of [
    [0, first, 0],
    [first.durationMs - 1, first, 0],
    [first.durationMs, second, first.durationMs],
    [total, first, total],
  ]) {
    const { sourceHash, ...expected } = track;
    expect(radioSchedule(now)).toEqual({
      station: "ratiradio",
      version: catalog.version,
      serverTimeMs: now,
      track: expected,
      startedAtMs: start,
      endsAtMs: start + track.durationMs,
    });
  }
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/card-game/radio`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual(radioSchedule(body.serverTimeMs));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
