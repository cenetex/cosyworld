import {
  localRoadEnds,
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
  // The Athens Harbor lane needs the olive branch aboard, so Athens is
  // walked by the Athens–Piraeus Road.
  if (from === "greek-harbor" && to === "greek-athens")
    return ["greek-ship", "greek-piraeus", "greek-road-athens-piraeus", to];
  if (from === "greek-athens" && to === "greek-harbor")
    return ["greek-road-athens-piraeus", "greek-piraeus", "greek-ship", to];
  return walk(from, to) || [to];
}

// The shortest walk over the pack's live exits, skipping retired roads.
function walk(from, to) {
  const queue = [[from]],
    seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift(),
      here = path.at(-1);
    if (here === to) return path.slice(1);
    for (const next of packPlaces[here]?.exits || [])
      if (!seen.has(next) && !localRoadEnds(next)) {
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
