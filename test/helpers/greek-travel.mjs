import { packPlaces } from "../../v2/card-game/pack-registry.mjs";

// Expand a named journey into the actual cards played along its road or ship.
export function greekTravelTargets(from, to) {
  if (
    [from, to].includes("greek-harbor") &&
    [from, to].includes("greek-piraeus")
  )
    return ["greek-ship", to];
  if (from === "greek-harbor" && to === "greek-athens")
    return [
      "greek-ship",
      "greek-athens-harbor",
      "greek-road-athens-harbor",
      to,
    ];
  if (from === "greek-athens" && to === "greek-harbor")
    return [
      "greek-road-athens-harbor",
      "greek-athens-harbor",
      "greek-ship",
      to,
    ];
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
