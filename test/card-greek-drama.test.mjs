import { readFileSync } from "node:fs";
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
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";

import { endStandoff } from "./helpers/standoff.mjs";
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
    if (!world.items.lamp.lit) world = act(world, "light", { item: "lamp" });
    // Cover, then uncover, the lit lamp: the whole ship signal.
    world = act(world, "cover", { item: "cloth", target: "lamp" });
    world = act(world, "take", { item: "cloth" });
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
  world = act(world, "snuff");
  world = act(world, "move", { target: "pond" });
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

// Thebes has no story buttons: its deeds are Give, Wait and meetings.
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

  it("reports the plan by handing the guard the shovel and carries his tablet to Dione", () => {
    let world = move(courtyard("opening"), GATE);
    expect(done(world, "hear-decree")).toBeTruthy();
    noButtons(world);
    world = give(take(world, "greek-shovel"), "greek-shovel", "greek-guard");
    expect(stateOf(world).choices["greek-theban-response"]).toBe("exposure");
    expect(world.items["greek-shovel"].holder).toBe(GATE);
    world = move(take(world, "greek-guard-tablet"), COURTYARD);
    world = give(world, "greek-guard-tablet", "greek-baker");
    expect(done(reload(world), "courtyard-exposure")).toBe(world.turn);
    expect(stateOf(world).flags["greek-open-door-open"]).toBe(true);
    expect(itemPlace(world, "greek-guard-tablet")).toBe(COURTYARD);
  });
});

describe("Before the Burial", () => {
  it("makes the ordinary water errand change custody and access to bread", () => {
    let world = courtyard();
    expect(availableCards(world)).not.toContain("greek-bread");
    world = take(move(world, WELL), "greek-water-jar");
    world = give(move(world, COURTYARD), "greek-water-jar", "greek-baker");
    // Custody leaves Vale and stays with the receiving household at this place.
    expect([COURTYARD, "greek-baker"]).toContain(
      world.items["greek-water-jar"].holder,
    );
    expect(itemPlace(world, "greek-water-jar")).toBe(COURTYARD);
    expect(stateOf(world).flags["greek-water-returned"]).toBe(true);
    expect(availableCards(world)).toContain("greek-bread");
    expect(reload(world)).toEqual(world);
  });

  it("links the Market Well only to the courtyard", () => {
    const world = courtyard();
    expect(exits(world, WELL, "vale")).toEqual([COURTYARD]);
    expect(exits(world, COURTYARD, "vale")).toEqual(
      expect.arrayContaining([WELL, PALACE, GATE]),
    );
    // The sanctuary lies beyond the palace: three links each.
    expect(exits(world, PALACE, "vale")).toEqual([COURTYARD, SANCTUARY]);
  });

  it("buries with a shovel, cloth and oil on the battlefield, then yields the account", () => {
    let world = courtyard();
    world = take(world, "greek-oil-flask");
    world = take(move(world, SANCTUARY), "greek-funeral-cloth");
    world = walk(world, COURTYARD, GATE);
    expect(done(world, "hear-decree")).toBeTruthy();
    // The road out is closed until the guard at the gate holds the decree.
    expect(exits(world, GATE, "vale")).not.toContain(BATTLEFIELD);
    world.items["greek-decree"].holder = "greek-guard";
    // Cloth and oil without a dug grave bury no one.
    world = act(move(reload(world), BATTLEFIELD), "wait");
    expect(done(world, "perform-burial")).toBeUndefined();
    world = act(world, "drop", {
      item: "greek-oil-flask",
      target: BATTLEFIELD,
    });
    world = take(move(world, GATE), "greek-shovel");
    world = act(move(world, BATTLEFIELD), "wait");
    expect(done(world, "prepare-burial-ground")).toBeTruthy();
    noButtons(world);
    expect(availableCards(world)).not.toContain("greek-burial-account");
    for (const item of ["greek-shovel", "greek-funeral-cloth"])
      world = act(world, "drop", { item, target: BATTLEFIELD });
    world = act(world, "wait");
    expect(stateOf(world).choices["greek-theban-response"]).toBe("burial");
    const receipt = done(world, "perform-burial");
    expect(receipt).toBeTruthy();
    expect(world.log.some((e) => e.text?.includes("is buried"))).toBe(true);
    world = take(reload(world), "greek-burial-account");
    world = walk(world, GATE, COURTYARD, HARBOR, "pond", HARBOR, COURTYARD);
    expect(done(world, "perform-burial")).toBe(receipt);
    world = give(world, "greek-burial-account", "greek-baker");
    expect(done(world, "courtyard-burial")).toBe(world.turn);
    expect(stateOf(world).flags["greek-open-door-open"]).toBe(true);
  });

  it("lets a witnessed petition yield Creon's writ and a permitted burial", () => {
    let world = courtyard();
    world = take(move(world, SANCTUARY), "greek-household-token");
    world = walk(world, COURTYARD, GATE);
    world = walk(world, COURTYARD, WELL);
    expect(done(world, "gather-witness")).toBeTruthy();
    world = take(walk(world, COURTYARD, PALACE), "greek-decree");
    world = give(world, "greek-decree", "greek-creon");
    expect(stateOf(world).choices["greek-theban-response"]).toBe("concession");
    expect(world.items["greek-decree"].holder).toBe(PALACE);
    expect(reload(world)).toEqual(world);
    world = take(world, "greek-creon-writ");
    world = give(move(world, COURTYARD), "greek-creon-writ", "greek-baker");
    expect(stateOf(world).flags["greek-concession-public"]).toBe(true);
    expect(stateOf(world).flags["greek-open-door-open"]).toBe(true);
    world = take(move(world, PALACE), "greek-decree");
    world = walk(world, COURTYARD, GATE);
    world = give(world, "greek-decree", "greek-guard");
    world = take(world, "greek-shovel");
    world = act(move(world, BATTLEFIELD), "wait");
    expect(done(world, "prepare-burial-ground")).toBeTruthy();
    world = act(world, "drop", { item: "greek-shovel", target: BATTLEFIELD });
    world = take(walk(world, GATE, COURTYARD), "greek-oil-flask");
    world = move(world, SANCTUARY);
    world = act(world, "drop", {
      item: "greek-household-token",
      target: SANCTUARY,
    });
    world = take(world, "greek-funeral-cloth");
    world = walk(world, COURTYARD, GATE, BATTLEFIELD);
    for (const item of ["greek-funeral-cloth", "greek-oil-flask"])
      world = act(world, "drop", { item, target: BATTLEFIELD });
    world = act(world, "wait");
    expect(stateOf(world).flags["greek-burial-performed"]).toBe(true);
    expect(done(world, "perform-permitted-burial")).toBeTruthy();
    expect(done(world, "perform-burial")).toBeUndefined();
    world = take(world, "greek-burial-account");
    world = give(
      walk(world, GATE, COURTYARD),
      "greek-burial-account",
      "greek-baker",
    );
    expect(stateOf(world).flags["greek-permitted-burial-public"]).toBe(true);
    expect(reload(world)).toEqual(world);
  });

  it("keeps the report consequential and leaves a way home", () => {
    let world = move(courtyard(), GATE);
    world = give(take(world, "greek-shovel"), "greek-shovel", "greek-guard");
    expect(stateOf(world).choices["greek-theban-response"]).toBe("exposure");
    world.items["greek-decree"].holder = "greek-guard";
    world = act(move(take(reload(world), "greek-shovel"), BATTLEFIELD), "wait");
    expect(done(world, "perform-burial")).toBeUndefined();
    world = walk(reload(world), GATE, COURTYARD, HARBOR, "pond");
    expect(stateOf(world).choices["greek-theban-response"]).toBe("exposure");
    expect(legalActions(world).length).toBeGreaterThan(0);
  });

  it("upgrades a revision 10 refusal and the old well steps", () => {
    const old = JSON.parse(encodeSave(move(courtyard(), GATE)));
    const pack = old.packs[PACK];
    pack.revision = 10;
    pack.receipts["greek-decline-burial"] = old.turn;
    pack.choices["greek-theban-response"] = "refusal";
    pack.flags["greek-refusal-public"] = true;
    old.routeKnowledge.vale = [[WELL, GATE]];
    const s = decodeSave(JSON.stringify(old));
    expect(s.packs[PACK].revision).toBe(packDefinition(PACK).revision);
    expect(s.packs[PACK].receipts["greek-decline-burial"]).toBeUndefined();
    expect(s.packs[PACK].choices["greek-theban-response"]).toBeUndefined();
    expect(s.packs[PACK].flags["greek-refusal-public"]).toBeUndefined();
    expect(s.routeKnowledge.vale).toEqual([
      [WELL, COURTYARD],
      [COURTYARD, GATE],
    ]);
  });

  it("keeps a released decree that was heard through Talk", () => {
    // Rules 21 told the decree as a Talk choice; revision 11 tells it on
    // meeting, and later revisions keep that.
    const s = decodeSave(
      readFileSync("test/fixtures/ajax-household-rules-21.json", "utf8"),
    );
    expect(s.packs[PACK].revision).toBeGreaterThanOrEqual(11);
    expect(s.knowledge.facts["greek-hear-decree"].source.topic.choiceId).toBe(
      null,
    );
    expect(s.packs[PACK].receipts["greek-hear-decree"]).toBeTypeOf("number");
  });

  it("opens Dione's road for a revision 10 report told before the invitation", () => {
    const old = JSON.parse(encodeSave(move(courtyard(), GATE)));
    const pack = old.packs[PACK];
    pack.revision = 10;
    old.turn += 2;
    old.revision += 2;
    delete pack.recitals;
    pack.receipts["greek-report-plan"] = old.turn - 1;
    pack.receipts["greek-courtyard-exposure"] = old.turn;
    pack.choices["greek-theban-response"] = "exposure";
    Object.assign(pack.flags, {
      "greek-guard-warned": true,
      "greek-exposure-public": true,
    });
    const s = decodeSave(JSON.stringify(old));
    expect(s.packs[PACK].flags["greek-open-door-open"]).toBe(true);
    expect(s.packs[PACK].receipts["greek-courtyard-exposure"]).toBe(old.turn);
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
