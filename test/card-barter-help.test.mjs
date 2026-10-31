import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  plan,
  willingToGive,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { keepReason } from "../v2/card-game/life.mjs";

// The keeper wants Pip's lamp at the station. Pip was given the lamp by Vale.
function keepsake() {
  const world = createWorld();
  world.turn = world.revision = 20;
  world.actors.moth.place = world.actors.keeper.place = "station";
  world.items.lamp.holder = "moth";
  world.actors.moth.want = null;
  world.actors.moth.metTurn = 20;
  world.actors.keeper.want = {
    verb: "have",
    target: "lamp",
    since: 20,
    refusals: 0,
  };
  world.life.actors.moth.attachments.lamp = { from: "vale", turn: 1 };
  return decodeSave(encodeSave(world));
}

describe("a keepsake stays with its owner", () => {
  it("keeps a gifted lamp out of every offer and request", () => {
    const world = keepsake();
    expect(keepReason(world, "moth", "lamp")).toContain("A gift from");
    expect(willingToGive(world, "moth", "lamp", "keeper")).toBe(false);
    expect(plan(world, "moth").action).not.toMatchObject({
      kind: "give",
      item: "lamp",
    });
    let next = world;
    for (let i = 0; i < 3; i++)
      next = play(
        next,
        legalActions(next).find((a) => a.kind === "wait"),
      ).state;
    expect(next.items.lamp.holder).toBe("moth");
    expect(decodeSave(encodeSave(next))).toEqual(next);
  });
});
