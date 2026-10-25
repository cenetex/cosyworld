import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createTextReveal,
  createExchange,
  waitForScene,
  splitLetters,
  createSpeechSounds,
} from "../v2/card-game/dialogue.mjs";
afterEach(() => vi.useRealTimers());
function player(options = {}) {
  vi.useFakeTimers();
  const frames = [],
    sound = vi.fn();
  const reveal = createTextReveal({
    frame: (value) => frames.push(value),
    sound,
    ...options,
  });
  return { reveal, frames, sound, last: () => frames.at(-1) };
}
describe("paced conversation", () => {
  it("uses a steady letter clock with punctuation pauses and holds the finished line", () => {
    const { reveal, last, sound } = player();
    reveal.show("a", "Hi, Pip!", "vale");
    expect(last().shown).toBe(0);
    vi.advanceTimersByTime(84);
    expect(last().shown).toBe(3);
    vi.advanceTimersByTime(89);
    expect(last().shown).toBe(3);
    vi.advanceTimersByTime(1);
    expect(last().shown).toBe(4);
    vi.runAllTimers();
    expect(last()).toMatchObject({
      text: "Hi, Pip!",
      shown: 8,
      complete: true,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(sound.mock.calls.map((call) => call[1]).join("")).toBe("HPp");
  });
  it("keeps combined letters and emoji whole", () => {
    const letters = splitLetters("e\u0301 👩🏽‍🚀 🌙");
    expect(letters).toEqual(["e\u0301", " ", "👩🏽‍🚀", " ", "🌙"]);
    const { reveal, last } = player();
    reveal.show("a", "👩🏽‍🚀🌙", "moth");
    vi.advanceTimersByTime(28);
    expect(last().letters.slice(0, last().shown).join("")).toBe("👩🏽‍🚀");
  });
  it("keeps one line through unrelated renders and cancels it when another is chosen", () => {
    const { reveal, last, frames, sound } = player();
    reveal.show("a", "Old words", "vale");
    vi.advanceTimersByTime(56);
    reveal.show("a", "Old words", "vale");
    expect(last().shown).toBe(2);
    reveal.show("b", "A reply", "keeper");
    const count = frames.length;
    sound.mockClear();
    vi.runAllTimers();
    expect(frames.slice(count).every((frame) => frame.key === "b")).toBe(true);
    expect(sound.mock.calls.every(([speaker]) => speaker === "keeper")).toBe(
      true,
    );
    reveal.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reveals the line on a tap and stops its remaining sounds", () => {
    const { reveal, last, sound } = player();
    reveal.show("a", "Come upstairs.", "keeper");
    vi.advanceTimersByTime(28);
    sound.mockClear();
    reveal.finish();
    vi.runAllTimers();
    expect(last().complete).toBe(true);
    expect(sound).not.toHaveBeenCalled();
  });
  it("pauses in a hidden tab or menu and resumes at the same letter", () => {
    const { reveal, last, sound } = player();
    reveal.show("a", "Quiet water", "pond");
    vi.advanceTimersByTime(56);
    reveal.pause(true);
    const count = sound.mock.calls.length;
    vi.advanceTimersByTime(10000);
    expect(last().shown).toBe(2);
    expect(sound).toHaveBeenCalledTimes(count);
    reveal.pause(false);
    vi.advanceTimersByTime(28);
    expect(last().shown).toBe(3);
  });
  it("keeps the rest of a punctuation pause when a menu closes", () => {
    const { reveal, last } = player();
    reveal.show("a", "Hi, Pip", "vale");
    vi.advanceTimersByTime(100);
    expect(last().shown).toBe(3);
    reveal.pause(true);
    vi.advanceTimersByTime(10000);
    reveal.pause(false);
    vi.advanceTimersByTime(73);
    expect(last().shown).toBe(3);
    vi.advanceTimersByTime(1);
    expect(last().shown).toBe(4);
  });
  it("uses paint frames and reveals one letter after a slow frame", () => {
    let time = 0,
      callback = null;
    const frame = vi.fn(),
      sound = vi.fn(),
      cancelFrame = vi.fn();
    const reveal = createTextReveal({
      frame,
      sound,
      now: () => time,
      requestFrame: (next) => {
        callback = next;
        return 1;
      },
      cancelFrame,
    });
    const tick = (at) => {
      time = at;
      callback();
    };
    reveal.show("a", "Readable words", "vale");
    tick(16);
    expect(frame.mock.lastCall[0].shown).toBe(0);
    tick(32);
    expect(frame.mock.lastCall[0].shown).toBe(1);
    tick(48);
    expect(frame.mock.lastCall[0].shown).toBe(1);
    tick(64);
    expect(frame.mock.lastCall[0].shown).toBe(2);
    tick(600);
    expect(frame.mock.lastCall[0].shown).toBe(3);
    expect(sound).toHaveBeenCalledTimes(2);
    reveal.finish();
    expect(cancelFrame).toHaveBeenLastCalledWith(1);
    expect(frame.mock.lastCall[0].complete).toBe(true);
  });
  it("shows whole lines for reduced motion and existing lines while waiting", () => {
    for (const options of [{ reduced: () => true }, {}]) {
      const { reveal, last, sound } = player(options);
      reveal.show("a", "The lantern waits.", "lamp", {
        instant: !options.reduced,
      });
      expect(last().complete).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(sound).not.toHaveBeenCalled();
    }
  });
});
function audioContext() {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn(),
  });
  const nodes = [];
  const node = (properties = {}) => {
    const n = { connect: vi.fn(), disconnect: vi.fn(), ...properties };
    nodes.push(n);
    return n;
  };
  return {
    state: "running",
    currentTime: 4,
    destination: {},
    nodes,
    resume: vi.fn(async () => {}),
    createOscillator: vi.fn(() =>
      node({ frequency: param(), start: vi.fn(), stop: vi.fn() }),
    ),
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ frequency: param(), Q: { value: 0 } }),
  };
}
describe("short character voices", () => {
  it("opens audio after a gesture, gives speakers different pitches, and releases nodes", () => {
    const context = audioContext(),
      makeContext = vi.fn(() => context);
    const voice = createSpeechSounds({ makeContext });
    voice.syllable("vale", "a", 1);
    expect(makeContext).not.toHaveBeenCalled();
    voice.unlock();
    voice.syllable("vale", "a", 1);
    voice.syllable("keeper", "a", 1);
    const [vale, keeper] = context.createOscillator.mock.results.map(
      ({ value }) => value,
    );
    expect(vale.frequency.setValueAtTime.mock.calls[0][0]).toBeGreaterThan(
      keeper.frequency.setValueAtTime.mock.calls[0][0],
    );
    expect(vale.stop).toHaveBeenCalledWith(4.07);
    vale.onended();
    keeper.onended();
    expect(
      context.nodes.every((node) => node.disconnect.mock.calls.length === 1),
    ).toBe(true);
  });
  it("bounds overlapping syllables, fades on mute, and handles missing audio", () => {
    const context = audioContext(),
      voice = createSpeechSounds({ makeContext: () => context });
    voice.unlock();
    for (let i = 0; i < 12; i++) voice.syllable("moth", "b", i);
    expect(context.createOscillator).toHaveBeenCalledTimes(4);
    voice.setEnabled(false);
    voice.syllable("vale", "a", 1);
    expect(context.createOscillator).toHaveBeenCalledTimes(4);
    for (const { value } of context.createOscillator.mock.results)
      expect(value.stop).toHaveBeenLastCalledWith(4.02);
    const unavailable = createSpeechSounds({
      makeContext: () => {
        throw new Error("unavailable");
      },
    });
    expect(() => {
      unavailable.unlock();
      unavailable.syllable("vale", "a", 1);
    }).not.toThrow();
  });
});

describe("one exchange per card play", () => {
  function setup() {
    vi.useFakeTimers();
    const show = vi.fn(),
      settled = vi.fn(),
      busy = vi.fn();
    const exchange = createExchange({ show, settled, busy });
    const lines = [
      { seq: 1, text: "Come with me." },
      { seq: 2, text: "I am leaving for the pond.", departureTo: "pond" },
    ];
    return { exchange, lines, show, settled, busy };
  }
  it("waits for the portrait load and entrance before the first arrival line", async () => {
    vi.useFakeTimers();
    let loaded, arrived;
    const image = new Promise((resolve) => {
      loaded = resolve;
    });
    const entrance = image.then(
      () =>
        new Promise((resolve) => {
          arrived = resolve;
        }),
    );
    const show = vi.fn();
    const exchange = createExchange({
      show,
      prepare: () => waitForScene([entrance]),
    });
    exchange.begin();
    exchange.load([{ seq: 1, text: "Pip has arrived." }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(exchange.preparing).toBe(true);
    expect(show).not.toHaveBeenCalled();
    loaded();
    await vi.advanceTimersByTimeAsync(0);
    expect(show).not.toHaveBeenCalled();
    arrived();
    await vi.advanceTimersByTimeAsync(0);
    expect(exchange.preparing).toBe(false);
    expect(show).toHaveBeenCalledExactlyOnceWith({
      seq: 1,
      text: "Pip has arrived.",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("drops a waiting entrance when the game resets and accepts the next room", async () => {
    vi.useFakeTimers();
    const ready = [];
    const show = vi.fn();
    const exchange = createExchange({
      show,
      prepare: () => new Promise((resolve) => ready.push(resolve)),
    });
    exchange.begin();
    exchange.load([{ seq: 1 }]);
    await vi.advanceTimersByTimeAsync(0);
    exchange.cancel();
    exchange.begin();
    exchange.load([{ seq: 2 }]);
    await vi.advanceTimersByTimeAsync(0);
    ready[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(show).not.toHaveBeenCalled();
    ready[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(show).toHaveBeenCalledExactlyOnceWith({ seq: 2 });
  });
  it("settles broken media and bounds a stalled load", async () => {
    vi.useFakeTimers();
    await waitForScene([Promise.reject(new Error("Image unavailable"))]);
    expect(vi.getTimerCount()).toBe(0);
    let ready = false;
    const waiting = waitForScene([new Promise(() => {})]).then(() => {
      ready = true;
    });
    await vi.advanceTimersByTimeAsync(7999);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(ready).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("holds cards through generation and every reply, then releases them", () => {
    const { exchange, lines, show, settled, busy } = setup();
    exchange.begin();
    expect(busy).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(2000);
    expect(exchange.active).toBe(true);
    busy.mockClear();
    exchange.load(lines);
    expect(busy).toHaveBeenCalledExactlyOnceWith(true);
    expect(show).toHaveBeenLastCalledWith(lines[0]);
    exchange.revealed(1, lines[0].text);
    vi.advanceTimersByTime(1199);
    expect(show).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenLastCalledWith(lines[1]);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(exchange.active).toBe(true);
    expect(busy).toHaveBeenCalledExactlyOnceWith(true);
    exchange.revealed(2, lines[1].text);
    vi.advanceTimersByTime(899);
    expect(exchange.active).toBe(true);
    vi.advanceTimersByTime(1);
    expect(settled).toHaveBeenLastCalledWith(lines[1]);
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores old lines and lets a completed line advance once on a tap", () => {
    const { exchange, lines, show } = setup();
    exchange.begin();
    exchange.load(lines);
    exchange.revealed(99, "Old words");
    exchange.advance();
    expect(show).toHaveBeenCalledTimes(1);
    exchange.revealed(1, lines[0].text);
    exchange.advance();
    exchange.advance();
    vi.advanceTimersByTime(10000);
    expect(show).toHaveBeenCalledTimes(2);
    expect(exchange.current).toEqual(lines[1]);
  });
  it("gives a revealed or reduced-motion line time to be read", () => {
    const { exchange, lines, show } = setup();
    exchange.begin();
    exchange.load(lines);
    exchange.revealed(1, "A".repeat(200), true);
    vi.advanceTimersByTime(4999);
    expect(show).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledTimes(2);
  });
  it("pauses the reading beat in a menu or background tab", () => {
    const { exchange, lines, show } = setup();
    exchange.begin();
    exchange.load(lines);
    exchange.revealed(1, lines[0].text);
    vi.advanceTimersByTime(500);
    exchange.pause(true);
    vi.advanceTimersByTime(20000);
    expect(show).toHaveBeenCalledTimes(1);
    exchange.pause(false);
    vi.advanceTimersByTime(699);
    expect(show).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledTimes(2);
  });
  it("waits for visibility when a whole line arrives while paused", () => {
    const { exchange, lines, show } = setup();
    exchange.begin();
    exchange.pause(true);
    exchange.load(lines);
    exchange.revealed(1, lines[0].text);
    vi.runAllTimers();
    expect(show).toHaveBeenCalledTimes(1);
    exchange.pause(false);
    vi.advanceTimersByTime(1200);
    expect(show).toHaveBeenCalledTimes(2);
  });
  it("cancels timers on reset or provider failure and accepts a fresh turn", () => {
    const { exchange, lines, show, busy } = setup();
    exchange.begin();
    exchange.load(lines);
    exchange.revealed(1, lines[0].text);
    exchange.cancel();
    vi.runAllTimers();
    expect(show).toHaveBeenCalledTimes(1);
    expect(busy).toHaveBeenLastCalledWith(false);
    exchange.begin();
    exchange.load([lines[1]]);
    exchange.revealed(2, lines[1].text);
    vi.runAllTimers();
    expect(exchange.active).toBe(false);
    expect(show).toHaveBeenCalledTimes(2);
  });
  it("keeps repeated render callbacks from extending a completed line's beat", () => {
    const { exchange, lines, show } = setup();
    exchange.begin();
    exchange.load(lines);
    exchange.revealed(1, lines[0].text);
    vi.advanceTimersByTime(1000);
    exchange.revealed(1, lines[0].text);
    vi.advanceTimersByTime(200);
    expect(show).toHaveBeenCalledTimes(2);
  });
});
