// A card view of authored sources. Source paths belong to the edit reducer;
// holders below describe this view, while authored custody stays in the pack.
const BOX = "assets/card-back.webp";
const LOCK = "assets/card-back-locked.webp";
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const labels = {
  requires: "Conditions",
  opensWith: "Conditions",
  effects: "Rewards",
  conditions: "Conditions",
  any: "Any of these",
  not: "Except",
  want: "Starting quest",
  appearsWhen: "Appears when",
  set_flag: "Set flag",
  retire_item: "Use item",
};
const words = (key) =>
  Object.hasOwn(labels, key)
    ? labels[key]
    : String(key)
        .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll(/[_-]/g, " ");
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
  "entry",
]);
const questFields = ["requires", "appearsWhen", "want", "locked", "journey"];
const placementFields = { place: "exits", avatar: "place", item: "holder" };
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
    boxes = new Map(),
    quests = new Map();
  const add = (source, role, name, holder, more = {}) => {
    const card = {
      id: authoringCardId(source, role),
      name,
      art: BOX,
      lit: true,
      state: "",
      kind: "box",
      role,
      holder,
      source: [...source],
      ...more,
    };
    cards.push(card);
    return card;
  };
  const root = add(["pack"], "root", pack.name || "World", null);
  const rootQuests = add(["pack"], "quests", "Quests", root.id, { art: LOCK });
  const elsewhere = () => {
    let box = boxes.get(null);
    if (!box) {
      box = add(["pack"], "elsewhere", "Elsewhere", root.id, {
        role: "contents",
      });
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
      if (kind !== "item") {
        boxes.set(id, add(source, "contents", "Contents", card.id));
        quests.set(id, add(source, "quests", "Quests", card.id, { art: LOCK }));
      }
    }
  }
  const link = (source, target, holder, identity = "link") => {
    const found = canonical.get(target);
    return add(source, identity, found?.name || target, holder, {
      kind: "link",
      role: "link",
      canonicalId: target,
      ref: found?.id || null,
      art: found?.art || BOX,
      state: found ? "" : "Referenced card",
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
    for (const key of questFields)
      if (value[key] !== undefined)
        visit(
          value[key],
          [...card.source, key],
          quests.get(card.canonicalId)?.id || card.id,
          key === "requires" ? "Appears when" : words(key),
        );
    for (const [key, child] of Object.entries(value))
      if (!questFields.includes(key) && key !== placementFields[card.kind])
        visit(child, [...card.source, key], card.id, words(key));
    if (card.kind === "place")
      for (const [i, target] of list(value.exits).entries())
        link(
          [...card.source, "exits", i],
          target,
          boxes.get(card.canonicalId).id,
        );
  }
  for (const [i, route] of list(pack.routes).entries()) {
    visit(
      route,
      ["pack", "routes", i],
      (quests.get(route?.to) || rootQuests).id,
      "Opening quest",
    );
    if (typeof route?.to === "string")
      link(
        ["pack", "routes", i, "to"],
        route.to,
        (boxes.get(route.from) || elsewhere()).id,
        "road",
      );
  }
  for (const [i, choice] of list(pack.choices).entries())
    visit(
      choice,
      ["pack", "choices", i],
      rootQuests.id,
      choice?.label || "Quest",
    );
  for (const [key, value] of Object.entries(pack))
    if (!["places", "avatars", "items", "routes", "choices"].includes(key))
      visit(value, ["pack", key], root.id, words(key));
  for (const key of ["entries", "crossings", "transports"])
    if (record(bridge) && bridge[key] !== undefined)
      visit(bridge[key], ["bridge", key], root.id, words(key));
  const children = Object.fromEntries(cards.map((c) => [c.id, []]));
  for (const card of cards)
    if (card.holder !== null) children[card.holder].push(card.id);
  for (const card of cards)
    card.group =
      children[card.id].length > 0 ||
      ["contents", "quests"].includes(card.role);
  return { cards, roots: [root.id], children };
}
