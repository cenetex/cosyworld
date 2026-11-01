// A player holds no quest until it first reaches the Black Pond. Tests about
// later play start as if that had happened, with Vale's authored lamp want.
export function questing(s) {
  const vale = s.actors.vale;
  if (!vale.visited.includes("pond")) vale.visited = [...vale.visited, "pond"];
  vale.want ??= { kind: "item", target: "lamp", since: s.turn, refusals: 0 };
  return s;
}
