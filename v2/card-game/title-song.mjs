import { mediaUrl } from "./media.mjs";
import streams from "./music-streams.json" with { type: "json" };

// The new-world title's song (title-intro.mjs). It starts on the player's
// first tap or key on the title, so the browser allows it, and fades out when
// they wake their avatar or skip. It plays once and never loops. It follows
// the saved music switch and volume; room music stays with music.mjs.
export const TITLE_SONG = {
  file: "title-attic-lamp.mp3",
  title: "The Attic Keeps Its Lamp × Moonstone Sanctum",
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
  fadeInSeconds = 2,
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
  const onVisibility = () => {
    if (!audio || stopped) return;
    if (doc.hidden) audio.pause();
    else if (!audio.ended) Promise.resolve(audio.play?.()).catch(() => {});
  };

  return {
    // Call from inside the first tap or key on the title.
    start() {
      if (audio || stopped) return false;
      const { enabled, volume } = titleSongSettings(storage);
      if (!enabled || volume <= 0) return false;
      target = volume;
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
          if (context.state === "suspended")
            void context.resume?.().catch(() => {});
        } catch {
          context = gain = null;
          audio.volume = 0;
        }
        Promise.resolve(audio.play()).catch(() => {});
        ramp(target, fadeInSeconds);
        doc?.addEventListener?.("visibilitychange", onVisibility);
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
      doc?.removeEventListener?.("visibilitychange", onVisibility);
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
