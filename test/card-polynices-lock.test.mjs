import { expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  plan,
  play,
  questOffers,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { isLockedBox, lockedQuest } from "../v2/card-game/locked-box.mjs";
import { lifeHome } from "../v2/card-game/resident-home.mjs";
import { packTalkChoice } from "../v2/card-game/pack-registry.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";

const pack = "greek-drama",
  field = "greek-battlefield",
  hollow = "greek-polynices-hollow";
const shade = "greek-polynices-shade",
  antigone = "greek-antigone",
  heard = "greek-polynices-heard";
const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
function start(shared = false) {
  const world = shared
    ? dispatchShared({ op: "create", seed: 9 }).world
    : createWorld();
  world.turn = world.revision = 36;
  delete world.opening;
  world.crossings["pond-greek-harbor"].discovered = true;
  world.actors.vale.place = world.actors[antigone].place = field;
  world.actors.vale.visited.push("pond", "greek-gate", field);
  world.items["greek-creon-writ"].holder = "greek-guard";
  world.packs[pack].met[shade] = 35;
  return world;
}

it("holds the box's quest at once, on top of one already held (rules 134)", () => {
  const free = start();
  const stands = (w) =>
    questOffers(w).find((o) => o.id === `quest:box:${hollow}`);
  expect(stands(free)).toBeTruthy();
  const held = structuredClone(free);
  held.actors.vale.want = {
    kind: "place",
    target: "pond",
    since: 0,
    refusals: 0,
  };
  // The offer still stands for a player holding another quest.
  expect(stands(held)).toBeTruthy();
  const wait = (w) =>
    play(w, legalActions(w).find((a) => a.kind === "wait" && !a.sleep)).state;
  const next = wait(free);
  expect(next.actors.vale.want).toMatchObject({ target: shade });
  expect(stands(next)).toBeUndefined();
  // Newest on top: the earlier quest lies beneath it.
  const stacked = wait(held);
  expect(stacked.actors.vale.want).toMatchObject({ target: shade });
  expect(stacked.actors.vale.under[0]).toMatchObject({ target: "pond" });
});

it.each([
  [false, 36],
  [true, 36],
  [false, 47],
  [true, 47],
])(
  "opens the same route through a player's Talk (shared: %s, turn: %s)",
  (shared, turnOfNight) => {
    const engine = shared && currentSharedEngine();
    const requests = [];
    const both = (request) => {
      const local = dispatchShared(structuredClone(request));
      expect(JSON.parse(engine.cardShared(JSON.stringify(request)))).toEqual(
        local,
      );
      requests.push(structuredClone([request, local]));
      return local;
    };
    let world = start(shared);
    // One Wait holds the quest standing at the box (rules 134); the clock
    // starts a turn early so the night hour is the one under test.
    world.turn = world.revision = turnOfNight - 1;
    const act = (kind, target) => {
      const actions = shared
        ? both({ op: "view", world, ...seats }).actions
        : legalActions(world);
      const action = actions.find(
        (a) =>
          a.kind === kind &&
          (a.target === target || (kind === "wait" && !a.sleep)),
      );
      expect(action, kind).toBeTruthy();
      const result = shared
        ? both({ op: "play", world, action, ...seats })
        : play(world, action);
      expect(result.ok, result.error).toBe(true);
      world = result.world || result.state;
    };
    for (const actor of ["vale", antigone])
      expect(exits(world, field, actor)).not.toContain(hollow);
    act("wait");
    expect(world.turn).toBe(turnOfNight);
    expect(plan(world, antigone).action?.target).not.toBe(hollow);
    expect(lifeHome(antigone, world)).toBe(hollow);
    expect(isLockedBox(world, hollow)).toBe(true);
    expect(lockedQuest(world, hollow).cards).toEqual([]);
    expect(world.actors.vale.want).toMatchObject({
      kind: "person",
      target: shade,
    });
    expect(isLockedBox(world, hollow)).toBe(true);
    act("talk", shade);
    expect(world.packs[pack].flags[heard]).toBe(true);
    expect(world.packs[pack].receipts["greek-hear-polynices"]).toBe(world.turn);
    expect(lifeHome(antigone, world)).toBe(hollow);
    for (const actor of ["vale", antigone])
      expect(exits(world, field, actor)).toContain(hollow);
    expect(world.actors[antigone].place).toBe(hollow);
    world.turn = world.revision = 48;
    const dawn = decodeSave(encodeSave(world));
    expect(isLockedBox(dawn, hollow)).toBe(false);
    expect(exits(dawn, field, antigone)).toContain(hollow);
    for (const [request, expected] of requests)
      expect(JSON.parse(engine.cardShared(JSON.stringify(request)))).toEqual(
        expected,
      );
  },
);

it("keeps NPC Talk outside the player's unlock choice", () => {
  const world = start();
  const action = legalActions(world, antigone).find(
    (a) => a.kind === "talk" && a.target === shade,
  );
  expect(action).toBeTruthy();
  expect(packTalkChoice(world, action)).toBe(null);
  expect(world.packs[pack].flags[heard]).toBeUndefined();
  expect(exits(world, field, antigone)).not.toContain(hollow);
});
