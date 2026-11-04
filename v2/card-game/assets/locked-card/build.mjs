// Run from any directory: node v2/card-game/assets/locked-card/build.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = new URL("./", import.meta.url);
const game = new URL("../../", here);
const repo = new URL("../../../../", here);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (url) => JSON.parse(await readFile(url, "utf8"));
const source = await json(new URL("iron-keyhole-source.json", here));
const original = await readFile(new URL(source.file, here));
assert.equal(original.length, source.bytes);
assert.equal(hash(original), source.sha256);
const metadata = await sharp(original).metadata();
assert.equal(metadata.width, 1024);
assert.equal(metadata.height, 1536);
assert.equal(metadata.hasAlpha, false);

const asset = "assets/card-back-locked.webp";
const settings = { alphaQuality: 100, effort: 6, smartSubsample: true };
let encoded;
let quality;
for (const candidate of [88, 84, 80, 76, 72, 68, 64, 60, 57, 54, 50, 46, 42]) {
  const bytes = await sharp(original)
    .webp({ ...settings, quality: candidate })
    .toBuffer();
  if (bytes.length <= 300_000) {
    encoded = bytes;
    quality = candidate;
    break;
  }
}
assert.ok(encoded, "Cannot encode the native canvas within 300,000 bytes");
await writeFile(new URL(asset, game), encoded);
for (const script of ["build-card-images.mjs", "build-card-assets.mjs"])
  execFileSync(process.execPath, [`v2/scripts/${script}`], {
    cwd: fileURLToPath(repo),
    stdio: "inherit",
  });

const variants = await json(new URL("image-variants.json", game));
const variant = variants.images[asset];
assert.equal(variant.sourceHash, hash(encoded));
async function describe(file, encoding) {
  const bytes = await readFile(new URL(file, game));
  const info = await sharp(bytes).metadata();
  return {
    file,
    sha256: hash(bytes),
    bytes: bytes.length,
    width: info.width,
    height: info.height,
    has_alpha: info.hasAlpha,
    encoding,
  };
}
const provenance = {
  asset,
  created: "2026-11-03",
  updated: "2026-11-04",
  status: "final",
  requirements:
    "1024 by 1536, opaque full bleed. Carved oak lid with a recessed fixed iron keyhole plate, no padlock shackle and no lettering.",
  generation: {
    tool: source.tool,
    id: source.generation_id,
    transparent_background: false,
    prompt_summary: source.prompt_summary,
    prompt_note: source.prompt_note,
    prompt_file: "assets/locked-card/iron-keyhole-source.json",
  },
  source: {
    file: "assets/locked-card/iron-keyhole-master.png",
    source_filename: source.source_filename,
    sha256: source.sha256,
    bytes: original.length,
    width: metadata.width,
    height: metadata.height,
    has_alpha: false,
  },
  runtime: await describe(asset, {
    format: "webp",
    quality,
    ...settings,
    sharp: sharp.versions.sharp,
    webp: sharp.versions.webp,
  }),
  card: await describe(variant.card, variants.settings),
  phone: await describe(variant.phone, variants.settings),
  derivation:
    "The owner's exact final iron-keyhole PNG, encoded without resizing or cropping. Card and phone derivatives and both runtime manifests come from the existing project builders. No gameplay change.",
  replaces: {
    status: "stand-in",
    runtime_sha256:
      "0fb3993730387814ebe5486483d7894528d6ee9ae107b71eaf2968156fc233ee",
    derivation:
      "Earlier darkened copy of the unlocked card back; not the approved lock painting.",
  },
  references: [
    "assets/card-back-provenance.json",
    "assets/locked-card/iron-keyhole-source.json",
  ],
};
await writeFile(
  new URL("assets/card-back-locked-provenance.json", game),
  `${JSON.stringify(provenance, null, 2)}\n`,
);
console.log(
  `Locked lid: ${encoded.length} bytes at quality ${quality}; native canvas preserved.`,
);
