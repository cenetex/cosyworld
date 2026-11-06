import { assetMetadata } from "./authoring-draft.mjs";
import { acceptedAvatarOutputs } from "./authoring-accepted.mjs";
import { sampleExample } from "./authoring-sample.mjs";

const need = (value, message) => {
  if (!value) throw new Error(message);
};
export const avatarVariant = (avatar) =>
  avatar?.temperament
    ? avatar.temperament.asleep
      ? "asleep"
      : "awake"
    : undefined;
export const avatarBinding = (record, id) =>
  JSON.stringify([
    record.key,
    record.draft.pack.id,
    id,
    avatarVariant(record.draft.pack.avatars[id]),
    record.draft.pack.avatars[id],
  ]);

// A design owns only its current images. Verify bytes before using saved art.
export async function readAvatarDesign(
  record,
  id,
  { outputs = acceptedAvatarOutputs, example = sampleExample() } = {},
) {
  const entity = record.draft.pack?.avatars?.[id];
  need(entity, "Choose an existing avatar.");
  need(
    !entity.temperament ||
      (entity.portrait === undefined && entity.poses === undefined),
    "Choose portraits from this avatar's awake and asleep variants.",
  );
  const variant = avatarVariant(entity),
    history = await outputs(record, id);
  need(
    !variant || entity.variants?.[variant],
    "Choose an authored awake or asleep portrait variant.",
  );
  const path = variant ? entity.variants?.[variant]?.portrait : entity.portrait;
  async function image(path) {
    const meta = record.draft.assets.find((asset) => asset.path === path);
    if (!meta) return null;
    need(
      ["image/png", "image/webp"].includes(meta.mime),
      "Use a PNG or WebP portrait.",
    );
    const bytes = record.assets.get(path);
    need(bytes instanceof Uint8Array, "Open this avatar's saved artwork.");
    const actual = await assetMetadata(path, meta.mime, bytes);
    need(
      actual.sha256 === meta.sha256 && actual.size === meta.size,
      "Check this avatar's saved artwork digest.",
    );
    return {
      mime: meta.mime,
      bytes: bytes.slice(),
      sha256: actual.sha256,
      size: actual.size,
    };
  }
  const base = path ? await image(path) : null;
  const matching = history
    .map((output) => output.visual)
    .filter(
      (visual) =>
        visual &&
        visual.targetVariant === variant &&
        visual.images.some(
          (value) => value.role === "base" && value.sha256 === base?.sha256,
        ),
    );
  const visual =
    matching.find((value) =>
      value.images.some(
        (value) => value.role === "base" && value.path === path,
      ),
    ) || matching[0];
  const poses = visual
    ? await Promise.all(
        visual.images
          .filter((value) => value.role !== "base")
          .map(async (value) => {
            const saved = await image(value.path);
            need(
              saved?.sha256 === value.sha256,
              "Open the confirmed pose files.",
            );
            return { ...saved, role: value.role };
          }),
      )
    : [];
  let sheet = null;
  if (
    record.draft.pack.id === "lantern-shore" &&
    id === example.avatar &&
    base?.sha256 === example.portraitSha256
  ) {
    const saved = await image(example.sheet);
    if (saved?.sha256 === example.sheetSha256) sheet = saved;
  }
  const hash = (
    await assetMetadata(
      "entity.json",
      "application/json",
      new TextEncoder().encode(JSON.stringify(entity)),
    )
  ).sha256;
  const output =
    history.find((value) => value.entitySha256 === hash) || history[0];
  return {
    id,
    variant,
    binding: avatarBinding(record, id),
    packId: record.draft.pack.id,
    accepted: {
      name: entity.name,
      specialAbility:
        output?.accepted.specialAbility ||
        (id === example.avatar && record.draft.pack.id === "lantern-shore"
          ? example.specialAbility
          : null) ||
        (typeof entity.seed === "string"
          ? entity.seed.trim().slice(0, 100)
          : "") ||
        "World character",
      aliases: output?.accepted.aliases || [],
      ...(output?.accepted.suggested === undefined
        ? {}
        : { suggested: output.accepted.suggested }),
    },
    example: sheet,
    value: {
      id: `${id}${variant ? `_${variant}` : ""}`,
      kind: "avatar",
      description: entity.text || "",
      revision: visual?.revision || 0,
      base: base || undefined,
      poses,
    },
  };
}
