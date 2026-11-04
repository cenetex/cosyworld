// The halfway glimpse (rules 99, sleep spec §5). Meeting the quest to sleep
// at a sanctuary locks one aspect of the coming level quest: a verb, a
// person, an item or a place, drawn from what the avatar knows. The level
// quest's first step then uses it. The draw is seeded by the run, the avatar
// and the level, never random, so the browser and the shared server agree
// and journals replay. `api` supplies the world reads world.mjs owns.
import { localRoadEnds, retiredPlace } from "./pack-registry.mjs";
import { runHash } from "./pack-rules.mjs";

export const GLIMPSE_KINDS = ["verb", "person", "item", "place"];
// The verbs a level quest's first step may take.
export const GLIMPSE_VERBS = ["find", "give", "bring", "meet"];

// An id that no longer exists: retired, not merely asleep or used up.
export function gone(s, kind, id, api) {
  if (kind === "item") return !Object.hasOwn(s.items, id);
  if (kind === "person") return !Object.hasOwn(s.actors, id);
  if (kind === "place")
    return (
      !api.places().includes(id) ||
      retiredPlace(id) ||
      Boolean(localRoadEnds(id))
    );
  return !GLIMPSE_VERBS.includes(id);
}

// What the avatar knows, by kind: the people it has talked with, the places
// it has been, and the things it carries or that are where it has been.
export function knownAspects(s, actor, api) {
  const a = s.actors[actor],
    been = new Set(a.visited);
  const live = (kind) => (id) => !gone(s, kind, id, api) && api.active(id);
  return {
    verb: GLIMPSE_VERBS,
    person: a.talked.filter((id) => id !== actor).filter(live("person")),
    item: Object.keys(s.items)
      .filter((id) => api.rootHolder(id) === actor || been.has(api.placeOf(id)))
      .filter(live("item")),
    place: a.visited.filter(live("place")),
  };
}
const sorted = (list) => [...new Set(list)].sort();

// The aspect dreamed at halfway to `level`: a kind among those the avatar
// knows anything of, then one of that kind. `at` is where it was dreamed.
export function drawGlimpse(s, actor, api, level) {
  const known = knownAspects(s, actor, api);
  const kinds = GLIMPSE_KINDS.filter((kind) => known[kind].length);
  const roll = runHash(s, `glimpse:${actor}:${level}`);
  const kind = kinds[roll % kinds.length],
    list = sorted(known[kind]);
  return {
    level,
    kind,
    id: list[Math.floor(roll / kinds.length) % list.length],
    at: s.actors[actor].place,
  };
}

// The aspect the level quest must use. One only out of reach or asleep is
// kept: the dream stays true and the quest may wait. One whose id is gone
// keeps its kind, with the nearest known entity of that kind in its place:
// fewest steps from where it was dreamed, ties by id. Null when none is.
export function glimpseAspect(s, actor, api, glimpse) {
  if (!gone(s, glimpse.kind, glimpse.id, api)) return glimpse;
  const where = (id) =>
    glimpse.kind === "place"
      ? id
      : glimpse.kind === "item"
        ? api.placeOf(id)
        : s.actors[id].place;
  const steps = (id) => {
    const n = api.distance(glimpse.at, where(id), actor);
    return n < 0 ? 64 : n;
  };
  const near = sorted(knownAspects(s, actor, api)[glimpse.kind])
    .map((id) => [steps(id), id])
    .sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1));
  return near.length ? { ...glimpse, id: near[0][1] } : null;
}

// Whether a level quest's step uses the aspect.
export function honours(want, aspect) {
  if (!want || !aspect) return false;
  if (aspect.kind === "verb") return want.step?.verb === aspect.id;
  if (aspect.kind === "item")
    return want.kind === "item" && want.target === aspect.id;
  if (aspect.kind === "person")
    return want.target === aspect.id || want.step?.to === aspect.id;
  return want.target === aspect.id || want.step?.at === aspect.id;
}

// A saved glimpse. Its id may since have been retired, so only its shape is
// checked; the level quest substitutes for an id that is gone.
export function validGlimpse(g, most) {
  const name = (v) => typeof v === "string" && v.length > 0 && v.length <= 120;
  return Boolean(
    g &&
      typeof g === "object" &&
      Object.keys(g).length === 4 &&
      Number.isSafeInteger(g.level) &&
      g.level >= 2 &&
      g.level <= most &&
      GLIMPSE_KINDS.includes(g.kind) &&
      name(g.id) &&
      (g.kind !== "verb" || GLIMPSE_VERBS.includes(g.id)) &&
      name(g.at),
  );
}
