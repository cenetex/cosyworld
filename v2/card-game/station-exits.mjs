import forest from "./forest.json" with { type: "json" };

const roads = forest.places.station.exits;
export const STATION_EXIT_LIMIT = 3;
export const movedStationDoors = ["boardyai-parlour", "ratiradio-staff-kitchen"];
export function stationExitOrder(world, eligible) {
  const candidates = [...new Set(eligible)].filter((id) => !roads.includes(id));
  const earlier = (world.stationExitOrder || []).filter((id) =>
    candidates.includes(id),
  );
  return [...earlier, ...candidates.filter((id) => !earlier.includes(id))];
}
export function stationExits(world, eligible, available = eligible) {
  const fixed = roads.filter((id) => eligible.includes(id));
  const admitted = [...fixed, ...stationExitOrder(world, eligible)].slice(
    0,
    STATION_EXIT_LIMIT,
  );
  return admitted.filter((id) => available.includes(id));
}
export const validStationExitOrder = (world, targets) =>
  world.stationExitOrder === undefined ||
  (Array.isArray(world.stationExitOrder) &&
    new Set(world.stationExitOrder).size === world.stationExitOrder.length &&
    [...world.stationExitOrder].every(
      (id) => !roads.includes(id) && targets.includes(id),
    ));
