import forest from "./forest.json" with { type: "json" };
import {
  packDefinitions,
  packPeople,
  packPlaces,
  crossings,
  transports,
  roamingQuestActor,
} from "./pack-registry.mjs";
export const roamingActors = Object.keys(packPeople).filter(roamingQuestActor);
export const authoredRouteEdges = () => [
  ...Object.entries({ ...forest.places, ...packPlaces }).flatMap(([from, p]) =>
    p.exits.map((to) => [from, to]),
  ),
  ...(forest.reflectionRoutes || []).map(({ from, to }) => [from, to]),
  ...packDefinitions.flatMap((p) =>
    (p.routes || []).map((r) => [r.from, r.to]),
  ),
  ...crossings.flatMap((c) =>
    c.transport
      ? [
          [c.from, transports[c.transport].place],
          [transports[c.transport].place, c.to],
        ]
      : [[c.from, c.to]],
  ),
];
export function initialRouteEdges(actor) {
  const home = packPeople[actor]?.packId;
  return authoredRouteEdges().filter(([from, to]) =>
    home
      ? packPlaces[from]?.packId === home
      : !packPlaces[from] && !packPlaces[to],
  );
}
export const visibleRouteEdges = (place) =>
  authoredRouteEdges().filter(([from]) => from === place);
export const witnessedRouteEdges = (world, actor) =>
  world.log
    .filter(
      (e) =>
        e.verb === "move" &&
        (e.actorId === actor || e.witnesses?.includes(actor)) &&
        e.fromLocationId &&
        e.locationId &&
        authoredRouteEdges().some(
          ([from, to]) => from === e.fromLocationId && to === e.locationId,
        ),
    )
    .map((e) => [e.fromLocationId, e.locationId]);
