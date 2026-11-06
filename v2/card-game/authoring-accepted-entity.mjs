import {
  assetMetadata,
  exportManifest,
  parseDraft,
} from "./authoring-draft.mjs";
import { applySourceEdit, sourceEdit } from "./authoring-edits.mjs";

const own = (value, key) => value != null && Object.hasOwn(value, key);
const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const fields = (value, required, optional = []) =>
  value &&
  Object.getPrototypeOf(value) === Object.prototype &&
  required.every((key) => own(value, key)) &&
  Object.keys(value).every((key) => [...required, ...optional].includes(key));
const idOk = (id) =>
  typeof id === "string" && /^[a-z][a-z0-9-]{0,79}$/u.test(id);
const text = (value, max) =>
  typeof value === "string" &&
  value.trim() &&
  value.length <= max &&
  value.isWellFormed() &&
  !/[\u0000-\u001f\u007f]/u.test(value);
const collection = (kind) =>
  kind === "location" ? "places" : kind === "item" ? "items" : null;
const json = (value) => new TextEncoder().encode(JSON.stringify(value));
const hash = async (value) =>
  (await assetMetadata("output.json", "application/json", json(value))).sha256;
const source = (r) => ({
  pack: r.draft.pack,
  bridge: r.draft.bridge,
  launch: r.launch ?? null,
});
const prefix = (r, kind, id) => {
  need(
    collection(kind) && idOk(id) && idOk(r.draft.pack?.id),
    "Choose a pack and a stable card ID.",
  );
  return `assets/${r.draft.pack.id}/authoring/${collection(kind)}/${id}/`;
};

export function nextAcceptedEntityRevision(record, kind, id) {
  const root = prefix(record, kind, id);
  let latest = 0;
  for (const asset of record.draft.assets) {
    if (!asset.path.startsWith(root)) continue;
    const tail = asset.path.slice(root.length),
      n = Number(tail.split("/")[0]);
    need(
      Number.isSafeInteger(n) && n > 0 && tail === `${n}/output.json`,
      "Open saved output revision paths.",
    );
    latest = Math.max(latest, n);
  }
  need(Number.isSafeInteger(latest + 1), "Start a new output history.");
  return latest + 1;
}

function imageEntry(entity, kind, target) {
  need(
    fields(target, ["field"], ["index", "entitySha256", "entrySha256"]),
    "Choose an authored image target.",
  );
  const allowed = kind === "item" ? ["art"] : ["art", "backdrop", "backdrops"];
  need(allowed.includes(target.field), "Choose this card's image field.");
  if (target.field === "backdrops") {
    const entries = entity?.backdrops,
      entry = entries?.[target.index];
    need(
      Array.isArray(entries) &&
        Number.isInteger(target.index) &&
        target.index >= 0 &&
        target.index < entries.length &&
        fields(entry, ["backdrop", "requires"], Object.keys(entry || {})),
      "Choose an existing conditional backdrop.",
    );
    return entry;
  }
  need(target.index === undefined, "Use an index for a conditional backdrop.");
  return {
    exists: own(entity, target.field),
    value: entity?.[target.field] ?? null,
  };
}

export async function acceptedEntityImageTarget(r, kind, id, field, index) {
  const entity = r.draft.pack?.[collection(kind)]?.[id];
  need(entity, "Choose an existing card.");
  const target = { field, ...(index === undefined ? {} : { index }) };
  const entry = imageEntry(entity, kind, target);
  return {
    ...target,
    entitySha256: await hash(entity),
    entrySha256: await hash(entry),
  };
}

export async function prepareAcceptedEntity(record, request) {
  request = structuredClone(request);
  need(
    fields(
      request,
      ["kind", "candidateId", "revision", "accepted", "image"],
      ["targetId", "imageTarget", "holder"],
    ),
    "Choose an accepted location or item.",
  );
  const { kind, candidateId, revision, accepted, image } = request;
  const { targetId, imageTarget, holder } = request;
  need(
    collection(kind) &&
      typeof candidateId === "string" &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(candidateId),
    "Keep this candidate's UUID and kind.",
  );
  need(
    fields(accepted, ["name", "description", "aliases"], ["suggested"]) &&
      text(accepted.name, 120) &&
      text(accepted.description, 1200) &&
      Array.isArray(accepted.aliases) &&
      accepted.aliases.length <= 8 &&
      accepted.aliases.every((name) => text(name, 80)) &&
      (accepted.suggested === undefined ||
        typeof accepted.suggested === "boolean"),
    "Keep approved name, description and aliases.",
  );
  const baseline = JSON.stringify([
    record.key,
    record.generation,
    record.draft,
    record.launch ?? null,
  ]);
  const draft = parseDraft(exportManifest(record.draft));
  record = { ...record, draft, launch: structuredClone(record.launch ?? null) };
  need(
    record.assets instanceof Map && record.assets.size === draft.assets.length,
    "Open every saved asset file.",
  );
  const group = collection(kind),
    id = targetId ?? `author-${candidateId}`;
  const root = prefix(record, kind, id),
    previous = draft.pack[group]?.[id];
  need(
    (targetId === undefined ? !previous : own(draft.pack[group], id)) &&
      ["places", "avatars", "items"].every(
        (key) => key === group || !own(draft.pack[key], id),
      ),
    "Choose an existing card or a fresh candidate.",
  );
  need(
    Number.isSafeInteger(revision) &&
      revision >= nextAcceptedEntityRevision(record, kind, id),
    "Use a fresh output revision.",
  );
  need(
    holder === undefined || (!previous && kind === "item"),
    "Place an existing item through its open box.",
  );
  if (!previous && kind === "item")
    need(
      own(draft.pack.places, holder) || own(draft.pack.avatars, holder),
      "Choose a starting holder in this pack.",
    );
  if (imageTarget) {
    const entry = imageEntry(previous, kind, imageTarget);
    need(
      previous
        ? imageTarget.entitySha256 === (await hash(previous)) &&
            imageTarget.entrySha256 === (await hash(entry))
        : imageTarget.entitySha256 === undefined &&
            imageTarget.entrySha256 === undefined,
      "This image target changed. Review the current card.",
    );
  }
  need(
    image === null ||
      (imageTarget &&
        fields(image, ["mime", "bytes"]) &&
        ["image/png", "image/webp"].includes(image.mime) &&
        image.bytes instanceof Uint8Array &&
        image.bytes.length > 0),
    "Choose a reviewed PNG or WebP image and its target.",
  );
  const entity = {
    ...(previous || {
      persona: accepted.description.trim(),
      ...(kind === "location" ? { exits: [] } : { holder }),
    }),
    name: accepted.name.trim(),
    text: accepted.description.trim(),
  };
  const assets = [],
    bytes = new Map();
  async function add(path, mime, data) {
    const copy = data.slice(),
      meta = await assetMetadata(path, mime, copy);
    assets.push(meta);
    bytes.set(path, copy);
    return meta;
  }
  let visual = null;
  if (image) {
    const path = `assets/${draft.pack.id}/author-${kind}-${id}-r${revision}-base.${image.mime === "image/png" ? "png" : "webp"}`;
    const meta = await add(path, image.mime, image.bytes);
    const target = {
      field: imageTarget.field,
      ...(imageTarget.index === undefined ? {} : { index: imageTarget.index }),
    };
    if (target.field === "backdrops") {
      entity.backdrops = structuredClone(entity.backdrops);
      entity.backdrops[target.index].backdrop = path;
    } else entity[target.field] = path;
    visual = { target, path, sha256: meta.sha256 };
  }
  await add(
    `${root}${revision}/output.json`,
    "application/json",
    json({
      schemaVersion: 1,
      kind,
      id,
      revision,
      entitySha256: await hash(entity),
      accepted,
      visual,
    }),
  );
  const edit = sourceEdit(source(record), `Accept ${entity.name}`, [
    draft.pack[group]
      ? { path: ["pack", group, id], value: entity }
      : { path: ["pack", group], value: { [id]: entity } },
  ]);
  const next = applySourceEdit(source(record), edit).source;
  parseDraft(
    exportManifest({
      ...draft,
      pack: next.pack,
      assets: [...draft.assets, ...assets],
    }),
  );
  return { id, edit, assets, bytes, baseline };
}
