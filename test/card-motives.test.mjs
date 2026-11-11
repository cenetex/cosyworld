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
    s.items.cloth.holder = "vale";
    s.actors.vale.heldItem = "lamp";
    s = act(s, "cover", { item: "cloth", target: "lamp" });
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

  // A threat over the cloth, taken from a real committed event.
  const threatened = (s) => {
    s.actors.keeper.want = {
      kind: "place",
      target: "pond",
      since: 0,
      refusals: 0,
    };
    s.items.cloth.holder = "vale";
    s.items.oil.holder = "vale";
    slight(
      s,
      { kind: "threaten", actor: "vale", target: "keeper", item: "cloth" },
      ["keeper"],
    );
    return s.motives.grievances.keeper[0];
  };
  const repairs = (s) =>
    Object.values(s.knowledge.facts).filter((f) => f.source.kind === "repair");

  it("records what an incident took or damaged on the grievance", () => {
    let s = together(fresh());
    s.items.lamp.holder = "vale";
    s.items.lamp.lit = true;
    s.items.cloth.holder = "vale";
    s.actors.vale.heldItem = "lamp";
    s = act(s, "cover", { item: "cloth", target: "lamp" });
    expect(s.motives.grievances.moth[0]).toMatchObject({
      kind: "light",
      item: "lamp",
    });
    expect(threatened(s)).toMatchObject({ kind: "threat", item: "cloth" });
    s.items.lamp.holder = "station";
    s.items.bell.holder = "vale";
    s = act(s, "ring", { item: "bell" });
    expect(s.motives.grievances.keeper.at(-1).item).toBeUndefined();
    expect(validateWorld(s)).toBe(s);
  });

  it("repairs the recipient's grievance with a gift that returns what was taken", () => {
    let s = together(fresh());
    const g = threatened(s);
    s = act(s, "give", { item: "cloth", target: "keeper" });
    expect(repairs(s).map((f) => f.source.answers)).toEqual([
      { recipient: "keeper", incident: g.incident },
    ]);
    expect(s.motives.grievances.keeper[0]).toMatchObject({
      weight: 1,
      repaired: true,
    });
    expect(resentment(s, "keeper", "vale")).toBe(0);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("treats an unrelated gift as an ordinary gift: no repair", () => {
    let s = together(fresh());
    threatened(s);
    s = act(s, "give", { item: "oil", target: "keeper" });
    expect(s.log.findLast((e) => e.verb === "give").accepted).toBe(true);
    expect(repairs(s)).toEqual([]);
    expect(s.motives.grievances.keeper[0].repaired).toBe(false);
    expect(resentment(s, "keeper", "vale")).toBe(1);
  });

  for (const how of ["witnessed", "heard"])
    it(`repairs with the recipient's current want; one who ${how} it keeps theirs`, () => {
      let s = together(fresh());
      s.items.bell.holder = "vale";
      s = act(s, "ring", { item: "bell" });
      const [g] = s.motives.grievances.keeper;
      expect(g.incident).toBe(
        `event:${s.log.findLast((e) => e.verb === "ring").seq}`,
      );
      // Pip took the same offence; it watches the gift or hears of it later.
      s.motives.grievances.moth.push({ ...g });
      if (how === "heard") s.actors.moth.place = "pond";
      // The keeper wants the bell, so the gift answers the incident.
      expect(s.actors.keeper.want).toMatchObject({
        kind: "item",
        target: "bell",
      });
      s = act(s, "give", { item: "bell", target: "keeper" });
      expect(s.actors.keeper.trust.vale).toBe(1);
      const [repair] = repairs(s);
      expect(repair.source).toMatchObject({
        actorId: "vale",
        answers: { recipient: "keeper", incident: g.incident },
      });
      expect(s.motives.grievances.keeper).toMatchObject([
        { weight: 1, repaired: true },
      ]);
      expect(resentment(s, "keeper", "vale")).toBe(0);
      expect(decodeSave(encodeSave(s))).toEqual(s);
      // The keeper tells Pip; hearing the repair closes nothing of Pip's.
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
      expect(s.knowledge.known.moth[repair.id].kind).toBe(how);
      expect(s.motives.grievances.moth[0].repaired).toBe(false);
      expect(resentment(s, "moth", "vale")).toBe(1);
      // Pip's goes dormant on the ordinary clock.
      const touched = s.motives.grievances.moth[0].lastTouched;
      s.turn = s.revision = touched + GRIEVANCE_DORMANT_TURNS - 1;
      expect(resentment(s, "moth", "vale")).toBe(1);
      s.turn = s.revision = touched + GRIEVANCE_DORMANT_TURNS;
      expect(resentment(s, "moth", "vale")).toBe(0);
      expect(s.motives.grievances.moth[0]).toMatchObject({
        weight: 1,
        repaired: false,
      });
    });

  it("forgets an older item when a repeat incident takes nothing", () => {
    let s = together(fresh());
    threatened(s);
    // An attack that drops nothing names no item.
    s.eventSeq += 1;
    slight(s, { kind: "attack", actor: "vale", target: "keeper" }, ["keeper"]);
    expect(s.motives.grievances.keeper[0]).toMatchObject({ weight: 2 });
    expect(s.motives.grievances.keeper[0].item).toBeUndefined();
    s = act(s, "give", { item: "cloth", target: "keeper" });
    expect(s.log.findLast((e) => e.verb === "give").accepted).toBe(true);
    expect(repairs(s)).toEqual([]);
    expect(s.motives.grievances.keeper[0].repaired).toBe(false);
  });

  it("files a guard's dropped item as the guard's loss, not the target's", () => {
    const s = together(fresh());
    s.eventSeq += 1;
    recordReaction(
      s,
      { kind: "attack", actor: "vale", target: "keeper" },
      ["keeper", "moth"],
      false,
      {
        seq: s.eventSeq,
        targetId: "moth",
        coveredId: "keeper",
        droppedItemIds: ["oil"],
      },
    );
    expect(s.motives.grievances.keeper[0].kind).toBe("threat");
    expect(s.motives.grievances.keeper[0].item).toBeUndefined();
    expect(s.motives.grievances.moth[0]).toMatchObject({
      other: "vale",
      kind: "threat",
      item: "oil",
    });
    expect(validateWorld(s)).toBe(s);
  });

  // An aggrieved Pip with no item on the grievance: only a want answers it.
  const pestered = (s) => {
    s.eventSeq += 1;
    s.motives.grievances.moth.push({
      other: "vale",
      kind: "pestering",
      reason: "Vale kept asking.",
      turn: s.turn,
      weight: 1,
      incident: `event:${s.eventSeq}`,
      lastTouched: s.turn,
      repaired: false,
    });
  };
  for (const lit of [false, true])
    it(`answers a lit-lamp want only with the lamp ${lit ? "lit" : "dark"}: ${lit ? "repair" : "none"}`, () => {
      let s = together(fresh());
      expect(s.actors.moth.want).toMatchObject({ target: "lamp", lit: true });
      s.items.lamp.holder = "vale";
      s.items.lamp.lit = lit;
      s.items.lamp.fuelRooms = lit ? 3 : 0;
      s.items.lamp.fuel = lit ? 12 : 0;
      pestered(s);
      s = act(s, "give", { item: "lamp", target: "moth" });
      expect(s.log.findLast((e) => e.verb === "give").accepted).toBe(true);
      expect(repairs(s).length).toBe(lit ? 1 : 0);
      expect(s.motives.grievances.moth[0].repaired).toBe(lit);
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
