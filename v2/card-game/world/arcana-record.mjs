import data from "../arcana.json" with { type: "json" };
import { LEVEL_CAP } from "../level-tiers.mjs";
import { humanPresent } from "../human-cast.mjs";

const cardIds = new Set(data.cards.map((card) => card.id));
const FOOL = data.cards.find((card) => card.number === 0).id;
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
    paid: record?.paid === true,
  };
}

export const arcanaLevel = (s, id) => {
  const record = recordOf(s, id);
  return Math.min(LEVEL_CAP, record.level ?? record.proved.length);
};

export const tarotsHeld = (actor) => actor?.arcana?.spread?.length ?? 0;

export const unlockedOf = (s, traveler) =>
  [...new Set((s.actors?.[traveler]?.upgrades || []).filter(isArcanum))].sort();
export const rewardPending = (s, traveler) =>
  recordOf(s, traveler).spread.some((slot) => slot.face === "reward");

export function firstFoolSlot(s, traveler, record = recordOf(s, traveler)) {
  if ((record.level ?? record.proved.length) > 0 || !record.need.includes(FOOL)) return null;
  return record.spread.find((entry) => entry.card === FOOL &&
    ["down", "reward"].includes(entry.face)) ?? null;
}

export function firstFoolProgress(s, traveler) {
  if (arcanaLevel(s, traveler) > 0) return null;
  const record = recordOf(s, traveler);
  const slot = firstFoolSlot(s, traveler, record);
  if (slot) {
    const phase = slot.face === "reward" ? "revealed" : "dealt";
    return { count: CALLS, target: CALLS, phase };
  }
  return { count: record.calls, target: CALLS, phase: record.calls >= CALLS ? "called" : "help" };
}

export function countResidentQuest(actor, resident) {
  const record = (actor.arcana ??= { proved: [], did: [] });
  const callers = record.callers || [];
  if (!resident || callers.includes(resident) || (record.calls ?? 0) >= CALLS)
    return;
  record.callers = [...callers, resident].sort();
  record.calls = (record.calls ?? 0) + 1;
}

export function called(s, traveler) {
  if (!humanPresent(s, traveler) || rewardPending(s, traveler)) return false;
  const record = recordOf(s, traveler);
  return !record.paid && (
    record.sale ||
    (record.calls >= CALLS && arcanaLevel(s, traveler) < LEVEL_CAP &&
      !firstFoolSlot(s, traveler, record))
  );
}

export const calledTravelers = (s) =>
  Object.keys(s.actors || {})
    .sort()
    .filter((id) => called(s, id));

export const selling = (s, traveler) =>
  humanPresent(s, traveler) &&
  !rewardPending(s, traveler) && !recordOf(s, traveler).paid &&
  recordOf(s, traveler).sale;

export const owesGiving = (s, traveler) =>
  recordOf(s, traveler).spread.some(
    (slot) => ["up", "locked"].includes(slot.face) && givingUp.has(slot.card),
  );
