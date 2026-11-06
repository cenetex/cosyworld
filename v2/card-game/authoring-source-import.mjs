// Selected repository files supply the source and media for one editable pack.
import { assetMetadata, DRAFT_LIMITS, importPack } from "./authoring-draft.mjs";
const need = (ok, text) => {
  if (!ok) throw new Error(text);
};
const pathOk = (path) =>
  typeof path === "string" &&
  path.length <= 512 &&
  !/[\\\u0000-\u001f\u007f:?#%]/u.test(path) &&
  path.split("/").every((p) => p && p !== "." && p !== "..");
const mimes = {
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
};
const mime = (path) => mimes[path.split(".").at(-1)];
const mediaKeys = new Set([
  "art",
  "portrait",
  "backdrop",
  "overlay",
  "cardArt",
]);

function selectedFiles(files) {
  const selected = new Map();
  for (const entry of files) {
    const file = entry?.file ?? entry;
    const path = entry?.path ?? (file?.webkitRelativePath || file?.name);
    need(
      pathOk(path) && !selected.has(path),
      "Choose distinct safe relative file paths.",
    );
    need(
      Number.isSafeInteger(file?.size) &&
        file.size >= 0 &&
        typeof file.arrayBuffer === "function",
      `Choose a readable file for ${path}.`,
    );
    selected.set(path, file);
    need(
      selected.size <= 100_000,
      "Choose a directory with up to 100,000 files.",
    );
  }
  return selected;
}
export function sourcePackCandidates(files) {
  return [...selectedFiles(files).keys()]
    .filter((path) => path.split("/").at(-1) === "card-world.json")
    .sort();
}
async function read(file, max, path) {
  const size = file?.size;
  need(
    Number.isSafeInteger(size) && size >= 0 && size <= max,
    `Choose ${path} within its file size limit.`,
  );
  const buffer = await file.arrayBuffer();
  need(
    buffer instanceof ArrayBuffer &&
      buffer.byteLength === size &&
      file.size === size,
    `Read ${path} again; its bytes changed.`,
  );
  return new Uint8Array(buffer.slice(0));
}
function cardDirectory(packPath) {
  const match = packPath.match(/^(.*\/)?content\/[^/]+\/[^/]+$/u);
  return match
    ? `${match[1] || ""}card-game/`
    : packPath.slice(0, packPath.lastIndexOf("/") + 1);
}

export async function importSourcePack({
  files,
  packPath,
  bridgePath = null,
  cardRoot,
  extraPaths = [],
  origin = { kind: "file" },
}) {
  need(
    pathOk(packPath) &&
      packPath.endsWith(".json") &&
      (bridgePath === null ||
        (pathOk(bridgePath) &&
          bridgePath.endsWith(".json") &&
          bridgePath !== packPath)),
    "Choose the pack JSON and its optional bridge JSON.",
  );
  const selected = selectedFiles(files),
    sources = [],
    sourceFiles = [];
  const provenance = (path) => ({ ...origin, path });
  async function source(path) {
    const bytes = await read(selected.get(path), DRAFT_LIMITS.metadata, path);
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    sources.push(provenance(path));
    sourceFiles.push({
      ...(await assetMetadata(path, "application/json", bytes)),
      bytes,
    });
    return value;
  }
  const pack = await source(packPath),
    bridge = bridgePath ? await source(bridgePath) : null;
  need(
    pack?.schemaVersion === 1 &&
      typeof pack.id === "string" &&
      pack.id.length > 0 &&
      (bridge === null ||
        (bridge.schemaVersion === 1 && bridge.pack === pack.id)),
    "Choose a version 1 pack and its matching bridge.",
  );
  // Validate JSON depth and node count before walking its media references.
  importPack({ pack, bridge, sources });
  const root =
    cardRoot === undefined
      ? cardDirectory(packPath)
      : cardRoot
        ? `${cardRoot}/`
        : "";
  need(
    root === "" || pathOk(root.slice(0, -1)),
    "Choose a safe card directory.",
  );
  const paths = new Set();
  const add = (path) => {
    need(
      pathOk(path) && Object.hasOwn(mimes, path.split(".").at(-1)),
      "Choose a local supported media file; remote media needs an explicit import policy.",
    );
    paths.add(path);
    need(
      paths.size <= DRAFT_LIMITS.assets,
      "Use up to 512 referenced asset files.",
    );
  };
  function visit(value, key) {
    if (typeof value === "string") {
      if (value.startsWith("assets/") || mediaKeys.has(key)) add(value);
    } else if (value && typeof value === "object")
      for (const [name, child] of Object.entries(value)) visit(child, name);
  }
  visit({ pack, bridge });
  for (const place of Object.values(pack.places || {}))
    for (const track of place.music || []) add(`assets/music/${track.file}`);
  need(
    Array.isArray(extraPaths) && extraPaths.length <= DRAFT_LIMITS.assets,
    "Choose up to 512 extra lore files.",
  );
  for (const path of extraPaths) {
    add(path);
    if (!sources.some((s) => s.path === root + path))
      sources.push(provenance(root + path));
  }
  const metadata = [...paths].map((path) => {
    const file = selected.get(root + path);
    need(file, `Choose the referenced file ${root + path}.`);
    return { path, mime: mime(path), size: file.size, sha256: "0".repeat(64) };
  });
  // Check every declared size and the aggregate before reading media.
  const draft = importPack({ pack, bridge, sources, assets: metadata });
  const assets = new Map(),
    assetSources = new Map();
  for (const meta of draft.assets) {
    const path = root + meta.path;
    const bytes = await read(selected.get(path), DRAFT_LIMITS.assetBytes, path);
    need(
      bytes.byteLength === meta.size,
      `Read ${path} again; its bytes changed.`,
    );
    Object.assign(meta, await assetMetadata(meta.path, meta.mime, bytes));
    assets.set(meta.path, bytes);
    assetSources.set(meta.path, provenance(path));
  }
  return { draft, assets, sourceFiles, assetSources };
}
