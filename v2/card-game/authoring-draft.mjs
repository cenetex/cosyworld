// Editable source files and asset references. Publication checks the compiled
// pack separately; a draft can keep unfinished cards and future author fields.
export const DRAFT_LIMITS = Object.freeze({
  metadata: 10 * 1024 * 1024,
  document: 8 * 1024 * 1024,
  assets: 512,
  assetBytes: 16 * 1024 * 1024,
  totalAssetBytes: 256 * 1024 * 1024,
});
const utf8 = new TextEncoder();
const record = (v) =>
  v !== null &&
  typeof v === "object" &&
  Object.getPrototypeOf(v) === Object.prototype;
const fields = (v, names) =>
  record(v) &&
  Object.keys(v).length === names.length &&
  names.every((name) => Object.hasOwn(v, name));
const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const pathOk = (path) =>
  typeof path === "string" &&
  path.length <= 512 &&
  !/[\\\u0000-\u001f\u007f:?#%]/u.test(path) &&
  path.split("/").every((part) => part && part !== "." && part !== "..");
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
const sizeOk = (size, max) =>
  Number.isSafeInteger(size) && size >= 0 && size <= max;
function assetOk(asset) {
  return (
    fields(asset, ["path", "mime", "sha256", "size"]) &&
    pathOk(asset.path) &&
    Object.hasOwn(mimes, asset.path.split(".").at(-1)) &&
    mimes[asset.path.split(".").at(-1)] === asset.mime &&
    typeof asset.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(asset.sha256) &&
    sizeOk(asset.size, DRAFT_LIMITS.assetBytes)
  );
}
function sourceOk(source) {
  if (source?.kind === "file")
    return fields(source, ["kind", "path"]) && pathOk(source.path);
  return (
    fields(source, ["kind", "repo", "commit", "path"]) &&
    source.kind === "github" &&
    typeof source.repo === "string" &&
    /^[A-Za-z\d][A-Za-z\d-]{0,38}\/[A-Za-z\d_.-]{1,100}$/u.test(source.repo) &&
    ![".", ".."].includes(source.repo.split("/")[1]) &&
    typeof source.commit === "string" &&
    /^[a-f0-9]{40}$/u.test(source.commit) &&
    pathOk(source.path)
  );
}
// Bound object inputs before serializing. This also catches cycles and values
// JSON would silently drop or turn into another value.
function jsonText(value) {
  const queue = [[value, 0]];
  let count = 0;
  while (queue.length) {
    const [v, depth] = queue.pop();
    need(
      depth <= 64 && ++count <= 100_000,
      "Use a smaller draft with fewer nested fields.",
    );
    if (v === null || typeof v === "boolean" || typeof v === "string") continue;
    if (typeof v === "number") {
      need(Number.isFinite(v), "Use finite numbers in the draft.");
      continue;
    }
    need(record(v) || Array.isArray(v), "Use JSON values in the draft.");
    for (const child of Object.values(v)) queue.push([child, depth + 1]);
  }
  const text = JSON.stringify(value);
  need(
    utf8.encode(text).length <= DRAFT_LIMITS.metadata,
    "Keep draft metadata under 10 MiB.",
  );
  return text;
}
function checked(value) {
  const text = jsonText(value);
  need(
    fields(value, [
      "schemaVersion",
      "id",
      "revision",
      "title",
      "document",
      "pack",
      "bridge",
      "assets",
      "sources",
    ]),
    "Choose an authoring draft with all its fields.",
  );
  need(value.schemaVersion === 1, "Choose a version 1 authoring draft.");
  need(
    value.id === null ||
      (typeof value.id === "string" && /^[A-Za-z\d_-]{1,128}$/u.test(value.id)),
    "Use the draft ID supplied by the server.",
  );
  need(
    sizeOk(value.revision, Number.MAX_SAFE_INTEGER),
    "Use a whole draft revision.",
  );
  need(
    typeof value.title === "string" && value.title.length <= 80,
    "Keep the title within 80 characters.",
  );
  need(
    typeof value.document === "string" &&
      utf8.encode(value.document).length <= DRAFT_LIMITS.document,
    "Keep the document under 8 MiB.",
  );
  need(
    [value.pack, value.bridge].every((v) => v === null || record(v)),
    "Keep pack and bridge source as JSON objects.",
  );
  need(
    Array.isArray(value.assets) &&
      value.assets.length <= DRAFT_LIMITS.assets &&
      value.assets.every(assetOk),
    "Use up to 512 assets with a relative path, MIME type, SHA-256 and size up to 16 MiB.",
  );
  need(
    new Set(value.assets.map((a) => a.path)).size === value.assets.length,
    "Give each asset its own path.",
  );
  need(
    value.assets.reduce((sum, a) => sum + a.size, 0) <=
      DRAFT_LIMITS.totalAssetBytes,
    "Keep asset files within 256 MiB in total.",
  );
  need(
    Array.isArray(value.sources) &&
      value.sources.length <= 512 &&
      value.sources.every(sourceOk),
    "Use local file paths or GitHub sources with an exact commit.",
  );
  return text;
}
export function parseDraft(text) {
  need(
    typeof text === "string" &&
      utf8.encode(text).length <= DRAFT_LIMITS.metadata,
    "Choose draft JSON under 10 MiB.",
  );
  const draft = JSON.parse(text);
  checked(draft);
  return draft;
}
export function exportManifest(draft) {
  return checked(draft);
}
export function importPack({
  pack,
  bridge = null,
  title = pack?.name || "",
  document = "",
  assets = [],
  sources = [],
}) {
  return parseDraft(
    checked({
      schemaVersion: 1,
      id: null,
      revision: 0,
      title,
      document,
      pack,
      bridge,
      assets,
      sources,
    }),
  );
}
// File bytes travel through the asset upload. The draft keeps this reference.
export async function assetMetadata(path, mime, bytes) {
  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  need(
    data instanceof Uint8Array &&
      assetOk({ path, mime, sha256: "0".repeat(64), size: data.byteLength }),
    "Choose a supported asset file up to 16 MiB.",
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  const sha256 = [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return { path, mime, sha256, size: data.byteLength };
}
