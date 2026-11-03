// Preserve alpha inside authored crop rectangles; bake a registered still.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";

const root = new URL("../card-game/", import.meta.url);
const folder = "assets/greek-drama/ship-layers/";
const check = process.argv.includes("--check");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const load = (path) => readFile(new URL(path, root));
const layout = await load(`${folder}layout.json`);
const plan = JSON.parse(layout);
const previous = check ? JSON.parse(await load(`${folder}recipe.json`)) : null;
if (check && previous.layout_sha256 !== hash(layout))
  throw new Error("Ship layout changed; rebuild the art pack");
const { width, height } = plan.canvas;
const settings = { quality: 88, alphaQuality: 100, effort: 6 };
const layers = [];
const composites = [];

async function output(path, bytes) {
  let existing;
  try {
    existing = await load(path);
  } catch {}
  if (existing?.equals(bytes)) return;
  if (check) throw new Error(`Stale ship art: ${path}`);
  await writeFile(new URL(path, root), bytes);
}

function verifyCrop(bytes, crop) {
  let discardedAlphaMax = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (
        x < crop.left ||
        x >= crop.left + crop.width ||
        y < crop.top ||
        y >= crop.top + crop.height
      )
        discardedAlphaMax = Math.max(
          discardedAlphaMax,
          bytes[(y * width + x) * 4 + 3],
        );
  // A rectangular crop may omit 1/255 numerical residue, never painted detail.
  if (discardedAlphaMax > 1) throw new Error("Ship crop cuts painted pixels");
  return discardedAlphaMax;
}

for (const layer of plan.layers) {
  const source = await load(`${folder}${layer.source}`);
  if (hash(source) !== layer.source_sha256)
    throw new Error(`Changed ship master: ${layer.source}`);
  const decoded = await sharp(source)
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== width || decoded.info.height !== height)
    throw new Error(`Unregistered ship master: ${layer.source}`);
  const crop = layer.crop;
  const discardedAlphaMax = verifyCrop(decoded.data, crop);
  const cropped = await sharp(source).extract(crop).png().toBuffer();
  const file = `${folder}${layer.file}`;
  const encoded = check
    ? await load(file)
    : await sharp(cropped).webp(settings).toBuffer();
  if (
    check &&
    hash(encoded) !==
      previous.layers.find((entry) => entry.id === layer.id)?.sha256
  )
    throw new Error(`Changed ship output: ${file}`);
  if (encoded.length > 300000) throw new Error(`Oversized ship layer: ${file}`);
  const before = await sharp(cropped).ensureAlpha().raw().toBuffer();
  const after = await sharp(encoded).ensureAlpha().raw().toBuffer();
  if (before.length !== after.length)
    throw new Error("Changed crop dimensions");
  for (let i = 3; i < before.length; i += 4)
    if (before[i] !== after[i]) throw new Error(`Changed alpha: ${layer.id}`);
  await output(file, encoded);
  composites.push({ input: encoded, left: crop.left, top: crop.top });
  layers.push({
    id: layer.id,
    file,
    crop,
    attachment: layer.attachment,
    pivot: layer.pivot
      ? {
          canvas: layer.pivot,
          crop: { x: layer.pivot.x - crop.left, y: layer.pivot.y - crop.top },
        }
      : null,
    sha256: hash(encoded),
    bytes: encoded.length,
    decoded_rgba_bytes: crop.width * crop.height * 4,
    alpha_preserved_inside_crop: true,
    discarded_padding_alpha_max: discardedAlphaMax,
  });
}

const background = await load(plan.background.file);
if (hash(background) !== plan.background.sha256)
  throw new Error("The registered Pond background changed");
const backgroundSize = await sharp(background).metadata();
if (backgroundSize.width !== width || backgroundSize.height !== height)
  throw new Error("Pond background dimensions do not match the layer canvas");
const stillFile = `${folder}pond-ship-still.webp`;
const composite = await sharp({
  create: {
    width,
    height,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png()
  .toBuffer();
const still = check
  ? await load(stillFile)
  : await sharp(composite).webp(settings).toBuffer();
const composedAlpha = await sharp(composite)
  .extractChannel("alpha")
  .raw()
  .toBuffer();
const stillAlpha = await sharp(still).extractChannel("alpha").raw().toBuffer();
if (!composedAlpha.equals(stillAlpha)) throw new Error("Changed still alpha");
if (check && hash(still) !== previous.still.sha256)
  throw new Error("Changed ship still");
if (still.length > 300000) throw new Error("Oversized ship still");
await output(stillFile, still);
const croppedBytes = layers.reduce(
  (sum, layer) => sum + layer.decoded_rgba_bytes,
  0,
);
const recipe = {
  version: 1,
  layout_sha256: hash(layout),
  canvas: plan.canvas,
  background: plan.background,
  coordinate_space: "Original painting pixels; layer order is back to front.",
  encoding: settings,
  waterline_y: plan.waterline_y,
  layers,
  still: { file: stillFile, sha256: hash(still), bytes: still.length },
  memory: {
    full_canvas_rgba_bytes: width * height * 4,
    three_full_canvas_layers_rgba_bytes: width * height * 4 * layers.length,
    cropped_layers_rgba_bytes: croppedBytes,
    note: "Raw RGBA estimates only. Use either the still or the moving layers; do not retain both. Current game uses its existing static overlay.",
  },
};
await output(
  `${folder}recipe.json`,
  Buffer.from(`${JSON.stringify(recipe, null, 2)}\n`),
);
console.log(
  `${check ? "Checked" : "Built"} ${layers.length} ship layers and still; cropped RGBA ${croppedBytes} bytes.`,
);
