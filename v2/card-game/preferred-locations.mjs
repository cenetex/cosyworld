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
    (spot) =>
      Array.isArray(spot) &&
      spot.length === 3 &&
      spot.every(Number.isFinite) &&
      spot[0] >= 0 &&
      spot[0] <= 100 &&
      spot[1] >= 0 &&
      spot[1] <= 100 &&
      spot[2] > 0,
  )
    ? result
    : {};
}

// Project a point through the same cropped image box used by the stage.
// Keep it on the visible stage when a narrow screen crops the painting.
export function projectPaintedSpot([x, y], art, cast, stage, floor) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const left = clamp(
    art.left + (art.width * x) / 100,
    stage.left + 12,
    stage.right - 12,
  );
  const bottom = clamp(art.top + (art.height * y) / 100, stage.top + 12, floor);
  return { left: left - cast.left, bottom: cast.bottom - bottom };
}
