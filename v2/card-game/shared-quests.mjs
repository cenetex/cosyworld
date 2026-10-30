import { canCarryQuest, carryQuest, questHolderActor } from "./quest-hands.mjs";
// One saved record owns each quest. Holders, helpers and personal focus are separate.
const SHARED_QUEST_VERSION = 1;
const QUEST_RECORD_LIMIT = 4096;
const SHARED_QUEST_PENDING_LIMIT = 8;
const SHARED_QUEST_COLLECTION_LIMIT = 256;
const TRANSIENT_QUEST_HISTORY_LIMIT = 32;
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
    ...(Object.values(world.life?.actors || {}).some(
      (life) => life.collection?.cards?.length,
    )
      ? {}
      : { hands: {} }),
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
  if (registry.hands) carryQuest(world, actor, card);
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
    transientActor = null,
  },
) {
  const registry = installSharedQuestRegistry(world);
  if (transientActor) pruneTransientQuestHistory(world, transientActor);
  const records = questRecords(world);
  if (
    records.length >= QUEST_RECORD_LIMIT ||
    (!transientActor &&
      records.filter((q) => q.mode === "shared" && !q.transientActor).length >=
        SHARED_QUEST_COLLECTION_LIMIT) ||
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
      ...(transientActor ? [transientActor] : []),
      ...(holder.kind === "avatar" && !transientActor ? [holder.id] : []),
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
    ...(transientActor ? { transientActor, familyActor: transientActor } : {}),
  };
  registry.records[questKey] = record;
  if (registry.hands)
    for (const actor of new Set([...members, questHolderActor(world, record)]))
      if (actor) carryQuest(world, actor, record);
  return record;
}

export function canJoinQuest(world, actor, key) {
  const quest = questRecord(world, key);
  if (
    !world.actors?.[actor] ||
    !quest ||
    !unfinished(quest) ||
    !canCarryQuest(world, actor, quest)
  )
    return false;
  return (
    !quest.transientActor ||
    actor === quest.transientActor ||
    questRecords(world).filter((q) => q.mode === "shared" && !q.transientActor)
      .length < SHARED_QUEST_COLLECTION_LIMIT
  );
}
export function joinQuest(world, actor, key) {
  if (!canJoinQuest(world, actor, key)) return false;
  const quest = questRecord(world, key);
  if (quest.transientActor && actor !== quest.transientActor)
    delete quest.transientActor;
  quest.participants = [...new Set([...quest.participants, actor])].sort();
  carryQuest(world, actor, quest);
  return true;
}

export function focusQuest(world, actor, key) {
  if (!joinQuest(world, actor, key)) return false;
  world.quests.focus[actor] = key;
  return true;
}
export const focusedQuest = (world, actor) =>
  questRecord(world, world.quests?.focus?.[actor]);
const questsHeldBy = (world, holder) =>
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
  if (holder.kind === "avatar" && !joinQuest(world, holder.id, key))
    return false;
  quest.holder = structuredClone(holder);
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
  pruneSharedQuestHistory(world, quest.holder, quest.key);
  return true;
}

export function pruneSharedQuestHistory(world, holder, preserveKey = null) {
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
    if (quest.compacted) continue;
    quest.totalSteps = quest.program.steps.length;
    quest.program = {
      id: quest.program.id,
      name: quest.program.name,
      purpose: quest.program.purpose || "",
      ...(quest.program.art ? { art: quest.program.art } : {}),
      steps: [],
    };
    quest.compacted = true;
  }
  for (const owner of new Set(
    questRecords(world)
      .map((q) => q.transientActor)
      .filter(Boolean),
  ))
    pruneTransientQuestHistory(world, owner, preserveKey);
}

// A transient owner's short travel history can retire without removing a helper's card.
export function pruneTransientQuestHistory(world, actor, preserveKey = null) {
  const records = questRecords(world).filter(
    (q) => q.transientActor === actor && !unfinished(q),
  );
  const protectedByOthers = (q) =>
    q.participants.some((id) => id !== actor) ||
    Object.entries(world.quests.focus).some(
      ([id, key]) => id !== actor && key === q.key,
    ) ||
    Object.entries(world.life?.actors || {}).some(
      ([id, life]) =>
        id !== actor &&
        ["cards", "archive"].some((field) =>
          life.collection?.[field]?.includes(q.key),
        ),
    );
  for (const q of records.filter(protectedByOthers)) delete q.transientActor;
  const disposable = records
    .filter((q) => q.transientActor === actor)
    .sort(
      (a, b) =>
        (a.completedTurn ?? a.retired.turn) -
          (b.completedTurn ?? b.retired.turn) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
  let excess = disposable.length - TRANSIENT_QUEST_HISTORY_LIMIT;
  for (const q of disposable) {
    if (excess <= 0) break;
    if (q.key === preserveKey) continue;
    if (world.quests.focus[actor] === q.key) delete world.quests.focus[actor];
    const collection = world.life?.actors?.[actor]?.collection;
    if (collection) {
      for (const field of ["cards", "archive"])
        collection[field] = collection[field].filter((key) => key !== q.key);
      if (collection.active === q.key) collection.active = null;
    }
    delete world.quests.records[q.key];
    excess--;
  }
}
export function validSharedQuestRegistry(
  world,
  { actors, items, places, program, origin, story },
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
      !["personal", "shared", "story"].includes(q.mode) ||
      !q.holder ||
      !["avatar", "item", "place"].includes(q.holder.kind) ||
      !{ avatar: actors, item: items, place: places }[q.holder.kind].includes(
        q.holder.id,
      ) ||
      (q.familyActor !== undefined && !actors.includes(q.familyActor)) ||
      (q.transientActor !== undefined &&
        (q.mode !== "shared" ||
          !actors.includes(q.transientActor) ||
          q.familyActor !== q.transientActor ||
          !["journey", "help"].includes(q.cause?.kind) ||
          !Array.isArray(q.participants) ||
          q.participants.length !== 1 ||
          q.participants[0] !== q.transientActor)) ||
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
    if (q.mode === "story") {
      if (!story?.(q)) return false;
    } else if (q.mode === "personal") {
      if (!personalKeys.includes(key) || q.subjectActor === null || q.retired)
        return false;
    } else {
      if (
        q.rewardActor !== null ||
        !(q.compacted
          ? q.program &&
            typeof q.program.id === "string" &&
            typeof q.program.name === "string" &&
            typeof q.program.purpose === "string" &&
            Array.isArray(q.program.steps) &&
            q.program.steps.length === 0 &&
            Number.isInteger(q.totalSteps) &&
            q.totalSteps > 0 &&
            q.totalSteps <= 12 &&
            (q.completedTurn !== null || q.retired)
          : program(q.program, q.subjectActor)) ||
        !origin(q.origin) ||
        (q.completedTurn === null
          ? q.step >= (q.totalSteps ?? q.program.steps.length)
          : !Number.isSafeInteger(q.completedTurn) ||
            q.completedTurn < q.createdTurn ||
            q.completedTurn > world.turn ||
            q.step !== (q.totalSteps ?? q.program.steps.length))
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
