// Lane facts and the ships that tell them, split out of world.mjs (#1390).
import {
  transports,
  entityActive,
  packDefinitions,
} from "../pack-registry.mjs";
import {
  laneEdges,
  laneOfEdge,
  knowsLane,
  laneConditions,
} from "../pack-transport.mjs";
import { nameOf } from "./catalog.mjs";

export const atPort = (s, actor) =>
  Object.values(transports).some(
    (t) =>
      t.place === s.actors[actor].place ||
      t.docks.includes(s.actors[actor].place),
  );
// A lane the speaker knows and the listener does not, nearest first.
export function laneToTell(s, speaker, listener) {
  const here = s.actors[speaker].place;
  const ship = Object.entries(transports).find(([, t]) => t.place === here);
  const near = ship ? s.transports[ship[0]].dock : here;
  const lanes = laneEdges()
    .map(laneOfEdge)
    .filter(
      ([from, to]) =>
        entityActive(s, from) &&
        entityActive(s, to) &&
        knowsLane(s, speaker, from, to) &&
        !knowsLane(s, listener, from, to),
    )
    .sort(
      ([a, b], [c, d]) =>
        Number(c === near || d === near) - Number(a === near || b === near),
    );
  return lanes.length ? laneFact(...lanes[0]) : null;
}
// Talk context: the lanes a person at a port knows from it. Narration only.
export function laneTalkFacts(s, actor) {
  if (!s.actors[actor] || !atPort(s, actor)) return [];
  const here = s.actors[actor].place;
  const ship = Object.entries(transports).find(([, t]) => t.place === here);
  const near = ship ? s.transports[ship[0]].dock : here;
  const known = laneEdges()
    .map(laneOfEdge)
    .filter(
      ([from, to]) =>
        from === near && entityActive(s, to) && knowsLane(s, actor, from, to),
    )
    .map(([, to]) => nameOf(to));
  return known.length
    ? [`I know ships sail from ${nameOf(near)} to ${known.join(" and ")}.`]
    : [`I know of no ship lane from ${nameOf(near)}.`];
}
// A gated lane is told with its condition; telling it never opens it. A
// named thing is told by name; a world's things as "something from there",
// or by the world's short name when it is one of several choices.
const worldName = (pack) =>
  packDefinitions.find((p) => p.id === pack)?.name.split(":")[0] ?? "there";
const needOf = (c, choice = false) =>
  c.kind === "any"
    ? [...new Set(c.conditions.map((r) => needOf(r, true)))].join(" or ")
    : c.item
      ? nameOf(c.item)
      : choice && c.pack
        ? `something from ${worldName(c.pack)}`
        : "something from there";
const laneNeed = (gate) =>
  [...new Set(gate.map((c) => needOf(c)))].join(" and ");
export const laneFact = (from, to) => {
  const gate = laneConditions(from, to);
  return {
    id: `lane:${from}>${to}`,
    text: gate
      ? `Ships for ${nameOf(to)} leave from ${nameOf(from)} only with ${laneNeed(gate)} aboard.`
      : `Ships for ${nameOf(to)} leave from ${nameOf(from)}.`,
  };
};
export const laneFactText = (id) => {
  const [from, to] = id.startsWith("lane:") ? id.slice(5).split(">") : [];
  return from &&
    to &&
    laneEdges().some(([a, b]) => a === `sea:${from}` && b === `sea:${to}`)
    ? laneFact(from, to).text
    : null;
};
