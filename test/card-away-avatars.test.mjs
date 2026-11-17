import { describe, it, expect } from "vitest";
import "./helpers/no-dwell.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { heldOf } from "../v2/card-game/want.mjs";

const fresh = () => {
  const world = dispatchShared({ op: "create", seed: 7 }).world;
  for (const id of humanAvatarIds) {
    world.actors[id].want = null;
    delete world.actors[id].under;
  }
  return world;
};
const seat = (world, present, op = "view", extra = {}) =>
  dispatchShared({ world, op, actor: "vale", claimed: humanAvatarIds, present, ...extra });
const waitFor = (world, present = ["vale"]) => {
  const wait = seat(world, present).actions.find((a) => a.kind === "wait" && !a.sleep);
  return seat(world, present, "play", { action: wait }).world;
};
const giveQuest = (to, from) => ({
  kind: "item",
  target: "cloth",
  since: 0,
  refusals: 0,
  step: { verb: "give", to },
  from,
});
const plays = (world, id) =>
  world.log.filter((e) => e.actorId === id && e.kind === "action");

describe("an away avatar pursues its person's held quests", () => {
  it("fetches the item, gives it and closes the quest as met for its seat", () => {
    let world = fresh();
    world.actors.mara.place = "station";
    world.items.cloth.holder = "pond";
    world.actors.mara.want = { ...giveQuest("keeper", "quest:box:x"), story: true };
    for (let i = 0; i < 8 && heldOf(world.actors.mara).length; i++)
      world = waitFor(world);
    expect(world.items.cloth.holder).toBe("keeper");
    expect(heldOf(world.actors.mara)).toEqual([]);
    expect(Object.keys(world.actors.mara.closed)).toEqual(["quest:box:x"]);
    expect(plays(world, "mara").map((e) => e.verb)).toEqual(["move", "take", "move", "give"]);
  });
  it("counts a resident's quest toward the Listener", () => {
    let world = fresh();
    world.actors.mara.place = "pond";
    world.items.cloth.holder = "mara";
    world.actors.keeper.want = { kind: "item", target: "cloth", since: 0, refusals: 0 };
    world.actors.mara.want = giveQuest("keeper", "quest:from:keeper");
    world = waitFor(world);
    expect(world.items.cloth.holder).toBe("keeper");
    expect(world.actors.mara.arcana.callers).toEqual(["keeper"]);
  });
  it("walks home when it holds no quest", () => {
    let world = fresh();
    world.actors.rue.place = "pond";
    world.items.routes.holder = "rue";
    for (let i = 0; i < 4; i++) world = waitFor(world);
    expect(world.actors.rue.place).toBe("train");
    expect(world.items.routes.holder).toBe("rue");
  });
  it("never accepts, discards or gives away its belonging", () => {
    let world = fresh();
    world.actors.mara.place = "station";
    world.items.mask.holder = "mara";
    world.actors.mara.want = giveQuest("keeper", "quest:box:x");
    world.actors.mara.want.target = "mask";
    world.actors.mara.want.story = true;
    for (let i = 0; i < 30; i++) world = waitFor(world);
    expect(world.items.mask.holder).toBe("mara");
    expect(heldOf(world.actors.mara).map((w) => w.from)).toEqual(["quest:box:x"]);
    expect(
      plays(world, "mara").filter((e) => ["accept", "drop", "threaten", "attack"].includes(e.verb)),
    ).toEqual([]);
  });
  it("stops acting the round its person returns", () => {
    const world = fresh();
    world.actors.mara.place = "station";
    world.items.cloth.holder = "pond";
    world.actors.mara.want = { ...giveQuest("keeper", "quest:box:x"), story: true };
    const back = waitFor(world, ["vale", "mara"]);
    expect(back.actors.mara.place).toBe("station");
    expect(plays(back, "mara")).toEqual([]);
    expect(heldOf(back.actors.mara)).toHaveLength(1);
    expect(waitFor(world).actors.mara.place).toBe("pond");
  });
  it("is still no one's to ask or trade with", () => {
    const world = fresh();
    world.actors.mara.place = world.actors.vale.place;
    world.items.cloth.holder = "mara";
    const view = seat(world, ["vale"]);
    const at = view.actions.filter((a) => a.target === "mara" || a.receive === "cloth");
    expect(at.some((a) => a.kind === "trade")).toBe(false);
    const ask = at.find((a) => a.kind === "ask");
    expect(seat(world, ["vale"], "play", { action: ask }).world.items.cloth.holder).toBe("mara");
  });
});
