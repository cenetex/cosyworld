// Geography: place text, exits and sealed ways.
// Split out of world.mjs (#1390).
import {
  entityActive,
  entityShown,
  packExits,
  actorCanVisit,
  personalRouteOpen,
  packDefinitions,
} from "../pack-registry.mjs";
import { humanRoomAvailable, currentActor } from "../human-cast.mjs";
import {
  guardedExits,
  guardOf,
  guardedFrom,
  isGuardable,
} from "../resident-guard.mjs";
import { crossingScenery, crossingExits } from "../pack-rules.mjs";
import { transportScenery, transportExits } from "../pack-transport.mjs";
import { stationExits } from "../station-exits.mjs";
import { reflectionOpen, sensesFor, reflectionsFrom } from "./senses.mjs";
import { nameOf, places } from "./catalog.mjs";
import { baseExits, stationCandidates, limitedExits } from "./station.mjs";

export const placeText = (s, place) =>
  [
    place === "attic" && reflectionOpen(s, place)
      ? "A tall mirror opens onto a black shore. A path leads through the glass."
      : places[place].text,
    ...crossingScenery(s, place, sensesFor(s),
      place === "station" ? stationCandidates(s).filter((id) =>
        !stationExits(s, stationCandidates(s)).includes(id)) : []),
    ...transportScenery(s, place, nameOf),
  ].join(" ");
function rawOrdinaryExits(s, place, actor, previous) {
  return [
    ...new Set([
      ...baseExits(s, place),
      ...reflectionsFrom(s, place),
      ...crossingExits(s, place, actor, sensesFor(s)),
      ...transportExits(s, place, previous, actor),
      ...packExits(s, place, actor),
    ]),
  ];
}
function ordinaryExits(s, place, actor, previous) {
  return limitedExits(s, place, rawOrdinaryExits(s, place, actor, previous));
}
export function exits(s, place, actor = null, previous = null) {
  const ways = [...ordinaryExits(s, place, actor, previous)];
  // A guardable way, and the way back through it (rules 100).
  for (const to of guardedExits(s, place))
    if (!ways.includes(to)) ways.push(to);
  return limitedExits(s, place, ways.filter(
    (to) =>
      entityActive(s, to) &&
      actorCanVisit(actor, to, s) &&
      humanRoomAvailable(s, actor, to) &&
      personalRouteOpen(s, place, to, actor || currentActor(s)) &&
      !guardOf(s, place, to, actor),
  ));
}

// A sealed way (rules 95): a pack route that names its sealed card and the
// quest that opens it, while it is shut from where the traveller stands.
// A guarded way shows the same sealed card while its guard bars it (rules
// 100); what opens it is read from the guard (world/boxes.mjs).
let sealedRoutes = null;
export function sealedWays(s, actor = currentActor(s)) {
  sealedRoutes ??= packDefinitions.flatMap((pack) =>
    (pack.routes || []).filter((r) => r.sealed || isGuardable(r.from, r.to)),
  );
  const here = s.actors[actor]?.place,
    ways = [
      ...sealedRoutes.filter((r) => r.from === here),
      // A guard bars his way from both sides (rules 100).
      ...guardedFrom(here).map((to) => ({ from: here, to })),
    ]
      // The card beyond lies shut even while its own conditions fail (rules
      // 133); `exits` still uses `entityActive`, so it cannot be entered.
      .filter((r) => entityShown(s, r.to) && entityActive(s, here));
  if (!ways.length) return [];
  const open = exits(s, here, actor),
    seen = new Set();
  return ways
    .filter((r) => !open.includes(r.to))
    .flatMap((r) => {
      const guard = guardOf(s, here, r.to, actor);
      if (!guard) return r.sealed ? [r] : [];
      // The card beyond a guarded way is locked and gives no quest (rules
      // 102). Talk with him gives his.
      return [{ ...r, sealed: {}, guardedBy: guard }];
    })
    .filter((r) => !seen.has(r.to) && seen.add(r.to));
}
