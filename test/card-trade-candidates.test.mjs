import { expect, it } from "vitest";
import {
  createWorld,
  canTrade,
  tradePossible,
  legalActions,
  things,
  play,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";

it("offers every possible trade in order and only moves the accepted ones", () => {
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
          .filter((receive) => tradePossible(world, actor, give, receive))
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
    const willing =
      action.kind === "trade" &&
      canTrade(world, action.actor, action.item, action.receive);
    const result = play(world, action);
    expect(result.ok).toBe(true);
    if (action.kind === "trade") {
      expect(result.state.items[action.item].holder).toBe(
        willing ? action.target : action.actor,
      );
      // Residents may trade later in the same turn; read the player's own.
      expect(
        result.state.log.findLast(
          (e) => e.verb === "trade" && e.actorId === action.actor,
        ).accepted,
      ).toBe(willing);
    }
    world = result.state;
  }
  expect(offered).toBeGreaterThan(0);
});
