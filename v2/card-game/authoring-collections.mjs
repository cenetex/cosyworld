import { authoringCardId } from "./authoring-tree.mjs";
import { residentPortrait } from "./resident-portrait.mjs";

export const WORLD = authoringCardId(["pack"], "root");
export const TOOLS = authoringCardId(["pack"], "tools");
const DETAILS = authoringCardId(["pack"], "details");
const groups = { items: "Items", avatars: "Avatars", places: "Locations" };
const groupId = (name) => authoringCardId(["pack", name], "collection");
const box = (id, name, holder) => ({
  id,
  name,
  holder,
  kind: "box",
  role: "navigation",
  group: true,
  art: "assets/card-back.webp",
  lit: true,
});

// Source paths and canonical IDs remain the edit model's identities. Custody
// references lead back to those entities from their physical Contents boxes.
export function authoringCollections(cards, { pack, launch } = {}) {
  const rootArt = pack?.places?.[launch?.place || pack?.entry];
  const projected = [
    box(TOOLS, "Tools", null),
    box(DETAILS, "World details", TOOLS),
  ];
  for (const [name, label] of Object.entries(groups))
    projected.push(box(groupId(name), label, WORLD));
  const entities = new Set(
    cards.filter((c) => c.role === "entity").map((c) => c.id),
  );
  const common = new Set(["name", "text", "art", "portrait", "backdrop"]);
  const details = new Set();
  for (const original of cards) {
    const card = { ...original, sourceHolder: original.holder };
    if (card.id === WORLD) {
      card.name = "World";
      card.role = "navigation";
      card.state = pack?.name || "Your world";
      card.art = rootArt?.art || rootArt?.backdrop || card.art;
    } else if (card.role === "entity") {
      card.holder = groupId(card.source[1]);
      if (card.kind === "avatar") {
        const avatar = pack.avatars[card.canonicalId];
        card.art =
          residentPortrait(
            avatar,
            avatar.variants?.[avatar.temperament?.asleep ? "asleep" : "awake"],
          ) || card.art;
      }
      if (original.holder !== WORLD)
        projected.push({
          ...card,
          id: `${card.id}-contents`,
          holder: original.holder,
          role: "reference",
          ref: card.id,
          group: false,
        });
    } else if (card.holder === WORLD) card.holder = DETAILS;
    else if (card.role === "field" && entities.has(card.holder)) {
      if (!common.has(card.source.at(-1))) {
        details.add(card.holder);
        card.holder += "-details";
      } else if (card.source.at(-1) === "text") card.name = "Description";
    }
    projected.push(card);
  }
  for (const id of details) projected.push(box(`${id}-details`, "Details", id));
  const byId = new Map(projected.map((card) => [card.id, card]));
  // Links use the same resolved portrait as their canonical entity.
  for (const card of projected)
    if (card.ref && byId.has(card.ref)) card.art = byId.get(card.ref).art;
  const children = new Map();
  for (const card of projected) {
    if (!children.has(card.holder)) children.set(card.holder, []);
    children.get(card.holder).push(card);
  }
  const branch = (id) => {
    const result = [],
      pending = [byId.get(id)];
    while (pending.length) {
      const card = pending.pop();
      result.push(card);
      pending.push(...(children.get(card.id) || []).toReversed());
    }
    return result;
  };
  return { world: branch(WORLD), tools: branch(TOOLS) };
}
