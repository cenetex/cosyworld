import { expect, it as check } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  freed,
  packDefinition,
  packPeople,
} from "../v2/card-game/pack-registry.mjs";

const it = check.skipIf(!packPeople["elysium-resident"]);
const id = (name) => `elysium-${name}`;
const voidNode = id("void-001"),
  ledge = id("keystone-ledge"),
  spiral = id("gold-spiral"),
  resident = id("resident"),
  wayfinder = id("wayfinder"),
  keystone = id("keystone");

const fixture = () => {
  const s = createWorld({ seed: 17 });
  s.actors.vale.place = "pond";
  s.actors.vale.visited.push("pond");
  for (const item of Object.values(s.items))
    if (item.holder === "vale") item.holder = "pond";
  return s;
};
const moves = (s) =>
  legalActions(s)
    .filter((a) => a.kind === "move")
    .map((a) => a.target);
const act = (s, kind, target) => {
  const action = legalActions(s).find(
    (a) => a.kind === kind && (a.item === target || a.target === target),
  );
  expect(action, `${kind} ${target}`).toBeDefined();
  const result = play(s, action);
  expect(result.ok, result.error).toBe(true);
  return decodeSave(encodeSave(result.state));
};

it("mounts Void 001 along a gold filament from Black pond", () => {
  const pack = packDefinition("elysium");
  expect(pack.entry).toBe(voidNode);
  expect(Object.keys(pack.places)).toEqual([voidNode, ledge, spiral]);
  const s = act(fixture(), "move", voidNode);
  expect(s.actors.vale.place).toBe(voidNode);
  expect(moves(s)).toContain("pond");
});

it("opens each filament with what it asks for, and keeps it only while that holds", () => {
  let s = act(fixture(), "move", voidNode);
  expect(s.items[wayfinder].holder).toBe(voidNode);
  expect(moves(s)).not.toContain(ledge);
  expect(moves(s)).not.toContain(spiral);

  s = act(s, "take", wayfinder);
  expect(moves(s)).toContain(ledge);
  s = act(s, "move", ledge);
  s = act(s, "take", keystone);
  s = act(s, "move", voidNode);
  expect(moves(s)).not.toContain(spiral);
  expect(freed(s, resident)).toBe(false);

  s = act(s, "drop", keystone);
  expect(s.items[keystone].holder).toBe(voidNode);
  expect(moves(s)).toContain(spiral);
  expect(
    s.log.some(
      (e) =>
        e.verb === "want_met" &&
        e.wantMet?.kind === "place" &&
        e.wantMet?.target === voidNode,
    ),
  ).toBe(true);
  expect(freed(s, resident)).toBe(true);

  s = act(s, "move", spiral);
  expect(s.actors.vale.place).toBe(spiral);
  expect(moves(s)).toContain(voidNode);

  s = act(s, "move", voidNode);
  s = act(s, "take", keystone);
  expect(moves(s)).not.toContain(spiral);
});
