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

// Music follows Vale's room and keeps its own playback and preference state.
export function createRoomMusic({ audio, changed = () => {} }) {
  let room = null,
    unlocked = false,
    enabled = true,
    hidden = false,
    pending = false,
    generation = 0,
    failures = 0;
  const positions = new Map();
  audio.preload = "none";
  audio.volume = 0.3;

  function track() {
    return roomTracks[room]?.[positions.get(room) || 0];
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
    audio.pause();
    report();
  }
  function select() {
    pause();
    const next = track();
    if (next)
      audio.src = new URL(`./assets/music/${next.file}`, import.meta.url).href;
    else audio.removeAttribute("src");
    audio.load();
    start();
  }
  function start() {
    if (
      !unlocked ||
      !enabled ||
      hidden ||
      !track() ||
      pending ||
      !audio.paused ||
      failures >= roomTracks[room].length
    )
      return;
    const attempt = ++generation;
    pending = true;
    try {
      Promise.resolve(audio.play()).then(
        () => {
          if (attempt !== generation) return;
          pending = false;
          report();
        },
        () => {
          if (attempt !== generation) return;
          pending = false;
          // A later player gesture can retry a blocked play request.
          report();
        },
      );
    } catch {
      pending = false;
      report();
    }
  }
  function advance() {
    positions.set(
      room,
      ((positions.get(room) || 0) + 1) % roomTracks[room].length,
    );
    select();
  }
  audio.addEventListener("ended", () => {
    if (!track()) return;
    failures = 0;
    advance();
  });
  audio.addEventListener("playing", () => {
    failures = 0;
    report();
  });
  audio.addEventListener("error", () => {
    if (!track()) return;
    failures++;
    if (failures < roomTracks[room].length) advance();
    else pause();
  });
  return {
    setRoom(value) {
      if (room === value) return;
      room = value;
      failures = 0;
      select();
    },
    unlock() {
      unlocked = true;
      start();
    },
    setEnabled(value) {
      enabled = Boolean(value);
      if (enabled) {
        if (failures) {
          failures = 0;
          select();
        } else start();
      } else pause();
      report();
    },
    setVolume(value) {
      if (Number.isFinite(value))
        audio.volume = Math.max(0, Math.min(1, value));
    },
    setHidden(value) {
      hidden = Boolean(value);
      if (hidden) pause();
      else start();
    },
  };
}
