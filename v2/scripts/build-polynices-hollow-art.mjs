// Flatten the Polynices burial cutouts onto the empty Hollow and bake the
// shade's translucency (#2301). The design studies in docs/design/assets/
// polynices are the masters; this script writes the shipping WebPs and their
// provenance. `--check` rebuilds in memory and fails on any difference.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";

const check = process.argv.includes("--check");
const repo = new URL("../../", import.meta.url);
const studies = "docs/design/assets/polynices/";
const out = "v2/card-game/assets/greek-drama/";
const provenanceFile = `${out}polynices-hollow-provenance.json`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const load = (path) => readFile(new URL(path, repo));
const canvas = { width: 1672, height: 941 };
const encoding = {
  format: "webp",
  quality: 88,
  alphaQuality: 100,
  effort: 6,
  smartSubsample: true,
};
const { format, ...webp } = encoding;

// The layer review (layers.html) stretches every cutout over the common frame.
// Anointed and shrouded share one adjustment: 83% scale from the top left,
// then 40 px right and 70 px down. Fallen and grave fill the frame.
const care = { scale: 0.83, left: 40, top: 70 };
const states = [
  { state: "fallen", layer: "fallen", flag: null },
  {
    state: "anointed",
    layer: "anointed",
    flag: "greek-polynices-anointed",
    placement: care,
  },
  {
    state: "veiled",
    layer: "shrouded",
    flag: "greek-polynices-veiled",
    placement: care,
  },
  { state: "buried", layer: "grave", flag: "greek-burial-performed" },
];
const lights = [
  { period: "day", suffix: "" },
  { period: "night", suffix: "-night" },
];

async function source(file) {
  const bytes = await load(`${studies}${file}`);
  const meta = await sharp(bytes).metadata();
  return {
    record: {
      repository_path: `${studies}${file}`,
      sha256: hash(bytes),
      dimensions: [meta.width, meta.height],
    },
    bytes,
  };
}

async function layerAt(bytes, placement) {
  const full = await sharp(bytes)
    .ensureAlpha()
    .resize({ ...canvas, fit: "fill" })
    .png()
    .toBuffer();
  if (!placement) return { input: full, left: 0, top: 0 };
  const width = Math.round(canvas.width * placement.scale);
  const height = Math.round(canvas.height * placement.scale);
  const scaled = await sharp(full)
    .resize({ width, height, fit: "fill" })
    .png()
    .toBuffer();
  return { input: scaled, left: placement.left, top: placement.top };
}

const assets = [];
const outputs = new Map();

for (const { period, suffix } of lights) {
  const backdrop = await source(`hollow-empty-${period}-study.png`);
  const base = await sharp(backdrop.bytes)
    .removeAlpha()
    .resize({ ...canvas, fit: "fill" })
    .png()
    .toBuffer();
  for (const { state, layer, flag, placement } of states) {
    const cutout = await source(`polynices-${layer}${suffix}-cutout.png`);
    const body = await sharp(base)
      .composite([await layerAt(cutout.bytes, placement)])
      .removeAlpha()
      .webp(webp)
      .toBuffer();
    const file = `polynices-hollow-${state}-${period}.webp`;
    outputs.set(file, body);
    assets.push({
      id: `polynices-hollow-${state}-${period}`,
      file,
      place: "greek-polynices-hollow",
      state,
      flag,
      period,
      dimensions: [canvas.width, canvas.height],
      transparent_background: false,
      sources: [
        { role: "empty Hollow backdrop", ...backdrop.record },
        { role: `${layer} cutout layer`, ...cutout.record },
      ],
      compositing: placement
        ? `Backdrop and cutout each fitted to ${canvas.width} x ${canvas.height}; cutout scaled to ${placement.scale * 100}% from the top left and placed ${placement.left} px right, ${placement.top} px down (the layers.html care adjustment), then flattened. The cutout's own contact shadow is kept; no shadow is added.`
        : `Backdrop and cutout each fitted to ${canvas.width} x ${canvas.height} and flattened at the origin (the layers.html placement). The cutout's own contact shadow is kept; no shadow is added.`,
      bytes: body.length,
      sha256: hash(body),
    });
  }
}

// The shade study is near opaque in its body (README). Bake the review's
// see-through look: the head and hand stay most present, the body thins
// toward the feet, and the colour lifts slightly toward moonlit grey.
const shadeOpacity = { top: 0.88, middle: 0.72, bottom: 0.45, middleAt: 0.5 };
const shadeTint = { rgb: [222, 230, 238], amount: 0.1 };
{
  const shade = await source("shade-study.png");
  const { data, info } = await sharp(shade.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const { top, middle, bottom, middleAt } = shadeOpacity;
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    const opacity =
      t < middleAt
        ? top + (middle - top) * (t / middleAt)
        : middle + (bottom - middle) * ((t - middleAt) / (1 - middleAt));
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++)
        data[i + c] = Math.round(
          data[i + c] + (shadeTint.rgb[c] - data[i + c]) * shadeTint.amount,
        );
      data[i + 3] = Math.round(data[i + 3] * opacity);
    }
  }
  const body = await sharp(data, { raw: { width, height, channels: 4 } })
    .webp(webp)
    .toBuffer();
  outputs.set("polynices-shade.webp", body);
  assets.push({
    id: "polynices-shade",
    file: "polynices-shade.webp",
    role: "resident portrait",
    facing: "left",
    dimensions: [width, height],
    transparent_background: true,
    sources: [{ role: "shade study", ...shade.record }],
    compositing: `Alpha multiplied by a vertical opacity ramp (${top} at the top, ${middle} at mid height, ${bottom} at the feet); colour mixed ${shadeTint.amount * 100}% toward rgb(${shadeTint.rgb.join(", ")}). No crop or resize.`,
    bytes: body.length,
    sha256: hash(body),
  });
}

const provenance = {
  created: "2026-11-04",
  issue: "https://github.com/cenetex/cosyworld/issues/2301",
  generator:
    "Composited by v2/scripts/build-polynices-hollow-art.mjs from the built-in image tool studies in docs/design/assets/polynices (#2291, #2296). Their prompts are in prompts.json and layer-prompts.json there.",
  brief:
    "Polynices' Hollow in four burial states (fallen, anointed, veiled, buried) by day and night, each the matching transparent cutout flattened onto the empty Hollow of the same light, so all four states match. The owner chose the grave cutout over the finished buried paintings. Plus Polynices' shade portrait with its translucency baked in, so it reads as a shade without CSS effects.",
  rebuild: "node v2/scripts/build-polynices-hollow-art.mjs [--check]",
  encoding,
  canvas: [canvas.width, canvas.height],
  assets,
};
outputs.set(
  "polynices-hollow-provenance.json",
  Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`),
);

let stale = 0;
for (const [file, body] of outputs) {
  let existing;
  try {
    existing = await load(`${out}${file}`);
  } catch {}
  if (existing?.equals(body)) continue;
  stale++;
  if (check) console.error(`Stale Polynices art: ${out}${file}`);
  else await writeFile(new URL(`${out}${file}`, repo), body);
}
if (check && stale) {
  console.error("Run node v2/scripts/build-polynices-hollow-art.mjs.");
  process.exit(1);
}
console.log(
  `Polynices Hollow art: ${outputs.size} files, ${check ? "checked" : `${stale} written`}.`,
);
