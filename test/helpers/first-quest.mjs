// A player holds no quest until it takes one by a tap. Tests about later play
// start as if Vale had taken the lamp quest at the Black Pond.
export function questing(s) {
  const vale = s.actors.vale;
  if (!vale.visited.includes("pond")) vale.visited = [...vale.visited, "pond"];
  vale.want ??= { kind: "item", target: "lamp", since: s.turn, refusals: 0 };
  return s;
}
