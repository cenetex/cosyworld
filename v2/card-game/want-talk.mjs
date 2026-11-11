// Talk reveals what a person wants: one first-person line from their want.
// It reads the world and never changes it. Another avatar's want reaches the
// player only through a Talk play with that avatar.
import { layMet } from "./want.mjs";
import forest from "./forest.json" with { type: "json" };
import {
  consumable,
  packThings,
  entityActive,
  heldSlots,
  makerChoice,
  packPeople,
} from "./pack-registry.mjs";

// The authored first want, until the rules keep one on the actor.
export const authoredWant = (id) =>
  forest.people[id]?.want || packPeople[id]?.want || null;
export const wantOf = (world, id) =>
  world.actors?.[id]?.want || authoredWant(id);

const rootOf = (world, item) => {
  let holder = world.items[item]?.holder;
  const seen = new Set([item]);
  while (world.items[holder] && !seen.has(holder)) {
    seen.add(holder);
    holder = world.items[holder].holder;
  }
  return holder;
};
const article = (name) => (/^(the|a|an) /iu.test(name) ? name : `the ${name}`);

// The want already met is not a current want, so it stays unsaid.
function met(world, id, want) {
  // An introduction is met only by a Talk, so it is always still to come.
  if (want.kind === "connect") return false;
  const here = world.actors[id].place;
  // Holding a food it wants to eat is not eating it (rules 102).
  if (want.kind === "item")
    return want.step?.verb !== "eat" && rootOf(world, want.target) === id;
  if (want.step?.verb === "lay") return layMet(world, want);
  if (want.kind === "place") return here === want.target;
  return world.actors[want.target]?.place === here;
}

// Whether Talk says this want of theirs: one still to meet, of a thing,
// place or person in the world. The rules give a quest for the same want
// (talk-quest.mjs), so the caption and the quest always agree.
//
// A pack resident whose authored want declares `minTrust` (1 to 3) tells it
// only to a listener it trusts that much. Without a listener, or without
// `minTrust`, nothing is withheld. The field lives in pack data: the saved
// want is matched to the authored one by kind and target.
function trustedEnough(world, id, want, listener) {
  const authored = packPeople[id]?.want;
  if (!listener || !authored?.minTrust) return true;
  if (authored.kind !== want.kind || authored.target !== want.target)
    return true;
  return (world.actors[id].trust?.[listener] || 0) >= authored.minTrust;
}
export function revealed(world, id, want, listener) {
  return Boolean(
    want &&
      world.actors?.[id] &&
      // A made thing still locked is wanted all the same (rules 102).
      (entityActive(world, want.target) ||
        Boolean(packThings[want.target]?.locked)) &&
      !(want.kind === "item" && !world.items[want.target]) &&
      !(want.kind === "person" && !world.actors[want.target]) &&
      !met(world, id, want) &&
      trustedEnough(world, id, want, listener),
  );
}

export function wantFact(world, id, nameOf, listener) {
  const want = wantOf(world, id);
  if (want?.kind === "connect" && world.actors?.[id])
    return "I want to introduce you to someone.";
  // A maker wants the thing it makes and names the set it is made from.
  const making =
    want?.kind === "item" && world.actors?.[id] && makerChoice(id, want.target);
  if (making) {
    const set = heldSlots(making.requires).map((slot) =>
      slot.map((item) => article(nameOf(item))).join(" or "),
    );
    return `I want ${article(nameOf(want.target))}: ${set.slice(0, -1).join(", ")}${set.length > 1 ? " and " : ""}${set.at(-1)}.`;
  }
  if (!revealed(world, id, want, listener)) return null;
  const name = nameOf(want.target);
  if (want.step?.verb === "lay")
    return `I want ${want.step.items.map((item) => article(nameOf(item))).join(", ")} laid in ${name}.`;
  return want.kind === "item"
      ? want.step?.verb === "eat"
        ? `I want to ${consumable(want.target) === "drink" ? "drink" : "eat"} ${article(name)}${want.step.at ? ` at ${nameOf(want.step.at)}` : ""}.`
        : `I want ${article(name)}.`
      : want.kind === "place"
        ? `I want to be at ${name}.`
        : `I want to see ${name}.`;
}

// The player's own want, and the want of the person on either side of Talk.
export const wantHeard = (world, played, id, player) =>
  id === player ||
  (played?.verb === "talk" && [played.actorId, played.targetId].includes(id));
