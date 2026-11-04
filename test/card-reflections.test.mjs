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
import { DAYLIGHT_TURNS } from "../v2/card-game/daylight.mjs";
import { questXp } from "../v2/card-game/want.mjs";
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
      ...(told.dream ? { dream: told.dream } : {}),
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

// A shared world journals reflections after their speech (#2016). The later
// `reflect` op is dated to the speech's turn, and a world without it is whole.
it("dates a later shared reflection to its speech and refuses stale ones", () => {
  const start = enableMotives(createWorld());
  start.actors.keeper.place = "station";
  const world = dispatchShared({
    op: "create",
    save: encodeSave(rest(start)),
  }).world;
  const context = reflectionContext({
    ...world,
    playerActorId: "vale",
    ...shared,
  });
  const evidence = context.entities
    .find((e) => e.id === "vale")
    .memories.filter((m) => m.kind === "event")
    .map((m) => m.seq);
  const entry = {
    id: "vale",
    model: "test-model",
    reflection: {
      thought: "The keeper kept the light. I should thank him.",
      persona: "I am someone who notices small kindnesses.",
      evidence,
    },
  };
  const spoke = context.turn;
  const scene = { resting: context.resting, rest: context.rest ?? null };
  expect(scene.resting).toBe("vale");
  // Another play lands before the reflection does.
  const wait = dispatchShared({
    op: "view",
    world,
    actor: "vale",
    ...shared,
  }).actions.find((a) => a.key?.startsWith("wait") || a.kind === "wait");
  const later = dispatchShared({
    op: "play",
    world,
    actor: "vale",
    action: wait,
    ...shared,
  }).world;
  expect(later.turn).toBeGreaterThan(spoke);
  const reflect = (w, request) =>
    dispatchShared({
      op: "reflect",
      world: w,
      actor: "vale",
      ...shared,
      ...request,
    });
  const done = reflect(later, {
    turn: spoke,
    ...scene,
    entries: [entry],
  }).world;
  const life = done.memories.vale.innerLife;
  expect(life.thoughts.at(-1)).toEqual({
    turn: spoke,
    text: entry.reflection.thought,
  });
  expect(done.memories.vale.reflections.at(-1).turn).toBe(spoke);
  expect(
    done.memories.vale.reflections.at(-1).sources.map((s) => s.seq),
  ).toEqual(evidence);
  expect(done.revision).toBe(later.revision + 1);
  // Only memory changes: the rules state is otherwise the same.
  const { memories: _a, revision: _b, ...rulesAfter } = done;
  const { memories: _c, revision: _d, ...rulesBefore } = later;
  expect(rulesAfter).toEqual(rulesBefore);
  // Replays the same way, and a second copy is no longer due.
  expect(
    reflect(later, { turn: spoke, ...scene, entries: [entry] }).world,
  ).toEqual(done);
  expect(() =>
    reflect(done, { turn: spoke, ...scene, entries: [entry] }),
  ).toThrow("Use a reflection grounded in the saved scene.");
  // A future turn, missing evidence, or a non-avatar is refused.
  expect(() =>
    reflect(later, { ...scene, turn: later.turn + 1, entries: [entry] }),
  ).toThrow("Use the saved scene's character reflections.");
  for (const bad of [
    { ...entry, reflection: { ...entry.reflection, evidence: [999999] } },
    { ...entry, reflection: { ...entry.reflection, evidence: [] } },
    { ...entry, id: "station" },
  ])
    expect(() =>
      reflect(later, { turn: spoke, ...scene, entries: [bad] }),
    ).toThrow();
  // The journaled rest gates the thought: no resting avatar, another avatar,
  // or a long rest the log does not hold is refused.
  for (const bad of [
    { resting: null, rest: null },
    { resting: null, rest: "long" },
    { resting: "moth", rest: null },
    { resting: "vale", rest: "long" },
    { resting: "vale", rest: "short" },
  ])
    expect(
      () => reflect(later, { turn: spoke, ...bad, entries: [entry] }),
      JSON.stringify(bad),
    ).toThrow();
  // The world without the reflection is valid as it stands.
  expect(
    dispatchShared({ op: "validate", world: later, actor: "vale", ...shared })
      .world,
  ).toEqual(later);
});

it("accepts a later reflection after a real Sleep long rest at a sanctuary", () => {
  let s = enableMotives(createWorld());
  s.actors.vale.place = "attic";
  // With the experience for level 2, the rest dreams the level quest: the
  // only long rests that dream (rules 99).
  Object.assign(s.actors.vale, { level: 1, xp: questXp(2) });
  const pick = (test) => (s = play(s, legalActions(s).find(test)).state);
  pick((a) => a.kind === "wait");
  pick((a) => a.sleep);
  const waking = s.log.at(-1);
  expect(waking).toMatchObject({
    actorId: "vale",
    verb: "wait",
    rest: "long",
    dream: "quest",
  });
  const world = dispatchShared({ op: "create", save: encodeSave(s) }).world;
  const context = reflectionContext({
    ...world,
    playerActorId: "vale",
    ...shared,
  });
  expect(context).toMatchObject({
    turn: waking.turn,
    resting: "vale",
    rest: "long",
    dream: "quest",
  });
  const evidence = context.entities
    .find((e) => e.id === "vale")
    .memories.filter((m) => m.kind === "event")
    .map((m) => m.seq);
  const entry = {
    id: "vale",
    model: "test-model",
    reflection: {
      thought: "I slept until the lamp guttered. Pip came up the stairs.",
      persona: "I am someone who keeps watch even in sleep.",
      dream: "A shore of black glass, and a lamp that would not go out.",
      evidence,
    },
  };
  const done = dispatchShared({
    op: "reflect",
    world,
    actor: "vale",
    ...shared,
    turn: waking.turn,
    resting: "vale",
    rest: "long",
    entries: [entry],
  }).world;
  const life = done.memories.vale.innerLife;
  expect(life.thoughts.at(-1)).toEqual({
    turn: waking.turn,
    text: entry.reflection.thought,
  });
  expect(life.dreams.at(-1)).toEqual({
    turn: waking.turn,
    text: entry.reflection.dream,
  });
  // An ordinary long rest brings a thought and no dream.
  let plain = enableMotives(createWorld());
  plain.actors.vale.place = "attic";
  for (const test of [(a) => a.kind === "wait", (a) => a.sleep])
    plain = play(plain, legalActions(plain).find(test)).state;
  expect(plain.log.at(-1)).toMatchObject({ rest: "long" });
  expect(plain.log.at(-1).dream).toBeUndefined();
  const ordinary = dispatchShared({
    op: "create",
    save: encodeSave(plain),
  }).world;
  const later = (reflection) =>
    dispatchShared({
      op: "reflect",
      world: ordinary,
      actor: "vale",
      ...shared,
      turn: plain.log.at(-1).turn,
      resting: "vale",
      rest: "long",
      entries: [{ ...entry, reflection }],
    }).world;
  const { dream: _dream, ...thought } = entry.reflection;
  thought.evidence = reflectionContext({
    ...ordinary,
    playerActorId: "vale",
    ...shared,
  })
    .entities.find((e) => e.id === "vale")
    .memories.filter((m) => m.kind === "event")
    .map((m) => m.seq);
  expect(() => later({ ...thought, dream: entry.reflection.dream })).toThrow(
    "Use a reflection grounded in the saved scene.",
  );
  expect(later(thought).memories.vale.innerLife.dreams).toEqual([]);
});

it("gives a shared sleeper woken by another seat's play its dream at its own next scene", () => {
  let s = enableMotives(createWorld());
  s.actors.vale.place = "attic";
  // Pip and BoardyAI, who would come up the stair, are elsewhere and want
  // nothing, and the Sleep starts as the light changes.
  s.actors.moth.place = "station";
  s.actors.boardyai.place = "greek-palace";
  s.actors.moth.want = s.actors.boardyai.want = null;
  // Due its level quest, so the long rest dreams (rules 99).
  Object.assign(s.actors.vale, { level: 1, xp: questXp(2) });
  s.turn = s.revision = DAYLIGHT_TURNS + 1;
  const seats = { claimed: ["vale", "mara"], present: ["vale", "mara"] };
  let world = dispatchShared({ op: "create", save: encodeSave(s) }).world;
  const run = (actor, pick) => {
    const { actions } = dispatchShared({ op: "view", world, actor, ...seats });
    const action = actions.find(pick);
    expect(action, `${actor} can play`).toBeTruthy();
    const done = dispatchShared({ op: "play", world, actor, action, ...seats });
    expect(done.ok, done.error).toBe(true);
    world = done.world;
  };
  run("vale", (a) => a.kind === "wait");
  run("vale", (a) => a.sleep);
  // Mara's plays move the shared clock until the light wakes Vale.
  while (world.actors.vale.sleeping) run("mara", (a) => a.kind === "wait");
  const waking = world.log.findLast((e) => e.woke);
  expect(waking).toMatchObject({
    actorId: "vale",
    turn: 2 * DAYLIGHT_TURNS,
    rest: "long",
  });
  // Mara's own scene is not Vale's rest.
  const own = (actor) =>
    dispatchShared({ op: "view", world, actor, ...seats }).world;
  expect(reflectionContext(own("mara"))).toMatchObject({ resting: "mara" });
  expect(reflectionContext(own("mara")).rest).toBeUndefined();
  // Vale's next play, whatever it is, is the scene she wakes into.
  run("vale", (a) => a.kind === "move");
  const context = reflectionContext(own("vale"));
  expect(context).toMatchObject({
    turn: world.turn,
    resting: "vale",
    rest: "long",
  });
  const evidence = context.entities
    .find((e) => e.id === "vale")
    .memories.filter((m) => m.kind === "event")
    .map((m) => m.seq);
  const entry = {
    id: "vale",
    model: "test-model",
    reflection: {
      thought: "I slept the whole light through and woke to the dawn.",
      persona: "I am someone who rests where the lamp once burned.",
      dream: "A stair of lamps, each one going out as I passed.",
      evidence,
    },
  };
  const done = dispatchShared({
    op: "reflect",
    world,
    actor: "vale",
    ...seats,
    turn: world.turn,
    resting: "vale",
    rest: "long",
    entries: [entry],
  }).world;
  expect(done.memories.vale.innerLife.dreams.at(-1)).toEqual({
    turn: world.turn,
    text: entry.reflection.dream,
  });
  // Only once: her play after that is no longer the waking scene.
  run("vale", (a) => a.kind === "wait" && !a.sleep);
  expect(reflectionContext(own("vale")).rest).toBeUndefined();
});
