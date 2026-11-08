import { mediaUrl } from "./media.mjs";
import streams from "./music-streams.json" with { type: "json" };
import { RETURN_FADE_SECONDS, wakeContext } from "./audio-wake.mjs";
import { packPlaces } from "./pack-registry.mjs";

// Songs that take over from the room song for a moment of play, through
// music.cue(name) in music.mjs. Most cues loop; a performance plays through
// once. Fades and waits are in seconds.

// The battle song comes in over the second the room song takes to fade out.
const battle = {
  file: "battle-attic-lamp.mp3",
  title: "The Attic Keeps Its Lamp",
  fadeIn: 1,
  fadeOut: 1.5,
};
// One beat of the battle song, measured from the file (about 95 a minute).
export const BATTLE_BEAT_SECONDS = 60 / 95;
export const RATIRADIO_PERFORMANCE = {
  file: "night-shift-on-ratiradio-remastered.mp3",
  title: "Night Shift on RatiRadio — ratimics",
  fadeIn: 2,
  fadeOut: 2,
  once: true,
  remember: true,
};
export const CUE_TRACKS = {
  battle,
  funeral: {
    file: "hillside-sanctuary.mp3",
    title: "The Hillside Sanctuary",
    fadeIn: 5,
    fadeOut: 2,
    once: true,
  },
  ...(packPlaces["ratiradio-broadcast-booth"]
    ? { ratiradio: RATIRADIO_PERFORMANCE }
    : {}),
  // The loss screen's song waits for the battle song to fade under the fade
  // to black, holds three of its beats of silence, then comes in slowly.
  // Leaving the loss screen fades it out fully before the lift (app.mjs).
  "battle-loss": {
    file: "battle-loss-moonstone.mp3",
    title: "Moonstone Sanctuary",
    wait: battle.fadeOut + 3 * BATTLE_BEAT_SECONDS,
    fadeIn: 5,
    fadeOut: 2,
  },
};
// Silence that still holds the room song back: a cue with no song.
export const HUSH = "hush";

// A battle is an open standoff (rules 84): from the threat until a round
// without a Strike, the disputed item's release, or too few fighters. Its
// song plays while the player fights in one or stands in its locked room.
export function battleMusicDue(world, actor) {
  const place = world?.actors?.[actor]?.place;
  return (world?.standoffs || []).some(
    (c) => Object.hasOwn(c.resolve || {}, actor) || c.location === place,
  );
}

export function funeralMusicDue(world, actor) {
  return (
    world?.actors?.[actor]?.place === "greek-polynices-hollow" &&
    world.packs?.["greek-drama"]?.flags?.["greek-burial-performed"] === true
  );
}

export const radioMusicDue = (world, actor) =>
  world?.actors?.[actor]?.place === "ratiradio-broadcast-booth";

export function createMusicCues({
  makeAudio = () => new Audio(),
  tracks = CUE_TRACKS,
  storage,
  ...options
} = {}) {
  let current = null,
    requested = null,
    scope,
    changed = () => {};
  const remembered = new Set();
  function wasPlayed(name, save = false) {
    if (!tracks[name]?.remember || scope === undefined) return false;
    const key = `cosyworld.performance:${scope}:${name}`;
    if (save) remembered.add(key);
    try {
      const store = storage ?? globalThis.localStorage;
      if (save) store?.setItem(key, "1");
      return remembered.has(key) || store?.getItem(key) === "1";
    } catch {
      return remembered.has(key);
    }
  }
  const players = Object.entries(tracks).map(([name, track]) => [
    name,
    createCueTrack({
      audio: makeAudio(),
      track,
      ...options,
      canStart: () => !wasPlayed(name),
      played: () => wasPlayed(name, true),
      ended: () => {
        if (current === name) select(null, name);
      },
    }),
  ]);
  function select(name, completed = null) {
    if (current === name) return;
    current = name;
    for (const [id, player] of players) player.setActive(id === current);
    changed(completed);
  }
  const each = (method) => (value) => {
    for (const [, player] of players) player[method](value);
  };
  return {
    cue(name, worldScope) {
      if (worldScope !== undefined && scope !== worldScope) {
        scope = worldScope;
        requested = null;
        for (const [, player] of players) player.reset();
        select(null);
      }
      name = tracks[name] || name === HUSH ? name : null;
      if (requested === name) return;
      requested = name;
      if (current !== name && wasPlayed(name)) name = null;
      // A started performance follows the listener until its final note.
      if (
        !name &&
        tracks[current]?.once &&
        players.find(([id]) => id === current)?.[1].performed
      )
        return;
      select(name);
    },
    onChange(listener) {
      changed = listener;
    },
    get current() {
      return current;
    },
    // Whether a cue song is still audible, fading out included.
    get sounding() {
      return players.some(([, player]) => player.sounding);
    },
    setStarted: each("setStarted"),
    setEnabled: each("setEnabled"),
    setHidden: each("setHidden"),
    setQuiet: each("setQuiet"),
    setVolume: each("setVolume"),
    unlock: each("unlock"),
  };
}

// One song with the room song's switch, volume and hidden-tab rules.
// A cue that holds (a new battle round, another strike) never restarts it.
// A cue that ends fades out and stops; its next use starts from the top.
function createCueTrack({
  audio,
  track,
  ended = () => {},
  canStart = () => true,
  played = () => {},
  makeContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  now = () => performance.now() / 1000,
}) {
  const flags = {
    active: false,
    started: false,
    unlocked: false,
    quiet: false,
  };
  flags.enabled = true;
  let hidden = false,
    returning = false,
    loaded = false,
    fresh = true,
    performed = false,
    volume = 0.3,
    generation = 0,
    context = null,
    gain = null,
    stopTimer = null,
    waitTimer = null,
    cuedAt = 0,
    envelope = { from: 0, to: 0, start: 0, seconds: 0 };
  audio.preload = "none";
  audio.loop = !track.once;
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
    flags.active &&
    flags.started &&
    flags.unlocked &&
    flags.enabled &&
    !flags.quiet &&
    !hidden;
  function fadeIn() {
    fadeTo(volume, returning ? RETURN_FADE_SECONDS : track.fadeIn);
    returning = false;
  }
  function sync() {
    clearTimeout(stopTimer);
    clearTimeout(waitTimer);
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
    // A song that waits starts only once its wait from the cue has passed.
    const left = fresh ? (track.wait || 0) - (now() - cuedAt) : 0;
    if (left > 0) return void (waitTimer = setTimeout(sync, left * 1000));
    // Another tab may have begun this listener's performance while muted.
    if (!performed && !canStart()) return ended();
    if (!loaded) {
      const original = `assets/music/${track.file}`;
      audio.src = mediaUrl(streams[original]?.file || original);
      loaded = true;
    } else if (fresh) audio.currentTime = 0;
    fresh = false;
    try {
      Promise.resolve(audio.play()).then(
        () => {
          if (attempt === generation) {
            if (!performed) played();
            performed = true;
            fadeIn();
          }
        },
        () => {},
      );
    } catch {}
  }
  audio.addEventListener?.("error", () => (loaded = false));
  audio.addEventListener?.("ended", () => {
    if (track.once && flags.active) ended();
  });
  const set = (key) => (value) => {
    if (flags[key] === Boolean(value)) return;
    flags[key] = Boolean(value);
    sync();
  };
  const setActive = set("active");
  return {
    setActive(value) {
      if (value && !flags.active) {
        cuedAt = now();
        if (track.once && fresh) {
          audio.pause();
          performed = false;
        }
      }
      setActive(value);
    },
    get performed() {
      return performed;
    },
    reset() {
      clearTimeout(stopTimer);
      clearTimeout(waitTimer);
      generation++;
      flags.active = false;
      fresh = true;
      performed = false;
      fadeTo(0, 0);
      audio.pause();
    },
    get sounding() {
      return !audio.paused;
    },
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
    // Settings fades the song out over its fade and resumes it in place.
    setQuiet(value) {
      if (flags.quiet === Boolean(value)) return;
      flags.quiet = Boolean(value);
      if (!flags.quiet) returning = true;
      sync();
    },
  };
}
