import data from "../arcana.json" with { type: "json" };
import { currentActor } from "../human-cast.mjs";

const cardIds = new Set(data.cards.map((card) => card.id));
export const isArcanum = (id) => cardIds.has(id);

export function recordOf(s, traveler) {
  const record = s.actors?.[traveler]?.arcana;
  return {
    proved: record?.proved || [],
    held: record?.held || [],
    did: record?.did || [],
  };
}

export const arcanumOpen = (s, id, actor = currentActor(s)) => {
  const record = recordOf(s, actor);
  return record.proved.includes(id) && !record.held.includes(id);
};
