import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

const FIELD = "greek-battlefield",
  SHADE = "greek-polynices-shade";

function onTheField(turn) {
  const world = createWorld();
  world.crossings["pond-greek-harbor"].discovered = true;
  world.actors.vale.place = FIELD;
  world.turn = world.revision = turn;
  return world;
}
function step(world, pick) {
  const action = legalActions(world).find(pick);
  expect(action).toBeDefined();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return decodeSave(encodeSave(result.state));
}
function sleepThrough(world) {
  if (!world.actors.vale.sleeping)
    world = step(world, (a) => a.kind === "wait" && !a.sleep);
  world = step(world, (a) => a.sleep);
  for (let i = 0; i < 48 && world.actors.vale.sleeping; i++)
    world = step(world, (a) => a.sleep);
  expect(world.actors.vale.sleeping).toBeUndefined();
  return { world, woke: world.log.findLast((e) => e.woke) };
}
const canTalk = (world) =>
  legalActions(world).some((a) => a.kind === "talk" && a.target === SHADE);

describe("sleeping on the Exposed Battlefield", () => {
  it("is woken by Polynices' Shade when he appears before dawn", () => {
    let { world, woke } = sleepThrough(onTheField(30));
    expect(world.turn % 48).toBe(36);
    expect(woke).toMatchObject({ woke: "arrival" });
    expect(woke.text).toBe("Vale wakes as Polynices' Shade arrives.");
    expect(canTalk(world)).toBe(true);
  });

  it("wakes at dusk from a day's sleep, then to the Shade", () => {
    let { world, woke } = sleepThrough(onTheField(20));
    expect(woke).toMatchObject({ woke: "dusk" });
    expect(canTalk(world)).toBe(false);
    ({ world, woke } = sleepThrough(world));
    expect(woke).toMatchObject({ woke: "arrival" });
    expect(canTalk(world)).toBe(true);
  });

  it("sleeps through the night once he is buried", () => {
    const world = structuredClone(funeralJourney().buried);
    expect(world.packs["greek-drama"].flags["greek-burial-performed"]).toBe(
      true,
    );
    world.actors.vale.place = FIELD;
    world.turn = world.revision = 48 * Math.ceil(world.turn / 48) + 30;
    const { world: after, woke } = sleepThrough(decodeSave(encodeSave(world)));
    expect(woke).toMatchObject({ woke: "dawn" });
    expect(after.turn % 48).toBe(0);
  });
});
