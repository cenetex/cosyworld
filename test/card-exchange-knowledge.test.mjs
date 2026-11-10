import "./helpers/still-cast.mjs";
import { expect, it } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { seatActors } from "../v2/card-game/human-cast.mjs";

function encounter(other = "keeper") {
  const world = enableMotives(createWorld());
  world.actors.vale.place = world.actors[other].place;
  if (other.startsWith("greek-")) world.packs["greek-drama"].met[other] = 0;
  return world;
}
function act(world, fields) {
  const action = legalActions(world).find((a) =>
    Object.entries(fields).every(([key, value]) => a[key] === value));
  expect(action, JSON.stringify(fields)).toBeDefined();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
const knowledge = (world, id, hidden = null) =>
  narrativeContext(world, null, hidden).entities.find((e) => e.id === id)?.facts
    .filter((f) => /asked me for|in trade for my|is showing me/.test(f)) || [];
const answer = (world, verb) => world.log.findLast((e) => e.verb === verb).accepted;

it("knows Ismene's refusal before the request and retains the real custody afterward", () => {
  let world = encounter("greek-ismene");
  const token = "greek-household-token";
  // Recreate the custody shown by the refused request.
  world.items[token].holder = "greek-ismene";
  expect(world.items[token].holder).toBe("greek-ismene");
  expect(knowledge(world, "greek-ismene")).toContain(
    "If Vale asked me for Household Token, I would refuse to give it.");
  world = act(world, {kind: "ask", item: token, target: "greek-ismene"});
  expect(answer(world, "ask")).toBe(false);
  expect(world.items[token].holder).toBe("greek-ismene");
  const context = narrativeContext(world);
  expect(context.outcome.card.accepted).toBe(false);
  expect(context.entities.find((e) => e.id === "greek-ismene").facts[0]).toContain("refused");
  expect(knowledge(world, "greek-ismene")).toContain(
    "If Vale asked me for Household Token, I would refuse to give it.");
});

it("knows when a favour permits a gift and stops offering an item after giving it", () => {
  let world = encounter();
  world.actors.keeper.want = null;
  world.items.cloth.holder = "keeper";
  expect(knowledge(world, "keeper")).toContain(
    "If Vale asked me for Black cloth, I would refuse to give it.");
  world.actors.keeper.trust.vale = 1;
  expect(knowledge(world, "keeper")).toContain(
    "If Vale asked me for Black cloth, I would agree to give it.");
  world = act(world, {kind: "ask", item: "cloth", target: "keeper"});
  expect(answer(world, "ask")).toBe(true);
  expect(world.items.cloth.holder).toBe("vale");
  expect(knowledge(world, "keeper").join(" ")).not.toContain("asked me for Black cloth");
});

it("prices a visible offer through the same rules that commit its trade", () => {
  let world = encounter();
  world.actors.keeper.want = null;
  world.items.bell.holder = "vale";
  world.items.cloth.holder = "vale";
  world.actors.vale.heldItem = "bell";
  expect(knowledge(world, "keeper")).toContain(
    "I would accept Vale's Bell in trade for my Oil flask now.");
  expect(knowledge(world, "keeper").join(" ")).not.toContain("Black cloth");
  const hidden = knowledge(world, "keeper", (id) => id === "bell").join(" ");
  expect(hidden).not.toContain("Bell");
  world = act(world, {kind: "trade", item: "bell", receive: "oil"});
  expect(answer(world, "trade")).toBe(true);
  expect(world.items.oil.holder).toBe("vale");
  expect(world.items.bell.holder).toBe("keeper");
});

it("does not infer a better offer from the player's private inventory", () => {
  let world = encounter();
  world.actors.keeper.want = null;
  world.items.bell.holder = "vale";
  world.items.cloth.holder = "vale";
  world.actors.vale.heldItem = "cloth";
  expect(knowledge(world, "keeper")).toContain(
    "No item Vale is showing me would make me trade Oil flask now.");
  expect(knowledge(world, "keeper").join(" ")).not.toContain("Bell");
  world = act(world, {kind: "trade", item: "cloth", receive: "oil"});
  expect(answer(world, "trade")).toBe(false);
  expect(world.items.oil.holder).toBe("keeper");
});

it("keeps a wanted item even when favour and an otherwise good payment exist", () => {
  let world = encounter();
  world.items.bell.holder = "vale";
  world.actors.keeper.trust.vale = 1;
  world.actors.keeper.want = {kind: "item", target: "oil", since: 0, refusals: 0};
  expect(knowledge(world, "keeper")).toEqual(expect.arrayContaining([
    "If Vale asked me for Oil flask, I would refuse to give it.",
    "No item Vale is showing me would make me trade Oil flask now.",
  ]));
  world = act(world, {kind: "trade", item: "bell", receive: "oil"});
  expect(answer(world, "trade")).toBe(false);
});

it("recomputes the price after real grievances instead of retaining an earlier offer", () => {
  let world = encounter();
  world.actors.keeper.want = null;
  world.items.bell.holder = "vale";
  expect(knowledge(world, "keeper")).toContain(
    "I would accept Vale's Bell in trade for my Oil flask now.");
  world = act(act(world, {kind: "ring", item: "bell"}), {kind: "ring", item: "bell"});
  expect(knowledge(world, "keeper")).toContain(
    "No item Vale is showing me would make me trade Oil flask now.");
  world = act(world, {kind: "trade", item: "bell", receive: "oil"});
  expect(answer(world, "trade")).toBe(false);
});

it("does not offer a trade whose wrapped payment would exceed carrying capacity", () => {
  const world = encounter();
  world.actors.keeper.want = null;
  world.items.bell.holder = "vale";
  world.items.cloth.holder = "bell";
  world.items.lamp.holder = "keeper";
  world.items["greek-household-token"].holder = "keeper";
  expect(knowledge(world, "keeper")).toContain(
    "No item Vale is showing me would make me trade Oil flask now.");
  expect(legalActions(world).some((a) =>
    a.kind === "trade" && a.item === "bell" && a.receive === "oil")).toBe(false);
});

it("leaves human choices undecided and does not inspect a sleeping partner's hand", () => {
  const world = encounter();
  world.actors.keeper.want = null;
  world.items.bell.holder = "vale";
  expect(knowledge(world, "vale")).toEqual([]);
  world.actors.vale.sleeping = {until: world.turn + 2};
  expect(knowledge(world, "keeper")).toEqual([]);
  delete world.actors.vale.sleeping;
  world.sharedVersion = 1;
  world.actors.mara.place = world.actors.vale.place;
  seatActors(world, ["vale", "mara"], ["vale", "mara"]);
  expect(knowledge(world, "mara")).toEqual([]);
  seatActors(world, ["vale", "mara"], ["vale"]);
  expect(knowledge(world, "mara")).toEqual([]);
});

it("Dione's wheat offer during Talk is conditional and does not transfer the sack", () => {
  let world = encounter("greek-baker");
  world.items["greek-wheat"].holder = "greek-baker";
  world.actors["greek-baker"].want = null;
  world.actors["greek-baker"].trust.vale = 1;
  world = act(world, {kind: "talk", target: "greek-baker"});
  const context = narrativeContext(world);
  expect(context.outcome.card.kind).toBe("talk");
  expect(world.items["greek-wheat"].holder).toBe("greek-baker");
  expect(knowledge(world, "greek-baker")).toContain(
    "If Vale asked me for Sack of Wheat, I would agree to give it.");
});
