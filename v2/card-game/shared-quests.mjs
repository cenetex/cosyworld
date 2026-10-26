// One saved record owns each quest. Holders, helpers and personal focus are separate.
export const SHARED_QUEST_VERSION = 1;
export const QUEST_RECORD_LIMIT = 4096;
export const SHARED_QUEST_PENDING_LIMIT = 8;
const historyLimit = 24;
const sameHolder = (a, b) => a?.kind === b?.kind && a?.id === b?.id;
const unfinished = (q) => q.completedTurn === null && !q.retired;
export const questRecords = (world) =>
  Object.values(world.quests?.records || {});
export const questRecord = (world, key) =>
  world.quests?.records && Object.hasOwn(world.quests.records, key)
    ? world.quests.records[key]
    : null;
export const collectionCards = (world, actor, archived = false) =>
  (
    world.life?.actors?.[actor]?.collection?.[archived ? "archive" : "cards"] ||
    []
  ).map((q) => (typeof q === "string" ? questRecord(world, q) : q));

export function installSharedQuestRegistry(world) {
  const first = !world.quests;
  world.quests ??= {
    version: SHARED_QUEST_VERSION,
    next: 0,
    records: {},
    focus: {},
  };
  for (const [actor, life] of Object.entries(world.life?.actors || {})) {
    const collection = life.collection;
    if (!collection) continue;
    const migrated = collection.cards.some((q) => typeof q !== "string");
    for (const field of ["cards", "archive"]) {
      collection[field] = collection[field].map((card) => {
        if (typeof card === "string") return card;
        registerPersonalQuest(world, actor, card);
        return card.key;
      });
    }
    if (
      (first || migrated) &&
      collection.active &&
      world.quests.focus[actor] === undefined
    )
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

export function validSharedQuestRegistry(
  world,
  { actors, items, places, program, origin },
) {
  const registry = world.quests;
  if (!registry) return true;
  if (
    registry.version !== SHARED_QUEST_VERSION ||
    !Number.isSafeInteger(registry.next) ||
    registry.next < 0 ||
    !registry.records ||
    Array.isArray(registry.records) ||
    typeof registry.records !== "object" ||
    !registry.focus ||
    Array.isArray(registry.focus) ||
    typeof registry.focus !== "object" ||
    Object.keys(registry.records).length > QUEST_RECORD_LIMIT
  )
    return false;
  const personalKeys = [];
  for (const [actor, life] of Object.entries(world.life?.actors || {})) {
    const c = life.collection;
    if (!c) continue;
    if (!Array.isArray(c.cards) || !Array.isArray(c.archive)) return false;
    for (const key of [...c.cards, ...c.archive]) {
      const q =
        typeof key === "string" &&
        Object.hasOwn(registry.records, key) &&
        registry.records[key];
      if (
        !q ||
        q.mode !== "personal" ||
        q.subjectActor !== actor ||
        q.rewardActor !== actor
      )
        return false;
      personalKeys.push(key);
    }
  }
  if (new Set(personalKeys).size !== personalKeys.length) return false;
  for (const [key, q] of Object.entries(registry.records)) {
    if (
      !q ||
      typeof q !== "object" ||
      key !== q.key ||
      key.length < 1 ||
      key.length > 160 ||
      ["__proto__", "constructor", "prototype"].includes(key) ||
      !["personal", "shared"].includes(q.mode) ||
      !q.holder ||
      !["avatar", "item", "place"].includes(q.holder.kind) ||
      !{ avatar: actors, item: items, place: places }[q.holder.kind].includes(
        q.holder.id,
      ) ||
      !(q.subjectActor === null || actors.includes(q.subjectActor)) ||
      !(q.rewardActor === null || actors.includes(q.rewardActor)) ||
      !Array.isArray(q.participants) ||
      q.participants.length > actors.length ||
      !q.participants.every(
        (id, i) =>
          actors.includes(id) && (i === 0 || q.participants[i - 1] < id),
      ) ||
      !Number.isSafeInteger(q.createdTurn) ||
      q.createdTurn < 0 ||
      q.createdTurn > world.turn ||
      !Number.isSafeInteger(q.step) ||
      q.step < 0 ||
      (q.lastProgressTurn !== undefined &&
        (!Number.isSafeInteger(q.lastProgressTurn) ||
          q.lastProgressTurn < q.createdTurn ||
          q.lastProgressTurn > world.turn)) ||
      (q.cause !== null &&
        (!q.cause ||
          !["quest", "journey", "help"].includes(q.cause.kind) ||
          typeof q.cause.rootId !== "string" ||
          q.cause.rootId.length < 1 ||
          q.cause.rootId.length > 200))
    )
      return false;
    if (q.mode === "personal") {
      if (!personalKeys.includes(key) || q.subjectActor === null || q.retired)
        return false;
    } else {
      if (
        q.rewardActor !== null ||
        !program(q.program, q.subjectActor) ||
        !origin(q.origin) ||
        (q.completedTurn === null
          ? q.step >= q.program.steps.length
          : !Number.isSafeInteger(q.completedTurn) ||
            q.completedTurn < q.createdTurn ||
            q.completedTurn > world.turn ||
            q.step !== q.program.steps.length)
      )
        return false;
      if (
        q.retired &&
        (q.completedTurn !== null ||
          q.retired.reason !== "superseded" ||
          !Number.isSafeInteger(q.retired.turn) ||
          q.retired.turn < q.createdTurn ||
          q.retired.turn > world.turn)
      )
        return false;
    }
  }
  return Object.entries(registry.focus).every(([actor, key]) => {
    const q = questRecord(world, key);
    return (
      actors.includes(actor) &&
      q &&
      unfinished(q) &&
      q.participants.includes(actor)
    );
  });
}
