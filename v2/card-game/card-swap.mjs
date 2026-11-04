// A scene change swaps the hand in three beats instead of one cut: the
// cards left behind fall away one after another, nearest the player's own
// card first (card-exit.mjs); a short beat holds while the backdrop changes
// (the travel veil and the new painting, or the light going down); then the
// new cards rise in (card-entry.mjs). A card there before and after keeps
// its node and stays put (card-keep.mjs); one whose face changed with the
// light (a lamp put out) fades from its old face to its new one. The whole swap ends within
// SWAP_MS, and reduced motion fades the hand in quickly instead.
// Presentation only: the rules have already run and the hand drawn is the
// rules' hand.
import { EXIT_MS, cardOf, ghostsOver } from "./card-exit.mjs";
import { ENTRY_MS, entryDelays } from "./card-entry.mjs";
import { fadeGhost } from "./card-ghost.mjs";

// Exits follow each other closely; entries keep their own 70 ms stagger.
export const SWAP_EXIT_STAGGER_MS = 50;
// The beat between the last exit and the first entry.
export const SWAP_BEAT_MS = 160;
// A changed face fades this long, beside the backdrop's own fade.
export const SWAP_FACE_MS = 600;
export const SWAP_MS = 1200;
export const SWAP_REDUCED_MS = 200;

// When each part of a swap starts, in ms from its start: each exit, the
// first entry (later entries follow on entryDelays), and the changed faces.
// `fallen` is when exits already started end, if later than planned.
// Entries come forward into the beat when the whole would run past SWAP_MS.
export function swapTiming(leaving, entering = 0, fallen = 0) {
  const exits = Array.from(
      { length: leaving },
      (_, i) => i * SWAP_EXIT_STAGGER_MS,
    ),
    exitsEnd = Math.max(fallen, leaving ? exits.at(-1) + EXIT_MS : 0),
    span = entering ? entryDelays(entering).at(-1) + ENTRY_MS : 0,
    entryAt = entering
      ? Math.max(0, Math.min(exitsEnd + SWAP_BEAT_MS, SWAP_MS - span))
      : exitsEnd,
    faceAt = Math.min(exitsEnd, SWAP_MS - SWAP_FACE_MS);
  return {
    exits,
    entryAt,
    faceAt,
    end: Math.max(exitsEnd, entryAt + span, faceAt + SWAP_FACE_MS),
  };
}

// The leaving frames, nearest the `anchor` card in the old `row` first.
export function nearestFirst(leaving, row, anchor) {
  const at = (frame) => row.indexOf(frame),
    from = Math.max(
      0,
      row.findIndex((frame) => cardOf(frame) === anchor),
    );
  return [...leaving].sort(
    (a, b) => Math.abs(at(a) - from) - Math.abs(at(b) - from) || at(a) - at(b),
  );
}

// Each changed frame's old face, laid over the hand, fading off the new one.
export function fadeFaces(frames, layer, delay = 0) {
  const ghosts = ghostsOver(frames, layer);
  for (const ghost of ghosts) fadeGhost(ghost, {}, SWAP_FACE_MS, delay);
  return ghosts;
}
