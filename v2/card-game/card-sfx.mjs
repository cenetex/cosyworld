// A paper slide as the pack's cards rise, a flip tick and the tier's chime
// as each card turns, and a soft settle as the cards go back.

import { soundJitter, voice } from "./combat-sfx.mjs";
import { PACK_TIERS } from "./pack-opening.mjs";

export const CHIME_FILES = Object.fromEntries(
  PACK_TIERS.map((tier) => [tier, `assets/chimes/${tier}.mp3`]),
);

// [voice, filter or wave, from Hz, to Hz, peak, attack, decay, Q]
const SOUNDS = {
  // Paper sliding over paper.
  slide: [["noise", "bandpass", 700, 2600, 0.5, 0.05, 0.16, 0.7]],
  // The soft thump of a stack set down.
  settle: [
    ["tone", "sine", 150, 80, 0.5, 0.004, 0.14],
    ["noise", "lowpass", 900, 260, 0.22, 0.003, 0.08],
  ],
};
export const CARD_SOUNDS = Object.freeze(Object.keys(SOUNDS));

// The flip tick: a dry click and a short pitched tick at `at`.
function tick(context, out, at, jitter, hz) {
  voice(context, out, at, jitter, [
    "noise", "highpass", 3400, 2600, 0.3, 0.001, 0.02,
  ]);
  voice(context, out, at, jitter, [
    "tone", "sine", hz, hz * 0.6, 0.45, 0.002, 0.05,
  ]);
}

export function shapeTurnSound(context, out, plan, random) {
  const at = context.currentTime + plan.hold / 1000;
  tick(context, out, at, soundJitter(random), plan.tick);
  return true;
}

// A named sound (slide, settle) at the current time.
export function shapeCardSound(context, out, name, random) {
  const voices = SOUNDS[name];
  if (!voices) return false;
  const jitter = soundJitter(random);
  for (const spec of voices)
    voice(context, out, context.currentTime, jitter, spec);
  return true;
}
