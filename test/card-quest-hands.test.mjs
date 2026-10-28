import { atticOpening } from "./fixtures/card-attic-opening.mjs";
import { describe, it, expect } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  questCards,
  questHistoryCards,
  questHand,
  questForCard,
  isQuestCard,
} from "../v2/card-game/quest-cards.mjs";
import {
  canCarryQuest,
  carryQuest,
  dropQuest,
  questHandKeys,
  settleQuestHands,
} from "../v2/card-game/quest-hands.mjs";
import { addQuestRecord, joinQuest } from "../v2/card-game/shared-quests.mjs";
import {
  offerWorld,
  addOffer,
  threeGatherings,
} from "./fixtures/card-quest-offers.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { pendingQuestValue } from "../v2/card-game/life.mjs";
import { narrativeContext, turnOutcome } from "../v2/card-game/narrative.mjs";
import { pursueQuest } from "../v2/card-game/quests.mjs";
const reload = (w) => decodeSave(encodeSave(w));
const act = (world, kind, fields = {}) => {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action).toBeTruthy();
  const result = play(world, action);
  expect(result.ok).toBe(true);
  return result.state;
};
describe("two carried quests", () => {
  it("preserves every old record and selects focus before stable overflow", () => {
    const old = threeGatherings({ protect: true, twoProtected: true });
    delete old.quests.hands;
    const before = structuredClone(old.quests.records);
    const loaded = reload(old);
    expect(loaded.quests.records).toEqual(before);
    expect(questHandKeys(loaded, "vale")).toEqual([
      "vale:quest:1",
      "vale:quest:2",
    ]);
    expect(loaded.actors.vale.progress).toEqual(old.actors.vale.progress);
    expect(questCards(loaded)).toHaveLength(2);
    expect(reload(loaded)).toEqual(loaded);
  });
  it.each([false, true])(
    "shows one legacy family while preserving all three records (focused=%s)",
    (protect) => {
      const old = threeGatherings({ protect });
      delete old.quests.hands;
      const record = structuredClone(old.quests.records["vale:quest:1"]);
      const loaded = reload(old);
      expect(questCards(loaded).map((q) => q.key)).toEqual(["vale:quest:1"]);
      expect(Object.keys(loaded.quests.records)).toEqual(
        Object.keys(old.quests.records),
      );
      expect(loaded.quests.records[record.key]).toEqual(record);
      expect(loaded.actors.vale.progress).toEqual(old.actors.vale.progress);
    },
  );
  it("offers Drop for the first quest before the first played turn", () => {
    let w = enableMotives(atticOpening(), {
      personalQuests: true,
    });
    expect(questCards(w)[0].key).toBe("vale:quest:0");
    w = act(w, "drop-quest", { questKey: "vale:quest:0" });
    expect(w.quests.records["vale:quest:0"].droppedBy).toEqual({ vale: 1 });
    expect(turnOutcome(w).card).toMatchObject({
      kind: "drop-quest",
      target: "vale",
      quest: { key: "vale:quest:0", holder: { kind: "avatar", id: "vale" } },
    });
    expect(questCards(w)).toHaveLength(0);
    expect(reload(w)).toEqual(w);
  });
  it("keeps a dropped hand quiet for eight turns and its identity out of later hands", () => {
    let w = reload(threeGatherings({ protect: true }));
    w = act(w, "drop-quest", { questKey: "vale:quest:1" });
    const records = Object.keys(w.quests.records).filter((key) =>
      key.startsWith("vale:quest:"),
    );
    for (let turn = 0; turn < 7; turn++) {
      w = act(w, "wait");
      expect(
        Object.keys(w.quests.records).filter((key) =>
          key.startsWith("vale:quest:"),
        ),
      ).toEqual(records);
      expect(questHandKeys(w, "vale")).toEqual([]);
    }
    w = act(w, "wait");
    expect(questHandKeys(w, "vale")).not.toContain("vale:quest:1");
    expect(reload(w)).toEqual(w);
  });
  it("can explicitly resume saved overflow through the model with valid focus and progress", () => {
    const w = reload(threeGatherings({ protect: true }));
    dropQuest(w, "vale", "vale:quest:1");
    expect(pursueQuest(w, "vale", "vale:quest:2")).toBe(true);
    expect(w.life.actors.vale.collection.active).toBe("vale:quest:2");
    expect(w.quests.focus.vale).toBe("vale:quest:2");
    expect(questHandKeys(w, "vale")).toEqual(["vale:quest:2"]);
    expect(reload(w)).toEqual(w);
  });
  it("counts an item-held quest in its owner's hand and allows Drop", () => {
    let w = offerWorld();
    const q = addQuestRecord(w, {
      holder: { kind: "item", id: "lamp" },
      participants: [],
      program: {
        id: "lamp-purpose",
        name: "Lamp purpose",
        steps: [{ items: [], avatars: [], location: "pond" }],
      },
    });
    expect(questHandKeys(w, "vale")).toEqual([q.key]);
    w = act(w, "drop-quest", { questKey: q.key });
    expect(questHandKeys(w, "vale")).toEqual([]);
    expect(reload(w).quests.records[q.key].droppedBy.vale).toBe(1);
  });
  it("keeps dropped history separate from current wants and dialogue", () => {
    const w = offerWorld();
    const q = addOffer(w, ["mara", "ash"]);
    expect(pendingQuestValue(w, "vale", "lamp")).toBe(1);
    dropQuest(w, "vale", q.key);
    expect(pendingQuestValue(w, "vale", "lamp")).toBe(0);
    expect(
      narrativeContext(w)
        .entities.find((e) => e.id === "vale")
        .facts.join(" "),
    ).not.toContain("I also want to pursue");
    expect(w.quests.records[q.key].program).toEqual(q.program);
  });
  it("bounds joins across personal and shared quests", () => {
    const w = offerWorld();
    addOffer(w, ["mara", "ash"]);
    addOffer(w, ["mara", "nell"]);
    const shared = addQuestRecord(w, {
      holder: { kind: "place", id: "station" },
      participants: [],
      program: {
        id: "meet",
        name: "Meet",
        steps: [{ items: [], avatars: [], location: "pond" }],
      },
    });
    expect(questHandKeys(w, "vale")).toHaveLength(2);
    expect(joinQuest(w, "vale", shared.key)).toBe(false);
    expect(shared.participants).toEqual([]);
    expect(questCards(w)).toHaveLength(2);
  });
  it("drops an owned progressed goal once, retaining credit and source facts", () => {
    let w = threeGatherings({ protect: true });
    w = reload(w);
    const key = "vale:quest:1",
      record = structuredClone(w.quests.records[key]);
    const earned = w.life.actors.vale.collection.earned,
      marks = [...w.actors.vale.progress.marks];
    w = act(w, "drop-quest", { questKey: key });
    expect(w.quests.records[key]).toMatchObject({
      ...record,
      droppedBy: { vale: w.turn },
    });
    expect(w.life.actors.vale.collection.earned).toBe(earned);
    expect(w.actors.vale.progress.marks).toEqual(marks);
    expect(questHandKeys(w, "vale")).not.toContain(key);
    expect(
      legalActions(w).some(
        (a) => a.kind === "drop-quest" && a.questKey === key,
      ),
    ).toBe(false);
    expect(reload(w)).toEqual(w);
  });
  it("shows one owned copy when its participant also holds the quest item", () => {
    const w = offerWorld();
    const q = addQuestRecord(w, {
      holder: { kind: "item", id: "lamp" },
      participants: ["vale"],
      program: {
        id: "lamp-purpose",
        name: "Lamp purpose",
        steps: [{ items: [], avatars: [], location: "pond" }],
      },
    });
    const shown = questHand(w)
      .filter(isQuestCard)
      .map((id) => questForCard(w, id));
    expect(shown.filter((card) => card.key === q.key)).toHaveLength(1);
  });
  it("drops a shared copy while its other participant keeps their hand", () => {
    const w = offerWorld();
    const q = addQuestRecord(w, {
      holder: { kind: "place", id: "station" },
      participants: ["vale", "mara"],
      program: {
        id: "shared",
        name: "Shared",
        steps: [{ items: [], avatars: [], location: "pond" }],
      },
    });
    expect(dropQuest(w, "vale", q.key)).toBe(true);
    expect(questHandKeys(w, "vale")).not.toContain(q.key);
    expect(questHandKeys(w, "mara")).toContain(q.key);
    expect(q.participants).toEqual(["mara", "vale"]);
    expect(joinQuest(w, "vale", q.key)).toBe(false);
    expect(reload(w).quests.records[q.key].droppedBy).toEqual({ vale: 0 });
  });
  it("drops a story copy while its authored outcome remains available", () => {
    let w = openingFixture("refusal").arrival;
    const q = Object.values(w.quests.records).find(
      (q) => q.mode === "story" && q.completedTurn === null,
    );
    for (const key of questHandKeys(w, "vale")) dropQuest(w, "vale", key);
    expect(joinQuest(w, "vale", q.key)).toBe(true);
    expect(dropQuest(w, "vale", q.key)).toBe(true);
    const loaded = reload(w);
    expect(loaded.quests.records[q.key].program).toEqual(q.program);
    expect(questCards(loaded).some((card) => card.key === q.key)).toBe(false);
    expect(loaded.packs).toEqual(w.packs);
  });
  it("keeps a fulfilled card for two turns and preserves its full history", () => {
    const w = offerWorld();
    w.turn = w.revision = 2;
    const q = addOffer(w, ["mara", "ash"]);
    q.step = 2;
    q.completedTurn = 2;
    q.lastProgressTurn = 2;
    w.actors.vale.progress.program = 1;
    w.actors.vale.progress.marks = [1, 2];
    w.life.actors.vale.collection.earned = 2;
    expect(questCards(w)).toHaveLength(1);
    w.turn = w.revision = 3;
    expect(questCards(w)[0]).toMatchObject({ fading: true, expiresTurn: 4 });
    w.turn = w.revision = 4;
    settleQuestHands(w);
    expect(questCards(w)).toHaveLength(0);
    expect(
      questHistoryCards(w).find((card) => card.key === q.key),
    ).toBeTruthy();
    expect(reload(w).quests.records[q.key]).toEqual(q);
  });
  it("allows an active acquisition to replace a brief completed card", () => {
    const w = offerWorld();
    const first = addOffer(w, ["mara", "ash"]);
    first.completedTurn = 0;
    addOffer(w, ["mara", "nell"]);
    const third = addOffer(w, ["ash", "nell"]);
    expect(canCarryQuest(w, "vale", third)).toBe(true);
    expect(carryQuest(w, "vale", third)).toBe(true);
    expect(questHandKeys(w, "vale")).toHaveLength(2);
    expect(questHandKeys(w, "vale")).not.toContain(first.key);
  });
  it("rejects another actor's dropped key and keeps the world unchanged", () => {
    const w = offerWorld();
    const q = addQuestRecord(w, {
      holder: { kind: "avatar", id: "mara" },
      participants: ["mara"],
      program: {
        id: "mara-only",
        name: "Mara's purpose",
        steps: [{ items: [], avatars: [], location: "pond" }],
      },
    });
    const result = play(w, { key: `drop-quest:vale:${q.key}` });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(w);
  });
  it.each([7, true, "x", []])(
    "rejects malformed hand and dropped maps %j",
    (bad) => {
      const w = offerWorld();
      const q = addOffer(w, ["mara", "ash"]);
      const invalid = structuredClone(w);
      invalid.quests.hands = bad;
      expect(() => decodeSave(JSON.stringify(invalid))).toThrow();
      q.droppedBy = bad;
      expect(() => decodeSave(JSON.stringify(w))).toThrow();
    },
  );
});
