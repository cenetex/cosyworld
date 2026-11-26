import assert from "node:assert/strict";
import { createWorld, legalActions, play } from "../../v2/card-game/world.mjs";

function playTarot(world, label) {
  const action = legalActions(world, "vale").find((a) => a.label === label);
  assert(action, `Missing tarot action ${label}`);
  const result = play(world, action, world.revision, "vale");
  assert(result.ok, result.error);
  return result.state;
}

export function tarotRewardImport(collect = true) {
  const s = createWorld({ seed: 23 });
  s.actors.vale.arcana = {
    proved: [],
    did: [],
    need: ["arcanum-0"],
    spread: [
      {
        card: "arcanum-0",
        face: "down",
        base: { visited: s.actors.vale.visited.length },
      },
    ],
  };
  const revealed = playTarot(s, "Turn over");
  assert.equal(revealed.actors.vale.arcana.spread[0].face, "reward");
  if (!collect) return revealed;
  const collected = playTarot(revealed, "Collect");
  assert.equal(collected.actors.vale.arcana.level, 1);
  assert.deepEqual(
    collected.log.slice(-2).map((e) => e.text),
    ["Vale collects The Fool.", "Vale rises a level."],
  );
  return collected;
}
