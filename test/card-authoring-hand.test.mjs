import { describe, expect, it } from "vitest";
import {
  makerCardLayout,
  placeCardTree,
} from "../v2/card-game/card-tree-layout.mjs";
const cards = [
  { id: "world", group: true },
  { id: "room", holder: "world", group: true },
  { id: "other", holder: "world", group: true },
  { id: "avatar", holder: "room", group: true },
  { id: "field", holder: "avatar" },
  { id: "item", holder: "room" },
];
const zones = (state) =>
  Object.fromEntries(
    makerCardLayout(cards, state).nodes.map((node) => [node.id, node.zone]),
  );
describe("maker table and hand", () => {
  it("deals direct children, not all descendants, into the hand", () => {
    expect(zones({ active: "world", expanded: ["world"] })).toEqual({
      world: "table",
      room: "hand",
      other: "hand",
    });
  });
  it("plays a box onto the table and deals its cards", () => {
    expect(zones({ active: "room", expanded: ["world", "room"] })).toEqual({
      world: "table",
      room: "table",
      avatar: "hand",
      item: "hand",
    });
  });
  it("keeps a selected leaf in its hand without duplicating cards", () => {
    expect(zones({ active: "item", expanded: ["world", "room"] })).toEqual({
      world: "table",
      room: "table",
      avatar: "hand",
      item: "hand",
    });
  });
  it("keeps the same table sizing while selecting a hand card", () => {
    const table = (active) =>
      makerCardLayout(cards, {
        active,
        expanded: ["world", "room"],
      }).nodes.filter((n) => n.zone === "table");
    expect(table("item")).toEqual(table("room"));
  });
  it("folds a box back into the parent hand without exposing descendants", () => {
    expect(zones({ active: "room", expanded: ["world", "avatar"] })).toEqual({
      world: "table",
      room: "hand",
      other: "hand",
    });
  });
  it("preserves other played branches without changing authored custody", () => {
    const before = JSON.stringify(cards);
    expect(
      zones({ active: "room", expanded: ["world", "room", "other"] }),
    ).toEqual({
      world: "table",
      room: "table",
      other: "table",
      avatar: "hand",
      item: "hand",
    });
    expect(JSON.stringify(cards)).toBe(before);
  });
  it("handles removed cards and empty boxes", () => {
    expect(zones({ active: "missing", expanded: ["world"] })).toEqual({
      world: "table",
    });
    expect(zones({ active: "other", expanded: ["world", "other"] })).toEqual({
      world: "table",
      other: "table",
    });
  });
  it("keeps default tree placement unmarked after leaving maker layout", () => {
    const values = new Map();
    const screen = {
      dataset: {},
      style: { setProperty: (key, value) => values.set(key, value) },
      querySelectorAll: () => [],
    };
    const state = { active: "world", expanded: ["world"] };
    placeCardTree(screen, cards, state, makerCardLayout);
    expect(screen.dataset.makerHand).toBe("true");
    placeCardTree(screen, cards, state);
    expect(screen.dataset.makerHand).toBeUndefined();
    expect(screen.dataset.layout).toBe("tree");
  });
});
