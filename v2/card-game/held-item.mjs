import { entityEnabled } from "./pack-registry.mjs";

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
  if (world.actors[actor]?.heldItem === null) return null;
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

// A receipt takes the hand. Otherwise retain a valid choice, including null, or use the legacy fallback.
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
        (saved === null || choices.includes(saved)
          ? saved
          : (choices[0] ?? null)));
  }
}

// Choose only a directly carried card. An empty hand stays empty across saves and settlement.
export function chooseHeldItem(world, actor, item) {
  if (!Object.hasOwn(world.actors, actor))
    throw new Error("Choose an avatar in this world.");
  if (
    item !== null &&
    (typeof item !== "string" || handSnapshot(world)[item] !== actor)
  )
    throw new Error("Choose an item in your own hand.");
  world.actors[actor].heldItem = item;
}

export function applyHeldChoice(world, actor, choice) {
  if (
    !choice ||
    Object.keys(choice).some((key) => !["item", "revision"].includes(key)) ||
    choice.revision !== world.revision
  )
    throw new Error("The world changed. Choose an item again.");
  chooseHeldItem(world, actor, choice.item);
  world.revision += 1;
}
