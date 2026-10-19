import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  plan,
  play,
  canTrade,
  accompanyDecision,
  encodeSave,
  decodeSave,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  enableMotives,
  interest,
  resentment,
  recordReaction,
} from "../v2/card-game/motives.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { cardPlay } from "../v2/card-game/cards.mjs";

const fresh = () => enableMotives(createWorld());
function act(s, kind, fields = {}) {
  const a = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  expect(a, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const result = play(s, a);
  expect(result.ok).toBe(true);
  return result.state;
}
function together(s) {
  for (const actor of Object.values(s.actors)) actor.place = "station";
  return s;
}

describe("shore wants and grievances", () => {
  it("keeps saved possessions, speech, and earned progress when the experiment starts", () => {
    let legacy = createWorld();
    legacy = act(legacy, "take", { item: "lamp" });
    const restored = decodeSave(encodeSave(legacy));
    const active = enableMotives(structuredClone(restored));
    expect(active.actors).toEqual(restored.actors);
    expect(active.items).toEqual(restored.items);
    expect(active.memories).toEqual(restored.memories);
    expect(decodeSave(encodeSave(active))).toEqual(active);
  });

  it("lets different tastes support the same trade, while a slight raises the price", () => {
    let s = together(fresh());
    s.items.bell.holder = "vale";
    expect(canTrade(s, "vale", "bell", "oil")).toBe(true);
    expect(cardPlay(s, ["bell", "oil"]).action.kind).toBe("trade");
    s = act(s, "ring", { item: "bell" });
    expect(resentment(s, "keeper", "vale")).toBe(1);
    s.actors.keeper.place = s.actors.vale.place;
    expect(canTrade(s, "vale", "bell", "oil")).toBe(false);
    expect(decodeSave(encodeSave(s)).motives).toEqual(s.motives);
  });

  it("exchanges real ownership through the existing pair of cards", () => {
    let s = together(fresh());
    s.items.bell.holder = "vale";
    s = act(s, "trade", { item: "bell", receive: "oil" });
    expect(s.items.bell.holder).toBe("keeper");
    expect(s.items.oil.holder).toBe("vale");
    expect(s.log.findLast((e) => e.verb === "trade")).toMatchObject({
      itemId: "bell",
      receiveId: "oil",
    });
  });

  it("records only witnessed noise and makes the Keeper seek space", () => {
    let far = fresh();
    far.items.bell.holder = "vale";
    far = act(far, "ring", { item: "bell" });
    expect(far.motives.grievances.keeper).toEqual([]);
    let near = together(fresh());
    near.items.bell.holder = "vale";
    near = act(near, "ring", { item: "bell" });
    expect(near.actors.keeper.place).toBe("attic");
    expect(near.motives.grievances.keeper[0].reason).toContain("quiet moment");
  });

  it("lets Pip follow a wanted lamp, then refuse company after its light is spoiled", () => {
    let s = together(fresh());
    s.items.lamp.holder = "vale";
    s.items.lamp.lit = true;
    expect(accompanyDecision(s, "vale", "moth", "pond").accepted).toBe(true);
    s = act(s, "snuff", { item: "lamp" });
    expect(resentment(s, "moth", "vale")).toBe(1);
    s.actors.moth.place = s.actors.vale.place;
    expect(accompanyDecision(s, "vale", "moth", "pond").accepted).toBe(false);
    const reply = act(s, "accompany", { target: "moth", destination: "pond" });
    expect(reply.log.findLast((e) => e.verb === "accompany").accepted).toBe(
      false,
    );
    expect(reply.actors.vale.place).toBe("station");
    const facts = narrativeContext(reply).entities.find(
      (e) => e.id === "moth",
    ).facts;
    expect(facts.join(" ")).toContain("spoiled Pip's light");
  });

  it("softens a grievance through a useful gift", () => {
    let s = together(fresh());
    s.items.bell.holder = "vale";
    s.items.lamp.holder = "vale";
    recordReaction(
      s,
      { kind: "ring", actor: "vale", item: "bell" },
      ["keeper"],
      false,
    );
    expect(canTrade(s, "vale", "bell", "oil")).toBe(false);
    s = act(s, "give", { item: "lamp", target: "keeper" });
    expect(resentment(s, "keeper", "vale")).toBe(0);
    expect(s.actors.keeper.trust.vale).toBe(1);
    expect(canTrade(s, "vale", "bell", "oil")).toBe(true);
  });

  it("lets Pip tend a lamp and travel to a preferred place", () => {
    const s = together(fresh());
    s.items.lamp.holder = "moth";
    expect(plan(s, "moth").action.kind).toBe("light");
    s.items.lamp.lit = true;
    expect(plan(s, "moth").action).toMatchObject({
      kind: "move",
      target: "pond",
    });
    s.items.oil.holder = "moth";
    s.items.lamp.fuel = 1;
    expect(plan(s, "moth").action.kind).toBe("refill");
  });

  it("rejects malformed and oversized grievance state", () => {
    for (const bad of [
      null,
      {},
      { version: 2 },
      {
        version: 1,
        grievances: {
          vale: [],
          moth: [],
          keeper: [{ other: "missing", weight: 9 }],
        },
      },
    ]) {
      const s = fresh();
      s.motives = bad;
      expect(() => validateWorld(s)).toThrow();
    }
  });

  it("lets a changed need lead Pip to trade with the Keeper", () => {
    const s = together(fresh());
    s.items.lamp.holder = "moth";
    s.items.lamp.fuel = 1;
    s.items.lamp.lit = true;
    s.items.bell.holder = "keeper";
    s.items.bell.ringing = 3;
    expect(plan(s, "moth").action).toMatchObject({
      kind: "trade",
      item: "cloth",
      receive: "oil",
    });
    const next = act(s, "wait");
    expect(next.items.oil.holder).toBe("moth");
    expect(next.items.cloth.holder).toBe("bell");
    expect(next.items.bell.ringing).toBe(0);
  });

  it("gives an annoyed owner space instead of pursuing them between rooms", () => {
    const s = together(fresh());
    s.items.lamp.holder = "moth";
    s.items.lamp.fuel = 1;
    recordReaction(
      s,
      { kind: "threaten", actor: "moth", target: "keeper" },
      ["keeper"],
      false,
    );
    expect(interest(s, "moth").location).toBe("pond");
    expect(plan(s, "moth").action).toMatchObject({ kind: "light" });
    s.items.lamp.lit = true;
    expect(plan(s, "moth").action).toMatchObject({
      kind: "move",
      target: "pond",
    });
  });

  it("keeps mixed play deterministic and preserves archived quest progress", () => {
    let s = fresh(),
      seed = 1729;
    const progress = Object.fromEntries(
      Object.entries(s.actors).map(([id, a]) => [
        id,
        structuredClone(a.progress),
      ]),
    );
    for (let i = 0; i < 320; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const actions = legalActions(s);
      const action = actions[seed % actions.length];
      const left = play(s, action),
        right = play(decodeSave(encodeSave(s)), action);
      expect(left).toEqual(right);
      expect(left.ok).toBe(true);
      s = left.state;
      for (const [id, a] of Object.entries(s.actors))
        expect(a.progress).toEqual(progress[id]);
      expect(s.log.some((e) => e.kind === "quest")).toBe(false);
    }
    expect(interest(s, "moth").reason).toBeTruthy();
  });
});
