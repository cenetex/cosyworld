import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  TITLE_SONG,
  createTitleSong,
  titleSongSettings,
} from "../v2/card-game/title-song.mjs";
import { WAKE_FADE } from "../v2/card-game/title-intro.mjs";

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

test("the first tap starts the song at once, level-matched to the saved volume", () => {
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
  // A quarter-second fade: the title lasts seconds (owner: no intro music).
  expect(ramps).toEqual([[0.5 * TITLE_SONG.level, 0.25]]);
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

test.each([
  ["turn", 4],
  ["skip", 2],
])("the %s exit keeps its full music fade", async (way, seconds) => {
  const { audio, ramps, context } = fakes();
  const song = createTitleSong({
    makeAudio: () => audio,
    makeContext: () => context,
    doc: null,
  });
  song.start();
  expect(WAKE_FADE[way].songSeconds).toBe(seconds);
  const done = song.stop(WAKE_FADE[way].songSeconds);
  expect(ramps.at(-1)).toEqual([0, seconds]);
  await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
  expect(audio.paused).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await done;
  expect(audio.paused).toBe(true);
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
  vi.advanceTimersByTime(100);
  expect(audio.volume).toBeGreaterThan(0.1);
  vi.advanceTimersByTime(200);
  expect(audio.volume).toBeCloseTo(0.3 * TITLE_SONG.level);
  expect(() => song.stop()).not.toThrow();
});

test("settings default to music on at 30%", () => {
  expect(titleSongSettings(null)).toEqual({ enabled: true, volume: 0.3 });
  expect(titleSongSettings(storage({ volume: 2 }))).toEqual({
    enabled: true,
    volume: 1,
  });
});

// A document and window that can hide, show and take a tap.
function page() {
  const doc = new EventTarget();
  doc.hidden = false;
  doc.defaultView = new EventTarget();
  const set = (hidden) => {
    doc.hidden = hidden;
    doc.dispatchEvent(new Event("visibilitychange"));
  };
  return { doc, hide: () => set(true), show: () => set(false) };
}

test("a phone's tab switch pauses the song in place and fades it back in", async () => {
  const { audio, ramps, context } = fakes();
  context.state = "running";
  context.resume = vi.fn(async () => (context.state = "running"));
  const { doc, hide, show } = page();
  const song = createTitleSong({
    storage: storage({ enabled: true, volume: 0.5 }),
    makeAudio: () => audio,
    makeContext: () => context,
    doc,
  });
  song.start();
  audio.currentTime = 42;
  hide();
  expect(audio.pause).toHaveBeenCalledOnce();
  expect(ramps.at(-1)).toEqual([0, 0]);
  // iOS reports "interrupted" while the app is away.
  context.state = "interrupted";
  show();
  await vi.advanceTimersByTimeAsync(0);
  expect(context.resume).toHaveBeenCalledOnce();
  expect(audio.play).toHaveBeenCalledTimes(2);
  expect(audio.currentTime).toBe(42);
  expect(ramps.at(-1)).toEqual([0.5 * TITLE_SONG.level, 0.4]);
  // pageshow after visibilitychange does not play it twice.
  doc.defaultView.dispatchEvent(new Event("pageshow"));
  expect(audio.play).toHaveBeenCalledTimes(2);
});

test("a refused wake waits for the next tap, and never plays a stopped song", async () => {
  const { audio, context } = fakes();
  const { doc, hide, show } = page();
  const song = createTitleSong({
    storage: null,
    makeAudio: () => audio,
    makeContext: () => context,
    doc,
  });
  song.start();
  hide();
  context.state = "interrupted";
  context.resume = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
  audio.play.mockImplementationOnce(() => Promise.reject(new Error("nope")));
  show();
  await vi.advanceTimersByTimeAsync(0);
  expect(audio.paused).toBe(true);
  context.resume = vi.fn(async () => (context.state = "running"));
  doc.dispatchEvent(new Event("pointerdown"));
  await vi.advanceTimersByTimeAsync(0);
  expect(context.resume).toHaveBeenCalledOnce();
  expect(audio.paused).toBe(false);
  expect(audio.play).toHaveBeenCalledTimes(3);
  // Taps after it runs again leave it alone.
  doc.dispatchEvent(new Event("pointerdown"));
  expect(audio.play).toHaveBeenCalledTimes(3);
  // Once the intro ends, returning to the tab stays silent.
  song.stop(0);
  await vi.advanceTimersByTimeAsync(0);
  hide();
  show();
  expect(audio.play).toHaveBeenCalledTimes(3);
});

test("the song stays paused on return when music was switched off or it was not playing", () => {
  let saved = { enabled: true, volume: 0.3 };
  const { audio, context } = fakes();
  const { doc, hide, show } = page();
  const song = createTitleSong({
    storage: { getItem: () => JSON.stringify(saved) },
    makeAudio: () => audio,
    makeContext: () => context,
    doc,
  });
  song.start();
  hide();
  saved = { enabled: false, volume: 0.3 };
  show();
  expect(audio.play).toHaveBeenCalledOnce();
  // Paused before the tab hid: nothing to resume.
  saved = { enabled: true, volume: 0.3 };
  hide();
  show();
  expect(audio.play).toHaveBeenCalledOnce();
});
