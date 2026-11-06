import { prepareAcceptedAvatar } from "./authoring-accepted.mjs";
import { exportManifest, parseDraft } from "./authoring-draft.mjs";
import { applySourceEdit, sourceEdit } from "./authoring-edits.mjs";

export async function prepareAcceptedAvatars(record, requests) {
  if (!record?.draft?.pack)
    throw new Error("Open a world before keeping avatars.");
  if (!Array.isArray(requests) || requests.length < 1 || requests.length > 6)
    throw new Error("Choose one through six avatars to keep.");
  requests = structuredClone(requests);
  const source = {
    pack: record.draft.pack,
    bridge: record.draft.bridge,
    launch: record.launch ?? null,
  };
  const baseline = JSON.stringify([
    record.key,
    record.generation,
    record.draft,
    record.launch ?? null,
  ]);
  const avatars = { ...source.pack.avatars },
    ids = [],
    assets = [],
    bytes = new Map();
  for (const request of requests) {
    const part = await prepareAcceptedAvatar(record, request);
    if (part.baseline !== baseline)
      throw new Error("This draft changed. Review the selected avatars again.");
    if (ids.includes(part.id)) throw new Error("Choose each avatar once.");
    ids.push(part.id);
    avatars[part.id] = applySourceEdit(source, part.edit).source.pack.avatars[
      part.id
    ];
    assets.push(...part.assets);
    for (const [path, data] of part.bytes) bytes.set(path, data);
  }
  const edit = sourceEdit(
    source,
    `Keep ${ids.length} ${ids.length === 1 ? "avatar" : "avatars"}`,
    [{ path: ["pack", "avatars"], value: avatars }],
  );
  parseDraft(
    exportManifest({
      ...record.draft,
      pack: { ...record.draft.pack, avatars },
      assets: [...record.draft.assets, ...assets],
    }),
  );
  return { ids, edit, assets, bytes, baseline };
}
