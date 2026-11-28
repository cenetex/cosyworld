// A committed play's words that keep the Thinking card past this grace
// stop holding the hand: the rules already ran, and dialogue never gates
// play. The card stays and the late line types in when it comes.
export const THINKING_GRACE_MS = 5000;
const dialoguePhases = [
  "idle",
  "revealing",
  "choosing",
  "thinking",
  "reviewing",
];
let viewModel;

export async function loadClientViewModel(
  url = new URL("./client-view-model.wasm", import.meta.url),
) {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const { instance } = await WebAssembly.instantiate(
      await response.arrayBuffer(),
    );
    if (
      typeof instance.exports.dialogue_phase !== "function" ||
      typeof instance.exports.dialogue_choice !== "function"
    )
      return false;
    viewModel = instance.exports;
    return true;
  } catch {
    return false;
  }
}

// Read older words through the reader's revealed cards. Keep the saved beat
// intact, including the signed line used by the voice service.
export function revealedBeat(beat, textOf) {
  const text = beat.line && textOf(beat.line.text, beat.line);
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
  // A confirm already says how to tap ("Tap again to sign out").
  if (/^Tap /u.test(verb ?? "")) return { hint: verb, label };
  return { hint: word ? `Tap to ${word}` : "", label };
}
function handInput(length) {
  if (!viewModel?.hand_input || !viewModel.memory || length > 0xffff)
    return null;
  const offset = viewModel.hand_input(length);
  return offset
    ? new Int32Array(viewModel.memory.buffer, offset, length)
    : null;
}
export function handFocusId(frames, ids) {
  const preferred = [...ids];
  const input =
    viewModel?.hand_focus && handInput(frames.length + preferred.length);
  if (input) {
    const indexes = new Map();
    frames.forEach(({ id }, index) => {
      if (!Number.isNaN(id) && !indexes.has(id)) indexes.set(id, index);
    });
    const indexOf = (id) => indexes.get(id) ?? -1;
    frames.forEach(({ hidden, holder }, index) => {
      input[index] = hidden ? (holder ? indexOf(holder) : -1) : -2;
    });
    input.set(preferred.map(indexOf), frames.length);
    return frames[viewModel.hand_focus(frames.length)]?.id;
  }
  for (const id of preferred.reverse()) {
    let at = frames.findIndex((frame) => frame.id === id);
    for (
      let step = 0;
      at >= 0 && frames[at].hidden && step < frames.length;
      step++
    ) {
      const holder = frames[at].holder;
      const next = holder
        ? frames.findIndex((frame) => frame.id === holder)
        : -1;
      if (next < 0) break;
      at = next;
    }
    for (let away = 0; at >= 0 && away < frames.length; away++)
      for (const index of [at - away, at + away])
        if (frames[index] && !frames[index].hidden) return frames[index].id;
  }
  return frames.find((frame) => !frame.hidden)?.id;
}
export function roomCardOrder(cards, back, featured, isLocal, isWay) {
  if (viewModel?.room_card_order) {
    const roles = cards.map(
      (id) =>
        Number(Boolean(isLocal(id))) |
        (Number(Boolean(isWay(id))) << 1) |
        (Number(id === back) << 2) |
        (Number(id === featured) << 3),
    );
    const maxOutput = 2 * cards.length + 2;
    const input = handInput(roles.length + maxOutput);
    if (input) {
      input.set(roles);
      const count = viewModel.room_card_order(
        cards.length,
        Boolean(back),
        Boolean(featured),
      );
      const ids = [...cards, back, featured];
      return Array.from(
        input.subarray(cards.length, cards.length + count),
        (index) => ids[index],
      );
    }
  }
  const local = cards.filter(isLocal);
  return [
    ...(back ? [back] : []),
    ...local.slice(0, 1),
    ...(featured ? [featured] : []),
    ...local.slice(1).filter((id) => id !== featured),
    ...cards.filter((id) => !local.includes(id) && !isWay(id)),
    ...cards.filter((id) => isWay(id) && id !== back),
  ];
}
export function lockedStackProjection(count, index, open, holderExpanded) {
  if (
    !viewModel?.locked_stack ||
    count > 0x1fffffff ||
    typeof open !== "boolean" ||
    typeof holderExpanded !== "boolean"
  )
    return null;
  const state = viewModel.locked_stack(count, index, open, holderExpanded);
  return {
    kind: "locks",
    open: Boolean(state & 1),
    top: Boolean(state & 2),
    under: state >>> 3,
    shown: Boolean(state & 4),
  };
}
export function holdDialogueChoice({ queued, live, complete, speaking, next }) {
  if (viewModel)
    return Boolean(
      viewModel.dialogue_choice(
        Boolean(queued),
        Boolean(live),
        Boolean(complete),
        Boolean(speaking),
        Boolean(next),
      ),
    );
  return Boolean(queued || (live && (!complete || speaking || next)));
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
  if (viewModel)
    return dialoguePhases[
      viewModel.dialogue_phase(
        Boolean(reviewing),
        Boolean(revealing),
        Boolean(inFlight),
        Boolean(lingering),
        Boolean(raised),
        Boolean(chosen),
        Boolean(rested),
      )
    ];
  if (revealing) return "revealing";
  if (raised && chosen && !rested && (!inFlight || lingering))
    return "choosing";
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
export const STALE_REFUSALS = new Set([
  "The world changed. Choose a current play.",
  "That play has changed. Check the cards and choose again.",
]);
export const refusalSentence = (reason) => {
  const label = refusalLabel(reason);
  return /[?…]$/u.test(label) ? label : `${label}.`;
};
