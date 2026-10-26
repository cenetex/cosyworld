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

describe("room music fades", () => {
  it("keeps one randomly chosen song for a crossing and chooses again on boarding", async () => {
    const random = vi.fn().mockReturnValueOnce(0.6).mockReturnValueOnce(0.9);
    const { audio, music, begin, ended, changed, level } = player({ random });
    await begin("pond");
    music.setRoom("greek-ship");
    expect(audio.src).toMatch(/pond-1\.mp3$/);
    await advance(2000);
    expect(audio.src).toMatch(/ship-3\.mp3$/);
    expect(changed.mock.lastCall[0].title).toBe("Wine-Dark-2");
    music.setRoom("greek-ship");
    music.setEnabled(false);
    await advance(1000);
    music.setEnabled(true);
    music.setHidden(true);
    await advance(1000);
    music.setHidden(false);
    await advance(1000);
    audio.currentTime = audio.duration;
    ended();
    await advance(1000);
    expect(audio.src).toMatch(/ship-3\.mp3$/);
    expect(audio.currentTime).toBe(0);
    expect(random).toHaveBeenCalledTimes(1);
    music.setRoom("greek-harbor");
    await advance(1000);
    expect(level()).toBe(0);
    expect(audio.paused).toBe(true);
    music.setRoom("greek-ship");
    await advance(1000);
    expect(audio.src).toMatch(/ship-4\.mp3$/);
    expect(changed.mock.lastCall[0].title).toBe("Wine-Dark-3");
    expect(audio.paused).toBe(false);
    expect(random).toHaveBeenCalledTimes(2);
  });

  it.each([
    [0, "ship-1.mp3"],
    [0.25, "ship-2.mp3"],
    [0.5, "ship-3.mp3"],
    [0.999, "ship-4.mp3"],
  ])("can choose %s as %s for a crossing", async (choice, file) => {
    const { audio, begin } = player({ random: () => choice });
    await begin("greek-ship");
    expect(audio.src.endsWith(file)).toBe(true);
  });

  it("restarts a repeated song when boarding again during the outgoing fade", async () => {
    const { audio, music, begin } = player({ random: () => 0.3 });
    await begin("greek-ship");
    audio.currentTime = 60;
    music.setRoom("greek-harbor");
    await advance(200);
    music.setRoom("greek-ship");
    await advance(2000);
    expect(audio.src).toMatch(/ship-2\.mp3$/);
    expect(audio.currentTime).toBe(0);
    expect(audio.paused).toBe(false);
  });

  it("waits for the first play in each new game and keeps the music setting", async () => {
    const { audio, music, changed } = player();
    music.setStarted(false);
    music.setRoom("attic");
    music.unlock();
    music.setEnabled(false);
    music.setEnabled(true);
    music.setVolume(0.4);
    music.setHidden(true);
    music.setHidden(false);
    await advance(1000);
    expect(audio.play).not.toHaveBeenCalled();
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ started: false }),
    );
    music.setStarted(true);
    music.unlock();
    await advance(1000);
    expect(audio.paused).toBe(false);
    music.setStarted(false);
    expect(audio.paused).toBe(true);
    music.unlock();
    await advance(1000);
    expect(audio.play).toHaveBeenCalledTimes(1);
    music.setEnabled(false);
    music.setStarted(true);
    music.unlock();
    expect(audio.paused).toBe(true);
    music.setEnabled(true);
    await advance(1000);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("waits for a gesture, fades in, and keeps the song through scene updates", async () => {
    const { audio, music, level } = player();
    music.setRoom("attic");
    expect(audio.play).not.toHaveBeenCalled();
    music.unlock();
    await advance(0);
    expect(level()).toBe(0);
    await advance(500);
    expect(level()).toBeCloseTo(0.15);
    await advance(500);
    expect(level()).toBeCloseTo(0.3);
    audio.currentTime = 40;
    music.setRoom("attic");
    music.unlock();
    expect(audio.currentTime).toBe(40);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("keeps the old source until it is silent, then fades in the latest room", async () => {
    const { audio, music, level, begin, pauseLevels, loadLevels } = player();
    await begin();
    music.setRoom("pond");
    expect(audio.src).toMatch(/attic-1\.mp3$/);
    expect(audio.paused).toBe(false);
    await advance(500);
    expect(level()).toBeCloseTo(0.15);
    music.setRoom("station");
    music.unlock();
    expect(level()).toBeCloseTo(0.15);
    await advance(500);
    expect(audio.src).toMatch(/attic-1\.mp3$/);
    expect(level()).toBeCloseTo(0.075);
    await advance(500);
    expect(audio.src).toMatch(/station-1\.mp3$/);
    expect(level()).toBe(0);
    await advance(500);
    expect(level()).toBeCloseTo(0.15);
    await advance(500);
    expect(level()).toBeCloseTo(0.3);
    expect(pauseLevels.every((value) => value === 0)).toBe(true);
    expect(loadLevels.every((value) => value === 0)).toBe(true);
  });

  it("returns smoothly to the current room during a pending change", async () => {
    const { audio, music, level, begin } = player();
    await begin();
    music.setRoom("pond");
    await advance(500);
    music.setRoom("attic");
    expect(level()).toBeCloseTo(0.15);
    await advance(500);
    expect(level()).toBeCloseTo(0.225);
    await advance(1000);
    expect(audio.src).toMatch(/attic-1\.mp3$/);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("finishes a travel fade within the outgoing song's remaining time", async () => {
    const { audio, music, level, begin } = player();
    await begin();
    audio.currentTime = 179.5;
    music.setRoom("station");
    await advance(250);
    expect(level()).toBeCloseTo(0.15);
    expect(audio.src).toMatch(/attic-1\.mp3$/);
    await advance(250);
    expect(level()).toBe(0);
    expect(audio.src).toMatch(/station-1\.mp3$/);
  });

  it("fades a song's ending and loops both tracks in order", async () => {
    const { audio, music, level, begin, ended } = player();
    await begin("pond");
    audio.currentTime = 179;
    audio.dispatchEvent(new Event("timeupdate"));
    await advance(500);
    expect(level()).toBeCloseTo(0.15);
    await advance(500);
    expect(level()).toBe(0);
    ended();
    expect(audio.src).toMatch(/pond-2\.mp3$/);
    await advance(500);
    expect(level()).toBeCloseTo(0.15);
    await advance(500);
    music.setRoom("station");
    await advance(2000);
    music.setRoom("pond");
    await advance(2000);
    expect(audio.src).toMatch(/pond-2\.mp3$/);
    ended();
    expect(audio.src).toMatch(/pond-1\.mp3$/);
  });

  it("keeps the destination's first track when the old song ends during travel", async () => {
    const { audio, music, begin, ended } = player();
    await begin();
    music.setRoom("station");
    ended();
    await advance(2000);
    expect(audio.src).toMatch(/station-1\.mp3$/);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("fades mute, reverses it smoothly, and keeps mute through travel", async () => {
    const { audio, music, level, begin } = player();
    await begin();
    music.setEnabled(false);
    expect(audio.paused).toBe(false);
    await advance(500);
    expect(level()).toBeCloseTo(0.15);
    music.setEnabled(true);
    await advance(500);
    expect(level()).toBeCloseTo(0.225);
    music.setEnabled(false);
    await advance(1000);
    expect(audio.paused).toBe(true);
    expect(level()).toBe(0);
    music.setRoom("pond");
    music.unlock();
    expect(audio.paused).toBe(true);
    music.setEnabled(true);
    await advance(1000);
    expect(audio.src).toMatch(/pond-1\.mp3$/);
    expect(level()).toBeCloseTo(0.3);
  });

  it("fades a hidden tab and resumes its position while respecting mute", async () => {
    const { audio, music, level, begin } = player();
    await begin("station");
    audio.currentTime = 35;
    music.setHidden(true);
    await advance(500);
    expect(audio.paused).toBe(false);
    expect(level()).toBeCloseTo(0.15);
    await advance(500);
    expect(audio.paused).toBe(true);
    music.setHidden(false);
    await advance(500);
    expect(audio.currentTime).toBe(35);
    expect(level()).toBeCloseTo(0.15);
    music.setHidden(true);
    music.setEnabled(false);
    await advance(1000);
    music.setHidden(false);
    expect(audio.paused).toBe(true);
  });

  it("retries blocked playback and ignores a stale play promise", async () => {
    const { audio, music, level } = player();
    audio.play.mockRejectedValueOnce(
      new DOMException("Gesture required", "NotAllowedError"),
    );
    music.setRoom("attic");
    music.unlock();
    await advance(0);
    expect(level()).toBe(0);
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
    expect(audio.src).toMatch(/station-1\.mp3$/);
    expect(audio.paused).toBe(true);
    expect(level()).toBe(0);
  });

  it("tries the other song on an error and bounds retries", async () => {
    const { audio, music, changed } = player();
    music.setRoom("attic");
    music.unlock();
    audio.dispatchEvent(new Event("error"));
    expect(audio.src).toMatch(/attic-2\.mp3$/);
    audio.dispatchEvent(new Event("error"));
    music.unlock();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(changed.mock.lastCall[0].failed).toBe(true);
    music.setEnabled(false);
    music.setEnabled(true);
    await advance(1000);
    expect(audio.play).toHaveBeenCalledTimes(3);
  });

  it("eases volume changes and keeps the fade to silence during travel", async () => {
    const { music, level, begin } = player();
    await begin();
    music.setVolume(0.18);
    expect(level()).toBeCloseTo(0.3);
    await advance(75);
    expect(level()).toBeCloseTo(0.24);
    await advance(75);
    expect(level()).toBeCloseTo(0.18);
    music.setRoom("pond");
    await advance(500);
    music.setVolume(0.5);
    expect(level()).toBeCloseTo(0.09);
    await advance(500);
    expect(level()).toBe(0);
    await advance(1000);
    expect(level()).toBeCloseTo(0.5);
    music.setVolume(NaN);
    expect(level()).toBeCloseTo(0.5);
    music.setVolume(2);
    await advance(150);
    expect(level()).toBe(1);
    music.setVolume(-1);
    await advance(150);
    expect(level()).toBe(0);
  });

  it("uses a smooth media-volume fade when the audio graph is unavailable", async () => {
    const { audio, music, level, begin, pauseLevels } = player({
      fallback: true,
    });
    await begin();
    music.setRoom("pond");
    await advance(500);
    expect(level()).toBeCloseTo(0.15);
    expect(audio.src).toMatch(/attic-1\.mp3$/);
    await advance(1000);
    expect(audio.src).toMatch(/pond-1\.mp3$/);
    expect(level()).toBeCloseTo(0.15);
    await advance(500);
    expect(level()).toBeCloseTo(0.3);
    expect(pauseLevels.every((value) => value === 0)).toBe(true);
  });
});
