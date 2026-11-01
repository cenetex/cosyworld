import { expect, it } from "vitest";
import list from "../v2/card-game/world-names.json" with { type: "json" };
import {
  fnv1a32,
  worldName,
  worldNameCount,
  worldNameOf,
} from "../v2/card-game/world-name.mjs";

// The list is frozen: these pairs must never change, or every world renames.
it("names a world from its run seed, forever", () => {
  expect(fnv1a32("a")).toBe(0xe40c292c);
  expect(worldNameCount).toBe(2022);
  expect(worldName(0)).toBe("The Kettle Mill");
  expect(worldName(4242)).toBe("The Mended Garden");
  expect(worldName(3735928559)).toBe("The Hidden Station");
  expect(worldNameOf({ run: { seed: 1 } })).toBe("The Smoky Hearth");
});

it("has no unnamed or repeated entries", () => {
  const all = new Set(
    Array.from({ length: 30000 }, (_, seed) => worldName(seed)),
  );
  expect(all.size).toBe(worldNameCount);
  expect(new Set(list.names).size).toBe(list.names.length);
});

it("leaves a world without a seed unnamed", () => {
  expect(worldNameOf({})).toBe(null);
  expect(worldName(-1)).toBe(null);
  expect(worldName(1.5)).toBe(null);
});
