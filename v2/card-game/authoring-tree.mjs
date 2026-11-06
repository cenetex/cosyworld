// A card view of authored sources. Source paths belong to the edit reducer;
// holders below describe this view, while authored custody stays in the pack.
const BOX = "assets/card-back.webp";
const LOCK = "assets/card-back-locked.webp";
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const words = (key) => String(key).replaceAll(/[_-]/g, " ");
const referenceKeys = new Set([
  "actor",
  "subject",
  "target",
  "item",
  "items",
  "place",
  "from",
  "to",
  "at",
  "home",
  "holder",
  "by",
  "with",
  "arrive",
  "docks",
  "dock",
  "transport",
  "shipmaster",
  "consumes",
  "exits",
]);
const lockedKeys = new Set([
  "requires",
  "opensWith",
  "want",
  "locked",
  "sealed",
]);

// Hex code points keep even unfinished names safe in attribute selectors.
export const authoringCardId = (source, role = "card") =>
  "author-" +
  Array.from(JSON.stringify([role, ...source]), (c) =>
    c.codePointAt(0).toString(16),
  ).join("-");

export function buildAuthoringTree({ pack, bridge } = {}) {
  pack = record(pack) ? pack : {};
  const cards = [],
    canonical = new Map(),
    boxes = new Map();
  const add = (source, role, name, holder, more = {}) => {
    const card = {
      id: authoringCardId(source, role),
      name,
      art: BOX,
      lit: true,
      state: "",
      kind: "box",
      holder,
      source: [...source],
      ...more,
    };
    cards.push(card);
    return card;
  };
  const root = add(["pack"], "root", pack.name || "World", null);
  const elsewhere = () => {
    let box = boxes.get(null);
    if (!box) {
      box = add(["pack"], "elsewhere", "Elsewhere", root.id);
      boxes.set(null, box);
    }
    return box;
  };
  for (const [collection, kind] of [
    ["places", "place"],
    ["avatars", "avatar"],
    ["items", "item"],
  ]) {
    for (const [id, value] of Object.entries(pack[collection] || {})) {
      if (!record(value)) continue;
      const source = ["pack", collection, id];
      const card = add(source, "entity", value.name || id, root.id, {
        kind,
        canonicalId: id,
        art: value.art || value.portrait || value.backdrop || BOX,
        state: value.text || "",
      });
      canonical.set(id, card);
      if (kind !== "item")
        boxes.set(id, add(source, "contents", "Contents", card.id));
    }
  }
  const link = (source, target, holder) => {
    const found = canonical.get(target);
    return add(source, "link", found?.name || target, holder, {
      kind: "link",
      canonicalId: target,
      ref: found?.id || null,
      art: found?.art || BOX,
      state: found ? "" : "Outside this world",
    });
  };
  const visit = (value, source, holder, name, key = source.at(-1)) => {
    if (typeof value === "string" && referenceKeys.has(key))
      return link(source, value, holder);
    const nested = value !== null && typeof value === "object";
    const card = add(source, "field", name, holder, {
      art: lockedKeys.has(key) ? LOCK : BOX,
      state: nested ? "" : String(value),
      ...(!nested ? { value } : {}),
    });
    if (nested)
      for (const [part, child] of Object.entries(value)) {
        const index = Array.isArray(value) ? Number(part) : part;
        const title = record(child) ? child.label || child.kind : null;
        visit(
          child,
          [...source, index],
          card.id,
          title ? words(title) : words(part),
          Array.isArray(value) ? key : part,
        );
      }
    return card;
  };
  for (const card of canonical.values()) {
    const value = pack[card.source[1]][card.canonicalId];
    if (card.kind !== "place") {
      const holder = card.kind === "avatar" ? value.place : value.holder;
      const owner = canonical.get(holder);
      const local =
        owner?.kind === "place" ||
        (card.kind === "item" && owner?.kind === "avatar");
      card.holder = (local ? boxes.get(holder) : elsewhere()).id;
      // The source holder also remains visible when its card lives elsewhere.
      if (!local && typeof holder === "string")
        link(
          [...card.source, card.kind === "avatar" ? "place" : "holder"],
          holder,
          card.id,
        );
    }
    for (const key of ["requires", "appearsWhen", "want", "locked", "journey"])
      if (value[key] !== undefined)
        visit(value[key], [...card.source, key], card.id, words(key));
    if (card.kind === "place")
      for (const [i, target] of (value.exits || []).entries())
        link(
          [...card.source, "exits", i],
          target,
          boxes.get(card.canonicalId).id,
        );
  }
  for (const [i, route] of (pack.routes || []).entries())
    visit(
      route,
      ["pack", "routes", i],
      (boxes.get(route?.from) || elsewhere()).id,
      "Road",
    );
  if (pack.choices !== undefined)
    visit(pack.choices, ["pack", "choices"], root.id, "Quests");
  for (const key of ["entries", "crossings", "transports"])
    if (record(bridge) && bridge[key] !== undefined)
      visit(bridge[key], ["bridge", key], root.id, words(key));
  const children = Object.fromEntries(cards.map((c) => [c.id, []]));
  for (const card of cards)
    if (card.holder !== null) children[card.holder].push(card.id);
  for (const card of cards) card.group = children[card.id].length > 0;
  return { cards, roots: [root.id], children };
}
