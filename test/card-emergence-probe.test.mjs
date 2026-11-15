import { describe, expect, it, vi } from "vitest";

vi.mock("../v2/card-game/packs.json", async (importOriginal) => {
  const real = await importOriginal();
  const { companyPacks } = await import("./helpers/company-world.mjs");
  return {
    default: { ...real.default, packs: [...real.default.packs, ...companyPacks] },
  };
});

const { probe, walker } = await import("./helpers/emergence-probe.mjs");
const { bondedWorld, RESIDENTS } = await import("./helpers/emergence-world.mjs");

const run = (trust, extra = {}) =>
  probe({
    makeWorld: (seed) => bondedWorld({ seed, trust }),
    seeds: [1, 2],
    turns: 150,
    include: (id) => RESIDENTS.includes(id),
    ...extra,
  });

describe("emergence probe on a made-up world", () => {
  it("sees wants spread and rumours retold between bonded residents", { timeout: 60000 }, () => {
    const r = run(2);
    expect(r.total.heardWants).toBeGreaterThan(0);
    expect(r.total.rumoursHeld).toBeGreaterThan(0);
  });

  it("sees none of it when nobody trusts anybody", { timeout: 60000 }, () => {
    const r = run(0);
    expect(r.total.heardWants).toBe(0);
    expect(r.total.retoldRumours).toBe(0);
  });

  it("is the same run twice and counts a walking player", { timeout: 60000 }, () => {
    const a = run(2, { script: walker() });
    expect(JSON.stringify(run(2, { script: walker() }))).toBe(JSON.stringify(a));
    expect(a.perSeed).toHaveLength(2);
  });
});
