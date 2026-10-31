// Talk reveals what a person wants: one first-person line from their want.
// It reads the world and never changes it. Another avatar's want reaches the
// player only through a Talk play with that avatar.
import forest from "./forest.json" with { type: "json" };
import { entityActive, packPeople } from "./pack-registry.mjs";
import { questFromData } from "./pack-schema.mjs";
export { questFromData };

// The authored first want, until the rules keep one on the actor.
export const authoredWant = (id) =>
  questFromData(forest.people[id]?.want || packPeople[id]?.want || null);
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
  const here = world.actors[id].place;
  if (want.verb === "have") return rootOf(world, want.target) === id;
  if (want.verb === "visit") return here === want.target;
  if (want.verb === "find") return world.actors[want.target]?.place === here;
  return false;
}

// One line in the speaker's words. A speaker with no way out of where they
// are says so first; anyone listening may come looking.
export function wantFact(world, id, nameOf, { stuck = false } = {}) {
  const want = wantOf(world, id);
  const stuckLine = stuck ? "I'm stuck here. I can't find a way out. " : "";
  if (!want || !world.actors?.[id] || !entityActive(world, want.target))
    return stuck ? stuckLine.trim() : null;
  const avatar = (x) => Boolean(world.actors[x]);
  const item = (x) => Boolean(world.items[x]);
  const ok = {
    have: item(want.target),
    visit: true,
    find: avatar(want.target),
    talk: avatar(want.target),
    give: item(want.target) && avatar(want.with),
    travel_with: avatar(want.target) && Boolean(want.with),
  }[want.verb];
  if (!ok) return stuck ? stuckLine.trim() : null;
  if (met(world, id, want)) return stuck ? stuckLine.trim() : null;
  const name = nameOf(want.target);
  const second = want.with && nameOf(want.with);
  const line = {
    have: `I want ${article(name)}.`,
    visit: `I want to be at ${name}.`,
    find: `I want to find ${name}.`,
    talk: `I want to talk with ${name}.`,
    give: `I want to give ${article(name)} to ${second}.`,
    travel_with: `I want to travel with ${name} to ${second}.`,
  }[want.verb];
  return stuckLine + line;
}

// The player's own want, and the want of the person on either side of Talk.
export const wantHeard = (world, played, id, player) =>
  id === player ||
  (played?.verb === "talk" && [played.actorId, played.targetId].includes(id));
