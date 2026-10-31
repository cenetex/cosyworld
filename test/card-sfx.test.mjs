import { describe, expect, it } from "vitest";
import { createSfx, heardRing } from "../v2/card-game/sfx.mjs";

function fakeContext() {
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  return {
    state: "running",
    currentTime: 5,
    destination: {},
    oscillators: [],
    outputs: [],
    createGain() {
      const gain = { gain: param(), connect() {} };
      this.outputs.push(gain);
      return gain;
    },
    createOscillator() {
      const tone = {
        frequency: param(),
        connect() {},
        start() {},
        stop() {},
      };
      this.oscillators.push(tone);
      return tone;
    },
    resume: async () => {},
  };
}

const ring = (seq, locationId) => ({ seq, verb: "ring", locationId });
const talk = (seq, locationId) => ({ seq, verb: "talk", locationId });

describe("world sound effects", () => {
  it("finds the newest ring here or next door", () => {
    const log = [ring(1, "pond"), talk(2, "pond"), ring(3, "shore")];
    expect(heardRing(log, 0, "pond", [])).toEqual({ seq: 1, near: true });
    expect(heardRing(log, 1, "pond", [])).toBeNull();
    expect(heardRing(log, 1, "pond", ["shore"])).toEqual({
      seq: 3,
      near: false,
    });
  });

  it("plays one bell for a committed ring and respects mute", () => {
    let made = null;
    const sfx = createSfx({ makeContext: () => (made = fakeContext()) });
    const log = [talk(1, "pond")];
    // The first look marks the log without ringing.
    expect(sfx.watch(log, "pond", [])).toBe(false);
    sfx.unlock();
    expect(sfx.watch([...log, ring(2, "pond")], "pond", [])).toBe(true);
    expect(made.oscillators).toHaveLength(5);
    // The same event never rings twice, and rings do not overlap.
    expect(sfx.watch([...log, ring(2, "pond")], "pond", [])).toBe(false);
    expect(sfx.watch([ring(3, "pond")], "pond", [])).toBe(false);
    made.currentTime += 4;
    sfx.setEnabled(false);
    expect(sfx.watch([ring(4, "pond")], "pond", [])).toBe(false);
    sfx.setEnabled(true);
    sfx.setVolume(0);
    expect(sfx.watch([ring(5, "pond")], "pond", [])).toBe(false);
    expect(made.oscillators).toHaveLength(5);
  });

  it("stays silent before a gesture", () => {
    let made = null;
    const sfx = createSfx({ makeContext: () => (made = fakeContext()) });
    sfx.watch([], "pond", []);
    expect(sfx.watch([ring(1, "pond")], "pond", [])).toBe(false);
    expect(made).toBeNull();
  });
});
