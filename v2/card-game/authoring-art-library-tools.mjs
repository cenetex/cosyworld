import { listGeneratedArt } from "./authoring-art-library.mjs";
import { readAvatarDesign, avatarBinding } from "./authoring-avatar-design.mjs";
import {
  prepareAcceptedAvatar,
  nextAcceptedAvatarRevision,
} from "./authoring-accepted.mjs";
import { authoringCardId } from "./authoring-tree.mjs";

// Browsing and reselecting stored artwork never requests image generation.
export function createArtLibraryTools({
  changed = () => {},
  choose = () => {},
  blocked = () => false,
  list = listGeneratedArt,
  read = readAvatarDesign,
  prepare = prepareAcceptedAvatar,
}) {
  let source,
    owner,
    binding,
    sets = [],
    urls = [],
    epoch = 0,
    loading = false;
  const libraryId = (id) => `art-library-${id}`;
  function clear() {
    epoch++;
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls = [];
    sets = [];
    owner = binding = null;
    loading = false;
  }
  const why = () =>
    loading ? "Looking through saved artwork…" : blocked() || "";
  const reason = () => {
    const value = why();
    return value === true ? "Finish the current artwork first" : value;
  };
  function available() {
    if (blocked() || loading)
      throw new Error("Finish the current artwork action first.");
  }
  async function browse(id, context) {
    available();
    clear();
    loading = true;
    const token = epoch;
    try {
      const record = context.snapshot({ assets: true });
      const found = await list(record, id);
      if (token !== epoch) return;
      owner = id;
      binding = avatarBinding(record, id);
      const seen = new Set();
      sets = found
        .filter((set) => {
          const key = JSON.stringify([
            set.variant,
            set.rawOnly,
            set.images.map((image) => [image.role, image.sha256]).sort(),
          ]);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((set) => ({
          ...set,
          previews: set.images.map((image) => {
            const url = URL.createObjectURL(
              new Blob([image.bytes], { type: image.mime }),
            );
            urls.push(url);
            return { ...image, url };
          }),
        }));
    } finally {
      if (token === epoch) loading = false;
    }
    changed();
    choose(libraryId(id));
  }
  return {
    clear,
    sync(next) {
      source = next;
      if (owner && !next?.pack?.avatars?.[owner]) clear();
    },
    tools() {
      const tools = [];
      for (const id of Object.keys(source?.pack?.avatars || {})) {
        const box = libraryId(id);
        tools.push({
          id: box,
          name: "Artwork library",
          holder: authoringCardId(["pack", "avatars", id], "entity"),
          describe: () => ({
            note:
              owner === id
                ? `${sets.length} saved artwork sets. Choose one to preview or use again.`
                : "Browse this avatar's saved artwork. Reusing it costs no image request.",
            actions: [
              {
                label: reason() || "Browse saved artwork",
                disabled: Boolean(reason()),
              },
            ],
          }),
          run: (_action, context) => browse(id, context),
        });
        if (owner !== id) continue;
        for (const [index, set] of sets.entries()) {
          const entry = `${box}-${index}`;
          const poseSet = set.images.some((image) => image.role === "happy");
          const name = `${set.rawOnly ? "Original pose sheet" : poseSet ? "Avatar and poses" : "Avatar"} · ${set.label}`;
          const currentVariant = source.pack.avatars[id].temperament
            ? source.pack.avatars[id].temperament.asleep
              ? "asleep"
              : "awake"
            : null;
          const compatible = (set.variant || null) === currentVariant;
          tools.push({
            id: entry,
            name,
            kind: "avatar",
            holder: `designer-tool-${box}`,
            art:
              set.previews.find((image) => image.role === "base")?.url ||
              set.previews[0]?.url,
            describe: () => ({
              note: set.rawOnly
                ? "Original generated sheet is preserved. It cannot replace the avatar until its poses are prepared."
                : !compatible
                  ? `Saved for ${set.variant || "base"}. Switch to that avatar variant before using it.`
                  : "Use this saved artwork without generating again. Other artwork stays in the library.",
              actions: set.rawOnly
                ? []
                : [
                    {
                      label:
                        reason() ||
                        (!compatible
                          ? "Switch to that avatar first"
                          : poseSet
                            ? "Use avatar and poses"
                            : "Use avatar"),
                      confirm: true,
                      disabled: !compatible || Boolean(reason()),
                    },
                  ],
            }),
            async run(_action, context) {
              available();
              if (set.rawOnly || !compatible)
                throw new Error(
                  "Choose artwork for the current avatar variant.",
                );
              const record = context.snapshot({ assets: true });
              if (avatarBinding(record, id) !== binding)
                throw new Error(
                  "This avatar changed. Browse saved artwork again.",
                );
              const design = await read(record, id);
              const accepted = {
                ...design.accepted,
                ...(set.description
                  ? { physicalDescription: set.description }
                  : {}),
              };
              const prepared = await prepare(record, {
                candidateId: crypto.randomUUID(),
                targetId: id,
                ...(design.variant ? { targetVariant: design.variant } : {}),
                revision: nextAcceptedAvatarRevision(record, id),
                accepted,
                images: set.images.map(({ role, mime, bytes }) => ({
                  role,
                  mime,
                  bytes,
                })),
              });
              await context.accept(prepared);
              clear();
              changed();
              choose(box);
            },
          });
          for (const [i, image] of set.previews.entries())
            tools.push({
              id: `${entry}-image-${i}`,
              name: image.role,
              kind: "avatar",
              holder: `designer-tool-${entry}`,
              art: image.url,
              describe: () => ({
                note: "Saved artwork preview. Choose the set to use it.",
                actions: [],
              }),
            });
        }
      }
      return tools;
    },
  };
}
