import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { roomTracks } from "../card-game/music.mjs";
import { packMediaFiles } from "../card-game/pack-registry.mjs";

const targets = process.argv.slice(2);
assert(targets.length, "Pass at least one deployed card-game URL.");
const { version } = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url)),
);
const files = [
  "shared.mjs",
  "shared-auth.mjs",
  "shared-rules.mjs",
  "shared.css",
  "shared-cast.json",
  "assets/shared/places/pond.png",
  "assets/shared/characters/vale.png",
  "assets/shared/places/station.png",
  "assets/shared/items/lamp.png",
  "assets/shared/characters/mara.png",
  "assets/shared/places/theatre.png",
  "assets/shared/items/mask.png",
  "assets/shared/characters/ash.png",
  "assets/shared/places/belfry.png",
  "assets/shared/items/float.png",
  "assets/shared/characters/nell.png",
  "assets/shared/places/glasshouse.png",
  "assets/shared/items/can.png",
  "assets/shared/characters/tavi.png",
  "assets/shared/places/hill.png",
  "assets/shared/items/kite.png",
  "assets/shared/characters/rue.png",
  "assets/shared/places/train.png",
  "assets/shared/items/routes.png",
  "assets/shared/characters/orin.png",
  "assets/shared/places/pavilion.png",
  "assets/shared/items/board.png",
  "assets/shared/characters/ada.png",
  "assets/shared/places/loft.png",
  "assets/shared/items/shears.png",

  "index.html",
  "style.css",
  "entry.mjs",
  "awakening.css",
  "pack-schema.mjs",
  "pack-registry.mjs",
  "pack-rules.mjs",
  "legacy-saves.mjs",
  "packs.json",
  "app.mjs",
  "world.mjs",
  "scene.mjs",
  "cards.mjs",
  "motives.mjs",
  "quests.mjs",
  "quest-cards.mjs",
  "situations.mjs",
  "memory.mjs",
  "narrative.mjs",
  "dialogue.mjs",
  "music.mjs",
  ...Object.values(roomTracks)
    .flat()
    .map(({ file }) => `assets/music/${file}`),
  "entity-profiles.json",
  ...["station", "attic", "pond", "vale", "moth", "keeper", "keeper-right"].map(
    (id) => `assets/${id}.png`,
  ),
  ...packMediaFiles,
];

for (const target of targets) {
  const base = new URL(target);
  for (const file of files) {
    const url = new URL(
      file === "index.html" ? "/" : `/card-game/${file}`,
      base,
    );
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200, `${url}: status`);
    assert.equal(
      response.headers.get("x-cosyworld-card-version"),
      version,
      `${url}: version`,
    );
    const expectedType = file.endsWith(".svg")
      ? "image/svg+xml"
      : file.endsWith(".webp")
        ? "image/webp"
        : file.endsWith(".mp3")
          ? "audio/mpeg"
          : file.endsWith(".png")
            ? "image/png"
            : file.endsWith(".json")
              ? "application/json"
              : file.endsWith(".mjs")
                ? "text/javascript"
                : file.endsWith(".css")
                  ? "text/css"
                  : "text/html";
    assert(
      response.headers.get("content-type")?.startsWith(expectedType),
      `${url}: content type`,
    );
    const expected = await readFile(
      new URL(`../card-game/${file}`, import.meta.url),
    );
    const actual = Buffer.from(await response.arrayBuffer());
    assert(actual.equals(expected), `${url}: differs from this release`);
    if (file.endsWith(".mp3")) {
      const range = await fetch(url, {
        headers: { Range: "bytes=0-2" },
        signal: AbortSignal.timeout(30_000),
      });
      assert.equal(range.status, 206, `${url}: range status`);
      assert.equal(
        range.headers.get("content-range"),
        `bytes 0-2/${expected.length}`,
      );
      assert.equal(await range.text(), "ID3", `${url}: MP3 header`);
    }
  }
  const health = await fetch(new URL("/health", base), {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(health.status, 200, `${base.origin}: health status`);
  assert.equal((await health.json()).ok, true, `${base.origin}: health`);
  console.log(
    `${base.origin}: card game ${version}, all ${files.length} files match, service healthy`,
  );
}
