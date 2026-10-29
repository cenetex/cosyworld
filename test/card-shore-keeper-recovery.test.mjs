import { describe, it, expect } from "vitest";
import {
  createWorld,
  plan,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { questPrograms } from "../v2/card-game/quests.mjs";
function readyMeeting() {
  const s = createWorld();
  s.turn = s.revision = 100;
  s.actors.vale.place = "pond";
  s.actors.keeper.place = "attic";
  s.actors.moth.place = "pond";
  s.items.lamp.holder = "moth";
  s.items.lamp.fuel = 6;
  s.items.lamp.lit = true;
  s.items.oil.holder = "pond";
  s.items.oil.doses = 0;
  s.items.bell.holder = "station";
  s.items.cloth.holder = "keeper";
  s.locations.attic.anchored = true;
  s.actors.vale.progress = { program: 0, step: 2, marks: [1, 2] };
  s.actors.keeper.progress = { program: 0, step: 1, marks: [1] };
  s.actors.moth.progress = {
    program: 2,
    step: 1,
    marks: [1, 2, 3, 4, 5],
    completedHands: 4,
    recent: [],
    current: {
      id: "generated-moth-3",
      name: "Lamp journey",
      steps: [
        { items: ["lamp"], location: null, avatars: [] },
        {
          items: ["lamp"],
          location: "station",
          avatars: ["vale", "keeper"],
          conditions: [{ kind: "lit", item: "lamp" }],
        },
        { items: ["lamp"], location: "pond", avatars: [] },
      ],
      generated: {
        turn: 95,
        level: 3,
        item: "lamp",
        owner: "moth",
        partner: "keeper",
        situation: "bargain",
      },
    },
  };
  validateWorld(s);
  return s;
}
describe("recover a stalled authored shore hand", () => {
  it("uncovers the owned bell to make the oil recovery possible", () => {
    const s = readyMeeting();
    s.actors.keeper.place = "station";
    s.actors.moth.place = "station";
    s.items.lamp.fuel = 0;
    s.items.lamp.lit = false;
    s.items.oil.holder = "moth";
    s.items.bell.holder = "keeper";
    s.items.cloth.holder = "bell";
    validateWorld(s);
    const a = plan(s, "keeper").action;
    expect(a).toMatchObject({ kind: "take", item: "cloth" });
    const wait = legalActions(s).find((a) => a.kind === "wait");
    const r = play(s, wait);
    expect(r.ok).toBe(true);
    expect(r.state.items.cloth.holder).toBe("keeper");
    expect(r.state.items.bell.holder).toBe("keeper");
  });
  it("lets Pip visit the ready long-stalled authored hand through actual movement", () => {
    const s = readyMeeting();
    expect(plan(s, "moth").action).toMatchObject({
      kind: "move",
      target: "attic",
    });
    const a = legalActions(s).find((a) => a.kind === "wait");
    const r = play(s, a);
    expect(r.ok).toBe(true);
    expect(r.state.actors.moth.place).toBe("attic");
    expect(r.state.actors.keeper.progress.program).toBe(1);
    expect(r.state.items.cloth.holder).toBe("keeper");
  });
  it("does not send Pip to a hand with an unmet condition", () => {
    const s = readyMeeting(),
      hand = questPrograms.keeper[0].steps[1],
      old = hand.conditions;
    try {
      hand.conditions = [{ kind: "ringing", item: "bell" }];
      expect(plan(s, "moth").action).toMatchObject({
        kind: "move",
        target: "station",
      });
    } finally {
      if (old === undefined) delete hand.conditions;
      else hand.conditions = old;
    }
  });
  it("does not redirect a human-controlled helper", () => {
    const s = readyMeeting();
    s.sharedVersion = 1;
    s.controlledActors = ["vale", "moth"];
    s.presentActors = ["vale", "moth"];
    expect(plan(s, "moth").action).toMatchObject({
      kind: "move",
      target: "station",
    });
  });
});
