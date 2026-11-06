import { WORLD, TOOLS } from "./authoring-collections.mjs";
const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
// Tools decorate an existing card or join one of its local stacks.
export function authoringTools(base, tools) {
  const cards = new Map(),
    locations = new Map(),
    byId = new Map(),
    anchors = new Map(),
    selected = [];
  for (const mode of ["world", "tools"])
    for (const card of base[mode]) {
      cards.set(card.id, { ...card });
      locations.set(card.id, { mode, cardId: card.id });
    }
  for (const tool of tools) {
    const id = `designer-tool-${tool.id}`;
    need(
      typeof tool.id === "string" &&
        /^[A-Za-z0-9_-]+$/u.test(tool.id) &&
        !byId.has(id) &&
        !cards.has(id),
      "Use unique tool names.",
    );
    byId.set(id, tool);
    if (tool.anchor) {
      need(
        cards.has(tool.anchor) &&
          locations.has(tool.anchor) &&
          !anchors.has(tool.anchor) &&
          !tool.holder,
        "Anchor one tool to an existing card.",
      );
      anchors.set(tool.anchor, id);
      locations.set(id, locations.get(tool.anchor));
    } else {
      const holder = tool.holder ?? TOOLS;
      need(holder !== WORLD, "Place local tools inside a world category.");
      cards.set(id, {
        id,
        name: tool.name,
        holder,
        role: "tool",
        kind: tool.kind || "box",
        art: tool.art || "assets/card-back.webp",
        state: tool.state,
        group: Boolean(tool.group),
        lit: true,
      });
    }
  }
  function location(id, seen = new Set()) {
    if (locations.has(id)) return locations.get(id);
    const card = cards.get(id);
    need(card && !seen.has(id), "Choose a tool parent without a cycle.");
    seen.add(id);
    const parent = cards.get(card.holder);
    need(parent, "Choose an existing parent card for this tool.");
    parent.group = true;
    const value = { mode: location(parent.id, seen).mode, cardId: id };
    locations.set(id, value);
    return value;
  }
  const result = { world: [], tools: [] };
  for (const card of cards.values()) result[location(card.id).mode].push(card);
  for (const [id, tool] of byId)
    if (tool.selected) selected.push(locations.get(id).cardId);
  return { cards: result, byId, anchors, locations, selected };
}
