import { describe, it, expect } from "vitest";
import fixture from "./lamp-offer.fixture.json";
import { createWorld, plan, play } from "../v2/card-game/world.mjs";

function stalled() {
  const s = createWorld();
  Object.assign(s.actors, structuredClone(fixture.actors));
  Object.assign(s.items, structuredClone(fixture.items));
  Object.assign(s.locations, structuredClone(fixture.locations));
  s.turn = fixture.turn;
  s.revision = fixture.revision;
  return s;
}
function step(s) {
  const action = plan(s).action;
  const result = play(s, action);
  expect(result.ok).toBe(true);
  return result.state;
}

describe("sharing oil for the attic light", () => {
  it("offers oil to the willing lamp holder and recovers the journey", () => {
    let s = stalled();
    expect(plan(s).action).toMatchObject({ kind: "drop", item: "oil" });
    s = step(s);
    expect(s.items.oil.holder).toBe("keeper");
    expect(s.items.lamp.fuel).toBe(0);
    expect(plan(s).action).toMatchObject({
      kind: "ask",
      item: "oil",
      target: "keeper",
    });
    s = step(s);
    expect(s.items.lamp.fuel).toBeGreaterThan(0);
    s = step(s);
    expect(s.items.oil.holder).toBe("vale");
    for (let i = 0; i < 5 && s.actors.vale.progress.step === 1; i++)
      s = step(s);
    expect(s.actors.vale.place).toBe("attic");
    expect(s.actors.vale.progress.step).not.toBe(1);
  });
  it("keeps oil when the lamp holder plans a different action", () => {
    const s = stalled();
    s.actors.keeper.progress.current.steps[0] = {
      items: [],
      location: "station",
      avatars: ["moth"],
      conditions: [{ kind: "heldBy", item: "lamp", avatar: "moth" }],
    };
    expect(plan(s, "keeper").action.kind).not.toBe("refill");
    expect(plan(s).action).not.toMatchObject({ kind: "drop", item: "oil" });
    expect(s.items.oil.holder).toBe("vale");
  });
  it("waits for a nearby holder who will refill from oil on the floor", () => {
    const s = stalled();
    s.items.oil.holder = "station";
    s.actors.keeper.progress.current.steps[0] = {
      items: ["lamp"],
      location: "station",
      avatars: [],
    };
    expect(plan(s, "keeper").action).toMatchObject({
      kind: "refill",
      item: "oil",
    });
    expect(plan(s).action.kind).toBe("wait");
    const next = step(s);
    expect(next.items.lamp.fuel).toBeGreaterThan(0);
    expect(next.items.oil.holder).toBe("station");
    expect(plan(next).action).toMatchObject({ kind: "take", item: "oil" });
  });
});
