import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave, legalActions, play, sanctuaries, wantAPI } from "../v2/card-game/world.mjs";
import { humanAvatarIds, seatActors } from "../v2/card-game/human-cast.mjs";
import { newWant, restStep } from "../v2/card-game/want.mjs";

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

  it("raises the level on a long sleep at the rest step's place, paying no XP", () => {
    let world = fixture();
    world.actors.rue.want = { ...newWant("place", "attic", 0), step: { verb: "rest" }, quest: { level: 2, left: 1 } };
    world = decodeSave(JSON.stringify(world));
    world.actors.rue.place = world.actors.rue.want.target;
    world.items.lamp.lit = false;
    world.actors.moth.place = "station";
    const before = world.actors.rue.xp;
    world = act(world, (a) => a.kind === "wait" && !a.sleep);
    for (let i = 0; i < 70 && world.actors.rue.want; i++)
      world = act(world, (a) => a.sleep);
    expect(world.actors.rue.want).toBeNull();
    expect(world.actors.rue.level).toBe(2);
    expect(world.actors.rue.xp).toBe(before);
    expect(world.actors.rue.questRewards).toBeUndefined();
    expect(legalActions(world).some((a) => a.kind === "claim")).toBe(false);
  });
});
