import assert from "node:assert/strict";
import {
  applyGeneratedText,
  narrativeContext,
} from "../../v2/card-game/narrative.mjs";

export function pipClue(context) {
  const clue = context.disclosures[0];
  assert(clue, "Pip has the Keeper's clue to tell");
  const { factId, speaker, listener, eventSeq, text } = clue;
  assert.deepEqual([factId, speaker, listener], [
    "quest:keeper:pond",
    "moth",
    "vale",
  ]);
  return { text, disclosed: { factId, speaker, listener, eventSeq } };
}

export function publishPipReply(
  world,
  context = narrativeContext(world),
  reply = pipClue(context),
) {
  return applyGeneratedText(world, context, {
    revision: context.revision,
    model: "pip-test",
    entries: [{ id: "moth", ...reply }],
  });
}
