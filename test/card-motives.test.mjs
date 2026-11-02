import { setImmediate as yieldToRunner } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  plan,
  play,
  addLog,
  publishKnowledgeSpeech,
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
  motiveFacts,
} from "../v2/card-game/motives.mjs";
import {
  GRIEVANCE_DORMANT_TURNS,
  knowsFact,
  reserveKnowledge,
} from "../v2/card-game/knowledge.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { stayingWith } from "../v2/card-game/life.mjs";

const fresh = () => enableMotives(createWorld());
// A slight taken from the latest committed event.
const slight = (s, a, witnesses) =>
  recordReaction(s, a, witnesses, false, { seq: s.eventSeq });
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
    slight(s, { kind: "ring", actor: "vale", item: "bell" }, ["keeper"]);
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
      kind: "place",
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

  it("repairs a grievance by a gift in person, for those present and then those told", () => {
    let s = together(fresh());
    s.items.bell.holder = "vale";
    s = act(s, "ring", { item: "bell" });
    const [g] = s.motives.grievances.keeper;
    expect(g.incident).toBe(
      `event:${s.log.findLast((e) => e.verb === "ring").seq}`,
    );
    // Pip took the same offence but is away when Vale makes amends.
    s.motives.grievances.moth.push({ ...g });
    s.actors.moth.place = "pond";
    // The keeper wants the bell, so this gift also earns its trust.
    s = act(s, "give", { item: "bell", target: "keeper" });
    expect(s.actors.keeper.trust.vale).toBe(1);
    const repair = Object.values(s.knowledge.facts).find(
      (f) => f.source.kind === "repair",
    );
    expect(repair.source).toMatchObject({
      actorId: "vale",
      answers: { recipient: "keeper", incident: g.incident },
    });
    // Closed is dormant, not deleted, and the gift buys no strength off.
    expect(s.motives.grievances.keeper).toMatchObject([
      { weight: 1, repaired: true },
    ]);
    expect(resentment(s, "keeper", "vale")).toBe(0);
    expect(resentment(s, "moth", "vale")).toBe(1);
    expect(decodeSave(encodeSave(s))).toEqual(s);
    // The keeper tells Pip; hearing the repair closes Pip's grievance too.
    s.actors.moth.place = s.actors.keeper.place;
    for (let i = 0; i < 4 && !knowsFact(s, "moth", repair.id); i++) {
      addLog(s, "The Keeper", "Listen.", {
        kind: "dialogue",
        generated: true,
        actorId: "keeper",
      });
      const entry = s.log.at(-1);
      const told = reserveKnowledge(s, "keeper", "moth", entry);
      const text = s.knowledge.facts[told.factId].text;
      entry.text = text;
      const { factId, speaker, listener, eventSeq } = told;
      const said = { factId, speaker, listener, eventSeq, text };
      publishKnowledgeSpeech(s, entry, [said]);
    }
    expect(s.knowledge.known.moth[repair.id].kind).toBe("heard");
    expect(resentment(s, "moth", "vale")).toBe(0);
  });

  it("repairs nothing when the aggrieved avatar is not there to see the gift", () => {
    let s = together(fresh());
    s.items.lamp.holder = "vale";
    slight(s, { kind: "ring", actor: "vale", item: "bell" }, ["keeper"]);
    s.actors.keeper.place = "pond";
    const before = structuredClone(s.motives);
    s = act(s, "give", { item: "lamp", target: "moth" });
    expect(s.motives).toEqual(before);
    expect(
      Object.values(s.knowledge.facts).some((f) => f.source.kind === "repair"),
    ).toBe(false);
  });

  it("lets a grievance go dormant without news, then wakes it from its floor", () => {
    const s = together(fresh());
    slight(s, { kind: "ring", actor: "vale", item: "bell" }, ["keeper"]);
    slight(s, { kind: "ring", actor: "vale", item: "bell" }, ["keeper"]);
    s.turn = s.revision = GRIEVANCE_DORMANT_TURNS - 1;
    expect(resentment(s, "keeper", "vale")).toBe(2);
    s.turn = s.revision = GRIEVANCE_DORMANT_TURNS;
    expect(resentment(s, "keeper", "vale")).toBe(0);
    expect(motiveFacts(s, "keeper").join(" ")).not.toContain("grievance");
    expect(s.motives.grievances.keeper[0].weight).toBe(2);
    slight(s, { kind: "ring", actor: "vale", item: "bell" }, ["keeper"]);
    expect(s.motives.grievances.keeper[0]).toMatchObject({
      weight: 3,
      lastTouched: GRIEVANCE_DORMANT_TURNS,
    });
    expect(resentment(s, "keeper", "vale")).toBe(3);
  });

  it("lets friendly company keep an active grudge on mind but never wake a dormant one", () => {
    let s = together(fresh());
    s.actors.moth.want = {
      kind: "place",
      target: "pond",
      since: 0,
      refusals: 0,
    };
    slight(s, { kind: "threaten", actor: "vale", target: "moth" }, [
      "moth",
      "vale",
    ]);
    const [g] = s.motives.grievances.moth;
    s.turn = s.revision = GRIEVANCE_DORMANT_TURNS + 3;
    expect(resentment(s, "moth", "vale")).toBe(0);
    expect(accompanyDecision(s, "vale", "moth", "pond").accepted).toBe(true);
    s = act(s, "accompany", { target: "moth", destination: "pond" });
    expect(s.log.findLast((e) => e.verb === "accompany").accepted).toBe(true);
    // The accepted journey neither touches nor wakes the dormant grudge,
    // so Pip stays with Vale.
    expect(s.motives.grievances.moth[0]).toMatchObject({
      lastTouched: g.lastTouched,
      weight: 1,
    });
    expect(resentment(s, "moth", "vale")).toBe(0);
    expect(stayingWith(s, "moth")).toBe("vale");
    // While a grudge is still active, the same contact keeps it on mind.
    const t = together(fresh());
    slight(t, { kind: "threaten", actor: "vale", target: "moth" }, [
      "moth",
      "vale",
    ]);
    t.turn = t.revision = 5;
    recordReaction(
      t,
      { kind: "give", actor: "vale", target: "moth" },
      ["moth", "vale"],
      false,
      { seq: t.eventSeq },
    );
    expect(t.motives.grievances.moth[0].lastTouched).toBe(5);
  });

  it("wakes a dormant grudge from its floor only by a new hostile incident", () => {
    let s = together(fresh());
    slight(s, { kind: "threaten", actor: "vale", target: "moth" }, [
      "moth",
      "vale",
    ]);
    s.motives.grievances.moth[0].repaired = true;
    s.turn = s.revision = 2;
    // A repaired grudge stays closed through a friendly gift.
    recordReaction(
      s,
      { kind: "give", actor: "vale", target: "moth" },
      ["moth", "vale"],
      true,
      { seq: s.eventSeq },
    );
    expect(s.motives.grievances.moth[0]).toMatchObject({
      repaired: true,
      lastTouched: 0,
    });
    s.turn = s.revision = GRIEVANCE_DORMANT_TURNS + 3;
    s = act(s, "threaten", { target: "moth" });
    expect(s.motives.grievances.moth).toMatchObject([
      { weight: 2, repaired: false, lastTouched: s.turn },
    ]);
    expect(resentment(s, "moth", "vale")).toBe(2);
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
    slight(s, { kind: "threaten", actor: "keeper", target: "moth" }, ["moth"]);
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
