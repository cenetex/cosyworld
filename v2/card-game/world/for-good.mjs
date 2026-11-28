import forest from "../forest.json" with { type: "json" };
import { useUpForGood } from "../item-use.mjs";
import { neverBack, packPeople, packThings } from "../pack-registry.mjs";

export const canSacrifice = (id) => !packThings[id]?.tags?.includes("staple");

const restOf = (id) =>
  packThings[id]?.home ??
  packThings[id]?.holder ??
  forest.initialState.items[id]?.holder;
const startOf = (id) =>
  forest.initialState.actors?.[id]?.place ?? packPeople[id]?.place;

export function restForGood(item) {
  let rest = restOf(item);
  for (let i = 0; i < 8 && rest !== undefined; i++) {
    if (startOf(rest)) return startOf(rest);
    if (restOf(rest) === undefined) return rest;
    rest = restOf(rest);
  }
  return rest;
}

export function giveUpForGood(s, item) {
  const rest = restForGood(item);
  if (!s.items[item] || rest === undefined) return false;
  useUpForGood(s, item, rest);
  return true;
}

export const goneSince = (s, usedBefore) =>
  (s.usedUp || [])
    .filter((id) => !usedBefore.has(id) && neverBack(s, id))
    .sort();
