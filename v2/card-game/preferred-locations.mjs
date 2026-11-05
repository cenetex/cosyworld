// Spots use full painting percentages: x, feet y, and portrait size multiplier.
export function preferredLocations(place, backdrop, ids, catalog = {}) {
  const entry = catalog[place];
  if (!entry) return {};
  const variant = entry.backdrops?.[backdrop.replace(/^\.\//, "")];
  const spots = variant?.spots || entry.spots;
  const avatars = variant?.avatars || entry.avatars || {};
  if (!Array.isArray(spots) || spots.length < ids.length) return {};
  const available = new Set(spots.map((_, index) => index));
  const result = {};
  const sorted = [...ids].sort();
  for (const id of sorted) {
    const index = avatars[id];
    if (Number.isInteger(index) && available.has(index)) {
      result[id] = spots[index];
      available.delete(index);
    }
  }
  for (const id of sorted) {
    if (result[id]) continue;
    const index = available.values().next().value;
    result[id] = spots[index];
    available.delete(index);
  }
  return Object.values(result).every(
    (spot) => Array.isArray(spot) && spot.length === 3 &&
      spot.every(Number.isFinite) && spot[0] >= 0 && spot[0] <= 100 &&
      spot[1] >= 0 && spot[1] <= 100 && spot[2] > 0,
  ) ? result : {};
}
