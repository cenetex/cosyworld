import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { LOGOS, transparentLogo } from "../v2/card-game/title-logo.mjs";
import { publicAssets } from "../v2/card-game/public-assets.mjs";

test("every title keeps its identity and serves a full-size alpha master", async () => {
  for (const logo of LOGOS) {
    const source = transparentLogo(logo.src);
    assert.notEqual(source, logo.src);
    assert.ok(publicAssets.some(({ file }) => file === source));
    const image = sharp(
      new URL(`../v2/card-game/${source}`, import.meta.url).pathname,
    );
    const metadata = await image.metadata();
    assert.ok(metadata.hasAlpha && metadata.width >= 1700);
    const { min, max } = (await image.stats()).channels[3];
    assert.equal(min, 0);
    assert.equal(max, 255);
  }
  assert.equal(transparentLogo("custom.webp"), "custom.webp");
});

test("title rarity follows image alpha, not a rectangular outline", () => {
  const css = readFileSync(
    new URL("../v2/card-game/style.css", import.meta.url),
    "utf8",
  );
  const rule = css.match(
    /:root\[data-world-tier\] \.title-intro > img \{([^}]+)\}/,
  )[1];
  assert.match(rule, /filter: drop-shadow/);
  assert.match(rule, /var\(--world-tier\)/);
  assert.doesNotMatch(rule, /box-shadow|border|outline/);
});
