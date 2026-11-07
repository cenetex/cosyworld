import { entityEnabled } from "./pack-registry.mjs";

// One visible hand choice sits beside custody. A covering remains on its
// item; only directly carried, available things can be chosen in hand.
export function handSnapshot(world) {
  return Object.fromEntries(
    Object.entries(world.items)
      .filter(
        ([id, item]) => world.actors[item.holder] && entityEnabled(world, id),
      )
      .map(([id, item]) => [id, item.holder]),
  );
}
const choicesFor = (hands, actor) =>
  Object.keys(hands)
    .filter((id) => hands[id] === actor)
    .sort();
export function heldItem(world, actor) {
  const choices = choicesFor(handSnapshot(world), actor);
  return choices.includes(world.actors[actor]?.heldItem)
    ? world.actors[actor].heldItem
    : (choices[0] ?? null);
}
export const validHeldItems = (world) =>
  Object.values(world.actors || {}).every(
    (actor) =>
      actor.heldItem === undefined ||
      actor.heldItem === null ||
      (typeof actor.heldItem === "string" &&
        Object.hasOwn(world.items, actor.heldItem)),
  );

// Every play chooses from its actual result. A fresh receipt takes the hand;
// a valid existing choice stays otherwise. Old saves use the same stable
// fallback, and an empty inventory leaves the hand empty.
export function settleHeldItems(world, before = null) {
  if (!validHeldItems(world)) throw new Error("The held item is invalid.");
  const hands = handSnapshot(world);
  for (const [id, actor] of Object.entries(world.actors)) {
    const choices = choicesFor(hands, id),
      arrived = before ? choices.filter((item) => before[item] !== id) : [],
      saved = actor.heldItem;
    actor.heldItem = arrived.includes(saved)
      ? saved
      : (arrived.at(-1) ??
        (choices.includes(saved) ? saved : (choices[0] ?? null)));
  }
}
