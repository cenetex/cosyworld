import {
  people,
  places,
  nameOf,
  carried,
  itemPlace,
  shining,
} from "./world.mjs";

export const backdrop = (id) => `./assets/${id}.png`;
export const portrait = (id) => `./assets/${id}.png`;
import { desireFor, programFor, levelOf } from "./quests.mjs";
const personIds = Object.keys(people);
const speakerId = (entry) =>
  entry.actorId || personIds.find((id) => nameOf(id) === entry.speaker) || null;
const entryKind = (entry) =>
  entry.kind ||
  (speakerId(entry)
    ? "dialogue"
    : entry.speaker === "You"
      ? "input"
      : "narration");

// Stable left/right slots: A, B, A, C keeps A left and replaces B with C.
// Only actual dialogue updates recency. Narration and input keep the cast still.
export function sceneCast(
  world,
  through = world.log.length - 1,
  recordedCast = null,
) {
  const here = world.actors.vale.place;
  const present =
    recordedCast || personIds.filter((id) => world.actors[id].place === here);
  const slots = [null, null],
    recent = [];
  let start = 0;
  for (let i = 0; i <= through; i++) {
    const e = world.log[i];
    if (e?.kind === "action" && e.actorId === "vale" && e.verb === "move")
      start = i;
  }
  const touch = (id) => {
    const old = recent.indexOf(id);
    if (old >= 0) recent.splice(old, 1);
    recent.push(id);
    if (slots.includes(id)) return;
    const free = slots.indexOf(null);
    if (free >= 0) slots[free] = id;
    else {
      const replace = recent.find((person) => slots.includes(person));
      slots[slots.indexOf(replace)] = id;
    }
  };
  // Establish the scene when no conversation has happened yet.
  if (present.includes("vale")) touch("vale");
  for (const entry of world.log.slice(start, through + 1)) {
    const id = speakerId(entry);
    if (
      entryKind(entry) === "dialogue" &&
      present.includes(id) &&
      (!entry.locationId || entry.locationId === here)
    )
      touch(id);
  }
  for (const id of present)
    if (slots.includes(null) && !slots.includes(id)) touch(id);
  return slots;
}
export function sceneLines(world) {
  const here = world.actors.vale.place;
  return world.log
    .map((entry, index) => ({ ...entry, index }))
    .filter(
      (e) =>
        !["input", "hint"].includes(entryKind(e)) &&
        (!e.locationId || e.locationId === here),
    );
}
export function currentScene(world, lineIndex = null) {
  const lines = sceneLines(world);
  const line = lines.find((e) => e.index === lineIndex) ||
    lines.findLast((e) => e.generated && e.turn === world.turn) ||
    lines.findLast(
      (e) =>
        e.kind === "quest" && e.actorId === "vale" && e.turn === world.turn,
    ) ||
    lines.at(-1) || {
      text: places[world.actors.vale.place].text,
      speaker: "World",
      index: world.log.length - 1,
    };
  return {
    locationId: world.actors.vale.place,
    background: backdrop(world.actors.vale.place),
    slots: sceneCast(world, line.index, lineIndex === null ? null : line.cast),
    activeSpeaker: entryKind(line) === "dialogue" ? speakerId(line) : null,
    line,
    lines,
  };
}
export function sceneScript(world) {
  const firstSeq = world.log[0]?.seq || 1;
  return {
    schema: "cosyworld.scene-script.v1",
    title: "The reflected shore",
    source: {
      worldSchema: world.schema,
      turn: world.turn,
      revision: world.revision,
      firstEvent: firstSeq,
      lastEvent: world.eventSeq || world.log.length,
      truncated:
        firstSeq > 1 ||
        (world.eventSeq || world.log.length) - firstSeq + 1 > world.log.length,
    },
    locations: Object.entries(places).map(([id, p]) => ({
      id,
      name: p.name,
      background: backdrop(id),
    })),
    avatars: Object.entries(people).map(([id, p]) => ({
      id,
      name: p.name,
      cutout: portrait(id),
    })),
    memories: structuredClone(world.memories),
    beats: world.log.map((e, index) => ({
      id: e.seq || index + 1,
      turn: e.turn,
      kind: entryKind(e),
      actorId: speakerId(e),
      locationId: e.locationId || null,
      text: e.text,
      verb: e.verb || null,
      itemId: e.itemId || null,
      targetId: e.targetId || null,
      receiveId: e.receiveId || null,
      questPlan: e.questPlan ? structuredClone(e.questPlan) : null,
      quest:
        e.kind === "quest"
          ? {
              programId: e.programId,
              program: e.program ? structuredClone(e.program) : null,
              target: e.target ? structuredClone(e.target) : null,
              step: e.step,
              level: e.level,
              hand: e.fulfillment ? structuredClone(e.fulfillment) : null,
            }
          : null,
      cast: e.cast || [],
      items: e.items || [],
      light: e.light ?? null,
      performance: {
        pose: e.verb === "move" ? "walk" : e.verb ? "act" : "speak",
        suggestedDurationMs: Math.min(7000, Math.max(1600, e.text.length * 45)),
      },
    })),
    current: {
      locationId: world.actors.vale.place,
      avatars: personIds.map((id) => ({
        id,
        locationId: world.actors[id].place,
        items: carried(world, id),
        level: levelOf(world, id),
        desire: desireFor(world, id),
        programId: programFor(world, id)?.id || null,
        progress: structuredClone(world.actors[id].progress),
      })),
      items: Object.entries(world.items).map(([id, item]) => ({
        id,
        ...item,
        locationId: itemPlace(world, id),
      })),
      light:
        shining(world) && itemPlace(world, "lamp") === world.actors.vale.place,
    },
  };
}
