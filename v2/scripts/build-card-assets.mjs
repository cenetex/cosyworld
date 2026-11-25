import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publicAssets } from "../card-game/public-assets.mjs";

const manifestPath = new URL(
  "../card-game/media-manifest.json",
  import.meta.url,
);
const option = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  if (!process.argv[index + 1]) throw new Error(`${name} needs a path`);
  return process.argv[index + 1];
};
const check = process.argv.includes("--check");
const manifestOut = option("--manifest");
const releaseOut = option("--release");
const hash = (body) => createHash("sha256").update(body).digest("hex");
const source = (file) => new URL(`../card-game/${file}`, import.meta.url);
function assetBytes(asset) {
  const bytes = readFileSync(source(asset.source || asset.file));
  const offset = asset.offset || 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length)
    throw new Error(`Invalid source offset for ${asset.file}`);
  if (asset.sourceHash && hash(bytes) !== asset.sourceHash)
    throw new Error(
      `Music source changed: ${asset.source}. Run npm run v2:card:music:build.`,
    );
  if (
    asset.source &&
    !publicAssets.some((entry) => entry.file === asset.source && !entry.source)
  )
    throw new Error(`Publish the original source for ${asset.file}`);
  return bytes.subarray(offset);
}
const media = Object.fromEntries(
  publicAssets
    .filter(({ contentType }) => /^(image|audio)\//.test(contentType))
    .map((asset) => [asset.file, hash(assetBytes(asset))]),
);
const manifest = `${JSON.stringify(media, null, 2)}\n`;
if (check || manifestOut || releaseOut) {
  if (readFileSync(manifestPath, "utf8") !== manifest)
    throw new Error(
      "Card media hashes changed. Run npm run v2:card:assets:build.",
    );
} else writeFileSync(manifestPath, manifest);
const assets = publicAssets.map((asset) => {
  const bytes = assetBytes(asset);
  return { ...asset, hash: hash(bytes), size: bytes.length };
});
const identity = hash(JSON.stringify(assets.map(({ file, hash }) => [file, hash])));

const isMedia = (type) =>
  !type.startsWith("image/svg+xml") && /^(image|audio|video)\//.test(type);
const files = Object.fromEntries(
  assets.map(({ file, contentType, hash, size, source, offset }) => [
    `card-game/${file}`,
    {
      type: contentType,
      sha256: hash,
      size,
      ...(source && { source: `card-game/${source}`, offset }),
    },
  ]),
);
const dirs = {
  "card-game": new URL("../card-game/", import.meta.url),
  card_shared: new URL(
    "../orchestrator-rust/src/card_shared/",
    import.meta.url,
  ),
};
const rules = Object.keys(
  JSON.parse(readFileSync(new URL("rules.json", dirs.card_shared), "utf8")),
);
const server = [
  "card_shared/rules.json",
  ...rules.map((version) => `card_shared/engine-v${version}.js`),
];
for (const key of server) {
  const [dir, file] = key.split("/");
  const bytes = readFileSync(new URL(file, dirs[dir]));
  files[key] = { sha256: hash(bytes), size: bytes.length };
}
const full = (located) =>
  `${JSON.stringify({ sha256: identity, dirs: located, files }, null, 1)}\n`;
const here = Object.fromEntries(
  Object.entries(dirs).map(([dir, url]) => [dir, fileURLToPath(url)]),
);
if (manifestOut === "-") process.stdout.write(full(here));
else if (manifestOut) writeFileSync(manifestOut, full(here));
if (releaseOut) {
  const copy = (layer, dir, file) => {
    const out = join(releaseOut, layer, dir, file);
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(new URL(file, dirs[dir]), out);
  };
  for (const { file, contentType, source } of assets)
    if (!source)
      copy(isMedia(contentType) ? "media" : "text", "card-game", file);
  for (const key of server) copy("text", ...key.split("/"));
  const named = Object.fromEntries(Object.keys(dirs).map((dir) => [dir, dir]));
  writeFileSync(join(releaseOut, "text", "manifest.json"), full(named));
}
(manifestOut === "-" ? console.error : console.log)(
  `Card assets ${identity}: ${publicAssets.length} files${releaseOut ? ` -> ${releaseOut}` : ""}.`,
);
