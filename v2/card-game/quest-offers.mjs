import { canCarryQuest, questCarried } from "./quest-hands.mjs";
// Generated wishes share a family; authored and earned quests keep their identities.
const QUEST_OFFER_GAP = 8;
const QUEST_OFFER_LIMIT = 2;
export const questOfferFamily = (program) =>
  program?.generated
    ? program.generated.situation ||
      (program.generated.solo ? "solo" : "bargain")
    : null;

const recordsFor = (world, actor) => {
  const collection = world.life?.actors?.[actor]?.collection;
  return [...(collection?.cards || []), ...(collection?.archive || [])]
    .map((key) => world.quests?.records?.[key])
    .filter(Boolean);
};
// Hand members and alternatives are sets; the order of quest steps is meaningful.
const goalValue = (value, key = "") => {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => goalValue(entry));
    return ["items", "avatars", "conditions", "any"].includes(key)
      ? entries.sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
        )
      : entries;
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, goalValue(value[key], key)]),
    );
  return value;
};
export const questGoalSignature = (program) =>
  JSON.stringify(goalValue(program.steps));

export function canOfferQuest(world, actor, program = null) {
  const all = recordsFor(world, actor);
  const records = all.filter((q) => questOfferFamily(q.program));
  const pending = records.filter(
    (q) => q.completedTurn === null && questCarried(world, actor, q.key),
  );
  const latest = Math.max(
    -QUEST_OFFER_GAP,
    world.life.actors[actor].collection.lastOfferTurn ?? -QUEST_OFFER_GAP,
    ...records.map((q) => q.createdTurn),
  );
  return (
    canCarryQuest(world, actor) &&
    pending.length < QUEST_OFFER_LIMIT &&
    world.turn - latest >= QUEST_OFFER_GAP &&
    (!program ||
      (!pending.some(
        (q) => questOfferFamily(q.program) === questOfferFamily(program),
      ) &&
        !all.some(
          (q) =>
            q.completedTurn === null &&
            questGoalSignature(q.program) === questGoalSignature(program),
        )))
  );
}
