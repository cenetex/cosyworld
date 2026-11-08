// A new world's opening (PRD tap-to-reveal, #2182): Vale alone on black; a
// tap brings in the lit lamp he holds and another the lit attic, in either
// order; putting the lamp away darkens the room and reveals the mirror.
// Presentation only: the rules' offers are unchanged, and
// a world past its first turn, or a shared one, has no opening.
import { rootHolder } from "./world.mjs";

// The context button's quiet label while the opening still has a card down.
export const OPENING_REVEAL = "Reveal";

// Where the opening stands: "reveal" with the next card still face down,
// "play" with the cards for its first play, or null once it is past.
export function openingStep(world, actor, covered) {
  if (!world.opening || world.turn !== 0 || !world.actors[actor]) return null;
  // Stowing is a quiet choice, not a turn. Its dark mirror ends the opening.
  if (actor === "vale" && world.items.lamp?.lit === false) return null;
  const light = Object.keys(world.items).find(
    (id) => world.items[id].lit && rootHolder(world, id) === actor,
  );
  const down = [actor, light, world.actors[actor].place].filter(
    (id) => id && covered(id),
  );
  if (down.length) return { step: "reveal", next: down[0] };
  return { step: "play", choice: light ? [light] : [] };
}
