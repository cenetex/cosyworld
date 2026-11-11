import {
  seedCards,
  seedContext,
  seedEdit,
  seedKinds,
} from "./authoring-seed-world.mjs";
import { authoringCardId } from "./authoring-tree.mjs";
import { WORLD } from "./authoring-collections.mjs";
import {
  browserEnv,
  createCooldown,
  failedJob,
  holdJob,
  releaseJob,
  runJob,
} from "./authoring-jobs.mjs";

const noTrack = { accepted() {}, settled() {}, dropped() {} };
const WAITING = new Set(["generation_waiting", "network"]);

export function createSeedMaker({
  changed,
  choose,
  accounts,
  request = globalThis.fetch,
  env = browserEnv,
  track = noTrack,
  poke = () => {},
  cooldown = createCooldown({ changed }),
}) {
  let source,
    key,
    seed = "",
    pending,
    running,
    returning,
    queued = false,
    holding = null,
    details = false;
  // Draws found again after a reload, and messages for a tool's note.
  const remote = new Map(),
    notices = new Map();
  const entity = (c) =>
    authoringCardId(["pack", seedKinds[c.kind], c.id], "entity");
  const available = () => source?.pack?.id === "made-world";
  const cards = () => seedCards(source?.pack);
  const refresh = () => changed();
  const working = (tool, verb = "Drawing…") =>
    running === tool
      ? pending
        ? "Saving…"
        : queued
          ? "Waiting in line…"
          : verb
      : remote.has(tool)
        ? remote.get(tool) === "queued"
          ? "Waiting in line…"
          : verb
        : "";
  // The reason a draw cannot start, shown as the button's label.
  const blocked = (tool) =>
    pending && pending.tool !== tool
      ? "Retry the prepared save first"
      : remote.size && !remote.has(tool)
        ? "Wait for the draw"
        : !pending && !working(tool) && cooldown.label("seed");
  async function save(context, input, tool) {
    const record = context.snapshot();
    if (pending && pending.tool !== tool)
      throw new Error("Retry the prepared save first.");
    running = tool;
    notices.delete(tool);
    changed();
    try {
      await draw(context, input, tool, record);
    } finally {
      running = null;
      if (holding) releaseJob(holding);
      holding = null;
    }
  }
  async function draw(context, input, tool, record) {
    if (!pending) {
      let proposal, jobId;
      if (input.kind && !input.discard) {
        const contextCards = seedContext(source, input.replacing);
        const replacing = input.replacing ? contextCards.shift() : null;
        const body = {
          seed,
          kind: input.kind,
          context: contextCards,
          replacing,
        };
        let job;
        queued = false;
        try {
          const result = await runJob("seed", body, {
            fetch: request,
            env,
            onJob(accepted) {
              holdJob(accepted.id);
              holding = accepted.id;
              job = {
                id: accepted.id,
                draftKey: record.key,
                kind: "seed",
                tool,
                input: structuredClone(input),
                basis: JSON.stringify([contextCards, replacing]),
              };
              return Promise.resolve(track.accepted(job)).catch(() => {});
            },
            onUpdate(next) {
              const waiting = next.status === "queued";
              if (waiting !== queued) {
                queued = waiting;
                changed();
              }
            },
          });
          proposal = result?.cards;
          jobId = job?.id;
        } catch (error) {
          cooldown.set("seed", error);
          if (job && !WAITING.has(error.code)) await track.settled(job.id);
          if (error.status === 401) {
            returning = tool;
            choose(accounts.requireSignIn());
            return;
          }
          throw error;
        } finally {
          queued = false;
        }
      }
      context.snapshot();
      pending = {
        tool,
        value: seedEdit(record, { ...input, cards: proposal }),
        job: jobId,
      };
    }
    await context.accept(pending.value);
    const done = pending.job;
    pending = null;
    if (done) await track.settled(done);
    choose("world");
  }
  function operation(id, name, holder, input, note, verb = name) {
    const busy = input.discard ? "Saving…" : "Drawing…";
    return {
      id,
      name,
      holder,
      select: () => poke(),
      describe: () => ({
        ...(running === id || remote.has(id)
          ? { info: working(id, busy) }
          : {}),
        note: notices.get(id) || note,
        actions: [
          {
            label:
              working(id, busy) ||
              blocked(id) ||
              (pending?.tool === id ? "Retry save" : verb),
            disabled: Boolean(working(id, busy) || blocked(id)),
          },
        ],
      }),
      run: (_action, context) => save(context, input, id),
    };
  }
  const sameWorld = (record, input, basis) => {
    const world = { pack: record.draft.pack };
    const rest = seedContext(world, input.replacing);
    const replacing = input.replacing ? rest.shift() : null;
    return JSON.stringify([rest, replacing]) === basis;
  };
  return {
    // Reattach: a draw found again after a reload or finished off-screen. It is
    // applied only to a world that is as it was when the draw was asked for.
    async adoptJob(job, rec, run) {
      remote.delete(rec.tool);
      if (job.status === "failed") {
        const failed = failedJob(job);
        cooldown.set("seed", failed);
        notices.set(rec.tool, failed.message);
        changed();
        return;
      }
      if (pending?.job === rec.id || running) return "later";
      await run(async (context) => {
        const record = context.snapshot();
        if (record.key !== rec.draftKey)
          throw new Error("This editor changed.");
        if (
          pending ||
          !available() ||
          !sameWorld(record, rec.input, rec.basis)
        ) {
          notices.set(
            rec.tool,
            "A draw you asked for finished but was not applied, because this world changed after you asked. Draw again.",
          );
          changed();
          return;
        }
        let value;
        try {
          value = seedEdit(record, { ...rec.input, cards: job.result?.cards });
        } catch (error) {
          notices.set(rec.tool, error.message);
          changed();
          return;
        }
        pending = { tool: rec.tool, value, job: rec.id };
        try {
          await context.accept(value);
        } catch (error) {
          pending = null;
          throw error;
        }
        pending = null;
        choose("world");
      });
    },
    progressJob(rec, job) {
      if (job && job.status !== "done" && job.status !== "failed")
        remote.set(rec.tool, job.status);
      else remote.delete(rec.tool);
      changed();
    },
    detailed: () => !available() || details,
    clear() {
      seed = "";
      pending = returning = null;
    },
    sync(next, status) {
      if (key !== status.key) {
        key = status.key;
        seed = "";
        pending = returning = null;
        details = false;
      }
      source = next;
      // Details pairs the seed tool with World; an emptied world seeds again
      // from the simple view, so two tools never anchor on one card.
      if (available() && !cards().length) details = false;
    },
    transient: () =>
      seed || pending ? JSON.stringify([key, seed, pending?.tool]) : null,
    signedIn() {
      if (!returning) return false;
      const target = returning;
      returning = null;
      choose(target);
      return true;
    },
    project(base) {
      if (!available() || details) return base;
      const filled = cards().length > 0;
      const empty = Object.values(seedKinds)
        .filter((group) => !Object.keys(source.pack[group]).length)
        .map((group) => authoringCardId(["pack", group], "collection"));
      return {
        ...base,
        world: base.world
          .filter(
            (c) =>
              c.id === WORLD ||
              (filled && (c.role === "entity" || empty.includes(c.id))),
          )
          .map((c) => {
            if (c.id === WORLD)
              return { ...c, name: filled ? source.pack.name : "Create" };
            if (c.role !== "entity") return c;
            const first = cards().find((card) => card.kind === c.kind);
            return {
              ...c,
              holder: first.id === c.canonicalId ? WORLD : entity(first),
            };
          }),
      };
    },
    tools() {
      if (!available()) return [];
      const current = cards(),
        filled = current.length > 0;
      const seedTool = {
        id: "maker-seed",
        name: "Enter world seed",
        ...(filled ? {} : { anchor: WORLD }),
        select: () => poke(),
        describe: ({ status }) => ({
          name: "Enter world seed",
          info: working("maker-seed") || "Type your idea below",
          note:
            notices.get("maker-seed") ||
            "Describe a world. Create draws an avatar, an item and a location.",
          edit: {
            key: `${key}:maker-seed`,
            label: "World seed",
            value: seed,
            onInput: (text) => {
              seed = text;
              refresh();
            },
          },
          actions: filled
            ? []
            : [
                {
                  label:
                    working("maker-seed") ||
                    (pending
                      ? "Retry save"
                      : !seed.trim()
                        ? "Type a seed first"
                        : seed.length > 6000
                          ? "Seed is too long"
                          : blocked("maker-seed") || "Create"),
                  disabled:
                    Boolean(working("maker-seed")) ||
                    (!pending &&
                      (!seed.trim() ||
                        seed.length > 6000 ||
                        Boolean(blocked("maker-seed")))),
                },
              ],
        }),
        run: (_action, context) =>
          save(context, { kind: "world" }, "maker-seed"),
      };
      const cancel = pending
        ? [
            {
              id: "discard-draw",
              name: "Discard draw",
              describe: () => ({
                note: "Keep the saved world and discard this prepared draw.",
                actions: [{ label: "Discard draw" }],
              }),
              run() {
                pending = null;
                refresh();
                choose("world");
              },
            },
          ]
        : [];
      if (!filled) return [seedTool, ...cancel];
      const tools = [
        seedTool,
        ...cancel,
        {
          id: "maker-details",
          name: details ? "Simple cards" : "Show details",
          describe: () => ({
            note: "Choose how much of each card to show.",
            actions: [
              { label: details ? "Show simple cards" : "Show details" },
            ],
          }),
          run() {
            details = !details;
            refresh();
            choose("world");
          },
        },
      ];
      for (const [kind, group] of Object.entries(seedKinds)) {
        const first = current.find((c) => c.kind === kind);
        tools.push(
          operation(
            `uncover-${kind}`,
            `Uncover ${kind === "place" ? "location" : kind}`,
            !details && first
              ? entity(first)
              : authoringCardId(["pack", group], "collection"),
            { kind },
            "Draw another card from this world.",
          ),
        );
      }
      for (const c of current) {
        const holder = entity(c);
        tools.push(
          operation(
            `regenerate-${c.id}`,
            "Regenerate",
            holder,
            { kind: c.kind, replacing: c.id },
            `Draw new text for ${c.name}. Its place and links stay with it.`,
          ),
        );
        tools.push(
          operation(
            `discard-${c.id}`,
            "Discard",
            holder,
            { kind: c.kind, discard: c.id },
            `Discard ${c.name} and update its links. Undo restores this edit.`,
          ),
        );
        if (c.kind === "avatar") {
          const want = source.pack.avatars[c.id].want,
            target = current.find((card) => card.id === want?.target);
          const note = target
            ? `${c.name} wants ${target.name}.`
            : `Choose a starting quest for ${c.name}.`;
          const questId = `quest-${c.id}`;
          tools.push(
            operation(
              questId,
              "Starting quest",
              holder,
              { quest: c.id },
              note,
              want ? "Regenerate quest" : "Generate quest",
            ),
          );
          if (want)
            tools.push(
              operation(
                `discard-quest-${c.id}`,
                "Discard quest",
                `designer-tool-${questId}`,
                { quest: c.id, discard: true },
                note,
              ),
            );
        }
      }
      return tools;
    },
  };
}
