import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  LOGOS,
  chooseLogo,
  toolbarLogo,
  worldLogo,
} from "../v2/card-game/title-logo.mjs";
import { publicAssets } from "../v2/card-game/public-assets.mjs";
import variants from "../v2/card-game/image-variants.json" with { type: "json" };
import provenance from "../v2/card-game/assets/title/alternate-intros.provenance.json" with { type: "json" };

const original = [
  "assets/title/lonely-forest-1.webp",
  "assets/title/lonely-forest-2.webp",
];
const alternatives = provenance.artworks.map(
  ({ file }) => `assets/title/${file}`,
);

test("append approved artwork without changing saved original logo indices", () => {
  assert.deepEqual(
    LOGOS.slice(0, 2).map(({ src }) => src),
    original,
  );
  for (const [index, src] of original.entries()) {
    const storage = {
      getItem: () => JSON.stringify({ worlds: { "world:existing": index } }),
      setItem() {},
    };
    assert.equal(
      worldLogo({ href: "https://lonelyforest.com/?world=existing", storage })
        .src,
      src,
    );
  }
  assert.equal(new Set(LOGOS.map(({ src }) => src)).size, LOGOS.length);
  assert.equal(alternatives.length, 3);
  for (const src of alternatives) {
    const logo = LOGOS.find((entry) => entry.src === src);
    assert.ok(logo, src);
    assert.equal(logo.width, 1672);
    assert.equal(logo.height, 941);
    assert.equal(logo.background, "dark");
  }
});

test("every alternative is reachable and remembered; new worlds avoid repeats", () => {
  const selected = new Set();
  for (let i = 0; i < 512; i++) {
    const key = `world:alternate-${i}`;
    const index = chooseLogo(key);
    selected.add(LOGOS[index].src);
    assert.equal(chooseLogo(key, { worlds: { [key]: index } }), index);
    assert.notEqual(chooseLogo(key, { last: index }), index);
  }
  for (const src of alternatives) assert.ok(selected.has(src), src);
});

test("approved title bytes and responsive variants are published exactly once", () => {
  const hash = (body) => createHash("sha256").update(body).digest("hex");
  for (const art of provenance.artworks) {
    const src = `assets/title/${art.file}`;
    const body = readFileSync(
      new URL(`../v2/card-game/${src}`, import.meta.url),
    );
    assert.equal(body.length, art.bytes, src);
    assert.ok(body.length < 300_000, src);
    assert.equal(body.toString("ascii", 0, 4), "RIFF", src);
    assert.equal(body.toString("ascii", 8, 12), "WEBP", src);
    assert.equal(hash(body), art.sha256, src);
    const record = variants.images[src];
    assert.ok(record, `Build image variants for ${src}`);
    assert.equal(record.sourceHash, art.sha256, src);
    assert.equal(record.stage, src);
    assert.equal(record.stageHash, art.sha256, src);
    for (const size of ["stage", "card", "phone"]) {
      const file = record[size];
      assert.equal(
        publicAssets.filter((asset) => asset.file === file).length,
        1,
        file,
      );
      const bytes = readFileSync(
        new URL(`../v2/card-game/${file}`, import.meta.url),
      );
      assert.equal(hash(bytes), record[`${size}Hash`], file);
    }
  }
});

test("wide artworks keep a legible wordmark in the toolbar", () => {
  for (const logo of LOGOS.slice(0, 2)) assert.equal(toolbarLogo(logo), logo);
  for (const src of alternatives) {
    const logo = LOGOS.find((entry) => entry.src === src);
    const shown = toolbarLogo(logo);
    assert.notEqual(shown, logo, src);
    assert.equal(shown.toolbar, undefined, src);
    assert.ok(shown.width / shown.height >= 2.5, src);
  }
});
