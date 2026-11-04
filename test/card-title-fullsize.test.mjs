import { test } from "vitest";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import sources from "../v2/card-game/assets/title/transparent/fullsize-sources.json" with { type: "json" };

const root = new URL("../v2/card-game/assets/title/transparent/", import.meta.url);

test("full-size transparent logo masters are the four native originals", () => {
  assert.equal(sources.artworks.length, 4);
  assert.equal(new Set(sources.artworks.map(({ file }) => file)).size, 4);
});

for (const art of sources.artworks) {
  test(`native transparent logo bytes and alpha: ${art.file}`, async () => {
    assert.match(art.file, /^[a-z0-9-]+\.png$/);
    const body = await readFile(new URL(art.file, root));
    assert.equal(body.length, art.bytes);
    assert.equal(createHash("sha256").update(body).digest("hex"), art.sha256);
    const metadata = await sharp(body).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, art.width);
    assert.equal(metadata.height, art.height);
    assert.equal(metadata.hasAlpha, true);
    assert.ok(metadata.width >= 1900, "Do not substitute a toolbar thumbnail");
    const alpha = await sharp(body).extractChannel("alpha").raw().toBuffer();
    let clear = 0;
    let opaque = 0;
    for (const value of alpha) {
      if (value === 0) clear++;
      if (value === 255) opaque++;
    }
    assert.ok(clear > 100_000, "The original transparent exterior is missing");
    assert.ok(opaque > 0, "The source artwork is empty");
  });
}
