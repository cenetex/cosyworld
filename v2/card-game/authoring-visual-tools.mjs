import { archiveGeneratedArt } from "./authoring-art-library.mjs";
import { requestAuthoringImage } from "./authoring-images.mjs";
import { createAuthoringVisualDraft } from "./authoring-visual-draft.mjs";
import { readAvatarDesign, avatarBinding } from "./authoring-avatar-design.mjs";
import {
  prepareAcceptedAvatar,
  nextAcceptedAvatarRevision,
} from "./authoring-accepted.mjs";
import { authoringCardId } from "./authoring-tree.mjs";

// Every provider original is archived before review; only selection changes active art.
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
    activeContext,
    unsaved,
    failure,
    urls = [];
  async function archive(context) {
    if (!unsaved) return;
    const record = context.snapshot({ assets: true });
    await context.accept(await archiveGeneratedArt(record, unsaved));
    unsaved = null;
  }
  const visual = createAuthoringVisualDraft({
    ...visualOptions,
    changed,
    request: async (input, options) => {
      const target = design,
        context = activeContext;
      const result = await (visualOptions.request || requestAuthoringImage)(
        input,
        options,
      );
      unsaved = {
        avatarId: target.id,
        variant: target.variant,
        description: input.description,
        role: input.role,
        images: [
          {
            ...result.image,
            role: input.role === "portrait" ? "base" : "sheet",
          },
        ],
      };
      try {
        await archive(context);
      } catch (error) {
        failure = error.message.replace(/[.\s]+$/u, "");
      }
      return result;
    },
  });
  function clear() {
    if (unsaved) return;
    visual.open(null);
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
    design = binding = prepared = owner = returning = null;
  }
  const toolId = (id, role) => `art-${id}-${role}`;
  const retryId = "retry-unsaved-artwork";
  function previews() {
    for (const url of urls) URL.revokeObjectURL(url);
    const state = visual.state;
    urls = [state.image, ...(state.role === "portrait" ? [] : state.poses)]
      .filter(Boolean)
      .map((image) =>
        URL.createObjectURL(new Blob([image.bytes], { type: image.mime })),
      );
  }
  async function save(id, role, context) {
    const record = context.snapshot({ assets: true });
    if (avatarBinding(record, id) !== binding)
      throw new Error(
        "This avatar changed. Discard the preview and generate again.",
      );
    const saved = await visual.confirm(async (output) => {
      prepared = await prepareAcceptedAvatar(record, {
        candidateId: crypto.randomUUID(),
        targetId: id,
        ...(design.variant ? { targetVariant: design.variant } : {}),
        revision: nextAcceptedAvatarRevision(record, id),
        accepted: {
          ...design.accepted,
          description: design.accepted.description || output.description,
          physicalDescription: output.description,
        },
        images: output.images,
      });
      await context.accept(prepared);
    });
    if (saved) {
      clear();
      choose(toolId(id, role), true);
    }
  }
  async function generate(id, role, context) {
    if (unsaved)
      throw new Error("Retry saving artwork before generating again.");
    const record = context.snapshot({ assets: true });
    const nextBinding = avatarBinding(record, id);
    if (
      owner &&
      (visual.state.role || visual.state.busy) &&
      (owner !== toolId(id, role) || binding !== nextBinding)
    )
      throw new Error("Confirm or discard the current artwork first.");
    const edited =
      (owner === toolId(id, role) || (!owner && design?.id === id)) &&
      binding === nextBinding
        ? visual.state.description
        : undefined;
    design = await readAvatarDesign(record, id);
    if (edited !== undefined) design.value.description = edited;
    if (role === "pose-sheet" && !design.value.base)
      throw new Error("Confirm an avatar portrait before generating poses.");
    binding = nextBinding;
    owner = toolId(id, role);
    visual.open(design.value);
    if (!visual.state.described) {
      choose(owner);
      changed();
      return;
    }
    failure = "";
    const started = design;
    activeContext = context;
    try {
      await visual.roll(role);
    } catch (error) {
      clear();
      throw error;
    }
    if (design !== started) {
      changed();
      return;
    }
    if (visual.state.status === 401) {
      returning = owner;
      owner = null;
      choose(accounts.requireSignIn());
      return;
    }
    previews();
    if (unsaved) {
      changed();
      choose(retryId);
      return;
    }
    if (role === "portrait" && !design.value.base && visual.state.role)
      await save(id, role, context);
    changed();
    // Follow the result only for a maker who is still on this card.
    choose(owner, true);
  }
  return {
    sync(next) {
      source = next;
      if (design && !next?.pack?.avatars?.[design.id]) clear();
    },
    clear,
    pendingArtwork: () =>
      Boolean(unsaved || visual.state.role || visual.state.busy),
    pendingReason: () =>
      visual.state.busy
        ? "Wait for the image"
        : unsaved
          ? "Save the artwork first"
          : visual.state.role
            ? "Confirm or discard the preview first"
            : "",
    transient: () =>
      unsaved
        ? JSON.stringify(["unsaved-artwork", unsaved.avatarId])
        : owner
          ? JSON.stringify([
              owner,
              activeContext,
              unsaved,
              binding,
              visual.state.role,
              visual.state.description,
            ])
          : null,
    signedIn() {
      if (returning) {
        const id = returning;
        returning = null;
        choose(id);
      }
    },
    tools() {
      const tools = [];
      if (unsaved)
        tools.push({
          id: retryId,
          name: "Retry saving artwork",
          describe: () => ({
            note: `${failure ? `Artwork is in memory but could not be saved: ${failure}. ` : "Your generated image is still in memory. "}Keep this tab open. Retry saves the original to this device without generating or charging again.`,
            actions: [{ label: "Retry saving artwork" }],
          }),
          async run(_action, context) {
            const { avatarId, role } = unsaved;
            await archive(context);
            const first =
              owner === toolId(avatarId, role) &&
              role === "portrait" &&
              !design?.value.base &&
              visual.state.role;
            if (first) await save(avatarId, role, context);
            else if (owner) previews();
            else clear();
            changed();
          },
        });
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
            describe: ({ status } = {}) => {
              const working = active && (state.busy || status?.busy);
              const confirming = active && state.role;
              const reason = working
                ? confirming
                  ? "Saving artwork…"
                  : "Generating…"
                : unsaved
                  ? "Save the artwork first"
                  : state.busy
                    ? "Wait for the image"
                    : owner && !active && state.role
                      ? "Confirm or discard the preview first"
                      : "";
              return {
                ...(working ? { info: reason } : {}),
                edit:
                  active && !unsaved && !state.busy && !state.role
                    ? {
                        key: owner,
                        label: "Physical description only",
                        value: state.description,
                        onInput: (value) => visual.describe(value),
                      }
                    : null,
                note:
                  active && !state.described
                    ? "Describe only visible appearance: body, face, hair, clothing and colours. Leave out dialogue, personality, goals and story."
                    : active && state.error
                      ? state.error
                      : role === "portrait"
                        ? "Generate a full-body transparent cutout with GPT Image 2.6 Flare. Review it before replacing saved art."
                        : "Generate happy, sad, hit, strike, brace and sleep poses from the saved cutout in one image request. Review all six before saving.",
                actions: [
                  {
                    label: reason || (confirming ? "Confirm artwork" : name),
                    disabled: Boolean(reason),
                    confirm: !confirming,
                  },
                ],
              };
            },
            async run(_action, context) {
              if (active && state.role) {
                await save(id, role, context);
                return;
              }
              await generate(id, role, context);
            },
          });
          if (!active || unsaved || (!state.role && !state.busy)) continue;
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
          [state.image, ...(state.role === "portrait" ? [] : state.poses)]
            .filter(Boolean)
            .forEach((image, i) => {
              tools.push({
                id: `${action}-preview-${i}`,
                name:
                  image.role === "base" || i === 0
                    ? "Avatar cutout"
                    : image.role,
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
