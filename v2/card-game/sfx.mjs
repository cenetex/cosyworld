// World sound effects made in the browser: today a struck bell. They follow
// the music switch and volume, wait for a user gesture, and keep their own
// gain. Later effects (doors, card reveals) can add a voice beside the bell.

// Inharmonic partials of a small hand bell: ratio, level, decay seconds.
const BELL = [
  [1, 1, 2.8],
  [2, 0.55, 2.2],
  [2.76, 0.4, 1.6],
  [5.4, 0.22, 0.9],
  [8.9, 0.12, 0.5],
];
const BELL_ROOT = 523;
const BELL_SECONDS = 3;
const PEAK = 0.6;

// A small seeded generator so each ring has its own slight detune.
function seeded(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The newest committed ring after `since`, heard here or from next door.
export function heardRing(log = [], since, place, nearby = []) {
  for (let i = log.length - 1; i >= 0 && log[i].seq > since; i -= 1) {
    const entry = log[i];
    if (entry.verb !== "ring") continue;
    if (entry.locationId === place) return { seq: entry.seq, near: true };
    if (nearby.includes(entry.locationId))
      return { seq: entry.seq, near: false };
  }
  return null;
}

export function createSfx({
  makeContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
} = {}) {
  let context = null,
    failed = false,
    unlocked = false,
    enabled = true,
    hidden = false,
    volume = 0.3,
    ringingUntil = 0,
    cursor = null;

  const audible = () => unlocked && enabled && !hidden && volume > 0;

  function build() {
    if (context || failed) return Boolean(context);
    try {
      context = makeContext();
      return true;
    } catch {
      failed = true;
      return false;
    }
  }

  function bell(seed = 1, { near = true } = {}) {
    if (!audible() || !build()) return false;
    if (context.state === "suspended") context.resume?.().catch?.(() => {});
    const now = context.currentTime;
    // One ring at a time: a second strike waits until the first has faded.
    if (now < ringingUntil) return false;
    ringingUntil = now + BELL_SECONDS;
    const random = seeded(seed);
    const root = BELL_ROOT * (1 + (random() - 0.5) * 0.03);
    const out = context.createGain();
    out.gain.value = volume * PEAK * (near ? 1 : 0.3);
    out.connect(context.destination);
    for (const [ratio, level, decay] of BELL) {
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.type = "sine";
      tone.frequency.value = root * ratio * (1 + (random() - 0.5) * 0.008);
      const g = gain.gain;
      g.setValueAtTime(0.0001, now);
      g.exponentialRampToValueAtTime(level / BELL.length, now + 0.004);
      g.exponentialRampToValueAtTime(0.0001, now + decay * (near ? 1 : 0.8));
      tone.connect(gain);
      gain.connect(out);
      tone.start(now);
      tone.stop(now + BELL_SECONDS + 0.1);
    }
    return true;
  }

  return {
    bell,
    // Ring for a new committed ring event; the first look only sets the mark.
    watch(log, place, nearby) {
      const since = cursor;
      const top = log?.at(-1)?.seq ?? 0;
      cursor = top;
      if (since === null || top < since) return false;
      const ring = heardRing(log, since, place, nearby);
      return ring ? bell(ring.seq * 2654435761, ring) : false;
    },
    setEnabled(value) {
      enabled = Boolean(value);
    },
    setVolume(value) {
      volume = Math.max(0, Math.min(1, Number(value) || 0));
    },
    setHidden(value) {
      hidden = Boolean(value);
    },
    // Browsers allow audio only after a gesture.
    unlock() {
      unlocked = true;
      if (enabled && build() && context.state === "suspended")
        context.resume?.().catch?.(() => {});
    },
  };
}
