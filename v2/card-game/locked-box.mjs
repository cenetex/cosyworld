// A card locked behind a quest lies in the hand as a carved wooden box: the
// card back, its painting and name hidden. Its closed lid keeps the contents
// concealed, while selection can show the authored quest needed to open it.
// Once the rules open the way, the box turns over once, with the
// same lift as an uncovered card (card-reveal.mjs), and the card shows as
// itself from then on. Presentation only: it reads the committed world and
// never touches rules, saves, the journal or sync.
import { sealedReason, shutBoxes } from "./cards.mjs";
import { questCaption, questVerb } from "./quest-card.mjs";
import { currentActor } from "./world.mjs";

export const CLOSED_BOX = "A closed box.";
export const LOCKED_BOX = "A locked box.";
// What opens a locked box, in words. The rules own the goal (`boxWant`,
// world/boxes.mjs); this only states it. A goal the quest card cannot hold
// ("heard while holding a thing") is told by the plain reason.
export function lockedQuest(world, id, known = () => false) {
  const box = shutBoxes(world).find((entry) => entry.id === id);
  if (!box) return null;
  if (!box.want) return { text: box.reason || LOCKED_BOX, cards: [] };
  // Discovering the locked destination cannot explain how to open its way.
  if (box.want.kind === "place" && box.want.target === id)
    return { text: box.reason || LOCKED_BOX, cards: [] };
  const quest = { actor: currentActor(world), ...box.want };
  const text = questCaption(quest, false, questVerb(world, quest), known);
  return { text, cards: [] };
}

// The locked carved lid has a recessed iron keyhole (assets/README.md).
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
