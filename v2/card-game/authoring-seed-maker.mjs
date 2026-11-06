import {
  seedCards,
  seedContext,
  seedEdit,
  seedKinds,
} from "./authoring-seed-world.mjs";
import { authoringCardId } from "./authoring-tree.mjs";
import { WORLD } from "./authoring-collections.mjs";

export function createSeedMaker({
  changed,
  choose,
  accounts,
  request = fetch,
}) {
  let source,
    key,
    seed = "",
    pending,
    returning,
    details = false;
  const entity = (c) =>
    authoringCardId(["pack", seedKinds[c.kind], c.id], "entity");
  const available = () => source?.pack?.id === "made-world";
  const cards = () => seedCards(source?.pack);
  const refresh = () => changed();
  async function save(context, input, tool) {
    const record = context.snapshot();
    if (pending && pending.tool !== tool)
      throw new Error("Retry the prepared save first.");
    if (!pending) {
      let proposal;
      if (input.kind && !input.discard) {
        const contextCards = seedContext(source, input.replacing);
        const replacing = input.replacing ? contextCards.shift() : null;
        const response = await request("/card-game/authoring/generate/seed", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seed,
            kind: input.kind,
            context: contextCards,
            replacing,
          }),
          signal: AbortSignal.timeout(65_000),
        });
        const result = await response.json().catch(() => ({}));
        if (response.status === 401) {
          returning = tool;
          choose(accounts.requireSignIn());
          return;
        }
        if (!response.ok)
          throw new Error(result.error || "Try drawing this card again.");
        proposal = result.cards;
      }
      context.snapshot();
      pending = {
        tool,
        value: seedEdit(record, { ...input, cards: proposal }),
      };
    }
    await context.accept(pending.value);
    pending = null;
    choose("world");
  }
  function operation(id, name, holder, input, note, verb = name) {
    return {
      id,
      name,
      holder,
      describe: () => ({
        note,
        actions: [
          {
            label: pending?.tool === id ? "Retry save" : verb,
            disabled: Boolean(pending && pending.tool !== id),
          },
        ],
      }),
      run: (_action, context) => save(context, input, id),
    };
  }
  return {
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
        describe: ({ status }) => ({
          name: "Enter world seed",
          info: status.busy ? "Creating" : "Type your idea below",
          note: "Describe a world. Create draws an avatar, an item and a location.",
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
                  label: pending ? "Retry save" : "Create",
                  disabled: !seed.trim() || seed.length > 6000,
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
