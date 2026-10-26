import { questCards, questCardId } from "../v2/card-game/quest-cards.mjs";
import { actorQuests } from "../v2/card-game/quests.mjs";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { latestQuestCompletion } from "../v2/card-game/quest-completions.mjs";
import { describe, it, expect } from "vitest";
import {
  installSharedQuestRegistry,
  collectionCards,
  addQuestRecord,
  questRecord,
  focusQuest,
  joinQuest,
  shareQuest,
  retireQuest,
  questStatus,
  questRecords,
} from "../v2/card-game/shared-quests.mjs";
const fresh = () => ({
  turn: 3,
  actors: { vale: {}, keeper: {} },
  life: { actors: {} },
});
const program = {
  id: "meet",
  name: "Meet by the water",
  steps: [{ items: [], avatars: [], location: "pond" }],
};
const add = (s, holder = { kind: "avatar", id: "vale" }, extra = {}) =>
  addQuestRecord(s, { holder, program, ...extra });
describe("shared quest records", () => {
  it("moves personal records into one registry with stable IDs and personal reward credit", () => {
    const s = fresh(),
      old = { key: "vale:quest:4", program, step: 0, completedTurn: null };
    s.life.actors.vale = {
      collection: { active: old.key, cards: [old], archive: [], earned: 9 },
    };
    installSharedQuestRegistry(s);
    expect(s.life.actors.vale.collection.cards).toEqual([old.key]);
    expect(collectionCards(s, "vale")[0]).toBe(s.quests.records[old.key]);
    expect(questRecord(s, old.key).rewardActor).toBe("vale");
    expect(s.life.actors.vale.collection.earned).toBe(9);
    const saved = JSON.parse(JSON.stringify(s));
    installSharedQuestRegistry(saved);
    expect(saved).toEqual(s);
  });
  it("shares one progress record while each participant keeps a separate focus", () => {
    const s = fresh(),
      shared = add(s, { kind: "place", id: "pond" }),
      other = add(s);
    focusQuest(s, "vale", shared.key);
    focusQuest(s, "keeper", shared.key);
    shared.step = 1;
    expect(questRecord(s, shared.key).step).toBe(1);
    focusQuest(s, "vale", other.key);
    expect(s.quests.focus.keeper).toBe(shared.key);
    expect(s.quests.focus.vale).toBe(other.key);
    expect(shared.participants).toEqual(["keeper", "vale"]);
    expect(questStatus(s, shared)).toBe("active");
  });
  it("keeps identity, participation and progress when an item holds the card", () => {
    const s = fresh(),
      q = add(s);
    joinQuest(s, "keeper", q.key);
    q.step = 1;
    shareQuest(s, q.key, { kind: "item", id: "lamp" });
    expect(questRecord(s, q.key)).toMatchObject({
      step: 1,
      holder: { kind: "item", id: "lamp" },
      participants: ["keeper", "vale"],
    });
  });
  it("retires only the selected journey and preserves other focus and reward state", () => {
    const s = fresh(),
      unrelated = add(s),
      journey = add(
        s,
        { kind: "avatar", id: "keeper" },
        { cause: { kind: "journey", rootId: "source:terminal:1" } },
      );
    focusQuest(s, "vale", unrelated.key);
    focusQuest(s, "keeper", journey.key);
    expect(retireQuest(s, journey.key)).toBe(true);
    expect(s.quests.focus).toEqual({ vale: unrelated.key });
    expect(journey.completedTurn).toBeNull();
    expect(journey.retired.cause.rootId).toBe("source:terminal:1");
    expect(questStatus(s, journey)).toBe("superseded");
    expect(questRecord(s, unrelated.key)).toBe(unrelated);
  });
  it("bounds old journey records and keeps new stable keys available", () => {
    const s = fresh();
    for (let i = 0; i < 80; i++) {
      const q = add(s, { kind: "avatar", id: "keeper" });
      retireQuest(s, q.key);
      s.turn++;
    }
    expect(questRecords(s)).toHaveLength(80);
    expect(questRecords(s).filter((q) => q.compacted)).toHaveLength(56);
    expect(add(s).key).toBe("world:quest:80");
  });
});

describe("shared quest legal plays", () => {
  const scene = () => {
    const s = enableMotives(createWorld(), { personalQuests: true });
    s.actors.vale.place = "station";
    return s;
  };
  const act = (s, kind, key) => {
    const action = legalActions(s).find(
      (a) => a.kind === kind && (!key || a.questKey === key),
    );
    expect(action).toBeTruthy();
    const result = play(s, action);
    expect(result.ok).toBe(true);
    expect(play(decodeSave(encodeSave(s)), action)).toEqual(result);
    return result.state;
  };
  it("lets a person help a place quest and records one exact-site completion", () => {
    let s = scene();
    const q = addQuestRecord(s, {
      holder: { kind: "place", id: "station" },
      program: {
        id: "company",
        name: "Make room for company",
        steps: [{ items: [], location: "station", avatars: [] }],
      },
    });
    s = act(s, "join-quest", q.key);
    expect(questRecord(s, q.key).step).toBe(1);
    expect(questRecord(s, q.key).completedTurn).toBe(s.turn);
    expect(questRecord(s, q.key).completion).toMatchObject({
      actorId: "vale",
      locationId: "station",
      outcome: "fulfilled",
    });
    expect(decodeSave(encodeSave(s))).toEqual(s);
    const seq = questRecord(s, q.key).completion.seq;
    s = act(s, "wait");
    expect(questRecord(s, q.key).completion.seq).toBe(seq);
  });
  it("credits an AI's completed quest at its own site during another actor's turn", () => {
    let s = scene();
    const q = addQuestRecord(s, {
      holder: { kind: "avatar", id: "keeper" },
      program: {
        id: "watch",
        name: "Watch the station",
        steps: [{ items: [], location: "station", avatars: [] }],
      },
    });
    focusQuest(s, "keeper", q.key);
    s = act(s, "wait");
    expect(questRecord(s, q.key).completion).toMatchObject({
      actorId: "keeper",
      locationId: "station",
      participants: ["keeper"],
    });
    expect(latestQuestCompletion(s).seq).toBeGreaterThan(0);
  });
  it("moves one unfinished card to a carried item through a legal share play", () => {
    let s = scene();
    s.items.lamp.holder = "vale";
    const q = addQuestRecord(s, {
      holder: { kind: "avatar", id: "vale" },
      program,
    });
    const action = legalActions(s).find(
      (a) =>
        a.kind === "share-quest" &&
        a.questKey === q.key &&
        a.holder.id === "lamp",
    );
    expect(action).toBeTruthy();
    s = play(s, action).state;
    expect(questRecord(s, q.key).holder).toEqual({ kind: "item", id: "lamp" });
    expect(questRecords(s).filter((r) => r.key === q.key)).toHaveLength(1);
  });
});

it("retains shared completion identity and both participant views past the recent history window", () => {
  let s = enableMotives(createWorld(), { personalQuests: true });
  s.actors.vale.place = "station";
  let first, firstIds;
  for (let index = 0; index < 30; index++) {
    const q = addQuestRecord(s, {
      holder: { kind: "place", id: "station" },
      participants: ["vale", "keeper"],
      program: {
        id: `visit-${index}`,
        name: `Shared visit ${index}`,
        purpose: "Make room for company.",
        steps: [{ items: [], avatars: [], location: "station" }],
      },
    });
    first ||= q.key;
    s = play(
      s,
      legalActions(s).find((a) => a.kind === "wait"),
    ).state;
    if (index === 0)
      firstIds = ["vale", "keeper"].map((actor) =>
        questCardId(
          s,
          questCards(s, actor).find((q) => q.key === first),
        ),
      );
  }
  const old = questRecord(s, first),
    receipt = structuredClone(old.completion);
  expect(old).toMatchObject({
    compacted: true,
    totalSteps: 1,
    step: 1,
    program: { name: "Shared visit 0", steps: [] },
  });
  for (const actor of ["vale", "keeper"])
    expect(actorQuests(s, actor).find((q) => q.key === first)).toMatchObject({
      status: "fulfilled",
      completion: receipt,
    });
  const loaded = decodeSave(encodeSave(s));
  expect(questRecord(loaded, first).completion).toEqual(receipt);
  expect(
    ["vale", "keeper"].map((actor) =>
      questCardId(
        loaded,
        questCards(loaded, actor).find((q) => q.key === first),
      ),
    ),
  ).toEqual(firstIds);
  expect(questRecords(loaded).filter((q) => q.key === first)).toHaveLength(1);
});

it("pauses shared suggestions at retained capacity", () => {
  const s = fresh();
  for (let i = 0; i < 256; i++) {
    const q = add(s);
    expect(q).toBeTruthy();
    retireQuest(s, q.key);
    s.turn++;
  }
  expect(add(s)).toBeNull();
  expect(questRecords(s)).toHaveLength(256);
});

it("publishes the same completion order when a JSON host reorders registry keys", () => {
  const s = enableMotives(createWorld(), { personalQuests: true });
  s.actors.keeper.place = "station";
  s.actors.moth.place = "pond";
  for (const [key, actor, place] of [
    ["world:quest:10", "keeper", "station"],
    ["world:quest:2", "moth", "pond"],
  ]) {
    addQuestRecord(s, {
      key,
      holder: { kind: "avatar", id: actor },
      subjectActor: actor,
      program: {
        id: key,
        name: "Watch this place",
        steps: [{ items: [], avatars: [], location: place }],
      },
    });
  }
  const reordered = JSON.parse(JSON.stringify(s));
  reordered.quests.records = Object.fromEntries(
    Object.entries(reordered.quests.records).reverse(),
  );
  const action = legalActions(s).find((a) => a.kind === "wait");
  const a = play(s, action).state,
    b = play(reordered, action).state;
  expect(a.questCompletions).toEqual(b.questCompletions);
  const events = a.questCompletions.recent.map((r) => r.eventSeq);
  expect(events).toEqual([...events].sort((a, b) => a - b));
  expect(
    a.questCompletions.recent
      .filter((r) => r.questKey.startsWith("world:quest:"))
      .map((r) => r.questKey),
  ).toEqual(["world:quest:10", "world:quest:2"]);
  expect(latestQuestCompletion(a)).toEqual(latestQuestCompletion(b));
});
