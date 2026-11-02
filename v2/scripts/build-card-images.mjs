import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { publicAssets } from "../card-game/public-assets.mjs";
import { reuseVariants } from "./card-image-cache.mjs";

const check = process.argv.includes("--check");
const reencode = process.argv.includes("--reencode");
if (check && reencode)
  throw new Error("Use either --check or --reencode, not both.");
const root = new URL("../card-game/", import.meta.url);
const manifestFile = new URL("image-variants.json", root);
const settings = Object.freeze({
  quality: 88,
  alphaQuality: 100,
  cardWidth: 512,
  effort: 6,
  phoneSize: 960,
});
// Phone stages fit inside phoneSize on their longer side. Adding this size
// left the stage and card encodes alone, so their bytes are still reused.
const encodeKeys = ["quality", "alphaQuality", "cardWidth", "effort"];
const pick = (value) =>
  JSON.stringify(encodeKeys.map((key) => value?.[key] ?? null));
const phoneFit = {
  width: settings.phoneSize,
  height: settings.phoneSize,
  fit: "inside",
  withoutEnlargement: true,
};
const hash = (body) => createHash("sha256").update(body).digest("hex");
const files = publicAssets
  .map(({ file }) => file)
  .filter(
    (file) =>
      /\.(png|webp)$/.test(file) && !file.startsWith("assets/optimized/"),
  )
  .sort();
const pathFor = (source, size) => {
  const extension = source.split(".").at(-1);
  const name = source
    .replace(/^assets\//, "")
    .slice(0, -(extension.length + 1));
  return `assets/optimized/${size}/${extension}/${name}.webp`;
};
async function writeChanged(file, body) {
  const target = new URL(file, root);
  let old;
  try {
    old = await readFile(target);
  } catch {}
  if (old?.equals(Buffer.from(body))) return;
  await mkdir(dirname(fileURLToPath(target)), { recursive: true });
  await writeFile(target, body);
}
async function sameAlpha(source, target, width) {
  const original = sharp(source);
  if (typeof width === "object") original.resize(width);
  else if (width) original.resize({ width, withoutEnlargement: true });
  const before = await original.ensureAlpha().raw().toBuffer();
  const after = await sharp(target).ensureAlpha().raw().toBuffer();
  if (before.length !== after.length)
    throw new Error("Image alpha dimensions changed.");
  for (let i = 3; i < before.length; i += 4)
    if (before[i] !== after[i]) throw new Error("Image alpha values changed.");
}
const records = {};
let pngBytes = 0,
  stagePngBytes = 0,
  cardBytes = 0,
  phoneBytes = 0;
let old;
try {
  old = JSON.parse(await readFile(manifestFile, "utf8"));
} catch {}
if (
  check &&
  (old?.version !== 1 ||
    JSON.stringify(old.settings) !== JSON.stringify(settings) ||
    JSON.stringify(Object.keys(old.images).sort()) !== JSON.stringify(files))
)
  throw new Error(
    "Image sources or settings changed. Run npm run v2:card:images:build.",
  );

const settingsMatch =
  old?.version === 1 && pick(old.settings) === pick(settings);
const phoneMatch =
  settingsMatch && old.settings.phoneSize === settings.phoneSize;
let next = 0,
  encoded = 0,
  reusedCount = 0;
async function build() {
  while (next < files.length) {
    const file = files[next++];
    const source = await readFile(new URL(file, root));
    const sourceHash = hash(source);
    const metadata = await sharp(source).metadata();
    const png = file.endsWith(".png");
    const stage = png ? pathFor(file, "stage") : file;
    let stageBody = source;
    const reused = check
      ? null
      : await reuseVariants({
          saved: old?.images?.[file],
          sourceHash,
          stage,
          cardPath: pathFor(file, "card"),
          settingsMatch,
          reencode,
          read: (path) => readFile(new URL(path, root)),
          hash,
        });
    if (!check) reused ? reusedCount++ : encoded++;
    if (png) {
      if (check) {
        if (
          old.images[file].sourceHash !== sourceHash ||
          old.images[file].stage !== stage
        )
          throw new Error(`Image source changed: ${file}`);
        stageBody = await readFile(new URL(stage, root));
        if (hash(stageBody) !== old.images[file].stageHash)
          throw new Error(`Image output changed: ${stage}`);
      } else if (reused) stageBody = reused.stageBody;
      else stageBody = await sharp(source).webp(settings).toBuffer();
      const result = await sharp(stageBody).metadata();
      if (result.width !== metadata.width || result.height !== metadata.height)
        throw new Error(`Image dimensions changed: ${file}`);
      if (metadata.hasAlpha) await sameAlpha(source, stageBody);
      if (!check && !reused) await writeChanged(stage, stageBody);
      pngBytes += source.length;
      stagePngBytes += stageBody.length;
    }
    let card = stage,
      cardBody = stageBody;
    if (check) {
      const saved = old.images[file];
      if (
        saved.sourceHash !== sourceHash ||
        saved.stage !== stage ||
        saved.stageHash !== hash(stageBody)
      )
        throw new Error(`Image source changed: ${file}`);
      if (saved.card !== stage) {
        card = pathFor(file, "card");
        if (saved.card !== card || metadata.width <= settings.cardWidth)
          throw new Error(`Image card path changed: ${file}`);
        cardBody = await readFile(new URL(card, root));
        if (
          hash(cardBody) !== saved.cardHash ||
          cardBody.length >= Math.min(source.length, stageBody.length)
        )
          throw new Error(`Image card output changed: ${card}`);
      }
    } else if (reused) {
      card = reused.card;
      cardBody = reused.cardBody;
    } else if (metadata.width > settings.cardWidth) {
      const candidate = await sharp(source)
        .resize({ width: settings.cardWidth, withoutEnlargement: true })
        .webp(settings)
        .toBuffer();
      if (candidate.length < Math.min(source.length, stageBody.length)) {
        card = pathFor(file, "card");
        cardBody = candidate;
        await writeChanged(card, cardBody);
      }
    }
    if (card !== stage) {
      const result = await sharp(cardBody).metadata();
      if (
        result.width !== settings.cardWidth ||
        result.height !==
          Math.round((metadata.height * settings.cardWidth) / metadata.width)
      )
        throw new Error(`Image card dimensions changed: ${card}`);
      if (metadata.hasAlpha)
        await sameAlpha(source, cardBody, settings.cardWidth);
    }
    cardBytes += cardBody.length;
    const phone = await phoneVariant(
      file,
      source,
      metadata,
      stage,
      stageBody,
      sourceHash,
    );
    phoneBytes += phone.body.length;
    records[file] = {
      sourceHash,
      stage,
      stageHash: hash(stageBody),
      card,
      cardHash: hash(cardBody),
      phone: phone.path,
      phoneHash: hash(phone.body),
    };
  }
}
// A painting larger than phoneSize gets a smaller stage for narrow screens:
// a 1672x941 scene decodes to about 6 MB, its phone copy to about 2 MB.
async function phoneVariant(
  file,
  source,
  metadata,
  stage,
  stageBody,
  sourceHash,
) {
  if (Math.max(metadata.width, metadata.height) <= settings.phoneSize)
    return { path: stage, body: stageBody };
  const path = pathFor(file, "phone");
  const saved = old?.images?.[file];
  let body = null;
  if (
    check ||
    (phoneMatch &&
      !reencode &&
      saved?.sourceHash === sourceHash &&
      saved.phone === path)
  ) {
    try {
      body = await readFile(new URL(path, root));
    } catch {}
    if (body && hash(body) !== saved?.phoneHash) body = null;
    if (check && (!body || saved.phone !== path))
      throw new Error(`Image phone output changed: ${path}`);
  }
  if (!body) {
    body = await sharp(source).resize(phoneFit).webp(settings).toBuffer();
    await writeChanged(path, body);
  }
  const result = await sharp(body).metadata();
  const scale = settings.phoneSize / Math.max(metadata.width, metadata.height);
  if (
    result.width !== Math.round(metadata.width * scale) ||
    result.height !== Math.round(metadata.height * scale)
  )
    throw new Error(`Image phone dimensions changed: ${path}`);
  if (metadata.hasAlpha) await sameAlpha(source, body, phoneFit);
  return { path, body };
}
await Promise.all(Array.from({ length: 2 }, build));
const manifest = {
  version: 1,
  settings,
  images: Object.fromEntries(files.map((file) => [file, records[file]])),
};
const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (check) {
  if ((await readFile(manifestFile, "utf8")) !== text)
    throw new Error(
      "Image variants changed. Run npm run v2:card:images:build.",
    );
} else await writeChanged("image-variants.json", text);

// The opening scene shows no fixed portrait, so nothing is preloaded: a
// preload the first paint does not use only draws a browser warning.
const preload = `    <!-- card-image-preload:start -->
    <!-- card-image-preload:end -->`;
const indexFile = new URL("index.html", root);
const index = await readFile(indexFile, "utf8");
const marked =
  /    <!-- card-image-preload:start -->[\s\S]*?    <!-- card-image-preload:end -->/;
const initial =
  /    <link rel="preload" as="image" href="\.\/assets\/keeper-right\.png" \/>/;
if (!marked.test(index) && !initial.test(index))
  throw new Error(
    "Keep the generated card image preload marker in index.html.",
  );
const updated = index.replace(marked.test(index) ? marked : initial, preload);
if (check && index !== updated)
  throw new Error(
    "The image preload changed. Run npm run v2:card:images:build.",
  );
if (!check && index !== updated) await writeFile(indexFile, updated);
console.log(
  `Card image variants ${check ? "current" : "built"}: ${files.length} sources${check ? "" : ` (${reusedCount} reused, ${encoded} encoded)`}; PNG stage bytes ${pngBytes} -> ${stagePngBytes}; card bytes ${cardBytes}; phone bytes ${phoneBytes}.`,
);
