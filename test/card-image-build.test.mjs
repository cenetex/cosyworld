import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const execute = promisify(execFile);
const source = "assets/changed.webp";
const unchanged = "assets/unchanged.webp";

async function painting(green, transparent = false) {
  const width = 1024;
  const pixels = Buffer.alloc(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const subject = x >= 256 && x < 768 && y >= 256 && y < 768;
      pixels[offset] = subject ? (green ? 30 : 220) : 40;
      pixels[offset + 1] = subject ? (green ? 220 : 30) : 50;
      pixels[offset + 2] = subject ? 30 : 90;
      pixels[offset + 3] = transparent && !subject ? 0 : 255;
    }
  }
  return sharp(pixels, { raw: { width, height: width, channels: 4 } })
    .webp({ lossless: true })
    .toBuffer();
}

describe("phone image rebuilds", () => {
  it("refreshes changed art and alpha without rewriting unchanged variants", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cosy-card-images-"));
    const game = join(directory, "v2", "card-game");
    const scripts = join(directory, "v2", "scripts");
    const bytes = (file) => readFile(join(game, file));
    const manifest = async () =>
      JSON.parse(await bytes("image-variants.json")).images;
    const build = (...args) =>
      execute(process.execPath, [
        join(scripts, "build-card-images.mjs"),
        ...args,
      ]);
    const outputs = async (record) =>
      Promise.all([record.stage, record.card, record.phone].map(bytes));
    try {
      await mkdir(join(game, "assets"), { recursive: true });
      await mkdir(scripts, { recursive: true });
      await symlink(
        fileURLToPath(new URL("../node_modules", import.meta.url)),
        join(directory, "node_modules"),
        "junction",
      );
      for (const name of ["build-card-images.mjs", "card-image-cache.mjs"])
        await copyFile(
          new URL(`../v2/scripts/${name}`, import.meta.url),
          join(scripts, name),
        );
      await writeFile(
        join(game, "public-assets.mjs"),
        `export const publicAssets = ${JSON.stringify([source, unchanged])}.map(file => ({ file }));\n`,
      );
      await writeFile(
        join(game, "index.html"),
        "    <!-- card-image-preload:start -->\n    <!-- card-image-preload:end -->\n",
      );
      const original = await painting(false);
      await writeFile(join(game, source), original);
      await writeFile(join(game, unchanged), original);
      await build();
      await build("--check");
      const first = await manifest();
      const firstPhone = await bytes(first[source].phone);
      const unchangedBytes = await outputs(first[unchanged]);

      // A changed opaque source used to keep the old phone pixels silently.
      await writeFile(join(game, source), await painting(true));
      await expect(build("--check")).rejects.toThrow("Image source changed");
      expect(await bytes(first[source].phone)).toEqual(firstPhone);
      await build();
      const recoloured = await manifest();
      const phone = await bytes(recoloured[source].phone);
      expect(phone).not.toEqual(firstPhone);
      expect(recoloured[source].phoneHash).not.toBe(first[source].phoneHash);
      const centre = await sharp(phone)
        .extract({ left: 480, top: 480, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer();
      expect(centre[1]).toBeGreaterThan(180);
      expect(centre[0]).toBeLessThan(80);
      expect(recoloured[unchanged]).toEqual(first[unchanged]);
      expect(await outputs(recoloured[unchanged])).toEqual(unchangedBytes);
      await build("--check");

      // Removing a background must also refresh the phone's alpha channel.
      await writeFile(join(game, source), await painting(true, true));
      await build();
      const cutout = await manifest();
      const cutoutPhone = await bytes(cutout[source].phone);
      expect(cutoutPhone).not.toEqual(phone);
      const alpha = await sharp(cutoutPhone)
        .extractChannel("alpha")
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(alpha.info.width).toBe(960);
      expect(alpha.info.height).toBe(960);
      expect(alpha.data[0]).toBe(0);
      expect(alpha.data[480 * 960 + 480]).toBe(255);
      expect(await outputs(cutout[unchanged])).toEqual(unchangedBytes);
      await build("--check");

      const accepted = await outputs(cutout[source]);
      await build();
      expect(await manifest()).toEqual(cutout);
      expect(await outputs(cutout[source])).toEqual(accepted);
      expect(await outputs(cutout[unchanged])).toEqual(unchangedBytes);

      // Check mode reports corrupt committed output rather than repairing it.
      await writeFile(join(game, cutout[source].phone), "corrupt phone");
      await expect(build("--check")).rejects.toThrow(
        "Image phone output changed",
      );
      expect(await bytes(cutout[source].phone)).toEqual(
        Buffer.from("corrupt phone"),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
