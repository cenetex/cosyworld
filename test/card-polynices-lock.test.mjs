import { expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  plan,
  play,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { isLockedBox, lockedQuest } from "../v2/card-game/locked-box.mjs";
import { lifeHome } from "../v2/card-game/resident-home.mjs";
import {
  packDefinition,
  packTalkChoice,
} from "../v2/card-game/pack-registry.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

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

it("offers the box's quest only to a player holding no want (rules 133)", () => {
  const free = start();
  const gate = (w) =>
    legalActions(w).find(
      (a) => a.kind === "take" && a.offer === `quest:box:${hollow}`,
    );
  expect(gate(free)).toBeTruthy();
  const held = structuredClone(free);
  held.actors.vale.want = {
    kind: "place",
    target: "pond",
    since: 0,
    refusals: 0,
  };
  expect(gate(held)).toBeUndefined();
  const next = play(free, gate(free)).state;
  expect(next.actors.vale.want).toMatchObject({ target: shade });
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
    world.turn = world.revision = turnOfNight;
    const act = (kind, target) => {
      const actions = shared
        ? both({ op: "view", world, ...seats }).actions
        : legalActions(world);
      const action = actions.find(
        (a) => a.kind === kind && (a.target === target || a.offer === target),
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
    expect(plan(world, antigone).action?.target).not.toBe(hollow);
    expect(lifeHome(antigone, world)).toBe("greek-gate");
    expect(isLockedBox(world, hollow)).toBe(true);
    expect(lockedQuest(world, hollow).cards).toEqual([]);
    const turn = world.turn;
    act("take", `quest:box:${hollow}`);
    expect(world.turn).toBe(turn);
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
