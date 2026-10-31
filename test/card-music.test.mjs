import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoomMusic } from "../v2/card-game/music.mjs";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());
const advance = (ms) => vi.advanceTimersByTimeAsync(ms);

function player({ fallback = false, random = () => 0 } = {}) {
  let from = 0,
    to = 0,
    start = 0,
    end = 0;
  const clock = () => Date.now() / 1000;
  const param = {
    get value() {
      const progress =
        end > start
          ? Math.max(0, Math.min(1, (clock() - start) / (end - start)))
          : 1;
      return from + (to - from) * progress;
    },
    set value(value) {
      from = to = value;
      start = end = clock();
    },
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn((value, time) => {
      from = to = value;
      start = end = time;
    }),
    linearRampToValueAtTime: vi.fn((value, time) => {
      to = value;
      end = time;
    }),
  };
  const gain = { gain: param, connect: vi.fn() };
  const context = {
    get currentTime() {
      return clock();
    },
    state: "running",
    destination: {},
    createGain: () => gain,
    createMediaElementSource: () => ({ connect: vi.fn() }),
    resume: vi.fn(async () => {}),
  };
  const audio = new EventTarget();
  const pauseLevels = [],
    loadLevels = [];
  const level = () => (fallback ? audio.volume : param.value);
  Object.assign(audio, {
    paused: true,
    src: "",
    currentTime: 0,
    duration: 180,
    play: vi.fn(() => {
      audio.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      pauseLevels.push(level());
      audio.paused = true;
    }),
    load: vi.fn(() => {
      loadLevels.push(level());
      audio.currentTime = 0;
    }),
    removeAttribute: () => {
      audio.src = "";
    },
  });
  const changed = vi.fn();
  const music = createRoomMusic({
    audio,
    random,
    changed,
    now: clock,
    makeContext: () => {
      if (fallback) throw new Error("Use media volume");
      return context;
    },
  });
  const begin = async (room = "attic") => {
    music.setRoom(room);
    music.unlock();
    await advance(1000);
  };
  music.setStarted(true);
  const ended = () => {
    audio.paused = true;
    audio.dispatchEvent(new Event("ended"));
  };
  return {
    audio,
    music,
    changed,
    context,
    level,
    pauseLevels,
    loadLevels,
    begin,
    ended,
  };
}

describe("songs that follow the player", () => {
  it("waits for the first accepted play and a gesture", async () => {
    const { audio, music } = player();
    music.setStarted(false);
    music.setRoom("attic");
    music.unlock();
    await advance(2000);
    expect(audio.src).toBe("");
    expect(audio.load).not.toHaveBeenCalled();
    music.setStarted(true);
    await advance(1000);
    expect(new URL(audio.src).pathname).toMatch(/attic-1\.mp3$/);
    expect(new URL(audio.src).searchParams.get("v")).toMatch(/^[a-f0-9]{64}$/);
    expect(audio.paused).toBe(false);
  });

  it("waits for a gesture when a room first triggers music", async () => {
    const { audio, music } = player();
    music.setRoom("pond");
    await advance(2000);
    expect(audio.load).not.toHaveBeenCalled();
    music.unlock();
    await advance(1000);
    expect(audio.src).toMatch(/pond-1\.mp3/);
  });

  it("keeps the full song and its title through several rooms", async () => {
    const { audio, music, changed, begin, level } = player();
    await begin();
    audio.currentTime = 35;
    const source = audio.src,
      loads = audio.load.mock.calls.length;
    for (const room of ["pond", "station", "willows-bank", "greek-ship"]) {
      music.setRoom(room);
      music.unlock();
      await advance(2000);
      expect(audio.src).toBe(source);
      expect(audio.currentTime).toBe(35);
      expect(audio.paused).toBe(false);
      expect(level()).toBeCloseTo(0.3);
      expect(changed.mock.lastCall[0].title).toBe("Music Box Waltz");
    }
    expect(audio.load).toHaveBeenCalledTimes(loads);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("lets the current room choose after the full song ends", async () => {
    const { audio, music, begin, ended } = player();
    await begin("attic");
    music.setRoom("pond");
    music.setRoom("station");
    expect(audio.src).toMatch(/attic-1\.mp3/);
    ended();
    await advance(1000);
    expect(audio.src).toMatch(/station-1\.mp3/);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("rests after a song ends in a quiet place and starts on the next music visit", async () => {
    const { audio, music, begin, ended, changed } = player();
    await begin();
    music.setRoom("willows-bank");
    ended();
    await advance(2000);
    expect(audio.paused).toBe(true);
    expect(changed.mock.lastCall[0].title).toBe("");
    music.setRoom("pond");
    await advance(1000);
    expect(audio.src).toMatch(/pond-1\.mp3/);
    expect(audio.paused).toBe(false);
  });

  it.each(["dawn", "dusk", "night"])(
    "keeps the camp's daytime songs waiting at %s",
    async (phase) => {
      const { audio, music } = player();
      music.setRoom("willows-camp", phase);
      music.unlock();
      await advance(2000);
      expect(audio.load).not.toHaveBeenCalled();
      music.setRoom("willows-camp", "day");
      await advance(1000);
      expect(audio.src).toMatch(/willows-keep-to-bank-1\.m4a/);
      expect(audio.paused).toBe(false);
    },
  );

  it.each([
    [0, "willows-keep-to-bank-1.m4a"],
    [0.25, "willows-keep-to-bank-2.m4a"],
    [0.5, "willows-dont-answer-trees.m4a"],
    [0.999, "willows-keep-to-bank-3.m4a"],
  ])("chooses the supplied camp song at %s", async (choice, file) => {
    const { audio, begin } = player({ random: () => choice });
    await begin("willows-camp");
    expect(new URL(audio.src).pathname.endsWith(file)).toBe(true);
  });

  it("lets a daytime camp song finish through dusk, night and a journey", async () => {
    const { audio, music, begin, ended } = player({ random: () => 0.5 });
    await begin("willows-camp");
    const source = audio.src;
    audio.currentTime = 65;
    music.setRoom("willows-camp", "dusk");
    music.setRoom("willows-camp", "night");
    music.setRoom("willows-thicket", "night");
    await advance(2000);
    expect(audio.src).toBe(source);
    expect(audio.currentTime).toBe(65);
    expect(audio.paused).toBe(false);
    music.setRoom("willows-camp", "night");
    ended();
    await advance(1000);
    expect(audio.paused).toBe(true);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("waits for an earlier song to end before choosing a daytime camp song", async () => {
    const random = vi.fn(() => 0.75);
    const { audio, music, begin, ended } = player({ random });
    await begin("pond");
    music.setRoom("willows-camp", "day");
    await advance(2000);
    expect(audio.src).toMatch(/pond-1\.mp3/);
    expect(random).not.toHaveBeenCalled();
    ended();
    await advance(1000);
    expect(audio.src).toMatch(/willows-keep-to-bank-3\.m4a/);
    expect(random).toHaveBeenCalledTimes(1);
  });

  it.each([
    [0, "ship-1.mp3"],
    [0.25, "ship-2.mp3"],
    [0.5, "ship-3.mp3"],
    [0.999, "ship-4.mp3"],
  ])("keeps the ship's four songs available at %s", async (choice, file) => {
    const { audio, begin } = player({ random: () => choice });
    await begin("greek-ship");
    expect(new URL(audio.src).pathname.endsWith(file)).toBe(true);
  });

  it("resumes a paused song at the same place in the track after travel", async () => {
    const { audio, music, begin } = player();
    await begin("attic");
    audio.currentTime = 35;
    const source = audio.src;
    music.setEnabled(false);
    await advance(1000);
    music.setRoom("pond");
    music.unlock();
    await advance(2000);
    expect(audio.paused).toBe(true);
    music.setEnabled(true);
    await advance(1000);
    expect(audio.src).toBe(source);
    expect(audio.currentTime).toBe(35);
    expect(audio.paused).toBe(false);
  });

  it("resumes a hidden tab's song after travel", async () => {
    const { audio, music, begin, level } = player();
    await begin("station");
    audio.currentTime = 35;
    const source = audio.src;
    music.setHidden(true);
    await advance(500);
    expect(level()).toBeCloseTo(0.15);
    await advance(500);
    expect(audio.paused).toBe(true);
    music.setRoom("pond");
    music.setHidden(false);
    await advance(1000);
    expect(audio.src).toBe(source);
    expect(audio.currentTime).toBe(35);
    music.setHidden(true);
    music.setEnabled(false);
    await advance(1000);
    music.setHidden(false);
    expect(audio.paused).toBe(true);
  });

  it("keeps the volume through travel and eases the volume control", async () => {
    const { music, level, begin } = player();
    await begin();
    music.setVolume(0.18);
    await advance(75);
    expect(level()).toBeCloseTo(0.24);
    await advance(75);
    music.setRoom("pond");
    await advance(1000);
    expect(level()).toBeCloseTo(0.18);
    music.setVolume(2);
    await advance(150);
    expect(level()).toBe(1);
    music.setVolume(-1);
    await advance(150);
    expect(level()).toBe(0);
  });

  it("finishes the ending fade and advances a room's playlist", async () => {
    const { audio, level, begin, ended } = player();
    await begin("pond");
    audio.currentTime = 179;
    audio.dispatchEvent(new Event("timeupdate"));
    await advance(500);
    expect(level()).toBeCloseTo(0.15);
    await advance(500);
    expect(level()).toBe(0);
    ended();
    await advance(1000);
    expect(audio.src).toMatch(/pond-2\.mp3/);
    expect(level()).toBeCloseTo(0.3);
    ended();
    await advance(1000);
    expect(audio.src).toMatch(/pond-1\.mp3/);
  });

  it("waits for a fresh play in a new game", async () => {
    const { audio, music, begin } = player();
    await begin();
    audio.currentTime = 45;
    music.setStarted(false);
    expect(audio.paused).toBe(true);
    music.setRoom("pond");
    await advance(2000);
    expect(audio.src).toMatch(/attic-1\.mp3/);
    music.setStarted(true);
    expect(audio.paused).toBe(true);
    music.unlock();
    await advance(1000);
    expect(audio.src).toMatch(/pond-1\.mp3/);
    expect(audio.currentTime).toBe(0);
  });

  it("retries blocked playback and ignores a stale play promise", async () => {
    const { audio, music, level } = player();
    audio.play.mockRejectedValueOnce(
      new DOMException("Gesture required", "NotAllowedError"),
    );
    music.setRoom("attic");
    music.unlock();
    await advance(0);
    let finish;
    audio.play.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    music.unlock();
    music.setRoom("station");
    music.setEnabled(false);
    finish();
    await advance(2000);
    expect(audio.src).toMatch(/attic-1\.mp3/);
    expect(audio.paused).toBe(true);
    expect(level()).toBe(0);
  });

  it("tries the other song on an error and bounds retries", async () => {
    const { audio, music, changed } = player();
    music.setRoom("attic");
    music.unlock();
    audio.dispatchEvent(new Event("error"));
    expect(audio.src).toMatch(/attic-2\.mp3/);
    audio.dispatchEvent(new Event("error"));
    music.unlock();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(changed.mock.lastCall[0].failed).toBe(true);
    music.setEnabled(false);
    music.setEnabled(true);
    await advance(1000);
    expect(audio.play).toHaveBeenCalledTimes(3);
  });

  it("fades smoothly through media volume when the audio graph is unavailable", async () => {
    const { music, level, begin, pauseLevels } = player({ fallback: true });
    await begin();
    music.setRoom("pond");
    await advance(500);
    expect(level()).toBeCloseTo(0.3);
    music.setEnabled(false);
    await advance(500);
    expect(level()).toBeCloseTo(0.15);
    await advance(500);
    expect(level()).toBe(0);
    expect(pauseLevels.every((value) => value === 0)).toBe(true);
  });
});
