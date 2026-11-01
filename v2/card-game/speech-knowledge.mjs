// What the player's avatar can say follows the cards its player has uncovered
// (#1575). A covered item never reaches the speech request: its entity, its
// custody and its name in facts are removed, so the server's validator also
// rejects a line that names it. The rules still hold the full truth; this
// narrows only the browser's request. Later, rules-owned knowledge replaces it.
import {
  entityActive,
  observableStates,
  packOf,
  packThings,
} from "./pack-registry.mjs";
import { covered, itemPlace, nameOf, rootHolder } from "./world.mjs";
import { questsOf } from "./want.mjs";
import baseProfiles from "./entity-profiles.json" with { type: "json" };

// A covered thing reaches the speaker as something sensed but unnamed. The
// table's own word "covered" stays out of speech (#1665).
export const UNKNOWN_THING = "something I can't make out";
// A covered light still shines: the speaker knows it holds a light, unnamed.
export const UNKNOWN_LIGHT = "something shining I can't make out";

// Someone or somewhere a speaker has not found yet stays unnamed (#1850).
export const UNKNOWN_PERSON = "someone I haven't met yet";
const unnamed = (world, id) =>
  world.actors[id]
    ? UNKNOWN_PERSON
    : world.items[id]
      ? UNKNOWN_THING
      : "a place I haven't found yet";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Replaces each name in `unknown` (lower-case name to phrase) in a text.
function blurrer(unknown) {
  if (!unknown.size) return (text) => text;
  const names = [...unknown.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escape);
  const pattern = new RegExp(
    `\\b(?:(?:the|an?) )?(${names.join("|")})\\b`,
    "gi",
  );
  return (text) =>
    text?.replace(pattern, (_, name) => unknown.get(name.toLowerCase())) ??
    text;
}

// What an avatar's facts may name beyond the scene: its quests' targets
// and the goal of its last measured try.
function questTargets(world, id) {
  const goal = world.memories[id]?.learning?.at(-1)?.goal;
  return [
    ...questsOf(world, id).map((q) => q.target),
    goal?.item,
    goal?.destination,
  ].filter((t) => t && t !== id && nameOf(t) !== t);
}

// Whether the rules record that `speaker` has found `id`: a place it has
// visited, a person it has talked with or met. Items have no such record.
function found(world, speaker, id) {
  const a = world.actors[speaker];
  if (world.actors[id])
    return (
      !a?.talked ||
      a.talked.includes(id) ||
      world.opening?.met?.[id] !== undefined ||
      world.packs?.[packOf(id)?.id]?.met?.[id] !== undefined
    );
  return world.items[id] || !a?.visited || a.visited.includes(id);
}

// Blurs, in an avatar's own words, the targets it has not found yet.
export function unfoundBlur(world, id, scene = [], isCovered = () => false) {
  const hidden = questTargets(world, id).filter(
    (t) => !scene.includes(t) && (isCovered(t) || !found(world, id, t)),
  );
  return {
    hidden,
    blur: blurrer(
      new Map(hidden.map((t) => [nameOf(t).toLowerCase(), unnamed(world, t)])),
    ),
  };
}

// An item's last word ("the River Map" is a map), for every item a table
// may hold. A thought that names an item kind the speaker has never been
// near invents it ("my compass is ready").
const GENERIC = new Set(["account", "card", "list", "record", "plea", "seed"]);
const itemNouns = new Map();
for (const [id, p] of Object.entries({ ...baseProfiles, ...packThings }))
  if (p.kind === "item" || packThings[id]) {
    const noun = String(p.name || "")
      .split(" ")
      .at(-1)
      .toLowerCase();
    if (noun.length > 2 && !GENERIC.has(noun))
      itemNouns.set(noun, [...(itemNouns.get(noun) || []), id]);
  }
export function inventsItem(world, speaker, text) {
  const a = world.actors[speaker];
  const near = (id) =>
    world.items[id] &&
    entityActive(world, id) &&
    (rootHolder(world, id) === speaker ||
      !a?.visited ||
      a.visited.includes(itemPlace(world, id)));
  const lower = String(text || "").toLowerCase();
  return [...itemNouns].some(
    ([noun, ids]) =>
      new RegExp(`\\b${noun}s?\\b`).test(lower) && !ids.some(near),
  );
}

// An inner-life line is spoken by the avatar itself, in balanced quotes,
// about things it has been near.
export const groundedInner = (world, speaker, text) =>
  /\b(i|i'm|i've|my|me|mine)\b/i.test(text) &&
  (text.match(/["\u201c\u201d]/g) || []).length % 2 === 0 &&
  !/[,!?]["\u201d] [a-z]/.test(text) &&
  !inventsItem(world, speaker, text);

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
      world.items[id].lit && !covered(world, id)
        ? UNKNOWN_LIGHT
        : UNKNOWN_THING,
    ]),
  );
  const blur = blurrer(unknown);
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

// Each avatar's facts name only the quest targets it has found, and, in the
// browser, whose cards its player has uncovered (#1850). The rest read as
// "someone I haven't met yet", and the server's name check rejects a line
// that names them.
export function forgetUnfound(world, context, isCovered = () => false) {
  // The present beat may name what its play names.
  const scene = [
    context.location,
    ...context.entities.map(({ id }) => id),
    ...Object.values(context.outcome?.card || {}),
  ];
  let changed = false;
  const entities = context.entities.map((entity) => {
    if (!world.actors[entity.id] || !entity.desire) return entity;
    const { hidden, blur } = unfoundBlur(world, entity.id, scene, isCovered);
    if (!hidden.length) return entity;
    changed = true;
    const kept = (id) => !hidden.includes(id);
    return {
      ...entity,
      facts: entity.facts.map(blur),
      desire: {
        items: entity.desire.items.filter(kept),
        location: kept(entity.desire.location) ? entity.desire.location : null,
        avatars: entity.desire.avatars.filter(kept),
      },
    };
  });
  return changed ? { ...context, entities } : context;
}
