// A complete line gets its own clock, independent of network chunk timing.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function splitLetters(text) {
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}
export function letterDelay(letter) {
  if (/[.!?…]/u.test(letter)) return 180;
  if (/[,;:—]/u.test(letter)) return 90;
  return 28;
}
export function createTextReveal({
  frame,
  sound = () => {},
  reduced = () => false,
  now = () => performance.now(),
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
}) {
  let current = null,
    timer = null,
    paused = false,
    due = 0,
    remaining = 28;
  const stop = () => {
    if (requestFrame) cancelFrame(timer);
    else clearTimeout(timer);
    timer = null;
  };
  const emit = () =>
    frame({ ...current, complete: current.shown === current.letters.length });
  function queue() {
    if (!paused && current && current.shown < current.letters.length)
      timer = requestFrame
        ? requestFrame(step)
        : setTimeout(step, Math.max(0, due - now()));
  }
  function schedule(delay = 28) {
    due = now() + delay;
    queue();
  }
  function step() {
    timer = null;
    if (!current || paused) return;
    const time = now();
    if (time < due) {
      queue();
      return;
    }
    const letter = current.letters[current.shown++];
    if (!reduced() && /[\p{L}\p{N}]/u.test(letter) && current.shown % 2 === 1)
      sound(current.speaker, letter, current.shown);
    emit();
    // Keep the cadence through small frame delays. A slow frame reveals one
    // letter, so returning from a busy frame keeps the words readable.
    due = Math.max(due + letterDelay(letter), time);
    queue();
  }
  return {
    show(key, text, speaker, { instant = false } = {}) {
      if (current?.key === key) return;
      stop();
      const letters = splitLetters(text);
      current = {
        key,
        text,
        speaker,
        letters,
        instant: instant || reduced(),
        shown: instant || reduced() ? letters.length : 0,
      };
      remaining = 28;
      emit();
      schedule();
    },
    finish() {
      stop();
      if (!current || current.shown === current.letters.length) return;
      current.instant = true;
      current.shown = current.letters.length;
      emit();
    },
    pause(value) {
      if (paused === value) return;
      if (value) remaining = Math.max(0, due - now());
      paused = value;
      stop();
      if (!paused) schedule(remaining);
    },
    cancel() {
      stop();
      current = null;
    },
    get complete() {
      return !current || current.shown === current.letters.length;
    },
  };
}

// Short, quiet syllables. The audio context opens through a player gesture.
export function createSpeechSounds({
  makeContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
} = {}) {
  let context = null,
    enabled = true;
  const voices = new Set();
  function stop() {
    for (const voice of voices) {
      voice.gain.gain.cancelScheduledValues(context.currentTime);
      voice.gain.gain.setTargetAtTime(0, context.currentTime, 0.004);
      voice.osc.stop(context.currentTime + 0.02);
    }
    voices.clear();
  }
  return {
    unlock() {
      if (!enabled) return;
      try {
        context ||= makeContext();
        if (context.state === "suspended")
          void context.resume().catch(() => {});
      } catch {
        /* Text remains available when audio is unavailable. */
      }
    },
    setEnabled(value) {
      enabled = value;
      if (!value) stop();
    },
    stop,
    syllable(speaker, letter, index) {
      if (
        !enabled ||
        !context ||
        context.state !== "running" ||
        voices.size >= 4
      )
        return;
      const base = { vale: 180, moth: 275, keeper: 115 }[speaker] || 145;
      const pitch =
        base * (0.94 + ((letter.codePointAt(0) + index) % 5) * 0.035);
      const now = context.currentTime;
      const osc = context.createOscillator(),
        gain = context.createGain(),
        filter = context.createBiquadFilter();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(pitch * 1.08, now);
      osc.frequency.exponentialRampToValueAtTime(pitch * 0.85, now + 0.065);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1100, now);
      filter.frequency.exponentialRampToValueAtTime(450, now + 0.065);
      filter.Q.value = 1.1;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.026, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      const voice = { osc, gain };
      voices.add(voice);
      osc.onended = () => {
        voices.delete(voice);
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
      osc.start(now);
      osc.stop(now + 0.07);
    },
  };
}

// A turn owns its exchange until every reply has had a readable beat.
// Existing dialogue controls can advance it; cards become ready at the end.
export function createExchange({
  show,
  settled = () => {},
  busy = () => {},
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let active = false,
    lines = [],
    index = -1,
    timer = null,
    due = 0,
    remaining = null,
    paused = false,
    completed = null;
  function clear() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function arm(delay) {
    clear();
    remaining = delay;
    due = now() + delay;
    if (!paused) timer = setTimer(advance, delay);
  }
  function finish() {
    clear();
    remaining = null;
    active = false;
    lines = [];
    index = -1;
    completed = null;
    busy(false);
  }
  function advance() {
    if (!active || index < 0 || completed !== lines[index]?.seq) return;
    clear();
    remaining = null;
    settled(lines[index]);
    completed = null;
    if (++index < lines.length) show(lines[index]);
    else finish();
  }
  return {
    begin() {
      clear();
      remaining = null;
      lines = [];
      index = -1;
      completed = null;
      active = true;
      busy(true);
    },
    load(value) {
      if (!active) return;
      lines = value;
      index = 0;
      if (lines.length) show(lines[0]);
      else finish();
    },
    revealed(seq, text, instant = false) {
      if (!active || seq !== lines[index]?.seq || completed === seq) return;
      completed = seq;
      arm(
        index === lines.length - 1
          ? 900
          : instant
            ? Math.min(9000, Math.max(2200, text.length * 25))
            : Math.min(2800, Math.max(1200, text.length * 12)),
      );
    },
    advance,
    cancel: finish,
    pause(value) {
      if (paused === value) return;
      if (value && timer !== null) remaining = Math.max(0, due - now());
      paused = value;
      clear();
      if (!paused && remaining !== null) arm(remaining);
    },
    get active() {
      return active;
    },
    get current() {
      return active ? lines[index] || null : null;
    },
    get hasNext() {
      return active && index >= 0 && index < lines.length - 1;
    },
  };
}
