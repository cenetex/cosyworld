import { heldItem } from "../held-item.mjs";
import { ELYSIUM_ENTRY, ELYSIUM_PACK } from "../elysium-models.mjs";
import { currentActor, humanAvatarIds, humanPresent } from "../human-cast.mjs";
import { entityActive, packIdOf } from "../pack-registry.mjs";
import { DAYLIGHT_TURNS, runHash } from "../pack-rules.mjs";
import { transportPlace } from "../pack-transport.mjs";
import { exits } from "./geography.mjs";
import { itemPlace } from "./items.mjs";

const WAYFINDER = "elysium-wayfinder";
const isElysium = (place) => packIdOf(place) === ELYSIUM_PACK;

export const wayfinderPassage = (from, to) => to === ELYSIUM_ENTRY && !isElysium(from);

export const wayfinderExit = (world, from, actor) =>
  !isElysium(from) &&
  humanPresent(world, actor) &&
  Math.floor(world.turn / DAYLIGHT_TURNS) % 2 === 1 &&
  world.items[WAYFINDER]?.holder === actor &&
  entityActive(world, WAYFINDER) &&
  heldItem(world, actor) === WAYFINDER
    ? ELYSIUM_ENTRY
    : null;

export function elysiumScatterLandings(world, actor = currentActor(world)) {
  if (!entityActive(world, "station")) return [];
  const waysFrom = (place) =>
    exits(
      {
        ...world,
        actors: { ...world.actors, [actor]: { ...world.actors[actor], place } },
      },
      place,
      actor,
    );
  const reachable = new Set(["station"]);
  for (const place of reachable)
    for (const neighbor of waysFrom(place))
      if (
        !reachable.has(neighbor) &&
        !isElysium(neighbor) &&
        !transportPlace(neighbor) &&
        waysFrom(neighbor).includes(place)
      )
        reachable.add(neighbor);
  return [...reachable].sort();
}

export function scatterWayfinder(world) {
  if (!entityActive(world, WAYFINDER)) return;
  const active = currentActor(world);
  const traveler = humanPresent(world, active)
    ? active
    : humanAvatarIds.find((id) => humanPresent(world, id));
  const destinations = traveler
    ? elysiumScatterLandings(world, traveler)
    : ["pond", "station"].filter((place) => entityActive(world, place));
  if (!destinations.length) return;
  world.items[WAYFINDER].holder =
    destinations[
      runHash(world, `${WAYFINDER}:${world.turn}`) % destinations.length
    ];
}

export function settleStrandedWayfinder(world) {
  if (
    world.items[WAYFINDER] &&
    isElysium(itemPlace(world, WAYFINDER)) &&
    !humanAvatarIds.some(
      (id) => humanPresent(world, id) && isElysium(world.actors[id]?.place),
    )
  )
    scatterWayfinder(world);
}
