import forest from "../forest.json" with { type: "json" };
import { useUpForGood } from "../item-use.mjs";
import { neverBack, packThings } from "../pack-registry.mjs";

export const restForGood = (item) =>
  packThings[item]?.holder ?? forest.initialState.items[item]?.holder;

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
