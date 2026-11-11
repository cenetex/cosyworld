// Fight sounds made in the browser, light and storybook rather than gory: a
// whoosh for a swing or a step in, a bam for a hit and a bigger pow for a
// hard one, a wooden block for a brace, and a low thud when someone is
// beaten. Each is a few Web Audio voices (noise bursts, filtered sweeps,
// pitched thumps) with no sample files. sfx.mjs owns the context and the
// settings; this module maps committed beats to sounds and shapes them.
// Presentation only.

// The sound for one phase of a beat (combat-beats.mjs), or null.
export function combatSound(beat, phase) {
  if (!beat) return null;
  if (beat.kind === "attack") {
    if (phase === "strike") return "whoosh";
    if (phase !== "impact") return null;
    if (beat.outcome === "guarded") return "block";
    return (beat.damage || 0) >= 2 ? "pow" : "bam";
  }
  if (beat.kind === "defeat") return phase === "beaten" ? "thud" : null;
  // Squaring up and stepping in to guard someone are moves.
  if (phase === "telegraph")
    return ["threaten", "intercept"].includes(beat.kind) ? "whoosh" : null;
  return phase === "resolve" && beat.kind === "guard" ? "block" : null;
}

const PHASES = ["telegraph", "strike", "impact", "resolve", "beaten"];
// The same beat and phase always sound alike; neighbours differ slightly.
export const combatSoundSeed = (beat, phase) =>
  ((Number(beat?.seq) || 0) * 7 + PHASES.indexOf(phase) + 1) * 2654435761;

// Pitch and filter jitter, within ±5% and ±10%.
export function soundJitter(random) {
  return {
    pitch: 1 + (random() - 0.5) * 0.1,
    filter: 1 + (random() - 0.5) * 0.2,
  };
}

const noiseBuffers = new WeakMap();
function noiseBuffer(context) {
  let buffer = noiseBuffers.get(context);
  if (buffer) return buffer;
  buffer = context.createBuffer(1, context.sampleRate >> 1, context.sampleRate);
  const data = buffer.getChannelData(0);
  // A fixed seed: the hiss is the same every time; the filters vary it.
  let a = 0x9e3779b9;
  for (let i = 0; i < data.length; i += 1) {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    data[i] = ((a >>> 0) / 4294967296) * 2 - 1;
  }
  noiseBuffers.set(context, buffer);
  return buffer;
}

// Each sound is a few voices: a filtered noise burst whose filter sweeps
// (noise), or a pitched tone that drops (tone), from one frequency to
// another, with a peak, an attack and a decay in seconds.
// [voice, filter or wave, from Hz, to Hz, peak, attack, decay, Q]
const SOUNDS = {
  whoosh: [["noise", "bandpass", 340, 2300, 1.6, 0.09, 0.16, 0.8]],
  bam: [
    ["tone", "sine", 165, 58, 0.9, 0.003, 0.2],
    ["noise", "lowpass", 2000, 480, 0.35, 0.002, 0.06],
  ],
  pow: [
    ["tone", "triangle", 235, 70, 0.9, 0.003, 0.22],
    ["noise", "bandpass", 2700, 900, 0.45, 0.002, 0.08, 0.9],
    ["tone", "sine", 900, 330, 0.22, 0.002, 0.05],
  ],
  // A wooden tok: two short partials and a click.
  block: [
    ["tone", "sine", 660, 600, 0.5, 0.002, 0.08],
    ["tone", "sine", 1540, 1480, 0.16, 0.002, 0.04],
    ["noise", "highpass", 3200, 2600, 0.18, 0.001, 0.018],
  ],
  thud: [
    ["tone", "sine", 96, 38, 1, 0.006, 0.45],
    ["noise", "lowpass", 420, 120, 0.4, 0.004, 0.25],
  ],
};
export const COMBAT_SOUNDS = Object.freeze(Object.keys(SOUNDS));

export function voice(context, out, at, jitter, spec) {
  const [kind, type, from, to, peak, attack, decay, q = 1] = spec;
  const scale = kind === "tone" ? jitter.pitch : jitter.filter;
  const end = at + attack + decay;
  let source, frequency;
  const gain = context.createGain();
  if (kind === "tone") {
    source = context.createOscillator();
    source.type = type;
    source.connect(gain);
    frequency = source.frequency;
  } else {
    source = context.createBufferSource();
    source.buffer = noiseBuffer(context);
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    source.connect(filter);
    filter.connect(gain);
    frequency = filter.frequency;
  }
  frequency.setValueAtTime(from * scale, at);
  frequency.exponentialRampToValueAtTime(to * scale, end);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  gain.connect(out);
  source.start(at);
  source.stop(end + 0.05);
}

// Shape one sound into `out` at the context's current time.
export function shapeCombatSound(context, out, name, random) {
  const voices = SOUNDS[name];
  if (!voices) return false;
  const jitter = soundJitter(random);
  for (const spec of voices)
    voice(context, out, context.currentTime, jitter, spec);
  return true;
}
