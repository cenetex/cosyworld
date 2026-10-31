import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { forgetCovered } from "../v2/card-game/speech-knowledge.mjs";

const fresh = () => enableMotives(createWorld({ opening: true }));

describe("speech knows only uncovered cards (#1575)", () => {
  it("keeps a covered lamp out of Vale's opening request", () => {
    const s = fresh();
    const full = narrativeContext(s);
    expect(JSON.stringify(full)).toMatch(/lamp/i);
    const limited = forgetCovered(s, full, (id) => id === "lamp");
    expect(JSON.stringify(limited)).not.toMatch(/lamp/i);
    expect(limited.speakers).toEqual(["vale"]);
    expect(limited.entities.map(({ id }) => id)).toContain(limited.location);
    expect(limited.outcome.avatars[0].holding).toEqual([]);
  });

  it("leaves the request untouched once the lamp is uncovered", () => {
    const s = fresh();
    const full = narrativeContext(s);
    expect(forgetCovered(s, full, () => false)).toBe(full);
  });
});
