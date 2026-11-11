import { selectLamp } from "./fixtures/card-attic-opening.mjs";
import { fillLampFuel } from "../v2/card-game/lamp-state.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { summonTransport } from "../v2/card-game/pack-transport.mjs";
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
} from "../v2/card-game/world.mjs";
import {
  availableCards,
  cardChoices,
  cardPlay,
} from "../v2/card-game/cards.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { knownActors, levelOf } from "../v2/card-game/want.mjs";
import {
  applyGeneratedText,
  narrativeContext,
} from "../v2/card-game/narrative.mjs";
import {
  conditionsMet,
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";

import { endStandoff } from "./helpers/standoff.mjs";
import { SAVE_SCHEMA } from "../v2/card-game/legacy-saves.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";
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
  world = endStandoff(world);
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
    world = selectLamp(world, "cloth");
    // Ship discovery is the setup here, not Pip's competing lamp quest.
    world.actors.moth.want = null;
    world.actors.moth.metTurn = world.turn;
    world = act(world, "drop", { item: "lamp", target: "pond" });
    expect(world.crossings["pond-greek-harbor"].discovered).toBe(true);
    // Discovery persists; take the lamp along as a stowed belonging.
    world = act(world, "take", { item: "lamp" });
    world = selectLamp(world);
  }
  if (
    (world.actors.vale.place === "pond" && target === HARBOR) ||
    (world.actors.vale.place === HARBOR && target === "pond")
  ) {
    // Story fixtures keep the already signaled vessel at the departure shore.
    // The ship suites cover independent resident voyages and return timing.
    // A roaming bard may have sailed it away; call it again each round.
    for (
      let turn = 0;
      turn < 8 &&
      !legalActions(world).some(
        (a) => a.kind === "move" && a.target === "greek-ship",
      );
      turn++
    ) {
      if (world.transports["greek-ship"].dock !== world.actors.vale.place)
        summonTransport(world, "greek-ship", world.actors.vale.place);
      if (
        !legalActions(world).some(
          (a) => a.kind === "move" && a.target === "greek-ship",
        )
      )
        world = act(world, "wait");
    }
    world = act(world, "move", { target: "greek-ship" });
    // The destination card sets the course; the voyage takes a round at sea.
    const course = cardPlay(world, [target]).action;
    expect(course).toMatchObject({ kind: "course", target });
    world = play(world, course).state;
    for (
      let turn = 0;
      turn < 4 && !exits(world, "greek-ship", "vale").includes(target);
      turn++
    )
      world = act(world, "wait");
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
    world = selectLamp(world);
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
  const choice = packDefinition(PACK).choices.find((c) => c.id === choiceId);
  if (["give", "talk"].includes(choice?.on)) {
    const { subject: target } = choice;
    const kind = choice.on;
    const item = choice.requires.find((r) => r.kind === "holding")?.item;
    const cards = item ? [item, target] : [target];
    expect(cardPlay(world, cards).action).toMatchObject({ kind, target });
    expect(cardChoices(world, target).map((a) => a.choiceId)).not.toContain(
      choiceId,
    );
    world = act(world, kind, item ? { item, target } : { target });
    expect(stateOf(world).receipts[choiceId]).toBe(world.turn);
    return world;
  }
  const action = legalActions(world).find((a) => a.choiceId === choiceId);
  expect(action, `choice ${choiceId}`).toBeTruthy();
  const topic = packDefinition(PACK).topics?.find(
    (topic) => topic.choiceId === choiceId,
  );
  const choices = cardChoices(world, action.cards[0]).map((a) => a.choiceId);
  if (topic) {
    expect(choices).not.toContain(choiceId);
    expect(
      legalActions(world).some(
        (a) => a.kind === "talk" && a.target === topic.speaker,
      ),
    ).toBe(true);
  } else expect(choices).toContain(choiceId);
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

function pond(scope = "full") {
  let world = enableMotives(
    createWorld({ opening: true, packScopes: { "greek-drama": scope } }),
  );
  world = selectLamp(world);
  world = act(world, "move", { target: "pond" });
  world.items.cloth.holder = "vale";
  world.items.oil.holder = HARBOR;
  fillLampFuel(world);
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
    fillLampFuel(world);
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
    expect(world.memories.vale.landmarks).toContainEqual(remembered);
    expect(world.memories.moth.landmarks).toContainEqual(remembered);
    expect(rootHolder(world, "lamp")).toBe("vale");
    expect(world.items.cloth.holder).toBe("bell");
    // Everyone is ashore. The fixture's harbor call, made while the Bard was
    // aboard, brings the empty ship back to the harbor.
    expect(world.transports["greek-ship"]).toMatchObject({
      phase: "docked",
      destination: null,
      riders: [],
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

    for (const actor of Object.values(old.actors)) delete actor.heldItem;
    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated.schema).toBe(SAVE_SCHEMA);
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
      (a) => a.kind === "take" && a.item === "greek-shovel",
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

// Give carries Thebes's errands and the reports kept in earlier saves.
const give = (world, item, target) => act(world, "give", { item, target });
const done = (world, id) => stateOf(world).receipts[`greek-${id}`];
const noButtons = (world) =>
  expect(legalActions(world).filter((a) => a.kind === "choose")).toEqual([]);

describe("Greek choices and their receipts", () => {
  it("finishes the water return by giving Dione the jar and keeps it after reload", () => {
    let world = courtyard("opening");
    world = take(move(world, WELL), "greek-water-jar");
    world = move(world, COURTYARD);
    noButtons(world);
    world = give(world, "greek-water-jar", "greek-baker");
    const receipt = done(world, "return-water-jar");
    expect(receipt).toBe(world.turn);
    expect(done(reload(world), "return-water-jar")).toBe(receipt);
    expect(world.quests).toBeUndefined();
    expect(stateOf(world).scope).toBe("opening");
    expect(exits(world, HARBOR, "vale")).not.toContain("greek-argolid-road");
  });
  it("keeps a saved completed burial complete when supplies reach the Hollow", () => {
    const world = funeralJourney().buried;
    const hollow = "greek-polynices-hollow";
    world.actors.vale.place = hollow;
    world.actors["greek-antigone"].place = hollow;
    for (const item of [
      "greek-oil-flask",
      "greek-funeral-cloth",
      "greek-shovel",
    ])
      world.items[item].holder = hollow;
    expect(stateOf(world).flags["greek-burial-performed"]).toBe(true);
    expect(
      legalActions(reload(world)).filter(
        (a) => a.choiceId === "greek-anoint-polynices",
      ),
    ).toEqual([]);
  });

  it("keeps the Hollow funeral's own receipt when its account reaches Dione", () => {
    const buried = funeralJourney().buried;
    let world = take(move(buried, BATTLEFIELD), "greek-burial-account");
    world = move(world, COURTYARD);
    const reports = [
      "burial",
      "permitted-burial",
      "concession",
      "exposure",
    ].map((id) => `greek-courtyard-${id}`);
    expect(
      cardChoices(world, "greek-baker").filter((a) =>
        reports.includes(a.choiceId),
      ),
    ).toEqual([]);
    world = give(world, "greek-burial-account", "greek-baker");
    expect(
      reports.filter((id) => stateOf(world).receipts[id] !== undefined),
    ).toEqual([]);
    expect(stateOf(world).choices["greek-theban-response"]).toBeUndefined();
    expect(done(world, "bury-polynices")).toBe(buried.turn);
    expect(stateOf(reload(world)).flags["greek-open-door-open"]).toBe(true);
  });
});

describe("Before the Burial", () => {
  it("makes the ordinary water errand change custody and access to bread", () => {
    let world = courtyard();
    // The bread waits at the courtyard used up, shown as the locked box,
    // until Dione has the jar and her wheat to bake it (rules 102).
    expect(world.usedUp).toContain("greek-bread");
    expect(cardPlay(world, ["greek-bread"]).action).toBeFalsy();
    world = take(move(world, WELL), "greek-water-jar");
    world = give(move(world, COURTYARD), "greek-water-jar", "greek-baker");
    // Custody leaves Vale: Dione bakes with the jar, which goes home to the
    // well, and the bread lies ready at the courtyard.
    expect(rootHolder(world, "greek-water-jar")).not.toBe("vale");
    expect(world.items["greek-water-jar"].holder).toBe(WELL);
    expect(stateOf(world).flags["greek-water-returned"]).toBe(true);
    expect(world.usedUp).not.toContain("greek-bread");
    expect(world.items["greek-bread"].holder).toBe(COURTYARD);
    expect(availableCards(world)).toContain("greek-bread");
    expect(cardPlay(world, ["greek-bread"]).action).toMatchObject({
      kind: "take",
      item: "greek-bread",
    });
    expect(reload(world)).toEqual(world);
  });

  it("reaches the palace forecourt through the Market Well", () => {
    const world = courtyard();
    // Greek revision 19 and later: courtyard, well, forecourt, sanctuary in
    // a line.
    expect(exits(world, COURTYARD, "vale")).toEqual(
      expect.arrayContaining([WELL, GATE]),
    );
    expect(exits(world, COURTYARD, "vale")).not.toContain(PALACE);
    expect(exits(world, WELL, "vale")).toEqual([COURTYARD, PALACE]);
    expect(exits(world, PALACE, "vale")).toEqual([WELL, SANCTUARY]);
    expect(availableCards(world)).not.toContain(PALACE);
    const there = walk(world, WELL, PALACE, SANCTUARY);
    expect(there.actors.vale.place).toBe(SANCTUARY);
  });


  it("carries the supplies to Antigone and opens the door through three Hollow rites", () => {
    const journey = funeralJourney(courtyard("opening"));
    const { supplied, beforeAnoint, anointed, veiled, buried } = journey;
    for (const item of [
      "greek-oil-flask",
      "greek-funeral-cloth",
      "greek-shovel",
    ])
      expect(supplied.items[item].holder).toBe("vale");
    expect(beforeAnoint.actors["greek-antigone"].place).toBe(
      "greek-polynices-hollow",
    );
    for (const world of [beforeAnoint, anointed, veiled]) {
      expect(legalActions(world).filter((a) => a.kind === "choose")).toEqual(
        [],
      );
      expect(stateOf(world).flags["greek-open-door-open"]).toBeUndefined();
      expect(entityActive(world, "greek-colonus")).toBe(false);
      expect(entityActive(world, "greek-eleusis")).toBe(false);
    }
    expect([anointed.turn, veiled.turn, buried.turn]).toEqual([
      beforeAnoint.turn + 1,
      beforeAnoint.turn + 2,
      beforeAnoint.turn + 3,
    ]);
    expect(anointed.items["greek-oil-flask"].holder).toBe("greek-colonus");
    expect(veiled.items["greek-funeral-cloth"].holder).toBe("greek-eleusis");
    expect(entityActive(buried, "greek-colonus")).toBe(true);
    expect(entityActive(buried, "greek-eleusis")).toBe(true);
    const clothAgain = take(
      move(buried, "greek-eleusis"),
      "greek-funeral-cloth",
    );
    const oilAgain = take(move(clothAgain, "greek-colonus"), "greek-oil-flask");
    expect(oilAgain.items["greek-oil-flask"].holder).toBe("vale");
    expect(oilAgain.items["greek-funeral-cloth"].holder).toBe("vale");
    expect(buried.items["greek-shovel"].holder).toBe("greek-polynices-hollow");
    expect(stateOf(buried).flags).toMatchObject({
      "greek-burial-performed": true,
      "greek-open-door-open": true,
    });
    expect(done(buried, "bury-polynices")).toBe(buried.turn);
    expect(reload(buried)).toEqual(buried);
  });

  it("earns the guard's passage through Dione's bread and Creon's writ", () => {
    const { supplied } = funeralJourney(courtyard("opening"));
    expect(supplied.items["greek-decree"].holder).toBe("greek-creon");
    expect(supplied.items["greek-creon-writ"].holder).toBe("greek-guard");
    expect(exits(supplied, GATE, "vale")).toContain(BATTLEFIELD);
    expect(done(supplied, "return-water-jar")).toBeTruthy();
    expect(stateOf(supplied).choices["greek-theban-response"]).toBeUndefined();
    expect(stateOf(supplied).flags["greek-open-door-open"]).toBeUndefined();
  });





  it("does not let generated declarations perform a burial or consume another turn", () => {
    const world = move(courtyard(), GATE);
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
      const tablet = "greek-helen-accounts";
      let world = take(harbor(), tablet);
      const choice = packDefinition(PACK).choices.find(
        (c) => c.id === `greek-helen-${branch}`,
      );
      if (choice.at !== HARBOR) world = move(world, choice.at);
      world = choose(world, choice.id);
      expect(world.items[tablet].holder).toBe(choice.at);
      if (choice.at !== HARBOR) world = move(world, HARBOR);
      expect(exits(world, HARBOR, "vale")).toContain(destination);
      expect(exits(world, HARBOR, "vale")).not.toContain(otherDestination);
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
      expect(reload(world)).toEqual(world);

      const forged = structuredClone(world);
      stateOf(forged).choices["greek-helen-account"] = other;
      expect(() => decodeSave(JSON.stringify(forged))).toThrow();

      const response = branch === "egypt" ? "passage" : "shelter";
      // Myrto has packed a load; the passage uses it up (rules 95).
      if (response === "passage")
        world = take(stowProvisions(world, HARBOR), "greek-provisions");
      world = move(world, destination);
      world = choose(world, `greek-helen-${branch}-${response}`);
      expect(stateOf(world).choices["greek-helen-response"]).toBe(response);
      expect(world.items[evidence].holder).toBe(destination);
      if (response === "passage")
        expect(world.usedUp).toContain("greek-provisions");
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
      const choice = packDefinition(PACK).choices.find(
        (c) => c.id === `greek-atreid-${branch}`,
      );
      const record = "greek-atreid-record";
      let world = take(move(harbor(), "greek-argolid-road"), record);
      world = choose(move(world, choice.at), choice.id);
      expect(world.items[record].holder).toBe(choice.at);
      world = move(world, "greek-argolid-road");
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
