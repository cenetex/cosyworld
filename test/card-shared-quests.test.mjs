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
    expect(questRecords(s)).toHaveLength(24);
    expect(add(s).key).toBe("world:quest:80");
  });
});
