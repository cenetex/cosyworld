// What the dialogue box presents now: one phase decides what is in front
// (v2/docs/card-table/dialogue-beats.md#what-is-in-front). The action panel
// shows while choosing; speech keeps writing behind the chosen action.
//
// A committed play's words that keep the Thinking card past this grace
// stop holding the hand: the rules already ran, and dialogue never gates
// play. The card stays and the late line types in when it comes.
export const THINKING_GRACE_MS = 5000;
// Read older words through the reader's revealed cards. Keep the saved beat
// intact, including the signed line used by the voice service.
export function revealedBeat(beat, textOf) {
  const text = beat.line && textOf(beat.line.text);
  return {
    ...beat,
    label: textOf(beat.label),
    line: beat.line && {
      ...beat.line,
      text,
      speaker: textOf(beat.line.speaker),
      silent: beat.line.silent || text !== beat.line.text,
    },
    actions: beat.actions.map((action) => ({
      ...action,
      text: textOf(action.text),
    })),
  };
}

const shortActions = {
  accompany: "Invite",
  ask: "Ask",
  give: "Give",
  threaten: "Threaten",
  trade: "Trade",
};
// The message already names the target. Keep the verb and any authored detail.
export function actionTapVerb(action, label = "") {
  if (action?.label) {
    if (/^Ring the /u.test(label)) return "Ring";
    if (/^Up to /u.test(label)) return "Go up";
    if (/^Down to /u.test(label)) return "Go down";
    return label;
  }
  if (action?.kind === "move" && action.item) return "Carry";
  if (action?.kind === "eat")
    return label.startsWith("Drink") ? "Drink" : "Eat";
  if (!action && label.startsWith("Bring to ")) return "Bring";
  return shortActions[action?.kind] ?? label;
}
export function tapPrompt(verb, complete, label = verb) {
  if (!complete) return { hint: "Tap to finish", label: "Finish reading" };
  const word = verb?.replace(/^\p{L}/u, (first) => first.toLowerCase());
  return { hint: word ? `Tap to ${word}` : "", label };
}
export function phase({
  reviewing = false,
  revealing = false,
  inFlight = false,
  lingering = false,
  raised = false,
  chosen = false,
  rested = false,
} = {}) {
  if (raised && chosen && !rested && (!inFlight || lingering))
    return "choosing";
  if (revealing) return "revealing";
  if (inFlight && !lingering) return "thinking";
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
    .split(/(?<=[.!?…])\s/u)[0];
  return (first || "Not played")
    .replace(/^This world is waiting/u, "Waiting")
    .replace(/[.!]$/u, "");
}
// The label as a sentence for the status line: a question or a trailing
// ellipsis keeps its own mark.
export const refusalSentence = (reason) => {
  const label = refusalLabel(reason);
  return /[?…]$/u.test(label) ? label : `${label}.`;
};
