import assert from "node:assert/strict";
import { countResidentQuest } from "../../v2/card-game/world/arcana-record.mjs";
import { createWorld, holdChoice, legalActions, play } from "../../v2/card-game/world.mjs";

export function tarotRewardImport(collect = true) {
  const s = createWorld({ seed: 23 });
  s.actors.vale.arcana = {
    proved: [], did: [], need: ["arcanum-0"],
    spread: [{ card: "arcanum-0", face: "down", base: { visited: s.actors.vale.visited.length } }],
  };
  for (const id of ["keeper", "moth", "badger"]) countResidentQuest(s.actors.vale, id);
  holdChoice(s, "vale", { item: null, revision: s.revision });
  assert.equal(s.actors.vale.arcana.spread[0].face, "reward");
  if (!collect) return s;
  const action = legalActions(s, "vale").find((a) => a.label === "Collect");
  assert(action);
  const result = play(s, action, s.revision, "vale");
  assert(result.ok, result.error);
  assert.equal(result.state.actors.vale.arcana.level, 1);
  assert.deepEqual(result.state.log.slice(-2).map((e) => e.text), [
    "Vale collects The Fool.", "Vale rises a level.",
  ]);
  return result.state;
}
