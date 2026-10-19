export const roomTracks = {
  attic: [
    { file: "attic-1.mp3", title: "Music Box Waltz" },
    { file: "attic-2.mp3", title: "Music Box Waltz II" },
  ],
  pond: [
    { file: "pond-1.mp3", title: "Quiet Night" },
    { file: "pond-2.mp3", title: "Something Below the Surface" },
  ],
  station: [
    { file: "station-1.mp3", title: "Wheels on the Track" },
    { file: "station-2.mp3", title: "Faint Hope" },
  ],
};

// Keep the outgoing source until its gain reaches silence, then fade in the
// selected song. The audio clock keeps fades smooth while a tab is hidden.
export function createRoomMusic({
  audio,
  changed = () => {},
  makeContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  now = () => performance.now() / 1000,
}) {
  const fadeSeconds = 1;
  let room = null,
    loadedFile = null,
    unlocked = false,
    enabled = true,
    hidden = false,
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
        context = nextContext;
        gain = nextGain;
        audio.volume = 1;
      } catch {
        // The media-element fade remains available.
      }
    }
    if (context?.state === "suspended") void context.resume().catch(() => {});
  }
  function track() {
    return roomTracks[room]?.[positions.get(room) || 0];
  }
  function wanted() {
    return (
      unlocked &&
      enabled &&
      !hidden &&
      track() &&
      failures < roomTracks[room].length
    );
  }
  function report() {
    changed({
      enabled,
      title: track()?.title || "",
      playing: !audio.paused,
      failed: failures >= (roomTracks[room]?.length || 1),
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
    fadeTo(0, fadeSeconds);
    transitionTimer = setTimeout(() => {
      transitionTimer = null;
      fadeTo(0, 0);
      action();
    }, fadeSeconds * 1000);
  }
  function load() {
    pause();
    const next = track();
    loadedFile = next?.file || null;
    ending = false;
    if (next)
      audio.src = new URL(`./assets/music/${next.file}`, import.meta.url).href;
    else audio.removeAttribute("src");
    audio.load();
    start();
  }
  function start() {
    if (!wanted() || pending || !audio.paused || transitionTimer !== null)
      return;
    unlockGraph();
    ending = false;
    const attempt = ++generation;
    pending = true;
    try {
      Promise.resolve(audio.play()).then(
        () => {
          if (attempt !== generation) return;
          pending = false;
          fadeTo(volume, fadeSeconds);
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
    if (loadedFile !== (track()?.file || null)) afterFade(load);
    else if (!wanted()) afterFade(pause);
    else if (audio.paused) start();
    else if (!ending) fadeTo(volume, fadeSeconds);
  }
  function advance() {
    positions.set(
      room,
      ((positions.get(room) || 0) + 1) % roomTracks[room].length,
    );
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
      advance();
    }
    // A track can end while travel is waiting for its fade to finish.
    sync();
  });
  audio.addEventListener("playing", () => {
    failures = 0;
    report();
  });
  audio.addEventListener("error", () => {
    if (loadedFile === track()?.file) {
      failures++;
      if (failures < roomTracks[room].length) advance();
    }
    pause();
    sync();
  });
  return {
    setRoom(value) {
      if (room === value) return;
      room = value;
      failures = 0;
      sync();
    },
    unlock() {
      unlocked = true;
      if (enabled && !hidden) unlockGraph();
      start();
    },
    setEnabled(value) {
      enabled = Boolean(value);
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
      sync();
    },
  };
}
