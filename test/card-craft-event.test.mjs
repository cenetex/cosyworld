import { expect, it } from "vitest";
import { decodeSave, encodeSave, legalActions, play, validateWorld } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";

const bread = "greek-bread", baker = "greek-baker", home = "greek-courtyard";
const inputs = ["greek-water-jar", "greek-wheat"];
function act(world, kind, fields = {}) {
  const action = legalActions(world).find((a) => a.kind === kind &&
    Object.entries(fields).every(([key, value]) => a[key] === value));
  expect(action).toBeTruthy();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
const bake = (world) => act(world, "give", { item: inputs[0], target: baker });
const crafts = (world) => world.log.filter((entry) => entry.verb === "craft");

it("records the consumed set, immediate result and witnessed source action", () => {
  const before = openingFixture("burial").waterOffer;
  before.items["greek-shovel"].holder = baker;
  const world = bake(before), event = crafts(world).at(-1);
  expect(event).toMatchObject({
    kind: "narration", actorId: baker, itemId: bread,
    locationId: home, holderId: home, consumedIds: inputs,
    witnesses: [baker, "vale"],
  });
  expect(world.log.find((entry) => entry.seq === event.sourceSeq)).toMatchObject({
    kind: "action", verb: "give", actorId: "vale", targetId: baker,
    itemId: inputs[0], turn: event.turn, accepted: true,
  });
  expect(event.sourceSeq).toBeLessThan(event.seq);
  expect(world.items["greek-shovel"].holder).toBe(baker);
  expect(Object.keys(world.items)).toEqual(Object.keys(before.items));
  expect(world.items[bread].holder).toBe(home);
  expect(world.usedUp).not.toContain(bread);
  expect(decodeSave(encodeSave(world)).log).toEqual(world.log);
});

it("gives a repeated craft its own identity while retaining the first outcome", () => {
  let world = bake(openingFixture("burial").waterOffer);
  const first = structuredClone(crafts(world)[0]);
  world = act(world, "take", { item: bread });
  world = act(world, "eat", { item: bread, target: null });
  world.items.cloth.holder = home;
  for (const item of inputs) world.items[item].holder = "vale";
  world = decodeSave(encodeSave(world));
  world = bake(world);
  expect(crafts(world)).toEqual([first]);
  world = act(world, "give", { item: inputs[1], target: baker });
  expect(crafts(world)[0]).toEqual(first);
  expect(crafts(world)).toHaveLength(2);
  expect(crafts(world)[1].seq).toBeGreaterThan(first.seq);
  expect(crafts(world)[1].sourceSeq).toBeGreaterThan(first.sourceSeq);
  world = act(world, "take", { item: bread });
  expect(crafts(world)[1].holderId).toBe(home);
  expect(world.items[bread].holder).toBe("vale");
  world.log = world.log.filter((entry) => entry.verb === "craft");
  expect(decodeSave(encodeSave(world)).log).toEqual(world.log);
});

it("keeps old plain craft narration as its original record", () => {
  const world = openingFixture("burial").water;
  expect(crafts(world)).toEqual([]);
  expect(world.log.some((entry) => entry.text.includes("Courtyard Bread is ready"))).toBe(true);
  expect(decodeSave(encodeSave(world)).log).toEqual(world.log);
});

it.each([
  { generated: true }, { consumedIds: [] }, { consumedIds: [...inputs, inputs[0]] },
  { consumedIds: [bread] }, { consumedIds: ["missing"] }, { holderId: "missing" },
  { actorId: "missing" }, { sourceSeq: 0 }, { sourceSeq: 999999 },
  { sourceSeq: 1.5 }, { seq: undefined }, { locationId: null }, { witnesses: [] },
])("rejects an invalid saved craft fact: %j", (patch) => {
  const world = bake(openingFixture("burial").waterOffer);
  Object.assign(crafts(world)[0], patch);
  expect(() => validateWorld(world)).toThrow();
});

it("repeats the same committed outcome through the shared dispatcher", () => {
  const world = openingFixture("burial").waterOffer;
  const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  const viewed = dispatchShared({ op: "view", world, ...seats });
  const action = viewed.actions.find((a) => a.kind === "give" && a.item === inputs[0] && a.target === baker);
  const request = { op: "play", world, action, ...seats };
  const result = dispatchShared(request);
  expect(result.ok, result.error).toBe(true);
  expect(crafts(result.world)).toHaveLength(1);
  expect(dispatchShared(structuredClone(request))).toEqual(result);
  const stale = dispatchShared({ ...request, world: result.world });
  expect(stale.ok).toBe(false);
  expect(crafts(stale.world)).toEqual(crafts(result.world));
});
