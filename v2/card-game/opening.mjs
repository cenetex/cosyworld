// A new world's opening (PRD tap-to-reveal, #2182): Vale alone on black; a
// tap brings in the lit lamp he holds and another the lit attic, in either
// order; then the first real play, Put out, darkens the room and the rules
// bring a new card. Presentation only: the rules' offers are unchanged, and
// a world past its first turn, or a shared one, has no opening.
import { rootHolder, shining } from "./world.mjs";

// The context button's quiet label while the opening still has a card down.
export const OPENING_REVEAL = "Reveal";

// Where the opening stands: "reveal" with the next card still face down,
// "play" with the cards for its first play, or null once it is past.
export function openingStep(world, actor, covered) {
  if (!world.opening || world.turn !== 0 || !world.actors[actor]) return null;
  const light =
    shining(world) && rootHolder(world, "lamp") === actor ? "lamp" : null;
  const down = [actor, light, world.actors[actor].place].filter(
    (id) => id && covered(id),
  );
  if (down.length) return { step: "reveal", next: down[0] };
  return { step: "play", choice: light ? [light] : [] };
}
