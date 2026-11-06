import {
  assetMetadata,
  exportManifest,
  parseDraft,
} from "./authoring-draft.mjs";
import { applySourceEdit, sourceEdit } from "./authoring-edits.mjs";

const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value));
const own = (value, key) => value != null && Object.hasOwn(value, key);
const fields = (value, required, optional = []) =>
  value &&
  Object.getPrototypeOf(value) === Object.prototype &&
  required.every((key) => own(value, key)) &&
  Object.keys(value).every((key) => [...required, ...optional].includes(key));
const text = (value, max) =>
  typeof value === "string" &&
  value.trim() &&
  value.length <= max &&
  value.isWellFormed() &&
  !/[\u0000-\u001f\u007f]/u.test(value);
const roles = ["base", "happy", "sad", "strike", "brace", "hit", "sleep"];
const extensions = {
  "image/png": "png",
  "image/webp": "webp",
};
const acceptedOk = (value) =>
  fields(
    value,
    ["name", "specialAbility", "aliases", "description"],
    ["suggested"],
  ) &&
  text(value.name, 80) &&
  text(value.specialAbility, 100) &&
  text(value.description, 1200) &&
  Array.isArray(value.aliases) &&
  value.aliases.length <= 8 &&
  value.aliases.every((alias) => text(alias, 80)) &&
  (value.suggested === undefined || typeof value.suggested === "boolean");
const source = (record) => ({
  pack: record.draft.pack,
  bridge: record.draft.bridge,
  launch: record.launch ?? null,
});
const baseline = (record) =>
  JSON.stringify([
    record.key,
    record.generation,
    record.draft,
    record.launch ?? null,
  ]);
const digest = async (value) =>
  (await assetMetadata("output.json", "application/json", jsonBytes(value)))
    .sha256;
const prefix = (record, id) =>
  `assets/${record.draft.pack.id}/authoring/avatars/${id}/`;

export async function acceptedAvatarOutput(record, id) {
  const entity = record.draft.pack?.avatars?.[id];
  if (!entity) return null;
  const hash = await digest(entity);
  let match = null;
  for (const meta of record.draft.assets) {
    if (
      !meta.path.startsWith(prefix(record, id)) ||
      !meta.path.endsWith("/output.json")
    )
      continue;
    const bytes = record.assets?.get(meta.path);
    need(bytes instanceof Uint8Array, "Open the saved output files.");
    const actual = await assetMetadata(meta.path, meta.mime, bytes);
    need(actual.sha256 === meta.sha256, "Check the saved output digest.");
    const output = JSON.parse(new TextDecoder().decode(bytes));
    need(
      fields(output, [
        "schemaVersion",
        "id",
        "revision",
        "entitySha256",
        "accepted",
        "visual",
      ]) &&
        output.schemaVersion === 1 &&
        acceptedOk(output.accepted) &&
        Number.isSafeInteger(output.revision) &&
        output.revision > 0 &&
        (output.visual === null ||
          (fields(output.visual, ["revision", "images"]) &&
            Number.isSafeInteger(output.visual.revision) &&
            output.visual.revision > 0 &&
            Array.isArray(output.visual.images) &&
            output.visual.images.length <= roles.length &&
            output.visual.images.every(
              (image) =>
                fields(image, ["role", "path", "sha256"]) &&
                roles.includes(image.role) &&
                record.draft.assets.some(
                  (asset) =>
                    asset.path === image.path && asset.sha256 === image.sha256,
                ),
            ))),
      "Open a version 1 accepted output with named image roles.",
    );
    if (
      output.id === id &&
      output.entitySha256 === hash &&
      output.revision > (match?.revision ?? 0)
    )
      match = output;
  }
  return match;
}

export async function prepareAcceptedAvatar(record, request) {
  request = structuredClone(request);
  need(
    fields(request, ["candidateId", "revision", "accepted", "images"]),
    "Choose an accepted avatar and its images.",
  );
  const { candidateId, revision, accepted, images } = request;
  need(
    typeof candidateId === "string" &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(candidateId),
    "Keep the candidate's UUID.",
  );
  need(
    Number.isSafeInteger(revision) && revision > 0,
    "Use a positive output revision.",
  );
  need(
    acceptedOk(accepted),
    "Use accepted name, ability, aliases and description only.",
  );
  const draft = parseDraft(exportManifest(record.draft));
  need(
    record.assets instanceof Map && record.assets.size === draft.assets.length,
    "Open every saved asset file.",
  );
  need(
    typeof draft.pack?.id === "string" &&
      /^[a-z][a-z0-9-]{0,63}$/u.test(draft.pack.id),
    "Choose a pack with a safe ID.",
  );
  const id = `author-${candidateId}`,
    root = prefix(record, id);
  need(
    !own(draft.pack.places, id) && !own(draft.pack.items, id),
    "Give this avatar its own stable ID.",
  );
  for (const asset of draft.assets) {
    if (!asset.path.startsWith(root)) continue;
    const prior = Number(asset.path.slice(root.length).split("/")[0]);
    need(
      Number.isSafeInteger(prior) && prior < revision,
      "Use a fresh output revision after the saved versions.",
    );
  }
  const before = baseline(record),
    previous = draft.pack.avatars?.[id];
  const oldOutput = await acceptedAvatarOutput(record, id);
  const place = record.launch?.place ?? draft.pack.entry;
  need(
    previous || own(draft.pack.places, place),
    "Choose a starting place for the avatar.",
  );
  need(
    Array.isArray(images) &&
      images.length <= roles.length &&
      images.every(
        (image) =>
          fields(image, ["role", "mime", "bytes"]) &&
          roles.includes(image.role) &&
          own(extensions, image.mime) &&
          image.bytes instanceof Uint8Array &&
          image.bytes.length > 0,
      ) &&
      new Set(images.map((image) => image.role)).size === images.length &&
      (!images.length || images.some((image) => image.role === "base")),
    "Choose one base image and named poses with unique roles.",
  );
  const assets = [],
    bytes = new Map(),
    visuals = [];
  async function add(path, mime, data) {
    const copy = data.slice(),
      meta = await assetMetadata(path, mime, copy);
    assets.push(meta);
    bytes.set(path, copy);
    return meta;
  }
  for (const image of images) {
    const path = `assets/${draft.pack.id}/${id}-r${revision}-${image.role}.${extensions[image.mime]}`;
    const meta = await add(path, image.mime, image.bytes);
    visuals.push({ role: image.role, path, sha256: meta.sha256 });
  }
  const entity = {
    ...(previous || {
      place,
      travels: false,
      standoffs: false,
      seed: accepted.specialAbility.trim(),
      tastes: {
        likes: "using their abilities",
        sore: "being rushed",
        reason: "prefers time to understand others",
      },
    }),
    name: accepted.name.trim(),
    text: accepted.description.trim(),
  };
  const portrait = visuals.find((image) => image.role === "base");
  if (portrait) entity.portrait = portrait.path;
  const output = {
    schemaVersion: 1,
    id,
    revision,
    entitySha256: await digest(entity),
    accepted: structuredClone(accepted),
    visual: images.length
      ? { revision, images: visuals }
      : (oldOutput?.visual ?? null),
  };
  await add(
    `${root}${revision}/output.json`,
    "application/json",
    jsonBytes(output),
  );
  const path = ["pack", "avatars", id];
  const edit = sourceEdit(source(record), `Accept ${entity.name}`, [
    draft.pack.avatars
      ? { path, value: entity }
      : { path: ["pack", "avatars"], value: { [id]: entity } },
  ]);
  const prepared = { id, edit, assets, bytes, baseline: before };
  adoptAcceptedAvatar(record, prepared);
  return prepared;
}

export function adoptAcceptedAvatar(record, prepared) {
  need(
    baseline(record) === prepared.baseline,
    "This draft changed. Review the accepted avatar again.",
  );
  const next = applySourceEdit(source(record), prepared.edit).source;
  const draft = parseDraft(
    exportManifest({
      ...record.draft,
      pack: next.pack,
      bridge: next.bridge,
      assets: [...record.draft.assets, ...prepared.assets],
    }),
  );
  const assets = new Map(
    [...record.assets, ...prepared.bytes].map(([path, bytes]) => [
      path,
      bytes.slice(),
    ]),
  );
  return { ...record, draft, launch: next.launch, assets };
}
