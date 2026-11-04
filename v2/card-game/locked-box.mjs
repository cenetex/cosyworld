// A card locked behind a quest lies in the hand as a carved wooden box: the
// card back, its painting and name hidden. Today that is a sealed card, the
// far side of a shut gate whose pack route names the quest that opens it
// (rules 95). Tapping the box gives that quest through the context button,
// as before. Once the rules open the way, the box turns over once, with the
// same lift as an uncovered card (card-reveal.mjs), and the card shows as
// itself from then on. Presentation only: it reads the committed world and
// never touches rules, saves, the journal or sync.
import { sealedReason } from "./cards.mjs";

// The locked lid. A stand-in darkened from the card back until its own
// painting drops in at this path (assets/README.md).
export const LOCKED_BACK = "./assets/card-back-locked.webp";

// Whether the card is still locked behind its quest for this player.
export const isLockedBox = (world, id) => sealedReason(world, id) !== null;

// Boxes this view has drawn. `draw(shown, locked)` takes the cards in view
// now and the cards drawn locked now (in view or tucked in a stack), and
// returns the ones due to turn over: drawn locked before, in view and open
// now. Each turns once; a redraw never covers it again. A box that leaves
// the hand still locked turns when it is next seen open.
export function createLockedBoxes() {
  const boxed = new Set();
  return {
    draw(shown, locked) {
      const shut = new Set(locked);
      for (const id of shut) boxed.add(id);
      return shown.filter((id) => !shut.has(id) && boxed.delete(id));
    },
    boxed: (id) => boxed.has(id),
    clear: () => boxed.clear(),
  };
}
