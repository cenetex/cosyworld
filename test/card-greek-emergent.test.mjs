import { beforeAll, describe, expect, it } from "vitest";
import { cardPlay, playLabel } from "../v2/card-game/cards.mjs";
import { DAYLIGHT_TURNS, isNight } from "../v2/card-game/daylight.mjs";
import { homecoming } from "../v2/card-game/homecoming.mjs";
import { packGiveChoice } from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { encodeSave, legalActions } from "../v2/card-game/world.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const BREAD = "greek-bread";
const WATER = "greek-water-jar";
const WHEAT = "greek-wheat";
const FIGS = "greek-figs";
const WINE = "greek-wine-skin";
const PROVISIONS = "greek-provisions";
const SHIPMASTER = "greek-shipmaster";
const QUAY = "greek-piraeus";
const HOST = "greek-quay-host";
const BAKE = "greek-piraeus-bake-bread";
const BAKE_LABEL = "Bring Water for Bread";
const ACROPOLIS = "greek-acropolis";
const LYSISTRATA = "greek-story-aristophanes-lysistrata";
const LAMPITO = `${LYSISTRATA}-second`;
const KEY = `${LYSISTRATA}-object`;
const MEAL = "greek-acropolis-lampito-shares-bread";
const ACHARNAE = "greek-story-aristophanes-acharnians";
const BOND = "greek-acharnae-household-bond";
const ORDER = "greek-acharnae-quay-order";
const PRIVATE = "greek-acharnae-accept-private-order";

const receipts = (world) => world.packs[PACK].receipts;
const bakedWater = (actions) =>
  actions.find(
    (a) =>
      a.kind === "give" &&
      a.item === WATER &&
      a.target === HOST &&
      playLabel(a) === BAKE_LABEL,
  );

function expectNoPoliticalDecision(world) {
  const { choices, receipts } = world.packs[PACK];
  for (const id of [ORDER, `${ACHARNAE}-outcome`, `${LYSISTRATA}-outcome`])
    expect(choices[id], id).toBeUndefined();
  for (const id of [`${ACHARNAE}-hear`, `${LYSISTRATA}-hear`])
    expect(receipts[id], id).toBeUndefined();
}

function reachAcropolis() {
  return traveler(greekStart())
    .move("well")
    .take(WATER)
    .move("courtyard")
    .give(WATER, "baker")
    .take(BREAD)
    .move("gate")
    .trade(BREAD, "guard", "decree")
    .move("palace")
    .trade("decree", "creon", "creon-writ")
    .move("courtyard")
    .act("talk", { target: "greek-baker" })
    .move("well")
    .take(WATER)
    .move("courtyard", "gate")
    .give("creon-writ", "guard")
    .move("battlefield", "cithaeron", "eleusis", "athens", ACROPOLIS);
}

describe("ordinary hospitality across Attica", () => {
  let acropolis;
  beforeAll(() => {
    acropolis = reachAcropolis();
    expect(acropolis.s.usedUp).toContain(BREAD);
    expect(acropolis.s.items[WHEAT].holder).toBe("greek-courtyard");
  }, 30_000);

  it("offers the same bread service when arrival and idle waiting happen in either order", () => {
    const waitFirst = acropolis.fork().act("wait").move(QUAY);
    const arriveFirst = acropolis.fork().move(QUAY).act("wait");
    expect(waitFirst.s.turn).toBe(arriveFirst.s.turn);
    const offer = (t) => bakedWater(legalActions(t.s));
    expect(offer(waitFirst)).toMatchObject({
      kind: "give",
      item: WATER,
      target: HOST,
    });
    expect(offer(waitFirst)).toEqual(offer(arriveFirst));
    for (const t of [waitFirst, arriveFirst]) {
      expect(t.s.items[WATER].holder).toBe("vale");
      expect(t.s.usedUp).toContain(BREAD);
      expectNoPoliticalDecision(t.s);
      expect(receipts(t.s)[BAKE]).toBeUndefined();
      expect(receipts(t.s)[MEAL]).toBeUndefined();
      const { action } = cardPlay(t.s, [WATER, HOST]);
      expect(playLabel(action)).toBe(BAKE_LABEL);
      t.give(WATER, HOST);
      expect(receipts(t.s)[BAKE]).toBe(t.s.turn);
      expect(t.s.items[WATER].holder).toBe("greek-well");
      expect(t.s.items[BREAD].holder).toBe(QUAY);
      expectNoPoliticalDecision(t.s);
    }
  }, 30_000);

  it("lets another traveler take, serve and recover the one real loaf", () => {
    const vale = acropolis.fork().move(QUAY).give(WATER, HOST);
    const created = dispatchShared({ op: "create", save: encodeSave(vale.s) });
    expect(created.ok, created.error).toBe(true);
    let world = homecoming(created.world, "mara");
    const seats = ["vale", "mara"];
    const request = (actor, input = { op: "view" }) =>
      dispatchShared({
        world,
        actor,
        claimed: seats,
        present: seats,
        ...input,
      });
    const actions = (actor) => request(actor).actions;
    const act = (actor, kind, fields = {}) => {
      const action = actions(actor).find(
        (entry) =>
          entry.kind === kind &&
          Object.entries(fields).every(
            ([field, value]) => entry[field] === value,
          ),
      );
      expect(
        action,
        `${actor} at ${world.actors[actor].place}: ${kind} ${JSON.stringify(fields)}`,
      ).toBeDefined();
      const result = request(actor, { op: "play", action });
      expect(result.ok, result.error).toBe(true);
      world = result.world;
    };
    const walk = (actor, to) => {
      for (const target of greekTravelTargets(world.actors[actor].place, to))
        act(actor, "move", { target });
    };
    const joined = request("mara", { op: "join" });
    expect(joined.ok, joined.error).toBe(true);
    world = joined.world;
    expect(world.actors.mara.place).toBe("pond");

    act("mara", "wait", { label: "Wait" });
    act("mara", "move", { target: "greek-ship" });
    act("mara", "course", { target: "greek-harbor" });
    act("mara", "wait", { sleep: undefined });
    act("mara", "move", { target: "greek-harbor" });
    walk("mara", "greek-well");
    act("mara", "take", { item: WATER });
    walk("mara", "greek-athens");
    walk("mara", QUAY);
    expect(bakedWater(actions("mara"))).toBeUndefined();
    const valeTake = actions("vale").find(
      (a) => a.kind === "take" && a.item === BREAD,
    );
    expect(valeTake).toBeDefined();
    act("mara", "take", { item: BREAD });
    expect(world.items[BREAD].holder).toBe("mara");
    expect(request("vale", { op: "play", action: valeTake }).ok).toBe(false);
    expect(bakedWater(actions("mara"))).toBeUndefined();

    const withLoaf = world;
    act("mara", "eat", { item: BREAD, target: null });
    expect(world.items[WATER].holder).toBe("mara");
    expect(bakedWater(actions("mara"))).toBeDefined();
    world = withLoaf;

    const key = structuredClone(world.items[KEY]);
    walk("mara", ACROPOLIS);
    for (let turn = 0; turn < DAYLIGHT_TURNS && !isNight(world); turn++)
      act("mara", "wait", { sleep: undefined });
    expect(isNight(world)).toBe(true);
    expectNoPoliticalDecision(world);
    const canTalkToLysistrata = () =>
      actions("mara").some(
        (a) => a.kind === "talk" && a.target === `${LYSISTRATA}-first`,
      );
    expect(canTalkToLysistrata()).toBe(false);
    act("mara", "give", { item: BREAD, target: LAMPITO });
    expect(receipts(world)[MEAL]).toBe(world.turn);
    expect(canTalkToLysistrata()).toBe(true);
    expect(world.items[KEY]).toEqual(key);
    expect(world.usedUp).toContain(BREAD);
    expect(world.gone ?? []).not.toContain(BREAD);
    expectNoPoliticalDecision(world);

    walk("mara", QUAY);
    expect(bakedWater(actions("mara"))).toBeDefined();
    act("mara", "give", { item: WATER, target: HOST });
    expect(receipts(world)[BAKE]).toBe(world.turn);
    expect(world.items[BREAD].holder).toBe(QUAY);
    act("vale", "take", { item: BREAD });
    expect(world.items[BREAD].holder).toBe("vale");
    expect(world.usedUp).not.toContain(BREAD);
    expectNoPoliticalDecision(world);
  }, 60_000);

  it("makes hospitality and provisioning compete for the same loaf", () => {
    const atQuay = acropolis.fork().move(QUAY).give(WATER, HOST).take(BREAD);
    const getSupplies = (t) =>
      t
        .move("gate")
        .take(WINE)
        .move("palace", "sanctuary")
        .take(FIGS)
        .move("harbor");
    const voyage = getSupplies(atQuay.fork())
      .give(BREAD, SHIPMASTER)
      .give(WINE, SHIPMASTER)
      .give(FIGS, SHIPMASTER)
      .take(PROVISIONS);
    expect(voyage.s.items[PROVISIONS].holder).toBe("vale");
    expect(
      voyage.s.log.findLast((event) => event.verb === "craft"),
    ).toMatchObject({
      itemId: PROVISIONS,
      consumedIds: [BREAD, FIGS, WINE],
    });
    expect(receipts(voyage.s)[MEAL]).toBeUndefined();

    const audience = getSupplies(
      atQuay.fork().move(ACROPOLIS).give(BREAD, LAMPITO),
    )
      .give(WINE, SHIPMASTER)
      .give(FIGS, SHIPMASTER);
    expect(receipts(audience.s)[MEAL]).toBeDefined();
    expect(audience.s.usedUp).toContain(PROVISIONS);
    expect(legalActions(audience.s)).not.toContainEqual(
      expect.objectContaining({
        kind: "take",
        item: PROVISIONS,
      }),
    );
    expectNoPoliticalDecision(audience.s);
    expectNoPoliticalDecision(voyage.s);
  }, 30_000);

  it("keeps ordinary baking separate from Dicaeopolis’s private credit", () => {
    const signer = `${ACHARNAE}-first`;
    const seal = `${ACHARNAE}-object`;
    const t = acropolis
      .fork()
      .move("acharnae")
      .talk(signer)
      .take(seal)
      .give(seal, signer)
      .talk(signer)
      .take(BOND)
      .move(QUAY);
    expect(t.s.packs[PACK].choices[`${ACHARNAE}-outcome`]).toBe("first");
    expect(bakedWater(legalActions(t.s))).toBeDefined();
    t.give(WATER, HOST);
    expect(t.s.items[BREAD].holder).toBe(QUAY);
    expect(t.s.items[BOND].holder).toBe("vale");
    expect(t.s.packs[PACK].choices[ORDER]).toBeUndefined();
    expect(receipts(t.s)[PRIVATE]).toBeUndefined();

    const bond = cardPlay(t.s, [BOND, HOST]).action;
    expect(packGiveChoice(t.s, bond)?.choiceId).toBe(PRIVATE);
    t.give(BOND, HOST);
    expect(t.s.packs[PACK].choices[ORDER]).toBe("private");
    expect(receipts(t.s)[PRIVATE]).toBe(t.s.turn);
    expect(t.s.items[BREAD].holder).toBe(QUAY);
  }, 30_000);
});
