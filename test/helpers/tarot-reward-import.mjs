import assert from "node:assert/strict";
import { createWorld, legalActions, play } from "../../v2/card-game/world.mjs";

function playTarot(world, label) {
  const action = legalActions(world, "vale").find((a) =>
    label === "Talk"
      ? a.kind === "talk" && a.target === "listener"
      : a.label === label,
  );
  assert(action, `Missing tarot action ${label}`);
  const result = play(world, action, world.revision, "vale");
  assert(result.ok, result.error);
  return result.state;
}

export function tarotRewardImport(collect = true) {
  const s = createWorld({ seed: 23 });
  s.actors.vale.place = s.actors.listener.place;
  s.actors.vale.arcana = { proved: [], did: [], calls: 3 };
  const offered = playTarot(s, "Talk");
  assert.equal(offered.actors.vale.arcana.spread, undefined);
  const dealt = playTarot(offered, "Accept card");
  const revealed = playTarot(dealt, "Turn over");
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
