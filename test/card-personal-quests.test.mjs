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
  sanctuaries,
  things,
  handStatus,
} from "../v2/card-game/world.mjs";
import {
  enableMotives,
  recordReaction,
  valueOf,
  interest,
} from "../v2/card-game/motives.mjs";
import {
  programFor,
  generateProgram,
  targetsFor,
  actorQuests,
  pursueQuest,
} from "../v2/card-game/quests.mjs";
import {
  lifeOf,
  keepReason,
  recordLifeAction,
  hopeOf,
  stayingWith,
  finishPersonalQuest,
  enablePersonalQuests,
  settleLife,
  sparkOf,
  lifeLine,
  lifeFacts,
  personalQuestRank,
  validLife,
  REST_TURNS,
  STALL_TURNS,
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
const noNumbers = (text) => expect(text).not.toMatch(/\d/);

describe("personal quests grow from life", () => {
  it("records a shared bell quest before its sound changes the owner's mood", () => {
    let s = createWorld();
    s.schema = 2;
    s.turn = s.revision = 20;
    s.actors.vale.progress = { program: 2, step: 0, marks: [1, 2, 3, 4, 5] };
    s = enableMotives(decodeSave(JSON.stringify(s)), { personalQuests: true });
    for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
    s.items.bell.holder = "keeper";
    s.items.lamp.fuel = 0;
    s.items.oil.doses = 0;
    lifeOf(s, "vale").milestones = [1, 2];
    lifeOf(s, "keeper").company.vale = 23;
    s.actors.vale.progress.current = generateProgram(s, "vale", places, things);
    expect(programFor(s, "vale").generated.situation).toBe("answer");
    s = act(s, "wait");
    s = act(s, "accompany", { target: "keeper", destination: "pond" });
    s = act(s, "ring", { item: "bell" });
    expect(s.actors.vale.progress.program).toBe(3);
    expect(lifeOf(s, "vale").milestones).toHaveLength(3);
    expect(s.items.bell.holder).toBe("keeper");
    expect(s.items.oil.doses).toBe(3);
  });
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
    // A player can take up a collected purpose after finishing the first.
    const shore = actorQuests(s, "vale").find(
      (q) => q.program.id === "along-the-shore",
    );
    expect(pursueQuest(s, "vale", shore.key)).toBe(true);
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
  it("reaches hope steps through gifts and warmth before a later quest", () => {
    let s = fresh();
    s = act(s, "light", { item: "lamp" });
    s = act(s, "move", { target: "pond" });
    const steps = hopeOf(s, "vale").milestones;
    expect(steps.slice(0, 2).map((m) => m.kinds)).toEqual([
      ["delivery"],
      ["gathering"],
    ]);
    s = act(s, "give", { item: "lamp", target: "moth" });
    expect(lifeOf(s, "vale").milestones).toEqual([s.turn]);
    expect(
      s.log.some((e) => e.text.includes(`hope milestone: ${steps[0].title}`)),
    ).toBe(true);
    s = act(s, "talk", { target: "moth" });
    expect(lifeOf(s, "vale").milestones).toHaveLength(2);
    const restored = decodeSave(encodeSave(s));
    expect(restored.life).toEqual(s.life);
    s = act(restored, "talk", { target: "moth" });
    expect(lifeOf(s, "vale").milestones).toHaveLength(2);
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
  it("keeps the first light, then rests before the next purpose", () => {
    let s = fresh();
    expect(programFor(s, "vale").id).toBe("first-light");
    s = act(s, "light", { item: "lamp" });
    expect(s.actors.vale.progress.program).toBe(1);
    expect(programFor(s, "vale")).toBeNull();
    expect(targetsFor(s, "vale")).toEqual([]);
    expect(lifeLine(s, "vale")).toEqual({
      caption: "Resting",
      detail: "Resting. Enjoying what the last quest made.",
    });
    // The attic is a sanctuary, so rest starts at once.
    for (let i = 1; i < REST_TURNS; i++) {
      s = act(s, "wait");
      expect(lifeOf(s, "vale").phase).toBe("content");
    }
    s = act(s, "wait");
    expect(lifeOf(s, "vale").phase).toBe("seeking");
    expect(lifeOf(s, "vale")).not.toHaveProperty("inspiration");
    expect(lifeLine(s, "vale").caption).toBe("Restless");
    expect(s.actors.vale.progress.program).toBe(1);
  });

  it("collects an experience-shaped purpose for the player to choose", () => {
    let s = together();
    s = act(s, "talk", { target: "moth" });
    expect(lifeOf(s, "vale").phase).toBe("seeking");
    const quest = actorQuests(s, "vale").find((q) => q.origin?.kind === "talk");
    expect(quest.status).toBe("pending");
    s = act(s, "pursue", { questKey: quest.key });
    expect(
      actorQuests(s, "vale").find((q) => q.key === quest.key).origin.kind,
    ).toBe("talk");
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("remembers experiences during rest and acts on them when rest ends", () => {
    let s = together();
    s.turn = s.revision = 5;
    for (const id of ["vale", "moth", "keeper"]) {
      lifeOf(s, id).phase = "content";
      lifeOf(s, id).finished = 4;
      lifeOf(s, id).restLeft = 2;
    }
    s.items.lamp.holder = "vale";
    s = act(s, "give", { item: "lamp", target: "moth" });
    expect(lifeOf(s, "moth").phase).toBe("content");
    expect(sparkOf(s, "moth").kind).toBe("gift");
    expect(lifeLine(s, "moth")).toEqual({
      caption: "Resting",
      detail: "Resting. Thinking about Vale's gift.",
    });
    expect(lifeLine(s, "vale").detail).toBe(
      "Resting. Thinking about helping Pip.",
    );
    expect(lifeFacts(s, "moth")).toContain(
      "I'm resting after my last quest. I keep thinking about Vale's gift.",
    );
    while (lifeOf(s, "moth").phase === "content") s = act(s, "wait");
    expect(lifeOf(s, "moth").phase).toBe("active");
    expect(lifeOf(s, "moth").origin).toMatchObject({
      kind: "gift",
      other: "vale",
    });
    expect(programFor(s, "moth")).toBeTruthy();
  });

  it("rests only in a sanctuary and walks there after a quest elsewhere", () => {
    let s = together();
    s.actors.vale.place = s.actors.moth.place = "pond";
    s.items.lamp.holder = "vale";
    s.turn = s.revision = 3;
    lifeOf(s, "moth").phase = "active";
    finishPersonalQuest(
      s,
      "moth",
      { generated: { situation: "delivery" } },
      sanctuaries,
    );
    expect(places.pond.sanctuary).toBeUndefined();
    expect(sanctuaries).toEqual(["station", "attic"]);
    expect(lifeOf(s, "moth")).toMatchObject({
      phase: "returning",
      restAt: "station",
    });
    expect(lifeFacts(s, "moth")).toContain(
      "I want to go to Empty station and rest.",
    );
    expect(interest(s, "moth")).toMatchObject({ location: "station" });
    s = act(s, "accompany", { target: "moth", destination: "station" });
    expect(s.actors.moth.place).toBe("station");
    s = act(s, "wait");
    expect(lifeOf(s, "moth").phase).toBe("content");
    expect(lifeLine(s, "moth").detail).toBe(
      "Resting. Thinking about the walk to Empty station with Vale.",
    );
    s.actors.moth.place = "pond";
    s.actors.keeper.place = "attic";
    s = act(s, "wait");
    expect(lifeOf(s, "moth").phase).toBe("returning");
  });

  it("keeps card lines third person and in agreement with their state", () => {
    const s = together();
    s.actors.keeper.place = "pond";
    s.items.lamp.holder = "vale";
    const firstPerson = /\b(I|I'm|I've|me|my|we|our|us)\b/;
    const seen = [];
    const check = (id) => {
      const line = lifeLine(s, id);
      seen.push(line.detail);
      for (const text of [line.caption, line.detail, interest(s, id).text]) {
        expect(text).not.toMatch(firstPerson);
        noNumbers(text);
      }
      // "Restless" belongs to the restless state only.
      if (line.caption === "Resting") expect(line.detail).toMatch(/^Resting\./);
      if (line.caption !== "Restless")
        expect(line.detail).not.toMatch(/Restless/);
    };
    for (const id of ["vale", "moth", "keeper"]) check(id);
    s.turn = s.revision = 1;
    finishPersonalQuest(s, "keeper", {}, sanctuaries);
    check("keeper");
    s.actors.keeper.place = "station";
    finishPersonalQuest(s, "keeper", {}, sanctuaries);
    check("keeper");
    finishPersonalQuest(s, "moth", {}, sanctuaries);
    s.turn = s.revision = 2;
    recordLifeAction(
      s,
      { kind: "give", actor: "vale", target: "moth", item: "lamp" },
      true,
      true,
    );
    check("moth");
    lifeOf(s, "moth").phase = "seeking";
    check("moth");
    expect(seen).toEqual([
      "Looking for something worth doing.",
      "Looking for something worth doing.",
      "Looking for something worth doing.",
      "Wants to rest at Empty station.",
      "Resting. Enjoying what the last quest made.",
      "Resting. Thinking about Vale's gift.",
      "Restless since Vale's gift.",
    ]);
  });

  it("keeps pacing out of sight and gives a quiet avatar a purpose in time", () => {
    let s = together();
    s.actors.vale.place = "attic";
    s.actors.keeper.place = "pond";
    for (const id of ["vale", "moth", "keeper"]) {
      noNumbers(Object.values(lifeLine(s, id)).join(" "));
      noNumbers(lifeFacts(s, id).join(" "));
    }
    for (
      let i = 0;
      i <= STALL_TURNS + 1 && lifeOf(s, "keeper").phase !== "active";
      i++
    )
      s = act(s, "wait");
    expect(lifeOf(s, "keeper").phase).toBe("active");
    expect(programFor(s, "keeper")).toBeTruthy();
  });

  it("records a repeated exchange once and counts trades for both parties", () => {
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
    s.turn = s.revision = 2;
    recordLifeAction(s, trade, true);
    for (const id of ["vale", "keeper"])
      expect(lifeOf(s, id).experiences).toEqual([
        {
          kind: "trade",
          turn: 2,
          other: id === "vale" ? "keeper" : "vale",
          item: "bell",
          place: "station",
        },
      ]);
  });

  it("keeps the bell-for-oil bargain useful despite the keeper's attachment", () => {
    let s = together();
    s.items.bell.holder = "vale";
    s = act(s, "trade", { item: "bell", receive: "oil" });
    expect(s.items.oil.holder).toBe("vale");
    expect(s.items.bell.holder).toBe("keeper");
    expect(actorQuests(s, "vale").some((q) => q.origin?.kind === "trade")).toBe(
      true,
    );
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
    // Rest holds even while the cast talks to Vale; what it shares is
    // remembered, and the strongest such experience seeds the next purpose.
    for (let i = 0; i < REST_TURNS - 1; i++) {
      s = act(s, "wait");
      expect(programFor(s, "vale")).toBeNull();
    }
    const spark = sparkOf(s, "vale");
    s = spark ? act(s, "wait") : act(s, "talk", { target: "moth" });
    const quest = actorQuests(s, "vale").find(
      (q) => q.status === "pending" && q.program.generated,
    );
    expect(quest).toBeTruthy();
    expect(quest.program.generated.turn).toBeLessThanOrEqual(s.turn);
    expect(quest.program.purpose).toContain(hopeOf(s, "vale").title);
    expect(programFor(s, "vale")).toBeNull();
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("keeps failed requests, unused gifts and invalid plays out of experience", () => {
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
    expect(lifeOf(s, "vale").experiences).toEqual([]);
    expect(settleLife(s, ["vale"])).toEqual([]);
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
    expect(lifeFacts(s, "moth")).toContain(
      "Vale gave me this Lamp. I'm keeping it.",
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
    lifeOf(s, "vale").phase = "active";
    let p = generateProgram(s, "vale", places, things);
    expect(hopeOf(s, "vale").milestones[0].kinds).toContain(
      p.generated.situation,
    );
    expect(p.purpose).toContain(hopeOf(s, "vale").title);
    s.turn = s.revision = 1;
    finishPersonalQuest(s, "vale", p);
    expect(lifeOf(s, "vale").milestones).toEqual([1]);
    lifeOf(s, "vale").phase = "active";
    p = generateProgram(s, "vale", places, things);
    expect(hopeOf(s, "vale").milestones[1].kinds).toContain(
      p.generated.situation,
    );
  });

  it("counts a milestone by the kind of quest, not by a named item or effect", () => {
    const s = together();
    s.turn = s.revision = 1;
    const want = hopeOf(s, "keeper").milestones[0].kinds[0];
    finishPersonalQuest(s, "keeper", { generated: { situation: "bargain" } });
    expect(lifeOf(s, "keeper").milestones).toEqual([]);
    s.turn = s.revision = 2;
    finishPersonalQuest(s, "keeper", { generated: { situation: want } });
    expect(lifeOf(s, "keeper").milestones).toEqual([2]);
  });

  it("derives hopes from profile data rather than per-character text", () => {
    const s = together();
    const hope = (id) => lifeOf(s, id).hope;
    expect(hope("moth")).toMatchObject({ place: "pond", item: "lamp" });
    expect(hope("keeper")).toMatchObject({ place: "station", item: "bell" });
    expect(lifeOf(s, "badger")).toBeUndefined();
    const titles = ["vale", "moth", "keeper"].map((id) => hopeOf(s, id).title);
    expect(new Set(titles).size).toBe(3);
    for (const id of ["vale", "moth", "keeper"])
      for (const fact of lifeFacts(s, id)) {
        expect(fact).toMatch(/^(I|I'm|I've|Next I'd|The .+ is my|.+ gave me)/);
        expect(fact).not.toMatch(/hope:|milestone:|Inspiration/i);
      }
  });

  it("gives hopes and purposes to avatars in a world with other entities", () => {
    const s = {
      turn: 0,
      actors: {
        ana: { place: "yard", progress: { program: 1 } },
        bo: { place: "lane", progress: { program: 1 } },
        cat: { place: "yard", progress: { program: 0 } },
      },
      items: { cup: { holder: "bo" }, paperbird: { holder: "ana" } },
      motives: { questPrograms: true },
    };
    enablePersonalQuests(s, (id) =>
      id === "cat"
        ? { quests: false }
        : id === "ana"
          ? { home: "yard", values: { cup: 2, paperbird: 6 } }
          : null,
    );
    expect(Object.keys(s.life.actors)).toEqual(["ana", "bo"]);
    expect(lifeOf(s, "ana").hope).toMatchObject({
      place: "yard",
      item: "paperbird",
    });
    expect(lifeOf(s, "bo").hope).toMatchObject({ place: "lane", item: null });
    expect(hopeOf(s, "bo").title).toContain("Lane");
    expect(keepReason(s, "ana", "paperbird")).toBe("Ana's favourite.");
    expect(lifeFacts(s, "ana")).toContain(
      "The Paperbird is my favourite. I keep it close.",
    );
    const sanctuaries = ["yard"];
    s.turn = 1;
    for (const id of ["ana", "bo"])
      finishPersonalQuest(
        s,
        id,
        { generated: { situation: "bargain" } },
        sanctuaries,
      );
    expect(lifeOf(s, "ana").phase).toBe("content");
    expect(lifeOf(s, "bo")).toMatchObject({
      phase: "returning",
      restAt: "yard",
    });
    expect(lifeLine(s, "bo")).toEqual({
      caption: "Heading to rest",
      detail: "Wants to rest at Yard.",
    });
    expect(lifeFacts(s, "bo")).toContain("I want to go to Yard and rest.");
    expect(validLife(s)).toBe(true);
    s.turn = 2;
    s.actors.bo.place = "yard";
    recordLifeAction(s, { kind: "talk", actor: "ana", target: "bo" }, true);
    expect(settleLife(s, undefined, sanctuaries)).toEqual([]);
    expect(lifeLine(s, "bo")).toEqual({
      caption: "Resting",
      detail: "Resting. Thinking about talking with Ana.",
    });
    expect(validLife(s)).toBe(true);
    let ready = [];
    for (let i = 0; i < REST_TURNS + 1 && !ready.length; i++) {
      s.turn += 1;
      ready = settleLife(s, undefined, sanctuaries);
    }
    expect(ready).toEqual(["ana", "bo"]);
    expect(lifeOf(s, "ana").origin).toMatchObject({
      kind: "talk",
      other: "bo",
    });
    const gathering = { generated: { situation: "gathering" } };
    const bargain = { generated: { situation: "bargain" } };
    expect(personalQuestRank(s, "bo", gathering)).toBeLessThan(
      personalQuestRank(s, "bo", bargain),
    );
    expect(validLife(s)).toBe(true);
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

  it("migrates saved Inspiration scores to remembered experiences", () => {
    const s = together();
    s.turn = s.revision = 10;
    const json = JSON.parse(encodeSave(s));
    const v1 = (phase, inspiration, restUntil, experiences) => ({
      phase,
      inspiration,
      restUntil,
      experiences,
      attachments: {},
      company: {},
      milestones: [],
    });
    json.life = {
      version: 1,
      actors: {
        vale: v1("seeking", 3, 6, [
          { key: "talk:moth::station", kind: "talk", turn: 8, points: 1 },
          { key: "help:moth:lamp:station", kind: "help", turn: 9, points: 2 },
        ]),
        moth: v1("seeking", 0, 6, [
          { key: "talk:vale::station", kind: "talk", turn: 2, points: 1 },
          { key: "talk:vale::station", kind: "talk", turn: 5, points: 1 },
        ]),
        keeper: v1("content", 0, 11, [
          {
            key: "trade:vale:bell+oil:station",
            kind: "trade",
            turn: 2,
            points: 1,
          },
        ]),
      },
    };
    const loaded = decodeSave(JSON.stringify(json));
    expect(loaded.life.version).toBe(2);
    for (const life of Object.values(loaded.life.actors)) {
      expect(life).not.toHaveProperty("inspiration");
      expect(life.hope.steps).toHaveLength(3);
    }
    expect(sparkOf(loaded, "vale")).toMatchObject({
      kind: "help",
      other: "moth",
      item: "lamp",
      place: "station",
    });
    expect(lifeOf(loaded, "moth").experiences).toEqual([
      { kind: "talk", turn: 2, other: "vale", item: null, place: "station" },
    ]);
    expect(sparkOf(loaded, "moth")).toBeNull();
    expect(sparkOf(loaded, "keeper")).toBeNull();
    loaded.actors.vale.place = "attic";
    const next = play(
      loaded,
      legalActions(loaded).find((a) => a.kind === "wait"),
    ).state;
    expect(lifeOf(next, "vale").phase).toBe("seeking");
    expect(actorQuests(next, "vale").some((q) => q.status === "pending")).toBe(
      true,
    );
    expect(decodeSave(encodeSave(next))).toEqual(next);
  });

  it("supplies hopes and attachments to the story without exposing unmet cast", () => {
    const s = fresh();
    expect(JSON.stringify(narrativeContext(s))).not.toMatch(/Pip|keeper|moth/);
    const local = together();
    const facts = narrativeContext(local)
      .entities.find((e) => e.id === "moth")
      .facts.join(" ");
    expect(facts).toContain(hopeOf(local, "moth").wish);
  });

  it("rejects damaged personal state", () => {
    for (const mutate of [
      (s) => (s.life = null),
      (s) => (lifeOf(s, "vale").inspiration = 0),
      (s) => (lifeOf(s, "vale").phase = "missing"),
      (s) => (lifeOf(s, "vale").milestones = [3, 1]),
      (s) => (lifeOf(s, "vale").hope.steps = [["bargain"]]),
      (s) => (lifeOf(s, "vale").hope.place = "nowhere"),
      (s) =>
        (lifeOf(s, "vale").attachments = {
          missing: { from: "moth", turn: 0 },
        }),
      (s) => (lifeOf(s, "moth").company.vale = 99),
      (s) =>
        (lifeOf(s, "keeper").experiences = Array(17).fill({
          kind: "talk",
          turn: 0,
          other: null,
          item: null,
          place: null,
        })),
      (s) => (lifeOf(s, "keeper").origin = { kind: "talk", turn: 0 }),
      (s) => (lifeOf(s, "keeper").restAt = "station"),
      (s) => (lifeOf(s, "keeper").restLeft = 9),
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
      for (const life of Object.values(s.life.actors))
        expect(life.experiences.length).toBeLessThanOrEqual(16);
    }
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
});
