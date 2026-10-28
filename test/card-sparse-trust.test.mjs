import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  plan,
  play,
  refreshQuestProgress,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { requestConditions } from "../v2/card-game/learning.mjs";
import { addQuestRecord } from "../v2/card-game/shared-quests.mjs";
import { at, hand } from "../v2/card-game/quests.mjs";
import { trustValue } from "../v2/card-game/trust.mjs";
import { releasedCardEngine } from "./helpers/released-card-engine.mjs";

function expanded(world) {
  const copy = structuredClone(world);
  for (const [id, actor] of Object.entries(copy.actors))
    actor.trust = Object.fromEntries(
      Object.keys(copy.actors)
        .filter((other) => other !== id)
        .map((other) => [other, trustValue(world, id, other)]),
    );
  return copy;
}
function setup() {
  const world = enableMotives(createWorld());
  world.actors.keeper.place = "station";
  world.items.lamp.holder = "vale";
  world.items.bell.holder = "vale";
  world.items.cloth.holder = "keeper";
  return world;
}
function sparse(world) {
  const copy = structuredClone(world);
  for (const actor of Object.values(copy.actors))
    actor.trust = Object.fromEntries(
      Object.entries(actor.trust).filter(([, value]) => value > 0),
    );
  return copy;
}
const roundTrip = (world) => decodeSave(encodeSave(world));

describe("rules21 sparse zero trust", () => {
  it("keeps every earlier explicit entry and adds empty new rows on upgrade", () => {
    const old = releasedCardEngine(20).dispatch({ op: "create" }).world;
    const ids = Object.keys(old.actors);
    // Exercise every valid integer, including the earlier explicit zeros.
    for (const [i, actor] of Object.values(old.actors).entries())
      for (const [j, other] of Object.keys(actor.trust).entries())
        actor.trust[other] = (i + j) % 4;
    const before = structuredClone(old);
    const after = roundTrip(decodeSave(JSON.stringify(old)));
    for (const id of ids)
      expect(after.actors[id].trust).toEqual(before.actors[id].trust);
    for (const id of Object.keys(after.actors).filter(
      (id) => !before.actors[id],
    )) {
      expect(after.actors[id].trust).toEqual({});
      for (const other of ids) {
        expect(trustValue(after, id, other)).toBe(0);
        expect(trustValue(after, other, id)).toBe(0);
      }
    }
    expect(old).toEqual(before);
  });

  it("keeps explicit zero entries in a current dense save", () => {
    const before = expanded(setup());
    expect(roundTrip(before)).toEqual(before);
    const fresh = createWorld();
    expect(fresh.actors.vale.trust).toEqual({ moth: 0, keeper: 0 });
    expect(fresh.actors.mara.trust).toEqual({});
  });

  it.each([false, true])(
    "keeps choices, plans, observations and results equal through real plays: shared=%s",
    (shared) => {
      let light = sparse(setup());
      if (shared)
        light = dispatchShared({ op: "create", save: encodeSave(light) }).world;
      let dense = expanded(light);
      for (const [kind, item, target] of [
        ["ask", "cloth", "keeper"],
        ["give", "bell", "keeper"],
        ["ask", "cloth", "keeper"],
        ["talk", undefined, "keeper"],
        ["wait"],
      ]) {
        expect(legalActions(light)).toEqual(legalActions(dense));
        expect(plan(light)).toEqual(plan(dense));
        expect(narrativeContext(light)).toEqual(narrativeContext(dense));
        const action = legalActions(light).find(
          (action) =>
            action.kind === kind &&
            (item === undefined || action.item === item) &&
            (target === undefined || action.target === target),
        );
        expect(action, kind).toBeDefined();
        expect(requestConditions(light, action)).toBe(
          requestConditions(dense, action),
        );
        const apply = (world) =>
          shared
            ? dispatchShared({
                op: "play",
                actor: "vale",
                claimed: ["vale"],
                present: ["vale"],
                world,
                action,
              })
            : play(world, action);
        const a = apply(light),
          b = apply(dense);
        expect(a.ok, a.error).toBe(true);
        expect(b.ok, b.error).toBe(true);
        light = roundTrip(a.world || a.state);
        dense = roundTrip(b.world || b.state);
        expect(expanded(light)).toEqual(expanded(dense));
        expect(light.memories.vale.learning).toEqual(
          dense.memories.vale.learning,
        );
      }
      expect(
        light.memories.vale.learning.some(
          (trial) => trial.after.trust > trial.before.trust,
        ),
      ).toBe(true);
    },
  );

  it("adds a quest reward from an absent zero exactly once", () => {
    const world = enableMotives(setup(), { questPrograms: true });
    delete world.actors.keeper.trust.vale;
    const quest = addQuestRecord(world, {
      holder: { kind: "avatar", id: "vale" },
      subjectActor: "vale",
      program: {
        id: "sparse-help",
        name: "Help at the station",
        steps: [
          {
            ...hand(at("station")),
            consequence: { kind: "trust", avatar: "keeper" },
          },
        ],
      },
    });
    world.turn++;
    world.revision++;
    refreshQuestProgress(world);
    expect(world.actors.keeper.trust.vale).toBe(1);
    expect(quest.completion).toBeDefined();
    const completed = roundTrip(world);
    refreshQuestProgress(world);
    expect(world).toEqual(completed);
  });

  it("keeps helper order across trust insertion order and host key order", () => {
    const world = setup();
    world.actors.keeper.trust = { moth: 2, vale: 1 };
    const reordered = JSON.parse(
      JSON.stringify(world, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .reverse()
                .map((key) => [key, value[key]]),
            )
          : value,
      ),
    );
    const helpers = (state) =>
      narrativeContext(state)
        .entities.find((entity) => entity.id === "keeper")
        .facts.find((fact) => fact.startsWith("Owes a favour"));
    expect(helpers(reordered)).toBe(helpers(world));
    expect(helpers(world)).toContain("Vale and Pip");
    expect(plan(reordered)).toEqual(plan(world));
  });

  it.each([
    null,
    [],
    0,
    "zero",
    { stranger: 0 },
    { vale: 1 },
    { keeper: -1 },
    { keeper: 4 },
    { keeper: 0.5 },
    { keeper: "0" },
    { keeper: null },
  ])("checks peer identity, shape and value: %j", (trust) => {
    const world = setup();
    world.actors.vale.trust = trust;
    expect(() => validateWorld(world)).toThrow();
  });

  it("checks an earlier dense row before its catalog upgrade", () => {
    const world = releasedCardEngine(20).dispatch({ op: "create" }).world;
    delete world.actors.vale.trust.moth;
    expect(() => decodeSave(JSON.stringify(world))).toThrow("trust records");
  });
});
