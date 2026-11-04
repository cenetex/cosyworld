import { test } from "vitest";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { LOCKED_BACK } from "../v2/card-game/locked-box.mjs";
import { publicAssets } from "../v2/card-game/public-assets.mjs";
import provenance from "../v2/card-game/assets/card-back-locked-provenance.json" with { type: "json" };
import variants from "../v2/card-game/image-variants.json" with { type: "json" };
import media from "../v2/card-game/media-manifest.json" with { type: "json" };

const root = new URL("../v2/card-game/", import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceHash =
  "e74213b059921642d2af213df18071db0dfa70dce3c6b510e14b1fa46898d139";

test("the locked lid uses the approved recessed iron keyhole, not a padlock or stand-in", async () => {
  assert.equal(provenance.status, "final");
  assert.equal(
    provenance.generation.id,
    "25e0f356-5634-479b-9c89-fd35760f9dc3",
  );
  assert.equal(provenance.source.sha256, sourceHash);
  const source = await readFile(new URL(provenance.source.file, root));
  assert.equal(source.length, 3624798);
  assert.equal(hash(source), sourceHash);
  const info = await sharp(source).metadata();
  assert.equal(info.format, "png");
  assert.equal(info.width, 1024);
  assert.equal(info.height, 1536);
  assert.equal(info.hasAlpha, false);
  await sharp(source).raw().toBuffer();
  assert.equal(LOCKED_BACK, "./assets/card-back-locked.webp");
  const originalBack = await readFile(new URL("assets/card-back.webp", root));
  assert.equal(
    hash(originalBack),
    "8acc1349faa332899cf4123c2c308489c3c3ffe9b0c9c528f46d76d81caec29f",
  );
});

test("the native locked lid and both responsive copies have current published hashes", async () => {
  const asset = "assets/card-back-locked.webp";
  const entry = variants.images[asset];
  assert.ok(entry);
  assert.equal(entry.stage, asset);
  assert.equal(entry.sourceHash, provenance.runtime.sha256);
  assert.notEqual(entry.sourceHash, provenance.replaces.runtime_sha256);
  for (const [size, record] of [
    ["stage", provenance.runtime],
    ["card", provenance.card],
    ["phone", provenance.phone],
  ]) {
    assert.ok(record, size);
    assert.equal(entry[size], record.file);
    const bytes = await readFile(new URL(record.file, root));
    const digest = hash(bytes);
    assert.equal(bytes.length, record.bytes);
    assert.equal(digest, record.sha256);
    assert.equal(digest, entry[`${size}Hash`]);
    assert.equal(digest, media[record.file]);
    assert.equal(
      publicAssets.filter(({ file }) => file === record.file).length,
      1,
    );
    const info = await sharp(bytes).metadata();
    assert.equal(info.format, "webp");
    assert.equal(info.width, record.width);
    assert.equal(info.height, record.height);
    assert.equal(info.hasAlpha, false);
    const alpha = await sharp(bytes)
      .ensureAlpha()
      .extractChannel("alpha")
      .raw()
      .toBuffer();
    assert.ok(
      alpha.every((value) => value === 255),
      `${size} must stay opaque`,
    );
  }
  assert.equal(provenance.runtime.width, 1024);
  assert.equal(provenance.runtime.height, 1536);
  assert.ok(provenance.runtime.bytes <= 300_000);
  assert.equal(provenance.card.width, 512);
  assert.equal(provenance.card.height, 768);
  assert.equal(provenance.phone.width, 640);
  assert.equal(provenance.phone.height, 960);
});
