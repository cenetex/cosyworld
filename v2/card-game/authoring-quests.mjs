import { sourceEdit } from "./authoring-edits.mjs";
import { laneProblems } from "./pack-schema.mjs";

const need = (ok, text) => {
  if (!ok) throw new Error(text);
};
const own = (value, key) => value && Object.hasOwn(value, key);
const place = (source, id) => {
  need(own(source.pack?.places, id), "Choose a location in this pack.");
  need(
    !Object.values(source.bridge?.transports || {}).some((t) => t.place === id),
    "Open the ship's dock and lane cards for this quest.",
  );
  return source.pack.places[id];
};
const requirements = (value, max = 12) => {
  need(
    Array.isArray(value) &&
      value.length <= max &&
      value.every(
        (c) => c && typeof c === "object" && typeof c.kind === "string",
      ),
    `Use up to ${max} condition cards.`,
  );
  return structuredClone(value);
};
const removeWalk = (source, from, to) => {
  const exits = source.pack.places[from].exits || [];
  return exits.includes(to)
    ? [
        {
          path: ["pack", "places", from, "exits"],
          value: exits.filter((id) => id !== to),
        },
      ]
    : [];
};

// A locked destination opens from the chosen approach when its item arrives.
// The direct walk and the new gate change together; the return path stays as authored.
export function addItemOpening(
  source,
  { from, to, item, carried = true, live = false },
) {
  const a = place(source, from),
    b = place(source, to);
  need(from !== to, "Choose two different locations.");
  need(own(source.pack?.items, item), "Choose an item in this pack.");
  need(
    typeof carried === "boolean" && typeof live === "boolean",
    "Choose how this quest opens.",
  );
  const routes = source.pack.routes || [];
  need(
    !routes.some((r) => r.from === from && r.to === to),
    "Choose the existing opening quest to edit this approach.",
  );
  const route = {
    from,
    to,
    requires: [
      { kind: carried ? "item_present" : "item_at", item, place: from },
    ],
    ...(live ? { live: true } : {}),
  };
  return sourceEdit(source, `Open ${b.name || to} from ${a.name || from}`, [
    ...removeWalk(source, from, to),
    { path: ["pack", "routes"], value: [...routes, route] },
  ]);
}

// Each parallel approach keeps its own array index, sealed quest and order.
export function changeOpeningRequirements(source, index, conditions) {
  const route = source.pack?.routes?.[index];
  need(
    Number.isInteger(index) && index >= 0 && route,
    "Choose an opening quest.",
  );
  place(source, route.from);
  place(source, route.to);
  const requires = requirements(conditions);
  return sourceEdit(source, "Change opening conditions", [
    ...(requires.length ? removeWalk(source, route.from, route.to) : []),
    { path: ["pack", "routes", index, "requires"], value: requires },
  ]);
}

// Lane conditions keep their cargo semantics and a free way to the home dock.
export function changeLaneRequirements(source, ship, index, conditions) {
  const transport =
    own(source.bridge?.transports, ship) && source.bridge.transports[ship];
  need(
    transport &&
      Number.isInteger(index) &&
      index >= 0 &&
      transport.lanes?.[index],
    "Choose a ship lane.",
  );
  const lanes = structuredClone(transport.lanes),
    requires = requirements(conditions, 4);
  if (requires.length) lanes[index].opensWith = requires;
  else delete lanes[index].opensWith;
  const problems = laneProblems({ ...transport, lanes });
  need(problems.length === 0, problems[0]);
  const home = new Set([transport.at]);
  for (const dock of home)
    for (const lane of lanes) {
      if (lane.opensWith?.length || lane.spends?.length) continue;
      if (lane.to === dock) home.add(lane.from);
      if (!lane.oneWay && lane.from === dock) home.add(lane.to);
    }
  need(
    transport.docks.every((dock) => home.has(dock)),
    "Keep a free voyage home from every dock.",
  );
  return sourceEdit(source, "Change voyage conditions", [
    { path: ["bridge", "transports", ship, "lanes"], value: lanes },
  ]);
}
