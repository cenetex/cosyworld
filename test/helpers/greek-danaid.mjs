import assert from "node:assert/strict";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../../v2/card-game/world.mjs";
import {
  packChoices,
  packDefinition,
} from "../../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../../v2/card-game/pack-recital.mjs";
import { questRecord } from "../../v2/card-game/shared-quests.mjs";

export const DANAID_SANCTUARY = "greek-argos-sanctuary";
export const DANAID_COURT = "greek-danaid-refuge-court";
export const DANAID_NERA = "greek-danaid-nera";
export const DANAID_MELIA = "greek-danaid-melia";
export const danaidId = (name) => `greek-danaid-${name}`;
export const danaidState = (world) => world.packs["greek-drama"];
export const danaidStory = (world, beat) =>
  questRecord(world, `greek-drama:story-quest-greek-danaid-${beat}`);
export const danaidVerses = (world) =>
  recitalPoem(world, packDefinition("greek-drama")).stanzas.filter((verse) =>
    verse.id.startsWith("greek-danaid-"),
  );
export const danaidOffered = (world, name, actor = "vale") =>
  packChoices(world, actor).find(
    (action) => action.choiceId === danaidId(name),
  );
export const danaidAction = (world, kind, fields = {}, actor = "vale") => {
  const action = legalActions(world, actor).find(
    (candidate) =>
      candidate.kind === kind &&
      Object.entries(fields).every(([key, value]) => candidate[key] === value),
  );
  if (!action)
    throw new Error(
      `Missing ${actor} ${kind} ${JSON.stringify(fields)} at ${world.actors[actor].place}`,
    );
  return action;
};
export function playDanaid(world, kind, fields = {}, actor = "vale") {
  const result = play(
    world,
    danaidAction(world, kind, fields, actor),
    world.revision,
    actor,
  );
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

let initial;
export function danaidStart() {
  if (!initial) {
    // Begin at the existing courtyard. The earlier refusal and introduction
    // are earned through their own legal choices before the new story opens.
    let world = createWorld();
    world.actors.vale.place = "greek-courtyard";
    world.items.lamp.holder = "station";
    for (const [kind, fields] of [
      ["move", { target: "greek-gate" }],
      ["choose", { choiceId: "greek-hear-decree" }],
      ["choose", { choiceId: "greek-decline-burial" }],
      ["move", { target: "greek-courtyard" }],
      ["choose", { choiceId: "greek-courtyard-refusal" }],
      ["choose", { choiceId: "greek-open-door-invite-refusal" }],
    ])
      world = playDanaid(world, kind, fields);
    assert.deepEqual(decodeSave(encodeSave(world)), world);
    initial = world;
  }
  return structuredClone(initial);
}

export const danaidPreparationSteps = [
  ["choose", { choiceId: danaidId("invitation") }],
  ["move", { target: "greek-harbor" }],
  ["move", { target: "greek-argolid-road" }],
  ["move", { target: DANAID_SANCTUARY }],
  ["choose", { choiceId: danaidId("hear-terms") }],
  ["move", { target: DANAID_COURT }],
  ["choose", { choiceId: danaidId("hear-flight") }],
  ["take", { item: danaidId("water-jug") }],
  ["take", { item: danaidId("branch") }],
  ["move", { target: DANAID_SANCTUARY }],
  ["choose", { choiceId: danaidId("lay-branches") }],
  ["move", { target: DANAID_COURT }],
  ["choose", { choiceId: danaidId("offer-roof") }],
  ["take", { item: danaidId("host-pledge") }],
  ["take", { item: danaidId("provisions") }],
  ["move", { target: DANAID_SANCTUARY }],
  ["choose", { choiceId: danaidId("set-provisions") }],
  ["move", { target: DANAID_COURT }],
  ["choose", { choiceId: danaidId("hear-herald") }],
  ["move", { target: DANAID_SANCTUARY }],
];

export function danaidReady() {
  return danaidPreparationSteps.reduce(
    (world, [kind, fields]) => playDanaid(world, kind, fields),
    danaidStart(),
  );
}
