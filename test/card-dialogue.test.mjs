import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createTextReveal,
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
