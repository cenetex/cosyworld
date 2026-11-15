import data from "../arcana.json" with { type: "json" };
import { LEVEL_CAP } from "../level-tiers.mjs";
import { humanPresent } from "../human-cast.mjs";

const cardIds = new Set(data.cards.map((card) => card.id));
export const isArcanum = (id) => cardIds.has(id);
export const CALLS = data.calls;
const didsOf = (c) =>
  c.kind === "did"
    ? [c]
    : [...(c.conditions || []), ...(c.condition ? [c.condition] : [])].flatMap(
        didsOf,
      );
const givingUp = new Set(
  data.cards
    .filter((card) =>
      card.proof.flatMap(didsOf).some((c) => (c.with || []).includes("gone")),
    )
    .map((card) => card.id),
);

export function recordOf(s, traveler) {
  const record = s.actors?.[traveler]?.arcana;
  return {
    proved: record?.proved || [],
    did: record?.did || [],
    level: record?.level ?? null,
    calls: record?.calls ?? 0,
    callers: record?.callers || [],
    need: record?.need || [],
    done: record?.done || [],
    spread: record?.spread || [],
    sale: record?.sale === true,
  };
}

export const arcanaLevel = (s, id) => {
  const record = recordOf(s, id);
  return Math.min(LEVEL_CAP, record.level ?? record.proved.length);
};

export const tarotsHeld = (actor) =>
  actor?.arcana?.spread?.filter((slot) => slot.accepted === true).length ?? 0;

export const unlockedOf = (s, traveler) =>
  [...new Set((s.actors?.[traveler]?.upgrades || []).filter(isArcanum))].sort();

export function countResidentQuest(actor, resident) {
  const record = (actor.arcana ??= { proved: [], did: [] });
  const callers = record.callers || [];
  if (!resident || callers.includes(resident) || (record.calls ?? 0) >= CALLS)
    return;
  record.callers = [...callers, resident].sort();
  record.calls = (record.calls ?? 0) + 1;
}

export function called(s, traveler) {
  if (!humanPresent(s, traveler)) return false;
  const record = recordOf(s, traveler);
  return (
    record.sale ||
    (record.calls >= CALLS &&
      (arcanaLevel(s, traveler) < LEVEL_CAP ||
        record.spread.some((slot) => slot.face === "down")))
  );
}

export const calledTravelers = (s) =>
  Object.keys(s.actors || {})
    .sort()
    .filter((id) => called(s, id));

export const selling = (s, traveler) =>
  humanPresent(s, traveler) && recordOf(s, traveler).sale;

export const owesGiving = (s, traveler) =>
  recordOf(s, traveler).spread.some(
    (slot) => slot.accepted && slot.face !== "down" && givingUp.has(slot.card),
  );
