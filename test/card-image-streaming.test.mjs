import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { imageUrl } from "../v2/card-game/images.mjs";
import variants from "../v2/card-game/image-variants.json" with { type: "json" };
import { publicAssets } from "../v2/card-game/public-assets.mjs";
import { portrait } from "../v2/card-game/scene.mjs";
import { nativePortraitFacing } from "../v2/card-game/portrait-facing.mjs";

const root = new URL("../v2/card-game/", import.meta.url);
const bytes = (file) => readFile(new URL(file, root));
const sha256 = (body) => createHash("sha256").update(body).digest("hex");

describe("card image streaming", () => {
  it("uses small cards and full scenes with the hash of their actual bytes", async () => {
    const source = "assets/vale.png";
    const variant = variants.images[source];
    const stage = new URL(imageUrl(`./${source}`));
    const card = new URL(
      imageUrl(`/card-game/${source}?view=hand&v=old#face`, "card"),
    );
    expect(stage.pathname.endsWith(variant.stage)).toBe(true);
    expect(card.pathname.endsWith(variant.card)).toBe(true);
    expect(card.pathname).not.toBe(stage.pathname);
    expect(stage.searchParams.get("v")).toBe(
      sha256(await bytes(variant.stage)),
    );
    expect(card.searchParams.get("v")).toBe(sha256(await bytes(variant.card)));
    expect(card.searchParams.get("view")).toBe("hand");
    expect(card.hash).toBe("#face");
    expect(imageUrl(card.href, "card")).toBe(card.href);
  });

  it("keeps the authored portrait identity and existing WebP scene bytes", async () => {
    const source = "assets/greek-drama/harbor-day.webp";
    const image = variants.images[source];
    expect(image.stage).toBe(source);
    expect(image.stageHash).toBe(sha256(await bytes(source)));
    expect(portrait("keeper", "right")).toBe("./assets/keeper-right.png");
    expect(nativePortraitFacing(portrait("keeper", "right"))).toBe("right");
    expect(imageUrl("https://example.invalid/portrait.png")).toBe(
      "https://example.invalid/portrait.png",
    );
    expect(imageUrl(null)).toBeNull();
  });

  it("publishes every variant and keeps the preload on the exact scene URL", async () => {
    const files = new Set(publicAssets.map(({ file }) => file));
    for (const image of Object.values(variants.images)) {
      expect(files.has(image.stage)).toBe(true);
      expect(files.has(image.card)).toBe(true);
    }
    const index = await bytes("index.html");
    const marked = index
      .toString()
      .match(
        /<!-- card-image-preload:start -->([\s\S]*?)<!-- card-image-preload:end -->/,
      );
    expect(marked).not.toBeNull();
    const preload = new URL(marked[1].match(/href="([^\"]+)"/)[1], root);
    expect(preload.href).toBe(imageUrl("./assets/keeper-right.png"));
  });

  for (const source of [
    "assets/station.png",
    "assets/vale.png",
    "assets/keeper-right.png",
  ]) {
    it(`keeps the size, visible detail, and alpha of ${source}`, async () => {
      const image = variants.images[source];
      const [original, stage, card] = await Promise.all([
        bytes(source),
        bytes(image.stage),
        bytes(image.card),
      ]);
      const [before, after, small] = await Promise.all([
        sharp(original)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }),
        sharp(stage).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
        sharp(card).metadata(),
      ]);
      expect(after.info.width).toBe(before.info.width);
      expect(after.info.height).toBe(before.info.height);
      expect(small.width).toBe(512);
      expect(stage.length).toBeLessThan(original.length * 0.2);
      expect(card.length).toBeLessThan(stage.length);
      let error = 0,
        samples = 0,
        changedAlpha = 0;
      for (let i = 0; i < before.data.length; i += 4) {
        const weight = before.data[i + 3] / 255;
        changedAlpha += Number(before.data[i + 3] !== after.data[i + 3]);
        samples += 3 * weight;
        for (let channel = 0; channel < 3; channel++)
          error +=
            (before.data[i + channel] - after.data[i + channel]) ** 2 * weight;
      }
      const psnr = 10 * Math.log10(255 ** 2 / (error / samples));
      expect(psnr).toBeGreaterThan(34);
      expect(changedAlpha).toBe(0);
    });
  }
});
