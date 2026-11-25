import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { publicAssets } from "../card-game/public-assets.mjs";
import { newest } from "./rules-pins.mjs";

const ASSET_CHECK_CONCURRENCY = 8;
const targets = process.argv.slice(2);
const known =
  process.env.COSYWORLD_SMOKE_MANIFEST &&
  JSON.parse(readFileSync(process.env.COSYWORLD_SMOKE_MANIFEST, "utf8")).files;
assert(targets.length, "Pass at least one deployed card-game URL.");
const { version } = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url)),
);
for (const target of targets) {
  const base = new URL(target);
  const metadataResponse = await fetch(new URL("/meta", base), {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(metadataResponse.status, 200, `${base.origin}: metadata status`);
  const meta = await metadataResponse.json();
  assert.equal(meta.version, version, `${base.origin}: metadata release`);
  if (meta.commit && process.env.GITHUB_SHA) {
    assert(
      process.env.GITHUB_SHA.startsWith(meta.commit),
      `${base.origin}: commit ${meta.commit}`,
    );
  }
  assert.equal(
    meta.primary_game,
    "card-table",
    `${base.origin}: selected game`,
  );
  assert.equal(meta.card_game.source_root, "v2/card-game/");
  assert.equal(meta.card_game.entry_url, "/");
  assert.deepEqual(meta.card_game.play_modes, ["local", "shared"]);
  const rules = await readFile(
    new URL("../orchestrator-rust/src/card_shared/rules.json", import.meta.url),
    "utf8",
  );
  assert.equal(
    meta.card_game.shared_rules_version,
    `full-card-world/${newest(rules)}`,
  );
  assert.deepEqual(meta.card_game.catalogs, {
    forest: "/card-game/forest.json",
    shared_avatars: "/card-game/shared-cast.json",
    character_profiles: "/card-game/entity-profiles.json",
    mounted_packs: "/card-game/packs.json",
  });
  assert.equal(
    meta.metadata_scopes,
    undefined,
    `${base.origin}: classic metadata scopes are gone`,
  );
  console.log(
    `${base.origin}: ${meta.primary_game} ${meta.version}${meta.commit ? `+${meta.commit}` : ""}, rules ${meta.card_game.shared_rules_version}`,
  );
  const checkAsset = async ({ file, contentType, source, offset = 0 }) => {
    const url = new URL(
      file === "index.html" ? "/" : `/card-game/${file}`,
      base,
    );
    const local = new URL(`../card-game/${source || file}`, import.meta.url);
    const etag = known && !existsSync(local) && `"${known[`card-game/${file}`].sha256}"`;
    const response = await fetch(url, {
      headers: etag ? { "if-none-match": etag } : {},
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, etag ? 304 : 200, `${url}: status`);
    assert.equal(
      response.headers.get("x-cosyworld-card-version"),
      version,
      `${url}: version`,
    );
    assert(
      response.headers.get("content-type")?.startsWith(contentType),
      `${url}: content type`,
    );
    if (etag) return;
    const expected = (await readFile(local)).subarray(offset);
    let actual = Buffer.from(await response.arrayBuffer());
    if (file === "index.html")
      actual = Buffer.from(
        actual
          .toString()
          .replaceAll(`${url.origin}/`, "https://lonelyforest.com/"),
      );
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
      assert(
        Buffer.from(await range.arrayBuffer()).equals(expected.subarray(0, 3)),
        `${url}: MP3 source bytes`,
      );
    }
  };
  const queue = [...publicAssets];
  await Promise.all(
    Array.from({ length: ASSET_CHECK_CONCURRENCY }, async () => {
      while (queue.length) await checkAsset(queue.shift());
    }),
  );
  const health = await fetch(new URL("/health", base), {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(health.status, 200, `${base.origin}: health status`);
  assert.equal((await health.json()).ok, true, `${base.origin}: health`);
  console.log(
    `${base.origin}: card game ${version}, all ${publicAssets.length} files match, service healthy`,
  );
}
