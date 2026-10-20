// What each avatar knows. An avatar sees only its own place: the ways out,
// the items lying there or held by avatars there, and the avatars there. A
// hidden item is seen only by searching. Talking shares what two avatars know.
// Knowledge is saved state, so replays agree, and the planner reads only it:
// a resident has to explore, search, and ask, the same as a player.
import { distances, holderOf, itemPlace } from "./goals.mjs";

// places[id]: { visited: turn or null, exits: ids or null, searched: turn or null }
// items[id]: { at: place or avatar id, turn }
// avatars[id]: { at: place id, turn }
export const newKnowledge = () => ({ places: {}, items: {}, avatars: {} });

export const knowsPlace = (s, avatar, place) =>
  Boolean(s.avatars[avatar].known.places[place]);
export const visited = (s, avatar, place) =>
  s.avatars[avatar].known.places[place]?.visited != null;
// An item is visible to an avatar where it stands unless it is hidden and the
// avatar has not found it.
export const visibleTo = (s, avatar, item) =>
  !s.items[item].hidden || Boolean(s.avatars[avatar].known.items[item]);
export const knowsItem = (s, avatar, item) =>
  Boolean(s.avatars[avatar].known.items[item]);

// Where the avatar believes an item is: a place, or the believed place of the
// avatar it last saw holding it.
export function believedPlace(s, avatar, item) {
  const k = s.avatars[avatar].known;
  const at = k.items[item]?.at;
  if (!at) return null;
  if (s.places[at]) return at;
  if (at === avatar) return s.avatars[avatar].place;
  return k.avatars[at]?.at ?? null;
}
export const believedAvatarPlace = (s, avatar, other) =>
  other === avatar
    ? s.avatars[avatar].place
    : (s.avatars[avatar].known.avatars[other]?.at ?? null);

// Look around. Beliefs about this place that no longer hold are dropped, and
// sightings older than the world's memory fade. Places are never forgotten.
// Returns true when this is the avatar's first visit here.
export function observe(s, avatar) {
  const a = s.avatars[avatar],
    k = a.known,
    here = a.place,
    turn = s.turn;
  for (const kind of ["items", "avatars"])
    for (const [id, e] of Object.entries(k[kind]))
      if (turn - e.turn > s.rules.memoryTurns && e.at !== avatar)
        delete k[kind][id];
  const first = !visited(s, avatar, here);
  k.places[here] = {
    visited: turn,
    exits: [...s.places[here].exits],
    searched: k.places[here]?.searched ?? null,
  };
  for (const id of s.places[here].exits)
    k.places[id] ??= { visited: null, exits: null, searched: null };
  const present = Object.keys(s.avatars).filter(
    (id) => s.avatars[id].place === here,
  );
  for (const [id, b] of Object.entries(k.avatars))
    if (b.at === here && !present.includes(id)) delete k.avatars[id];
  for (const id of present)
    if (id !== avatar) k.avatars[id] = { at: here, turn };
  for (const [id, b] of Object.entries(k.items))
    if ((b.at === here || present.includes(b.at)) && holderOf(s, id) !== b.at)
      delete k.items[id];
  for (const id of Object.keys(s.items))
    if (itemPlace(s, id) === here && (!s.items[id].hidden || k.items[id]))
      k.items[id] = { at: holderOf(s, id), turn };
  return first;
}

// Search this place: every hidden item here becomes known. Returns the finds.
export function search(s, avatar) {
  const a = s.avatars[avatar],
    here = a.place;
  a.known.places[here].searched = s.turn;
  const found = Object.keys(s.items).filter(
    (id) =>
      holderOf(s, id) === here && s.items[id].hidden && !a.known.items[id],
  );
  for (const id of found) a.known.items[id] = { at: here, turn: s.turn };
  return found;
}

// How long a sighting stays news worth passing on.
export const NEWS_TURNS = 12;
// Two avatars tell each other what they know: every place they have been and
// what they saw recently. Older sightings stay their own. The newer report wins.
export function share(s, one, other) {
  const a = s.avatars[one].known,
    b = s.avatars[other].known;
  for (const [mine, theirs] of [
    [a, b],
    [b, a],
  ]) {
    for (const [id, p] of Object.entries(theirs.places)) {
      const q = mine.places[id];
      if (!q || (p.visited ?? -1) > (q.visited ?? -1))
        mine.places[id] = { ...p, searched: q?.searched ?? null };
    }
    for (const kind of ["items", "avatars"])
      for (const [id, e] of Object.entries(theirs[kind]))
        if (
          s.turn - e.turn <= NEWS_TURNS &&
          (!mine[kind][id] || e.turn > mine[kind][id].turn)
        )
          mine[kind][id] = { ...e };
  }
  delete a.avatars[one];
  delete b.avatars[other];
}

// A route over what the avatar knows: exits of places it has visited. Returns
// the next place on a shortest known route to the target, or null.
export function knownStep(s, avatar, target) {
  const k = s.avatars[avatar].known,
    from = s.avatars[avatar].place;
  if (!target || target === from) return null;
  const queue = [[from]],
    seen = new Set([from]);
  while (queue.length) {
    const route = queue.shift();
    const last = route.at(-1);
    if (last === target) return route[1];
    for (const next of k.places[last]?.exits ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...route, next]);
      }
  }
  return null;
}
// The nearest known place the avatar has not visited yet, by known routes.
export function frontier(s, avatar) {
  const k = s.avatars[avatar].known,
    from = s.avatars[avatar].place;
  const queue = [from],
    seen = new Set([from]);
  while (queue.length) {
    const place = queue.shift();
    if (k.places[place]?.visited == null && place !== from) return place;
    for (const next of k.places[place]?.exits ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  return null;
}

// A clue for something the avatar has not seen: the known place nearest to
// where it really is. Quests record clues when they are made.
export function clueFor(s, avatar, place) {
  if (!place) return null;
  const k = s.avatars[avatar].known;
  if (k.places[place]) return place;
  // Search outward from the real place along its ways out.
  const near = distances(s, place);
  let best = null;
  for (const [id, d] of near)
    if (k.places[id] && (best === null || d < near.get(best))) best = id;
  return best;
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function validKnowledge(s, k) {
  const turn = (v) => v === null || (Number.isInteger(v) && v >= 0);
  return (
    k &&
    typeof k === "object" &&
    [k.places, k.items, k.avatars].every((m) => m && typeof m === "object") &&
    Object.entries(k.places).every(
      ([id, p]) =>
        s.places[id] &&
        turn(p.visited) &&
        turn(p.searched) &&
        (p.exits === null ||
          (Array.isArray(p.exits) && p.exits.every((e) => ID.test(e)))),
    ) &&
    Object.entries(k.items).every(
      ([id, e]) =>
        s.items[id] &&
        typeof e.at === "string" &&
        (s.places[e.at] || s.avatars[e.at]) &&
        turn(e.turn),
    ) &&
    Object.entries(k.avatars).every(
      ([id, e]) => s.avatars[id] && s.places[e.at] && turn(e.turn),
    )
  );
}
