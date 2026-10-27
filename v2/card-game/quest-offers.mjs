// Generated wishes share a family; authored and earned quests keep their identities.
export const QUEST_OFFER_GAP = 8;
export const QUEST_OFFER_LIMIT = 2;
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
  const pending = records.filter((q) => q.completedTurn === null);
  const latest = Math.max(
    -QUEST_OFFER_GAP,
    world.life.actors[actor].collection.lastOfferTurn ?? -QUEST_OFFER_GAP,
    ...records.map((q) => q.createdTurn),
  );
  return (
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

// Call after save validation. A selected, shared or earned purpose keeps every fact.
export function pruneQuestOffers(world) {
  for (const [actor, life] of Object.entries(world.life?.actors || {})) {
    const collection = life.collection;
    if (!collection || !world.quests) continue;
    const protectedKeys = new Set([
      collection.active,
      ...Object.values(world.quests.focus),
      ...(world.questCompletions?.recent || []).map((r) => r.questKey),
      world.questCompletions?.latest?.questKey,
      ...world.log
        .filter((entry) => entry.questKey)
        .map((entry) => entry.questKey),
    ]);
    const untouched = (q) =>
      q.mode === "personal" &&
      q.subjectActor === actor &&
      q.rewardActor === actor &&
      q.step === 0 &&
      q.lastProgressTurn === undefined &&
      !q.completion &&
      q.cause === null &&
      q.terminalRevision === undefined &&
      !protectedKeys.has(q.key) &&
      q.holder.kind === "avatar" &&
      q.holder.id === actor &&
      q.participants.length === 1 &&
      q.participants[0] === actor;
    const families = new Map();
    for (const q of recordsFor(world, actor)) {
      const family = questOfferFamily(q.program);
      if (!family || q.completedTurn !== null) continue;
      const group = families.get(family) || [];
      group.push(q);
      families.set(family, group);
    }
    for (const group of families.values()) {
      const protectedCards = group.filter((q) => !untouched(q));
      const keep = protectedCards.length
        ? protectedCards
        : [
            [...group].sort(
              (a, b) =>
                a.createdTurn - b.createdTurn || a.key.localeCompare(b.key),
            )[0],
          ];
      for (const q of group) {
        if (keep.includes(q)) continue;
        collection.lastOfferTurn = Math.max(
          collection.lastOfferTurn ?? 0,
          q.createdTurn,
        );
        collection.cards = collection.cards.filter((key) => key !== q.key);
        delete world.quests.records[q.key];
      }
    }
  }
  return world;
}
