// What the dialogue box presents now: one phase decides what is in front
// (v2/docs/card-table/dialogue-beats.md#what-is-in-front). The action panel
// shows only while choosing, so it never covers a line being written or a
// Thinking card.
export function phase({
  reviewing = false,
  revealing = false,
  inFlight = false,
  failed = false,
  raised = false,
  chosen = false,
  rested = false,
} = {}) {
  if (revealing) return "revealing";
  if (inFlight) return "thinking";
  // A later play also asks again for words that failed, so a choice comes
  // forward over a failed scene.
  if (raised && chosen && !rested) return "choosing";
  if (failed) return "failed";
  // Stepping back never hides a choice: the earlier beat steps behind it.
  if (reviewing) return "reviewing";
  return "idle";
}
