import { describe, expect, it, vi } from "vitest";
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

  it("paints narrow screens from the phone-sized stage", async () => {
    const source = "assets/station.png";
    const { phone, stage } = variants.images[source];
    expect(phone).not.toBe(stage);
    const meta = await sharp(await bytes(phone)).metadata();
    expect(Math.max(meta.width, meta.height)).toBe(960);
    vi.resetModules();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    try {
      const narrow = await import("../v2/card-game/images.mjs");
      expect(new URL(narrow.imageUrl(`./${source}`)).pathname).toMatch(
        new RegExp(`${phone}$`),
      );
      expect(new URL(narrow.imageUrl(`./${source}`, "card")).pathname).toMatch(
        new RegExp(`${variants.images[source].card}$`),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("publishes every variant and preloads no unused portrait", async () => {
    const files = new Set(publicAssets.map(({ file }) => file));
    for (const image of Object.values(variants.images)) {
      expect(files.has(image.stage)).toBe(true);
      expect(files.has(image.card)).toBe(true);
      expect(files.has(image.phone)).toBe(true);
    }
    const index = await bytes("index.html");
    const marked = index
      .toString()
      .match(
        /<!-- card-image-preload:start -->([\s\S]*?)<!-- card-image-preload:end -->/,
      );
    expect(marked).not.toBeNull();
    expect(marked[1]).not.toMatch(/rel="preload"/);
  });

  it("keeps the Herald's Truce a transparent floor prop at every size", async () => {
    const image = variants.images["assets/greek-drama/olive-branch.webp"];
    for (const size of ["stage", "card", "phone"]) {
      const { data, info } = await sharp(await bytes(image[size]))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixels = info.width * info.height;
      let transparent = 0,
        visible = 0;
      for (let i = 3; i < data.length; i += 4) {
        transparent += Number(data[i] === 0);
        visible += Number(data[i] >= 240);
      }
      // Catch both the original opaque rectangle and an empty replacement.
      expect(transparent / pixels, size).toBeGreaterThan(0.5);
      expect(visible / pixels, size).toBeGreaterThan(0.15);
      for (const pixel of [0, info.width - 1, pixels - info.width, pixels - 1])
        expect(data[pixel * 4 + 3], `${size} corner`).toBe(0);
    }
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
