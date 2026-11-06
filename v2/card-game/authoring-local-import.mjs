// Selected files are the complete authority for a portable draft import.
import {
  assetMetadata,
  DRAFT_LIMITS,
  importPack,
  parseDraft,
} from "./authoring-draft.mjs";

const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const pathOk = (path) =>
  typeof path === "string" &&
  path.length <= 512 &&
  !/[\\\u0000-\u001f\u007f:?#%]/u.test(path) &&
  path.split("/").every((part) => part && part !== "." && part !== "..");

// A directory picker supplies webkitRelativePath. Native adapters supply
// {path, file}, where file has the File size and arrayBuffer interface.
function selectedFiles(files) {
  const selected = new Map();
  for (const entry of files) {
    const file = entry?.file ?? entry;
    const path = entry?.path ?? (file?.webkitRelativePath || file?.name);
    need(pathOk(path), "Choose files with safe relative paths.");
    need(!selected.has(path), `Choose one file for ${path}.`);
    need(
      Number.isSafeInteger(file?.size) &&
        file.size >= 0 &&
        typeof file.arrayBuffer === "function",
      `Choose a readable file for ${path}.`,
    );
    selected.set(path, file);
    need(
      selected.size <= DRAFT_LIMITS.assets + 1,
      "Choose one manifest and up to 512 asset files.",
    );
  }
  return selected;
}

export function localPackCandidates(files) {
  return [...selectedFiles(files).keys()]
    .filter((path) => path.split("/").at(-1) === "card-world.json")
    .sort();
}

async function read(file, max, path) {
  need(file && file.size <= max, `Choose ${path} within its file size limit.`);
  const buffer = await file.arrayBuffer();
  need(
    buffer instanceof ArrayBuffer && buffer.byteLength === file.size,
    `Read ${path} again; its bytes changed.`,
  );
  return new Uint8Array(buffer);
}

// An export stores its asset paths relative to the manifest's directory.
// Each returned byte array is ready for the separate asset upload/export.
export async function importLocalDraft({ files, manifestPath }) {
  need(
    pathOk(manifestPath) && manifestPath.endsWith(".json"),
    "Choose the exported draft JSON file.",
  );
  const selected = selectedFiles(files);
  need(selected.has(manifestPath), `Choose the draft file ${manifestPath}.`);
  const bytes = await read(
    selected.get(manifestPath),
    DRAFT_LIMITS.metadata,
    manifestPath,
  );
  const source = parseDraft(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  const prefix = manifestPath.includes("/")
    ? manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1)
    : "";
  // Check every expected size before reading the first asset.
  for (const asset of source.assets) {
    const path = prefix + asset.path;
    need(
      path !== manifestPath && selected.has(path),
      `Choose the asset file ${path}.`,
    );
    need(
      selected.get(path).size === asset.size,
      `Choose ${path} with its recorded byte count.`,
    );
  }
  const assets = new Map();
  for (const asset of source.assets) {
    const data = await read(
      selected.get(prefix + asset.path),
      DRAFT_LIMITS.assetBytes,
      asset.path,
    );
    const actual = await assetMetadata(asset.path, asset.mime, data);
    need(
      actual.sha256 === asset.sha256,
      `Choose ${asset.path} with its recorded SHA-256.`,
    );
    assets.set(asset.path, data);
  }
  const sources = [...source.sources];
  if (!sources.some((s) => s.kind === "file" && s.path === manifestPath))
    sources.push({ kind: "file", path: manifestPath });
  const draft = importPack({ ...source, sources });
  const metadata = await assetMetadata(manifestPath, "application/json", bytes);
  return { draft, assets, sourceFiles: [{ ...metadata, bytes }] };
}
