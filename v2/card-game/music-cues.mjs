import { mediaUrl } from "./media.mjs";
import streams from "./music-streams.json" with { type: "json" };
import { RETURN_FADE_SECONDS, wakeContext } from "./audio-wake.mjs";

// Songs that take over from the room song for a moment of play, through
// music.cue(name) in music.mjs. Each file is a seamless loop: the song's last
// second of decay is mixed over its first. Fades are in seconds.
export const CUE_TRACKS = {
  // In over the second the room song takes to fade out.
  battle: {
    file: "battle-attic-lamp.mp3",
    title: "The Attic Keeps Its Lamp",
    fadeIn: 1,
    fadeOut: 1.5,
  },
  // In under the defeat's 1.4-second fade to black as the battle song
  // leaves; out as the room song returns.
  "battle-loss": {
    file: "battle-loss-moonstone.mp3",
    title: "Moonstone Sanctuary",
    fadeIn: 1.5,
    fadeOut: 1,
  },
};

// A battle is an open standoff (rules 84): from the threat until a round
// without a Strike, the disputed item's release, or too few fighters. Its
// song plays while the player fights in one or stands in its locked room.
export function battleMusicDue(world, actor) {
  const place = world?.actors?.[actor]?.place;
  return (world?.standoffs || []).some(
    (c) => Object.hasOwn(c.resolve || {}, actor) || c.location === place,
  );
}

export function createMusicCues({
  makeAudio = () => new Audio(),
  ...options
} = {}) {
  const players = Object.entries(CUE_TRACKS).map(([name, track]) => [
    name,
    createCueTrack({ audio: makeAudio(), track, ...options }),
  ]);
  let current = null;
  const each = (method) => (value) => {
    for (const [, player] of players) player[method](value);
  };
  return {
    cue(name) {
      current = CUE_TRACKS[name] ? name : null;
      for (const [id, player] of players) player.setActive(id === current);
    },
    get current() {
      return current;
    },
    setStarted: each("setStarted"),
    setEnabled: each("setEnabled"),
    setHidden: each("setHidden"),
    setVolume: each("setVolume"),
    unlock: each("unlock"),
  };
}

// One looping song with the room song's switch, volume and hidden-tab rules.
// A cue that holds (a new battle round, another strike) never restarts it.
// A cue that ends fades out and stops; its next use starts from the top.
function createCueTrack({
  audio,
  track,
  makeContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  now = () => performance.now() / 1000,
}) {
  const flags = { active: false, started: false, unlocked: false };
  flags.enabled = true;
  let hidden = false,
    returning = false,
    loaded = false,
    fresh = true,
    volume = 0.3,
    generation = 0,
    context = null,
    gain = null,
    stopTimer = null,
    envelope = { from: 0, to: 0, start: 0, seconds: 0 };
  audio.preload = "none";
  audio.loop = true;
  audio.volume = 0;

  const clock = () => (context ? context.currentTime : now());
  function level() {
    const { from, to, start, seconds } = envelope;
    const progress = seconds ? (clock() - start) / seconds : 1;
    return from + (to - from) * Math.max(0, Math.min(1, progress));
  }
  function fadeTo(to, seconds) {
    const from = level(),
      start = clock();
    envelope = { from, to, start, seconds };
    // Without Web Audio the media element's volume changes at once.
    if (!gain) return void (audio.volume = to);
    gain.gain.cancelScheduledValues(start);
    gain.gain.setValueAtTime(from, start);
    gain.gain.linearRampToValueAtTime(to, start + seconds);
  }
  function unlockGraph() {
    if (context === null) {
      context = false;
      try {
        const next = makeContext();
        const nextGain = next.createGain();
        nextGain.gain.value = 0;
        nextGain.connect(next.destination);
        next.createMediaElementSource(audio).connect(nextGain);
        [context, gain, audio.volume] = [next, nextGain, 1];
      } catch {}
    }
    void wakeContext(context || null);
  }
  const wanted = () =>
    flags.active && flags.started && flags.unlocked && flags.enabled && !hidden;
  function fadeIn() {
    fadeTo(volume, returning ? RETURN_FADE_SECONDS : track.fadeIn);
    returning = false;
  }
  function sync() {
    clearTimeout(stopTimer);
    const attempt = ++generation;
    if (!wanted()) {
      if (!flags.active) fresh = true;
      if (audio.paused) return;
      // A hidden tab pauses in place at once; anything else fades out first.
      const seconds = hidden ? 0 : track.fadeOut;
      fadeTo(0, seconds);
      stopTimer = setTimeout(() => {
        fadeTo(0, 0);
        audio.pause();
      }, seconds * 1000);
      return;
    }
    unlockGraph();
    // A fade out under way turns back from where it is.
    if (!audio.paused) return fadeIn();
    if (!loaded) {
      const original = `assets/music/${track.file}`;
      audio.src = mediaUrl(streams[original]?.file || original);
      loaded = true;
    } else if (fresh) audio.currentTime = 0;
    fresh = false;
    try {
      Promise.resolve(audio.play()).then(
        () => attempt === generation && fadeIn(),
        () => {},
      );
    } catch {}
  }
  audio.addEventListener?.("error", () => (loaded = false));
  const set = (key) => (value) => {
    if (flags[key] === Boolean(value)) return;
    flags[key] = Boolean(value);
    sync();
  };
  return {
    setActive: set("active"),
    setStarted: set("started"),
    // Each tap or key: a refused play() tries again here.
    unlock() {
      const first = !flags.unlocked;
      flags.unlocked = true;
      void wakeContext(context || null);
      if (first || (wanted() && audio.paused)) sync();
    },
    setEnabled: set("enabled"),
    setVolume(value) {
      if (!Number.isFinite(value)) return;
      volume = Math.max(0, Math.min(1, value));
      if (wanted() && !audio.paused) fadeTo(volume, 0.15);
    },
    setHidden(value) {
      if (hidden === Boolean(value)) return;
      hidden = Boolean(value);
      if (!hidden) {
        returning = true;
        void wakeContext(context || null);
      }
      sync();
    },
  };
}
