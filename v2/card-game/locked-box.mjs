// A card locked behind a quest lies in the hand as a carved wooden box: the
// card back, its painting and name hidden. Its closed lid keeps the contents
// concealed, while selection can show the authored quest needed to open it.
// Once the rules open the way, the box turns over once, with the
// same lift as an uncovered card (card-reveal.mjs), and the card shows as
// itself from then on. Presentation only: it reads the committed world and
// never touches rules, saves, the journal or sync.
import { LOCKED_BOX, lockWords, sealedReason } from "./cards.mjs";

export { LOCKED_BOX };
// What opens a locked box (cards.mjs `lockWords`), or null for any other card.
export function lockedQuest(world, id, known = () => false) {
  const text = lockWords(world, id, known);
  return text === null ? null : { text, cards: [] };
}

// The locked carved lid has a recessed iron keyhole (assets/README.md).
export const LOCKED_BACK = "./assets/card-back-locked.webp";
export const TAROT_BACK = "./assets/arcana/tarot-back.png";
export const TAROT_LOCKED_BACK = "./assets/arcana/tarot-back-locked.png";

// Whether the card is still locked behind its quest for this player.
export const isLockedBox = (world, id) => sealedReason(world, id) !== null;

// Tracks cards drawn locked, then reports each when it is drawn open.
// `shown` lists the current cards; `locked` includes tucked cards.
// By default a box that leaves the view locked still turns when next seen.
// Tarot opts out so a completed spread slot cannot unlock again later.
export function createLockedBoxes({ retainAbsent = true } = {}) {
  const boxed = new Set();
  return {
    draw(shown, locked) {
      if (!retainAbsent)
        for (const id of boxed) if (!shown.includes(id)) boxed.delete(id);
      const shut = new Set(locked);
      for (const id of shut) boxed.add(id);
      return shown.filter((id) => !shut.has(id) && boxed.delete(id));
    },
    boxed: (id) => boxed.has(id),
    clear: () => boxed.clear(),
  };
}
