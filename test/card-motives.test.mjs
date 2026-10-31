import { setImmediate as yieldToRunner } from "node:timers/promises";
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
  for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
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
    // Tastes alone decide here: the keeper's quest is elsewhere.
    s.actors.keeper.want = null;
    s.items.bell.holder = "vale";
    expect(canTrade(s, "vale", "bell", "oil")).toBe(true);
    expect(cardPlay(s, ["bell", "oil"]).action.kind).toBe("trade");
    s = act(s, "ring", { item: "bell" });
    expect(resentment(s, "keeper", "vale")).toBe(1);
    s.actors.keeper.place = s.actors.vale.place;
    // One slight leaves the bell just enough; a second raises the price.
    expect(canTrade(s, "vale", "bell", "oil")).toBe(true);
    recordReaction(
      s,
      { kind: "ring", actor: "vale", item: "bell" },
      ["keeper"],
      false,
    );
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

  it("records only witnessed noise", () => {
    let far = fresh();
    far.items.bell.holder = "vale";
    far = act(far, "ring", { item: "bell" });
    expect(far.motives.grievances.keeper).toEqual([]);
    let near = together(fresh());
    near.items.bell.holder = "vale";
    near = act(near, "ring", { item: "bell" });
    expect(near.motives.grievances.keeper[0].reason).toContain("quiet moment");
  });

  it("lets Pip follow a wanted lamp that Vale carries", () => {
    const s = together(fresh());
    s.items.lamp.holder = "vale";
    expect(accompanyDecision(s, "vale", "moth", "pond").accepted).toBe(true);
  });

  it("lets Pip go along toward its want, then refuse company after its light is spoiled", () => {
    let s = together(fresh());
    s.items.lamp.holder = "vale";
    s.items.lamp.lit = true;
    s.actors.moth.want = {
      verb: "visit",
      target: "pond",
      since: 0,
      refusals: 0,
    };
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

  it("softens a grievance through a gift, and trusts the giver of a wanted item", () => {
    let s = together(fresh());
    s.items.bell.holder = "vale";
    s.items.lamp.holder = "vale";
    recordReaction(
      s,
      { kind: "ring", actor: "vale", item: "bell" },
      ["keeper"],
      false,
    );
    expect(resentment(s, "keeper", "vale")).toBe(1);
    // The keeper wants the bell, so this gift also earns its trust.
    s = act(s, "give", { item: "bell", target: "keeper" });
    expect(resentment(s, "keeper", "vale")).toBe(0);
    expect(s.actors.keeper.trust.vale).toBe(1);
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

  it("takes the homeward exit when both paths give space from a grievance", () => {
    const s = fresh();
    s.turn = s.revision = 12;
    s.actors.moth.place = s.actors.keeper.place = "hoppycat-halfway-tea-garden";
    recordReaction(
      s,
      { kind: "threaten", actor: "keeper", target: "moth" },
      ["moth"],
      false,
    );
    const before = structuredClone(s);
    expect(plan(s, "moth").action).toMatchObject({
      kind: "move",
      target: "pond",
    });
    expect(s).toEqual(before);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("keeps the cast meeting wants with motives", async () => {
    for (const initial of [7, 42, 1729]) {
      let s = fresh();
      let seed = initial;
      for (let i = 0; i < 240; i++) {
        if (i % 20 === 0) await yieldToRunner();
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const actions = legalActions(s);
        const action = i % 3 ? plan(s).action : actions[seed % actions.length];
        const result = play(s, action);
        if (i % 20 === 0)
          expect(result).toEqual(play(decodeSave(encodeSave(s)), action));
        expect(result.ok).toBe(true);
        s = result.state;
      }
      // A resident can end up behind a closed reflection for a while, so
      // the pair is measured together.
      expect(s.actors.moth.xp + s.actors.keeper.xp).toBeGreaterThan(6);
      expect(decodeSave(encodeSave(s))).toEqual(s);
    }
  }, 60_000);

  it("keeps mixed play deterministic", async () => {
    let s = fresh(),
      seed = 1729;
    for (let i = 0; i < 320; i++) {
      if (i % 20 === 0) await yieldToRunner();
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const actions = legalActions(s);
      const action = actions[seed % actions.length];
      const left = play(s, action),
        right = play(decodeSave(encodeSave(s)), action);
      expect(left).toEqual(right);
      expect(left.ok).toBe(true);
      s = left.state;
      expect(s.log.some((e) => e.kind === "quest")).toBe(false);
    }
  }, 60_000);
});
