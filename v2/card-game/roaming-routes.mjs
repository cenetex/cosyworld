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
          [transports[c.transport].place, c.from],
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

// Each traveller learns routes from its home region, its own travel and what
// it sees. A saved edge is knowledge; the live exit guard decides access.
const edgeKey = ([from, to]) => `${from}>${to}`;
export function rememberRoutes(world, actor, edges) {
  const knowledge = (world.routeKnowledge ??= {});
  const known = new Map(
    (knowledge[actor] || []).map((edge) => [edgeKey(edge), edge]),
  );
  for (const edge of edges) known.set(edgeKey(edge), [...edge]);
  knowledge[actor] = [...known.values()].sort((a, b) =>
    edgeKey(a).localeCompare(edgeKey(b)),
  );
}
export function knownRoute(world, actor, from, to, allowed = () => true) {
  const queue = [[from]],
    seen = new Set([from]);
  const edges = world.routeKnowledge?.[actor] || [];
  while (queue.length) {
    const path = queue.shift(),
      here = path.at(-1);
    if (here === to) return path;
    for (const [start, end] of edges) {
      if (start !== here || seen.has(end) || !allowed(start, end, path.at(-2)))
        continue;
      seen.add(end);
      queue.push([...path, end]);
    }
  }
  return null;
}
export function validRouteKnowledge(world, edges) {
  if (!world.routeKnowledge || typeof world.routeKnowledge !== "object")
    return false;
  const allowed = new Set(edges.map(edgeKey));
  return Object.entries(world.routeKnowledge).every(
    ([actor, known]) =>
      world.actors[actor] &&
      Array.isArray(known) &&
      known.length <= allowed.size &&
      new Set(known.map(edgeKey)).size === known.length &&
      known.every(
        (edge) =>
          Array.isArray(edge) && edge.length === 2 && allowed.has(edgeKey(edge)),
      ),
  );
}
