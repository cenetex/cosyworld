import { describe, expect, it } from "vitest";
import {
  STATION_EXIT_LIMIT,
  stationExitOrder,
  stationExits,
  validStationExitOrder,
} from "../v2/card-game/station-exits.mjs";

// Synthetic records prove only the pure contract, not current gameplay wiring.
const ways = ["pond", "a", "b", "c", "d"];
const queued = (...ids) => ({ stationExitOrder: ids });

describe("Station exit-order contract", () => {
  it("reserves Pond and admits at most two temporary ways", () => {
    expect(STATION_EXIT_LIMIT).toBe(3);
    expect(stationExits({}, ways)).toEqual(["pond", "a", "b"]);
    expect(stationExits({}, ["pond"])).toEqual(["pond"]);
    expect(stationExitOrder({}, ways)).toEqual(["a", "b", "c", "d"]);
  });

  it("retains earlier openings ahead of newly eligible authored ways", () => {
    const world = queued("c", "d");
    expect(stationExitOrder(world, ways)).toEqual(["c", "d", "a", "b"]);
    expect(stationExits(world, ways)).toEqual(["pond", "c", "d"]);
  });

  it("promotes the earliest waiter when an admitted way closes", () => {
    const world = queued("b", "a", "d", "c");
    expect(stationExitOrder(world, ["pond", "a", "c", "d"])).toEqual([
      "a",
      "d",
      "c",
    ]);
    expect(stationExits(world, ["pond", "a", "c", "d"])).toEqual([
      "pond",
      "a",
      "d",
    ]);
  });

  it("puts a reopened way at the back after recording its closure", () => {
    const closed = {
      stationExitOrder: stationExitOrder(queued("b", "a", "c"), [
        "pond",
        "a",
        "c",
      ]),
    };
    expect(stationExitOrder(closed, ways)).toEqual(["a", "c", "b", "d"]);
    expect(stationExits(closed, ways)).toEqual(["pond", "a", "c"]);
  });

  it("breaks simultaneous-opening ties by authored order and removes duplicates", () => {
    const eligible = ["pond", "c", "a", "c", "pond", "b", "a"];
    expect(stationExitOrder({}, eligible)).toEqual(["c", "a", "b"]);
    expect(stationExits({}, eligible)).toEqual(["pond", "c", "a"]);
  });

  it("does not backfill a viewer-hidden admission with a waiting way", () => {
    expect(
      stationExits(queued("a", "b", "c"), ways, ["pond", "b", "c"]),
    ).toEqual(["pond", "b"]);
  });

  it("leaves frozen inputs unchanged and returns independent arrays", () => {
    const world = Object.freeze({
      stationExitOrder: Object.freeze(["c", "a"]),
    });
    const eligible = Object.freeze([...ways]);
    const order = stationExitOrder(world, eligible);
    order.pop();
    expect(stationExitOrder(world, eligible)).toEqual(["c", "a", "b", "d"]);
    expect(stationExits(world, eligible)).toEqual(["pond", "c", "a"]);
    expect(world.stationExitOrder).toEqual(["c", "a"]);
    expect(eligible).toEqual(ways);
  });

  it("accepts absent, empty, and longer-than-admission queues", () => {
    for (const world of [{}, queued(), queued("d", "a", "c", "b")])
      expect(validStationExitOrder(world, ways)).toBe(true);
  });

  it.each([
    null,
    "a",
    {},
    ["pond"],
    ["a", "a"],
    ["unknown"],
    [null],
    [1],
    Array(1),
  ])("rejects invalid saved queue %j", (stationExitOrder) => {
    expect(validStationExitOrder({ stationExitOrder }, ways)).toBe(false);
  });
});
