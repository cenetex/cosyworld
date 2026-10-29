import { places, things, rootHolder, currentActor } from "./world.mjs";
import { isQuestCard, questForCard } from "./quest-cards.mjs";

// Each collection has a front card. Opening a stack only changes its layout.
export function handLayout(world, cards, view, notice = null) {
  const {
    selected,
    shownItems,
    shownQuests,
    frontLocations,
    expandedLocations,
    shownHolders,
    expandedHolders,
    expandedQuestHolders,
  } = view;
  const here = world.actors[currentActor(world)].place;
  const groups = new Map();
  const layout = new Map();
  for (const id of cards) {
    const quest = isQuestCard(id) ? questForCard(world, id, notice) : null;
    const destination = places[id] && id !== here;
    const holder =
      quest?.actor ||
      (destination ? here : things[id] ? rootHolder(world, id) : null);
    const kind = quest ? "quest" : destination ? "location" : "item";
    layout.set(id, {
      holder,
      hidden: false,
      stacked: false,
      index: 0,
      count: 1,
    });
    if (!holder) continue;
    const key = `${holder}:${kind}`;
    if (!groups.has(key)) groups.set(key, { holder, kind, cards: [] });
    groups.get(key).cards.push(id);
  }
  const ordered = [...cards];
  for (const { holder, kind, cards: deck } of groups.values()) {
    const front =
      kind === "item"
        ? shownItems[holder]
        : kind === "location"
          ? frontLocations[holder]
          : deck.find(
              (id) =>
                questForCard(world, id, notice)?.key === shownQuests[holder],
            );
    const expanded = (
      kind === "item"
        ? expandedHolders
        : kind === "location"
          ? expandedLocations
          : expandedQuestHolders
    ).has(holder);
    const shown =
      shownHolders.has(holder) ||
      selected.includes(holder) ||
      Boolean(shownItems[holder]) ||
      Boolean(shownQuests[holder]) ||
      deck.some((id) => selected.includes(id));
    const sorted = expanded
      ? deck
      : [...deck].sort((a, b) => Number(b === front) - Number(a === front));
    const positions = ordered.flatMap((id, i) =>
      deck.includes(id) ? [i] : [],
    );
    positions.forEach((at, i) => {
      ordered[at] = sorted[i];
    });
    sorted.forEach((id, index) => {
      const raised = selected.includes(id);
      layout.set(id, {
        holder,
        kind,
        index,
        count: deck.length,
        hidden: !shown && !raised,
        stacked: !expanded && index > 0 && !raised,
        front: index === 0,
        expanded,
      });
    });
  }
  const children = new Map();
  const membership = new Set(ordered);
  for (const id of ordered) {
    const holder = layout.get(id).holder;
    if (!membership.has(holder)) continue;
    if (!children.has(holder)) children.set(holder, []);
    children.get(holder).push(id);
  }
  const rank = { item: 0, quest: 1, location: 2 };
  const grouped = [],
    seen = new Set();
  const append = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    grouped.push(id);
    const deck = children.get(id) || [];
    deck.sort((a, b) => rank[layout.get(a).kind] - rank[layout.get(b).kind]);
    for (const child of deck) append(child);
  };
  for (const id of ordered)
    if (!membership.has(layout.get(id).holder)) append(id);
  for (const id of ordered) append(id);
  return { cards: grouped, layout };
}
