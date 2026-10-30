import { packPlaces } from "../../v2/card-game/pack-registry.mjs";

// Expand a named journey into the actual cards played along its road or ship.
export function greekTravelTargets(from, to) {
  if (packPlaces[from]?.exits.includes(to)) return [to];
  // A traveller from the shore knows the Black Pond lanes, so the sea way
  // between the Wine-Dark Harbor and Piraeus passes Athens Harbor.
  if (from === "greek-harbor" && to === "greek-piraeus")
    return [
      "greek-ship",
      "greek-athens-harbor",
      "greek-athens",
      "greek-road-athens-piraeus",
      to,
    ];
  // From Piraeus an idle ship sails its first lane, to the Wine-Dark Harbor.
  if (from === "greek-piraeus" && to === "greek-harbor")
    return ["greek-ship", to];
  if (from === "greek-harbor" && to === "greek-athens")
    return ["greek-ship", "greek-athens-harbor", to];
  if (from === "greek-athens" && to === "greek-harbor")
    return ["greek-athens-harbor", "greek-ship", to];
  const road = packPlaces[from]?.exits.find((id) =>
    packPlaces[id]?.road?.includes(to),
  );
  return road ? [road, to] : [to];
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
