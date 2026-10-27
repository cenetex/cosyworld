// Hand membership is saved separately from the complete quest history.
export const QUEST_HAND_LIMIT = 2;
export const QUEST_FADE_TURNS = 2;
const ongoing = (q) => q.completedTurn === null && !q.retired;
export const questFresh = (world, q) =>
  !q.retired &&
  (q.completedTurn === null || world.turn - q.completedTurn < QUEST_FADE_TURNS);
export function questHolderActor(world, q) {
  let id = q.holder.id;
  const seen = new Set();
  while (world.items?.[id] && !seen.has(id)) {
    seen.add(id);
    id = world.items[id].holder;
  }
  return world.actors[id] ? id : null;
}
const related = (world, q, actor) =>
  q.subjectActor === actor ||
  q.participants.includes(actor) ||
  questHolderActor(world, q) === actor;
const priority = (world, actor, q) =>
  world.quests.focus[actor] === q.key
    ? 0
    : world.life?.actors?.[actor]?.collection?.active === q.key
      ? 1
      : ongoing(q) && q.step > 0
        ? 2
        : ongoing(q) && q.participants.length > 1
          ? 3
          : ongoing(q)
            ? 4
            : 5;
const family = (q) =>
  q.mode === "personal" && q.program.generated && ongoing(q)
    ? q.program.generated.situation ||
      (q.program.generated.solo ? "solo" : "bargain")
    : null;
const protectedQuest = (world, actor, q) =>
  priority(world, actor, q) < 4 ||
  q.lastProgressTurn !== undefined ||
  q.cause !== null ||
  q.completion ||
  q.holder.kind !== "avatar" ||
  q.holder.id !== q.subjectActor;
const candidates = (world, actor) => {
  const all = Object.values(world.quests?.records || {})
    .filter(
      (q) =>
        related(world, q, actor) &&
        q.droppedBy?.[actor] === undefined &&
        questFresh(world, q),
    )
    .sort(
      (a, b) =>
        priority(world, actor, a) - priority(world, actor, b) ||
        a.createdTurn - b.createdTurn ||
        a.key.localeCompare(b.key),
    );
  const seen = new Set(
    all
      .filter((q) => protectedQuest(world, actor, q))
      .map(family)
      .filter(Boolean),
  );
  return all.filter((q) => {
    const kind = family(q);
    if (!kind || protectedQuest(world, actor, q)) return true;
    if (seen.has(kind)) return false;
    seen.add(kind);
    return true;
  });
};
export function questHandKeys(world, actor) {
  const keys = world.quests?.hands?.[actor];
  return keys === undefined && !world.quests?.hands
    ? candidates(world, actor)
        .slice(0, QUEST_HAND_LIMIT)
        .map((q) => q.key)
    : (keys || []).filter((key) => {
        const q = world.quests.records[key];
        return (
          q &&
          related(world, q, actor) &&
          q.droppedBy?.[actor] === undefined &&
          questFresh(world, q)
        );
      });
}
export const questCarried = (world, actor, key) =>
  questHandKeys(world, actor).includes(key);
export const questDropQuiet = (world, actor) =>
  Object.values(world.quests?.records || {}).some(
    (q) =>
      q.droppedBy?.[actor] !== undefined && world.turn - q.droppedBy[actor] < 8,
  );
export function canCarryQuest(world, actor, quest = null) {
  if (
    !Object.hasOwn(world.actors, actor) ||
    quest?.droppedBy?.[actor] !== undefined
  )
    return false;
  const hand = questHandKeys(world, actor);
  return (
    (quest && hand.includes(quest.key)) ||
    hand.filter((key) => ongoing(world.quests.records[key])).length <
      QUEST_HAND_LIMIT
  );
}
export function settleQuestHands(world) {
  if (!world.quests) return world;
  if (!world.quests.hands)
    world.quests.hands = Object.fromEntries(
      Object.keys(world.actors).map((actor) => [
        actor,
        questHandKeys(world, actor),
      ]),
    );
  for (const actor of Object.keys(world.actors)) {
    world.quests.hands[actor] = questHandKeys(world, actor).slice(
      0,
      QUEST_HAND_LIMIT,
    );
    if (!questCarried(world, actor, world.quests.focus[actor]))
      delete world.quests.focus[actor];
    const c = world.life?.actors?.[actor]?.collection;
    if (c?.active && !questCarried(world, actor, c.active)) {
      c.active = null;
      world.actors[actor].progress.step = 0;
      delete world.actors[actor].progress.current;
      world.life.actors[actor].phase = "seeking";
      delete world.life.actors[actor].origin;
    }
  }
  return world;
}
export function carryQuest(world, actor, q) {
  if (!canCarryQuest(world, actor, q)) return false;
  settleQuestHands(world);
  const hand = world.quests.hands[actor];
  if (!hand.includes(q.key)) {
    if (hand.length >= QUEST_HAND_LIMIT)
      hand.splice(
        hand.findIndex((key) => !ongoing(world.quests.records[key])),
        1,
      );
    hand.push(q.key);
  }
  return true;
}
export function dropQuest(world, actor, key) {
  if (!questCarried(world, actor, key)) return false;
  const q = world.quests.records[key];
  (q.droppedBy ??= {})[actor] = world.turn;
  settleQuestHands(world);
  const c = world.life?.actors?.[actor]?.collection;
  if (c && q.program.generated) c.lastOfferTurn = world.turn;
  return true;
}
export function validQuestHands(world) {
  const registry = world.quests;
  if (!registry) return true;
  for (const q of Object.values(registry.records)) {
    if (
      q.droppedBy !== undefined &&
      (!q.droppedBy ||
        typeof q.droppedBy !== "object" ||
        Array.isArray(q.droppedBy) ||
        Object.entries(q.droppedBy).some(
          ([actor, turn]) =>
            !Object.hasOwn(world.actors, actor) ||
            !Number.isSafeInteger(turn) ||
            turn < q.createdTurn ||
            turn > world.turn,
        ))
    )
      return false;
  }
  if (registry.hands === undefined) return true;
  if (
    !registry.hands ||
    typeof registry.hands !== "object" ||
    Array.isArray(registry.hands)
  )
    return false;
  return Object.entries(registry.hands).every(
    ([actor, keys]) =>
      Object.hasOwn(world.actors, actor) &&
      Array.isArray(keys) &&
      keys.length <= QUEST_HAND_LIMIT &&
      new Set(keys).size === keys.length &&
      keys.every((key) => {
        const q = registry.records[key];
        return (
          q && related(world, q, actor) && q.droppedBy?.[actor] === undefined
        );
      }),
  );
}
