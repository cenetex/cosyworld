import { expect, it } from "vitest";
import { cardPlay, playLabel } from "../v2/card-game/cards.mjs";
import { claimsIn } from "../v2/card-game/claims.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { decodeSave, encodeSave, legalActions } from "../v2/card-game/world.mjs";
import { greekStart, landRoad, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const pack = "greek-drama";
const troezen = "greek-story-euripides-hippolytus";
const nurse = `${troezen}-first`;
const theseus = `${troezen}-second`;
const record = `${troezen}-record`;
const tablet = `${troezen}-object`;
const hearing = "greek-troezen-hear-the-nurse";
const reachTroezen = () => traveler(greekStart()).move("harbor", "troezen");
const choices = () => packDefinition(pack).choices;
const lastTalk = (world, actor) =>
  world.log.findLast(
    (entry) => entry.verb === "talk" && entry.actorId === actor,
  );
const storyState = ({ packs }) => {
  const { choices, flags, receipts } = packs[pack];
  return { choices, flags, receipts };
};

it("repeats the premise for a late arriving second traveler without a new receipt", () => {
  const stem = "greek-story-euripides-medea";
  const speaker = `${stem}-first`;
  const t = traveler(greekStart())
    .move("harbor", "argolid-road", "corinth")
    .talk(speaker);
  const opening = choices().find((choice) => choice.id === `${stem}-hear`);
  expect(lastTalk(t.s, "vale").text).toBe(opening.text);

  const { world } = dispatchShared({ op: "create", save: encodeSave(t.s) });
  world.actors.mara.place = "greek-corinth";
  world.actors.mara.visited.push("greek-corinth");
  const request = {
    actor: "mara",
    claimed: ["vale", "mara"],
    present: ["vale", "mara"],
  };
  const talk = (current) => {
    const req = { ...request, world: current };
    const action = dispatchShared({ ...req, op: "view" }).actions.find(
      (a) => a.kind === "talk" && a.target === speaker,
    );
    expect(action).toBeDefined();
    const result = dispatchShared({ ...req, op: "play", action });
    expect(result.ok, result.error).toBe(true);
    return result.world;
  };
  const admitted = talk(world);
  expect(lastTalk(admitted, "mara").text).toBe(opening.text);
  expect(storyState(admitted)).toEqual(storyState(world));
  const repeated = talk(admitted);
  expect(lastTalk(repeated, "mara").text).toBe(opening.text);
  expect(storyState(repeated)).toEqual(storyState(world));
});

it.each(["first", "second"])(
  "recaps only the %s Troezen decision after reload",
  (branch) => {
    const t = reachTroezen().talk(nurse);
    if (branch === "first") t.talk(theseus);
    else t.take(tablet).give(tablet, theseus);
    const expected = structuredClone(storyState(t.s));
    t.s = decodeSave(encodeSave(t.s));
    const settlement = claimsIn(record, t.s).find(
      ({ claim }) => claim === `${troezen}-${branch}-answer`,
    );
    expect(settlement).toBeDefined();
    for (let repeat = 0; repeat < 2; repeat++) {
      t.talk(nurse);
      expect(lastTalk(t.s, "vale").text).toContain("Hippolytus Settlement");
      expect(lastTalk(t.s, "vale").text).toContain(settlement.text);
      expect(storyState(t.s)).toEqual(expected);
    }
  },
);

it("admits the nurse’s account without reading or handing over Phaedra’s sealed tablet", () => {
  const start = reachTroezen();
  const outcome = (t) => storyState(t.s).choices[`${troezen}-outcome`];
  const withoutProof = start.fork().act("wait").talk(theseus);
  expect(outcome(withoutProof)).toBeUndefined();
  expect(claimsIn(record, start.s)).toEqual([]);
  expect(legalActions(start.s).some((action) => action.choiceId?.startsWith(troezen))).toBe(false);

  const oral = start.fork().talk(nurse);
  const custodian = oral.fork().take(tablet).talk(theseus);
  expect(outcome(custodian)).toBeUndefined();
  expect(legalActions(custodian.s)).not.toContainEqual(
    expect.objectContaining({ kind: "read", item: tablet }),
  );
  custodian.give(tablet, theseus);
  expect(outcome(custodian)).toBe("second");
  expect(custodian.s.gone).toContain(tablet);
  custodian.act("read", { item: record }).talk(theseus);
  expect(storyState(custodian.s).receipts[hearing]).toBeUndefined();

  oral.talk(theseus);
  expect(outcome(oral)).toBe("first");
  expect(oral.s.items[tablet].holder).toBe("greek-troezen");
  expect(oral.s.gone ?? []).not.toContain(tablet);

  const saved = dispatchShared({ op: "create", save: encodeSave(oral.s) });
  expect(saved.ok, saved.error).toBe(true);
  let world = saved.world;
  world.actors.mara.place = "greek-troezen";
  const lateAction = (kind, fields) => {
    const seats = ["vale", "mara"];
    const request = { world, actor: "mara", claimed: seats, present: seats };
    const action = dispatchShared({ ...request, op: "view" }).actions.find(
      (entry) =>
        entry.kind === kind &&
        Object.entries(fields).every(([key, value]) => entry[key] === value),
    );
    expect(action).toBeDefined();
    const result = dispatchShared({ ...request, op: "play", action });
    expect(result.ok, result.error).toBe(true);
    world = result.world;
  };
  lateAction("talk", { target: theseus });
  expect(storyState(world).receipts[hearing]).toBeUndefined();
  lateAction("read", { item: record });
  lateAction("talk", { target: theseus });
  expect(storyState(world).receipts[hearing]).toBe(world.turn);

  oral.talk(theseus);
  expect(storyState(oral.s).receipts[hearing]).toBe(oral.s.turn);
  expect(claimsIn(record, oral.s).map(({ claim }) => claim)).toContain(hearing);
  expect(decodeSave(encodeSave(oral.s))).toEqual(oral.s);
});

it("shows the eligible Acharnae Give decisions and lets the later bond scene take precedence", () => {
  const stem = "greek-story-aristophanes-acharnians";
  const first = `${stem}-first`;
  const second = `${stem}-second`;
  const item = `${stem}-object`;
  const t = landRoad(traveler(greekStart()))
    .move("battlefield")
    .drop("shovel")
    .drop("oil-flask")
    .move("cithaeron", "eleusis", "attic-farm", "acharnae");
  t.talk(first).take(item);
  for (const [branch, target] of [
    ["first", first],
    ["second", second],
  ]) {
    const answer = choices().find(
      (choice) => choice.id === `${stem}-${branch}-answer`,
    );
    const { action } = cardPlay(t.s, [item, target]);
    expect(action).toMatchObject({
      kind: "give",
      item,
      target,
      label: answer.label,
    });
    expect(playLabel(action)).toBe(answer.label);
    expect(answer.label).toBeTruthy();
  }
  const publicSale = t.fork().give(item, second).take(item);
  const ordinary = cardPlay(publicSale.s, [item, second]).action;
  expect(ordinary.kind).toBe("give");
  expect(playLabel(ordinary)).toBe("Give to Megarian Trader");

  t.give(item, first).talk(first);
  const bond = "greek-acharnae-sign-household-bond";
  expect(storyState(t.s).receipts[bond]).toBe(t.s.turn);
  expect(lastTalk(t.s, "vale").text).toContain("bond");
  const expected = structuredClone(storyState(t.s));
  const [settlement] = claimsIn(`${stem}-record`, t.s);
  t.talk(first);
  expect(lastTalk(t.s, "vale").text).toContain(settlement.text);
  expect(storyState(t.s)).toEqual(expected);
});
