// Later-play tests start with Vale holding the lamp quest from the Black Pond.
export function questing(s) {
  const vale = s.actors.vale;
  if (!vale.visited.includes("pond")) vale.visited = [...vale.visited, "pond"];
  vale.want ??= { kind: "item", target: "lamp", since: s.turn, refusals: 0 };
  return s;
}
