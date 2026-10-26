// One saved record owns each quest. Holders, helpers and personal focus are separate.
export const SHARED_QUEST_VERSION = 1;
export const QUEST_RECORD_LIMIT = 4096;
export const SHARED_QUEST_PENDING_LIMIT = 8;
const historyLimit = 24;
const sameHolder = (a, b) => a?.kind === b?.kind && a?.id === b?.id;
const unfinished = (q) => q.completedTurn === null && !q.retired;
export const questRecords = (world) =>
  Object.values(world.quests?.records || {});
export const questRecord = (world, key) => world.quests?.records?.[key] || null;
export const collectionCards = (world, actor, archived = false) =>
  (
    world.life?.actors?.[actor]?.collection?.[archived ? "archive" : "cards"] ||
    []
  ).map((q) => (typeof q === "string" ? questRecord(world, q) : q));

export function installSharedQuestRegistry(world) {
  world.quests ??= {
    version: SHARED_QUEST_VERSION,
    next: 0,
    records: {},
    focus: {},
  };
  for (const [actor, life] of Object.entries(world.life?.actors || {})) {
    const collection = life.collection;
    if (!collection) continue;
    for (const field of ["cards", "archive"]) {
      collection[field] = collection[field].map((card) => {
        if (typeof card === "string") return card;
        registerPersonalQuest(world, actor, card);
        return card.key;
      });
    }
    if (collection.active && world.quests.focus[actor] === undefined)
      world.quests.focus[actor] = collection.active;
  }
  return world.quests;
}

export function registerPersonalQuest(world, actor, card) {
  const registry = world.quests || installSharedQuestRegistry(world);
  if (registry.records[card.key]) return registry.records[card.key];
  Object.assign(card, {
    holder: card.holder || { kind: "avatar", id: actor },
    subjectActor: actor,
    rewardActor: actor,
    mode: "personal",
    participants: card.participants || [actor],
    cause: card.cause || null,
  });
  registry.records[card.key] = card;
  return card;
}

export function addQuestRecord(
  world,
  {
    holder,
    program,
    subjectActor = null,
    participants = [],
    cause = null,
    origin = null,
    key = null,
  },
) {
  const registry = installSharedQuestRegistry(world);
  const records = questRecords(world);
  if (
    records.length >= QUEST_RECORD_LIMIT ||
    records.filter(
      (q) =>
        q.mode === "shared" && unfinished(q) && sameHolder(q.holder, holder),
    ).length >= SHARED_QUEST_PENDING_LIMIT
  )
    return null;
  const questKey = key || `world:quest:${registry.next++}`;
  if (registry.records[questKey]) return registry.records[questKey];
  const members = [
    ...new Set([
      ...participants,
      ...(holder.kind === "avatar" ? [holder.id] : []),
    ]),
  ].sort();
  const record = {
    key: questKey,
    mode: "shared",
    holder: structuredClone(holder),
    subjectActor,
    rewardActor: null,
    participants: members,
    program: structuredClone(program),
    step: 0,
    origin: origin ? structuredClone(origin) : null,
    createdTurn: world.turn,
    completedTurn: null,
    cause: cause ? structuredClone(cause) : null,
  };
  registry.records[questKey] = record;
  return record;
}

export function joinQuest(world, actor, key) {
  const quest = questRecord(world, key);
  if (!world.actors?.[actor] || !quest || !unfinished(quest)) return false;
  quest.participants = [...new Set([...quest.participants, actor])].sort();
  return true;
}

export function focusQuest(world, actor, key) {
  if (!joinQuest(world, actor, key)) return false;
  world.quests.focus[actor] = key;
  return true;
}
export const focusedQuest = (world, actor) =>
  questRecord(world, world.quests?.focus?.[actor]);
export const questsHeldBy = (world, holder) =>
  questRecords(world).filter((q) => sameHolder(q.holder, holder));
export const questStatus = (world, quest) =>
  quest.retired
    ? "superseded"
    : quest.completedTurn !== null
      ? "fulfilled"
      : Object.values(world.quests?.focus || {}).includes(quest.key)
        ? "active"
        : "pending";

export function shareQuest(world, key, holder) {
  const quest = questRecord(world, key);
  if (!quest || !unfinished(quest)) return false;
  quest.holder = structuredClone(holder);
  if (holder.kind === "avatar") joinQuest(world, holder.id, key);
  return true;
}

export function clearQuestFocus(world, key) {
  for (const [actor, focused] of Object.entries(world.quests?.focus || {}))
    if (focused === key) delete world.quests.focus[actor];
}

export function retireQuest(
  world,
  key,
  { reason = "superseded", cause = null } = {},
) {
  const quest = questRecord(world, key);
  if (!quest || quest.mode !== "shared" || !unfinished(quest)) return false;
  quest.retired = {
    turn: world.turn,
    reason,
    cause: structuredClone(cause || quest.cause),
  };
  clearQuestFocus(world, key);
  pruneSharedQuestHistory(world, quest.holder);
  return true;
}

export function pruneSharedQuestHistory(world, holder) {
  const finished = questsHeldBy(world, holder)
    .filter((q) => q.mode === "shared" && !unfinished(q))
    .sort(
      (a, b) =>
        (a.completedTurn ?? a.retired.turn) -
          (b.completedTurn ?? b.retired.turn) || a.key.localeCompare(b.key),
    );
  for (const quest of finished.slice(
    0,
    Math.max(0, finished.length - historyLimit),
  )) {
    clearQuestFocus(world, quest.key);
    delete world.quests.records[quest.key];
  }
}
