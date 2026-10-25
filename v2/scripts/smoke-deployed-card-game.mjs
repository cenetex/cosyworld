import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { roomTracks } from "../card-game/music.mjs";

const targets = process.argv.slice(2);
assert(targets.length, "Pass at least one deployed card-game URL.");
const { version } = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url)),
);
const files = [
  "index.html",
  "style.css",
  "entry.mjs",
  "awakening.css",
  "assets/steam-clock-background.png",
  "assets/badger-sleeping.png",
  "assets/badger-grumpy.png",
  "app.mjs",
  "world.mjs",
  "scene.mjs",
  "cards.mjs",
  "motives.mjs",
  "quests.mjs",
  "situations.mjs",
  "memory.mjs",
  "narrative.mjs",
  "dialogue.mjs",
  "music.mjs",
  ...Object.values(roomTracks)
    .flat()
    .map(({ file }) => `assets/music/${file}`),
  "pack-registry.mjs",
  "packs/greek-drama.mjs",
  ...[
    "antigone",
    "ismene",
    "creon",
    "guard",
    "baker",
    "elder",
    "shipmaster",
    "singer",
    "neighbor",
    "attendant",
    "ferryman",
    "helen",
    "menelaus",
    "electra",
    "orestes",
  ].map((id) => `assets/greek/chthonic-${id}.png`),
  "assets/greek/antigone.svg",
  "assets/greek/baker.svg",
  "assets/greek/bread.svg",
  "assets/greek/courtyard.svg",
  "assets/greek/creon.svg",
  "assets/greek/decree.svg",
  "assets/greek/elder.svg",
  "assets/greek/funeral-cloth.svg",
  "assets/greek/grove.svg",
  "assets/greek/guard.svg",
  "assets/greek/guide.svg",
  "assets/greek/harbor.svg",
  "assets/greek/household-token.svg",
  "assets/greek/ismene.svg",
  "assets/greek/oil-flask.svg",
  "assets/greek/palace.svg",
  "assets/greek/provisions.svg",
  "assets/greek/sea.svg",
  "assets/greek/shovel.svg",
  "assets/greek/testimony.svg",
  "assets/greek/water-jar.svg",
  "entity-profiles.json",
  ...["station", "attic", "pond", "vale", "moth", "keeper", "keeper-right"].map(
    (id) => `assets/${id}.png`,
  ),
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
