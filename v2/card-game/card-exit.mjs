import { entryDelays } from "./card-entry.mjs";
import { fadeGhost, lookAlike } from "./card-ghost.mjs";

// Cards leaving the player's view: a thing given or put down into a folded
// stack, an avatar walking away, a place left behind, a quest cleared or set
// aside. Each falls a little and fades, staggered as entries are
// (card-entry.mjs). The hand redraws at once, so play never waits: an inert,
// aria-hidden copy at the card's last place plays the fall and is released
// when it ends (card-ghost.mjs). Presentation only, like card-entry.mjs.
export const EXIT_MS = 360;
export const EXIT_FALL = { translate: "0 24px", scale: "0.96" };
// More cards than the stagger spaces out (a whole hand left behind) just go.
export const EXIT_MAX = 6;

// The card a hand frame shows: its entity, or its quest (whose place in the
// stack another quest can take).
export const cardOf = (frame) => {
  const card = frame.querySelector(".card");
  return card?.dataset.card ?? card?.dataset.questEntry;
};

// The frames shown in `before` whose card is not shown in `after`: gone from
// the hand, or folded under a new holder. A stack the player folds keeps its
// holder, so it is no exit; a card shown in both moves where it is.
export function leavingFrames(before, after) {
  const drawn = new Map(after.map((frame) => [cardOf(frame), frame]));
  return before
    .filter((frame) => {
      if (frame.hidden) return false;
      const next = drawn.get(cardOf(frame));
      return (
        !next || (next.hidden && next.dataset.holder !== frame.dataset.holder)
      );
    })
    .slice(0, EXIT_MAX);
}

// Copies of the frames, still drawn, laid in `layer` (over the frames'
// offset parent) where each card shows. Every copy is read before any is
// placed, so the page lays out once however many there are.
export function ghostsOver(frames, layer) {
  const ghosts = frames.map((frame) => {
    const ghost = lookAlike(frame, "1"),
      row = frame.parentElement;
    // Out of its scrolled row, the copy stands where the row shows the card.
    if (row !== frame.offsetParent) {
      ghost.style.left = `${frame.offsetLeft - row.scrollLeft}px`;
      ghost.style.top = `${frame.offsetTop - row.scrollTop}px`;
    }
    return ghost;
  });
  layer.append(...ghosts);
  return ghosts;
}

// Cards folding into their holder's stack (a tap closing it) shrink and
// fade where they lay, a little apart, instead of vanishing. Each is shown
// for the moment its copy is read; one scrolled out of view just goes.
// Reduced motion only fades them.
export const FOLD_MS = 220;
export function foldCards(frames, layer, reduced = false) {
  if (!frames.length) return [];
  for (const frame of frames) frame.hidden = false;
  // Only cards in view fold where they are seen.
  const seen = frames.filter((frame) => {
    const box = frame.getBoundingClientRect();
    return box.right > 0 && box.left < innerWidth;
  });
  const ghosts = ghostsOver(seen, layer);
  for (const frame of frames) frame.hidden = true;
  ghosts.forEach((ghost, i) =>
    fadeGhost(
      ghost,
      reduced ? {} : { translate: "0 8px", scale: "0.9" },
      FOLD_MS,
      i * 30,
    ),
  );
  return ghosts;
}

// Lets each leaving frame fall as a copy, by default staggered as entries
// are; a scene change gives its own `delays` (card-swap.mjs).
export function dropCards(frames, layer, delays = entryDelays(frames.length)) {
  const ghosts = ghostsOver(frames, layer);
  ghosts.forEach((ghost, i) => fadeGhost(ghost, EXIT_FALL, EXIT_MS, delays[i]));
  return ghosts;
}
