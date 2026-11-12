// A complete line gets its own clock, independent of network chunk timing.
// The same reveal writes dialogue and the effects inscribed on beat cards
// (app.mjs): one letter at a time on one steady beat, with a short rest after
// punctuation. Each letter fades in over REVEAL_FADE_MS (style.css
// `.speech-letter`), so two or three are soft at once.
export const REVEAL_FADE_MS = 60,
  REVEAL_FINISH_MS = 150;
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
  // The ms after each letter (and its index) before the next.
  delay = letterDelay,
  now = () => performance.now(),
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
}) {
  let current = null,
    timer = null,
    paused = false,
    due = 0,
    remaining = 28,
    quickUntil = 0;
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
    // A quickened section still paints in order, at most four letters per frame.
    const steps = quickUntil
      ? Math.min(4, 1 + Math.floor((time - due) / 8))
      : 1;
    for (let i = 0; i < steps; i++) {
      const letter = current.letters[current.shown++];
      if (!reduced() && /[\p{L}\p{N}]/u.test(letter) && current.shown % 2 === 1)
        sound(current.speaker, letter, current.shown);
      if (quickUntil && current.shown === quickUntil) {
        quickUntil = 0;
        due = time;
        break;
      }
      const pause = quickUntil ? 8 : delay(letter, current.shown - 1);
      due = quickUntil ? due + pause : Math.max(due + pause, time + pause / 2);
    }
    if (quickUntil) due = Math.max(due, time + 4);
    emit();
    // Keep the cadence through small frame delays. A slow frame reveals one
    // letter, and the clock never catches up faster than twice the beat, so
    // returning from a busy frame keeps a steady beat rather than a burst.
    queue();
  }
  return {
    show(key, text, speaker, { instant = false } = {}) {
      if (current?.key === key) return;
      stop();
      quickUntil = 0;
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
    finish(until = current?.letters.length) {
      stop();
      quickUntil = 0;
      if (!current || current.shown === current.letters.length) return;
      current.instant = true;
      current.shown = Math.max(
        current.shown,
        Math.min(until, current.letters.length),
      );
      emit();
      if (current.shown < current.letters.length) {
        current.instant = false;
        remaining = delay(
          current.letters[current.shown - 1],
          current.shown - 1,
        );
        schedule(remaining);
      }
    },
    accelerate(until = current?.letters.length) {
      if (!current || current.shown === current.letters.length || quickUntil)
        return;
      const end = Math.min(current.letters.length, until);
      if (end < current.shown) return;
      quickUntil = end === current.shown ? 0 : end;
      stop();
      remaining = quickUntil ? 8 : 0;
      schedule(remaining);
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
      quickUntil = 0;
      current = null;
    },
    get complete() {
      return !current || current.shown === current.letters.length;
    },
    get quick() {
      return quickUntil > 0;
    },
  };
}

// One span per letter, laid out whole from the start and hidden until its
// turn, so nothing reflows as it writes.
export function letterSpans(text) {
  return splitLetters(text).map((letter) => {
    const span = document.createElement("span");
    span.className = "speech-letter";
    span.textContent = letter;
    return span;
  });
}

// Paints a reveal's frames onto its letter spans, wherever they sit (inside
// links too). The newest letter carries the caret; a tap fades the rest in
// together; a line already read shows at once. Once whole, the spans fold
// back into plain text, and `rest` keeps the last letter with its caret.
export function createRevealPainter(root, { caret = true, rest = false } = {}) {
  let glyphs = [],
    shown = 0,
    painted = false,
    timer = null;
  const fold = () => {
    timer = null;
    const kept = rest ? glyphs.at(-1) : null;
    for (const glyph of glyphs)
      if (glyph !== kept) glyph.replaceWith(glyph.textContent);
    root.normalize();
    glyphs = [];
  };
  return {
    start(spans) {
      clearTimeout(timer);
      timer = null;
      glyphs = spans;
      shown = 0;
      painted = false;
      delete root.dataset.reveal;
    },
    paint({ shown: next, complete }) {
      if (!glyphs.length) return;
      glyphs[shown - 1]?.classList.remove("cursor");
      if (next - shown > 1)
        root.dataset.reveal = painted ? "finish" : "instant";
      else if (!complete) delete root.dataset.reveal;
      for (let i = shown; i < next; i++) glyphs[i].classList.add("revealed");
      shown = next;
      painted = true;
      root.dataset.revealing = String(!complete);
      if (caret && (rest || !complete))
        glyphs[shown - 1]?.classList.add("cursor");
      if (!complete || timer) return;
      const fade = { instant: 0, finish: REVEAL_FINISH_MS }[
        root.dataset.reveal
      ];
      timer = setTimeout(fold, (fade ?? REVEAL_FADE_MS) + 40);
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

// Image failures and slow networks settle within one bounded entrance beat.
export function waitForScene(tasks, timeoutMs = 8000) {
  let timer;
  return Promise.race([
    Promise.allSettled(tasks),
    new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

// A turn owns its exchange until every reply has had a readable beat.
// Card selection stays available; the next committed play waits for this beat.
export function createExchange({
  show,
  prepare,
  settled = () => {},
  transition = () => {},
  busy = () => {},
  holdLast = () => false,
}) {
  let generation = 0,
    active = false,
    lines = [],
    index = -1,
    paused = false,
    completed = null,
    handoff = null,
    streaming = false,
    transitioning = false;
  function finish() {
    generation++;
    active = false;
    lines = [];
    index = -1;
    completed = null;
    handoff = null;
    transitioning = false;
    streaming = false;
    busy(false);
  }
  function advance() {
    if (
      !active ||
      paused ||
      transitioning ||
      index < 0 ||
      completed !== lines[index]?.seq
    )
      return;
    // A pending reply keeps this line until a fresh tap can advance it.
    if (streaming && index + 1 >= lines.length) return;
    transitioning = true;
    const previous = lines[index];
    completed = null;
    settled(previous);
    const version = generation;
    const next = lines[index + 1] || null;
    const resume = () => {
      if (!active || version !== generation) return;
      if (paused) {
        handoff = resume;
        return;
      }
      handoff = null;
      transitioning = false;
      if (++index < lines.length) show(next);
      else finish();
    };
    const transitionWork = transition(previous, next);
    if (transitionWork?.then) void transitionWork.then(resume, resume);
    else resume();
  }
  function settleLast() {
    if (!streaming && index === lines.length - 1 && !holdLast()) advance();
  }

  return {
    begin() {
      generation++;
      lines = [];
      index = -1;
      completed = null;
      handoff = null;
      transitioning = false;
      streaming = false;
      active = true;
      busy(true);
    },
    load(value, { pending = false } = {}) {
      if (!active) return;
      if (streaming) {
        lines = value;
        streaming = pending;
        settleLast();
        return;
      }
      streaming = pending;
      busy(true);
      lines = value;
      index = -1;
      const version = ++generation;
      const start = () => {
        if (!active || version !== generation) return;
        index = 0;
        if (lines.length) show(lines[0]);
        else finish();
      };
      if (prepare) void Promise.resolve().then(prepare).then(start, start);
      else start();
    },
    revealed(seq) {
      if (
        !active ||
        transitioning ||
        seq !== lines[index]?.seq ||
        completed === seq
      )
        return;
      completed = seq;
      settleLast();
    },
    advance,
    settleLast,
    cancel: finish,
    pause(value) {
      if (paused === value) return;
      paused = value;
      if (!paused && handoff) handoff();
      else if (!paused) settleLast();
    },
    get active() {
      return active;
    },
    get preparing() {
      return active && index < 0;
    },
    get current() {
      return active ? lines[index] || null : null;
    },
    // The full line is visible and its voice has finished.
    get read() {
      return active && index >= 0 && completed === lines[index]?.seq;
    },
    get hasNext() {
      return active && index >= 0 && (streaming || index < lines.length - 1);
    },
    get waiting() {
      return active && index >= 0 && streaming && index + 1 >= lines.length;
    },
  };
}

// Keep one explicit next play. The world checks its revision when it runs.
// `ready(action)` decides when it may run, so a play can wait on words still
// coming for the play before it.
export function createPlayQueue({ ready, play, changed = () => {} }) {
  let pending = null;
  function clear() {
    if (!pending) return;
    pending = null;
    changed(null);
  }
  function flush() {
    if (!pending || !ready(pending.action)) return false;
    const next = pending;
    clear();
    play(next.action, next.revision);
    return true;
  }
  return {
    submit(action, revision) {
      pending = { action, revision };
      if (!flush()) changed(pending);
    },
    flush,
    clear,
    get pending() {
      return pending;
    },
  };
}

// A timer may wake just before a fractional animation deadline. Keep its
// callback due until the clock reaches the latest deadline.
export function afterDeadline(
  deadline,
  callback,
  { now = () => performance.now(), schedule = setTimeout } = {},
) {
  const check = () => {
    const remaining = deadline() - now();
    if (remaining > 0) schedule(check, Math.ceil(remaining));
    else callback();
  };
  schedule(check, Math.max(0, Math.ceil(deadline() - now())));
}
