import { describe, it, expect } from "vitest";
import {
  createWorld,
  play,
  legalActions,
  plan,
  encodeSave,
  decodeSave,
  validateWorld,
  willingToGive,
  places,
  things,
  handStatus,
} from "../v2/card-game/world.mjs";
import {
  enableMotives,
  recordReaction,
  valueOf,
} from "../v2/card-game/motives.mjs";
import {
  programFor,
  generateProgram,
  targetsFor,
} from "../v2/card-game/quests.mjs";
import {
  lifeOf,
  keepReason,
  recordLifeAction,
  hopes,
  stayingWith,
  finishPersonalQuest,
  hopeProgress,
} from "../v2/card-game/life.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { cardPlay } from "../v2/card-game/cards.mjs";

const fresh = () =>
  enableMotives(createWorld({ opening: true }), { personalQuests: true });
function act(s, kind, fields = {}) {
  const a = legalActions(s).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(a, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const result = play(s, a);
  expect(result.ok).toBe(true);
  expect(play(decodeSave(encodeSave(s)), a)).toEqual(result);
  return result.state;
}
function together() {
  const s = enableMotives(createWorld(), { personalQuests: true });
  for (const id of ["vale", "moth", "keeper"]) {
    s.actors[id].place = "station";
    lifeOf(s, id).phase = "seeking";
  }
  return s;
}

describe("personal quests grow from life", () => {
  it("uses shared light and sound in place while gifts keep their owners", () => {
    let s = together();
    s.items.lamp.holder = "moth";
    s.items.oil.holder = "moth";
    s.items.bell.holder = "keeper";
    lifeOf(s, "moth").attachments.lamp = { from: "vale", turn: 0 };
    lifeOf(s, "moth").attachments.oil = { from: "vale", turn: 0 };
    for (const id of ["moth", "keeper"]) lifeOf(s, id).company.vale = 3;
    expect(cardPlay(s, ["lamp"]).action.kind).toBe("ask");
    expect(cardPlay(s, ["lamp", "station"]).action.kind).toBe("light");
    expect(cardPlay(s, ["bell", "station"]).action.kind).toBe("ring");
    expect(cardPlay(s, ["oil", "lamp"]).action.kind).toBe("refill");
    s = act(s, "light", { item: "lamp" });
    s = act(s, "refill", { item: "oil", target: "lamp" });
    s = act(s, "ring", { item: "bell" });
    expect(s.items.lamp.holder).toBe("moth");
    expect(s.items.oil.holder).toBe("moth");
    expect(s.items.bell.holder).toBe("keeper");
    expect(keepReason(s, "moth", "lamp")).toContain("gift from Vale");
    s.actors.moth.place = "pond";
    expect(legalActions(s).some((a) => a.kind === "refill")).toBe(false);
    recordReaction(
      s,
      { kind: "threaten", actor: "vale", target: "keeper" },
      ["keeper"],
      false,
    );
    expect(legalActions(s).some((a) => a.kind === "ring")).toBe(false);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("finishes the shore journey while Pip keeps Vale's gifted lamp", () => {
    let s = fresh();
    s = act(s, "light", { item: "lamp" });
    s = act(s, "move", { target: "pond" });
    s = act(s, "give", { item: "lamp", target: "moth" });
    lifeOf(s, "vale").phase = "active";
    expect(handStatus(s, "vale").items).toContainEqual({
      id: "lamp",
      met: true,
      sharedBy: "moth",
    });
    s = act(s, "talk", { target: "moth" });
    expect(s.actors.vale.progress.step).toBe(1);
    s = act(s, "accompany", { target: "moth", destination: "station" });
    expect(s.actors.vale.progress.program).toBe(2);
    expect(s.items.lamp.holder).toBe("moth");
    expect(keepReason(s, "moth", "lamp")).toContain("gift from Vale");
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("shares only nearby friendly items and keeps delivery ownership explicit", () => {
    const s = together();
    s.items.lamp.holder = "moth";
    const target = { items: ["lamp"], avatars: ["moth"], location: "station" };
    expect(handStatus(s, "vale", target).met).toBe(true);
    expect(
      handStatus(s, "vale", {
        ...target,
        conditions: [{ kind: "heldBy", item: "lamp", avatar: "keeper" }],
      }).met,
    ).toBe(false);
    s.actors.moth.place = "pond";
    expect(handStatus(s, "vale", target).met).toBe(false);
    s.actors.moth.place = "station";
    recordReaction(
      s,
      { kind: "threaten", actor: "vale", target: "moth" },
      ["moth"],
      false,
    );
    expect(handStatus(s, "vale", target).met).toBe(false);
  });

  it("shows hope earned through gifts and warmth before a later quest", () => {
    let s = fresh();
    s = act(s, "light", { item: "lamp" });
    s = act(s, "move", { target: "pond" });
    s = act(s, "give", { item: "lamp", target: "moth" });
    expect(hopeProgress(s, "vale")).toMatchObject({
      done: 1,
      next: "Gather in warm light",
    });
    expect(
      s.log.some((e) => e.text.includes("hope milestone: Return a kindness")),
    ).toBe(true);
    s = act(s, "talk", { target: "moth" });
    expect(hopeProgress(s, "vale")).toMatchObject({
      done: 2,
      next: "Care for the shore",
    });
    expect(hopeProgress(s, "moth").done).toBeGreaterThanOrEqual(1);
    const restored = decodeSave(encodeSave(s));
    expect(restored.life).toEqual(s.life);
    s = act(restored, "talk", { target: "moth" });
    expect(hopeProgress(s, "vale").done).toBe(2);
  });
  it("keeps the first light, then hides the next checklist through three quiet turns", () => {
    let s = fresh();
    expect(programFor(s, "vale").id).toBe("first-light");
    s = act(s, "light", { item: "lamp" });
    expect(s.actors.vale.progress.program).toBe(1);
    expect(programFor(s, "vale")).toBeNull();
    expect(targetsFor(s, "vale")).toEqual([]);
    for (let i = 0; i < 3; i++) {
      s = act(s, "wait");
      expect(lifeOf(s, "vale").phase).toBe("content");
    }
    s = act(s, "wait");
    expect(lifeOf(s, "vale")).toMatchObject({
      phase: "seeking",
      inspiration: 0,
    });
    expect(s.actors.vale.progress.program).toBe(1);
  });

  it("unlocks a personal quest through talk, a useful gift and a shared trip", () => {
    let s = together();
    s.items.lamp.holder = "vale";
    s = act(s, "talk", { target: "moth" });
    expect(lifeOf(s, "vale").inspiration).toBeGreaterThanOrEqual(1);
    s = act(s, "give", { item: "lamp", target: "moth" });
    expect(keepReason(s, "moth", "lamp")).toContain("gift from Vale");
    s = act(s, "accompany", { target: "moth", destination: "pond" });
    // A useful gift and the return conversation can also add a second point.
    if (!programFor(s, "vale")) s = act(s, "talk", { target: "moth" });
    for (let i = 0; i < 8 && !programFor(s, "vale"); i++)
      s = act(s, "talk", { target: "moth" });
    expect(lifeOf(s, "vale")).toMatchObject({
      phase: "active",
      inspiration: 0,
    });
    expect(programFor(s, "vale")).toBeTruthy();
    expect(s.log.some((e) => e.actorId === "vale" && e.questPlan)).toBe(true);
  });

  it("counts trades for both parties, with a per-round cap and a repeat window", () => {
    const s = together();
    s.turn = s.revision = 1;
    const trade = {
      actor: "vale",
      target: "keeper",
      kind: "trade",
      item: "bell",
      receive: "oil",
    };
    recordLifeAction(s, trade, true);
    recordLifeAction(s, trade, true);
    expect(lifeOf(s, "vale").inspiration).toBe(1);
    expect(lifeOf(s, "keeper").inspiration).toBe(1);
    recordLifeAction(s, { ...trade, kind: "talk" }, true);
    recordLifeAction(
      s,
      { ...trade, kind: "accompany", destination: "pond" },
      true,
    );
    expect(lifeOf(s, "vale").inspiration).toBe(2);
    s.turn = s.revision = 2;
    recordLifeAction(s, trade, true);
    expect(lifeOf(s, "vale").inspiration).toBe(2);
    s.turn = s.revision = 7;
    recordLifeAction(s, trade, true);
    expect(lifeOf(s, "vale").inspiration).toBe(3);
  });

  it("keeps the bell-for-oil bargain useful despite the keeper's attachment", () => {
    let s = together();
    s.items.bell.holder = "vale";
    s = act(s, "trade", { item: "bell", receive: "oil" });
    expect(s.items.oil.holder).toBe("vale");
    expect(s.items.bell.holder).toBe("keeper");
    expect(lifeOf(s, "vale").inspiration).toBeGreaterThan(0);
  });

  it("saves a quiet gap after the authored quests and generates a quest at unlock time", () => {
    let s = together();
    s.turn = s.revision = 10;
    s.actors.vale.progress = { program: 1, step: 1, marks: [1, 2, 3, 4] };
    lifeOf(s, "vale").phase = "active";
    s.items.lamp.holder = s.items.bell.holder = "vale";
    s = act(s, "wait");
    expect(s.actors.vale.progress.program).toBe(2);
    expect(s.actors.vale.progress.current).toBeUndefined();
    expect(s.actors.vale.progress.completedHands).toBe(5);
    expect(programFor(s, "vale")).toBeNull();
    expect(decodeSave(encodeSave(s))).toEqual(s);
    for (let i = 0; i < 3; i++) s = act(s, "wait");
    s = act(s, "talk", { target: "moth" });
    for (let i = 0; i < 16 && !programFor(s, "vale"); i++) {
      s = act(s, "talk", { target: "moth" });
    }
    expect(programFor(s, "vale")?.generated.turn).toBe(s.turn);
    expect(s.actors.vale.progress.step).toBe(0);
    expect(programFor(s, "vale").purpose).toContain(hopes.vale.title);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("keeps failed requests, unused gifts and invalid plays out of Inspiration", () => {
    const s = together();
    for (const a of [
      { kind: "ask", actor: "vale", target: "keeper", item: "oil" },
      {
        kind: "accompany",
        actor: "vale",
        target: "keeper",
        destination: "pond",
      },
      { kind: "give", actor: "vale", target: "moth", item: "bell" },
      { kind: "wait", actor: "vale" },
    ])
      recordLifeAction(s, a, false);
    expect(lifeOf(s, "vale").inspiration).toBe(0);
    const before = encodeSave(s);
    expect(play(s, { key: "missing" }).ok).toBe(false);
    expect(encodeSave(s)).toBe(before);
  });

  it("keeps gifts and favourite items through quiet periods and reloads", () => {
    let s = together();
    s.items.lamp.holder = "vale";
    s = act(s, "give", { item: "lamp", target: "moth" });
    expect(s.items.lamp.holder).toBe("moth");
    expect(willingToGive(s, "moth", "lamp", "vale")).toBe(false);
    expect(valueOf(s, "moth", "lamp")).toBeGreaterThan(12);
    for (let i = 0; i < 3; i++) s = act(s, "wait");
    expect(s.items.lamp.holder).toBe("moth");
    expect(keepReason(decodeSave(encodeSave(s)), "moth", "lamp")).toContain(
      "gift from Vale",
    );
  });

  it("spends time together after a gift and allows space after a threat", () => {
    let s = together();
    s.items.lamp.holder = "vale";
    s = act(s, "give", { item: "lamp", target: "moth" });
    expect(s.actors.moth.place).toBe("station");
    expect(stayingWith(s, "moth")).toBe("vale");
    expect(plan(s, "moth").action.kind).not.toBe("move");
    recordReaction(
      s,
      { kind: "threaten", actor: "vale", target: "moth" },
      ["moth"],
      false,
    );
    expect(stayingWith(s, "moth")).toBeNull();
    expect(plan(s, "moth").action.kind).toBe("move");
  });

  it("keeps a shared arrival together on the following turn", () => {
    let s = together();
    s.items.lamp.holder = "vale";
    s = act(s, "accompany", { target: "moth", destination: "pond" });
    expect(s.actors.moth.place).toBe("pond");
    expect(stayingWith(s, "moth")).toBe("vale");
    s = act(s, "wait");
    expect(s.actors.moth.place).toBe(s.actors.vale.place);
  });

  it("uses the next long-term milestone to choose among feasible quests", () => {
    const s = together();
    s.items.lamp.holder = "vale";
    s.items.lamp.lit = true;
    // Pip can use the lamp. The gathering and this delivery are both possible.
    lifeOf(s, "vale").phase = "active";
    let p = generateProgram(s, "vale", places, things);
    expect(p.generated.situation).toBe("delivery");
    expect(p.purpose).toContain(hopes.vale.title);
    s.turn = s.revision = 1;
    finishPersonalQuest(s, "vale", p);
    expect(lifeOf(s, "vale").milestones).toEqual([1]);
    lifeOf(s, "vale").phase = "active";
    p = generateProgram(s, "vale", places, things);
    expect(p.generated.situation).toBe("gathering");
  });

  it("shapes later quests around a shared lamp while Pip keeps the gift", () => {
    const s = together();
    s.turn = s.revision = 3;
    s.items.lamp.holder = "moth";
    s.items.lamp.lit = true;
    lifeOf(s, "moth").attachments.lamp = { from: "vale", turn: 1 };
    lifeOf(s, "vale").milestones = [1, 2];
    lifeOf(s, "vale").phase = "active";
    const next = generateProgram(s, "vale", places, things);
    expect(next.generated.situation).toBe("crossing");
    expect(next.steps.some((step) => step.items?.includes("lamp"))).toBe(true);
    for (let i = 0; i < 12; i += 1) {
      s.actors.moth.progress.program = i;
      const p = generateProgram(s, "moth", places, things);
      const conditions = p.steps.flatMap((step) =>
        (step.any || [step]).flatMap((h) => h.conditions || []),
      );
      expect(
        conditions.some((c) => c.kind === "heldBy" && c.item === "lamp"),
      ).toBe(false);
    }
    expect(s.items.lamp.holder).toBe("moth");
  });

  it("retains old progress, possessions and memories when enabled on an earlier save", () => {
    let old = enableMotives(createWorld({ opening: true }), {
      questPrograms: true,
    });
    old = act(old, "light");
    const before = structuredClone(old);
    const s = enableMotives(decodeSave(encodeSave(old)), {
      personalQuests: true,
    });
    expect(s.actors).toEqual(before.actors);
    expect(s.items).toEqual(before.items);
    expect(s.memories).toEqual(before.memories);
    expect(programFor(s, "vale").id).toBe(programFor(before, "vale").id);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("earns the keeper's quiet milestone only through the quiet outcome", () => {
    const s = together();
    s.turn = s.revision = 1;
    const program = { generated: { situation: "answer" } };
    finishPersonalQuest(s, "keeper", program, { consequence: { kind: "oil" } });
    expect(lifeOf(s, "keeper").milestones).toEqual([]);
    finishPersonalQuest(s, "keeper", program, {
      consequence: { kind: "hush" },
    });
    expect(lifeOf(s, "keeper").milestones).toEqual([1]);
  });

  it("chooses the quiet branch when both pond answers are available", () => {
    const s = together();
    s.items.bell.holder = "keeper";
    s.items.oil.doses = 0;
    s.items.cloth.holder = "station";
    const program = generateProgram(s, "keeper", places, things);
    expect(program.generated.situation).toBe("answer");
    expect(program.steps.at(-1).any.map((h) => h.consequence.kind)).toEqual([
      "hush",
    ]);
  });

  it("supplies hopes and attachments to the story without exposing unmet cast", () => {
    const s = fresh();
    expect(JSON.stringify(narrativeContext(s))).not.toMatch(/Pip|keeper|moth/);
    const local = together();
    const facts = narrativeContext(local)
      .entities.find((e) => e.id === "moth")
      .facts.join(" ");
    expect(facts).toContain(hopes.moth.title);
  });

  it("rejects damaged personal state", () => {
    for (const mutate of [
      (s) => (s.life = null),
      (s) => (lifeOf(s, "vale").inspiration = 99),
      (s) => (lifeOf(s, "vale").phase = "missing"),
      (s) => (lifeOf(s, "vale").milestones = [3, 1]),
      (s) =>
        (lifeOf(s, "vale").attachments = {
          missing: { from: "moth", turn: 0 },
        }),
      (s) => (lifeOf(s, "moth").company.vale = 99),
      (s) => (lifeOf(s, "keeper").experiences = Array(17).fill({})),
    ]) {
      const s = fresh();
      mutate(s);
      expect(() => validateWorld(s)).toThrow();
    }
  });

  it("keeps mixed play deterministic and saved personal state bounded", () => {
    let s = fresh(),
      seed = 1729;
    for (let i = 0; i < 160; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const actions = legalActions(s),
        action = actions[seed % actions.length];
      const result = play(s, action);
      expect(result.ok).toBe(true);
      if (i % 10 === 0)
        expect(play(decodeSave(encodeSave(s)), action)).toEqual(result);
      s = result.state;
      for (const life of Object.values(s.life.actors)) {
        expect(life.experiences.length).toBeLessThanOrEqual(16);
        expect(life.inspiration).toBeLessThanOrEqual(5);
      }
    }
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
});
