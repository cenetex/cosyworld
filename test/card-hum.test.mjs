import { describe, expect, it } from "vitest";
import { createHum, humIntensity } from "../v2/card-game/hum.mjs";

function fakeContext() {
  const param = (value = 0) => ({
    value,
    events: [],
    cancelScheduledValues() {},
    setValueAtTime(v, t) {
      this.events.push(["set", v, t]);
    },
    linearRampToValueAtTime(v, t) {
      this.events.push(["ramp", v, t]);
      this.value = v;
    },
  });
  const node = () => ({ gain: param(1), connect() {} });
  const context = {
    state: "running",
    currentTime: 10,
    destination: {},
    oscillators: [],
    gains: [],
    createGain() {
      const g = node();
      this.gains.push(g);
      return g;
    },
    createOscillator() {
      const o = { frequency: param(), type: "sine", connect() {}, start() {} };
      this.oscillators.push(o);
      return o;
    },
    resume: async () => {},
    suspend: async () => {},
  };
  return context;
}

describe("the Willows hum", () => {
  it("is heard only on the island, louder deeper in and at night", () => {
    expect(humIntensity("attic")).toBe(0);
    expect(humIntensity("greek-ship")).toBe(0);
    expect(humIntensity("willows-bank")).toBeGreaterThan(
      humIntensity("willows-landing"),
    );
    expect(humIntensity("willows-camp", true)).toBeGreaterThan(
      humIntensity("willows-camp"),
    );
  });

  it("waits for a gesture, follows the music switch and volume, and hushes", () => {
    let made = null;
    const hum = createHum({ makeContext: () => (made = fakeContext()) });
    hum.setStarted(true);
    hum.setRoom("willows-thicket");
    expect(made).toBeNull();
    expect(hum.level).toBe(0);
    hum.unlock();
    expect(made).not.toBeNull();
    const freqs = made.oscillators.map((o) => o.frequency.value);
    const drones = freqs.filter((f) => f >= 55 && f <= 110);
    expect(drones.length).toBeGreaterThanOrEqual(2);
    const beat = Math.abs(drones[1] - drones[0]);
    expect(beat).toBeGreaterThanOrEqual(1);
    expect(beat).toBeLessThanOrEqual(3);
    expect(freqs.some((f) => f > 200)).toBe(true);
    expect(freqs.some((f) => f < 1)).toBe(true); // the slow LFO
    const loud = hum.level;
    expect(loud).toBeGreaterThan(0);
    hum.setVolume(0.6);
    expect(hum.level).toBeCloseTo(loud * 2);
    hum.setEnabled(false);
    expect(hum.level).toBe(0);
    hum.setEnabled(true);
    const master = made.gains[0].gain;
    hum.hush();
    expect(master.events).toContainEqual(["ramp", 0, 10.3]);
    hum.setRoom("attic");
    expect(hum.level).toBe(0);
  });
});
