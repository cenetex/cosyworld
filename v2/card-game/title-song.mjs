import { mediaUrl } from "./media.mjs";
import streams from "./music-streams.json" with { type: "json" };
import {
  RETURN_FADE_SECONDS,
  contextAsleep,
  wakeContext,
} from "./audio-wake.mjs";

// The new-world title's song (title-intro.mjs). It starts on the player's
// first tap or key on the title, so the browser allows it, and fades out when
// they wake their avatar or skip. It plays once and never loops. It follows
// the saved music switch and volume; room music stays with music.mjs.
// The title lasts only a few seconds, so the song comes in at once (a quarter
// second against clicks) rather than over the 2-second fade that left it
// inaudible, and it sits `level` above the saved volume: it is mastered about
// 3 LU under the room songs (-18.3 against attic-1's -15.6 LUFS) and opens
// quieter still. A hidden tab pauses it in place; if it was playing, it fades
// back in from there when the tab returns, or on the next tap or key when the
// phone refuses to wake it without one.
export const TITLE_SONG = {
  file: "title-attic-lamp.mp3",
  title: "The Attic Keeps Its Lamp × Moonstone Sanctum",
  level: 1.4,
};
export const MUSIC_SETTINGS_KEY = "cosyworld.room-music";

export function titleSongSettings(storage) {
  let enabled = true,
    volume = 0.3;
  try {
    const saved = JSON.parse(storage?.getItem(MUSIC_SETTINGS_KEY) ?? "null");
    if (typeof saved?.enabled === "boolean") enabled = saved.enabled;
    if (Number.isFinite(saved?.volume))
      volume = Math.max(0, Math.min(1, saved.volume));
  } catch {}
  return { enabled, volume };
}

export function titleSongUrl() {
  const original = `assets/music/${TITLE_SONG.file}`;
  return mediaUrl(streams[original]?.file || original);
}

export function createTitleSong({
  storage = null,
  makeAudio = () => new Audio(),
  makeContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  fadeInSeconds = 0.25,
  doc = globalThis.document,
} = {}) {
  let audio = null,
    context = null,
    gain = null,
    target = 0,
    timer = null,
    stopped = false;

  // The media element's own volume steps the fade where Web Audio is missing.
  function ramp(to, seconds) {
    clearTimeout(timer);
    if (gain) {
      const at = context.currentTime;
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(gain.gain.value, at);
      gain.gain.linearRampToValueAtTime(to, at + seconds);
      return;
    }
    const from = audio.volume,
      begun = Date.now();
    const step = () => {
      const progress = seconds
        ? Math.min(1, (Date.now() - begun) / (seconds * 1000))
        : 1;
      try {
        audio.volume = from + (to - from) * progress;
      } catch {}
      if (progress < 1) timer = setTimeout(step, 25);
    };
    step();
  }
  let hidden = false,
    resumeOnShow = false,
    retryArmed = false;
  const gestures = ["pointerdown", "keydown"];
  const retry = () => {
    disarm();
    resume();
  };
  function arm() {
    if (retryArmed || !doc) return;
    retryArmed = true;
    for (const type of gestures)
      doc.addEventListener?.(type, retry, { capture: true });
  }
  function disarm() {
    if (!retryArmed) return;
    retryArmed = false;
    for (const type of gestures)
      doc.removeEventListener?.(type, retry, { capture: true });
  }
  // Pick up where the song was, unless the intro or the music switch ended it.
  function resume() {
    if (!audio || stopped || hidden || !resumeOnShow) return;
    if (audio.ended || !titleSongSettings(storage).enabled) {
      resumeOnShow = false;
      return;
    }
    // Until both the element and the context run, a tap or key retries.
    arm();
    let played;
    try {
      played = Promise.resolve(audio.paused ? audio.play() : undefined);
    } catch (error) {
      played = Promise.reject(error);
    }
    try {
      ramp(target, RETURN_FADE_SECONDS);
    } catch {}
    Promise.all([played, wakeContext(context)]).then(
      ([, awake]) => {
        if (awake && !audio.paused && !stopped) {
          resumeOnShow = false;
          disarm();
        }
      },
      () => {},
    );
  }
  function setHidden(value) {
    if (!audio || stopped || hidden === value) return;
    hidden = value;
    if (!hidden) return resume();
    // Pause in place, silent, so the return fades in from the same moment.
    if (!audio.paused && !audio.ended) resumeOnShow = true;
    disarm();
    try {
      ramp(0, 0);
      audio.pause();
    } catch {}
  }
  const onVisibility = () => setHidden(Boolean(doc.hidden));
  const onPageHide = () => setHidden(true);
  // A call or Siri can interrupt iOS audio while the page stays in view.
  const onContextState = () => {
    if (stopped || hidden || !audio) return;
    if (contextAsleep(context) && !audio.paused) {
      resumeOnShow = true;
      resume();
    }
  };
  const view = () => doc?.defaultView;

  return {
    // Call from inside the first tap or key on the title.
    start() {
      if (audio || stopped) return false;
      const { enabled, volume } = titleSongSettings(storage);
      if (!enabled || volume <= 0) return false;
      target = Math.min(1, volume * TITLE_SONG.level);
      try {
        audio = makeAudio();
        audio.preload = "auto";
        audio.loop = false;
        audio.src = titleSongUrl();
        try {
          context = makeContext();
          gain = context.createGain();
          gain.gain.value = 0;
          gain.connect(context.destination);
          context.createMediaElementSource(audio).connect(gain);
          audio.volume = 1;
          void wakeContext(context);
          context.addEventListener?.("statechange", onContextState);
        } catch {
          context = gain = null;
          audio.volume = 0;
        }
        Promise.resolve(audio.play()).catch(() => {});
        ramp(target, fadeInSeconds);
        hidden = Boolean(doc?.hidden);
        doc?.addEventListener?.("visibilitychange", onVisibility);
        view()?.addEventListener?.("pagehide", onPageHide);
        view()?.addEventListener?.("pageshow", onVisibility);
        return true;
      } catch {
        audio = null;
        return false;
      }
    },
    // Wake or skip: fade out, then stop for good. Settles once it is silent.
    stop(seconds = 1) {
      if (stopped || !audio) {
        stopped = true;
        return Promise.resolve();
      }
      stopped = true;
      resumeOnShow = false;
      disarm();
      doc?.removeEventListener?.("visibilitychange", onVisibility);
      view()?.removeEventListener?.("pagehide", onPageHide);
      view()?.removeEventListener?.("pageshow", onVisibility);
      context?.removeEventListener?.("statechange", onContextState);
      try {
        ramp(0, seconds);
      } catch {}
      return new Promise((resolve) =>
        setTimeout(() => {
          try {
            audio.pause();
            void context?.close?.().catch(() => {});
          } catch {}
          resolve();
        }, seconds * 1000),
      );
    },
    get audio() {
      return audio;
    },
  };
}
