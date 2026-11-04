import { test } from "vitest";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import art from "../v2/card-game/assets/title/transparent/black-pond-alpha.provenance.json" with { type: "json" };

const root = new URL("../v2/card-game/assets/title/transparent/", import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("Black Pond has a full-size transparent cutout and an honest source record", async () => {
  assert.equal(art.title_text, "Lonely Forest");
  assert.equal(art.treatment, "The Black Pond");
  assert.match(art.kind, /derivative/);
  assert.deepEqual([art.master.width, art.master.height], [1672, 941]);
  assert.deepEqual([art.toolbar.width, art.toolbar.height], [476, 160]);
  for (const entry of [art.master, art.toolbar]) {
    const body = await readFile(new URL(entry.file, root));
    assert.equal(body.length, entry.bytes);
    assert.equal(hash(body), entry.sha256);
    const metadata = await sharp(body).metadata();
    assert.equal(metadata.width, entry.width);
    assert.equal(metadata.height, entry.height);
    assert.equal(metadata.hasAlpha, true);
    const alpha = await sharp(body).extractChannel("alpha").raw().toBuffer();
    assert.ok(alpha.includes(0), "The black matte must not be opaque");
    assert.ok(alpha.includes(255), "The lettering must remain visible");
    if (entry === art.master) {
      assert.equal(hash(alpha), art.alpha.sha256);
      assert.ok(alpha.filter((value) => value === 0).length > 1_000_000);
      for (const index of [0, 1671, 1672 * 940, 1672 * 941 - 1])
        assert.equal(alpha[index], 0, "Clear canvas corner");
    }
  }
});

test("Black Pond's silver lettering, doused lamp and reflection reconstruct the original", async () => {
  const source = await readFile(new URL("../lonely-forest-black-pond.webp", root));
  assert.equal(hash(source), art.source_sha256);
  const before = await sharp(source).removeAlpha().raw().toBuffer();
  const after = await sharp(new URL(art.master.file, root).pathname)
    .ensureAlpha().raw().toBuffer();
  assert.equal(before.length, 1672 * 941 * 3);
  assert.equal(after.length, 1672 * 941 * 4);
  let maximum = 0;
  for (let pixel = 0; pixel < 1672 * 941; pixel++) {
    const alpha = after[pixel * 4 + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      const composite = Math.round(after[pixel * 4 + channel] * alpha);
      maximum = Math.max(maximum, Math.abs(composite - before[pixel * 3 + channel]));
    }
  }
  assert.ok(maximum <= 4, `Lettering or source painting changed: ${maximum}`);
});
