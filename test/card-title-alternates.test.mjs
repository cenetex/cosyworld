import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  LOGOS,
  chooseLogo,
  showToolbarLogo,
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

// A stand-in for the toolbar's `.brand strong`, enough for showToolbarLogo.
function fakeToolbar() {
  const mark = { dataset: {}, image: null };
  mark.querySelector = () => mark.image;
  mark.replaceChildren = (image) => (mark.image = image);
  return {
    mark,
    querySelector: () => mark,
    createElement: () => ({}),
  };
}

test("the toolbar shows the logo the title chose, for every logo", () => {
  for (const [index, logo] of LOGOS.entries()) {
    const memory = { worlds: { "world:shown": index } };
    const storage = {
      getItem: () => JSON.stringify(memory),
      setItem() {},
    };
    // entry.mjs hands the same pick to the title and the toolbar.
    const chosen = worldLogo({
      href: "https://lonelyforest.com/?world=shown",
      storage,
    });
    assert.equal(chosen, logo);
    const root = fakeToolbar();
    showToolbarLogo(chosen, root);
    showToolbarLogo(chosen, root); // a reload or New game reuses the image
    const { mark } = root;
    assert.equal(mark.dataset.logo, logo.src);
    assert.equal(mark.image.alt, logo.name, "keeps the accessible name");
    const shown = toolbarLogo(logo);
    assert.equal(mark.image.width, shown.width);
    assert.equal(mark.image.height, shown.height);
    assert.match(mark.image.src, new RegExp(shown.src.split("/").at(-1)));
  }
});

test("wide artworks show their own lettering, never another logo", () => {
  for (const logo of LOGOS.slice(0, 2)) assert.equal(toolbarLogo(logo), logo);
  for (const src of alternatives) {
    const logo = LOGOS.find((entry) => entry.src === src);
    const { toolbar } = logo;
    assert.ok(toolbar?.crop, src);
    assert.ok(!LOGOS.some((other) => other.src === toolbar.src), src);
    assert.ok(
      publicAssets.some(({ file }) => file === toolbar.src),
      src,
    );
    assert.ok(variants.crops[toolbar.src], `Build the crop of ${src}`);
    const { crop } = toolbar;
    assert.ok(crop.left + crop.width <= logo.width, src);
    assert.ok(crop.top + crop.height <= logo.height, src);
    // The crop keeps the artwork's proportions and reads at toolbar height.
    const ratio = toolbar.width / toolbar.height;
    assert.ok(Math.abs(ratio - crop.width / crop.height) < 0.02, src);
    assert.ok(ratio >= 2 && ratio <= 3.2, src);
    assert.ok(toolbar.height >= 120, src);
    assert.deepEqual(toolbarLogo(logo), {
      name: logo.name,
      src: toolbar.src,
      width: toolbar.width,
      height: toolbar.height,
    });
  }
});
