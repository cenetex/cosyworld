import {
  createWorld,
  holdChoice,
  legalActions,
  play,
} from "../../v2/card-game/world.mjs";

// Vale at Black pond with the lamp in her hand, reached by play: the table
// opens in the attic, the lamp is put out, she steps through the mirror, and
// takes the lamp up again. This used to load a recorded rules-20 save.
export function pondOpening() {
  let world = createWorld({ opening: true });
  const hold = (item) => {
    const next = structuredClone(world);
    holdChoice(next, "vale", { item, revision: next.revision });
    world = next;
  };
  hold(null);
  const move = legalActions(world).find(
    (a) => a.kind === "move" && a.target === "pond",
  );
  if (!move) throw new Error("The mirror stayed shut with the lamp out");
  const result = play(world, move, world.revision);
  if (!result.ok) throw new Error(result.error);
  world = result.state;
  hold("lamp");
  return world;
}
