import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const targets = process.argv.slice(2);
assert(targets.length, "Pass at least one deployed card-game URL.");
const { version } = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url)),
);
const files = [
  "index.html",
  "style.css",
  "app.mjs",
  "world.mjs",
  "scene.mjs",
  "cards.mjs",
  "quests.mjs",
  "memory.mjs",
  "narrative.mjs",
  "entity-profiles.json",
  ...["station", "attic", "pond", "vale", "moth", "keeper"].map(
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
    const expectedType = file.endsWith(".png")
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
