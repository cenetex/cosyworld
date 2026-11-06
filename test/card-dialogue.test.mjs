import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createTextReveal,
  createExchange,
  createPlayQueue,
  afterDeadline,
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
  it("takes a line's own rests, letter by letter", () => {
    const { reveal, last } = player({
      delay: (letter, i) => (i === 1 ? 600 : 28),
    });
    reveal.show("a", "Oh. No", "vale");
    vi.advanceTimersByTime(56);
    expect(last().shown).toBe(2);
    vi.advanceTimersByTime(599);
    expect(last().shown).toBe(2);
    vi.advanceTimersByTime(1);
    expect(last().shown).toBe(3);
    reveal.finish();
    expect(last()).toMatchObject({ shown: 6, complete: true });
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
    // After a stall it catches up at no more than twice the beat.
    tick(610);
    expect(frame.mock.lastCall[0].shown).toBe(3);
    tick(614);
    expect(frame.mock.lastCall[0].shown).toBe(4);
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
  it("holds a streamed line through a slow reply after the player taps", async () => {
    vi.useFakeTimers();
    const show = vi.fn(),
      waiting = vi.fn();
    const exchange = createExchange({ show, waiting });
    exchange.begin();
    exchange.load([{ seq: 1, text: "Hello, Moth." }], { pending: true });
    await vi.advanceTimersByTimeAsync(0);
    exchange.revealed(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(waiting).not.toHaveBeenCalled();
    exchange.advance();
    exchange.advance();
    expect(show).toHaveBeenCalledTimes(1);
    expect(waiting).toHaveBeenCalledExactlyOnceWith({
      seq: 1,
      text: "Hello, Moth.",
    });
    exchange.load(
      [
        { seq: 1, text: "Hello, Moth." },
        { seq: 2, text: "Hello, Vale." },
      ],
      { pending: false },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(show).toHaveBeenLastCalledWith({ seq: 2, text: "Hello, Vale." });
    expect(waiting).toHaveBeenCalledTimes(1);
  });
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
    exchange.revealed(1);
    vi.advanceTimersByTime(10000);
    expect(show).toHaveBeenCalledTimes(1);
    exchange.advance();
    expect(show).toHaveBeenLastCalledWith(lines[1]);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(exchange.active).toBe(true);
    expect(busy).toHaveBeenCalledExactlyOnceWith(true);
    exchange.revealed(2);
    expect(settled).toHaveBeenLastCalledWith(lines[1]);
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("holds the speaker and cards through an exit and pauses the next line in a menu", async () => {
    let finish;
    const show = vi.fn(),
      busy = vi.fn(),
      transition = vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const exchange = createExchange({ show, busy, transition });
    exchange.begin();
    exchange.load([{ seq: 1 }, { seq: 2 }]);
    exchange.revealed(1);
    exchange.advance();
    exchange.revealed(1);
    exchange.advance();
    expect(transition).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
    expect(busy).toHaveBeenLastCalledWith(true);
    exchange.pause(true);
    finish();
    await Promise.resolve();
    expect(show).toHaveBeenCalledTimes(1);
    exchange.pause(false);
    expect(show).toHaveBeenLastCalledWith({ seq: 2 });
  });
  it("drops an old handoff after reset and keeps the fresh speaker", async () => {
    let finish;
    const show = vi.fn();
    const exchange = createExchange({
      show,
      transition: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    exchange.begin();
    exchange.load([{ seq: 1 }, { seq: 2 }]);
    exchange.revealed(1);
    exchange.advance();
    exchange.cancel();
    exchange.begin();
    exchange.load([{ seq: 3 }]);
    finish();
    await Promise.resolve();
    expect(show).toHaveBeenCalledTimes(2);
    expect(exchange.current).toEqual({ seq: 3 });
  });
  it("ignores old lines and lets a completed line advance once on a tap", () => {
    const { exchange, lines, show } = setup();
    exchange.begin();
    exchange.load(lines);
    exchange.revealed(99);
    exchange.advance();
    expect(show).toHaveBeenCalledTimes(1);
    exchange.revealed(1);
    exchange.advance();
    exchange.advance();
    vi.advanceTimersByTime(10000);
    expect(show).toHaveBeenCalledTimes(2);
    expect(exchange.current).toEqual(lines[1]);
  });
  it("keeps a completed line in place through a pause and resume", () => {
    const { exchange, lines, show } = setup();
    exchange.begin();
    exchange.load(lines);
    exchange.revealed(1);
    exchange.pause(true);
    vi.advanceTimersByTime(20000);
    exchange.pause(false);
    expect(show).toHaveBeenCalledTimes(1);
    exchange.advance();
    expect(show).toHaveBeenLastCalledWith(lines[1]);
  });
  it("resets the exchange and accepts a fresh turn", () => {
    const { exchange, lines, show, busy } = setup();
    exchange.begin();
    exchange.load(lines);
    exchange.revealed(1);
    exchange.cancel();
    vi.runAllTimers();
    expect(show).toHaveBeenCalledTimes(1);
    expect(busy).toHaveBeenLastCalledWith(false);
    exchange.begin();
    exchange.load([lines[1]]);
    exchange.revealed(2);
    vi.runAllTimers();
    expect(exchange.active).toBe(false);
    expect(show).toHaveBeenCalledTimes(2);
  });
});

it("flushes a queued play after an early swap timer wakes", () => {
  let clock = 0;
  let deadline = 10.5;
  const timers = [];
  const play = vi.fn();
  const queue = createPlayQueue({ ready: () => clock >= deadline, play });
  queue.submit({ kind: "move" }, 3);
  afterDeadline(
    () => deadline,
    () => queue.flush(),
    {
      now: () => clock,
      schedule: (callback) => timers.push(callback),
    },
  );
  // A timer rounded to whole milliseconds can wake before 10.5.
  clock = 10;
  timers.shift()();
  expect(play).not.toHaveBeenCalled();
  expect(queue.pending).not.toBeNull();
  // A later redraw may extend the current swap while this timer waits.
  deadline = 11.5;
  clock = 11;
  timers.shift()();
  expect(play).not.toHaveBeenCalled();
  clock = 12;
  timers.shift()();
  expect(play).toHaveBeenCalledTimes(1);
  expect(queue.pending).toBeNull();
  expect(timers).toHaveLength(0);
});

it("keeps an expired deadline callback asynchronous during a render", () => {
  const callback = vi.fn();
  const timers = [];
  afterDeadline(() => 1, callback, {
    now: () => 2,
    schedule: (run, delay) => timers.push({ run, delay }),
  });
  expect(callback).not.toHaveBeenCalled();
  expect(timers[0].delay).toBe(0);
  timers.shift().run();
  expect(callback).toHaveBeenCalledTimes(1);
});
