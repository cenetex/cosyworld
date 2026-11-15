import forest from "../forest.json" with { type: "json" };
import { humanPresent } from "../human-cast.mjs";
import { entityActive } from "../pack-registry.mjs";
import { calledTravelers } from "./arcana-record.mjs";

export const stopsOf = (id) => forest.people[id]?.stops ?? null;

export function settleStops(s, { distance, arrive }) {
  const present = Object.keys(s.actors)
    .sort()
    .filter((id) => humanPresent(s, id));
  const seen = new Set(present.map((id) => s.actors[id].place));
  const caller = calledTravelers(s)[0];
  if (!caller) return;
  for (const id of Object.keys(forest.people).sort()) {
    const a = s.actors[id];
    if (
      !stopsOf(id) ||
      !a ||
      !entityActive(s, id) ||
      a.sleeping ||
      seen.has(a.place) ||
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
    a.place = to;
    if (seen.has(to)) arrive(id, to);
  }
}
