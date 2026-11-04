import { test } from "vitest";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import provenance from "../v2/card-game/assets/card-back-locked-provenance.json" with { type: "json" };
import variants from "../v2/card-game/image-variants.json" with { type: "json" };
import media from "../v2/card-game/media-manifest.json" with { type: "json" };
import { publicAssets } from "../v2/card-game/public-assets.mjs";

const root = new URL("../v2/card-game/", import.meta.url);
const hash = (data) => createHash("sha256").update(data).digest("hex");

test("locked card art has a real clasp edit without changing the surrounding carving", async () => {
  assert.equal(provenance.status, "composited-review");
  assert.equal(provenance.generation.id, null);
  const source = await readFile(new URL(provenance.source.file, root));
  const master = await readFile(new URL(provenance.master.file, root));
  assert.equal(hash(source), provenance.source.sha256);
  assert.equal(hash(master), provenance.master.sha256);
  const metadata = await sharp(master).metadata();
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 1536);
  assert.equal(metadata.hasAlpha, false);
  const before = await sharp(source).removeAlpha().raw().toBuffer();
  const after = await sharp(master).removeAlpha().raw().toBuffer();
  assert.equal(before.length, after.length);
  let centralDifference = 0;
  let centralSamples = 0;
  for (let y = 0; y < 1536; y++) {
    for (let x = 0; x < 1024; x++) {
      const offset = (y * 1024 + x) * 3;
      const outside = x < 335 || x >= 700 || y < 480 || y >= 990;
      for (let channel = 0; channel < 3; channel++) {
        if (outside) assert.equal(after[offset + channel], before[offset + channel]);
        if (x >= 390 && x < 630 && y >= 650 && y < 890) {
          centralDifference += Math.abs(after[offset + channel] - before[offset + channel]);
          centralSamples++;
        }
      }
    }
  }
  assert.ok(centralDifference / centralSamples > 15, "The clasp is missing");
});

test("the locked artwork and responsive variants are real, opaque and published", async () => {
  const src = "assets/card-back-locked.webp";
  const body = await readFile(new URL(src, root));
  assert.equal(hash(body), provenance.runtime.sha256);
  assert.equal(body.length, provenance.runtime.bytes);
  assert.ok(body.length < 300_000);
  const record = variants.images[src];
  assert.equal(record.sourceHash, hash(body));
  for (const size of ["stage", "card", "phone"]) {
    const file = record[size];
    const bytes = await readFile(new URL(file, root));
    assert.equal(hash(bytes), record[`${size}Hash`]);
    assert.equal(media[file], hash(bytes));
    assert.equal(publicAssets.filter((asset) => asset.file === file).length, 1);
    assert.equal((await sharp(bytes).metadata()).hasAlpha, false);
  }
});
