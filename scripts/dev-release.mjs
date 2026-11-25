#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const NOT_RUST = [
  "v2/card-game/",
  "v2/orchestrator-rust/src/card_shared/",
  "v2/orchestrator-rust/src/card_narrative/",
  "v2/content/",
];
const IMAGE = [
  "Dockerfile",
  ".dockerignore",
  "deploy/",
  "models/card-policy/",
  "v2/core-c/",
  "v2/ai-model-rust/",
  "v2/orchestrator-rust/",
  "scripts/build-release-image.sh",
  "scripts/compile-release-binary.sh",
  "scripts/release-rustc-wrapper.sh",
];
const MEDIA = ["png", "webp", "jpg", "jpeg", "gif", "avif", "mp3", "m4a", "ogg", "wav", "mp4", "webm"];
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 });

export function imageInput(file) {
  if (NOT_RUST.some((dir) => file.startsWith(dir)) && !file.endsWith(".rs"))
    return false;
  return IMAGE.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path));
}

const isMedia = (type) =>
  !type.startsWith("image/svg+xml") && /^(image|audio|video)\//.test(type);

export function neededMedia(assets, serving, changed) {
  const needed = assets.filter(({ file, contentType, source, offset = 0 }) => {
    if (!isMedia(contentType)) return false;
    const entry = serving[`card-game/${file}`];
    return (
      !changed ||
      changed.has(`v2/card-game/${source || file}`) ||
      !entry ||
      entry.source !== (source && `card-game/${source}`) ||
      (entry.offset ?? 0) !== offset
    );
  });
  return [...new Set(needed.map(({ file, source }) => `v2/card-game/${source || file}`))];
}

export function pack({ manifest, image, imageDir, serving, servingText, out }) {
  const dirs = Object.fromEntries(Object.keys(manifest.dirs).map((dir) => [dir, dir]));
  const text = `${JSON.stringify({ ...manifest, dirs }, null, 1)}\n`;
  const inImage = new Map();
  for (const [key, entry] of Object.entries(image.files))
    if (!entry.source && !inImage.has(entry.sha256)) inImage.set(entry.sha256, key);
  const onMachine = new Set(Object.values(serving.files).map((entry) => entry.sha256));
  const place = (located, key) => {
    const [dir, ...rest] = key.split("/");
    return join(located[dir], ...rest);
  };
  const work = mkdtempSync(join(tmpdir(), "dev-release-"));
  const links = [];
  let objects = 0;
  try {
    mkdirSync(join(work, "objects"));
    for (const [key, entry] of Object.entries(manifest.files)) {
      if (entry.source) continue;
      const path = join(work, "tree", key);
      mkdirSync(dirname(path), { recursive: true });
      const same = image.files[key]?.sha256 === entry.sha256 && !image.files[key].source;
      const target = same ? key : inImage.get(entry.sha256);
      if (target) {
        symlinkSync(join(imageDir, place(image.dirs, target)), path);
        continue;
      }
      links.push(`${entry.sha256} ${key}\n`);
      const object = join(work, "objects", entry.sha256);
      if (onMachine.has(entry.sha256) || existsSync(object)) continue;
      copyFileSync(place(manifest.dirs, key), object);
      objects += 1;
    }
    writeFileSync(join(work, "tree/manifest.json"), text);
    writeFileSync(join(work, "links"), links.join(""));
    execFileSync("tar", ["-czf", resolve(out), "-C", work, "tree", "objects", "links"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { bytes: statSync(out).size, objects, unchanged: text === servingText };
}

function served(dir) {
  const [imageDir, commit] = readFileSync(join(dir, "serving"), "utf8").split("\n");
  const read = (name) => readFileSync(join(dir, name), "utf8");
  return { imageDir, commit, image: JSON.parse(read("image.json")), servingText: read("serving.json") };
}

async function materialize(dir, commit) {
  const patterns = [
    "/*",
    "!/*/",
    "/scripts/",
    "/v2/scripts/",
    "/v2/card-game/",
    ...MEDIA.map((ext) => `!/v2/card-game/**/*.${ext}`),
    "/v2/orchestrator-rust/src/card_shared/",
    "/v2/orchestrator-rust/src/card_narrative/",
  ];
  execFileSync("git", ["sparse-checkout", "set", "--no-cone", "--stdin"], {
    input: `${patterns.join("\n")}\n`,
  });
  let changed = null;
  if (commit)
    try {
      changed = new Set(git("diff", "--name-only", commit, "HEAD", "--", "v2/card-game").split("\n"));
    } catch {
      console.error(`[dev-release] ${commit.slice(0, 7)} is not in this clone; reading every media file`);
    }
  const { publicAssets } = await import(pathToFileURL(resolve("v2/card-game/public-assets.mjs")));
  const serving = JSON.parse(served(dir).servingText).files;
  const needed = neededMedia(publicAssets, serving, changed);
  if (needed.length)
    execFileSync("git", ["sparse-checkout", "add", "--stdin"], {
      input: needed.map((path) => `/${path}\n`).join(""),
    });
  console.log(`media=${needed.length}`);
}

const [command, ...args] = process.argv.slice(2);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (command === "image-input") {
    let files = null;
    try {
      files = git("diff", "--name-only", "--no-renames", args[0], args[1]).split("\n").filter(Boolean);
    } catch {}
    const file = files?.find(imageInput);
    const reason = !files
      ? "no image commit to compare with"
      : file
        ? `${file} is built into the image`
        : `no image input changed since ${args[0].slice(0, 7)}`;
    console.log(`image=${!files || Boolean(file)}\nreason=${reason}`);
  } else if (command === "materialize") {
    await materialize(args[0], args[1]);
  } else if (command === "pack") {
    const { imageDir, commit, image, servingText } = served(args[0]);
    const result = pack({
      manifest: JSON.parse(readFileSync(args[1], "utf8")),
      image,
      imageDir,
      serving: JSON.parse(servingText),
      servingText,
      out: args[2],
    });
    console.log(`serving=${commit}`);
    for (const [key, value] of Object.entries(result)) console.log(`${key}=${value}`);
  } else {
    console.error(
      "Usage: dev-release.mjs image-input <image commit> <commit> | materialize <serving dir> [<commit>] | pack <serving dir> <manifest> <archive> (docs/design/fast-deploys.md)",
    );
    process.exit(2);
  }
}
