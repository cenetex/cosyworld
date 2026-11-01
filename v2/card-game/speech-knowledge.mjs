// What the player's avatar can say follows the cards its player has uncovered
// (#1575). A covered item never reaches the speech request: its entity, its
// custody and its name in facts are removed, so the server's validator also
// rejects a line that names it. The rules still hold the full truth; this
// narrows only the browser's request. Later, rules-owned knowledge replaces it.
import { observableStates } from "./pack-registry.mjs";
import { covered, nameOf } from "./world.mjs";

// A covered thing reaches the speaker as something sensed but unnamed. The
// table's own word "covered" stays out of speech (#1665).
export const UNKNOWN_THING = "something I can't make out";
// A covered light still shines: the speaker knows it holds a light, unnamed.
export const UNKNOWN_LIGHT = "something shining I can't make out";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function forgetCovered(world, context, isCovered) {
  const speakers = new Set(context.speakers);
  const hidden = context.entities
    .map(({ id }) => id)
    .concat(context.outcome?.items.map(({ id }) => id) || [])
    .filter(
      (id) =>
        world.items[id] &&
        !speakers.has(id) &&
        id !== context.location &&
        isCovered(id),
    );
  if (!hidden.length) return context;
  const gone = new Set(hidden);
  const unknown = new Map(
    hidden.map((id) => [
      nameOf(id).toLowerCase(),
      world.items[id].lit && !covered(world, id) ? UNKNOWN_LIGHT : UNKNOWN_THING,
    ]),
  );
  const names = [...unknown.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escape);
  const pattern = new RegExp(
    `\\b(?:(?:the|an?) )?(${names.join("|")})\\b`,
    "gi",
  );
  const blur = (text) =>
    text?.replace(pattern, (_, name) => unknown.get(name.toLowerCase())) ??
    text;
  const outcome = context.outcome && {
    ...context.outcome,
    card: Object.fromEntries(
      Object.entries(context.outcome.card).map(([key, value]) => [
        key,
        gone.has(value) ? null : value,
      ]),
    ),
    avatars: context.outcome.avatars.map((avatar) => ({
      ...avatar,
      holding: avatar.holding.filter((id) => !gone.has(id)),
    })),
    items: context.outcome.items.filter(({ id }) => !gone.has(id)),
  };
  if (outcome)
    outcome.observations = observableStates(world, [
      ...outcome.avatars.map(({ id }) => id),
      ...outcome.items.map(({ id }) => id),
    ]);
  return {
    ...context,
    ...(outcome ? { outcome } : {}),
    focus: gone.has(context.focus) ? null : context.focus,
    action: blur(context.action),
    events: context.events.map(blur),
    entities: context.entities
      .filter(({ id }) => !gone.has(id))
      .map((entity) => ({
        ...entity,
        facts: entity.facts.map(blur),
        memories: entity.memories.map((m) => ({ ...m, text: blur(m.text) })),
        previous: blur(entity.previous),
        desire: entity.desire && {
          ...entity.desire,
          items: entity.desire.items.filter((id) => !gone.has(id)),
        },
      })),
  };
}

// A new game's first line is raw (#1600): the server frames the waking avatar
// with only its uncovered name, place and holdings, and no voice until its
// own card is uncovered. A covered place is not voiced either.
export function markWaking(world, context, isCovered) {
  if (!world.opening || context.turn !== 0 || context.action) return context;
  const covered = [...context.speakers, context.location].filter(isCovered);
  return {
    ...context,
    waking: true,
    scenery: context.scenery && !isCovered(context.location),
    ...(covered.length ? { covered } : {}),
  };
}
