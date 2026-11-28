import { expect, it } from "vitest";
import { cardPlay, playLabel } from "../v2/card-game/cards.mjs";
import { claimsIn } from "../v2/card-game/claims.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { greekStart, landRoad, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const pack = "greek-drama";
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
    const stem = "greek-story-euripides-hippolytus";
    const opening = `${stem}-first`;
    const record = `${stem}-record`;
    const item = `${stem}-object`;
    const t = traveler(greekStart())
      .move("harbor", "argolid-road", "corinth", "troezen")
      .talk(opening)
      .take(item)
      .give(item, `${stem}-${branch}`);
    const expected = structuredClone(storyState(t.s));
    t.s = decodeSave(encodeSave(t.s));
    const [settlement] = claimsIn(record, t.s);
    expect(settlement.claim).toBe(`${stem}-${branch}-answer`);
    for (let repeat = 0; repeat < 2; repeat++) {
      t.talk(opening);
      expect(lastTalk(t.s, "vale").text).toContain("Hippolytus Settlement");
      expect(lastTalk(t.s, "vale").text).toContain(settlement.text);
      expect(storyState(t.s)).toEqual(expected);
    }
  },
);

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
