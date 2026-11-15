// A card locked behind a quest lies in the hand as a carved wooden box: the
// card back, its painting and name hidden. Its closed lid keeps the contents
// concealed, while selection can show the authored quest needed to open it.
// Rules eligibility leaves the lid shut until its player chooses Unlock.
import { LOCKED_BOX, lockWords, sealedReason } from "./cards.mjs";

export { LOCKED_BOX };
// What opens a locked box (cards.mjs `lockWords`), or null for any other card.
export function lockedQuest(world, id, known = () => false) {
  const text = lockWords(world, id, known);
  return text === null ? null : { text, cards: [] };
}

// The locked carved lid has a recessed iron keyhole (assets/README.md).
export const LOCKED_BACK = "./assets/card-back-locked.webp";

// Whether the card is still locked behind its quest for this player.
export const isLockedBox = (world, id) => sealedReason(world, id) !== null;

export function createLockedBoxes() {
  const boxed = new Set();
  return {
    observe(locked) {
      const size = boxed.size;
      for (const id of locked) boxed.add(id);
      return boxed.size !== size;
    },
    restore(ids = []) {
      boxed.clear();
      for (const id of ids) boxed.add(id);
    },
    unlock: (id, available, locked) =>
      available.includes(id) && !locked.includes(id) && boxed.delete(id),
    ids: () => [...boxed],
    boxed: (id) => boxed.has(id),
    clear: () => boxed.clear(),
  };
}
