import { characterKeys } from "./authoring-cast.mjs";
import { createCharacterDraw, acceptedOutput } from "./authoring-draw.mjs";
import { prepareAcceptedAvatars, acceptedCharacterNames } from "./authoring-draw-output.mjs";
import { WORLD } from "./authoring-collections.mjs";
import { authoringCardId } from "./authoring-tree.mjs";
import { createCooldown, failedJob } from "./authoring-jobs.mjs";
const AVATARS = authoringCardId(["pack", "avatars"], "collection");
const label = (mode) => (mode === "idea" ? "World idea" : "Story text");
const baseline = ({ key, generation, draft, launch }) =>
  JSON.stringify([key, generation, draft, launch ?? null]);
export function authoringSeedTools({
  changed = () => {},
  chooseTool = () => {},
  createDraw = createCharacterDraw,
  prepare = prepareAcceptedAvatars,
  readNames = acceptedCharacterNames,
  requireSignIn = () => "sign-in",
  track,
  fetch: jobFetch,
  env,
  poke = () => {},
  cooldown = createCooldown({ changed }),
} = {}) {
  let life = 0,
    request = 0,
    key = "",
    loading = false,
    keeping = false,
    error = "",
    authenticated = false,
    cached;
  const draw = createDraw({ changed, track, fetch: jobFetch, env });
  // Replies found again after a reload, by job id.
  const remote = new Map();
  draw.setMode("idea");
  const invalidate = () => {
    request++;
    loading = false;
  };
  const cancel = () => {
    invalidate();
    draw.cancel();
  };
  const state = () => draw.state;
  const chosen = () => {
    const current = state();
    return current.cards.filter((card) => current.selected.includes(card.id));
  };
  const chooseSeed = () => chooseTool("seed");
  function setText(text) {
    if (text === draw.text) return;
    invalidate();
    error = "";
    draw.setText(text);
  }
  function find(context) {
    const record = context.snapshot({ assets: true }),
      token = ++request,
      opened = life;
    loading = true;
    authenticated = false;
    error = "";
    chooseTool("avatar-seed");
    changed();
    // The guarded action ends before metadata lookup and provider requests wait.
    void (async () => {
      try {
        const known = await readNames(record);
        if (opened !== life || token !== request) return;
        loading = false;
        await draw.find(known, record.key);
        const { status, code, retryAfterMs } = state();
        cooldown.set("avatars", { status, code, retryAfterMs });
      } catch (failure) {
        if (opened === life && token === request) error = failure.message;
      } finally {
        if (opened === life && token === request) {
          loading = false;
          changed();
        }
      }
    })();
  }
  async function keep(context) {
    const cards = chosen(),
      opened = life;
    if (!cards.length || loading || state().busy || keeping) return;
    keeping = true;
    error = "";
    changed();
    try {
      const record = context.snapshot({ assets: true });
      const names = new Set((await readNames(record)).flatMap(characterKeys));
      if (opened !== life) return;
      const duplicate = cards.find((card) => characterKeys(card).some((name) => names.has(name)));
      if (duplicate)
        throw new Error(
          `${duplicate.name} is already in this world. Deselect it, then open World seed and choose Find more.`,
        );
      const selection = JSON.stringify(cards);
      if (cached?.selection !== selection || cached.prepared.baseline !== baseline(record)) {
        const prepared = await prepare(
          record,
          cards.map((card) => ({
            candidateId: card.id,
            revision: 1,
            accepted: acceptedOutput(card),
            images: [],
          })),
        );
        if (opened !== life) return;
        cached = { selection, prepared };
      }
      if (opened !== life || JSON.stringify(chosen()) !== selection) return;
      await context.accept(cached.prepared);
      if (opened !== life) return;
      cached = null;
      draw.remove(cards.map((card) => card.id));
      chooseTool("avatar-seed");
    } catch (failure) {
      if (opened === life) error = failure.message;
    } finally {
      if (opened === life) {
        keeping = false;
        changed();
      }
    }
  }
  function run(action, context) {
    if (action.run === "open") return chooseSeed();
    if (action.run === "sign-in") return chooseTool(requireSignIn());
    if (action.run === "cancel") return cancel();
    if (action.run === "keep") return keep(context);
    if (action.run === "mode") {
      invalidate();
      error = "";
      draw.setMode(state().mode === "idea" ? "extract" : "idea");
      return chooseSeed();
    }
    return find(context);
  }
  function tools() {
    const current = state(),
      opened = life,
      away = remote.size > 0,
      waiting = [...remote.values()].every((value) => value === "queued"),
      busy = loading || current.busy || away,
      count = current.selected.length,
      needsSignIn = current.status === 401 && !authenticated;
    const save = {
      label: keeping
        ? "Saving…"
        : busy
          ? "Wait for the avatars"
          : count && error && cached
            ? "Retry save"
            : count
              ? `Keep ${count} avatar${count === 1 ? "" : "s"}`
              : "Select avatars to keep",
      run: "keep",
      disabled: !count || busy || keeping,
    };
    const open = { label: "Enter world seed", run: "open" };
    const note =
      error ||
      (authenticated && current.status === 401 ? "" : current.error) ||
      (busy
        ? loading
          ? "Reading the current cast."
          : current.queued || (away && waiting)
            ? `Waiting in line · ${current.completed} of 6 replies.`
            : `Finding avatars · ${current.completed} of 6 replies.`
        : current.mode === "idea"
          ? "Describe a world to suggest its characters."
          : "Paste story text to find its characters.");
    const hold = cooldown.label("avatars");
    const controls = away && !loading && !current.busy
      ? {
          label: waiting ? "Waiting in line…" : "Drawing…",
          run: "find",
          disabled: true,
        }
      : busy
      ? { label: "Cancel draw", run: "cancel" }
      : needsSignIn
        ? { label: "Sign in", run: "sign-in" }
        : {
            label: keeping
              ? "Saving…"
              : !draw.text.trim()
                ? "Type a seed first"
                : hold ||
                  (current.cards.length ? "Find more" : "Find avatars"),
            run: "find",
            disabled: !draw.text.trim() || keeping || Boolean(hold),
          };
    const cards = [
      { id: "world-seed", anchor: WORLD, view: { actions: [open] } },
      {
        id: "avatar-seed",
        anchor: AVATARS,
        view: {
          note,
          actions: [busy || needsSignIn ? controls : count ? save : open],
        },
      },
      {
        id: "seed",
        name: "World seed",
        holder: AVATARS,
        group: true,
        state: label(current.mode),
        view: {
          info: label(current.mode),
          note,
          edit: keeping
            ? null
            : {
                key: `${key}:seed:${life}`,
                label: label(current.mode),
                value: draw.text,
                onInput: (text) => { if (opened === life) setText(text); },
              },
          actions: [controls],
        },
      },
      {
        id: "seed-mode",
        name: label(current.mode),
        holder: "designer-tool-seed",
        view: {
          note: "World idea suggests new characters. Story text finds characters in your writing.",
          actions: [
            {
              label: keeping
                ? "Wait for the save"
                : `Use ${label(current.mode === "idea" ? "extract" : "idea").toLowerCase()}`,
              run: "mode",
              disabled: keeping,
            },
          ],
        },
      },
      ...current.cards.map((card) => ({
        id: `seed-${card.id}`,
        holder: AVATARS,
        kind: "avatar",
        name: `${card.name} // ${card.specialAbility}`,
        state: card.suggested ? "Suggested" : "From story text",
        selected: current.selected.includes(card.id),
        select() {
          if (!keeping) draw.select(card.id);
        },
        view: {
          info: current.selected.includes(card.id) ? "Selected" : "Choose",
          note: error || `${card.suggested ? "Suggested. " : ""}${card.description}`,
          actions: [busy ? controls : save],
        },
      })),
    ];
    return cards.map(({ view, ...card }) => ({
      select: () => poke(),
      ...card,
      describe: () => view,
      run,
    }));
  }
  return {
    tools,
    // Reattach: a reply to a draw made before a reload joins the cards.
    async adoptJob(job, rec, run) {
      remote.delete(rec.id);
      if (job.status === "failed") {
        const failed = failedJob(job);
        cooldown.set("avatars", failed);
        error = failed.message;
        changed();
        return;
      }
      if (loading || state().busy || keeping) return "later";
      await run(async (context) => {
        const known = await readNames(context.snapshot({ assets: true }));
        if (context.snapshot().key !== rec.draftKey)
          throw new Error("This editor changed.");
        if (state().mode !== rec.mode) draw.setMode(rec.mode);
        draw.adopt(job.result?.candidate ?? null, rec.sample, known);
      });
    },
    progressJob(rec, job) {
      if (job && job.status !== "done" && job.status !== "failed")
        remote.set(rec.id, job.status);
      else remote.delete(rec.id);
      changed();
    },
    poke,
    transientState: () =>
      draw.text || state().cards.length ? JSON.stringify([life, request, state()]) : null,
    signedIn() {
      authenticated = true;
      changed();
      chooseSeed();
    },
    open(status) {
      life++;
      invalidate();
      key = status.key;
      cached = null;
      keeping = false;
      error = "";
      authenticated = false;
      draw.clear();
      draw.setMode("idea");
      changed();
    },
  };
}
