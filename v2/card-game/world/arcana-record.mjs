import data from "../arcana.json" with { type: "json" };
import { LEVEL_CAP } from "../level-tiers.mjs";

const cardIds = new Set(data.cards.map((card) => card.id));
export const isArcanum = (id) => cardIds.has(id);

export function recordOf(s, traveler) {
  const record = s.actors?.[traveler]?.arcana;
  return {
    proved: record?.proved || [],
    did: record?.did || [],
    dealt: record?.dealt ?? null,
    base: record?.base || {},
  };
}

export const arcanaLevel = (s, id) =>
  Math.min(LEVEL_CAP, recordOf(s, id).proved.length);
