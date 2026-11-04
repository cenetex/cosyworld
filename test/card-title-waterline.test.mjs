import { test } from "vitest";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import provenance from "../v2/card-game/assets/title/transparent/waterline-revision.provenance.json" with { type: "json" };

const root = new URL("../v2/card-game/assets/title/transparent/", import.meta.url);

test("waterline master is the latest approved Lonely Forest generation", () => {
  assert.equal(provenance.generation_id, "0233e449-8cce-438e-948b-a8a87b99f5f8");
  assert.equal(provenance.master.file, "lonely-forest-waterline.png");
  assert.equal(provenance.master.width, 1774);
  assert.equal(provenance.master.height, 887);
  assert.equal(provenance.master.git_blob_sha, "72df93ae7b2aac21e2cea9b0c1177b5ee19a6f29");
});

for (const role of ["master", "toolbar"]) {
  test(`waterline ${role} preserves its verified bytes and real alpha`, async () => {
    const art = provenance[role];
    assert.match(art.file, /^[a-z0-9-]+\.(png|webp)$/);
    const body = await readFile(new URL(art.file, root));
    assert.equal(body.length, art.bytes);
    assert.equal(createHash("sha256").update(body).digest("hex"), art.sha256);
    const metadata = await sharp(body).metadata();
    assert.equal(metadata.width, art.width);
    assert.equal(metadata.height, art.height);
    assert.equal(metadata.format, role === "master" ? "png" : "webp");
    assert.equal(metadata.hasAlpha, true);
    const alpha = await sharp(body).extractChannel("alpha").raw().toBuffer();
    let clear = 0;
    let visible = 0;
    for (const value of alpha) {
      if (value === 0) clear++;
      if (value >= 200) visible++;
    }
    assert.ok(clear > alpha.length / 4, "The transparent exterior is missing");
    assert.ok(visible > 0, "The lettering is empty");
    if (role === "master") assert.equal(clear, provenance.alpha.clear_pixels);
  });
}
