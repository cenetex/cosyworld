import { archiveGeneratedArt } from "./authoring-art-library.mjs";
import { requestAuthoringImage } from "./authoring-images.mjs";
import { createAuthoringVisualDraft } from "./authoring-visual-draft.mjs";
import { readAvatarDesign, avatarBinding } from "./authoring-avatar-design.mjs";
import {
  prepareAcceptedAvatar,
  nextAcceptedAvatarRevision,
} from "./authoring-accepted.mjs";
import { authoringCardId } from "./authoring-tree.mjs";
import { toolKey } from "./authoring-tools.mjs";
import {
  createCooldown,
  failedJob,
  fetchJobImage,
  holdJob,
  releaseJob,
} from "./authoring-jobs.mjs";

const noTrack = { accepted() {}, settled() {}, dropped() {} };
// Failures that leave the job alone: the server may still finish it.
const WAITING = new Set(["generation_waiting", "network"]);

// Every provider original is archived before review; only selection changes active art.
export function createAuthoringVisualTools({
  changed,
  choose,
  accounts,
  visualOptions = {},
  track = noTrack,
  poke = () => {},
  cooldown = createCooldown({ changed }),
  fetch: jobFetch,
  env: jobEnv,
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
    jobStatus = "",
    urls = [];
  // Jobs this tab does not wait for (found again after a reload) and the
  // messages that go in a tool's note.
  const remote = new Map(),
    notices = new Map();
  async function archive(context) {
    if (!unsaved) return;
    const record = context.snapshot({ assets: true });
    await context.accept(await archiveGeneratedArt(record, unsaved));
    const job = unsaved.job;
    unsaved = null;
    if (job) await track.settled(job);
  }
  // Keep the provider original before anything else uses it.
  async function keep(target, input, image, job, context) {
    unsaved = {
      avatarId: target.id,
      variant: target.variant,
      description: input.description,
      role: input.role,
      job,
      images: [
        { ...image, role: input.role === "portrait" ? "base" : "sheet" },
      ],
    };
    try {
      await archive(context);
    } catch (error) {
      failure = error.message.replace(/[.\s]+$/u, "");
    }
  }
  const visual = createAuthoringVisualDraft({
    ...visualOptions,
    changed,
    request: async (input, options) => {
      const target = design,
        context = activeContext,
        tool = owner,
        pinned = binding,
        draftKey = context.snapshot().key;
      let record;
      jobStatus = "";
      try {
        const result = await (visualOptions.request || requestAuthoringImage)(
          input,
          {
            ...options,
            onJob(job) {
              holdJob(job.id);
              record = {
                id: job.id,
                draftKey,
                kind: "image",
                toolId: tool,
                avatarId: target.id,
                variant: target.variant || null,
                role: input.role,
                description: input.description,
                basis: input.basis,
                binding: pinned,
              };
              return Promise.resolve(track.accepted(record)).catch(() => {});
            },
            onUpdate(job) {
              if (job.status === jobStatus) return;
              jobStatus = job.status;
              changed();
            },
          },
        );
        await keep(target, input, result.image, record?.id, context);
        return result;
      } catch (error) {
        cooldown.set("image", error);
        if (record && !unsaved) {
          if (
            error.name === "AbortError" ||
            /earlier design/u.test(error.message)
          )
            await track.dropped(record);
          else if (!WAITING.has(error.code)) await track.settled(record.id);
        }
        throw error;
      } finally {
        jobStatus = "";
        if (record) releaseJob(record.id);
      }
    },
  });
  function clear() {
    if (unsaved) return;
    visual.open(null);
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
    design = binding = prepared = owner = returning = null;
  }
  const toolId = (id, role) => `art-${toolKey(id)}-${role}`;
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
    notices.delete(owner);
    const started = design;
    activeContext = context;
    try {
      await visual.roll(role);
    } catch (error) {
      clear();
      throw error;
    }
    await landed(id, role, context, started);
  }
  async function landed(id, role, context, started) {
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
  const kept = (role, why) =>
    `The ${role === "portrait" ? "portrait" : "pose sheet"} you asked for finished and was saved to Browse artwork, not applied, because ${why}.`;
  // A job found again after a reload, or finished while its card was closed.
  // It is applied only to the avatar it was made for, exactly as it was asked.
  async function adoptJob(job, rec, run) {
    remote.delete(rec.toolId);
    if (job.status === "failed") {
      const failed = failedJob(job);
      cooldown.set("image", failed);
      notices.set(rec.toolId, failed.message);
      changed();
      return;
    }
    const { image: stored, basis } = job.result;
    const image = {
      mime: stored.mime,
      bytes: await fetchJobImage(stored, { fetch: jobFetch, env: jobEnv }),
      sha256: stored.sha256,
      size: stored.size,
    };
    await run(async (context) => {
      const record = context.snapshot({ assets: true }),
        id = rec.avatarId;
      const input = { role: rec.role, description: rec.description };
      const target = { id, variant: rec.variant || undefined };
      let why = "";
      let next;
      if (rec.dropped || avatarBinding(record, id) !== rec.binding)
        why = "this avatar changed after you asked";
      else if (pendingArtworkNow())
        why = "other artwork is waiting to be confirmed";
      else {
        next = await readAvatarDesign(record, id);
        context.snapshot();
        const [, revision, base] = JSON.parse(basis);
        if (
          (rec.role === "pose-sheet" &&
            base !== (next.value.base?.sha256 ?? null)) ||
          revision !== next.value.revision + (rec.role === "portrait" ? 1 : 0)
        )
          why = "this avatar's artwork changed after you asked";
      }
      await keep(target, input, image, rec.id, context);
      context.snapshot();
      if (why) {
        notices.set(rec.toolId, kept(rec.role, why));
        changed();
        return;
      }
      design = next;
      design.value.description = rec.description;
      binding = rec.binding;
      owner = rec.toolId;
      activeContext = context;
      notices.delete(owner);
      visual.open(design.value);
      const started = design;
      await visual.adopt(rec.role, image);
      context.snapshot();
      await landed(id, rec.role, context, started);
    });
  }
  const pendingArtworkNow = () =>
    Boolean(unsaved || visual.state.role || visual.state.busy);
  return {
    adoptJob,
    progressJob(rec, job) {
      if (job && job.status !== "done" && job.status !== "failed")
        remote.set(rec.toolId, job.status);
      else remote.delete(rec.toolId);
      changed();
    },
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
            select: () => poke(),
            describe: ({ status } = {}) => {
              const waiting = remote.get(action);
              const working =
                Boolean(waiting) || (active && (state.busy || status?.busy));
              const confirming = active && state.role;
              const reason = working
                ? confirming
                  ? "Saving artwork…"
                  : (waiting || jobStatus) === "queued"
                    ? "Waiting in line…"
                    : "Generating…"
                : unsaved
                  ? "Save the artwork first"
                  : state.busy || remote.size
                    ? "Wait for the image"
                    : owner && !active && state.role
                      ? "Confirm or discard the preview first"
                      : role === "pose-sheet" && !avatar.portrait
                        ? "Generate a portrait first"
                        : active && !state.described
                          ? "Describe them first"
                          : cooldown.label("image");
              return {
                ...(working ? { info: reason } : {}),
                edit:
                  active && !unsaved && !state.busy && !state.role && !waiting
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
                      : notices.get(action)
                        ? notices.get(action)
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
