import { describe, it, expect } from "vitest";
import { setImmediate as yieldToRunner } from "node:timers/promises";
import {
  createWorld,
  legalActions,
  plan,
  play,
  places,
  things,
  willingToGive,
} from "../v2/card-game/world.mjs";
import {
  desireFor,
  generateProgram,
  levelOf,
} from "../v2/card-game/quests.mjs";

const actors = ["vale", "moth", "keeper"];
const progressOf = (s) =>
  actors.map((id) => levelOf(s, id) * 100 + s.actors[id].progress.step);

// Pip holds a lamp at the station and waits for the keeper there. The keeper
// holds the cloth in the attic and waits for Pip there.
function facingWaits() {
  const s = createWorld();
  s.actors.moth.progress = { program: 1, step: 1, marks: [1, 2, 3] };
  s.actors.keeper.progress = { program: 0, step: 1, marks: [1] };
  s.actors.moth.place = "station";
  s.items.lamp.holder = "moth";
  s.items.cloth.holder = "keeper";
  return s;
}

describe("the table stays playable", () => {
  it("ends two waits that face each other", () => {
    const s = facingWaits();
    expect(desireFor(s, "moth")).toEqual({
      items: ["lamp"],
      location: "station",
      avatars: ["keeper"],
    });
    expect(desireFor(s, "keeper")).toEqual({
      items: ["cloth"],
      location: "attic",
      avatars: ["moth"],
    });
    expect(plan(s, "moth").action.kind).not.toBe("move");
    expect(plan(s, "keeper").action).toMatchObject({
      kind: "move",
      target: "station",
    });
  });

  it("stays beside Vale while Vale holds a wanted item", () => {
    const s = createWorld();
    s.actors.keeper.progress = { program: 0, step: 1, marks: [1] };
    s.items.cloth.holder = "vale";
    s.actors.vale.place = "attic";
    s.actors.moth.place = "station";
    s.items.lamp.holder = "moth";
    s.actors.moth.progress = { program: 1, step: 1, marks: [1, 2, 3] };
    expect(desireFor(s, "keeper").items).toEqual(["cloth"]);
    expect(plan(s, "keeper").reason).not.toMatch(/^Meet/);
  });

  it("builds cast goals that leave other avatars' wants free", () => {
    const s = createWorld();
    s.items.lamp.holder = "moth";
    expect(desireFor(s, "vale").items).toEqual(["lamp"]);
    for (let program = 0; program < 6; program++) {
      s.actors.moth.progress.program = program;
      const p = generateProgram(structuredClone(s), "moth", places, things, {
        independent: true,
      });
      expect(p.generated.item).not.toBe("lamp");
      const kept = p.steps
        .flatMap((step) => step.any || [step])
        .flatMap((h) => h.items);
      expect(kept).not.toContain("lamp");
    }
  });

  it("sets a long-stalled bargain aside for an errand the cast can finish alone", () => {
    const s = createWorld();
    s.items.lamp.holder = "moth";
    const p = generateProgram(structuredClone(s), "moth", places, things, {
      independent: true,
      solo: true,
    });
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0].items).toEqual(["cloth"]);
    expect(p.steps[0].avatars).toEqual([]);
    expect(Object.keys(places)).toContain(p.steps[0].location);
    expect(p.steps[0].location).not.toBe(s.actors.moth.place);
    expect(p.generated).toMatchObject({ solo: true, owner: "moth" });
  });

  it("gives Vale a spare sooner after Vale has waited a long while", () => {
    const s = createWorld();
    s.actors.moth.place = "station";
    s.actors.moth.progress = { program: 1, step: 0, marks: [1, 2] };
    s.items.lamp.holder = "moth";
    s.items.cloth.holder = "keeper";
    expect(desireFor(s, "moth").items).toEqual(["cloth"]);
    s.turn = 23;
    expect(willingToGive(s, "moth", "lamp", "vale")).toBe(false);
    s.turn = 24;
    expect(willingToGive(s, "moth", "lamp", "vale")).toBe(true);
    expect(willingToGive(s, "moth", "lamp", "keeper")).toBe(false);
    expect(willingToGive(s, "moth", "lamp")).toBe(false);
  });

  it("keeps every avatar progressing after long loose play", async () => {
    // These seeds left the whole world frozen before the liveness rules.
    for (let seed = 1; seed <= 10; seed++) {
      let x = (seed * 2654435761) >>> 0,
        s = createWorld();
      for (let i = 0; i < 400; i++) {
        // Let the runner record progress while all 5,600 turns stay covered.
        if (i % 100 === 0) await yieldToRunner();
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        const acts = legalActions(s);
        s = play(s, i % 2 === 0 ? plan(s).action : acts[x % acts.length]).state;
      }
      const before = progressOf(s);
      const completed = new Set();
      for (let i = 0; i < 160; i++) {
        if (i % 100 === 0) await yieldToRunner();
        const next = play(s, plan(s).action).state;
        for (const id of actors)
          if (
            next.actors[id].progress.marks.at(-1) !==
            s.actors[id].progress.marks.at(-1)
          )
            completed.add(id);
        s = next;
      }
      expect(progressOf(s), `seed ${seed}`).not.toEqual(before);
      expect([...completed].sort(), `seed ${seed}`).toEqual([...actors].sort());
    }
  }, 120_000);
});
