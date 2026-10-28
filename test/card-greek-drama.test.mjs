import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { summonTransport } from "../v2/card-game/pack-transport.mjs";
import {
  collectionCards,
  registerPersonalQuest,
  focusQuest,
  clearQuestFocus,
} from "../v2/card-game/shared-quests.mjs";
import { describe, expect, it } from "vitest";
import {
  addLog,
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  itemPlace,
  legalActions,
  play,
  rootHolder,
  places,
  things,
} from "../v2/card-game/world.mjs";
import {
  availableCards,
  cardChoices,
  cardPlay,
} from "../v2/card-game/cards.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  desireFor,
  knownActors,
  levelOf,
  ensureCollectedQuest,
  pursueQuest,
} from "../v2/card-game/quests.mjs";
import {
  applyGeneratedText,
  narrativeContext,
} from "../v2/card-game/narrative.mjs";
import { conditionsMet } from "../v2/card-game/pack-registry.mjs";

import {
  questCards,
  questHistoryCards,
  questCardId,
  storyQuests,
  fulfilledQuests,
  questHand,
  STORY_QUEST_CARDS,
} from "../v2/card-game/quest-cards.mjs";

const story = (world, index) =>
  storyQuests(world).find((q) => q.id === STORY_QUEST_CARDS[index]);
const PACK = "greek-drama";
const HARBOR = "greek-harbor";
const COURTYARD = "greek-courtyard";
const GATE = "greek-gate";
const SANCTUARY = "greek-sanctuary";
const BATTLEFIELD = "greek-battlefield";
const WELL = "greek-well";
const PALACE = "greek-palace";
const stateOf = (world) => world.packs[PACK];

function act(world, kind, field = {}) {
  const action = legalActions(world).find(
    (candidate) =>
      candidate.kind === kind &&
      Object.entries(field).every(([key, value]) => candidate[key] === value),
  );
  expect(action, `${kind} ${JSON.stringify(field)}`).toBeTruthy();
  const result = play(world, action, world.revision);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

function move(world, target) {
  const roadSteps = greekTravelTargets(world.actors.vale.place, target);
  if (roadSteps.length > 1 && !roadSteps.includes("greek-ship"))
    return roadSteps.reduce(move, world);
  const boarding = world.actors.vale.place === "pond" && target === HARBOR;
  const nested = boarding && world.items.cloth.holder === "bell";
  if (boarding && !world.crossings["pond-greek-harbor"].discovered) {
    if (["lamp", "bell"].includes(world.items.cloth.holder))
      world = act(world, "take", { item: "cloth" });
    if (!world.items.lamp.lit) world = act(world, "light", { item: "lamp" });
    for (let i = 0; i < 2; i++) {
      world = act(world, "cover", { item: "cloth", target: "lamp" });
      world = act(world, "take", { item: "cloth" });
    }
  }
  if (
    (world.actors.vale.place === "pond" && target === HARBOR) ||
    (world.actors.vale.place === HARBOR && target === "pond")
  ) {
    // Story fixtures keep the already signaled vessel at the departure shore.
    // The ship suites cover independent resident voyages and return timing.
    summonTransport(world, "greek-ship", world.actors.vale.place);
    for (
      let turn = 0;
      turn < 8 &&
      !legalActions(world).some(
        (a) => a.kind === "move" && a.target === "greek-ship",
      );
      turn++
    )
      world = act(world, "wait");
    world = act(world, "move", { target: "greek-ship" });
  }
  expect(exits(world, world.actors.vale.place, "vale")).toContain(target);
  expect(availableCards(world)).toContain(target);
  const action = cardPlay(world, [target]).action;
  expect(action).toMatchObject({ kind: "move", target });
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.state.actors.vale.place).toBe(target);
  world = result.state;
  if (nested && world.items.cloth.holder !== "bell")
    world = act(world, "cover", { item: "cloth", target: "bell" });
  if (boarding) {
    if (world.items.lamp.lit) world = act(world, "snuff", { item: "lamp" });
    // Reserve capacity for funeral supplies. Later voyages keep the first
    // signal; the nested-custody case keeps its pair.
    if (!nested && world.items.cloth.holder === "vale")
      world = act(world, "drop", { item: "cloth", target: HARBOR });
  }
  return world;
}

const walk = (world, ...route) => route.reduce(move, world);
const take = (world, item) => act(world, "take", { item });

function choose(world, choiceId) {
  const action = legalActions(world).find((a) => a.choiceId === choiceId);
  expect(action, `choice ${choiceId}`).toBeTruthy();
  expect(cardChoices(world, action.cards[0]).map((a) => a.choiceId)).toContain(
    choiceId,
  );
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

function pond(scope = "full") {
  let world = enableMotives(
    createWorld({ opening: true, packScopes: { "greek-drama": scope } }),
    {
      questPrograms: true,
      personalQuests: true,
    },
  );
  world = act(world, "light");
  world.items.cloth.holder = "vale";
  world.items.oil.holder = HARBOR;
  world.items.lamp.fuel = 12;
  return world;
}

const harbor = (scope) => move(pond(scope), HARBOR);
const courtyard = (scope) => move(harbor(scope), COURTYARD);
const reload = (world) => decodeSave(encodeSave(world));

describe("the Wine-Dark Sea crossing", () => {
  it("travels through the pond without replacing the avatar, belongings or witnessed history", () => {
    let world = pond();
    // A nested belonging tests actual custody rather than a copied inventory.
    world.items.bell.holder = "vale";
    world.items.cloth.holder = "bell";
    world.items.lamp.fuel = 12;
    world.actors.vale.trust.moth = 2;
    addLog(
      world,
      "Pip",
      "Pip gives Vale the cloth to keep safe on the journey.",
      {
        kind: "action",
        verb: "give",
        actorId: "moth",
        targetId: "vale",
        itemId: "cloth",
        locationId: "pond",
        witnesses: ["vale"],
      },
    );
    const remembered = structuredClone(world.memories.vale.landmarks.at(-1));
    const actorIds = Object.keys(world.actors);
    const itemIds = Object.keys(world.items);
    const originalLevel = levelOf(world, "vale");
    const originalLife = structuredClone(world.life.actors.vale);

    world = walk(world, HARBOR, COURTYARD);
    expect(rootHolder(world, "lamp")).toBe("vale");
    expect(rootHolder(world, "cloth")).toBe("vale");
    expect(world.items.cloth.holder).toBe("bell");
    expect(itemPlace(world, "cloth")).toBe(COURTYARD);
    world = reload(world);
    world = walk(world, HARBOR, "pond");
    world = reload(world);

    expect(Object.keys(world.actors)).toEqual(actorIds);
    expect(Object.keys(world.items)).toEqual(itemIds);
    expect(world.actors.vale.place).toBe("pond");
    expect(world.actors.vale.trust.moth).toBe(2);
    expect(levelOf(world, "vale")).toBeGreaterThanOrEqual(originalLevel);
    expect(
      world.life.actors.vale.milestones.slice(
        0,
        originalLife.milestones.length,
      ),
    ).toEqual(originalLife.milestones);
    expect(world.memories.vale.landmarks).toContainEqual(remembered);
    expect(world.memories.moth.landmarks).toContainEqual(remembered);
    expect(rootHolder(world, "lamp")).toBe("vale");
    expect(world.items.cloth.holder).toBe("bell");
    expect(world.transports["greek-ship"]).toMatchObject({
      dock: "pond",
      destination: null,
    });
  });

  it("adds the pack once to an earlier shore save without overwriting its progress", () => {
    const old = pond();
    delete old.packs[PACK];
    delete old.crossings["pond-greek-harbor"];
    delete old.crossings["greek-harbor-pond"];
    old.items.oil.holder = "keeper";
    for (const collection of [
      old.actors,
      old.items,
      old.memories,
      old.peaceUntil,
    ])
      for (const id of Object.keys(collection))
        if (id.startsWith("greek-")) delete collection[id];
    for (const actor of Object.values(old.actors))
      for (const id of Object.keys(actor.trust))
        if (id.startsWith("greek-")) delete actor.trust[id];
    if (old.opening)
      for (const id of Object.keys(old.opening.met))
        if (id.startsWith("greek-")) delete old.opening.met[id];
    if (old.motives)
      for (const id of Object.keys(old.motives.grievances))
        if (id.startsWith("greek-")) delete old.motives.grievances[id];
    if (old.life)
      for (const id of Object.keys(old.life.actors))
        if (id.startsWith("greek-")) delete old.life.actors[id];

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated.schema).toBe(7);
    expect(migrated.log).toEqual(old.log);
    expect(migrated.turn).toBe(old.turn);
    expect(migrated.revision).toBe(old.revision);
    for (const [id, item] of Object.entries(old.items))
      expect(migrated.items[id]).toEqual(item);
    for (const [id, actor] of Object.entries(old.actors))
      expect(migrated.actors[id]).toMatchObject(actor);
    for (const [id, memory] of Object.entries(old.memories))
      expect(migrated.memories[id]).toEqual(memory);
    expect(reload(migrated)).toEqual(migrated);
    expect(move(migrated, HARBOR).actors.vale.place).toBe(HARBOR);

    const incomplete = structuredClone(migrated);
    delete incomplete.actors["greek-antigone"];
    expect(() => decodeSave(JSON.stringify(incomplete))).toThrow();
    for (const removeOriginalState of [
      (world) => delete world.memories.vale,
      (world) => delete world.actors.vale.trust.moth,
      (world) => delete world.motives.grievances.moth,
    ]) {
      const corrupt = structuredClone(old);
      removeOriginalState(corrupt);
      expect(() => decodeSave(JSON.stringify(corrupt))).toThrow();
    }
  });

  it("keeps remote actions and unchosen Greek residents out of the shore scene", () => {
    const shore = pond();
    const elsewhere = walk(harbor(), COURTYARD, GATE);
    const remote = legalActions(elsewhere).find(
      (a) => a.choiceId === "greek-hear-decree",
    );
    expect(remote).toBeTruthy();
    const before = encodeSave(shore);
    const rejected = play(shore, remote, shore.revision);
    expect(rejected).toMatchObject({ ok: false, state: shore });
    expect(encodeSave(shore)).toBe(before);
    const context = narrativeContext(shore);
    expect(
      context.speakers.every(
        (id) => !id.startsWith("greek-") || id === "greek-rhapsode",
      ),
    ).toBe(true);
    expect(context.entities.some((e) => e.id === "greek-antigone")).toBe(false);
    expect(availableCards(shore)).not.toContain("greek-antigone");
  });
});

describe("Greek story quest cards", () => {
  it("introduces each request through its people and keeps learned history beside a bounded hand", () => {
    const shore = pond("opening");
    expect(storyQuests(shore)).toEqual([]);
    const landing = harbor("opening");
    expect(storyQuests(landing)).toEqual([]);
    let world = move(landing, COURTYARD);
    expect(story(world, 0)).toMatchObject({
      title: "A place beside the bread.",
      resolved: false,
    });
    expect(story(world, 1)).toBeUndefined();
    world = move(world, GATE);
    expect(story(world, 1)).toMatchObject({
      title: "Her brother waits for earth.",
      resolved: false,
    });
    expect(story(world, 2)).toBeUndefined();
    // Learned requests keep their records while two cards fit in the hand.
    ensureCollectedQuest(world, "vale", places, things);
    const pending = collectionCards(world, "vale").find(
      (q) => q.completedTurn === null,
    );
    expect(pursueQuest(world, "vale", pending.key)).toBe(true);
    const before = encodeSave(world);
    const carried = questCards(world);
    expect(carried).toHaveLength(2);
    expect(carried.some((q) => q.key === pending.key)).toBe(true);
    expect(questHand(world)).toEqual(
      expect.arrayContaining(carried.map((q) => questCardId(world, q))),
    );
    expect(questHistoryCards(world).map((q) => q.id)).toEqual(
      expect.arrayContaining([STORY_QUEST_CARDS[0], STORY_QUEST_CARDS[1]]),
    );
    expect(encodeSave(world)).toBe(before);
    expect(storyQuests(reload(world))).toEqual(storyQuests(world));
    expect(stateOf(world).scope).toBe("opening");
    expect(exits(world, HARBOR, "vale")).not.toContain("greek-argolid-road");
  });

  it("finishes the water card through the return action and keeps it finished after reload", () => {
    let world = courtyard("opening");
    const original = story(world, 0);
    world = take(move(world, WELL), "greek-water-jar");
    expect(story(world, 0)).toEqual(original);
    world = move(world, COURTYARD);
    const before = world;
    world = choose(world, "greek-return-water-jar");
    expect(fulfilledQuests(before, world)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: STORY_QUEST_CARDS[0],
          completion: "Fulfilled",
        }),
      ]),
    );
    expect(
      questHistoryCards(world).find((q) => q.key === original.key),
    ).toMatchObject({ status: "fulfilled" });
    expect(questCards(world).length).toBeLessThanOrEqual(2);
    expect(story(reload(world), 0)).toMatchObject({
      key: original.key,
      resolved: true,
    });
    expect(fulfilledQuests(world, reload(world))).toEqual([]);
  });

  it.each([
    ["greek-decline-burial", "refusal", "Declined"],
    ["greek-report-plan", "exposure", "Reported"],
  ])(
    "closes %s with its own outcome and introduces the return to Dione",
    (choice, outcome, completion) => {
      const before = choose(
        move(courtyard("opening"), GATE),
        "greek-hear-decree",
      );
      let world = choose(before, choice);
      expect(fulfilledQuests(before, world)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: STORY_QUEST_CARDS[1], completion }),
        ]),
      );
      expect(story(world, 2)).toMatchObject({
        title: "What words will you bring home?",
        resolved: false,
      });
      expect(story(world, 1).purpose).not.toMatch(/rests beneath/);
      world = move(world, COURTYARD);
      const returning = world;
      world = choose(world, `greek-courtyard-${outcome}`);
      expect(fulfilledQuests(returning, world)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: STORY_QUEST_CARDS[2],
            completion: "Shared",
          }),
        ]),
      );
      expect(
        questHistoryCards(reload(world)).find(
          (q) => q.id === STORY_QUEST_CARDS[2],
        ),
      ).toMatchObject({ status: "fulfilled", completion: "Shared" });
      expect(questCards(reload(world)).length).toBeLessThanOrEqual(2);
      expect(fulfilledQuests(world, act(world, "wait"))).toEqual([]);
    },
  );

  it("keeps a learned request through a trip home and the rest between personal quests", () => {
    let world = move(courtyard("opening"), GATE);
    const original = story(world, 1);
    world = walk(world, COURTYARD, HARBOR, "pond");
    expect(() => encodeSave(world)).not.toThrow();
    // Companions can advance a hand on the shared crossing. Stage the resting
    // boundary with its required zero step before checking the learned story.
    world.life.actors.vale.phase = "seeking";
    delete world.life.actors.vale.restAt;
    delete world.life.actors.vale.origin;
    world.life.actors.vale.restLeft = 0;
    world.life.actors.vale.collection.active = null;
    delete world.actors.vale.progress.current;
    world.actors.vale.progress.step = 0;
    expect(story(world, 1)).toEqual(original);
    expect(
      questHistoryCards(world).find((q) => q.key === original.key),
    ).toEqual(original);
    expect(questCards(world).length).toBeLessThanOrEqual(2);
    expect(storyQuests(reload(world))).toEqual(storyQuests(world));
  });
});

describe("Before the Burial", () => {
  it("makes the ordinary water errand change custody and access to bread", () => {
    let world = courtyard();
    expect(availableCards(world)).not.toContain("greek-bread");
    world = take(move(world, WELL), "greek-water-jar");
    world = choose(move(world, COURTYARD), "greek-return-water-jar");
    // Custody leaves Vale and stays with the receiving household at this place.
    expect([COURTYARD, "greek-baker"]).toContain(
      world.items["greek-water-jar"].holder,
    );
    expect(itemPlace(world, "greek-water-jar")).toBe(COURTYARD);
    expect(stateOf(world).flags["greek-water-returned"]).toBe(true);
    expect(availableCards(world)).toContain("greek-bread");
    expect(reload(world)).toEqual(world);
    expect(
      legalActions(world).some((a) => a.choiceId === "greek-return-water-jar"),
    ).toBe(false);
  });

  it("requires grave preparation and real funeral materials, then retains the burial", () => {
    let world = courtyard();
    world = take(world, "greek-oil-flask");
    world = take(move(world, SANCTUARY), "greek-funeral-cloth");
    world = walk(world, COURTYARD, GATE);
    world = choose(world, "greek-hear-decree");
    // Stage the two offerings before collecting the shovel; no invented stock.
    world = move(world, BATTLEFIELD);
    expect(
      legalActions(world).some((a) => a.choiceId === "greek-perform-burial"),
    ).toBe(false);
    world = act(world, "drop", {
      item: "greek-oil-flask",
      target: BATTLEFIELD,
    });
    world = take(move(world, GATE), "greek-shovel");
    world = choose(move(world, BATTLEFIELD), "greek-prepare-burial-ground");
    expect(world.items["greek-shovel"].holder).toBe(BATTLEFIELD);
    world = take(world, "greek-oil-flask");
    const action = legalActions(world).find(
      (a) => a.choiceId === "greek-perform-burial",
    );
    expect(action).toBeTruthy();
    const beforeBurial = world;
    world = choose(world, "greek-perform-burial");
    expect(fulfilledQuests(beforeBurial, world)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: STORY_QUEST_CARDS[1],
          completion: "Fulfilled",
        }),
      ]),
    );
    expect(story(world, 2)?.resolved).toBe(false);
    expect(stateOf(world).choices["greek-theban-response"]).toBe("burial");
    expect(desireFor(world, "greek-antigone").items).toEqual([]);
    for (const item of ["greek-oil-flask", "greek-funeral-cloth"])
      expect(world.items[item].holder).toBe(BATTLEFIELD);
    const receipt = stateOf(world).receipts["greek-perform-burial"];
    world = reload(world);
    const before = encodeSave(world);
    expect(play(world, action, world.revision)).toMatchObject({
      ok: false,
      state: world,
    });
    expect(encodeSave(world)).toBe(before);
    world = walk(
      world,
      GATE,
      COURTYARD,
      HARBOR,
      "pond",
      HARBOR,
      COURTYARD,
      GATE,
      BATTLEFIELD,
    );
    expect(stateOf(world).choices["greek-theban-response"]).toBe("burial");
    expect(stateOf(world).receipts["greek-perform-burial"]).toBe(receipt);
    expect(world.items["greek-shovel"].holder).toBe(BATTLEFIELD);
    world = walk(world, GATE, COURTYARD);
    const beforeSharing = world;
    world = choose(world, "greek-courtyard-burial");
    expect(fulfilledQuests(beforeSharing, world)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: STORY_QUEST_CARDS[2],
          completion: "Shared",
        }),
      ]),
    );
    expect(story(reload(world), 2)?.resolved).toBe(true);
  });

  it("allows a witnessed petition to produce a different public outcome", () => {
    let world = courtyard();
    world = take(move(world, SANCTUARY), "greek-household-token");
    world = choose(walk(world, COURTYARD, GATE), "greek-hear-decree");
    world = choose(move(world, WELL), "greek-gather-witness");
    world = take(move(world, PALACE), "greek-decree");
    const beforePetition = world;
    world = choose(world, "greek-petition-burial");
    expect(
      fulfilledQuests(beforePetition, world).some(
        (q) => q.id === STORY_QUEST_CARDS[1],
      ),
    ).toBe(false);
    expect(story(world, 1)).toMatchObject({
      key: story(beforePetition, 1).key,
      resolved: false,
    });
    expect(story(world, 1).purpose).toContain("waits for earth");
    expect(story(world, 2)?.resolved).toBe(false);
    expect(stateOf(world).choices["greek-theban-response"]).toBe("concession");
    expect(stateOf(world).receipts["greek-perform-burial"]).toBeUndefined();
    expect(reload(world)).toEqual(world);
    world = walk(world, WELL, COURTYARD, HARBOR, "pond");
    expect(stateOf(world).choices["greek-theban-response"]).toBe("concession");
    world = walk(world, HARBOR, COURTYARD);
    const beforeSharing = world;
    world = choose(world, "greek-courtyard-concession");
    expect(fulfilledQuests(beforeSharing, world)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: STORY_QUEST_CARDS[2],
          completion: "Shared",
        }),
      ]),
    );
    expect(story(world, 1)?.resolved).toBe(false);
    world = walk(world, HARBOR, "pond");
    // Permission must change what can actually be done on the next visit.
    world = take(walk(world, HARBOR, COURTYARD, GATE), "greek-shovel");
    world = choose(move(world, BATTLEFIELD), "greek-prepare-permitted-burial");
    world = take(walk(world, GATE, COURTYARD), "greek-oil-flask");
    world = move(world, SANCTUARY);
    world = act(world, "drop", {
      item: "greek-household-token",
      target: SANCTUARY,
    });
    world = take(world, "greek-funeral-cloth");
    world = walk(world, COURTYARD, GATE, BATTLEFIELD);
    const beforeRite = world;
    world = choose(world, "greek-perform-permitted-burial");
    expect(fulfilledQuests(beforeRite, world)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: STORY_QUEST_CARDS[1],
          completion: "Fulfilled",
        }),
      ]),
    );
    expect(story(world, 1).purpose).toBe("Her brother waits for earth.");
    expect(stateOf(world).flags["greek-burial-performed"]).toBe(true);
    expect(stateOf(world).choices["greek-theban-response"]).toBe("concession");
    expect(stateOf(world).receipts["greek-perform-burial"]).toBeUndefined();
    const rite = world.log.find(
      (event) => event.choiceId === "greek-perform-permitted-burial",
    );
    // The rite leaves its materials at the grave before the cast takes its turn.
    expect(rite.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "greek-funeral-cloth",
          holder: BATTLEFIELD,
        }),
        expect.objectContaining({
          id: "greek-oil-flask",
          holder: BATTLEFIELD,
        }),
      ]),
    );
    expect(reload(world)).toEqual(world);
  });

  it.each([
    ["greek-decline-burial", "refusal"],
    ["greek-report-plan", "exposure"],
  ])("keeps %s consequential and leaves a way home", (choiceId, outcome) => {
    let world = choose(move(courtyard(), GATE), "greek-hear-decree");
    const alternatives = legalActions(world).filter((a) =>
      ["greek-decline-burial", "greek-report-plan"].includes(a.choiceId),
    );
    world = choose(world, choiceId);
    expect(stateOf(world).choices["greek-theban-response"]).toBe(outcome);
    expect(desireFor(world, "greek-antigone").items).toEqual([]);
    for (const action of alternatives)
      expect(play(world, action, world.revision).ok).toBe(false);
    world = walk(reload(world), COURTYARD, HARBOR, "pond");
    expect(stateOf(world).choices["greek-theban-response"]).toBe(outcome);
    expect(legalActions(world).length).toBeGreaterThan(0);
  });

  it("does not let generated declarations perform a burial or consume another turn", () => {
    const world = choose(move(courtyard(), GATE), "greek-hear-decree");
    const context = narrativeContext(world);
    const response = {
      revision: context.revision,
      model: "test-only",
      entries: context.entities.map(({ id }) => ({
        id,
        text: "The burial is complete and the decree has been withdrawn.",
      })),
    };
    const written = applyGeneratedText(world, context, response);
    expect(written).toBeTruthy();
    expect(written.packs).toEqual(world.packs);
    expect(written.items).toEqual(world.items);
    expect(written.actors).toEqual(world.actors);
    expect(written.turn).toBe(world.turn);
    expect(written.revision).toBe(world.revision);
    expect(applyGeneratedText(written, context, response).packs).toEqual(
      world.packs,
    );
  });
});

describe("incompatible histories become playable branches", () => {
  it.each([
    [
      "a player in an unchosen branch",
      (world) => {
        world.actors.vale.place = "greek-egypt-tomb";
      },
    ],
    [
      "evidence stolen from an inactive account",
      (world) => {
        world.items["greek-egypt-testimony"].holder = "vale";
      },
    ],
    [
      "a meeting with an inactive Helen",
      (world) => {
        stateOf(world).met["greek-helen-egypt"] = world.turn;
      },
    ],
    [
      "a burial receipt without the decree or prepared grave",
      (world) => {
        const state = stateOf(world);
        state.receipts["greek-perform-burial"] = world.turn;
        state.choices["greek-theban-response"] = "burial";
        state.flags["greek-burial-performed"] = true;
        world.items["greek-funeral-cloth"].holder = BATTLEFIELD;
        world.items["greek-oil-flask"].holder = BATTLEFIELD;
      },
    ],
  ])("rejects a save that invents %s", (_label, corrupt) => {
    const world = harbor();
    corrupt(world);
    expect(() => decodeSave(JSON.stringify(world))).toThrow();
  });

  it.each([
    [
      "egypt",
      "greek-egypt-tomb",
      "greek-egypt-testimony",
      "troy",
      "greek-troy-beach",
    ],
    [
      "troy",
      "greek-troy-beach",
      "greek-troy-testimony",
      "egypt",
      "greek-egypt-tomb",
    ],
  ])(
    "retains the %s Helen branch, its witness and physical evidence",
    (branch, destination, evidence, other, otherDestination) => {
      let world = harbor();
      const alternative = legalActions(world).find(
        (a) => a.choiceId === `greek-helen-${other}`,
      );
      expect(alternative).toBeTruthy();
      world = choose(world, `greek-helen-${branch}`);
      expect(exits(world, HARBOR, "vale")).toContain(destination);
      expect(exits(world, HARBOR, "vale")).not.toContain(otherDestination);
      expect(play(world, alternative, world.revision).ok).toBe(false);
      world = move(world, destination);
      expect(knownActors(world)).toContain(`greek-helen-${branch}`);
      expect(knownActors(world)).not.toContain(`greek-helen-${other}`);
      expect(narrativeContext(world).speakers).not.toContain(
        `greek-helen-${other}`,
      );
      world = choose(world, `greek-hear-helen-${branch}`);
      world = take(world, evidence);
      world = walk(reload(world), HARBOR, "pond", HARBOR);
      expect(stateOf(world).choices["greek-helen-account"]).toBe(branch);
      expect(rootHolder(world, evidence)).toBe("vale");
      expect(exits(world, HARBOR, "vale")).not.toContain(otherDestination);
      expect(play(world, alternative, world.revision).ok).toBe(false);
      expect(reload(world)).toEqual(world);

      const forged = structuredClone(world);
      stateOf(forged).choices["greek-helen-account"] = other;
      expect(() => decodeSave(JSON.stringify(forged))).toThrow();

      const response = branch === "egypt" ? "passage" : "shelter";
      if (response === "passage") world = take(world, "greek-provisions");
      world = move(world, destination);
      world = choose(world, `greek-helen-${branch}-${response}`);
      expect(stateOf(world).choices["greek-helen-response"]).toBe(response);
      expect(world.items[evidence].holder).toBe(destination);
      if (response === "passage")
        expect(world.items["greek-provisions"].holder).toBe(destination);
      world = walk(reload(world), HARBOR, "pond", HARBOR, destination);
      expect(stateOf(world).choices["greek-helen-response"]).toBe(response);
      expect(world.items[evidence].holder).toBe(destination);
      expect(
        legalActions(world).some(
          (a) => a.choiceId === `greek-helen-${branch}-${response}`,
        ),
      ).toBe(false);
    },
  );

  it.each([
    ["aeschylus", "greek-argos-tomb", "greek-tomb-testimony", "hearing"],
    ["sophocles", "greek-mycenae-palace", "greek-palace-testimony", "hearing"],
    ["euripides", "greek-argive-farm", "greek-farm-testimony", "refusal"],
  ])(
    "offers a separate %s Atreid history without opening the other two",
    (branch, destination, evidence, response) => {
      let world = move(harbor(), "greek-argolid-road");
      // This branch fixture begins with the bard at the meeting site.
      world.actors["greek-rhapsode"].place = "greek-argolid-road";
      const options = legalActions(world).filter((a) =>
        a.choiceId?.startsWith("greek-atreid-"),
      );
      expect(options).toHaveLength(3);
      world = choose(world, `greek-atreid-${branch}`);
      const routes = [
        "greek-argos-tomb",
        "greek-mycenae-palace",
        "greek-argive-farm",
      ];
      expect(
        exits(world, "greek-argolid-road", "vale").filter((id) =>
          routes.includes(id),
        ),
      ).toEqual([destination]);
      world = move(world, destination);
      world = choose(world, `greek-hear-electra-${branch}`);
      world = take(world, evidence);
      world = walk(
        reload(world),
        "greek-argolid-road",
        HARBOR,
        "pond",
        HARBOR,
        "greek-argolid-road",
      );
      expect(stateOf(world).choices["greek-atreid-account"]).toBe(branch);
      expect(rootHolder(world, evidence)).toBe("vale");
      for (const option of options)
        expect(play(world, option, world.revision).ok).toBe(false);
      world = choose(
        move(world, destination),
        `greek-atreid-${branch}-${response}`,
      );
      expect(stateOf(world).choices["greek-atreid-response"]).toBe(response);
      expect(world.items[evidence].holder).toBe(destination);
      expect(reload(world)).toEqual(world);
    },
  );
});

it("evaluates branch, witness and custody conditions with unrelated pack and entity names", () => {
  for (const prefix of ["island", "mountain"]) {
    const pack = `${prefix}-accord`;
    const actor = `${prefix}-traveller`;
    const witness = `${prefix}-witness`;
    const token = `${prefix}-token`;
    const group = `${prefix}-history`;
    const world = {
      packs: {
        [pack]: {
          choices: { [group]: "harbor" },
          flags: { [`${prefix}-heard`]: true },
          met: { [witness]: 4 },
        },
      },
      items: { [token]: { holder: actor } },
    };
    const conditions = [
      { kind: "choice", key: group, value: "harbor" },
      { kind: "choice_unset", key: `${prefix}-response` },
      { kind: "flag", key: `${prefix}-heard`, value: true },
      { kind: "met", actor: witness },
      { kind: "holding", item: token, actor },
    ];
    expect(conditionsMet(world, pack, conditions)).toBe(true);
    world.items[token].holder = `${prefix}-quay`;
    expect(conditionsMet(world, pack, conditions)).toBe(false);
    expect(
      conditionsMet(world, pack, [
        { kind: "item_at", item: token, place: `${prefix}-quay` },
      ]),
    ).toBe(true);
    expect(
      conditionsMet(world, pack, [
        { kind: "choice", key: group, value: "palace" },
      ]),
    ).toBe(false);
  }
});
