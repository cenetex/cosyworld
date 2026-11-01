import { validLearning } from "./learning.mjs";
import baseProfiles from "./entity-profiles.json" with { type: "json" };
import { packProfiles } from "./pack-registry.mjs";

// The shore's own entities plus every mounted world pack's.
export const profiles = { ...baseProfiles, ...packProfiles };
export const MEMORY_LIMIT = 16;
export const newMemories = () =>
  Object.fromEntries(
    Object.keys(profiles).map((id) => [
      id,
      {
        events: [],
        landmarks: [],
        text: null,
        turn: null,
        ...(profiles[id].kind === "avatar" ? { seen: {} } : {}),
      },
    ]),
  );

// A sighting comes from sharing a recorded scene. Its evidence survives short event windows.
function rememberSightings(world, entry, observers = entry.cast || []) {
  for (const id of observers) {
    if (profiles[id]?.kind !== "avatar" || !entry.cast?.includes(id)) continue;
    const memory = world.memories[id];
    memory.seen ??= {};
    for (const other of entry.cast) {
      if (
        other === id ||
        profiles[other]?.kind !== "avatar" ||
        (memory.seen[other]?.seq ?? 0) >= entry.seq
      )
        continue;
      memory.seen[other] = {
        place: entry.locationId,
        turn: entry.turn,
        seq: entry.seq,
      };
    }
  }
}
export function upgradeSightings(world) {
  if (!world.memories || !Array.isArray(world.log)) return;
  const missing = Object.keys(world.memories).filter(
    (id) =>
      profiles[id]?.kind === "avatar" && world.memories[id].seen === undefined,
  );
  if (!missing.length) return;
  for (const entry of world.log) rememberSightings(world, entry, missing);
  for (const id of missing) world.memories[id].seen ??= {};
}

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
    if (
      profiles[id].kind === "avatar" &&
      world.controlledActors?.includes(id) &&
      !world.presentActors?.includes(id) &&
      entry.actorId !== id
    )
      continue;
    const memory = world.memories[id];
    rememberSightings(world, entry, [id]);

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

// Fixed at load; validation runs on every play, so these are built once.
const profileKeys = Object.keys(profiles).sort().join();
const SEEN_KEYS = ["place", "turn", "seq"];
const EVENT_KINDS = ["event", "expression"];
export function validMemories(world) {
  if (
    !world.memories ||
    Object.keys(world.memories).sort().join() !== profileKeys
  )
    return false;
  return Object.entries(world.memories).every(([id, memory]) => {
    if (
      (memory?.seen !== undefined &&
        (!memory.seen ||
          typeof memory.seen !== "object" ||
          Array.isArray(memory.seen) ||
          profiles[id].kind !== "avatar" ||
          Object.entries(memory.seen).some(
            ([other, seen]) =>
              other === id ||
              profiles[other]?.kind !== "avatar" ||
              !seen ||
              Object.keys(seen).some(
                (key) => !SEEN_KEYS.includes(key),
              ) ||
              !profiles[seen.place] ||
              profiles[seen.place].kind === "avatar" ||
              world.items[seen.place] ||
              !Number.isSafeInteger(seen.turn) ||
              seen.turn < 0 ||
              seen.turn > world.turn ||
              !Number.isSafeInteger(seen.seq) ||
              seen.seq < 1 ||
              seen.seq > world.eventSeq,
          ))) ||
      !validInnerLife(memory?.innerLife, world.turn) ||
      !validLearning(world, id, memory?.learning, profiles) ||
      !validReflections(world, id, memory?.reflections) ||
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
        EVENT_KINDS.includes(event.kind) &&
        typeof event.text === "string" &&
        event.text.length <= 650,
    );
  });
}

// Keep the evidence and earlier persona beside each accepted revision.
function validReflections(world, id, history) {
  if (history === undefined) return true;
  const text = (s, max) =>
    typeof s === "string" &&
    s.trim() &&
    s.length <= max &&
    !/[\u0000-\u001f\u007f]/u.test(s);
  return (
    profiles[id].kind === "avatar" &&
    Array.isArray(history) &&
    history.length <= 4 &&
    (!history.length ||
      (world.memories[id].innerLife?.persona === history.at(-1).persona &&
        world.memories[id].innerLife?.thoughts.at(-1)?.text ===
          history.at(-1).thought)) &&
    history.every(
      (r, i) =>
        r &&
        Number.isSafeInteger(r.turn) &&
        r.turn > 0 &&
        r.turn <= world.turn &&
        (!i || history[i - 1].turn < r.turn) &&
        (r.previousPersona === null || text(r.previousPersona, 600)) &&
        text(r.persona, 600) &&
        text(r.thought, 400) &&
        (r.dream === null || text(r.dream, 400)) &&
        Array.isArray(r.sources) &&
        r.sources.length > 0 &&
        r.sources.length <= 6 &&
        r.sources.every(
          (e, j) =>
            Number.isSafeInteger(e.seq) &&
            e.seq > 0 &&
            e.seq <= world.eventSeq &&
            (!j || r.sources[j - 1].seq < e.seq) &&
            Number.isSafeInteger(e.turn) &&
            e.turn >= 0 &&
            e.turn <= r.turn &&
            text(e.text, 650) &&
            [
              ...world.memories[id].events,
              ...(world.memories[id].landmarks || []),
            ]
              .filter((saved) => saved.seq === e.seq)
              .every(
                (saved) =>
                  saved.kind === "event" &&
                  saved.turn === e.turn &&
                  saved.text === e.text,
              ),
        ) &&
        r.models &&
        ["thought", "persona"].every((k) => text(r.models[k], 160)) &&
        Object.entries(r.models).every(
          ([k, v]) =>
            ["thought", "persona", "dream"].includes(k) && text(v, 160),
        ),
    )
  );
}
