// Existing card frames form a tree of open stacks. References have their own
// IDs and keep their source entity in canonicalId; layout follows holder only.
export function cardTreeLayout(cards, { expanded = [], active = null } = {}) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const children = new Map();
  for (const card of cards) {
    const parent = byId.has(card.holder) ? card.holder : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(card);
  }
  const open = new Set(expanded),
    path = [],
    seen = new Set();
  let parent = open.has(active) ? active : byId.get(active)?.holder;
  while (byId.has(parent) && !seen.has(parent)) {
    seen.add(parent);
    path.unshift(parent);
    parent = byId.get(parent).holder;
  }
  const phoneParent = path.at(-1) ?? null;
  const siblings = children.get(phoneParent) ?? [];
  let column = 1;
  const nodes = [],
    visited = new Set();
  function visit(card, depth) {
    if (visited.has(card.id)) return;
    visited.add(card.id);
    const start = column;
    const held = open.has(card.id) ? (children.get(card.id) ?? []) : [];
    for (const child of held) visit(child, depth + 1);
    if (column === start) column++;
    const ancestor = path.indexOf(card.id),
      sibling = siblings.indexOf(card);
    nodes.push({
      id: card.id,
      depth,
      column: start,
      span: column - start,
      ancestor: ancestor >= 0,
      phone: ancestor >= 0 || sibling >= 0,
      phoneRow:
        ancestor >= 0
          ? Math.floor(ancestor / 4) + 1
          : Math.ceil(path.length / 4) + Math.floor(sibling / 3) + 1,
      phoneColumn:
        ancestor >= 0 ? (ancestor % 4) * 3 + 1 : (sibling % 3) * 4 + 1,
      phoneSpan: ancestor >= 0 ? 3 : 4,
    });
  }
  for (const card of children.get(null) ?? []) visit(card, 0);
  return { nodes, columns: Math.max(1, column - 1) };
}

// The workspace owns frame creation, focus and selection. This function only
// places those same frames; callers can retain their DOM through draft saves.
export function placeCardTree(screen, cards, state) {
  const { nodes, columns } = cardTreeLayout(cards, state);
  const positions = new Map(nodes.map((node) => [node.id, node]));
  screen.dataset.layout = "tree";
  screen.style.setProperty("--tree-columns", columns);
  for (const frame of screen.querySelectorAll(".card-frame")) {
    const node = positions.get(
      frame.querySelector("[data-setting]")?.dataset.setting,
    );
    frame.hidden = !node;
    if (!node) continue;
    frame.dataset.ancestor = String(node.ancestor);
    frame.dataset.phone = String(node.phone);
    for (const [key, value] of Object.entries({
      row: node.depth + 1,
      column: node.column,
      span: node.span,
      "phone-row": node.phoneRow,
      "phone-column": node.phoneColumn,
      "phone-span": node.phoneSpan,
    }))
      frame.style.setProperty(`--tree-${key}`, value);
  }
}
