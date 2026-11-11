import { expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { worldLife } from "../v2/card-game/resident-home.mjs";
import { greekErrands, openingFixture } from "./helpers/greek-opening.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";

const bread = "greek-bread",
  baker = "greek-baker",
  home = "greek-courtyard";
const inputs = ["greek-water-jar", "greek-wheat"];
function act(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  expect(action).toBeTruthy();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
const bake = (world) => act(world, "give", { item: inputs[0], target: baker });
const crafts = (world) => world.log.filter((entry) => entry.verb === "craft");

it("records the consumed set, immediate result and witnessed source action", () => {
  const before = greekErrands().waterOffer;
  before.items["greek-shovel"].holder = baker;
  const world = bake(before),
    event = crafts(world).at(-1);
  expect(event).toMatchObject({
    kind: "narration",
    actorId: baker,
    itemId: bread,
    locationId: home,
    holderId: home,
    consumedIds: inputs,
    witnesses: [baker, "vale"],
  });
  expect(
    world.log.find((entry) => entry.seq === event.sourceSeq),
  ).toMatchObject({
    kind: "action",
    verb: "give",
    actorId: "vale",
    targetId: baker,
    itemId: inputs[0],
    turn: event.turn,
    accepted: true,
  });
  expect(event.sourceSeq).toBeLessThan(event.seq);
  expect(world.items["greek-shovel"].holder).toBe(baker);
  expect(Object.keys(world.items)).toEqual(Object.keys(before.items));
  expect(world.items[bread].holder).toBe(home);
  expect(world.usedUp).not.toContain(bread);
  expect(decodeSave(encodeSave(world)).log).toEqual(world.log);
});

it("gives a repeated craft its own identity while retaining the first outcome", () => {
  let world = bake(greekErrands().waterOffer);
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

// Skipped: replays a recorded save through the removed Theban-response
// branch; retired with the fixtures in package 6 fixtures.
it.skip("keeps old plain craft narration as its original record", () => {
  // Only a recorded save has the old plain narration: current rules log a craft event.
  const world = openingFixture("burial").water;
  expect(crafts(world)).toEqual([]);
  expect(
    world.log.some((entry) => entry.text.includes("Courtyard Bread is ready")),
  ).toBe(true);
  expect(decodeSave(encodeSave(world)).log).toEqual(world.log);
});

it("records three consumed inputs when a Drop completes another recipe", () => {
  let world = greekErrands().waterOffer;
  const harbor = "greek-harbor",
    maker = "greek-shipmaster",
    output = "greek-provisions";
  const consumed = [bread, "greek-figs", "greek-wine-skin"];
  world.actors.vale.place = world.actors[maker].place = harbor;
  world.usedUp = [
    ...world.usedUp.filter((id) => ![bread, output].includes(id)),
    output,
  ].sort();
  for (const item of consumed) world.items[item].holder = maker;
  world.items[consumed[2]].holder = "vale";
  world = act(world, "drop", { item: consumed[2], target: harbor });
  expect(crafts(world)).toHaveLength(1);
  const event = crafts(world)[0];
  expect(event).toMatchObject({
    actorId: maker,
    itemId: output,
    holderId: harbor,
    locationId: harbor,
    consumedIds: consumed,
    witnesses: expect.arrayContaining([maker, "vale"]),
  });
  expect(world.log.find((entry) => entry.seq === event.sourceSeq).verb).toBe(
    "drop",
  );
  expect(world.usedUp).not.toContain(output);
  expect(world.usedUp).toContain(bread);
});

it.each([
  { verb: "wait" },
  { accepted: false },
  { accepted: undefined },
  { targetId: "vale" },
  { itemId: "lamp" },
])("requires a retained source action to support the craft: %j", (patch) => {
  const world = bake(greekErrands().waterOffer);
  Object.assign(
    world.log.find((entry) => entry.seq === crafts(world)[0].sourceSeq),
    patch,
  );
  expect(() => validateWorld(world)).toThrow();
});

it.each([
  { generated: true },
  { consumedIds: [] },
  { consumedIds: [...inputs, inputs[0]] },
  { consumedIds: [bread] },
  { consumedIds: ["missing"] },
  { consumedIds: ["toString"] },
  { holderId: "missing" },
  { actorId: "missing" },
  { sourceSeq: 0 },
  { sourceSeq: 999999 },
  { sourceSeq: 1.5 },
  { seq: undefined },
  { locationId: null },
  { witnesses: [] },
])("rejects an invalid saved craft fact: %j", (patch) => {
  const world = bake(greekErrands().waterOffer);
  Object.assign(crafts(world)[0], patch);
  expect(() => validateWorld(world)).toThrow();
});

it.each(["give", "drop"])(
  "keeps %s craft facts equal in browser and compiled rules",
  (kind) => {
    // The old story fixtures stop residents; parity uses the live shared rules.
    const wasOn = worldLife.on;
    worldLife.on = true;
    try {
      const engine = currentSharedEngine();
      const both = (request) => {
        const result = dispatchShared(structuredClone(request));
        expect(JSON.parse(engine.cardShared(JSON.stringify(request)))).toEqual(
          result,
        );
        return result;
      };
      const world = greekErrands().waterOffer;
      const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
      const viewed = both({ op: "view", world, ...seats });
      const action = viewed.actions.find(
        (a) =>
          a.kind === kind &&
          a.item === inputs[0] &&
          a.target === (kind === "give" ? baker : home),
      );
      const request = { op: "play", world, action, ...seats };
      const result = both(request);
      expect(result.ok, result.error).toBe(true);
      expect(crafts(result.world)).toHaveLength(1);
      expect(both(structuredClone(request))).toEqual(result);
      const stale = both({ ...request, world: result.world });
      expect(stale.ok).toBe(false);
      expect(crafts(stale.world)).toEqual(crafts(result.world));
      const take = both({
        op: "view",
        world: result.world,
        ...seats,
      }).actions.find((a) => a.kind === "take" && a.item === bread);
      const taken = both({
        op: "play",
        world: result.world,
        action: take,
        ...seats,
      });
      expect(taken.ok, taken.error).toBe(true);
      expect(taken.world.items[bread].holder).toBe("vale");
      expect(crafts(taken.world)).toEqual(crafts(result.world));
      const restored = both({
        op: "validate",
        world: decodeSave(encodeSave(taken.world)),
        ...seats,
      });
      expect(crafts(restored.world)).toEqual(crafts(result.world));
    } finally {
      worldLife.on = wasOn;
    }
  },
);
