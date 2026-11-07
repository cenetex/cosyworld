import { packPlaces } from "./pack-registry.mjs";
import { mediaUrl } from "./media.mjs";
import { reflectionOpen } from "./world.mjs";
import streams from "./music-streams.json" with { type: "json" };
import {
  RETURN_FADE_SECONDS,
  contextAsleep,
  wakeContext,
} from "./audio-wake.mjs";
import { CUE_TRACKS } from "./music-cues.mjs";

export const roomTracks = {
  "willows-camp": [
    { file: "willows-keep-to-bank-1.m4a", title: "Keep to the Bank" },
    { file: "willows-keep-to-bank-2.m4a", title: "Keep to the Bank II" },
    { file: "willows-dont-answer-trees.m4a", title: "Don't Answer the Trees" },
    { file: "willows-keep-to-bank-3.m4a", title: "Keep to the Bank III" },
  ],
  "greek-harbor": [
    { file: "greek-harbor.mp3", title: "Wine Dark Sea — Wine-Dark Harbor" },
    {
      file: "greek-harbor-2.mp3",
      title: "Wine Dark Sea — Wine-Dark Harbor II",
    },
  ],
  "greek-athens": [
    { file: "agora-1.mp3", title: "Wine, Black Sea" },
    { file: "agora-2.mp3", title: "Wine, Black Sea II" },
  ],
  "greek-courtyard": [
    { file: "greek-courtyard.mp3", title: "Wine Dark Sea — Theban Courtyard" },
  ],
  "greek-well": [
    { file: "greek-well.mp3", title: "Wine Dark Sea — Theban Market Well" },
  ],
  "greek-thinkery": [
    { file: "lofi-drift.mp3", title: "Local Proof Trebuchet — Lo-Fi Drift" },
  ],
  "greek-argolid-road": [
    { file: "road-after-sunset.mp3", title: "The Road After Sunset" },
  ],
  "greek-piraeus": [
    { file: "drift-jam.mp3", title: "Signal — Lo-Fi Drift Jam" },
  ],
  "greek-acropolis": [
    { file: "lofi-belt-miners.mp3", title: "Vector Veins — Lo-Fi Belt Miners" },
  ],
  "greek-jury-house": [{ file: "attic-1.mp3", title: "Music Box Waltz" }],
  "greek-aulis": [{ file: "station-2.mp3", title: "Faint Hope" }],
  "greek-underworld": [
    { file: "pond-2.mp3", title: "Something Below the Surface" },
  ],
  "greek-eleusis": [
    { file: "empty-seat.mp3", title: "An Empty Seat on the Carriage" },
  ],
  theatre: [{ file: "attic-1.mp3", title: "Music Box Waltz" }],
  belfry: [{ file: "pond-2.mp3", title: "Something Below the Surface" }],
  glasshouse: [
    { file: "fields-beyond-thornford.mp3", title: "Fields Beyond Thornford" },
  ],
  hill: [{ file: "drift-jam.mp3", title: "Signal — Lo-Fi Drift Jam" }],
  train: [{ file: "road-after-sunset.mp3", title: "The Road After Sunset" }],
  pavilion: [
    {
      file: "small-change-tall-stories.mp3",
      title: "Gloamgate — Small Change, Tall Stories",
    },
  ],
  loft: [{ file: "rain-on-canvas.mp3", title: "Rain on the Canvas" }],
  attic: [
    { file: "attic-1.mp3", title: "Music Box Waltz" },
    { file: "attic-2.mp3", title: "Music Box Waltz II" },
  ],
  pond: [
    { file: "pond-1.mp3", title: "Quiet Night" },
    { file: "pond-2.mp3", title: "Something Below the Surface" },
    { file: "pond-3.mp3", title: "Open Intervals" },
    { file: "pond-4.mp3", title: "Open Intervals II" },
  ],
  station: [
    { file: "station-1.mp3", title: "Wheels on the Track" },
    { file: "station-2.mp3", title: "Faint Hope" },
  ],
  ...Object.fromEntries(
    Object.entries(packPlaces)
      .filter(([, place]) => place.music)
      .map(([id, place]) => [id, place.music]),
  ),
};

// In the Vale attic opening, music first plays when the lamp goes out and
// the mirror shows the Black pond. A world or avatar without that opening,
// or one that has left the attic, plays music as soon as it has started.
export function openingRevealed(world, actor) {
  const opening = world?.opening;
  if (!opening || opening.crossed || actor !== "vale") return true;
  if (world.actors?.vale?.place !== "attic") return true;
  return (
    reflectionOpen(world, "attic") ||
    (world.log || []).some(
      (entry) =>
        entry?.locationId === "attic" &&
        entry.text?.startsWith("The attic mirror opens"),
    )
  );
}

// A room starts a song when music is idle. The song follows every journey
// until its end. The audio clock keeps volume and pause fades smooth.
// A hidden tab fades the song out and pauses it in place; the return wakes
// the audio context (phones put it to sleep) and fades back in from there.
// cue(name) plays a song from music-cues.mjs over the room for a moment of
// play, such as a battle; cue(null) brings the room song back from its place.
export function createRoomMusic({
  audio,
  cues = null,
  changed = () => {},
  makeContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  now = () => performance.now() / 1000,
  random = Math.random,
}) {
  const fadeSeconds = 1;
  let room = null,
    cued = null,
    phase = "day",
    sourceRoom = null,
    loadedFile = null,
    restartOnVisit = false,
    unlocked = false,
    started = false,
    enabled = true,
    hidden = false,
    quiet = false,
    returning = false,
    pending = false,
    generation = 0,
    failures = 0,
    volume = 0.3,
    context = null,
    gain = null,
    graphAttempted = false,
    transitionTimer = null,
    volumeTimer = null,
    ending = false,
    envelope = { from: 0, to: 0, start: 0, seconds: 0 };
  const positions = new Map();
  audio.preload = "none";
  audio.volume = 0;

  const clock = () => (context ? context.currentTime : now());
  function level() {
    const progress = envelope.seconds
      ? Math.max(0, Math.min(1, (clock() - envelope.start) / envelope.seconds))
      : 1;
    return envelope.from + (envelope.to - envelope.from) * progress;
  }
  function fadeTo(to, seconds) {
    const from = level(),
      start = clock();
    clearTimeout(volumeTimer);
    envelope = { from, to, start, seconds };
    if (gain) {
      gain.gain.cancelScheduledValues(start);
      gain.gain.setValueAtTime(from, start);
      gain.gain.linearRampToValueAtTime(to, start + seconds);
    } else {
      // Older browsers can use the same envelope on the media element.
      const step = () => {
        audio.volume = level();
        if (clock() < start + seconds) volumeTimer = setTimeout(step, 25);
      };
      step();
    }
  }
  function unlockGraph() {
    if (!graphAttempted) {
      graphAttempted = true;
      try {
        const nextContext = makeContext();
        const nextGain = nextContext.createGain();
        nextGain.gain.value = 0;
        nextGain.connect(nextContext.destination);
        nextContext.createMediaElementSource(audio).connect(nextGain);
        // A call or Siri can interrupt iOS audio while the page stays in view.
        nextContext.addEventListener?.("statechange", () => {
          if (!hidden && contextAsleep(nextContext) && wanted())
            void wakeContext(nextContext);
        });
        context = nextContext;
        gain = nextGain;
        audio.volume = 1;
      } catch {
        // The media-element fade remains available.
      }
    }
    void wakeContext(context);
  }
  // The first fade in after the tab returns is short, not the full second.
  function fadeIn() {
    fadeTo(volume, returning ? RETURN_FADE_SECONDS : fadeSeconds);
    returning = false;
  }
  const trackRoom = () => sourceRoom || room;
  function track() {
    if (!sourceRoom && room === "willows-camp" && phase !== "day") return null;
    const id = trackRoom();
    return roomTracks[id]?.[positions.get(id) || 0];
  }
  const randomPerVisit = () =>
    trackRoom() === "willows-camp" ||
    packPlaces[trackRoom()]?.musicMode === "random-per-visit";
  function wanted() {
    return (
      started &&
      !cued &&
      unlocked &&
      enabled &&
      !hidden &&
      !quiet &&
      track() &&
      failures < roomTracks[trackRoom()].length
    );
  }
  function report() {
    changed({
      enabled,
      started,
      title: CUE_TRACKS[cued]?.title || track()?.title || "",
      playing: Boolean(cued) || !audio.paused,
      failed: failures >= (roomTracks[trackRoom()]?.length || 1),
    });
  }
  function pause() {
    generation++;
    pending = false;
    fadeTo(0, 0);
    audio.pause();
    report();
  }
  function afterFade(action) {
    if (audio.paused || level() === 0) {
      action();
      return;
    }
    const remaining = audio.duration - audio.currentTime;
    const seconds =
      Number.isFinite(remaining) && remaining > 0
        ? Math.min(fadeSeconds, remaining)
        : fadeSeconds;
    fadeTo(0, seconds);
    transitionTimer = setTimeout(() => {
      transitionTimer = null;
      fadeTo(0, 0);
      action();
    }, seconds * 1000);
  }
  function load() {
    pause();
    if (!sourceRoom) {
      sourceRoom = room;
      if (randomPerVisit())
        positions.set(
          sourceRoom,
          Math.floor(random() * roomTracks[sourceRoom].length),
        );
    }
    const next = track();
    const buffered = next && loadedFile === next.file && !audio.error;
    loadedFile = next?.file || null;
    restartOnVisit = false;
    ending = false;
    if (buffered) audio.currentTime = 0;
    else {
      if (next) {
        const original = `assets/music/${next.file}`;
        audio.src = mediaUrl(streams[original]?.file || original);
      } else audio.removeAttribute("src");
      audio.load();
    }
    start();
  }
  function start() {
    if (!wanted() || pending || !audio.paused || transitionTimer !== null)
      return;
    if (loadedFile !== track()?.file || restartOnVisit) {
      load();
      return;
    }
    unlockGraph();
    ending = false;
    const attempt = ++generation;
    pending = true;
    try {
      Promise.resolve(audio.play()).then(
        () => {
          if (attempt !== generation) return;
          pending = false;
          fadeIn();
          report();
        },
        () => {
          if (attempt !== generation) return;
          pending = false;
          report();
        },
      );
    } catch {
      pending = false;
      report();
    }
  }
  function sync() {
    clearTimeout(transitionTimer);
    transitionTimer = null;
    generation++;
    pending = false;
    if (!wanted()) {
      returning = false;
      afterFade(pause);
    } else if (loadedFile !== track()?.file || restartOnVisit) afterFade(load);
    else if (audio.paused) start();
    else if (!ending) fadeIn();
  }
  function advance() {
    const id = trackRoom();
    positions.set(id, ((positions.get(id) || 0) + 1) % roomTracks[id].length);
  }
  audio.addEventListener("timeupdate", () => {
    const remaining = audio.duration - audio.currentTime;
    if (
      !ending &&
      transitionTimer === null &&
      wanted() &&
      !audio.paused &&
      remaining > 0 &&
      remaining <= fadeSeconds
    ) {
      ending = true;
      fadeTo(0, remaining);
    }
  });
  audio.addEventListener("ended", () => {
    if (loadedFile === track()?.file) {
      failures = 0;
      if (!randomPerVisit()) advance();
      sourceRoom = null;
      restartOnVisit = true;
    }
    sync();
  });
  audio.addEventListener("playing", () => {
    failures = 0;
    report();
  });
  audio.addEventListener("error", () => {
    if (loadedFile === track()?.file) {
      failures++;
      if (failures < roomTracks[trackRoom()].length) advance();
    }
    pause();
    sync();
  });
  function cueChanged() {
    if (cued === (cues?.current ?? null)) return;
    cued = cues?.current ?? null;
    sync();
    report();
  }
  cues?.onChange?.(cueChanged);
  return {
    // Whether a cue song is still audible, fading out included.
    get cueSounding() {
      return Boolean(cues?.sounding);
    },
    cue(name = null, scope) {
      cues?.cue(name, scope);
      cueChanged();
    },
    setStarted(value) {
      cues?.setStarted(value);
      if (started === Boolean(value)) {
        // The waiting status follows plays made before music starts.
        if (!started) report();
        return;
      }
      started = Boolean(value);
      if (!started) {
        sourceRoom = null;
        restartOnVisit = true;
        failures = 0;
        unlocked = false;
        clearTimeout(transitionTimer);
        transitionTimer = null;
        pause();
      } else sync();
      report();
    },
    setRoom(value, daylight = "day") {
      if (room === value && phase === daylight) return;
      room = value;
      phase = daylight;
      if (failures >= (roomTracks[trackRoom()]?.length || 1)) {
        sourceRoom = null;
        failures = 0;
        restartOnVisit = true;
      }
      sync();
    },
    unlock() {
      // Keep the gesture while a shared item play waits for the server.
      // wanted() holds playback until that avatar's play is accepted.
      unlocked = true;
      cues?.unlock();
      if (enabled && !hidden) unlockGraph();
      start();
    },
    setEnabled(value) {
      enabled = Boolean(value);
      cues?.setEnabled(enabled);
      if (enabled && failures) {
        failures = 0;
        pause();
        loadedFile = null;
      }
      sync();
      report();
    },
    setVolume(value) {
      if (!Number.isFinite(value)) return;
      volume = Math.max(0, Math.min(1, value));
      cues?.setVolume(volume);
      if (
        wanted() &&
        !audio.paused &&
        !pending &&
        transitionTimer === null &&
        !ending
      )
        fadeTo(volume, 0.15);
    },
    setHidden(value) {
      if (hidden === Boolean(value)) return;
      hidden = Boolean(value);
      cues?.setHidden(hidden);
      if (!hidden) {
        returning = true;
        void wakeContext(context);
      }
      sync();
    },
    // Settings fades the song out and holds its place; closing it fades the
    // song back in from there, as a returning tab does.
    setQuiet(value) {
      if (quiet === Boolean(value)) return;
      quiet = Boolean(value);
      cues?.setQuiet(quiet);
      if (!quiet) {
        returning = true;
        void wakeContext(context);
      }
      sync();
    },
  };
}
