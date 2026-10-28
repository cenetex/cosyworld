import { describe, it, expect } from "vitest";
import {
  captureQuestStep,
  questStepTransition,
} from "../v2/card-game/quest-progress.mjs";
import {
  createWorld,
  refreshQuestProgress,
  encodeSave,
  decodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  installQuestCollection,
  hand,
  hold,
  at,
  either,
  condition,
} from "../v2/card-game/quests.mjs";
import {
  collectionCards,
  registerPersonalQuest,
  addQuestRecord,
  focusQuest,
  questRecord,
} from "../v2/card-game/shared-quests.mjs";

const program = (id, steps) => ({ id, name: id, steps });
const fresh = () => {
  const world = enableMotives(createWorld(), { personalQuests: true });
  world.actors.vale.place = "station";
  world.actors.keeper.place = "station";
  return world;
};
function personal(world, programs) {
  installQuestCollection(world, "vale");
  const c = world.life.actors.vale.collection;
  for (const q of collectionCards(world, "vale"))
    delete world.quests.records[q.key];
  delete world.quests.focus.vale;
  world.quests.hands.vale = [];
  c.cards = programs.map(
    (p, i) =>
      registerPersonalQuest(world, "vale", {
        key: `vale:quest:${i}`,
        program: p,
        step: 0,
        origin: null,
        createdTurn: world.turn,
        completedTurn: null,
      }).key,
  );
  c.next = programs.length;
  c.active = c.cards[0] || null;
  if (c.active) focusQuest(world, "vale", c.active);
  return c.cards.map((key) => questRecord(world, key));
}
const shared = (world, p, actor = "vale") =>
  addQuestRecord(world, {
    holder: { kind: "avatar", id: actor },
    subjectActor: actor,
    program: p,
  });
const nextTurn = (world) => {
  world.turn += 1;
  world.revision += 1;
  refreshQuestProgress(world);
};

describe("common quest progress", () => {
  it("captures the chosen alternative with its original place before the scene changes", () => {
    const first = hand(at("pond"));
    const chosen = hand(hold("lamp"), at("station"));
    const world = { eventSeq: 9, place: "station" };
    const met = new Map();
    const card = {
      key: "card",
      actor: "vale",
      questKey: "vale:quest:0",
      program: program("visit", [either(first, chosen), first]),
      step: 0,
    };
    const api = {
      handStatus: (s, actor, h) => ({ met: h.location === s.place }),
      fulfillment: (s, actor, h) => ({
        items: [...h.items],
        location: s.place,
        avatars: [],
      }),
    };
    expect(captureQuestStep(world, met, card, api)).toBe(true);
    world.place = "pond";
    chosen.items.push("bell");
    expect(captureQuestStep(world, met, card, api)).toBe(false);
    expect(met.get("card")).toMatchObject({
      capturedSeq: 9,
      step: 0,
      target: { items: ["lamp"], location: "station" },
      fulfillment: { items: ["lamp"], location: "station" },
    });
  });

  it("checks current step, terminal state and turn before either kind advances", () => {
    const record = {
      program: program("steps", [hand(), hand()]),
      step: 0,
      completedTurn: null,
    };
    expect(questStepTransition(record, { step: 0 }, 4)).toEqual({
      step: 0,
      nextStep: 1,
      complete: false,
    });
    expect(questStepTransition({ ...record, step: 1 }, { step: 1 }, 4)).toEqual(
      {
        step: 1,
        nextStep: 2,
        complete: true,
      },
    );
    for (const changed of [
      { ...record, step: 1 },
      { ...record, completedTurn: 3 },
      { ...record, retired: { turn: 3 } },
      { ...record, lastProgressTurn: 4 },
    ])
      expect(questStepTransition(changed, { step: 0 }, 4)).toBeNull();
  });

  it("advances every held personal and shared card once while personal rewards keep their owner", () => {
    const world = fresh();
    const steps = [
      either(hand(at("pond")), hand(at("station"))),
      hand(at("station")),
    ];
    const [own] = personal(world, [program("own", steps)]);
    const joint = shared(world, program("shared", steps));
    const earned = world.life.actors.vale.collection.earned;
    const level = world.actors.vale.progress.program;
    nextTurn(world);
    expect([own.step, joint.step]).toEqual([1, 1]);
    const first = structuredClone(world);
    refreshQuestProgress(world);
    expect(world).toEqual(first);
    nextTurn(world);
    expect([own.step, joint.step]).toEqual([2, 2]);
    expect(world.life.actors.vale.collection.earned).toBe(earned + 2);
    expect(world.actors.vale.progress.program).toBe(level + 1);
    expect(own.rewardActor).toBe("vale");
    expect(joint.rewardActor).toBeNull();
    expect(own.completion).toMatchObject({
      actorId: "vale",
      locationId: "station",
      participants: ["vale"],
    });
    expect(joint.completion).toMatchObject({
      actorId: "vale",
      locationId: "station",
      participants: ["vale"],
    });
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });

  it("shares an effect across personal and shared completions while keeping both receipts", () => {
    const world = fresh();
    const target = {
      ...hand(at("station")),
      consequence: { kind: "trust", avatar: "keeper" },
    };
    const [own] = personal(world, [program("own", [target])]);
    const joint = shared(world, program("shared", [target]));
    const trust = world.actors.keeper.trust.vale;
    nextTurn(world);
    expect(world.actors.keeper.trust.vale).toBe(trust + 1);
    expect(own.completion.id).not.toBe(joint.completion.id);
    expect(
      world.log.filter((e) => e.turn === world.turn && e.consequence),
    ).toHaveLength(1);
    const completed = structuredClone(world);
    refreshQuestProgress(world);
    expect(world).toEqual(completed);
  });

  it("keeps each actor's trust reward when two people complete the same effect", () => {
    const world = fresh();
    const target = {
      ...hand(at("station")),
      consequence: { kind: "trust", avatar: "moth" },
    };
    const [own] = personal(world, [program("own", [target])]);
    const joint = shared(world, program("shared", [target]), "keeper");
    const before = { ...world.actors.moth.trust };
    nextTurn(world);
    expect(world.actors.moth.trust.vale).toBe(before.vale + 1);
    expect(world.actors.moth.trust.keeper).toBe(before.keeper + 1);
    expect(own.completion.actorId).toBe("vale");
    expect(joint.completion.actorId).toBe("keeper");
    expect(joint.completion.locationId).toBe("station");
  });

  it("rechecks a new fact in the saved turn and applies a shared effect once across publications", () => {
    const world = fresh();
    world.items.lamp.holder = "vale";
    world.items.lamp.lit = false;
    const effect = { kind: "anchor" };
    const [own] = personal(world, [
      program("arrive", [{ ...hand(at("station")), consequence: effect }]),
    ]);
    const joint = shared(
      world,
      program("see light", [
        {
          ...hand(at("station"), condition("lit", "lamp")),
          consequence: effect,
        },
      ]),
    );
    nextTurn(world);
    expect(own.completion).toBeTruthy();
    expect(joint.step).toBe(0);
    world.items.lamp.lit = true;
    world.items.lamp.fuel = 6;
    refreshQuestProgress(world);
    expect(joint.completedTurn).toBe(world.turn);
    expect(
      world.log.filter((e) => e.turn === world.turn && e.consequence),
    ).toHaveLength(1);
    const restored = decodeSave(encodeSave(world));
    refreshQuestProgress(restored);
    expect(restored).toEqual(world);
  });

  it("keeps ordered receipt attribution across save restore and registry insertion order", () => {
    const world = fresh();
    personal(world, [program("own", [hand(at("station"))])]);
    shared(world, program("joint", [hand(at("station"))]), "keeper");
    const reordered = decodeSave(encodeSave(world));
    reordered.quests.records = Object.fromEntries(
      Object.entries(reordered.quests.records).reverse(),
    );
    const action = legalActions(world).find((a) => a.kind === "wait");
    const first = play(world, action);
    const second = play(reordered, action);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
  });
});
