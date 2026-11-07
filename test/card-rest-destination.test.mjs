import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave, legalActions, play, sanctuaries, wantAPI } from "../v2/card-game/world.mjs";
import { humanAvatarIds, seatActors } from "../v2/card-game/human-cast.mjs";
import { newWant, questRewardsOf, restStep } from "../v2/card-game/want.mjs";

const fixture = (actor = "rue") => {
  const world = createWorld();
  world.sharedVersion = 1;
  world.playerActorId = actor;
  seatActors(world, [actor], [actor]);
  world.actors[actor].metTurn = 0;
  return world;
};
const act = (world, choose) => {
  const action = legalActions(world).find(choose);
  expect(action).toBeTruthy();
  const result = play(world, action, world.revision);
  expect(result.ok).toBe(true);
  return result.state;
};

describe("rest quest destinations", () => {
  it.each(humanAvatarIds)("gives %s a sanctuary where a long sleep can finish", (actor) => {
    const world = fixture(actor);
    expect(sanctuaries).toContain(restStep(world, actor, wantAPI(world)).target);
    world.actors[actor].sanctuary = "greek-sanctuary";
    expect(restStep(world, actor, wantAPI(world)).target).toBe("greek-sanctuary");
  });

  it("repairs Rue's saved carriage step and preserves its level and identity", () => {
    const world = fixture();
    const rest = { ...newWant("place", "train", 0), step: { verb: "rest" }, quest: { level: 2, left: 1 } };
    world.actors.rue.want = rest;
    const saved = decodeSave(JSON.stringify(world));
    expect(saved.actors.rue.want).toEqual({ ...rest, target: "attic" });
    expect(decodeSave(encodeSave(saved))).toEqual(saved);
  });

  it("checks the repaired card after long sleep and pays its reward once", () => {
    let world = fixture();
    world.actors.rue.want = { ...newWant("place", "train", 0), step: { verb: "rest" }, quest: { level: 2, left: 1 } };
    world = decodeSave(JSON.stringify(world));
    world.actors.rue.place = world.actors.rue.want.target;
    world.items.lamp.lit = false;
    world.actors.moth.place = "station";
    world = act(world, (a) => a.kind === "wait" && !a.sleep);
    for (let i = 0; i < 70 && !questRewardsOf(world, "rue").length; i++)
      world = act(world, (a) => a.sleep);
    expect(questRewardsOf(world, "rue")).toHaveLength(1);
    const receipt = questRewardsOf(world, "rue")[0];
    expect(receipt.want).toMatchObject({ target: "attic", step: { verb: "rest" } });
    const before = world.actors.rue.xp;
    world = act(decodeSave(encodeSave(world)), (a) => a.kind === "claim" && a.receipt === receipt.id);
    expect(world.actors.rue.xp).toBe(before + receipt.xp);
    expect(world.actors.rue.level).toBe(2);
    expect(legalActions(world).some((a) => a.kind === "claim" && a.receipt === receipt.id)).toBe(false);
  });
});
