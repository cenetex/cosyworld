// Supply eligible IDs in authored
// order; persist the returned queue after every eligibility change, including closure.
// Pond reserves one slot. Availability hides admitted ways without promoting waiters.
// Readers never change the save; validate saved queues before using them.
export const STATION_EXIT_LIMIT = 3;
export function stationExitOrder(world, eligible) {
  const candidates = [...new Set(eligible)].filter((id) => id !== "pond");
  const earlier = (world.stationExitOrder || []).filter((id) =>
    candidates.includes(id),
  );
  return [...earlier, ...candidates.filter((id) => !earlier.includes(id))];
}
export function stationExits(world, eligible, available = eligible) {
  const admitted = ["pond", ...stationExitOrder(world, eligible)].slice(
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
      (id) => id !== "pond" && targets.includes(id),
    ));
