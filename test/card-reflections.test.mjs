import { expect, it } from "vitest";
import { rest } from "./fixtures/card-rest.mjs";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  narrativeContext,
  applySharedReflections as narrativeReflections,
} from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  reflectionContext,
  applySharedReflections,
} from "../v2/card-game/reflections.mjs";

// reflections.mjs is the rules half of narrative.mjs: the checks a shared
// speech commit makes before saving a thought, persona or dream. Until the
// shared engine switches to it, it must agree with the original exactly
// (docs/design/pack-content-outside-the-engine.md).
const shared = { claimed: ["vale"], present: ["vale"] };
function* scenes() {
  let world = dispatchShared({ op: "create" }).world;
  for (let step = 0; step < 24; step++) {
    const options = dispatchShared({
      op: "view",
      world,
      actor: "vale",
      ...shared,
    }).actions;
    let action, played;
    for (let i = 0; !played?.ok && i < options.length; i++) {
      action = options[(step * 5 + i) % options.length];
      try {
        played = dispatchShared({
          op: "play",
          world,
          actor: "vale",
          action,
          ...shared,
        });
      } catch {
        played = null;
      }
    }
    world = played.world;
    yield { world: { ...world, playerActorId: "vale", ...shared }, action };
  }
}

it("reads the same reflection context as the narrative", () => {
  for (const { world, action } of scenes()) {
    const told = narrativeContext(world, action);
    expect(reflectionContext(world, action)).toEqual({
      turn: told.turn,
      resting: told.resting,
      ...(told.rest ? { rest: told.rest } : {}),
      entities: told.entities.map(({ id, memories }) => ({ id, memories })),
    });
  }
});

it("commits and refuses the same shared reflections as the narrative", () => {
  const start = enableMotives(createWorld());
  start.actors.keeper.place = "station";
  start.items.lamp.holder = "vale";
  start.actors.vale.want = {
    kind: "item",
    target: "oil",
    since: 0,
    refusals: 0,
  };
  start.actors.keeper.want = null;
  const ask = legalActions(start).find(
    (a) => a.kind === "ask" && a.item === "oil",
  );
  const world = dispatchShared({
    op: "create",
    save: encodeSave(rest(play(start, ask).state, { dream: true })),
  }).world;
  const scene = { ...world, playerActorId: "vale", ...shared };
  const evidence = reflectionContext(scene)
    .entities.find((e) => e.id === "vale")
    .memories.filter((m) => m.kind === "event")
    .map((m) => m.seq);
  const entry = {
    id: "vale",
    reflection: {
      thought: "I expected an easy gift. I should offer something useful.",
      persona: "I am learning to listen before I ask again.",
      dream: "A small boat carried a gift across the pond.",
      evidence,
    },
  };
  const ours = structuredClone(scene);
  const theirs = structuredClone(scene);
  applySharedReflections(ours, [entry]);
  narrativeReflections(theirs, [entry]);
  expect(ours.memories.vale.innerLife.persona).toContain("listen");
  expect(ours).toEqual(theirs);
  const wrong = [
    { ...entry, reflection: { ...entry.reflection, evidence: [999999] } },
  ];
  expect(() => applySharedReflections(structuredClone(scene), wrong)).toThrow(
    "Use a reflection grounded in the saved scene.",
  );
  expect(() => narrativeReflections(structuredClone(scene), wrong)).toThrow(
    "Use a reflection grounded in the saved scene.",
  );
});
