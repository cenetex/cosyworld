import { assetMetadata } from "./authoring-draft.mjs";
import { sourceEdit } from "./authoring-edits.mjs";
import { acceptedAvatarOutputs } from "./authoring-accepted.mjs";

const root = "assets/generated-art/";
// The original provider response is retained independently of active portraits.
export async function archiveGeneratedArt(
  record,
  { avatarId, variant, description, role, images, id = crypto.randomUUID() },
) {
  const assets = [],
    bytes = new Map(),
    saved = [];
  async function add(path, mime, data) {
    const meta = await assetMetadata(path, mime, data);
    assets.push(meta);
    bytes.set(path, data.slice());
    return meta;
  }
  for (const [i, image] of images.entries()) {
    const path = `${root}${id}/${i}.${image.mime === "image/webp" ? "webp" : "png"}`;
    const meta = await add(path, image.mime, image.bytes);
    saved.push({ role: image.role, path, sha256: meta.sha256 });
  }
  const value = {
    schemaVersion: 1,
    id,
    avatarId,
    variant: variant || null,
    description,
    role,
    createdAt: new Date().toISOString(),
    rawOnly: role === "pose-sheet",
    images: saved,
  };
  await add(
    `${root}${id}/output.json`,
    "application/json",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return {
    assets,
    bytes,
    edit: sourceEdit(
      {
        pack: record.draft.pack,
        bridge: record.draft.bridge,
        launch: record.launch ?? null,
      },
      "Keep generated artwork",
      [],
    ),
    baseline: JSON.stringify([
      record.key,
      record.generation,
      record.draft,
      record.launch ?? null,
    ]),
  };
}

export async function listGeneratedArt(record, avatarId) {
  async function images(values) {
    return Promise.all(
      values.map(async (image) => {
        const meta = record.draft.assets.find(
          (asset) => asset.path === image.path,
        );
        const bytes = record.assets.get(image.path);
        if (!meta || !(bytes instanceof Uint8Array))
          throw new Error("Open this artwork's saved files.");
        const actual = await assetMetadata(image.path, meta.mime, bytes);
        if (actual.sha256 !== image.sha256)
          throw new Error("Check this artwork's saved digest.");
        return { ...image, ...meta, bytes: bytes.slice() };
      }),
    );
  }
  const sets = [];
  for (const asset of record.draft.assets) {
    if (!asset.path.startsWith(root) || !asset.path.endsWith("/output.json"))
      continue;
    const bytes = record.assets.get(asset.path);
    if (!(bytes instanceof Uint8Array))
      throw new Error("Open the saved artwork library.");
    const actual = await assetMetadata(asset.path, asset.mime, bytes);
    if (actual.sha256 !== asset.sha256)
      throw new Error("Check the artwork library digest.");
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value.schemaVersion !== 1 || value.avatarId !== avatarId) continue;
    sets.push({
      ...value,
      label: `Generated ${value.createdAt}`,
      images: await images(value.images),
    });
  }
  for (const output of await acceptedAvatarOutputs(record, avatarId)) {
    if (!output.visual) continue;
    sets.push({
      id: `accepted-${avatarId}-${output.revision}`,
      avatarId,
      variant: output.visual.targetVariant || null,
      description: output.accepted.physicalDescription || "",
      label: `Saved artwork ${output.revision}`,
      rawOnly: false,
      images: await images(output.visual.images),
    });
  }
  return sets;
}
