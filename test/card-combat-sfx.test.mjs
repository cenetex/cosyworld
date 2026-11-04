import { describe, expect, it } from "vitest";
import {
  COMBAT_SOUNDS,
  combatSound,
  combatSoundSeed,
  soundJitter,
} from "../v2/card-game/combat-sfx.mjs";
import { createSfx, seeded } from "../v2/card-game/sfx.mjs";

// A Web Audio stand-in that records each voice's frequencies and gains.
function fakeContext() {
  const param = () => {
    const p = { value: 0, ramps: [] };
    p.setValueAtTime = (v) => p.ramps.push(v);
    p.exponentialRampToValueAtTime = (v) => p.ramps.push(v);
    return p;
  };
  const node = (extra) => ({ connect() {}, start() {}, stop() {}, ...extra });
  return {
    state: "running",
    currentTime: 2,
    sampleRate: 8000,
    destination: {},
    tones: [],
    filters: [],
    outputs: [],
    createGain() {
      const gain = node({ gain: param() });
      this.outputs.push(gain);
      return gain;
    },
    createOscillator() {
      const tone = node({ frequency: param() });
      this.tones.push(tone);
      return tone;
    },
    createBiquadFilter() {
      const filter = node({ frequency: param(), Q: param() });
      this.filters.push(filter);
      return filter;
    },
    createBufferSource: () => node({}),
    createBuffer: (channels, length) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    resume: async () => {},
  };
}

const attack = (extra) => ({ seq: 9, kind: "attack", damage: 1, ...extra });

describe("fight sounds follow the committed beats", () => {
  it("maps each beat's phase to its sound", () => {
    expect(combatSound(attack({ outcome: "hit" }), "telegraph")).toBeNull();
    expect(combatSound(attack({ outcome: "hit" }), "strike")).toBe("whoosh");
    expect(combatSound(attack({ outcome: "hit" }), "impact")).toBe("bam");
    expect(combatSound(attack({ outcome: "hit", damage: 2 }), "impact")).toBe(
      "pow",
    );
    expect(combatSound(attack({ outcome: "yield", damage: 3 }), "impact")).toBe(
      "pow",
    );
    expect(combatSound(attack({ outcome: "guarded" }), "impact")).toBe("block");
    expect(combatSound(attack({ outcome: "hit" }), "resolve")).toBeNull();
    expect(combatSound({ kind: "guard" }, "telegraph")).toBeNull();
    expect(combatSound({ kind: "guard" }, "resolve")).toBe("block");
    expect(combatSound({ kind: "threaten" }, "telegraph")).toBe("whoosh");
    expect(combatSound({ kind: "intercept" }, "telegraph")).toBe("whoosh");
    expect(combatSound({ kind: "threaten" }, "resolve")).toBeNull();
    expect(combatSound({ kind: "defeat" }, "beaten")).toBe("thud");
    expect(combatSound(null, "impact")).toBeNull();
    for (const kind of ["attack", "guard", "threaten", "defeat"])
      for (const phase of ["telegraph", "strike", "impact", "resolve"]) {
        const name = combatSound(attack({ kind }), phase);
        if (name) expect(COMBAT_SOUNDS).toContain(name);
      }
  });

  it("varies pitch and filter slightly, the same for the same beat", () => {
    const beat = attack({ outcome: "hit" });
    const once = soundJitter(seeded(combatSoundSeed(beat, "impact")));
    const again = soundJitter(seeded(combatSoundSeed(beat, "impact")));
    const next = soundJitter(
      seeded(combatSoundSeed({ ...beat, seq: 10 }, "impact")),
    );
    expect(again).toEqual(once);
    expect(next).not.toEqual(once);
    for (const { pitch, filter } of [once, next]) {
      expect(Math.abs(pitch - 1)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(filter - 1)).toBeLessThanOrEqual(0.1);
    }
  });
});

describe("fight sounds respect the player's settings", () => {
  const ready = () => {
    let made = null;
    const sfx = createSfx({ makeContext: () => (made = fakeContext()) });
    return { sfx, made: () => made };
  };

  it("waits for a gesture", () => {
    const { sfx, made } = ready();
    expect(sfx.fight("bam", 1)).toBe(false);
    expect(made()).toBeNull();
  });

  it("plays each sound under the battle song's volume", () => {
    const { sfx, made } = ready();
    sfx.setVolume(0.5);
    sfx.unlock();
    for (const name of COMBAT_SOUNDS) expect(sfx.fight(name, 3)).toBe(true);
    expect(sfx.fight("unknown", 3)).toBe(false);
    expect(sfx.fight(null, 3)).toBe(false);
    const outs = made().outputs.filter((g) => g.gain.value > 0);
    expect(outs).toHaveLength(COMBAT_SOUNDS.length);
    for (const out of outs) expect(out.gain.value).toBeLessThan(0.5);
  });

  it("is silent with Voices off, the volume at zero or the tab hidden", () => {
    const { sfx, made } = ready();
    sfx.unlock();
    const count = () => made().tones.length + made().filters.length;
    sfx.setVoices(false);
    expect(sfx.fight("pow", 1)).toBe(false);
    sfx.setVoices(true);
    sfx.setVolume(0);
    expect(sfx.fight("pow", 1)).toBe(false);
    sfx.setVolume(0.3);
    sfx.setHidden(true);
    expect(sfx.fight("pow", 1)).toBe(false);
    expect(count()).toBe(0);
    sfx.setHidden(false);
    // The music switch is the bell's; fight sounds follow Voices.
    sfx.setEnabled(false);
    expect(sfx.fight("pow", 1)).toBe(true);
    expect(count()).toBeGreaterThan(0);
  });
});
