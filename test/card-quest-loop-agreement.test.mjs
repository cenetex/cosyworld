// The quest loop (rules 99) on the server: the current rules bundle, as the
// shared host runs it with its content, and the browser's own modules must commit
// the same worlds through the quest loop: a Talk quest given and met, the
// halfway quest to sleep at a sanctuary, its glimpse, and the level quest's
// dream that honours it. The same requests replay to the same world.
import { describe, expect, it } from "vitest";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { questsOf } from "../v2/card-game/want.mjs";
import { honours } from "../v2/card-game/glimpse.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";

const seats = { claimed: ["vale"], present: ["vale"] };

// Vale at level I, one want short of halfway, with the keeper in the attic.
// The keeper wants the bell, which Vale holds.
export function questLoopStart() {
  const world = dispatchShared({ op: "create", seed: 9 }).world;
  delete world.opening;
  world.turn = world.revision = 2;
  world.actors.vale.place = world.actors.keeper.place = "attic";
  world.items.lamp.holder = "vale";
  world.actors.vale.heldItem = "bell";
  world.items.bell.holder = "vale";
  world.actors.keeper.want = {
    kind: "item",
    target: "bell",
    since: 2,
    refusals: 0,
  };
  Object.assign(world.actors.vale, {
    level: 1,
    xp: 1,
    want: { kind: "place", target: "pond", since: 0, refusals: 0 },
  });
  return world;
}

// Each play is chosen from the view, played on both sides and compared.
function playLoop(server) {
  const both = (request) => {
    const local = dispatchShared(structuredClone(request));
    if (server) expect(server(structuredClone(request))).toEqual(local);
    return local;
  };
  const requests = [];
  let world = both({
    op: "validate",
    world: questLoopStart(),
    ...seats,
    actor: "vale",
  }).world;
  const run = (pick) => {
    const { actions } = both({ op: "view", world, actor: "vale", ...seats });
    const action = actions.find(pick);
    expect(action, String(pick)).toBeTruthy();
    const request = { op: "play", world, actor: "vale", action, ...seats };
    requests.push(action.key);
    const done = both(request);
    expect(done.ok, done.error).toBe(true);
    world = done.world;
  };
  const hold = (item) => {
    world = both({
      op: "hold",
      world,
      actor: "vale",
      ...seats,
      choice: { item, revision: world.revision },
    }).world;
  };
  const woke = () =>
    world.log.findLast((e) => e.actorId === "vale" && e.woke !== undefined);
  const longRest = () => {
    run((a) => a.kind === "wait" && !a.sleep);
    for (let i = 0; i < 24; i++) {
      run((a) => a.sleep);
      if (woke()?.turn === world.turn && woke().rest === "long") return;
      if (!world.actors.vale.sleeping)
        run((a) => a.kind === "wait" && !a.sleep);
    }
    throw new Error("no long rest");
  };
  run((a) => a.kind === "talk" && a.target === "keeper");
  const talked = structuredClone(world);
  run((a) => a.kind === "give" && a.target === "keeper" && a.item === "bell");
  hold(null); // Keep the carried lamp dark while resting and leaving the attic.
  run((a) => a.kind === "claim");
  const halfway = structuredClone(world);
  longRest();
  const glimpsed = structuredClone(world);
  const glimpseWake = structuredClone(woke());
  run((a) => a.kind === "move" && a.target === "pond");
  run((a) => a.kind === "claim");
  // Three-room fuel never burns out during rest. Hold the carried lamp on
  // the shore to open the ordinary mirror, rather than relying on dry-oil rescue.
  hold("lamp");
  run((a) => a.kind === "move" && a.target === "attic");
  longRest();
  return {
    talked,
    halfway,
    glimpsed,
    glimpseWake,
    quest: world,
    questWake: woke(),
    requests,
  };
}

describe("rules 99 quest loop on the server", () => {
  it("commits the same worlds as the browser rules, and replays", () => {
    // The current bundle: rules 99 made the loop, later rules keep it.
    const engine = currentSharedEngine();
    const loop = playLoop((request) =>
      JSON.parse(engine.cardShared(JSON.stringify(request))),
    );
    // The Talk quest and its record.
    expect(questsOf(loop.talked, "vale")[1]).toMatchObject({
      kind: "item",
      target: "bell",
      step: { verb: "give", to: "keeper" },
    });
    expect(loop.talked.actors.vale.heard).toEqual({ keeper: "item:bell" });
    // Met, it reaches halfway: the quest to sleep at a sanctuary.
    expect(loop.halfway.actors.vale).toMatchObject({ xp: 2, halfwayIssued: 2 });
    expect(
      questsOf(loop.halfway, "vale").some((w) => w.step?.verb === "rest"),
    ).toBe(false);
    // Its long rest dreams the glimpse; the next, at full, the level quest.
    expect(loop.glimpseWake).toMatchObject({ rest: "long", dream: "glimpse" });
    const glimpse = loop.glimpsed.actors.vale.glimpse;
    expect(glimpse).toEqual({
      level: 2,
      kind: "place",
      id: "attic",
      at: "attic",
    });
    expect(loop.questWake).toMatchObject({ rest: "long", dream: "quest" });
    const level = questsOf(loop.quest, "vale").find((w) => w.quest);
    expect(level?.quest.level).toBe(2);
    expect(honours(level, glimpse)).toBe(true);
    // The same plays from the same start replay to the same world.
    expect(playLoop(null).quest).toEqual(loop.quest);
  }, 120_000);
});
