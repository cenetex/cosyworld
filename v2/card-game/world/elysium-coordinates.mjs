import models from "../elysium-coordinate-models.json" with { type: "json" };
import { packDefinition } from "../pack-registry.mjs";
import { runHash } from "../pack-rules.mjs";

export const OBSERVATORY = "elysium-observatory";
const rings = ["outer", "middle", "inner"];
const stones = rings.map((ring) => `elysium-ring-${ring}`);
const coreVoids = 7;
const numberOf = (place) => {
  const match = /^elysium-void-(\d{3})$/u.exec(place);
  return match ? Number(match[1]) : null;
};
const coordinateRoom = (resident) =>
  typeof resident === "string" && resident.startsWith("elysium-coordinate-")
    ? resident.replace("coordinate", "void")
    : null;
export const isCoordinateResident = (id) =>
  numberOf(coordinateRoom(id)) > coreVoids;
const coordinateEntityRoom = (id) =>
  isCoordinateResident(id)
    ? coordinateRoom(id)
    : numberOf(id) > coreVoids
      ? id
      : null;

// Ring positions use the same item-at requirements as travel.
let routes;
function coordinates() {
  routes ??= (packDefinition("elysium")?.routes || [])
    .filter(({ requires }) =>
      stones.every((item) =>
        requires?.some(
          (condition) =>
            condition.kind === "item_at" && condition.item === item,
        ),
      ),
    )
    .map(({ from, to, requires }) => ({
      from,
      room: to,
      address: stones.map((item) =>
        numberOf(
          requires?.find(
            (condition) =>
              condition.kind === "item_at" && condition.item === item,
          )?.place,
        ),
      ),
    }));
  return routes;
}

const positions = (world) =>
  stones.map((id) => numberOf(world.items?.[id]?.holder));
const match = (address, other) =>
  address.every((number, index) => number === other[index]);
const alignedRoom = (world, address = positions(world)) =>
  address.every((number) => number > 0)
    ? coordinates().find((route) => match(address, route.address))
    : null;

export function observatoryCoordinates(world, actor) {
  const place = world.actors?.[actor]?.place;
  if (
    !coordinates().some((route) => route.from === place) ||
    !stones.every((id) => world.items?.[id])
  )
    return null;
  const address = positions(world);
  return {
    outer: address[0],
    middle: address[1],
    inner: address[2],
    aligned: alignedRoom(world, address)?.from === place,
  };
}

export function coordinateEntityActive(world, id) {
  const room = coordinateEntityRoom(id);
  return !room || Boolean(world.elysiumCoordinates?.[room]);
}

export const coordinateRouteDiscovered = (world, from, to) =>
  Boolean(world.elysiumCoordinates?.[to]) &&
  coordinates().some((route) => route.from === from && route.room === to);

const surroundings = [
  "Thin lines of frost follow the edges of the stone.",
  "Drifts of gold dust hang in place above the floor.",
  "A few shadows fall toward the terrace lamps.",
  "The light catches narrow seams of smoky glass.",
];
const temperaments = [
  "Notices where travelers hesitate and asks them what they expected to find.",
  "Keeps a private record of small changes in the room and collects contradictory accounts.",
  "Is impatient with ceremony and generous to a traveler who admits uncertainty.",
  "Speaks with quiet delight at unlikely coincidences and rarely offers advice unasked.",
];
const draw = (world, address) => {
  const key = `elysium-coordinate-v1:${address.join(".")}`;
  return {
    model:
      models.models[
        runHash(world, `elysium-coordinate:${address.join(",")}`) %
          models.models.length
      ],
    scenery: runHash(world, `${key}:scenery`) % surroundings.length,
    temperament: runHash(world, `${key}:resident`) % temperaments.length,
  };
};

export function discoverCoordinate(world, event) {
  if (event.verb !== "drop" || !stones.includes(event.itemId)) return;
  const route = alignedRoom(world);
  if (
    !route ||
    world.elysiumCoordinates?.[route.room] ||
    !coordinateEntityActive(world, route.from)
  )
    return;
  (world.elysiumCoordinates ??= {})[route.room] = {
    ...draw(world, route.address),
    openedAt: event.seq,
  };
  const places = packDefinition("elysium").places;
  event.text += ` A filament opens from ${places[route.from].name} to ${places[route.room].name}.`;
}

export function validElysiumCoordinates(world) {
  const records = world.elysiumCoordinates;
  if (records === undefined) return true;
  if (!records || typeof records !== "object" || Array.isArray(records))
    return false;
  return Object.entries(records).every(([room, record]) => {
    const route = coordinates().find((entry) => entry.room === room);
    if (
      !route ||
      !coordinateEntityActive(world, route.from) ||
      !record ||
      Object.keys(record).sort().join() !== "model,openedAt,scenery,temperament"
    )
      return false;
    const { address } = route;
    const { model, scenery, temperament, openedAt } = record;
    const seeded = draw(world, address);
    const event = world.log.find((entry) => entry.seq === openedAt);
    const parentOpened = records[route.from]?.openedAt ?? 0;
    return (
      model === seeded.model &&
      scenery === seeded.scenery &&
      temperament === seeded.temperament &&
      Number.isSafeInteger(openedAt) &&
      openedAt > 1 &&
      openedAt > parentOpened &&
      openedAt <= world.eventSeq &&
      (event
        ? event.kind === "action" &&
          event.verb === "drop" &&
          address[stones.indexOf(event.itemId)] === numberOf(event.locationId)
        : openedAt < world.log[0]?.seq)
    );
  });
}

export const coordinateScenery = (world, room) =>
  surroundings[world.elysiumCoordinates?.[room]?.scenery];

export const coordinateTemperament = (world, id) =>
  temperaments[world.elysiumCoordinates?.[coordinateRoom(id)]?.temperament];

export function coordinateNarrative(world, room) {
  const record = world.elysiumCoordinates?.[room];
  if (!record) return null;
  const { address } = coordinates().find((entry) => entry.room === room);
  return {
    address,
    room,
    resident: room.replace("void", "coordinate"),
    model: record.model,
    scope: String(world.run?.seed ?? 0),
  };
}
