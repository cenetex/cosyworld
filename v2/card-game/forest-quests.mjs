// The first forest chapter derives its cards from saved pack choices.
// The shared story registry owns participants, hand membership and completion.
export const FOREST_QUEST_CARDS = [
  "story-quest-forest-hearth",
  "story-quest-forest-path",
  "story-quest-forest-homecoming",
];

const groups = [
  ["forest-stay-for-tea", "forest-mend-scarf"],
  [
    "forest-stay-for-tea",
    "forest-clear-drain",
    "forest-set-stones",
    "forest-share-symbols",
  ],
  [
    "forest-set-watch-bell",
    "forest-mark-pawprints",
    "forest-tell-hearth",
    "forest-tell-path",
    "forest-leave-charm",
    "forest-keep-charm",
  ],
];

export function forestDefinitions(world) {
  const state = world.packs?.["lonely-forest"];
  if (!state) return [];
  const flags = state.flags || {},
    receipts = state.receipts || {};
  const firstReceipt = (...ids) =>
    ids.find((id) => Object.hasOwn(receipts, id));
  const make = (index, line, art, holder, createdTurn, choiceId, resolved) => ({
    id: FOREST_QUEST_CARDS[index],
    key: `lonely-forest:${FOREST_QUEST_CARDS[index]}`,
    packId: "lonely-forest",
    title: line,
    purpose: line,
    singleLine: true,
    story: true,
    status: resolved ? "fulfilled" : "pending",
    art,
    resolved,
    completion: "Fulfilled",
    holder,
    choiceId,
    createdTurn,
  });
  const cards = [];
  if (Object.hasOwn(state.met || {}, "rati") || flags["forest-welcomed"])
    cards.push(
      make(
        0,
        "A button for the blue scarf.",
        "forest-story-button",
        { kind: "avatar", id: "rati" },
        state.met.rati ?? receipts["forest-stay-for-tea"] ?? 0,
        "forest-mend-scarf",
        flags["forest-scarf-mended"] === true,
      ),
    );
  if (flags["forest-welcomed"])
    cards.push(
      make(
        1,
        "Footsteps through the rain.",
        "forest-dewbright-button",
        { kind: "place", id: "forest-garden" },
        receipts["forest-stay-for-tea"],
        "forest-share-symbols",
        flags["forest-symbols-shared"] === true,
      ),
    );
  const watch = firstReceipt("forest-set-watch-bell", "forest-mark-pawprints");
  if (watch) {
    const ending = firstReceipt("forest-leave-charm", "forest-keep-charm");
    cards.push(
      make(
        2,
        "What will the oak hear?",
        "forest-wolfprint-charm",
        { kind: "avatar", id: "skull" },
        receipts[watch],
        ending || "forest-leave-charm",
        flags["forest-homecoming-shared"] === true,
      ),
    );
  }
  return cards;
}

export function forestRelated(definition, event) {
  const index = FOREST_QUEST_CARDS.indexOf(definition.id);
  return (
    event.packId === "lonely-forest" &&
    index >= 0 &&
    groups[index].includes(event.choiceId)
  );
}
