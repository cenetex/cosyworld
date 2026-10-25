import shoreProfiles from "./entity-profiles.json" with { type: "json" };
import { packProfiles } from "./pack-registry.mjs";

export const profiles = { ...shoreProfiles, ...packProfiles };
export const MEMORY_LIMIT = 16;
export const newMemories = () =>
  Object.fromEntries(
    Object.keys(profiles).map((id) => [
      id,
      { events: [], landmarks: [], text: null, turn: null },
    ]),
  );

// A place and its contents retain events there. Avatars retain witnessed events.
export function rememberEvent(world, entry) {
  if (entry.kind === "quest" || entry.questPlan) return;
  const related = new Set([
    entry.locationId,
    entry.fromLocationId,
    entry.actorId,
    entry.entityId,
    entry.itemId,
    entry.receiveId,
    entry.targetId,
    ...(entry.witnesses || []),
    ...(entry.cast || []),
    ...(entry.items || []).map((item) => item.id),
  ]);
  for (const id of related) {
    if (!profiles[id]) continue;
    const memory = world.memories[id];
    if (memory.events.some((event) => event.seq === entry.seq)) continue;
    memory.events.push({
      seq: entry.seq,
      turn: entry.turn,
      kind: entry.generated ? "expression" : "event",
      text: `${entry.speaker}: ${entry.text}`.slice(0, 650),
    });
    memory.events = memory.events.slice(-MEMORY_LIMIT);
    if (
      entry.consequence ||
      (entry.kind === "action" &&
        ["give", "trade", "threaten", "attack", "accompany", "choose"].includes(
          entry.verb,
        ))
    ) {
      memory.landmarks ??= [];
      memory.landmarks.push({ ...memory.events.at(-1) });
      memory.landmarks = memory.landmarks.slice(-6);
    }
  }
}

export function migrateMemories(world) {
  world.memories = newMemories();
  for (const [index, entry] of world.log.entries()) {
    rememberEvent(world, { ...entry, seq: entry.seq ?? index + 1 });
  }
}

export function validInnerLife(life, turn) {
  if (life === undefined || life === null) return true;
  const text = (value, limit) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= limit &&
    !/[\u0000-\u001f\u007f]/u.test(value);
  return (
    typeof life === "object" &&
    !Array.isArray(life) &&
    Object.keys(life).every((key) =>
      ["persona", "thoughts", "dreams"].includes(key),
    ) &&
    (life.persona === null || text(life.persona, 600)) &&
    [life.thoughts, life.dreams].every(
      (moments) =>
        Array.isArray(moments) &&
        moments.length <= 4 &&
        moments.every(
          (m, index) =>
            m &&
            Number.isSafeInteger(m.turn) &&
            m.turn >= 0 &&
            m.turn <= turn &&
            text(m.text, 400) &&
            (index === 0 || moments[index - 1].turn < m.turn),
        ),
    )
  );
}

export function validMemories(world) {
  if (
    !world.memories ||
    Object.keys(world.memories).sort().join() !==
      Object.keys(profiles).sort().join()
  )
    return false;
  return Object.entries(world.memories).every(([id, memory]) => {
    if (
      !validInnerLife(memory?.innerLife, world.turn) ||
      (profiles[id].kind !== "avatar" && memory?.innerLife != null)
    )
      return false;
    if (
      !memory ||
      !Array.isArray(memory.events) ||
      memory.events.length > MEMORY_LIMIT
    )
      return false;
    if (
      !Array.isArray(memory.landmarks) ||
      memory.landmarks.length > 6 ||
      memory.landmarks.some(
        (event, index) =>
          !event ||
          !Number.isSafeInteger(event.seq) ||
          event.seq < 1 ||
          event.seq > world.eventSeq ||
          (index && event.seq <= memory.landmarks[index - 1].seq) ||
          !Number.isSafeInteger(event.turn) ||
          event.turn < 0 ||
          event.turn > world.turn ||
          event.kind !== "event" ||
          typeof event.text !== "string" ||
          event.text.length > 650,
      )
    )
      return false;
    if (
      memory.text !== null &&
      (typeof memory.text !== "string" ||
        !memory.text.trim() ||
        memory.text.length > 400)
    )
      return false;
    if (
      memory.turn !== null &&
      (!Number.isSafeInteger(memory.turn) ||
        memory.turn < 0 ||
        memory.turn > world.turn)
    )
      return false;
    if (
      memory.model !== undefined &&
      (typeof memory.model !== "string" || memory.model.length > 160)
    )
      return false;
    return memory.events.every(
      (event, index) =>
        event &&
        Number.isSafeInteger(event.seq) &&
        event.seq > 0 &&
        event.seq <= world.eventSeq &&
        (!index || event.seq > memory.events[index - 1].seq) &&
        Number.isSafeInteger(event.turn) &&
        event.turn >= 0 &&
        event.turn <= world.turn &&
        ["event", "expression"].includes(event.kind) &&
        typeof event.text === "string" &&
        event.text.length <= 650,
    );
  });
}
