import { createAuthoringVisualDraft } from "./authoring-visual-draft.mjs";
import { readAvatarDesign, avatarBinding } from "./authoring-avatar-design.mjs";
import {
  prepareAcceptedAvatar,
  nextAcceptedAvatarRevision,
} from "./authoring-accepted.mjs";
import { authoringCardId } from "./authoring-tree.mjs";

// Generation prepares a review. Only Confirm writes artwork into the local draft.
export function createAuthoringVisualTools({
  changed,
  choose,
  accounts,
  visualOptions = {},
}) {
  let source,
    design,
    binding,
    returning,
    prepared,
    owner,
    urls = [];
  const visual = createAuthoringVisualDraft({ ...visualOptions, changed });
  function clear() {
    visual.open(null);
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
    design = binding = prepared = owner = returning = null;
  }
  const toolId = (id, role) => `art-${id}-${role}`;
  function previews() {
    for (const url of urls) URL.revokeObjectURL(url);
    const state = visual.state;
    urls = [state.image, ...state.poses]
      .filter(Boolean)
      .map((image) =>
        URL.createObjectURL(new Blob([image.bytes], { type: image.mime })),
      );
  }
  async function generate(id, role, context) {
    const record = context.snapshot({ assets: true });
    const nextBinding = avatarBinding(record, id);
    if (owner && (owner !== toolId(id, role) || binding !== nextBinding))
      throw new Error("Confirm or discard the current artwork first.");
    design = await readAvatarDesign(record, id);
    binding = nextBinding;
    owner = toolId(id, role);
    visual.open(design.value);
    await visual.roll(role);
    if (visual.state.status === 401) {
      returning = owner;
      owner = null;
      choose(accounts.requireSignIn());
      return;
    }
    previews();
    changed();
  }
  return {
    sync(next) {
      source = next;
    },
    clear,
    transient: () =>
      owner ? JSON.stringify([owner, binding, visual.state.role]) : null,
    signedIn() {
      if (returning) {
        const id = returning;
        returning = null;
        choose(id);
      }
    },
    tools() {
      const tools = [];
      for (const [id, avatar] of Object.entries(source?.pack?.avatars || {})) {
        const holder = authoringCardId(["pack", "avatars", id], "entity");
        for (const [role, name] of [
          ["portrait", "Generate avatar"],
          ["pose-sheet", "Generate poses"],
        ]) {
          const action = toolId(id, role),
            active = owner === action;
          const state = visual.state;
          tools.push({
            id: action,
            name,
            holder,
            describe: () => ({
              note:
                active && state.error
                  ? state.error
                  : role === "portrait"
                    ? "Generate a full-body transparent cutout with GPT Image 2.6 Flare. Review it before replacing saved art."
                    : "Generate happy, sad, hit, strike, brace and sleep poses from the saved cutout in one image request. Review all six before saving.",
              actions: [
                {
                  label: active && state.role ? "Confirm artwork" : name,
                  disabled: Boolean(owner && !active) || Boolean(state.busy),
                  confirm: !(active && state.role),
                },
              ],
            }),
            async run(_action, context) {
              if (active && state.role) {
                const record = context.snapshot({ assets: true });
                if (avatarBinding(record, id) !== binding)
                  throw new Error(
                    "This avatar changed. Discard the preview and generate again.",
                  );
                const saved = await visual.confirm(async (output) => {
                  prepared ??= await prepareAcceptedAvatar(record, {
                    candidateId: crypto.randomUUID(),
                    targetId: id,
                    ...(design.variant
                      ? { targetVariant: design.variant }
                      : {}),
                    revision: nextAcceptedAvatarRevision(record, id),
                    accepted: {
                      ...design.accepted,
                      description: output.description,
                    },
                    images: output.images,
                  });
                  await context.accept(prepared);
                });
                if (saved) {
                  clear();
                  choose(action);
                }
                return;
              }
              await generate(id, role, context);
            },
          });
          if (!active) continue;
          tools.push({
            id: `${action}-discard`,
            name: "Discard artwork",
            holder: `designer-tool-${action}`,
            describe: () => ({
              note: "Keep saved artwork unchanged.",
              actions: [{ label: "Discard artwork" }],
            }),
            run() {
              clear();
              choose(action);
            },
          });
          [state.image, ...state.poses].filter(Boolean).forEach((image, i) => {
            tools.push({
              id: `${action}-preview-${i}`,
              name:
                image.role === "base" || i === 0 ? "Avatar cutout" : image.role,
              holder: `designer-tool-${action}`,
              art: urls[i],
              kind: "avatar",
              describe: () => ({
                note: "Review this generated artwork before confirming the set.",
                actions: [],
              }),
            });
          });
        }
      }
      return tools;
    },
  };
}
