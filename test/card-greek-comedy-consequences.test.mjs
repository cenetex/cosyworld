import { describe, expect, it } from "vitest";
import { cardActions, cardPlay } from "../v2/card-game/cards.mjs";
import { claimsIn } from "../v2/card-game/claims.mjs";
import {
  entityActive,
  packDefinition,
  packGiveChoice,
  packTalkChoice,
} from "../v2/card-game/pack-registry.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const choices = new Map(
  packDefinition(PACK).choices.map((choice) => [choice.id, choice]),
);
const stemFor = (work) => `greek-story-aristophanes-${work}`;

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
});
