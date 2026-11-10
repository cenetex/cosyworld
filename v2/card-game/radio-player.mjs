import { createRadioStation } from "./radio-station.mjs";
import { mediaUrl } from "./media.mjs";
import streams from "./music-streams.json" with { type: "json" };
import { contextAsleep, wakeContext } from "./audio-wake.mjs";

// The station clock, never the media element, decides which song and position.
export function createRadioPlayer({
  audio = new Audio(),
  makeStation = createRadioStation,
  makeContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  changed = () => {},
} = {}) {
  const flags = {
    active: false,
    started: false,
    unlocked: false,
    enabled: true,
    hidden: false,
    quiet: false,
  };
  let running = false,
    snapshot = null,
    generation = 0,
    pending = false,
    volume = 0.3,
    context,
    gain,
    failed = false;
  audio.preload = "none";
  audio.loop = false;
  audio.volume = 0;
  const wanted = () =>
    flags.active &&
    flags.started &&
    flags.unlocked &&
    flags.enabled &&
    !flags.hidden &&
    !flags.quiet;
  const report = () =>
    changed({
      title: snapshot
        ? `RatiRadio: ${snapshot.track.title} — made by ratimics`
        : "RatiRadio is off the air",
      playing: !audio.paused && !contextAsleep(context),
      failed,
    });
  function level(value) {
    if (gain) gain.gain.setValueAtTime(value, context.currentTime);
    else audio.volume = value;
  }
  function pause() {
    generation++;
    pending = false;
    level(0);
    audio.pause();
  }
  function unlock() {
    if (context === undefined) {
      context = null;
      try {
        const next = makeContext(),
          nextGain = next.createGain();
        nextGain.gain.value = 0;
        nextGain.connect(next.destination);
        next.createMediaElementSource(audio).connect(nextGain);
        next.addEventListener?.("statechange", () => {
          if (wanted() && contextAsleep(next)) void wakeContext(next).then(report);
          report();
        });
        context = next;
        gain = nextGain;
        audio.volume = 1;
      } catch {}
    }
    return wakeContext(context);
  }
  function align() {
    if (!snapshot || audio.readyState < 1) return false;
    const position = station.position() / 1000;
    if (position < 0 || position >= snapshot.track.durationMs / 1000) {
      pause();
      void station.refresh();
      return false;
    }
    if (Number.isFinite(audio.duration) && position >= audio.duration) {
      station.failure();
      return false;
    }
    if (Math.abs(audio.currentTime - position) > 0.75)
      audio.currentTime = position;
    return true;
  }
  async function start() {
    if (!wanted() || !snapshot || pending || !align()) return;
    if (!audio.paused) return;
    const attempt = ++generation;
    pending = true;
    try {
      if (!(await unlock()) || attempt !== generation) return;
      await audio.play();
      if (attempt !== generation) {
        if (!wanted()) pause();
        return;
      }
      if (align()) {
        level(volume);
        station.succeeded();
      }
    } catch (error) {
      if (
        attempt === generation &&
        error.name !== "NotAllowedError" &&
        error.name !== "AbortError"
      )
        station.failure();
    } finally {
      if (attempt === generation) {
        pending = false;
        report();
      }
    }
  }
  const station = makeStation({
    changed(data, retune) {
      if (!running) return;
      const reload = !snapshot || retune;
      snapshot = data;
      failed = false;
      if (reload) {
        pause();
        const original = `assets/music/${data.track.file}`;
        audio.src = mediaUrl(streams[original]?.file || original);
        audio.load();
      }
      void start();
      report();
    },
    failed() {
      pause();
      snapshot = null;
      failed = true;
      report();
    },
  });
  function sync() {
    const next = Boolean(wanted());
    if (next !== running) {
      running = next;
      pause();
      snapshot = null;
      station.setActive(next);
    } else if (next) void start();
    report();
  }
  audio.addEventListener("loadedmetadata", () => void start());
  audio.addEventListener("canplay", () => void start());
  audio.addEventListener("timeupdate", () => { if (running && !audio.paused) align(); });
  audio.addEventListener("ended", () => {
    if (running) {
      pause();
      void station.refresh();
    }
  });
  audio.addEventListener("error", () => {
    if (running && snapshot) station.failure();
  });
  const set = (key) => (value) => {
    if (flags[key] !== Boolean(value)) {
      flags[key] = Boolean(value);
      sync();
    }
  };
  return {
    onChange(listener) {
      changed = listener;
    },
    setActive: set("active"),
    setStarted: set("started"),
    setEnabled: set("enabled"),
    setHidden: set("hidden"),
    setQuiet: set("quiet"),
    unlock() {
      flags.unlocked = true;
      void unlock();
      sync();
    },
    setVolume(value) {
      if (Number.isFinite(value)) {
        volume = Math.max(0, Math.min(1, value));
        if (wanted() && !audio.paused) level(volume);
      }
    },
  };
}
