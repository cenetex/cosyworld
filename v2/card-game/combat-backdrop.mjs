// The place's painting recedes behind a fight, so the fighters and cards
// stand forward: it fades toward the stage's dusk (combat.css). Opacity alone
// is composited, so a phone keeps its frames; the backdrop's filter already
// carries the weather's light. Presentation only.
//
// Several holds may keep it back at once: a fight's beats, an open standoff
// in the player's room, later the battle opening. It eases back in once none
// does. Under the loss screen's black it returns at once (`instant`), so the
// lift shows the new place whole. Reduced motion shows the same dim, cut.
import { BEAT_MS } from "./combat-beats.mjs";

// In over a beat's telegraph, so the room has fallen back by the strike;
// out as a theatre fade, slower than it went.
export const RECEDE_MS = Object.freeze({ in: BEAT_MS.telegraph, out: 900 });

const holds = new WeakMap();

// Returns whether the backdrop is now held back.
export function recedeBackdrop(stage, reason, on, { instant = false } = {}) {
  if (!stage?.dataset) return false;
  const held = holds.get(stage) ?? new Set();
  holds.set(stage, held);
  const was = held.size > 0;
  if (on) held.add(reason);
  else held.delete(reason);
  const back = held.size > 0;
  if (back === was) return back;
  stage.style?.setProperty(
    "--recede-ms",
    `${instant ? 0 : back ? RECEDE_MS.in : RECEDE_MS.out}ms`,
  );
  if (back) stage.dataset.recede = "true";
  else delete stage.dataset.recede;
  return back;
}

export const backdropHolds = (stage) => [...(holds.get(stage) ?? [])];
