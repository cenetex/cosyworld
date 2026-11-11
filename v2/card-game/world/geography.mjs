// Geography: place text, the ordinary and rescue exits, and sealed ways.
// Split out of world.mjs (#1390).
import {
  entityActive,
  entityShown,
  packExits,
  actorCanVisit,
  personalRouteOpen,
  packDefinitions,
} from "../pack-registry.mjs";
import {
  controlledByHuman,
  humanPresent,
  residentAvatar,
  humanRoomAvailable,
  currentActor,
} from "../human-cast.mjs";
import {
  guardedExits,
  guardOf,
  guardedFrom,
  isGuardable,
} from "../resident-guard.mjs";
import { crossingScenery, crossingExits } from "../pack-rules.mjs";
import { transportScenery, transportExits } from "../pack-transport.mjs";
import { firstStart } from "../pack-toggle.mjs";
import { stationExits } from "../station-exits.mjs";
import { reflectionOpen, sensesFor, reflectionsFrom } from "./senses.mjs";
import { nameOf, places } from "./catalog.mjs";
import { itemPlace, rootHolder, carried } from "./items.mjs";
import { baseExits, stationCandidates, limitedExits } from "./station.mjs";
import {
  homeGates,
  atticInterior,
  knownActors,
  homeOf,
  willingToGive,
  canTrade,
  canUse,
} from "../world.mjs";

export const placeText = (s, place) =>
  [
    place === "attic" && reflectionOpen(s, place)
      ? "A tall mirror opens onto a black shore. A path leads through the glass."
      : s.opening && place === "station"
        ? "The timetable lists years that have yet to happen. A path leads along the shore to the pond."
        : places[place].text,
    ...crossingScenery(s, place, sensesFor(s),
      place === "station" ? stationCandidates(s).filter((id) =>
        !stationExits(s, stationCandidates(s)).includes(id)) : []),
    ...transportScenery(s, place, nameOf),
    ...(homeRescueExit(s, place) || pondRescueExit(s, place)
      ? [
          `A narrow path leads to ${nameOf(homeRescueExit(s, place) || pondRescueExit(s, place))}.`,
        ]
      : []),
  ].join(" ");
// A home gate can be restored by resources in the room, including a present
// helper's belongings. Full hands can make room through the usual Drop action.
function localGateResource(s, place, item, actor) {
  return Boolean(
    s.items[item] &&
      entityActive(s, item) &&
      itemPlace(s, item) === place &&
      (canUse(s, actor, item) ||
        (controlledByHuman(s, rootHolder(s, item)) &&
          humanPresent(s, rootHolder(s, item))) ||
        // An away traveler's lamp still lights here, though no one may
        // take it from them (rules 98).
        residentAvatar(s, rootHolder(s, item)) ||
        (knownActors(s).includes(rootHolder(s, item)) &&
          (willingToGive(s, rootHolder(s, item), item, actor) ||
            carried(s, actor).some((payment) =>
              canTrade(s, actor, payment, item),
            )))),
  );
}
export function homeGateRecoverable(s, place, gate, actor) {
  if (!localGateResource(s, place, gate.item, actor)) return false;
  if (!gate.light || s.items[gate.item].fuel > 0) return true;
  // Holding a full flask with the empty lamp refuels it, so a flask here is enough.
  return Boolean(gate.fuel && localGateResource(s, place, gate.fuel, actor));
}
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
// A doorway into another part of the same isolated home still needs a way out.
// Capacity is checked when traveling, so a crowded shore remains a waiting case.
function ordinaryRouteHome(s, place, destination, actor, previous) {
  const queue = [[place, previous]],
    visited = new Set([place]);
  for (let i = 0; i < queue.length; i++) {
    const [from, before] = queue[i];
    if (from === destination) return true;
    for (const to of ordinaryExits(s, from, actor, before)) {
      if (
        visited.has(to) ||
        !entityActive(s, to) ||
        !actorCanVisit(actor, to, s)
      )
        continue;
      visited.add(to);
      queue.push([to, from]);
    }
  }
  return false;
}
export function homeRescueExit(s, place, actor = currentActor(s), previous = null) {
  const gate = homeGates[place];
  actor ||= currentActor(s);
  return gate &&
    (controlledByHuman(s, actor) ||
      homeOf(actor) === place ||
      (gate.opening && knownActors(s).includes(actor))) &&
    s.actors[actor]?.place === place &&
    !ordinaryRouteHome(s, place, gate.rescue, actor, previous) &&
    !homeGateRecoverable(s, place, gate, actor)
    ? // With its rescue place asleep, the first pack on takes them in (rules 98).
      entityActive(s, gate.rescue)
      ? gate.rescue
      : firstStart(s)
    : null;
}
function insideLampRemedy(s, actor) {
  const here = s.actors[actor].place,
    lamp = itemPlace(s, "lamp"),
    oil = itemPlace(s, "oil");
  if (
    !atticInterior.has(here) ||
    !ordinaryRouteHome(s, here, lamp, actor) ||
    !ordinaryRouteHome(s, lamp, "attic", actor)
  )
    return false;
  const at = (place) => ({
    ...s,
    actors: { ...s.actors, [actor]: { ...s.actors[actor], place } },
  });
  if (!localGateResource(at(lamp), lamp, "lamp", actor)) return false;
  return (
    s.items.lamp.fuel > 0 ||
    (ordinaryRouteHome(s, here, oil, actor) &&
      ordinaryRouteHome(s, oil, lamp, actor) &&
      localGateResource(at(oil), oil, "oil", actor))
  );
}
// Recover a gate resource left beyond the mirror after reachable remedies are gone.
export function pondRescueExit(s, place, actor, previous) {
  actor ||= currentActor(s);
  const lamp = itemPlace(s, "lamp"),
    oil = itemPlace(s, "oil");
  // The flask is always full; it matters while it is shut inside with the lamp empty.
  if (
    place !== "pond" ||
    s.actors[actor]?.place !== place ||
    (!controlledByHuman(s, actor) && !knownActors(s).includes(actor)) ||
    !(atticInterior.has(lamp) || atticInterior.has(oil)) ||
    ordinaryRouteHome(s, place, "attic", actor, previous)
  )
    return null;
  if (
    ordinaryRouteHome(s, place, lamp, actor, previous) &&
    (s.items.lamp.fuel > 0 || ordinaryRouteHome(s, place, oil, actor, previous))
  )
    return null;
  if (
    knownActors(s).some(
      (id) =>
        (!controlledByHuman(s, id) || humanPresent(s, id)) &&
        (insideLampRemedy(s, id) ||
          (!atticInterior.has(lamp) &&
            s.actors[id].place === "attic" &&
            homeRescueExit(s, "attic", id) &&
            localGateResource(s, "attic", "oil", id))),
    )
  )
    return null;
  return "attic";
}
export function exits(s, place, actor = null, previous = null) {
  const rescue = homeRescueExit(s, place, actor, previous),
    returnPath = pondRescueExit(s, place, actor, previous);
  const ways = [
    ...ordinaryExits(s, place, actor, previous),
    ...(rescue ? [rescue] : []),
    ...(returnPath ? [returnPath] : []),
  ];
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
