// Item lookups: who holds what and whether it is carried or lit.
import { entityActive } from "../pack-registry.mjs";
import { ids } from "../world.mjs";

// Holder chains are a few links deep, so the walk tracks visits only when a
// chain runs long enough to hide a loop: the common case allocates nothing.
const SHORT_CHAIN = 32;
export function rootHolder(s, id) {
  let holder = s.items[id].holder;
  for (let step = 0; step < SHORT_CHAIN; step++) {
    if (!s.items[holder]) return holder;
    if (holder === id) throw new Error("An item holds itself.");
    holder = s.items[holder].holder;
  }
  holder = s.items[id].holder;
  const visited = new Set([id]);
  while (s.items[holder]) {
    if (visited.has(holder)) throw new Error("An item holds itself.");
    visited.add(holder);
    holder = s.items[holder].holder;
  }
  return holder;
}
export const itemPlace = (s, id) =>
  s.actors[rootHolder(s, id)]?.place || rootHolder(s, id);
export const carried = (s, actor) =>
  ids.filter((id) => rootHolder(s, id) === actor);
export const shining = (s) =>
  entityActive(s, "lamp") &&
  entityActive(s, "oil") &&
  itemPlace(s, "oil") === itemPlace(s, "lamp");
