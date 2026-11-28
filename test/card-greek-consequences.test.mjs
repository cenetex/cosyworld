import { beforeAll, describe, expect, it } from "vitest";
import { cardPlay, playLabel } from "../v2/card-game/cards.mjs";
import { claimsIn } from "../v2/card-game/claims.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import {
  entityActive,
  packTalkChoice,
} from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { greekStart, landRoad, traveler } from "./helpers/open-door.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const COURTYARD = "greek-courtyard";
const GATE = "greek-gate";
const GUARD = "greek-guard";
const WHEAT = "greek-wheat";
const MARKET = "greek-acharnae";
const STALL = "greek-acharnae-stall";
const PIREAUS = "greek-piraeus";
const DICAEOPOLIS = "greek-story-aristophanes-acharnians-first";
const MEGARIAN = "greek-story-aristophanes-acharnians-second";
const SEAL = "greek-story-aristophanes-acharnians-object";
const AGREEMENT = "greek-story-aristophanes-acharnians-record";
const HOST = "greek-quay-host";
const ORDER = "greek-acharnae-quay-order";
const PUBLIC = "greek-acharnae-accept-public-order";
const PRIVATE = "greek-acharnae-accept-private-order";
const CREDIT = "greek-acharnae-quay-travel-credit";
const CREDIT_WAITING = "greek-acharnae-quay-travel-credit-waiting";
const BOND = "greek-acharnae-household-bond";
const LEDGER = "greek-acharnae-quay-ledger";
const BREAD = "greek-bread";
const PUBLIC_STALL = "greek-acharnae-trader-loaf-supply";
const PRIVATE_PANTRY = "greek-acharnae-private-loaf-supply";
const QUAY_SUPPLY = "greek-acharnae-quay-bread-supply";
const QUAY_BAKE = "greek-piraeus-bake-bread";
const WATER = "greek-water-jar";
const WINE = "greek-wine-skin";
const OLD_QUAY_WINE = "greek-acharnae-quay-wine";
const PROVISIONS = "greek-provisions";
const PROOF_REPLY = "greek-acharnae-quay-needs-proof";
const WAITING_REPLY = "greek-acharnae-quay-bread-waiting";
const READY_REPLY = "greek-acharnae-quay-bread-ready";
const SET_OUT_REPLY = "greek-acharnae-quay-bread-set-out";

const reload = (world) => decodeSave(encodeSave(world));
const packState = (world) => world.packs[PACK];
const cargoState = (world) => ({
  item: world.items[PROVISIONS],
  usedUp: world.usedUp.includes(PROVISIONS),
  gone: world.gone?.includes(PROVISIONS) ?? false,
});
const canReportPublic = (world, actor = "vale") =>
  packTalkChoice(world, { actor, target: HOST })?.choiceId === PUBLIC;
const quayTalk = (actions) =>
  actions.find(({ kind, target }) => kind === "talk" && target === HOST);
const supplier = (actions, choiceId) =>
  actions.find(
    (action) => action.kind === "choose" && action.choiceId === choiceId,
  );

function expectReply(world, id, words, actor = "vale") {
  const talk = world.log.findLast(
    (entry) =>
      entry.verb === "talk" &&
      entry.actorId === actor &&
      entry.targetId === HOST,
  );
  expect(talk?.text).toContain(`Thaleia says, “${words}`);
  expect(packState(world).receipts[id]).toBeUndefined();
  expect(packState(world).recitals?.[id]).toBeUndefined();
  return talk.text;
}

function reachAcharnaeAfterWheatRecovery() {
  const t = traveler(greekStart())
    .move("well")
    .take("water-jar")
    .move(COURTYARD)
    .give("water-jar", "baker")
    .take(BREAD)
    .act("eat", { item: BREAD, target: null })
    .act("talk", { target: "greek-baker" });
  expect(packState(t.s).receipts["greek-dione-recover-wheat"]).toBe(t.s.turn);
  expect(t.s.items[WHEAT].holder).toBe(COURTYARD);

  // Leave the wheat for Dione and take the gate's standoff route.
  t.move(GATE).act("threaten", { target: GUARD });
  for (let i = 0; i < 24 && t.s.actors[GUARD].place === GATE; i++) {
    const actions = legalActions(t.s);
    const step =
      actions.find((a) => a.kind === "attack" && a.target === GUARD) ??
      actions.find((a) => a.kind === "wait" && !a.guards && !a.sleep);
    const result = play(t.s, step, t.s.revision);
    expect(result.ok, result.error).toBe(true);
    t.s = result.state;
  }
  expect(t.s.actors[GUARD].place).not.toBe(GATE);
  t.move("battlefield", "cithaeron", "eleusis", "attic-farm", MARKET);
  expect(t.s.items[WHEAT].holder).toBe(COURTYARD);
  expect(entityActive(t.s, HOST)).toBe(false);
  return t.s;
}

function walkToQuay(t) {
  t.move(
    "attic-farm",
    "eleusis",
    "road-athens-eleusis",
    "athens",
    "road-athens-piraeus",
    PIREAUS,
  );
  expect(t.s.actors.vale.place).toBe(PIREAUS);
  expect(entityActive(t.s, HOST)).toBe(true);
  expect(t.s.actors.vale.visited).not.toContain("greek-ship");
  return t;
}

function expectOrder(world, branch, choice, cargo) {
  const otherChoice = choice === PUBLIC ? PRIVATE : PUBLIC;
  const receipt = packState(world).receipts[choice];
  const saved = reload(world);
  expect(receipt).toBeTypeOf("number");
  for (const state of [world, saved]) {
    expect(packState(state).choices[ORDER]).toBe(branch);
    expect(packState(state).receipts[choice]).toBe(receipt);
    expect(packState(state).receipts[otherChoice]).toBeUndefined();
    expect(cargoState(state)).toEqual(cargo);
    expect(canReportPublic(state)).toBe(false);
    expect(claimsIn(LEDGER, state)).toMatchObject([
      { claim: choice, author: HOST },
    ]);
  }
  return saved;
}

describe("Acharnae orders at Piraeus", () => {
  let market;
  let marketAfterRecovery;
  beforeAll(() => {
    marketAfterRecovery = reachAcharnaeAfterWheatRecovery();
    market = landRoad(traveler(greekStart()))
      .move("battlefield")
      .drop("shovel")
      .drop("oil-flask")
      .move("cithaeron", "eleusis", "attic-farm", MARKET).s;
  });

  it("honors the public agreement after a Read with the wheat still at Dione’s", () => {
    const t = traveler(marketAfterRecovery).talk(DICAEOPOLIS).take(SEAL);
    expect(playLabel(cardPlay(t.s, [SEAL, MEGARIAN]).action)).toBe(
      "Open the Megarian’s stall",
    );
    t.give(SEAL, MEGARIAN);
    expect(
      t.s.log.findLast((e) => e.verb === "give" && e.itemId === SEAL).text,
    ).toContain("Tell Thaleia at Piraeus what the market agreed.");
    expect(
      packState(t.s).receipts["greek-acharnae-hear-quay-invitation"],
    ).toBeUndefined();
    t.act("talk", { target: MEGARIAN });
    expect(packState(t.s).receipts["greek-acharnae-hear-quay-invitation"]).toBe(
      t.s.turn,
    );
    const [proof] = claimsIn(AGREEMENT, t.s);
    const witness = walkToQuay(t.fork());
    expect(knowsFact(witness.s, "vale", proof.id)).toBe(false);
    expect(canReportPublic(witness.s)).toBe(false);
    witness.act("talk", { target: HOST });
    expectReply(
      witness.s,
      PROOF_REPLY,
      "Read the market agreement at Acharnae",
    );
    expect(packState(witness.s).choices[ORDER]).toBeUndefined();
    expect(supplier(legalActions(witness.s), QUAY_SUPPLY)).toBeUndefined();
    expect(entityActive(witness.s, LEDGER)).toBe(false);
    expect(entityActive(witness.s, BOND)).toBe(false);
    witness.act("talk", { target: HOST });
    expectReply(
      witness.s,
      PROOF_REPLY,
      "Read the market agreement at Acharnae",
    );
    expect(knowsFact(witness.s, "vale", proof.id)).toBe(false);

    t.act("read", { item: AGREEMENT });
    expect(t.s.knowledge.known.vale[proof.id]).toMatchObject({
      kind: "read",
      book: AGREEMENT,
    });
    t.move(STALL)
      .act("choose", { choiceId: PUBLIC_STALL })
      .take(BREAD)
      .move(MARKET);
    walkToQuay(t);
    const cargo = structuredClone(cargoState(t.s));
    expect(canReportPublic(t.s)).toBe(true);
    t.act("talk", { target: HOST });
    const reportedAt = t.s.turn;
    expect(packState(t.s).receipts[PUBLIC]).toBe(reportedAt);
    expect(t.s.items[BREAD].holder).toBe("vale");
    expect(supplier(legalActions(t.s), QUAY_SUPPLY)).toBeUndefined();
    t.act("talk", { target: HOST });
    const waitingWords =
      "The Acharnae order is stamped. I have no Bread to set out";
    expectReply(t.s, WAITING_REPLY, waitingWords);
    t.s = reload(t.s);
    t.act("talk", { target: HOST });
    expectReply(t.s, WAITING_REPLY, waitingWords);
    expect(packState(t.s).receipts[PUBLIC]).toBe(reportedAt);
    expect(packState(t.s).receipts[QUAY_SUPPLY]).toBeUndefined();
    expect(t.s.items[BREAD].holder).toBe("vale");
    t.act("eat", { item: BREAD, target: null });
    t.act("talk", { target: HOST });
    expectReply(
      t.s,
      READY_REPLY,
      "The Acharnae order is stamped. You can Set out Bread",
    );
    t.act("choose", { choiceId: QUAY_SUPPLY });
    expect(packState(t.s).receipts[QUAY_SUPPLY]).toBe(t.s.turn);
    expect(t.s.items[BREAD].holder).toBe(PIREAUS);
    t.take(BREAD);
    const withRation = expectOrder(t.s, "public", PUBLIC, cargo);
    expect(withRation.items[BREAD].holder).toBe("vale");
    expect(withRation.items[WHEAT].holder).toBe(COURTYARD);
    const eat = legalActions(withRation).find(
      ({ kind, item, target }) => kind === "eat" && item === BREAD && !target,
    );
    expect(eat).toBeDefined();
    expect(playLabel(eat)).toBe("Eat");
    const refill = t.fork();
    refill.s.items[WATER].holder = "vale";
    const waterPlay = () => cardPlay(refill.s, [WATER, HOST]).action;
    expect(waterPlay()?.label).not.toBe("Bring Water for Bread");
    for (let i = 0; i < 2; i++) {
      refill.act("eat", { item: BREAD, target: null });
      expect(playLabel(waterPlay())).toBe("Bring Water for Bread");
      refill.give(WATER, HOST);
      expect(refill.s.items[WATER].holder).toBe("greek-well");
      expect(refill.s.items[BREAD].holder).toBe(PIREAUS);
      expect(packState(refill.s).receipts[QUAY_BAKE]).toBe(refill.s.turn);
      refill.s = reload(refill.s);
      refill.take(BREAD);
      refill.s.items[WATER].holder = "vale";
    }
    t.act("talk", { target: HOST });
    expectReply(t.s, SET_OUT_REPLY, "The Bread has been set out");
    expect(packState(t.s).receipts[PUBLIC]).toBe(reportedAt);
    expect(t.s.items[BREAD].holder).toBe("vale");
    t.act("eat", { item: BREAD, target: null }).act("talk", { target: HOST });
    expectReply(t.s, SET_OUT_REPLY, "The Bread has been set out");
    expect(supplier(legalActions(t.s), QUAY_SUPPLY)).toBeUndefined();
    t.act("read", { item: LEDGER });
    const [ledger] = claimsIn(LEDGER, t.s);
    expect(supplier(legalActions(t.s), CREDIT)).toBeUndefined();
    expect(reload(t.s).knowledge.known.vale[ledger.id]).toMatchObject({
      kind: "read",
      book: LEDGER,
    });
  });

  it("honors the signed bond and provides one basket on personal credit", () => {
    const t = traveler(marketAfterRecovery).talk(DICAEOPOLIS).take(SEAL);
    expect(playLabel(cardPlay(t.s, [SEAL, DICAEOPOLIS]).action)).toBe(
      "Seal the household sale",
    );
    t.give(SEAL, DICAEOPOLIS);
    expect(
      t.s.log.findLast((e) => e.verb === "give" && e.itemId === SEAL).text,
    ).toContain("Take it to Thaleia at Piraeus.");
    expect(entityActive(t.s, BOND)).toBe(false);
    expect(supplier(legalActions(t.s), PRIVATE_PANTRY)).toBeDefined();
    const withoutBond = walkToQuay(t.fork()).act("talk", { target: HOST });
    expect(packState(withoutBond.s).choices[ORDER]).toBeUndefined();
    t.talk(DICAEOPOLIS).take(BOND);
    expect(packState(t.s).receipts["greek-acharnae-sign-household-bond"]).toBe(
      t.s.turn - 1,
    );
    walkToQuay(t);
    expect(canReportPublic(t.s)).toBe(false);
    expect(entityActive(t.s, LEDGER)).toBe(false);
    const cargo = structuredClone(cargoState(t.s));
    const gateWine = structuredClone(t.s.items[WINE]);
    const oldTrust = t.s.actors[HOST].trust.vale ?? 0;
    expect(oldTrust).toBeLessThan(2);
    t.give(BOND, HOST);
    const saved = expectOrder(t.s, "private", PRIVATE, cargo);
    expect(saved.items[WHEAT].holder).toBe(COURTYARD);
    expect(saved.actors[HOST].trust.vale).toBe(2);
    expect(saved.items[WINE]).toEqual(gateWine);
    expect(saved.items[OLD_QUAY_WINE]).toBeUndefined();
    expect(claimsIn(LEDGER, saved)[0].text).toContain("her own wine");
    expect(supplier(legalActions(t.s), QUAY_SUPPLY)).toBeUndefined();
    expect(saved.gone).toContain(BOND);
    expect(legalActions(t.s).some(({ item }) => item === BOND)).toBe(false);

    const old = structuredClone(t.s);
    old.packs[PACK].revision = 42;
    old.actors[HOST].trust.vale = oldTrust;
    old.items[OLD_QUAY_WINE] = { holder: "vale", history: [] };
    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated.actors[HOST].trust.vale).toBe(2);
    expect(migrated.items[OLD_QUAY_WINE]).toBeUndefined();
    expect(migrated.items[WINE]).toEqual(gateWine);

    old.log = old.log.filter(
      (entry) => entry.verb !== "give" || entry.itemId !== BOND,
    );
    const withoutHandoff = decodeSave(JSON.stringify(old));
    expect(withoutHandoff.actors[HOST].trust.vale).toBe(oldTrust);

    // The bond establishes the relationship. Reading its entry supplies proof.
    expect(supplier(legalActions(t.s), CREDIT)).toBeUndefined();
    const [privateEntry] = claimsIn(LEDGER, t.s);
    t.act("read", { item: LEDGER });
    expect(knowsFact(t.s, "vale", privateEntry.id)).toBe(true);
    const noTrust = t.fork();
    noTrust.s.actors[HOST].trust.vale = 1;
    expect(supplier(legalActions(noTrust.s), CREDIT)).toBeUndefined();

    const shared = dispatchShared({ op: "create", save: encodeSave(t.s) });
    expect(shared.ok, shared.error).toBe(true);
    shared.world.actors.mara.place = PIREAUS;
    const people = ["vale", "mara"];
    const guest = { actor: "mara", claimed: people, present: people };
    const arrival = dispatchShared({
      ...guest,
      op: "view",
      world: shared.world,
    });
    expect(arrival.ok, arrival.error).toBe(true);
    const read = arrival.actions.find(
      (a) => a.kind === "read" && a.item === LEDGER,
    );
    expect(read).toBeDefined();
    const guestProof = dispatchShared({
      ...guest,
      op: "play",
      world: arrival.world,
      action: read,
    });
    expect(guestProof.ok, guestProof.error).toBe(true);
    expect(knowsFact(guestProof.world, "mara", privateEntry.id)).toBe(true);
    expect(
      supplier(legalActions(guestProof.world, "mara"), CREDIT),
    ).toBeUndefined();
    expect(
      supplier(legalActions(guestProof.world, "vale"), CREDIT),
    ).toBeDefined();

    const suppliedShip = t.fork();
    stowProvisions(suppliedShip.s, "greek-ship");
    expect(supplier(legalActions(suppliedShip.s), CREDIT)).toBeUndefined();
    suppliedShip.act("talk", { target: HOST });
    expectReply(
      suppliedShip.s,
      CREDIT_WAITING,
      "Dicaeopolis’s credit is good. I have no Travel Provisions to set out just now.",
    );
    expect(suppliedShip.s.items[PROVISIONS].holder).toBe("greek-ship");

    const { action } = cardPlay(t.s, [HOST]);
    expect(action).toMatchObject({
      kind: "choose",
      choiceId: CREDIT,
      label: "Ask for Travel Provisions",
    });
    t.act("choose", { choiceId: CREDIT });
    const issuedAt = t.s.turn;
    expect(t.s.items[PROVISIONS].holder).toBe(PIREAUS);
    expect(t.s.usedUp).not.toContain(PROVISIONS);
    expect(t.s.items[BREAD]).toEqual(saved.items[BREAD]);
    expect(claimsIn(LEDGER, t.s).map(({ claim }) => claim)).toEqual([
      PRIVATE,
      CREDIT,
    ]);
    t.take(PROVISIONS).act("eat", { item: PROVISIONS, target: null });
    t.s = reload(t.s);
    expect(t.s.usedUp).toContain(PROVISIONS);
    expect(packState(t.s).receipts[CREDIT]).toBe(issuedAt);
    expect(supplier(legalActions(t.s), CREDIT)).toBeUndefined();
  });

  it("does not offer an order to a late shared arrival without the agreement", () => {
    const t = traveler(market)
      .talk(DICAEOPOLIS)
      .take(SEAL)
      .give(SEAL, MEGARIAN);
    t.act("read", { item: AGREEMENT });
    const [proof] = claimsIn(AGREEMENT, t.s);
    t.move(STALL)
      .act("choose", { choiceId: PUBLIC_STALL })
      .take(BREAD)
      .move(MARKET);
    walkToQuay(t);
    const shared = dispatchShared({ op: "create", save: encodeSave(t.s) });
    expect(shared.ok, shared.error).toBe(true);
    let world = shared.world;
    world.actors.mara.place = PIREAUS;
    const people = ["vale", "mara"];
    const request = (actor, op = "view", action) => {
      const result = dispatchShared({
        actor,
        op,
        action,
        world,
        claimed: people,
        present: people,
      });
      expect(result.ok, result.error).toBe(true);
      world = result.world;
      return result;
    };
    const afterArrival = request("mara");
    expect(knowsFact(world, "mara", proof.id)).toBe(false);
    expect(canReportPublic(world, "mara")).toBe(false);
    expect(supplier(afterArrival.actions, QUAY_SUPPLY)).toBeUndefined();
    const talk = quayTalk(afterArrival.actions);
    expect(talk).toBeDefined();
    request("mara", "play", talk);
    expectReply(
      world,
      PROOF_REPLY,
      "Read the market agreement at Acharnae",
      "mara",
    );
    expect(packState(world).choices[ORDER]).toBeUndefined();
    expect(knowsFact(world, "mara", proof.id)).toBe(false);
    const report = quayTalk(request("vale").actions);
    expect(report).toBeDefined();
    expect(canReportPublic(world)).toBe(true);
    request("vale", "play", report);
    expect(packState(world).choices[ORDER]).toBe("public");
    const reportedAt = packState(world).receipts[PUBLIC];
    request("mara", "play", quayTalk(request("mara").actions));
    const reply = expectReply(
      world,
      WAITING_REPLY,
      "The Acharnae order is stamped. I have no Bread to set out",
      "mara",
    );
    expect(reply).not.toMatch(/Vale|Megarian|stall/u);
    expect(world.items[BREAD].holder).toBe("vale");
    expect(supplier(request("mara").actions, QUAY_SUPPLY)).toBeUndefined();
    expect(packState(world).receipts[PUBLIC]).toBe(reportedAt);
    expect(knowsFact(world, "mara", proof.id)).toBe(false);
    const eat = request("vale").actions.find(
      ({ kind, item, target }) => kind === "eat" && item === BREAD && !target,
    );
    expect(eat).toBeDefined();
    request("vale", "play", eat);
    const supply = supplier(request("vale").actions, QUAY_SUPPLY);
    expect(supply).toBeDefined();
    request("vale", "play", supply);
    const pickUp = request("vale").actions.find(
      ({ kind, item }) => kind === "take" && item === BREAD,
    );
    expect(pickUp).toBeDefined();
    request("vale", "play", pickUp);
    expect(world.items[BREAD].holder).toBe("vale");
    expect(
      request("mara").actions.some(
        ({ kind, item }) => kind === "take" && item === BREAD,
      ),
    ).toBe(false);
  });
});
