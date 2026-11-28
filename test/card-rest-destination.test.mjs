import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, homeOf, legalActions, wantAPI } from "../v2/card-game/world.mjs";
import { humanAvatarIds, seatActors } from "../v2/card-game/human-cast.mjs";
import { DREAM_FROM, sleepQuest } from "../v2/card-game/want.mjs";
import { restsAt } from "../v2/card-game/world/home.mjs";
import { act } from "./helpers/play.mjs";

const fixture = (actor = "rue") => {
  const world = createWorld();
  world.sharedVersion = 1;
  world.playerActorId = actor;
  seatActors(world, [actor], [actor]);
  world.actors[actor].metTurn = 0;
  return world;
};

describe("rest quest destinations", () => {
  it.each(humanAvatarIds)("gives %s Sleep at their own home, where a long sleep can finish", (actor) => {
    const world = fixture(actor);
    world.actors[actor].sanctuary = "greek-sanctuary";
    const step = sleepQuest(world, actor, wantAPI(world));
    expect(step).toMatchObject({ target: homeOf(actor), step: { verb: "rest" }, from: DREAM_FROM });
    expect(restsAt(actor, step.target)).toBe(true);
  });

  it("meets the sleep quest on a long sleep at home, paying no XP", () => {
    let world = fixture();
    sleepQuest(world, "rue", wantAPI(world));
    world = decodeSave(JSON.stringify(world));
    world.actors.rue.place = world.actors.rue.want.target;
    world.items.lamp.lit = false;
    world.actors.moth.place = "station";
    const before = world.actors.rue.xp;
    world = act(world, (a) => a.kind === "wait" && !a.sleep, "rue");
    for (let i = 0; i < 70 && world.actors.rue.want; i++)
      world = act(world, (a) => a.sleep, "rue");
    expect(world.actors.rue.want).toBeNull();
    expect(world.actors.rue.xp).toBe(before);
    expect(world.actors.rue.questRewards).toBeUndefined();
    expect(legalActions(world).some((a) => a.kind === "claim")).toBe(false);
  });
});
