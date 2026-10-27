import {
  conditionsMet,
  packFacts,
  choiceText,
  packDefinition,
  hub,
  packPlaces,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { describe, it, expect } from "vitest";
import { openingFixture } from "./helpers/greek-opening.mjs";
import {
  encodeSave,
  decodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  questCards,
  questHistoryCards,
  questHand,
  storyQuests,
  activeQuests,
  questCardId,
  questForCard,
  STORY_QUEST_CARDS,
} from "../v2/card-game/quest-cards.mjs";
import { questRecord } from "../v2/card-game/shared-quests.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
const key = (index) => `greek-drama:${STORY_QUEST_CARDS[index]}`;
const act = (world, match) => {
  const action = legalActions(world).find(match);
  expect(action).toBeTruthy();
  const result = play(world, action);
  expect(result.ok).toBe(true);
  return result.state;
};
describe("authored shared story cards", () => {
  it("keeps remote players' collections separate from visible holder cards", () => {
    let world = dispatchShared({
      op: "create",
      save: encodeSave(openingFixture("refusal").waterOffer),
    }).world;
    const request = (op, actor, extra = {}) =>
      dispatchShared({
        world,
        op,
        actor,
        claimed: ["vale", "mara"],
        present: ["vale", "mara"],
        ...extra,
      });
    let mara = request("view", "mara");
    expect(mara.ok).toBe(true);
    expect(mara.world.actors.mara.place).not.toMatch(/^greek-/);
    const ownStories = (state) =>
      questCards(state, "mara").filter((q) => q.story);
    expect(ownStories(mara.world)).toEqual([]);
    expect(storyQuests(mara.world)).toEqual([]);
    expect(activeQuests(mara.world).filter((q) => q.story)).toEqual([]);
    expect(
      questHand(mara.world).some((id) => questForCard(mara.world, id)?.story),
    ).toBe(false);
    expect(
      mara.actions.some(
        (a) => a.kind === "join-quest" && a.questKey === key(0),
      ),
    ).toBe(false);
    // Reaching the holder exposes its card. Reading it leaves the collection alone.
    world.actors.mara.place = "greek-courtyard";
    mara = request("view", "mara");
    expect(ownStories(mara.world)).toEqual([]);
    const holder = questCards(mara.world, "greek-baker").find(
      (q) => q.key === key(0),
    );
    expect(questHand(mara.world)).toContain(questCardId(mara.world, holder));
    const join = mara.actions.find(
      (a) => a.kind === "join-quest" && a.questKey === key(0),
    );
    expect(join).toBeTruthy();
    const joined = request("play", "mara", { action: join });
    expect(joined.ok).toBe(true);
    world = decodeSave(encodeSave(joined.world));
    mara = request("view", "mara");
    expect(ownStories(mara.world).map((q) => q.key)).toEqual([key(0)]);
    expect(questRecord(world, key(0)).participants).toContain("mara");
  });
  it("migrates global Greek history using recorded authors and leaves unknown players unassigned", () => {
    const old = structuredClone(openingFixture("refusal").closed);
    for (const life of Object.values(old.life.actors)) {
      if (!life.collection) continue;
      for (const field of ["cards", "archive"])
        life.collection[field] = life.collection[field].map((id) =>
          (() => {
            const record = structuredClone(old.quests.records[id]);
            delete record.completion;
            delete record.terminalRevision;
            return record;
          })(),
        );
    }
    delete old.quests;
    delete old.questCompletions;
    delete old.roamingQuests;
    delete old.routeKnowledge;
    old.sharedVersion = 1;
    old.controlledActors = ["vale", "mara"];
    old.presentActors = ["vale", "mara"];
    old.playerActorId = "mara";
    expect(storyQuests(old)).toEqual([]);
    const restored = decodeSave(JSON.stringify(old));
    expect(questCards(restored, "mara").filter((q) => q.story)).toEqual([]);
    expect(
      questHistoryCards(restored, "vale").filter((q) => q.story),
    ).toHaveLength(3);
    for (const id of [key(0), key(1), key(2)]) {
      expect(questRecord(restored, id).participants).toEqual(["vale"]);
      expect(questRecord(restored, id).completion.actorId).toBe("vale");
    }
    old.log = [];
    for (const record of Object.values(old.packs["greek-drama"].recitals))
      record.actor = null;
    const unknown = decodeSave(JSON.stringify(old));
    expect(storyQuests(unknown)).toEqual([]);
    for (const id of [key(0), key(1), key(2)]) {
      expect(questRecord(unknown, id).participants).toEqual([]);
      expect(questRecord(unknown, id).completion.actorId).toBe(null);
    }
    expect(
      questHistoryCards(unknown, "greek-baker").some((q) => q.key === key(0)),
    ).toBe(true);
  });
  it("keeps named actors and literal story text separate from the acting role", () => {
    const world = openingFixture("refusal").waterOffer;
    world.items["greek-water-jar"].holder = "mara";
    const literal = { kind: "holding", item: "greek-water-jar", actor: "vale" };
    const role = { kind: "holding", item: "greek-water-jar", role: "actor" };
    expect(conditionsMet(world, "greek-drama", [literal], "mara")).toBe(false);
    expect(conditionsMet(world, "greek-drama", [role], "mara")).toBe(true);
    world.items["greek-water-jar"].holder = "vale";
    expect(conditionsMet(world, "greek-drama", [literal], "mara")).toBe(true);
    expect(choiceText({ text: "Vale waits beside Mara." }, "mara")).toBe(
      "Vale waits beside Mara.",
    );
    expect(
      choiceText(
        {
          text: "A note arrives.",
          textTemplate: "{actor} carries a note from Vale.",
        },
        "mara",
      ),
    ).toBe("Mara carries a note from Vale.");
    for (const change of [
      (c) => {
        c.requires[0].role = "unknown";
      },
      (c) => {
        c.requires[0].actor = "vale";
      },
      (c) => {
        c.textTemplate = "{unknown} arrives.";
      },
    ]) {
      const pack = structuredClone(packDefinition("greek-drama"));
      change(pack.choices.find((c) => c.id === "greek-return-water-jar"));
      expect(
        packProblems(pack, hub, Object.keys(packPlaces)).length,
      ).toBeGreaterThan(0);
    }
  });
  it("keeps holder and participant views on one record with exact terminal sites", () => {
    const world = openingFixture("refusal").closed;
    for (const [index, holder, outcome, site] of [
      [0, "greek-baker", "fulfilled", "greek-courtyard"],
      [1, "greek-antigone", "declined", "greek-gate"],
      [2, "greek-courtyard", "shared", "greek-courtyard"],
    ]) {
      const record = questRecord(world, key(index));
      expect(record.holder.id).toBe(holder);
      expect(record.completion).toMatchObject({
        actorId: "vale",
        locationId: site,
        outcome,
      });
      const a = questHistoryCards(world, "vale").find(
        (q) => q.key === record.key,
      );
      const b = questHistoryCards(world, holder).find(
        (q) => q.key === record.key,
      );
      expect(a.status).toBe("fulfilled");
      expect(b.status).toBe(a.status);
      expect(questCardId(world, a)).not.toBe(questCardId(world, b));
      const restored = decodeSave(encodeSave(world));
      expect(questForCard(restored, questCardId(restored, b))).toEqual(
        questCards(restored, holder).find((q) => q.key === record.key) || null,
      );
      expect(questRecord(restored, record.key)).toEqual(record);
    }
    const ledger = world.questCompletions;
    expect(
      decodeSave(encodeSave(decodeSave(encodeSave(world)))).questCompletions,
    ).toEqual(ledger);
  });
  it("lets another player join the baker's card and resolve the same request", () => {
    let world = openingFixture("refusal").waterOffer;
    world.sharedVersion = 1;
    world.controlledActors = ["vale", "mara"];
    world.presentActors = ["vale", "mara"];
    world.actors.mara.place = "greek-courtyard";
    const before = structuredClone(world);
    expect(questCards(world, "greek-baker").some((q) => q.key === key(0))).toBe(
      true,
    );
    expect(questCards(world, "mara").some((q) => q.key === key(0))).toBe(false);
    expect(world).toEqual(before);
    world = act(
      world,
      (a) =>
        a.kind === "give" &&
        a.item === "greek-water-jar" &&
        a.target === "mara",
    );
    world.playerActorId = "mara";
    world = act(world, (a) => a.kind === "join-quest" && a.questKey === key(0));
    expect(questRecord(world, key(0)).participants).toEqual(["mara", "vale"]);
    world = act(world, (a) => a.choiceId === "greek-return-water-jar");
    expect(
      world.log.find((event) => event.choiceId === "greek-return-water-jar")
        .text,
    ).toMatch(/^Mara sets/);
    expect(packFacts(world, "greek-baker").join(" ")).toContain("Mara sets");
    expect(questRecord(world, key(0)).completion).toMatchObject({
      actorId: "mara",
      locationId: "greek-courtyard",
      outcome: "fulfilled",
    });
    for (const holder of ["mara", "vale", "greek-baker"])
      expect(
        questHistoryCards(world, holder).find((q) => q.key === key(0)).status,
      ).toBe("fulfilled");
    expect(decodeSave(encodeSave(world)).quests).toEqual(world.quests);
  });
  it("retains both courtyard reports and preserves unknown old authors and sites", () => {
    const world = openingFixture("concession").closed;
    expect(questRecord(world, key(2)).completion.outcome).toBe("shared");
    expect(questRecord(world, `${key(2)}:grave`).completion.outcome).toBe(
      "shared",
    );
    const old = structuredClone(world);
    for (const life of Object.values(old.life.actors)) {
      if (!life.collection) continue;
      for (const field of ["cards", "archive"])
        life.collection[field] = life.collection[field].map((id) => {
          const record = old.quests.records[id];
          delete record.completion;
          delete record.terminalRevision;
          return record;
        });
    }
    delete old.quests;
    delete old.questCompletions;
    delete old.roamingQuests;
    delete old.routeKnowledge;
    old.log = old.log.filter(
      (event) =>
        event.packId !== "greek-drama" &&
        !event.locationId?.startsWith("greek-"),
    );
    for (const receipt of Object.values(old.packs["greek-drama"].recitals))
      receipt.actor = null;
    const restored = decodeSave(JSON.stringify(old));
    for (const id of [key(0), key(1), key(2), `${key(2)}:grave`]) {
      expect(questRecord(restored, id).completion).toMatchObject({
        actorId: null,
        locationId: null,
        participants: [],
      });
      expect(questRecord(restored, id).participants).toEqual([]);
    }
    expect(
      questHistoryCards(restored, "greek-courtyard").filter(
        (q) => q.status === "fulfilled",
      ),
    ).toHaveLength(2);
    const invalid = structuredClone(restored);
    questRecord(invalid, key(0)).holder.id = "station";
    expect(() => validateWorld(invalid)).toThrow();
  });
});
