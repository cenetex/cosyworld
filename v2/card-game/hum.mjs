// The Willows hum: a low drone made in the browser, heard only on the island.
// Two sines a few hertz apart beat slowly; a quiet harmonic above 200 Hz lets
// phone speakers carry it; a slow LFO makes it breathe. It follows the music
// switch and volume, waits for a user gesture, and has its own gain so it
// layers under any room song without touching the music player.
const ISLAND = {
  "willows-landing": 0.45,
  "willows-camp": 0.6,
  "willows-thicket": 0.85,
  "willows-bank": 1,
};
const PEAK = 0.22;

export const humIntensity = (place, night = false) =>
  Object.hasOwn(ISLAND, place)
    ? Math.min(1, ISLAND[place] * (night ? 1.3 : 1))
    : 0;

export function createHum({
  makeContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
} = {}) {
  let context = null,
    master = null,
    failed = false,
    unlocked = false,
    started = false,
    enabled = true,
    hidden = false,
    volume = 0.3,
    intensity = 0,
    hushedUntil = 0,
    sleepTimer = null;

  const target = () =>
    unlocked && started && enabled && !hidden && intensity > 0
      ? volume * PEAK * intensity
      : 0;

  function build() {
    if (context || failed) return Boolean(context);
    try {
      context = makeContext();
      master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);
      const breath = context.createGain();
      breath.gain.value = 0.75;
      breath.connect(master);
      const lfo = context.createOscillator();
      const depth = context.createGain();
      lfo.frequency.value = 0.07;
      depth.gain.value = 0.25;
      lfo.connect(depth);
      depth.connect(breath.gain);
      lfo.start();
      for (const [type, frequency, level] of [
        ["sine", 55, 0.5],
        ["sine", 57.3, 0.45],
        ["triangle", 110.6, 0.18],
        ["sine", 221, 0.06],
      ]) {
        const tone = context.createOscillator();
        const gain = context.createGain();
        tone.type = type;
        tone.frequency.value = frequency;
        gain.gain.value = level;
        tone.connect(gain);
        gain.connect(breath);
        tone.start();
      }
      return true;
    } catch {
      failed = true;
      context = master = null;
      return false;
    }
  }

  function apply(seconds = 1.5) {
    const level = target();
    if (!context && (level === 0 || !build())) return;
    clearTimeout(sleepTimer);
    const now = context.currentTime;
    const gain = master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    if (now < hushedUntil) {
      // Hold the silence, then come back slowly.
      gain.setValueAtTime(0, hushedUntil);
      gain.linearRampToValueAtTime(level, hushedUntil + 2.5);
    } else gain.linearRampToValueAtTime(level, now + seconds);
    if (level > 0) {
      if (context.state === "suspended") context.resume?.().catch?.(() => {});
    } else
      sleepTimer = setTimeout(
        () => target() === 0 && context.suspend?.().catch?.(() => {}),
        (seconds + 0.5) * 1000,
      );
  }

  return {
    setRoom(place, { night = false } = {}) {
      const next = humIntensity(place, night);
      if (next === intensity) return;
      intensity = next;
      apply(intensity ? 3 : 1.2);
    },
    setEnabled(value) {
      enabled = Boolean(value);
      apply(0.6);
    },
    setVolume(value) {
      volume = Math.max(0, Math.min(1, Number(value) || 0));
      apply(0.15);
    },
    setHidden(value) {
      hidden = Boolean(value);
      apply(0.4);
    },
    setStarted(value) {
      started = Boolean(value);
      apply();
    },
    // Browsers allow audio only after a gesture.
    unlock() {
      if (unlocked && context?.state !== "suspended") return;
      unlocked = true;
      apply();
    },
    // Before a reveal: about 300 ms to silence, a held breath, then back.
    hush() {
      if (!context || target() === 0) return;
      const now = context.currentTime;
      const gain = master.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, now + 0.3);
      hushedUntil = now + 1.2;
      gain.setValueAtTime(0, hushedUntil);
      gain.linearRampToValueAtTime(target(), hushedUntil + 2.5);
    },
    get level() {
      return target();
    },
  };
}
