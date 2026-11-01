import {
  localRoadEnds,
  packDefinition,
  packPlaces,
} from "../../v2/card-game/pack-registry.mjs";

// Expand a named journey into the actual cards played along its road or ship.
export function greekTravelTargets(from, to) {
  if (packPlaces[from]?.exits.includes(to)) return [to];
  // Black Pond sails only to the Wine-Dark Harbor. The opening fixture's
  // traveller carries the Travel Provisions aboard, which open the lane to
  // Piraeus.
  if (from === "greek-harbor" && to === "greek-piraeus")
    return ["greek-ship", to];
  // From Piraeus an idle ship sails its first lane, to the Wine-Dark Harbor.
  if (from === "greek-piraeus" && to === "greek-harbor")
    return ["greek-ship", to];
  // Athens is walked from Piraeus along the Long Walls.
  if (from === "greek-harbor" && to === "greek-athens")
    return ["greek-ship", "greek-piraeus", "greek-road-athens-piraeus", to];
  if (from === "greek-athens" && to === "greek-harbor")
    return ["greek-road-athens-piraeus", "greek-piraeus", "greek-ship", to];
  return walk(from, to) || [to];
}

// The shortest walk over the pack's live exits and gated routes, skipping
// retired roads and places. A gate's live condition decides at play time.
const routes = packDefinition("greek-drama").routes;
const nextPlaces = (here) => [
  ...(packPlaces[here]?.exits || []),
  ...routes.filter((r) => r.from === here).map((r) => r.to),
];
function walk(from, to) {
  const queue = [[from]],
    seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift(),
      here = path.at(-1);
    if (here === to) return path.slice(1);
    for (const next of nextPlaces(here))
      if (
        !seen.has(next) &&
        !localRoadEnds(next) &&
        !packPlaces[next]?.retired
      ) {
        seen.add(next);
        queue.push([...path, next]);
      }
  }
  return null;
}

export function greekMoveSteps(start) {
  let here = start;
  return (...ids) =>
    ids.flatMap((id) => {
      const target = `greek-${id}`;
      const steps = greekTravelTargets(here, target).map((to) => ({
        kind: "move",
        target: to,
      }));
      here = target;
      return steps;
    });
}
