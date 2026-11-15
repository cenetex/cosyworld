import data from "../arcana.json" with { type: "json" };
import { LEVEL_CAP } from "../level-tiers.mjs";
import { humanPresent } from "../human-cast.mjs";

const cardIds = new Set(data.cards.map((card) => card.id));
export const isArcanum = (id) => cardIds.has(id);
export const CALLS = data.calls;

export function recordOf(s, traveler) {
  const record = s.actors?.[traveler]?.arcana;
  return {
    proved: record?.proved || [],
    did: record?.did || [],
    dealt: record?.dealt ?? null,
    base: record?.base || {},
    calls: record?.calls ?? 0,
    sale: record?.sale === true,
  };
}

export const arcanaLevel = (s, id) =>
  Math.min(LEVEL_CAP, recordOf(s, id).proved.length);

export const tarotsHeld = (actor) => actor?.arcana?.spread?.length ?? 0;

export function countResidentQuest(actor) {
  const record = (actor.arcana ??= { proved: [], did: [] });
  record.calls = Math.min(CALLS, (record.calls ?? 0) + 1);
}

export function called(s, traveler) {
  if (!humanPresent(s, traveler)) return false;
  const record = recordOf(s, traveler);
  return (
    record.sale ||
    (record.calls >= CALLS &&
      (arcanaLevel(s, traveler) < LEVEL_CAP ||
        (s.actors[traveler].arcana?.spread || []).some(
          (slot) => slot.face === "down",
        )))
  );
}

export const calledTravelers = (s) =>
  Object.keys(s.actors || {})
    .sort()
    .filter((id) => called(s, id));

export const selling = (s, traveler) =>
  humanPresent(s, traveler) && recordOf(s, traveler).sale;
