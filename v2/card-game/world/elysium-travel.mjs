import { heldItem } from "../held-item.mjs";
import {
  ELYSIUM_ENTRY, ELYSIUM_MODEL_IDS, ELYSIUM_PACK, elysiumModelToken, isElysiumModelToken,
} from "../elysium-models.mjs";
import { currentActor, humanAvatarIds, humanPresent, sharedEnabled } from "../human-cast.mjs";
import { entityActive, packIdOf, packPlaces } from "../pack-registry.mjs";
import { DAYLIGHT_TURNS, runHash } from "../pack-rules.mjs";
import { transportPlace } from "../pack-transport.mjs";
import { places } from "./catalog.mjs";
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

// A Void token lands in any world: the one holding fewest tokens, then its
// emptiest open room, so a tour spreads them through every world.
const tokenRooms = (world) =>
  Object.keys(places).filter((place) => !isElysium(place) && !transportPlace(place) &&
    entityActive(world, place) && !packPlaces[place]?.requires?.length).sort();

export function elysiumTokenLanding(world, token) {
  const rooms = new Map(tokenRooms(world).map((place) => [place, { place, tokens: 0, loose: 0 }]));
  if (!rooms.size) return null;
  for (const [id, { holder }] of Object.entries(world.items)) {
    const room = rooms.get(holder);
    if (!room || !entityActive(world, id)) continue;
    room.loose++;
    if (isElysiumModelToken(id)) room.tokens++;
  }
  const worlds = new Map();
  for (const room of rooms.values())
    worlds.set(packIdOf(room.place), (worlds.get(packIdOf(room.place)) ?? 0) + room.tokens);
  const fewest = Math.min(...worlds.values());
  const open = [...worlds.keys()].filter((id) => worlds.get(id) === fewest).sort();
  const chosen = open[runHash(world, `${token}:world`) % open.length];
  const here = [...rooms.values()].filter((room) => packIdOf(room.place) === chosen);
  const compare = (a, b) => a.tokens - b.tokens || a.loose - b.loose;
  const best = here.reduce((least, room) => (compare(room, least) < 0 ? room : least));
  const tied = here.filter((room) => compare(room, best) === 0);
  return tied[runHash(world, token) % tied.length].place;
}

// Once: tokens scattered before they could reach every world, even ones a
// traveler carries, are scattered again. Returned tokens stay returned.
export function spreadVoidTokens(world) {
  if (world.voidTokensSpread) return;
  world.voidTokensSpread = true;
  const out = ELYSIUM_MODEL_IDS.filter((resident) => {
    const record = world.elysiumEncounters?.[resident];
    const item = world.items[elysiumModelToken(resident)];
    return record && !record.returnedAt && item && item.holder !== resident;
  });
  for (const resident of out) world.items[elysiumModelToken(resident)].holder = resident;
  for (const resident of out) {
    const token = elysiumModelToken(resident), item = world.items[token];
    const place = elysiumTokenLanding(world, token);
    if (!place) continue;
    item.holder = place;
    item.history = [...item.history, `Turn ${world.turn}: Scattered through the worlds.`].slice(-12);
  }
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
