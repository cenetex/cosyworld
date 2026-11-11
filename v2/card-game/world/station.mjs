// Station exits and candidates, split out of world.mjs (#1390).
import {
  crossings,
  transports,
  packDefinitions,
  entityActive,
  packExits,
} from "../pack-registry.mjs";
import { humanAvatar, humanPresent, residentAvatar } from "../human-cast.mjs";
import { crossingOpen } from "../pack-rules.mjs";
import { stationExits, stationExitOrder } from "../station-exits.mjs";
import { reflectionsFrom, sensesFor } from "./senses.mjs";
import { places } from "./catalog.mjs";

export const baseExits = (_s, place) => places[place].exits;
// Conditions without a traveler (the train and calling card) may open while
// nobody stands here. A traveler-specific key counts only for its present holder.
const stationCrossings = crossings.filter((c) => c.from === "station");
export const stationTargets = [
  ...new Set([
    ...places.station.exits,
    ...stationCrossings.map((c) =>
      c.transport ? transports[c.transport].place : c.to,
    ),
    ...packDefinitions.flatMap((p) =>
      (p.routes || [])
        .filter((r) => r.from === "station")
        .map((r) => r.to),
    ),
  ]),
];
export function stationCandidates(s) {
  const actors = [
    null,
    ...Object.keys(s.actors).filter(
      (id) =>
        s.actors[id].place === "station" &&
        entityActive(s, id) &&
        (!humanAvatar(id) || humanPresent(s, id) || residentAvatar(s, id)),
    ),
  ];
  return [
    ...new Set([
      ...baseExits(s, "station"),
      ...reflectionsFrom(s, "station"),
      ...stationCrossings
        .filter((c) =>
          actors.some((actor) => crossingOpen(s, c, sensesFor(s), actor)),
        )
        .map((c) => (c.transport ? transports[c.transport].place : c.to)),
      ...packExits(s, "station", null),
    ]),
  ].filter((id) => entityActive(s, id));
}
export function settleStationExits(s) {
  s.stationExitOrder = stationExitOrder(s, stationCandidates(s));
}
export function limitedExits(s, place, ways) {
  return place === "station" ? stationExits(s, stationCandidates(s), ways) : ways;
}
