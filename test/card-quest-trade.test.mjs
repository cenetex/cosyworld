import { expect, it } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { questCard } from "../v2/card-game/quest-card.mjs";
import { questTrade } from "../v2/card-game/quest-step.mjs";

function act(world, fields) {
  const action = legalActions(world).find((a) =>
    Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  expect(action).toBeTruthy();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
function encounter(
  owner = "keeper",
  target = "oil",
  gift = "bell",
  payment = "cloth",
  trust = 1,
) {
  let world = createWorld({ seed: 7 });
  world.actors.vale.place = world.actors[owner].place = "pond";
  world.actors[owner === "keeper" ? "moth" : "keeper"].place = "attic";
  world.actors[owner].trust.vale = trust;
  world.items[target].holder = owner;
  for (const item of [gift, payment]) world.items[item].holder = "vale";
  world.actors[owner].want = {
    kind: "item",
    target: gift,
    since: 0,
    refusals: 0,
  };
  world.actors.vale.want = { kind: "item", target, since: 0, refusals: 0 };
  world = act(world, { kind: "give", item: gift, target: owner });
  expect(world.actors[owner].heldItem).toBe(gift);
  expect(world.items[target].holder).toBe(owner);
  return world;
}
const offer = (world, selected, known = () => true) =>
  questTrade(world, questCard(world), selected, known);

it("trades the chosen payment for private Oil after a real gift and refused Ask", () => {
  let world = encounter();
  world = act(world, { kind: "ask", item: "oil", target: "keeper" });
  expect(world.log.findLast((e) => e.verb === "ask").accepted).toBe(false);
  const before = structuredClone(world),
    action = offer(world, ["cloth"]);
  expect(action).toMatchObject({
    kind: "trade",
    item: "cloth",
    receive: "oil",
    target: "keeper",
  });
  expect(offer(world, ["vale", "cloth"])).toEqual(action);
  expect(world).toEqual(before);
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.state.log.findLast((e) => e.verb === "trade").accepted).toBe(
    true,
  );
  expect(result.state.items.cloth.holder).toBe("keeper");
  expect(result.state.items.oil.holder).toBe("vale");
  expect(result.state.log.findLast((e) => e.verb === "trade").itemId).toBe(
    "cloth",
  );
});

it("uses the same explicit Trade for another resident and quest item", () => {
  const world = encounter("moth", "bell", "lamp", "oil"),
    action = offer(world, ["oil"]);
  expect(action).toMatchObject({
    item: "oil",
    receive: "bell",
    target: "moth",
  });
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.state.log.findLast((e) => e.verb === "trade").accepted).toBe(
    true,
  );
  expect(result.state.items.bell.holder).toBe("vale");
});

it("leaves a refused offer with both owners", () => {
  const world = encounter("keeper", "oil", "bell", "cloth", 0),
    result = play(world, offer(world, ["cloth"]));
  expect(result.ok, result.error).toBe(true);
  expect(result.state.log.findLast((e) => e.verb === "trade").accepted).toBe(
    false,
  );
  expect(result.state.items.cloth.holder).toBe("vale");
  expect(result.state.items.oil.holder).toBe("keeper");
});

it("requires one owned payment and known identities from the current legal offers", () => {
  const world = encounter();
  for (const selected of [
    [],
    ["bell"],
    ["cloth", "lamp"],
    ["station"],
    ["missing"],
  ])
    expect(offer(world, selected)).toBeNull();
  for (const hidden of ["cloth", "oil", "keeper"])
    expect(offer(world, ["cloth"], (id) => id !== hidden)).toBeNull();
  expect(
    questTrade(
      world,
      { ...questCard(world), receiptId: 1 },
      ["cloth"],
      () => true,
    ),
  ).toBeNull();
  expect(
    questTrade(world, questCard(world), ["cloth"], () => true, []),
  ).toBeNull();
});
