// Talk reveals what a person wants: one first-person line from their want.
// It reads the world and never changes it. Another avatar's want reaches the
// player only through a Talk play with that avatar.
import forest from "./forest.json" with { type: "json" };
import { entityActive, packPeople } from "./pack-registry.mjs";

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
  if (want.kind === "item") return rootOf(world, want.target) === id;
  if (want.kind === "place") return here === want.target;
  return world.actors[want.target]?.place === here;
}

export function wantFact(world, id, nameOf) {
  const want = wantOf(world, id);
  if (want?.kind === "connect" && world.actors?.[id])
    return "I want to introduce you to someone.";
  if (!want || !world.actors?.[id] || !entityActive(world, want.target))
    return null;
  if (want.kind === "item" && !world.items[want.target]) return null;
  if (want.kind === "person" && !world.actors[want.target]) return null;
  if (met(world, id, want)) return null;
  const name = nameOf(want.target);
  const line =
    want.kind === "item"
      ? `I want ${article(name)}.`
      : want.kind === "place"
        ? `I want to be at ${name}.`
        : `I want to see ${name}.`;
  // Only the top quest is said; the rest of the stack is a count.
  const more = world.actors[id].under?.length || 0;
  return more
    ? `${line} I have ${more === 1 ? "one other quest" : `${more} other quests`} too.`
    : line;
}

// The player's own want, and the want of the person on either side of Talk.
export const wantHeard = (world, played, id, player) =>
  id === player ||
  (played?.verb === "talk" && [played.actorId, played.targetId].includes(id));
