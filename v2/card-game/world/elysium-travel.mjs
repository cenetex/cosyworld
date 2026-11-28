import { heldItem } from "../held-item.mjs";
import { ELYSIUM_ENTRY, ELYSIUM_PACK, isElysiumModelToken } from "../elysium-models.mjs";
import { currentActor, humanAvatarIds, humanPresent, sharedEnabled } from "../human-cast.mjs";
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
  // A scatter has to stay retrievable if the other travelers leave.
  const company = sharedEnabled(world) &&
    world.controlledActors?.some((id) => id !== actor && humanPresent(world, id));
  const waysFrom = (place) => {
    const actors = { ...world.actors, [actor]: { ...world.actors[actor], place } };
    const open = exits({ ...world, actors }, place, actor);
    if (!company) return open;
    const alone = exits({ ...world, actors, presentActors: [actor] }, place, actor);
    return open.filter((neighbor) => alone.includes(neighbor));
  };
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

export function elysiumTokenLanding(world, actor, token) {
  const landings = elysiumScatterLandings(world, actor);
  if (!landings.length) return null;
  const occupancy = new Map(
    landings.map((place) => [place, { place, tokens: 0, loose: 0 }]),
  );
  for (const [id, { holder }] of Object.entries(world.items)) {
    const room = occupancy.get(holder);
    if (!room || !entityActive(world, id)) continue;
    room.loose++;
    if (isElysiumModelToken(id)) room.tokens++;
  }
  const compare = (a, b) => a.tokens - b.tokens || a.loose - b.loose;
  const rooms = [...occupancy.values()];
  const best = rooms.reduce((least, room) => (compare(room, least) < 0 ? room : least));
  const tied = rooms.filter((room) => compare(room, best) === 0);
  return tied[runHash(world, token) % tied.length].place;
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
