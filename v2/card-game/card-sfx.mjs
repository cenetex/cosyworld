// Card sounds made in the browser, like the fight's: no sample files. A
// paper slide as the pack's cards rise, a flip tick as each card turns, a
// tone that rises through a rarer card's held breath and ends on the turn,
// and a soft settle as the cards go back. sfx.mjs owns the context and the
// settings; the tier table lives in pack-opening.mjs. Presentation only.

import { soundJitter, voice } from "./combat-sfx.mjs";

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

// The rising tone: partials of one note that glide up through the hold and
// swell to the turn, then fade. Its peak is at `at + seconds`.
function rise(context, out, at, tone, seconds, jitter) {
  const end = at + seconds + 0.12;
  for (let p = 1; p <= tone.partials + 1; p += 1) {
    const source = context.createOscillator(),
      gain = context.createGain(),
      from = tone.hz * p * jitter.pitch,
      peak = (tone.level / (p * p)) * 0.9;
    source.type = p === 1 ? "triangle" : "sine";
    source.frequency.setValueAtTime(from, at);
    source.frequency.exponentialRampToValueAtTime(from * tone.glide, at + seconds);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + seconds);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(gain);
    gain.connect(out);
    source.start(at);
    source.stop(end + 0.05);
  }
}

// One card turning: the tone rises through `plan.hold`, the tick lands as
// the lid moves (plan: pack-opening.mjs turnPlan).
export function shapeTurnSound(context, out, plan, random) {
  const jitter = soundJitter(random),
    at = context.currentTime;
  if (plan.tone)
    rise(context, out, at, plan.tone, Math.max(plan.hold, 120) / 1000, jitter);
  tick(context, out, at + plan.hold / 1000, jitter, plan.tick);
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
