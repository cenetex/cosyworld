// The DREAM card: one beat in the dialogue stack, read in the dark. It is
// built from props so another dream can reuse it, such as the coming
// halfway glimpse, which pairs it with one partly revealed aspect card
// (`companion`). Presentation only; nothing here is saved.
//
// The label is the card's name at the top, in the Common tier colour
// (card-label-spec.md). While its words are written it is the Thinking
// card, renamed "Dreaming…", and two taps cancel it. Words that fail, or a
// cancel, read "…"; there is no retry.
import { levelTier } from "./level-tiers.mjs";

export const DREAM_LABEL = "Dream";
export const DREAM_TIER = levelTier(0);
export const dreamingLabel = (armed = false) =>
  armed ? "Tap again to cancel" : "Dreaming…";
export const dreamingAria = (armed = false) =>
  armed ? "Tap again to stop dreaming" : "Dreaming";

// A DREAM card beat for the stack.
// - key: the beat's identity, stable for one dream.
// - dreamerId: whose dream; their portrait stands on the card.
// - turn and anchor: where it sits among the visit's beats (after the wake).
// - text: its words, "…" when none came, or null while they are written.
// - companion: an optional card shown beside it, { id, art, revealed } with
//   revealed a share from 0 (face down) to 1.
export function dreamBeat({
  key,
  dreamerId,
  turn,
  anchor,
  text = null,
  armed = false,
  companion = null,
}) {
  const pending = text === null;
  return {
    key,
    turn,
    anchor,
    speakerId: dreamerId,
    // The card's name, also while its words are written.
    label: DREAM_LABEL,
    dream: true,
    pending,
    armed,
    companion,
    silent: text === "…",
    actions: [],
    line: pending
      ? null
      : {
          // Its own seq, so the dialogue's exchange never mistakes it for a
          // spoken line it is waiting on.
          seq: key,
          turn,
          speaker: DREAM_LABEL,
          entityId: dreamerId,
          text,
          // A dream is read, not spoken aloud.
          silent: true,
          dream: true,
        },
  };
}

// The stack with the dream in its place after the wake, kept in front
// while the wake plays (`front`).
export function withDream(beats, dream, { front = false } = {}) {
  if (!dream) return { beats, front: -1 };
  const rest = beats.filter((beat) => beat.key !== dream.key);
  let at = rest.findIndex((beat) => beat.anchor > dream.anchor);
  if (at < 0) at = rest.length;
  const next = [...rest.slice(0, at), dream, ...rest.slice(at)];
  return { beats: next, front: front ? at : -1 };
}
