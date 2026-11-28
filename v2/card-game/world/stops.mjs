import forest from "../forest.json" with { type: "json" };
import { humanPresent } from "../human-cast.mjs";
import { entityActive, packPeople } from "../pack-registry.mjs";
import { calledTravelers } from "./arcana-record.mjs";

export const stopsOf = (id) => forest.people[id]?.stops ?? null;
const unmet = (s, id) => {
  const met = packPeople[id] && s.packs?.[packPeople[id].packId]?.met;
  return (
    (met && met[id] === undefined) ||
    (Boolean(s.opening) &&
      Boolean(packPeople[id] || stopsOf(id)) &&
      s.opening.met?.[id] === undefined)
  );
};
export const unmetAt = (s, place) =>
  Object.keys(s.actors).some(
    (id) => s.actors[id].place === place && entityActive(s, id) && unmet(s, id),
  );

export function relocateActor(s, id, to) {
  const actor = s.actors[id];
  if (id === "listener") {
    for (const traveler of Object.values(s.actors))
      if (traveler.arcana?.offer === actor.place) traveler.arcana.offer = to;
  }
  actor.place = to;
}

export function settleStops(s, { distance, arrive }) {
  const present = Object.keys(s.actors)
    .sort()
    .filter((id) => humanPresent(s, id));
  const seen = new Set(present.map((id) => s.actors[id].place));
  const caller = calledTravelers(s)[0];
  if (!caller) return;
  for (const id of Object.keys(forest.people).sort()) {
    const a = s.actors[id];
    const waiting = id === "listener" && a && present.some(
      (traveler) => s.actors[traveler].arcana?.offer === a.place,
    );
    if (
      !stopsOf(id) ||
      !a ||
      !entityActive(s, id) ||
      a.sleeping ||
      seen.has(a.place) ||
      waiting ||
      (s.standoffs || []).some((c) => Object.hasOwn(c.resolve || {}, id))
    )
      continue;
    let to = null,
      best = Infinity;
    for (const stop of stopsOf(id)) {
      if (!entityActive(s, stop)) continue;
      const moves = distance(caller, stop) ?? Infinity;
      if (to === null || moves < best) [to, best] = [stop, moves];
    }
    to ??= "pond";
    if (to === a.place) continue;
    relocateActor(s, id, to);
    if (seen.has(to)) arrive(id, to);
  }
}
