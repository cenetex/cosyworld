import { readFileSync, mkdirSync } from "node:fs";
import { dirname, basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "v2", "card-game");
const faces = JSON.parse(readFileSync(join(root, "assets", "discord-faces.json"), "utf8"));
const SIZE = 256;

for (const [portrait, box] of Object.entries(faces)) {
  const source = join(root, portrait);
  const { width, height } = await sharp(source).metadata();
  const side = Math.round(box.size * width);
  const left = Math.round(box.x * width);
  const top = Math.round(box.y * height);
  const out = join(root, "assets", "faces", `${basename(dirname(portrait))}-${basename(portrait, extname(portrait))}.webp`);
  mkdirSync(dirname(out), { recursive: true });
  await sharp(source)
    .extract({ left, top, width: side, height: Math.min(side, height - top) })
    .resize(SIZE, SIZE)
    .webp({ quality: 90 })
    .toFile(out);
}
console.log(`wrote ${Object.keys(faces).length} face avatars`);
