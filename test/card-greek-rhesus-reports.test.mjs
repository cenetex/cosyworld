import { expect, it } from "vitest";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { isNight } from "../v2/card-game/daylight.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { packTalkChoice } from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { encodeSave, legalActions } from "../v2/card-game/world.mjs";
import { greekStart, playGreek } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const pack = "greek-drama";
const camp = "greek-trojan-camp";
const stem = "greek-story-euripides-rhesus";
const charioteer = `${stem}-first`;
const hector = `${stem}-second`;
const hear = `${stem}-hear`;
const bedside = `${stem}-first-answer`;
const stable = `${stem}-second-answer`;
const deposition = "greek-rhesus-bedside-deposition";
const stableCount = "greek-rhesus-stable-count";
const choiceForTalk = (world, target) =>
  packTalkChoice(world, { kind: "talk", actor: "vale", target })?.choiceId;

it("posts Hector’s actual count before any agreement and lets a late arrival read it", () => {
  let world = greekStart();
  world.actors.vale.place = camp;
  expect(world.packs[pack].choices).toEqual({});
  expect(world.packs[pack].receipts[hear]).toBeUndefined();
  expect(legalActions(world).some((action) => action.item === stableCount)).toBe(false);
  expect(cardPlay(world, [hector]).action).toMatchObject({ kind: "talk", target: hector });
  expect(choiceForTalk(world, hector)).toBe(stable);

  world = playGreek(world, "talk", { target: hector });
  const postedTurn = world.turn;
  expect(world.packs[pack].receipts[stable]).toBe(postedTurn);
  expect(world.packs[pack].receipts[hear]).toBeUndefined();
  expect(world.packs[pack].choices).toEqual({});
  expect(world.packs[pack].flags["greek-rhesus-stable-count-posted"]).toBe(true);
  expect(legalActions(world).some((action) => action.kind === "read" && action.item === stableCount)).toBe(true);

  const shared = dispatchShared({ op: "create", save: encodeSave(world) });
  expect(shared.ok, shared.error).toBe(true);
  world = shared.world;
  world.actors.mara.place = "greek-troy";
  const fact = `claim:${pack}:${stableCount}:${stable}`;
  const actAsMara = (kind, fields) => {
    const state = { world, actor: "mara", claimed: ["vale", "mara"], present: ["vale", "mara"] };
    const action = dispatchShared({ ...state, op: "view" }).actions.find((action) =>
      action.kind === kind && Object.entries(fields).every(([key, value]) => action[key] === value),
    );
    expect(action, `${kind} ${JSON.stringify(fields)}`).toBeDefined();
    const result = dispatchShared({ ...state, op: "play", action });
    expect(result.ok, result.error).toBe(true);
    world = result.world;
  };
  actAsMara("move", { target: camp });
  expect(knowsFact(world, "mara", fact)).toBe(false);
  actAsMara("read", { item: stableCount });
  expect(world.knowledge.known.mara[fact]).toMatchObject({ kind: "read", book: stableCount });
  expect(world.knowledge.facts[fact].source.author).toBe(hector);
  expect(world.packs[pack].receipts[stable]).toBe(postedTurn);
});

it("records the bedside witness and the public count on separate visits without a choice menu", () => {
  let world = greekStart();
  world.actors.vale.place = camp;
  expect(choiceForTalk(world, charioteer)).toBe(hear);
  world = playGreek(world, "talk", { target: charioteer });
  expect(choiceForTalk(world, charioteer)).toBeUndefined();
  while (!isNight(world)) world = playGreek(world, "wait");
  expect(choiceForTalk(world, hector)).toBeUndefined();
  expect(choiceForTalk(world, charioteer)).toBe(bedside);
  world = playGreek(world, "talk", { target: charioteer });
  const reportedTurn = world.turn;
  expect(world.packs[pack].receipts[bedside]).toBe(reportedTurn);
  expect(world.packs[pack].receipts[stable]).toBeUndefined();
  expect(legalActions(world).some((action) => action.kind === "read" && action.item === deposition)).toBe(true);
  while (isNight(world)) world = playGreek(world, "wait");
  world = playGreek(world, "talk", { target: hector });
  expect(world.packs[pack].receipts[stable]).toBe(world.turn);
  expect(world.packs[pack].receipts[bedside]).toBe(reportedTurn);
  expect(legalActions(world).some((action) => action.kind === "choose" && action.choiceId.startsWith(stem))).toBe(false);
});
