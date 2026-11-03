import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  TITLE_SONG,
  createTitleSong,
  titleSongSettings,
} from "../v2/card-game/title-song.mjs";
import { wakeLabel } from "../v2/card-game/title-intro.mjs";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const storage = (value) => ({
  getItem: (key) =>
    key === "cosyworld.room-music" && value ? JSON.stringify(value) : null,
});
function fakes() {
  const audio = {
    paused: true,
    ended: false,
    volume: 1,
    play: vi.fn(() => {
      audio.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => (audio.paused = true)),
  };
  const ramps = [];
  const gain = {
    gain: {
      value: 0,
      cancelScheduledValues() {},
      setValueAtTime() {},
      linearRampToValueAtTime: (to, at) => ramps.push([to, at]),
    },
    connect() {},
  };
  const context = {
    state: "running",
    currentTime: 0,
    destination: {},
    createGain: () => gain,
    createMediaElementSource: () => ({ connect() {} }),
    close: vi.fn(() => Promise.resolve()),
  };
  return { audio, ramps, context };
}

test("the first tap starts the song with a fade-in at the saved volume", () => {
  const { audio, ramps, context } = fakes();
  const song = createTitleSong({
    storage: storage({ enabled: true, volume: 0.5 }),
    makeAudio: () => audio,
    makeContext: () => context,
    doc: null,
  });
  expect(song.start()).toBe(true);
  expect(audio.play).toHaveBeenCalledOnce();
  expect(audio.loop).toBe(false);
  expect(audio.src).toContain(TITLE_SONG.file);
  expect(ramps).toEqual([[0.5, 2]]);
  // A second tap does not restart it.
  expect(song.start()).toBe(false);
  expect(audio.play).toHaveBeenCalledOnce();
});

test("Wake fades the song out over a second, then stops it", () => {
  const { audio, ramps, context } = fakes();
  const song = createTitleSong({
    storage: null,
    makeAudio: () => audio,
    makeContext: () => context,
    doc: null,
  });
  song.start();
  song.stop(1);
  expect(ramps.at(-1)).toEqual([0, 1]);
  expect(audio.pause).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(audio.pause).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalled();
  expect(song.start()).toBe(false);
});

test("music off, or volume zero, stays silent", () => {
  for (const saved of [{ enabled: false }, { enabled: true, volume: 0 }]) {
    const makeAudio = vi.fn();
    const song = createTitleSong({ storage: storage(saved), makeAudio });
    expect(song.start()).toBe(false);
    expect(makeAudio).not.toHaveBeenCalled();
    song.stop();
  }
});

test("a refused play or missing Web Audio never throws", () => {
  const { audio } = fakes();
  audio.play = () => Promise.reject(new Error("NotAllowedError"));
  const song = createTitleSong({
    makeAudio: () => audio,
    makeContext: () => {
      throw new Error("no Web Audio");
    },
    doc: null,
  });
  expect(song.start()).toBe(true);
  // The element's own volume fades instead.
  vi.advanceTimersByTime(1000);
  expect(audio.volume).toBeGreaterThan(0.1);
  vi.advanceTimersByTime(1500);
  expect(audio.volume).toBeCloseTo(0.3);
  expect(() => song.stop()).not.toThrow();
});

test("settings default to music on at 30%", () => {
  expect(titleSongSettings(null)).toEqual({ enabled: true, volume: 0.3 });
  expect(titleSongSettings(storage({ volume: 2 }))).toEqual({
    enabled: true,
    volume: 1,
  });
});

test("the Wake button names the avatar", () => {
  expect(wakeLabel("Vale")).toBe("Wake Vale");
  expect(wakeLabel("")).toBe("Wake up");
});
