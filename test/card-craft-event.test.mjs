import { expect, it } from "vitest";
import { validateWorld } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { greekErrands } from "./helpers/greek-opening.mjs";
import { act, lifeFor } from "./helpers/play.mjs";

const bread = "greek-bread",
  baker = "greek-baker",
  home = "greek-courtyard";
const inputs = ["greek-water-jar", "greek-wheat"];
const bake = (world) => act(world, { kind: "give", item: inputs[0], target: baker });
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
});

it("gives a repeated craft its own identity while retaining the first outcome", () => {
  let world = bake(greekErrands().waterOffer);
  const first = structuredClone(crafts(world)[0]);
  world = act(world, { kind: "take", item: bread });
  world = act(world, { kind: "eat", item: bread, target: null });
  world.items.cloth.holder = home;
  for (const item of inputs) world.items[item].holder = "vale";
  world = bake(world);
  expect(crafts(world)).toEqual([first]);
  world = act(world, { kind: "give", item: inputs[1], target: baker });
  expect(crafts(world)[0]).toEqual(first);
  expect(crafts(world)).toHaveLength(2);
  expect(crafts(world)[1].seq).toBeGreaterThan(first.seq);
  expect(crafts(world)[1].sourceSeq).toBeGreaterThan(first.sourceSeq);
  world = act(world, { kind: "take", item: bread });
  expect(crafts(world)[1].holderId).toBe(home);
  expect(world.items[bread].holder).toBe("vale");
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
  world = act(world, { kind: "drop", item: consumed[2], target: harbor });
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
  "keeps %s craft facts through shared play",
  (kind) => {
    lifeFor(true);
    const ask = (request) => dispatchShared(structuredClone(request));
    const world = greekErrands().waterOffer;
    const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
    const viewed = ask({ op: "view", world, ...seats });
    const action = viewed.actions.find(
      (a) =>
        a.kind === kind &&
        a.item === inputs[0] &&
        a.target === (kind === "give" ? baker : home),
    );
    const request = { op: "play", world, action, ...seats };
    const result = ask(request);
    expect(result.ok, result.error).toBe(true);
    expect(crafts(result.world)).toHaveLength(1);
    expect(ask(structuredClone(request))).toEqual(result);
    const stale = ask({ ...request, world: result.world });
    expect(stale.ok).toBe(false);
    expect(crafts(stale.world)).toEqual(crafts(result.world));
    const take = ask({
      op: "view",
      world: result.world,
      ...seats,
    }).actions.find((a) => a.kind === "take" && a.item === bread);
    const taken = ask({
      op: "play",
      world: result.world,
      action: take,
      ...seats,
    });
    expect(taken.ok, taken.error).toBe(true);
    expect(taken.world.items[bread].holder).toBe("vale");
    expect(crafts(taken.world)).toEqual(crafts(result.world));
    const restored = ask({
      op: "validate",
      world: taken.world,
      ...seats,
    });
    expect(crafts(restored.world)).toEqual(crafts(result.world));
  },
);
