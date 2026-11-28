import { describe, expect, it } from "vitest";
import { cardActions, cardPlay } from "../v2/card-game/cards.mjs";
import { claimsIn } from "../v2/card-game/claims.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/daylight.mjs";
import { bringBack } from "../v2/card-game/item-use.mjs";
import {
  entityActive,
  packDefinition,
  packGiveChoice,
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
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const choices = new Map(
  packDefinition(PACK).choices.map((choice) => [choice.id, choice]),
);
const stemFor = (work) => `greek-story-aristophanes-${work}`;
const treasury = "greek-acropolis";
const lysistrata = stemFor("lysistrata");
const breadAtTheTable = "greek-acropolis-lampito-shares-bread";

function comedyAt(place) {
  const world = greekStart();
  world.actors.vale.place = place;
  if (!world.actors.vale.visited.includes(place))
    world.actors.vale.visited.push(place);
  return traveler(world);
}

function settle(stem, branch) {
  const opening = choices.get(`${stem}-hear`);
  const answer = choices.get(`${stem}-${branch}-answer`);
  const t = comedyAt(opening.at).talk(opening.subject);
  if (!answer.on) return t.act("choose", { choiceId: answer.id });
  return t.take(`${stem}-object`).give(`${stem}-object`, answer.subject);
}

describe("comedy aftermath cards", () => {
  it.each([
    {
      work: "birds",
      place: "greek-bird-wilderness",
      labels: ["Build the smoke gate", "Call the birds to council"],
      aftermath: ["smoke-gate-pass", "speaking-sprig"],
    },
    {
      work: "assemblywomen",
      place: "greek-assembly",
      labels: ["Open the pot to everyone", "Reserve grain for tomorrow"],
      aftermath: ["open-pot-bread-supply", "barley-reserve"],
    },
  ])(
    "offers both civic decisions in $work after hearing the dispute",
    ({ work, place, labels, aftermath }) => {
      const stem = stemFor(work);
      const speakers = [`${stem}-first`, `${stem}-second`];
      const answerIds = speakers.map((speaker) => `${speaker}-answer`);
      const t = comedyAt(place);
      expect(t.s.items[`${stem}-object`]).toBeUndefined();
      expect(cardPlay(t.s, [speakers[0]]).action).toMatchObject({
        kind: "talk",
      });
      expect(
        legalActions(t.s).some((a) => answerIds.includes(a.choiceId)),
      ).toBe(false);
      t.talk(speakers[0]);
      expect(t.hands()).toEqual([]);

      const available = (world, suffix) =>
        suffix.endsWith("-supply")
          ? legalActions(world).some((a) => a.choiceId === `${stem}-${suffix}`)
          : entityActive(world, `${stem}-${suffix}`);
      for (const [index, speaker] of speakers.entries()) {
        const choiceId = answerIds[index];
        const { actions } = cardActions(t.s, [speaker]);
        expect(actions).toHaveLength(1);
        const [action] = actions;
        expect(action).toMatchObject({
          kind: "choose",
          item: null,
          target: speaker,
          choiceId,
          label: labels[index],
        });
        const result = play(t.s, action, t.s.revision);
        expect(result.ok, result.error).toBe(true);
        const world = decodeSave(encodeSave(result.state));
        expect(world.turn).toBe(t.s.turn + 1);
        expect(world.packs[PACK].receipts[choiceId]).toBe(world.turn);
        expect(
          world.packs[PACK].receipts[answerIds[1 - index]],
        ).toBeUndefined();
        expect(
          claimsIn(`${stem}-record`, world).map((claim) => claim.claim),
        ).toEqual([choiceId]);
        expect(available(world, aftermath[index])).toBe(true);
        expect(available(world, aftermath[1 - index])).toBe(false);
        expect(
          legalActions(world).some((a) => answerIds.includes(a.choiceId)),
        ).toBe(false);
      }
    },
  );

  it.each([
    ["wasps", "second", "licked-bowl", "set-bowl-aside"],
    ["birds", "second", "speaking-sprig", "mark-council-turn"],
    ["wealth", "first", "sowing-seed", "sow-last-furrow"],
  ])(
    "commits the %s follow-up gift and uses its object for good",
    (work, branch, reward, followup) => {
      const stem = stemFor(work);
      const item = `${stem}-${reward}`;
      const choiceId = `${stem}-${followup}`;
      const { subject: target, text } = choices.get(choiceId);
      const { s: carrying } = settle(stem, branch).take(item);
      const { action } = cardPlay(carrying, [item, target]);
      expect(action).toMatchObject({ kind: "give", item, target });
      expect(packGiveChoice(carrying, action)?.choiceId).toBe(choiceId);

      const residentWorld = structuredClone(carrying);
      const resident = "greek-rhapsode";
      residentWorld.actors[resident].place = carrying.actors.vale.place;
      residentWorld.items[item].holder = resident;
      expect(
        packGiveChoice(residentWorld, { ...action, actor: resident }),
      ).toBeNull();

      const completed = play(carrying, action, carrying.revision);
      expect(completed.ok, completed.error).toBe(true);
      const world = decodeSave(encodeSave(completed.state));
      expect(world.packs[PACK].choices[`${stem}-outcome`]).toBe(branch);
      expect(world.packs[PACK].receipts[choiceId]).toBe(world.turn);
      const gift = world.log.findLast(
        (entry) => entry.verb === "give" && entry.itemId === item,
      );
      expect(gift).toMatchObject({
        turn: world.turn,
        targetId: target,
        accepted: true,
        text,
      });
      expect(world.gone).toContain(item);
      expect(legalActions(world).some((entry) => entry.item === item)).toBe(
        false,
      );
    },
  );

  it("dispatches the summons after the traveler reads the assembly’s account", () => {
    const stem = stemFor("thesmophoria");
    const choiceId = `${stem}-dispatch-summons`;
    const { subject: target, text } = choices.get(choiceId);
    const record = `${stem}-record`;
    const t = settle(stem, "second");
    const canDispatch = () =>
      packTalkChoice(t.s, { actor: "vale", target })?.choiceId === choiceId;
    expect(canDispatch()).toBe(false);
    t.act("talk", { target });
    expect(t.s.packs[PACK].receipts[choiceId]).toBeUndefined();
    const [claim] = claimsIn(record, t.s);
    t.act("read", { item: record });
    expect(t.s.knowledge.known.vale[claim.id]).toMatchObject({
      kind: "read",
      book: record,
    });
    expect(canDispatch()).toBe(true);
    t.act("talk", { target });
    const world = decodeSave(encodeSave(t.s));
    expect(world.packs[PACK].receipts[choiceId]).toBe(world.turn);
    expect(world.log.findLast(({ verb }) => verb === "talk")).toMatchObject({
      targetId: target,
      text,
    });
    expect(world.items[`${stem}-witness-water`]).toBeUndefined();
    expect(world.actors[target].trust.vale).toBeGreaterThan(0);
  });

  it("registers one communal loaf before any Assemblywomen decision", () => {
    const stem = stemFor("assemblywomen");
    const assembly = "greek-assembly";
    const bread = "greek-bread";
    const register = `${stem}-record`;
    const donation = "greek-assembly-register-bread";
    const praxagora = `${stem}-first`;
    const t = landRoad(traveler(greekStart()))
      .drop("shovel").drop("oil-flask")
      .move("well").take("water-jar")
      .move("piraeus").give("water-jar", "quay-host").take(bread)
      .move(assembly);

    const laid = t.fork().drop(bread).s;
    expect(laid.items[bread].holder).toBe(assembly);
    expect(entityActive(laid, register)).toBe(false);
    const action = cardPlay(t.s, [bread, praxagora]).action;
    expect(action).toMatchObject({ kind: "give", label: "Give Bread for the common table" });
    expect(packGiveChoice(t.s, action)?.choiceId).toBe(donation);
    t.give(bread, praxagora);
    t.s = decodeSave(encodeSave(t.s));
    expect(t.s.items[bread].holder).toBe(assembly);
    expect(t.s.usedUp).not.toContain(bread);
    expect(t.s.packs[PACK].receipts[donation]).toBe(t.s.turn);
    expect(t.s.packs[PACK].receipts[`${stem}-hear`]).toBeUndefined();
    expect(t.s.packs[PACK].choices[`${stem}-outcome`]).toBeUndefined();
    const [claim] = claimsIn(register, t.s);
    expect(claim).toMatchObject({ author: praxagora, claim: donation });
    expect(claimsIn(register, t.s)).toHaveLength(1);

    const hosted = dispatchShared({ op: "create", save: encodeSave(t.s) });
    expect(hosted.ok, hosted.error).toBe(true);
    hosted.world.actors.mara.place = assembly;
    let world = hosted.world;
    const seats = ["vale", "mara"];
    for (const [kind, item] of [["read", register], ["take", bread]]) {
      const request = { actor: "mara", claimed: seats, present: seats, world };
      const view = dispatchShared({ ...request, op: "view" });
      const action = view.actions.find((a) => a.kind === kind && a.item === item);
      expect(action).toBeDefined();
      const played = dispatchShared({ ...request, op: "play", action });
      expect(played.ok, played.error).toBe(true);
      world = played.world;
    }
    expect(world.knowledge.known.mara[claim.id]?.kind).toBe("read");
    expect(world.items[bread].holder).toBe("mara");
    expect(packGiveChoice(world, { actor: "mara", item: bread, target: praxagora })).toBeNull();
    expect(world.packs[PACK].choices[`${stem}-outcome`]).toBeUndefined();
  });

  it("serves kitchen bread as a native Eat card after the public audit", () => {
    const stem = stemFor("knights");
    const bread = "greek-bread";
    const supply = `${stem}-kitchen-hands-bread-supply`;
    const kitchen = settle(stem, "second").act("choose", { choiceId: supply });
    expect(kitchen.s.items[bread].holder).toBe("greek-demos-house");
    expect(kitchen.s.packs[PACK].receipts[supply]).toBe(kitchen.s.turn);
    const { s: carrying } = kitchen.take(bread);
    const { action } = cardPlay(carrying, [bread]);
    expect(action).toMatchObject({ kind: "eat", item: bread });
    const eaten = play(carrying, action, carrying.revision);
    expect(eaten.ok, eaten.error).toBe(true);
    expect(eaten.state.log).toContainEqual(
      expect.objectContaining({ verb: "eat", itemId: bread }),
    );
    expect(eaten.state.items[bread].holder).toBe("greek-courtyard");
    expect(eaten.state.usedUp).toContain(bread);
    expect(eaten.state.packs[PACK].choices[`${stem}-outcome`]).toBe("second");
  });

  it("spends one Bread to extend the night audience without deciding custody of the Treasury Key", () => {
    const t = comedyAt(treasury);
    const speaker = `${lysistrata}-first`;
    const lampito = `${lysistrata}-second`;
    const bread = "greek-bread";
    const key = `${lysistrata}-object`;
    t.s.turn = t.s.revision = DAYLIGHT_TURNS;
    bringBack(t.s, bread, "vale");
    const canTalk = (target) =>
      legalActions(t.s).some((a) => a.kind === "talk" && a.target === target);
    expect(canTalk(lampito)).toBe(true);
    expect(canTalk(speaker)).toBe(false);

    const { action } = cardPlay(t.s, [bread, lampito]);
    expect(action).toMatchObject({ kind: "give", item: bread, target: lampito });
    const absent = structuredClone(t.s);
    absent.actors[lampito].place = "greek-athens";
    expect(packGiveChoice(absent, action)).toBeNull();
    expect(packGiveChoice(t.s, action)?.choiceId).toBe(breadAtTheTable);
    t.give(bread, lampito);
    t.s = decodeSave(encodeSave(t.s));
    expect(t.s.items[bread].holder).toBe("greek-courtyard");
    expect(t.s.usedUp).toContain(bread);
    expect(t.s.gone || []).not.toContain(bread);
    expect(t.s.items[key].holder).toBe(treasury);
    expect(t.s.packs[PACK].choices[`${lysistrata}-outcome`]).toBeUndefined();
    expect(t.s.packs[PACK].receipts[`${lysistrata}-hear`]).toBeUndefined();
    expect(t.s.packs[PACK].receipts[breadAtTheTable]).toBe(t.s.turn);
    expect(canTalk(speaker)).toBe(true);

    const lastVisibleTurn = t.s.turn + 7;
    const late = traveler(structuredClone(t.s)).take(key);
    late.s.revision += lastVisibleTurn - late.s.turn;
    late.s.turn = lastVisibleTurn;
    const { action: lastOffer } = cardPlay(late.s, [key, speaker]);
    expect(packGiveChoice(late.s, lastOffer)?.choiceId).toBe(
      `${lysistrata}-first-answer`,
    );
    late.give(key, speaker);
    const guarded = decodeSave(encodeSave(late.s));
    expect(guarded.items[key].holder).toBe(speaker);
    expect(entityActive(guarded, speaker)).toBe(true);
    expect(entityActive(guarded, key)).toBe(true);

    t.s.turn += 8;
    t.s.revision += 8;
    expect(canTalk(speaker)).toBe(false);
    expect(canTalk(lampito)).toBe(true);
  });

  it.each([
    ["first", `${lysistrata}-first`],
    ["second", treasury],
  ])(
    "records the %s key handoff without an introduction or a loaf",
    (branch, holder) => {
      const key = `${lysistrata}-object`;
      const answer = `${lysistrata}-${branch}-answer`;
      const target = `${lysistrata}-${branch}`;
      const t = comedyAt(treasury).take(key);
      t.give(key, target);
      const world = decodeSave(encodeSave(t.s));
      expect(world.items[key].holder).toBe(holder);
      expect(world.gone || []).not.toContain(key);
      expect(world.packs[PACK].choices[`${lysistrata}-outcome`]).toBe(branch);
      expect(world.packs[PACK].receipts[`${lysistrata}-hear`]).toBeUndefined();
      expect(world.packs[PACK].receipts[breadAtTheTable]).toBeUndefined();
      const claims = claimsIn(`${lysistrata}-record`, world);
      expect(claims.map(({ claim }) => claim)).toEqual([answer]);
      const returning = traveler(world).talk(`${lysistrata}-first`).s;
      expect(
        returning.log.findLast((entry) => entry.verb === "talk"),
      ).toMatchObject({
        targetId: `${lysistrata}-first`,
        text: expect.stringContaining(claims[0].text),
      });
      expect(
        returning.packs[PACK].receipts[`${lysistrata}-hear`],
      ).toBeUndefined();
    },
  );
});
