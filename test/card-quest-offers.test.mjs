import { describe, it, expect } from "vitest";
import {
  decodeSave,
  validateWorld,
  places,
  things,
} from "../v2/card-game/world.mjs";
import {
  collectExperienceQuests,
  ensureCollectedQuest,
} from "../v2/card-game/quests.mjs";
import { questCards } from "../v2/card-game/quest-cards.mjs";
import {
  canOfferQuest,
  questGoalSignature,
} from "../v2/card-game/quest-offers.mjs";
import { collectionCards } from "../v2/card-game/shared-quests.mjs";
import {
  offerWorld,
  addOffer,
  threeGatherings,
} from "./fixtures/card-quest-offers.mjs";
const generated = (world) =>
  collectionCards(world, "vale").filter((q) => q.program.generated);
const collection = (world) => world.life.actors.vale.collection;
const reload = (world) => decodeSave(JSON.stringify(world));
const remember = (world, turn, other = "mara") => {
  world.turn = world.revision = turn;
  world.life.actors.vale.experiences.push({
    kind: "talk",
    turn,
    other,
    item: null,
    place: "station",
  });
};
const collect = (world) =>
  collectExperienceQuests(world, "vale", places, things);

describe("quieter generated quest offers", () => {
  it("keeps one untouched offer from the three gathering wishes seen in an old save", () => {
    const old = threeGatherings();
    const before = structuredClone(collection(old));
    const world = reload(old);
    expect(questCards(world).map((q) => q.key)).toEqual(["vale:quest:1"]);
    expect(world.quests.records).toEqual(old.quests.records);
    expect(collection(world)).toMatchObject({
      next: before.next,
      earned: before.earned,
      archivedCompleted: before.archivedCompleted,
    });
    expect(reload(world)).toEqual(world);
  });
  it("keeps the pursued goal and its exact progress, rewards and origin", () => {
    const old = threeGatherings({ protect: true });
    const world = reload(old);
    expect(questCards(world).map((q) => q.key)).toEqual(["vale:quest:1"]);
    expect(world.quests.records).toEqual(old.quests.records);
    expect(world.actors).toEqual(old.actors);
    expect(world.quests.focus).toEqual(old.quests.focus);
    expect(world.questCompletions).toEqual(old.questCompletions);
    expect(world.log).toEqual(old.log);
    expect(collection(world)).toMatchObject({
      earned: 1,
      next: 4,
      active: "vale:quest:1",
    });
  });
  it("keeps joined goals and gives distinct surviving companions useful titles", () => {
    const old = threeGatherings({ protect: true, twoProtected: true });
    const world = reload(old);
    expect(questCards(world).map((q) => q.key)).toEqual([
      "vale:quest:1",
      "vale:quest:2",
    ]);
    expect(world.quests.records).toEqual(old.quests.records);
    const cards = questCards(world).filter((q) =>
      q.key.startsWith("vale:quest:"),
    );
    expect(new Set(cards.map((q) => q.title)).size).toBe(2);
    expect(cards.map((q) => q.title).join(" ")).toContain("Mara");
    expect(cards.map((q) => q.title).join(" ")).toContain("Nell");
  });
  it.each(["focused", "moved", "progressed"])(
    "preserves an independently %s record",
    (kind) => {
      const old = threeGatherings();
      const record = generated(old)[1];
      if (kind === "focused") {
        old.quests.focus.mara = record.key;
        record.participants = ["mara", "vale"];
      }
      if (kind === "moved") record.holder = { kind: "avatar", id: "mara" };
      if (kind === "progressed") {
        record.step = 1;
        record.lastProgressTurn = 3;
      }
      const world = reload(old);
      expect(world.quests.records[record.key]).toEqual(record);
      expect(questCards(world).map((q) => q.key)).toEqual([record.key]);
    },
  );
  it("preserves fulfilled history and earned counters", () => {
    const old = threeGatherings();
    const record = generated(old)[0];
    record.step = 2;
    record.completedTurn = 3;
    record.lastProgressTurn = 3;
    collection(old).earned = 2;
    old.actors.vale.progress.program = 1;
    old.actors.vale.progress.marks = [2, 3];
    const world = reload(old);
    expect(world.quests.records[record.key]).toEqual(record);
    expect(generated(world)).toHaveLength(3);
    expect(questCards(world).length).toBeLessThanOrEqual(2);
    expect(world.actors.vale.progress).toEqual(old.actors.vale.progress);
    expect(collection(world).earned).toBe(2);
  });
  it("treats reordered companions and alternatives as the same offer family", () => {
    const old = threeGatherings();
    const [first, second] = generated(old);
    second.program = structuredClone(first.program);
    second.program.steps[0].avatars.reverse();
    second.program.steps[1] = {
      any: [second.program.steps[1], first.program.steps[0]],
    };
    first.program.steps[1] = {
      any: [...second.program.steps[1].any].reverse(),
    };
    expect(questGoalSignature(second.program)).toBe(
      questGoalSignature(first.program),
    );
    expect(questCards(reload(old))).toHaveLength(1);
    expect(generated(reload(old))).toHaveLength(3);
  });
  it("compares exact goals across families while preserving step order and rewards", () => {
    const world = threeGatherings();
    world.turn = 12;
    // Keep one offer to exercise equivalence rather than the pending cap.
    const record = generated(world)[0];
    for (const extra of generated(world).slice(1))
      delete world.quests.records[extra.key];
    collection(world).cards = [record.key];
    const candidate = structuredClone(record.program);
    candidate.generated.situation = "crossing";
    candidate.steps[0].avatars.reverse();
    expect(questGoalSignature(candidate)).toBe(
      questGoalSignature(record.program),
    );
    expect(canOfferQuest(world, "vale", candidate)).toBe(false);
    candidate.steps[1].consequence.avatar = "nell";
    expect(questGoalSignature(candidate)).not.toBe(
      questGoalSignature(record.program),
    );
    expect(canOfferQuest(world, "vale", candidate)).toBe(true);
    candidate.steps[1].consequence = structuredClone(
      record.program.steps[1].consequence,
    );
    expect(questGoalSignature(candidate)).toBe(
      questGoalSignature(record.program),
    );
    candidate.steps.reverse();
    expect(questGoalSignature(candidate)).not.toBe(
      questGoalSignature(record.program),
    );
  });
  it("validates a malformed excess offer before cleanup", () => {
    const old = threeGatherings();
    generated(old)[2].step = -1;
    expect(() => reload(old)).toThrow();
    const badPacing = threeGatherings();
    collection(badPacing).lastOfferTurn = 4;
    expect(() => reload(badPacing)).toThrow();
  });
  it("measures cooldown from the latest saved offer even after cleanup", () => {
    const world = reload(threeGatherings());
    world.turn = 10;
    expect(canOfferQuest(world, "vale")).toBe(false);
    world.turn = 11;
    expect(canOfferQuest(world, "vale")).toBe(true);
  });
  it("adds one offer across three repeated talks and companion changes", () => {
    const world = offerWorld();
    for (const [index, pair] of [
      ["mara", "ash"],
      ["mara", "nell"],
      ["ash", "nell"],
    ].entries()) {
      for (const id of ["mara", "ash", "nell"])
        world.actors[id].place = pair.includes(id) ? "station" : "pond";
      remember(world, index + 1, pair[0]);
      collect(world);
    }
    expect(generated(world)).toHaveLength(1);
    expect(generated(world)[0].program.generated.situation).toBe("gathering");
    expect(collection(world).collectedThrough).toBe(3);
    expect(reload(world)).toEqual(world);
  });
  it("keeps one family offer after cooldown when nearby companions change", () => {
    const world = offerWorld();
    addOffer(world, ["mara", "ash"]);
    for (const [turn, pair] of [
      [8, ["mara", "nell"]],
      [16, ["ash", "nell"]],
    ]) {
      for (const id of ["mara", "ash", "nell"])
        world.actors[id].place = pair.includes(id) ? "station" : "pond";
      remember(world, turn, pair[0]);
      collect(world);
      expect(generated(world)).toHaveLength(1);
      expect(collection(world).collectedThrough).toBe(turn);
    }
  });
  it("consumes skipped experiences without a later burst and admits only one fresh offer", () => {
    const world = offerWorld();
    addOffer(world, ["mara", "ash"], { family: "crossing" });
    remember(world, 1);
    collect(world);
    remember(world, 7, "nell");
    collect(world);
    world.turn = world.revision = 8;
    collect(world);
    expect(generated(world)).toHaveLength(1);
    remember(world, 9);
    remember(world, 9, "nell");
    collect(world);
    expect(generated(world)).toHaveLength(2);
    expect(generated(world)[1].origin.other).toBe("mara");
    remember(world, 17);
    collect(world);
    expect(generated(world)).toHaveLength(2);
  });
  it("uses the same eight-turn gap for the fallback path", () => {
    const world = offerWorld();
    collection(world).lastOfferTurn = 0;
    const life = world.life.actors.vale;
    for (const turn of [7, 8]) {
      world.turn = world.revision = turn;
      life.phase = "active";
      life.origin = {
        kind: "talk",
        turn,
        other: "mara",
        item: null,
        place: "station",
      };
      ensureCollectedQuest(world, "vale", places, things);
      expect(generated(world)).toHaveLength(turn === 7 ? 0 : 1);
      expect(reload(world)).toEqual(world);
    }
    expect(collection(world).lastOfferTurn).toBe(8);
  });
  it("keeps authored offers through cleanup and the generated offer limit", () => {
    const world = threeGatherings();
    for (const q of generated(world)) delete q.program.generated;
    const loaded = reload(world);
    expect(loaded.quests.records).toEqual(world.quests.records);
    expect(questCards(loaded)).toHaveLength(2);
    expect(canOfferQuest(loaded, "vale")).toBe(false);
    expect(validateWorld(loaded)).toEqual(loaded);
  });
});
