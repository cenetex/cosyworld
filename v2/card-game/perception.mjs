// What a speaker notices this moment (P3): this moment's changes ranked by
// how much they involve it, the difference from its last visit, and a pull
// toward its want. Ids and indices only; the server words them. Derived from
// existing state, outside the rules engine.
import { exits, itemPlace } from "./world.mjs";

// The play itself is the conversation, or nothing happened.
const QUIET = new Set(["wait", "talk"]);

// Who a speaker addresses, as the server reads it: the actor answers the
// first other speaker; everyone else answers the actor.
export function listenerOf(speakers, id, actor) {
  if (!speakers.includes(id)) return null;
  if (id !== actor && speakers.includes(actor)) return actor;
  return speakers.find((other) => other !== id) || null;
}

function involvement(entry, id, listener, wanted) {
  if (QUIET.has(entry.verb)) return 0;
  // My own trip is said as my arrival or leaving.
  if (
    entry.actorId === id &&
    entry.fromLocationId &&
    entry.fromLocationId !== entry.locationId
  )
    return 0;
  if ([entry.actorId, entry.targetId].includes(id)) return 4;
  if (listener && [entry.actorId, entry.targetId].includes(listener)) return 3;
  if (wanted.includes(entry.itemId)) return 2;
  return 1;
}

// The two of this moment's events that most involve me, best first.
function changes(entries, id, listener, wanted) {
  return entries
    .map((entry, index) => ({
      index,
      score: involvement(entry, id, listener, wanted),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 2)
    .map(({ index }) => index);
}

// My latest arrival here, until I first speak here, compared with the
// time before: the first visit, or one person or thing that has come or
// gone since. A trimmed log cannot tell a first visit.
function arrival(world, id, present, here) {
  if (world.actors[id].place !== here) return null;
  const arrived = world.log.findLast(
    (e) =>
      !e.generated &&
      e.locationId === here &&
      e.fromLocationId &&
      e.fromLocationId !== here &&
      (e.actorId === id ||
        (e.verb === "accompany" && e.accepted && e.targetId === id)),
  );
  if (
    !arrived ||
    world.log.some(
      (e) =>
        e.seq > arrived.seq &&
        e.generated &&
        e.actorId === id &&
        e.locationId === here,
    )
  )
    return null;
  const last = world.log.findLast(
    (e) => e.seq < arrived.seq && e.locationId === here && e.cast?.includes(id),
  );
  if (!last) return world.log[0]?.seq === 1 ? { first: true } : null;
  const ground = (items) =>
    items.filter((item) => item.holder === here).map((item) => item.id);
  const then = [...last.cast, ...ground(last.items || [])];
  const now = [
    ...present,
    ...Object.keys(world.items).filter(
      (item) => world.items[item].holder === here,
    ),
  ];
  const others = (ids) => ids.filter((other) => other !== id);
  const gone = others(then).find(
    (other) =>
      !now.includes(other) && (world.actors[other] || world.items[other]),
  );
  const came = others(now).find((other) => !then.includes(other));
  return gone ? { gone } : came ? { came } : {};
}

export function perception(world, id, cast) {
  const { speakers, entries, actor, present, desire, location } = cast;
  const listener = listenerOf(speakers, id, actor);
  const here = world.actors[id].place;
  const pull =
    desire?.location && exits(world, here, id).includes(desire.location)
      ? desire.location
      : null;
  const wanted = (desire?.items || []).filter(
    (item) => itemPlace(world, item) === here,
  );
  return {
    changes: changes(entries, id, listener, wanted),
    arrival: arrival(world, id, present, location),
    ...(pull ? { pull } : {}),
  };
}
