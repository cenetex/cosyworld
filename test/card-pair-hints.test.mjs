import { describe, it, expect } from "vitest";
import { cardActions, cardPlay } from "../v2/card-game/cards.mjs";
import { createWorld } from "../v2/card-game/world.mjs";

function station() {
  const world = createWorld();
  for (const id of ["vale", "moth"]) world.actors[id].place = "station";
  return world;
}

function pond() {
  const world = createWorld();
  for (const id of ["vale", "moth"]) world.actors[id].place = "pond";
  return world;
}

const talk = { kind: "talk", target: "moth" };

describe("item and resident pair reasons", () => {
  it("talks with the resident beside a loose item", () => {
    const world = station();
    world.items.lamp.holder = "station";
    expect(cardPlay(world, ["lamp", "moth"]).action).toMatchObject(talk);
  });

  it("says the traveler's hands are full when nothing in the pair plays", () => {
    const world = station();
    world.items.lamp.holder = "moth";
    const mine = Object.keys(world.items)
      .filter((id) => !["lamp", "cloth"].includes(id))
      .slice(0, 3);
    for (const id of mine) world.items[id].holder = "vale";
    const reason = "Make room to ask for the Lamp.";
    expect(cardPlay(world, ["lamp"]).action).toBeFalsy();
    expect(cardPlay(world, ["lamp"]).hint).toBe(reason);
    expect(cardPlay(world, ["lamp", "moth"]).action).toMatchObject(talk);
    world.items[mine[0]].holder = "station";
    expect(cardPlay(world, ["lamp", "moth"]).action?.kind).toBe("ask");
  });

  it("gives a carried item to the resident", () => {
    const world = station();
    world.items.lamp.holder = "vale";
    expect(cardPlay(world, ["lamp", "moth"]).action?.kind).toBe("give");
  });
});

describe("a pair with no play of its own", () => {
  it("talks with the resident chosen with a place", () => {
    const world = pond();
    const { actions, hint } = cardActions(world, ["moth", "pond"]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject(talk);
    expect(hint).toBe("");
    expect(cardPlay(world, ["moth", "pond"])).toEqual(cardPlay(world, ["moth"]));
  });

  it("plays the item before the place", () => {
    const world = pond();
    world.items.lamp.holder = "pond";
    expect(cardPlay(world, ["lamp", "station"]).action).toMatchObject({
      kind: "take",
      item: "lamp",
    });
  });

  it("keeps a pair's own play first", () => {
    const world = pond();
    expect(cardPlay(world, ["vale", "moth"]).action?.kind).not.toBe("talk");
    world.items.lamp.holder = "vale";
    expect(cardPlay(world, ["lamp", "moth"]).action?.kind).toBe("give");
  });
});
