import { entityActive } from "../pack-registry.mjs";

// Shallow holder walks avoid allocating a cycle-detection set.
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
export function itemPlace(s, id) {
  const holder = rootHolder(s, id);
  return s.actors[holder]?.place || holder;
}
export const carried = (s, actor, itemIds = Object.keys(s.items)) =>
  itemIds.filter((id) => rootHolder(s, id) === actor);
export const loadOf = (s, id) => 1 + (s.items.cloth.holder === id ? 1 : 0);
export function hasSpace(s, actor, id, itemIds) {
  const added = rootHolder(s, id) === actor ? 0 : loadOf(s, id);
  return carried(s, actor, itemIds).length + added <= 3;
}
export function hasSpaceForItems(s, actor, items) {
  if (items.length === 1) return hasSpace(s, actor, items[0]);
  const incoming = new Set(items);
  if (incoming.has(s.items.cloth.holder)) incoming.add("cloth");
  const added = [...incoming].filter((id) => rootHolder(s, id) !== actor);
  return carried(s, actor).length + added.length <= 3;
}
export const shining = (s) =>
  entityActive(s, "lamp") &&
  s.items.lamp.lit &&
  s.items.lamp.fuel > 0;
