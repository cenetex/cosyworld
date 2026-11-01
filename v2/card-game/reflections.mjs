// Reflections are rules: the shared speech reducer commits a character's
// thought, persona and dream only when they are due and grounded in the saved
// scene. Dialogue wording lives in narrative.mjs, outside the shared engine.
// See docs/design/pack-content-outside-the-engine.md.
import { profiles, validInnerLife } from "./memory.mjs";
import { dialogueCast, speechMemories } from "./scene-cast.mjs";

// The part of a dialogue context that reflections read.
export function reflectionContext(world, action = null) {
  const cast = dialogueCast(world, action);
  return {
    turn: world.turn,
    resting: cast.resting,
    ...(cast.rest ? { rest: cast.rest } : {}),
    entities: cast.ids.map((id) => ({
      id,
      memories: speechMemories(world.memories[id], {
        expressions: !cast.beforeFirstLight,
      }),
    })),
  };
}

// Thoughts come only to the avatar who waited, after something new happened
// to them. Dreams are rarer: two thoughts must settle since the last one.
// The server's reflection_due applies the same gate.
export const THOUGHT_GAP = 6;
export const DREAM_GAP = 24;
export const THOUGHTS_PER_DREAM = 2;
export function reflectionDue(context, id, life) {
  // Waking from a long rest always brings a thought and a dream.
  if (context.rest === "long" && context.resting === id && context.turn > 0)
    return { thought: true, dream: true };
  const thoughts = life?.thoughts || [];
  const dreams = life?.dreams || [];
  const last = thoughts.at(-1)?.turn;
  const changed = context.entities
    .find((e) => e.id === id)
    ?.memories.some(
      (m) => m.kind === "event" && (last === undefined || m.turn > last),
    );
  const thought = Boolean(
    context.resting === id &&
      context.turn > 0 &&
      changed &&
      (last === undefined || context.turn >= last + THOUGHT_GAP),
  );
  const dreamt = dreams.at(-1)?.turn;
  const settled = thoughts.filter(
    (m) => dreamt === undefined || m.turn > dreamt,
  ).length;
  return {
    thought,
    dream:
      thought &&
      settled >= THOUGHTS_PER_DREAM &&
      (dreamt === undefined || context.turn >= dreamt + DREAM_GAP),
  };
}

export function validReflection(entry, world, context) {
  if (entry.reflection === undefined || entry.reflection === null) return true;
  if (profiles[entry.id]?.kind !== "avatar") return false;
  const previous = world.memories[entry.id].innerLife || {
    persona: null,
    thoughts: [],
    dreams: [],
  };
  const due = reflectionDue(context, entry.id, previous);
  if (!due.thought) return false;
  const r = entry.reflection;
  if (
    !r ||
    Object.keys(r).some(
      (key) =>
        !["thought", "persona", "dream", "models", "evidence"].includes(key),
    )
  )
    return false;
  if (r.dream !== undefined && !due.dream) return false;
  const sources = reflectionSources(world, context, entry.id);
  if (
    r.evidence !== undefined &&
    (!Array.isArray(r.evidence) ||
      r.evidence.join() !== sources.map((e) => e.seq).join())
  )
    return false;
  if (
    r.models !== undefined &&
    (!r.models ||
      typeof r.models !== "object" ||
      Array.isArray(r.models) ||
      !["thought", "persona"].every(
        (k) =>
          typeof r.models[k] === "string" &&
          r.models[k].trim() &&
          r.models[k].length <= 160,
      ) ||
      Object.entries(r.models).some(
        ([k, v]) =>
          !["thought", "persona", "dream"].includes(k) ||
          typeof v !== "string" ||
          !v.trim() ||
          v.length > 160,
      ))
  )
    return false;
  return validInnerLife(
    {
      persona: r.persona,
      thoughts: [{ turn: world.turn, text: r.thought }],
      dreams:
        r.dream === undefined ? [] : [{ turn: world.turn, text: r.dream }],
    },
    world.turn,
  );
}

function reflectionSources(world, context, id) {
  const selected = context.entities.find((e) => e.id === id)?.memories || [];
  return selected
    .filter((e) => e.kind === "event")
    .map((e) => {
      const saved = [
        ...world.memories[id].events,
        ...(world.memories[id].landmarks || []),
      ].find((m) =>
        e.seq ? m.seq === e.seq : m.turn === e.turn && m.text === e.text,
      );
      return saved && { seq: saved.seq, turn: saved.turn, text: saved.text };
    })
    .filter(Boolean)
    .sort((a, b) => a.seq - b.seq);
}

export function saveReflection(world, context, entry, fallbackModel) {
  const memory = world.memories[entry.id];
  const previous = memory.innerLife || {
    persona: null,
    thoughts: [],
    dreams: [],
  };
  const r = entry.reflection;
  memory.reflections = [
    ...(memory.reflections || []),
    {
      turn: world.turn,
      previousPersona: previous.persona,
      persona: r.persona,
      thought: r.thought,
      dream: r.dream || null,
      sources: reflectionSources(world, context, entry.id),
      models: r.models || {
        thought: fallbackModel,
        persona: fallbackModel,
        ...(r.dream ? { dream: fallbackModel } : {}),
      },
    },
  ].slice(-4);
  memory.innerLife = {
    persona: r.persona,
    thoughts: [
      ...previous.thoughts,
      { turn: world.turn, text: r.thought },
    ].slice(-4),
    dreams: r.dream
      ? [...previous.dreams, { turn: world.turn, text: r.dream }].slice(-4)
      : previous.dreams,
  };
}

// Shared publication checks against the saved world before committing its text.
export function applySharedReflections(world, entries) {
  const context = reflectionContext(world);
  for (const entry of entries || [])
    if (
      world.actors[entry.id] &&
      !context.entities.some((e) => e.id === entry.id)
    )
      context.entities.push({
        id: entry.id,
        memories: speechMemories(world.memories[entry.id]),
      });
  if (
    !Array.isArray(entries) ||
    entries.length > 2 ||
    new Set(entries.map((e) => e.id)).size !== entries.length
  )
    throw new Error("Use the saved scene's character reflections.");
  for (const entry of entries) {
    if (
      !context.entities.some((e) => e.id === entry.id) ||
      !validReflection(entry, world, context)
    )
      throw new Error("Use a reflection grounded in the saved scene.");
  }
  for (const entry of entries)
    if (entry.reflection)
      saveReflection(world, context, entry, entry.model || "card-voices-v1");
}
