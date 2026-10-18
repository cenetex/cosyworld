// A complete line gets its own clock, independent of network chunk timing.
export function splitLetters(text) {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    ({ segment }) => segment,
  );
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
}) {
  let current = null,
    timer = null,
    paused = false;
  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };
  const emit = () =>
    frame({ ...current, complete: current.shown === current.letters.length });
  function schedule(delay = 28) {
    if (!paused && current && current.shown < current.letters.length)
      timer = setTimeout(step, delay);
  }
  function step() {
    timer = null;
    if (!current || paused) return;
    const letter = current.letters[current.shown++];
    if (!reduced() && /[\p{L}\p{N}]/u.test(letter) && current.shown % 2 === 1)
      sound(current.speaker, letter, current.shown);
    emit();
    schedule(letterDelay(letter));
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
        shown: instant || reduced() ? letters.length : 0,
      };
      emit();
      schedule();
    },
    finish() {
      stop();
      if (!current || current.shown === current.letters.length) return;
      current.shown = current.letters.length;
      emit();
    },
    pause(value) {
      paused = value;
      stop();
      if (!paused) schedule();
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
