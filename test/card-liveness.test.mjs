import { describe, it, expect } from "vitest";
import {
  createWorld,
  plan,
  places,
  things,
  willingToGive,
} from "../v2/card-game/world.mjs";
import { desireFor, generateProgram } from "../v2/card-game/quests.mjs";

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
});
