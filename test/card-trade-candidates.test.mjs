import { expect, it } from "vitest";
import {
  createWorld,
  canTrade,
  legalActions,
  things,
  play,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";

it("keeps the full trade set and its order while considering nearby owned goods", () => {
  let world = enableMotives(createWorld(), { questPrograms: true });
  for (const actor of ["vale", "moth", "keeper"])
    world.actors[actor].place = "station";
  world.items.lamp.holder = "vale";
  world.items.oil.holder = "moth";
  const ids = Object.keys(things);
  let offered = 0;
  for (let turn = 0; turn < 24; turn++) {
    for (const actor of ["vale", "moth", "keeper"]) {
      const expected = ids.flatMap((give) =>
        ids
          .filter((receive) => canTrade(world, actor, give, receive))
          .map((receive) => [give, receive]),
      );
      const actual = legalActions(world, actor)
        .filter((a) => a.kind === "trade")
        .map((a) => [a.item, a.receive]);
      expect(actual).toEqual(expected);
      offered += actual.length;
    }
    const actions = legalActions(world);
    const action =
      actions.find((a) => a.kind === "trade") ||
      actions.find((a) => a.kind === (turn % 2 ? "give" : "take")) ||
      actions.find((a) => a.kind === "wait");
    const result = play(world, action);
    expect(result.ok).toBe(true);
    world = result.state;
  }
  expect(offered).toBeGreaterThan(0);
});
