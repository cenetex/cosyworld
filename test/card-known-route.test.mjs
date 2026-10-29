import { describe, expect, it } from "vitest";
import { knownRoute, rememberRoutes } from "../v2/card-game/roaming-quests.mjs";

const initialEdges = [
  ["a", "c"],
  ["z", "a"],
  ["a", "b"],
  ["c", "d"],
  ["b", "d"],
  ["d", "a"],
  ["b", "e"],
  ["c", "e"],
  ["e", "f"],
  ["a", "c"],
  ["f", "f"],
];
const world = () => ({
  routeKnowledge: { traveler: structuredClone(initialEdges) },
});

describe("known roaming routes", () => {
  it("uses directed shortest paths and keeps the saved edge order for ties", () => {
    const s = world();
    expect(knownRoute(s, "traveler", "a", "d")).toEqual(["a", "c", "d"]);
    expect(knownRoute(s, "traveler", "a", "f")).toEqual(["a", "c", "e", "f"]);
    expect(knownRoute(s, "traveler", "f", "a")).toBeNull();
    expect(knownRoute(s, "traveler", "z", "z")).toEqual(["z"]);
    expect(knownRoute(s, "absent", "a", "b")).toBeNull();
  });

  it("checks crossings in order with the previous step", () => {
    const calls = [];
    const allowed = (from, to, previous) => {
      calls.push([from, to, previous]);
      return !(from === "c" && to === "d") && !(previous === "a" && to === "e");
    };
    expect(knownRoute(world(), "traveler", "a", "d", allowed)).toEqual([
      "a",
      "b",
      "d",
    ]);
    expect(calls).toEqual([
      ["a", "c", undefined],
      ["a", "b", undefined],
      ["c", "d", "a"],
      ["c", "e", "a"],
      ["b", "d", "a"],
      ["b", "e", "a"],
    ]);
  });

  it("uses the latest remembered edges on the next search", () => {
    const s = world();
    expect(knownRoute(s, "traveler", "a", "new")).toBeNull();
    rememberRoutes(s, "traveler", [["d", "new"]]);
    expect(knownRoute(s, "traveler", "a", "new")).toEqual([
      "a",
      "b",
      "d",
      "new",
    ]);
  });

  it("sees an in-place route edit on the next search", () => {
    const s = world();
    expect(knownRoute(s, "traveler", "a", "new")).toBeNull();
    s.routeKnowledge.traveler.push(["a", "new"]);
    expect(knownRoute(s, "traveler", "a", "new")).toEqual(["a", "new"]);
  });
});
