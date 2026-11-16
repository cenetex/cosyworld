import { describe, expect, it } from "vitest";
import { TONE, voiceTone } from "../v2/card-game/voice-tone.mjs";

function fakeContext() {
  const made = [];
  const node = (kind, extra = {}) => {
    const created = { kind, to: [], connect: (target) => created.to.push(target), ...extra };
    made.push(created);
    return created;
  };
  const param = () => ({ value: 0 });
  const context = {
    destination: { kind: "destination" },
    createBiquadFilter: () => node("filter", { type: "", frequency: param() }),
    createGain: () => node("gain", { gain: param() }),
    createDelay: () => node("delay", { delayTime: param() }),
    createDynamicsCompressor: () =>
      node("compressor", { threshold: param(), ratio: param(), attack: param(), release: param() }),
  };
  return { context, made };
}

function reaches(from, target, seen = new Set()) {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (from.to ?? []).some((next) => reaches(next, target, seen));
}

describe("the voice tone", () => {
  it("runs every voice through one hushed chain to the speakers", () => {
    const { context, made } = fakeContext();
    const input = voiceTone(context);
    expect(input.kind).toBe("filter");
    expect(input.type).toBe("highpass");
    expect(input.frequency.value).toBe(TONE.highpass);
    expect(reaches(input, context.destination)).toBe(true);
    const low = made.find((n) => n.type === "lowpass");
    expect(low.frequency.value).toBe(TONE.lowpass);
    const even = made.find((n) => n.kind === "compressor");
    expect([even.threshold.value, even.ratio.value]).toEqual([TONE.threshold, TONE.ratio]);
    const room = made.find((n) => n.kind === "delay");
    expect(room.delayTime.value).toBe(TONE.echoDelay);
    expect(reaches(room, context.destination)).toBe(true);
  });

  it("builds the chain once for a context", () => {
    const { context, made } = fakeContext();
    expect(voiceTone(context)).toBe(voiceTone(context));
    expect(made.filter((n) => n.kind === "compressor")).toHaveLength(1);
  });

  it("plays straight to the speakers where the audio engine lacks the parts", () => {
    const destination = {};
    expect(voiceTone({ destination })).toBe(destination);
  });
});
