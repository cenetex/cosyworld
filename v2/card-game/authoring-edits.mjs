// Commands patch the authored source. Preview state and server revisions stay
// with their own owners. A command can be applied once, then undone exactly.
const own = (value, key) => value != null && Object.hasOwn(value, key);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function jsonCopy(value) {
  const text = JSON.stringify(value, (_key, child) => {
    need(
      child !== undefined &&
        typeof child !== "function" &&
        typeof child !== "symbol" &&
        (typeof child !== "number" || Number.isFinite(child)),
      "Use JSON values in a source edit.",
    );
    return child;
  });
  return JSON.parse(text);
}
const need = (ok, text) => {
  if (!ok) throw new Error(text);
};
function pathOk(path) {
  return (
    Array.isArray(path) &&
    (path.length >= 2 || (path.length === 1 && path[0] === "launch")) &&
    path.length <= 64 &&
    ["pack", "bridge", "launch"].includes(path[0]) &&
    path.every(
      (part) =>
        (typeof part === "string" &&
          !["__proto__", "prototype", "constructor"].includes(part)) ||
        (Number.isSafeInteger(part) && part >= 0),
    )
  );
}
function get(source, path) {
  return path.reduce(
    (value, key) => (own(value, key) ? value[key] : undefined),
    source,
  );
}
function replace(source, path, exists, value) {
  const [key, ...rest] = path;
  need(
    source && typeof source === "object",
    "Choose a source field in this draft.",
  );
  if (Array.isArray(source))
    need(
      Number.isInteger(key) && key >= 0 && key < source.length,
      "Choose an existing array entry.",
    );
  const next = Array.isArray(source) ? [...source] : { ...source };
  if (rest.length) {
    need(own(source, key), "This source path changed. Choose the card again.");
    next[key] = replace(source[key], rest, exists, value);
  } else if (exists) next[key] = structuredClone(value);
  else delete next[key];
  return next;
}

export function applySourceEdit(source, edit) {
  need(
    Array.isArray(edit.changes) && edit.changes.length <= 64,
    "Use a bounded source edit.",
  );
  let next = source;
  const inverse = [];
  for (const change of edit.changes) {
    const { path, before, after } = change;
    need(pathOk(path), "Choose a pack, bridge or launch field.");
    const parent = get(next, path.slice(0, -1));
    const exists = own(parent, path.at(-1));
    need(
      exists === before.exists &&
        (!exists || equal(parent[path.at(-1)], before.value)),
      "This card changed. Review the current version before applying the edit.",
    );
    next = replace(next, path, after.exists, after.value);
    inverse.unshift({
      path: [...path],
      before: structuredClone(after),
      after: structuredClone(before),
    });
  }
  return {
    source: next,
    undo: { label: `Undo ${edit.label}`, changes: inverse },
  };
}

export function sourceEdit(source, label, updates) {
  need(
    Array.isArray(updates) && updates.length <= 64,
    "Use up to 64 changes in one edit.",
  );
  const changes = [];
  let current = source;
  for (const update of updates) {
    let { path, value, remove = false } = update;
    need(pathOk(path), "Choose a pack, bridge or launch field.");
    if (remove) {
      // Replacing the parent preserves object key order and dense arrays on Undo.
      value = structuredClone(get(current, path.slice(0, -1)));
      need(
        own(value, path.at(-1)),
        "Choose an existing source field to remove.",
      );
      if (Array.isArray(value)) value.splice(path.at(-1), 1);
      else delete value[path.at(-1)];
      path = path.slice(0, -1);
      need(pathOk(path), "Keep the pack and bridge source records.");
    }
    const parent = get(current, path.slice(0, -1));
    const before = { exists: own(parent, path.at(-1)) };
    if (before.exists) before.value = structuredClone(parent[path.at(-1)]);
    const after = { exists: true, value: jsonCopy(value) };
    const change = { path: [...path], before, after };
    current = applySourceEdit(current, { label, changes: [change] }).source;
    changes.push(change);
  }
  return { label, changes };
}

const entity = (source, kind, id) => {
  const value = source.pack?.[kind]?.[id];
  need(value && typeof value === "object", "Choose a card in this pack.");
  return value;
};
const transportPlace = (source, id) =>
  Object.values(source.bridge?.transports || {}).some(
    (ship) => ship.place === id,
  );

export function moveCard(source, kind, id, holder) {
  need(
    ["avatars", "items"].includes(kind),
    "Choose an avatar or item to place.",
  );
  const card = entity(source, kind, id);
  const place = own(source.pack?.places, holder);
  need(
    place || (kind === "items" && own(source.pack?.avatars, holder)),
    "Choose a location, or an avatar for this item.",
  );
  if (kind === "items" && (card.regrow || card.startsUsed || card.locked))
    need(place, "This item's starting rules need a location.");
  return sourceEdit(source, `Place ${card.name}`, [
    {
      path: ["pack", kind, id, kind === "avatars" ? "place" : "holder"],
      value: holder,
    },
  ]);
}

export function linkPlaces(source, from, to, { oneWay = false } = {}) {
  need(from !== to, "Choose two different locations.");
  const a = entity(source, "places", from),
    b = entity(source, "places", to);
  need(
    !transportPlace(source, from) && !transportPlace(source, to),
    "Use the ship's dock and lane cards for this connection.",
  );
  const pairs = oneWay
    ? [[from, to]]
    : [
        [from, to],
        [to, from],
      ];
  for (const [start, end] of pairs)
    need(
      !(source.pack.routes || []).some(
        (route) => route.from === start && route.to === end,
      ),
      "Open this route's quest card to edit its connection.",
    );
  return sourceEdit(
    source,
    `Link ${a.name} and ${b.name}`,
    pairs.map(([start, end]) => ({
      path: ["pack", "places", start, "exits"],
      value: [...new Set([...(source.pack.places[start].exits || []), end])],
    })),
  );
}

export function setStarterQuest(source, avatar, kind, target) {
  const owner = entity(source, "avatars", avatar);
  const collection = { item: "items", place: "places", person: "avatars" }[
    kind
  ];
  need(collection, "Choose an item, place or person for this quest.");
  entity(source, collection, target);
  need(
    kind !== "person" || target !== avatar,
    "Choose another person for this quest.",
  );
  return sourceEdit(source, `Set ${owner.name}'s starting quest`, [
    {
      path: ["pack", "avatars", avatar, "want"],
      value: { kind, target },
    },
  ]);
}

export function setStartingPlace(source, place) {
  entity(source, "places", place);
  return sourceEdit(source, "Set starting place", [
    {
      path: ["launch"],
      value: { schemaVersion: 1, place },
    },
  ]);
}
