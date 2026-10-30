import { legalActions, play } from "../../v2/card-game/world.mjs";

const wait = (world) =>
  play(
    world,
    legalActions(world).find((a) => a.kind === "wait"),
  ).state;

// The current avatar chooses Wait, the only play that turns them inward.
// With `dream`, two earlier thoughts have settled since any dream, so the
// Wait is due a dream as well as a thought.
export function rest(world, { dream = false } = {}) {
  if (!dream) return wait(world);
  let next = wait(wait(world));
  next = structuredClone(next);
  const actor = next.playerActorId || "vale";
  next.memories[actor].innerLife = {
    persona: null,
    thoughts: [
      { turn: next.turn - 1, text: "The road is long." },
      { turn: next.turn, text: "Someone kept a light on." },
    ],
    dreams: [],
  };
  for (let i = 0; i < 6; i++) next = wait(next);
  return next;
}
