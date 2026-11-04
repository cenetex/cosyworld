// What the dialogue box presents now: one phase decides what is in front
// (v2/docs/card-table/dialogue-beats.md#what-is-in-front). The action panel
// shows only while choosing, so it never covers a line being written or a
// Thinking card.
//
// A committed play's words that keep the Thinking card past this grace
// stop holding the hand: the rules already ran, and dialogue never gates
// play. The card stays and the late line types in when it comes.
export const THINKING_GRACE_MS = 5000;
export function phase({
  reviewing = false,
  revealing = false,
  inFlight = false,
  lingering = false,
  raised = false,
  chosen = false,
  rested = false,
} = {}) {
  if (revealing) return "revealing";
  if (inFlight && !lingering) return "thinking";
  // Words that fail are "…" like any line, so they never hold a choice.
  if (raised && chosen && !rested) return "choosing";
  // Stepping back never hides a choice: the earlier beat steps behind it.
  if (reviewing) return "reviewing";
  return "idle";
}
// A refused play says why on its own button, as a blocked Take does (#2026):
// the server's first sentence, short enough for the action beat on a phone.
// The full reason stays in the button's title and the screen-reader readout.
export function refusalLabel(reason = "") {
  const first = String(reason)
    .trim()
    .split(/(?<=[.!?])\s/u)[0];
  return (first || "Not played")
    .replace(/^This world is waiting/u, "Waiting")
    .replace(/[.!]$/u, "");
}
