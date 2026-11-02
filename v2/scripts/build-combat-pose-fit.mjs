// Measures each cast combat painting against its plain portrait and writes
// assets/combat/pose-fit.json: how far to drop and scale the painting so
// its feet land where the plain portrait's feet stood and its figure keeps
// the plain portrait's size (#2043). Both draw in the same 2:3 figure box
// (object-fit: contain, bottom). Run after adding or replacing paintings.
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import roster from "../card-game/assets/combat/cast-roster.json" with { type: "json" };

const root = new URL("../card-game/", import.meta.url);
// The visible figure inside a 2:3 box one unit tall.
async function figure(path) {
  const image = sharp(new URL(path, root).pathname);
  const { width, height } = await image.metadata();
  const alpha = await image.ensureAlpha().extractChannel(3).raw().toBuffer();
  let top = height,
    bottom = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (alpha[y * width + x] >= 128) {
        top = Math.min(top, y);
        bottom = y + 1;
        break;
      }
  const scale = Math.min(2 / 3 / width, 1 / height);
  return {
    gap: (height - bottom) * scale,
    size: (bottom - top) * scale,
  };
}

const round = (n) => Math.round(n * 1000) / 1000;
const fits = {};
for (const identity of roster.identities) {
  if (identity.presentation === "backdrop") continue;
  const plain = await figure(identity.reference);
  const poses = await Promise.all(
    identity.poses.map((pose) =>
      figure(`assets/combat/${identity.stem}-${pose}.webp`),
    ),
  );
  // One scale per identity keeps the poses' own differences (a crouch
  // stays lower); the median pose matches the plain portrait's height.
  const sizes = poses.map((p) => p.size).sort((a, b) => a - b);
  const ratio = plain.size / sizes[Math.floor(sizes.length / 2)];
  const scale = Math.abs(ratio - 1) < 0.08 ? 1 : round(ratio);
  identity.poses.forEach((pose, i) => {
    // Scaled about the box's foot, the feet then drop onto the plain line.
    const drop = round(poses[i].gap * scale - plain.gap);
    if (scale !== 1 || Math.abs(drop) >= 0.01)
      fits[`assets/combat/${identity.stem}-${pose}.webp`] = { drop, scale };
  });
}
await writeFile(
  new URL("assets/combat/pose-fit.json", root),
  JSON.stringify(fits, null, 2) + "\n",
);
console.log(`${Object.keys(fits).length} paintings fitted`);
