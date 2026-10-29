import { describe, it, expect } from "vitest";
import {
  createWorld,
  plan,
  validateWorld,
  legalActions,
  play,
  addLog,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
function chase() {
  const s = enableMotives(createWorld(), { questPrograms: true });
  s.turn = s.revision = 10;
  s.actors.keeper.place = "station";
  s.actors.moth.place = "pond";
  s.actors.vale.place = "attic";
  s.items.lamp.holder = "moth";
  s.items.cloth.holder = "moth";
  s.items.bell.holder = "moth";
  s.actors.keeper.progress = {
    program: 2,
    step: 0,
    marks: [1, 2, 3, 4],
    completedHands: 4,
    recent: [],
    current: {
      id: "generated-keeper-3",
      name: "Light for everyone",
      steps: [
        {
          items: ["lamp"],
          location: "station",
          avatars: ["moth", "vale"],
          conditions: [{ kind: "lit", item: "lamp" }],
        },
      ],
      generated: {
        turn: 1,
        level: 3,
        item: "lamp",
        owner: "moth",
        partner: "vale",
        situation: "gathering",
      },
    },
  };
  s.motives.grievances.moth.push({
    other: "keeper",
    kind: "light",
    reason: "The keeper spoiled the light.",
    turn: 9,
    weight: 1,
  });
  addLog(s, "World", "Pip goes to Black pond.", {
    kind: "action",
    actorId: "moth",
    verb: "move",
    fromLocationId: "station",
    locationId: "pond",
    targetId: "pond",
    itemId: null,
    witnesses: [],
  });
  return s;
}
describe("giving a holder space", () => {
  it("lets Pip finish the quiet shore through an actual play", () => {
    const s = chase();
    s.actors.vale.place = "station";
    s.items.lamp.fuel = 0;
    s.items.lamp.lit = false;
    s.actors.moth.progress = {
      program: 2,
      step: 0,
      marks: [1, 2, 3, 4],
      completedHands: 4,
      recent: [],
      current: {
        id: "generated-moth-3",
        name: "A quiet shore",
        steps: [
          {
            items: ["bell", "cloth"],
            location: "pond",
            avatars: ["vale"],
            conditions: [{ kind: "covered", item: "bell" }],
            consequence: { kind: "hush" },
          },
        ],
        generated: {
          turn: 1,
          level: 3,
          item: "bell",
          owner: "moth",
          partner: "vale",
          situation: "answer",
        },
      },
    };
    expect(() => validateWorld(s)).not.toThrow();
    const action = legalActions(s).find(
      (a) => a.kind === "move" && a.target === "pond" && !a.item,
    );
    const result = play(s, action);
    expect(result.ok).toBe(true);
    expect(result.state.actors.keeper.place).toBe("station");
    expect(result.state.actors.moth.place).toBe("pond");
    expect(result.state.items.cloth.holder).toBe("bell");
    expect(result.state.locations.pond.answer).toBe("hush");
    expect(result.state.actors.moth.progress.program).toBe(3);
  });
  it("waits for a recent departure, then resumes pursuit after four turns", () => {
    const s = chase();
    expect(plan(s, "keeper")).toMatchObject({
      action: { kind: "wait" },
      reason: "Give Pip some space.",
    });
    s.turn = 13;
    expect(plan(s, "keeper").action.kind).toBe("wait");
    s.turn = 14;
    expect(plan(s, "keeper").action).toMatchObject({
      kind: "move",
      target: "pond",
    });
  });
  it("keeps unrelated travel and the chaser’s other choices available", () => {
    const s = chase();
    s.items.oil.holder = "keeper";
    s.actors.keeper.progress.current.steps[0] = {
      items: ["oil"],
      location: "pond",
      avatars: [],
    };
    expect(plan(s, "keeper").action).toMatchObject({
      kind: "move",
      target: "pond",
    });
  });
  it("uses the normal plan when no matching grievance or departure exists", () => {
    const s = chase();
    s.motives.grievances.moth = [];
    expect(plan(s, "keeper").action).toMatchObject({
      kind: "move",
      target: "pond",
    });
    const t = chase();
    t.log = [];
    expect(plan(t, "keeper").action).toMatchObject({
      kind: "move",
      target: "pond",
    });
  });
  it("keeps a standoff and peace ahead of the space preference", () => {
    const s = chase();
    s.standoffs = [
      {
        challenger: "vale",
        defender: "keeper",
        location: "station",
        item: null,
        opened: 10,
        answered: false,
        resolve: { vale: 3, keeper: 3 },
        guarding: { vale: false, keeper: false },
        struck: { vale: false, keeper: false },
      },
    ];
    expect(plan(s, "keeper").reason).not.toBe("Give Pip some space.");
    const t = chase();
    t.peaceUntil.keeper = 11;
    expect(plan(t, "keeper").reason).not.toBe("Give Pip some space.");
  });
});
