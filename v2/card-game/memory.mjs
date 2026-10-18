import profiles from "./entity-profiles.json" with { type: "json" };

export { profiles };
export const MEMORY_LIMIT = 16;
export const newMemories = () =>
  Object.fromEntries(
    Object.keys(profiles).map((id) => [
      id,
      { events: [], text: null, turn: null },
    ]),
  );

// A place and its contents retain events there. Avatars retain witnessed events.
export function rememberEvent(world, entry) {
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
  }
}

export function migrateMemories(world) {
  world.memories = newMemories();
  for (const [index, entry] of world.log.entries()) {
    rememberEvent(world, { ...entry, seq: entry.seq ?? index + 1 });
  }
}

export function validMemories(world) {
  if (
    !world.memories ||
    Object.keys(world.memories).sort().join() !==
      Object.keys(profiles).sort().join()
  )
    return false;
  return Object.values(world.memories).every((memory) => {
    if (
      !memory ||
      !Array.isArray(memory.events) ||
      memory.events.length > MEMORY_LIMIT
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
