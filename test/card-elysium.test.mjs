import { expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  holdChoice,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  freed,
  packDefinition,
  packRouteOpen,
} from "../v2/card-game/pack-registry.mjs";
import { backdrop } from "../v2/card-game/scene.mjs";
import { setLampFuel } from "../v2/scripts/card-browser-helpers.mjs";

const id = (name) => `elysium-${name}`;
const voidNode = id("void-001"),
  ledge = id("keystone-ledge"),
  spiral = id("gold-spiral"),
  observatory = id("observatory"),
  resident = id("resident"),
  wayfinder = id("wayfinder"),
  keystone = id("keystone"),
  chart = id("star-chart");

const fixture = (place = "pond") => {
  const s = createWorld({ seed: 17 });
  s.actors.vale.place = place;
  s.actors.vale.visited.push(place);
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
  expect(Object.keys(pack.places)).toEqual([
    voidNode,
    ledge,
    spiral,
    observatory,
  ]);
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
  expect(moves(s)).not.toContain(observatory);

  s = act(s, "drop", wayfinder);
  expect(moves(s)).toContain(observatory);
  s = act(s, "move", observatory);
  s = act(s, "take", chart);
  s = act(s, "move", ledge);
  expect(moves(s)).toContain(observatory);
  expect(exits(s, ledge, "moth")).not.toContain(observatory);
  s = act(s, "move", observatory);
  s = act(s, "move", spiral);
  s = act(s, "take", wayfinder);
  expect(moves(s)).not.toContain(observatory);

  s = act(s, "move", voidNode);
  s = act(s, "take", keystone);
  expect(moves(s)).not.toContain(spiral);
});

it("weaves the bridge only while the lamp's uncovered flame is at the Spiral", () => {
  let s = fixture(spiral);
  s.items.lamp.holder = "vale";
  setLampFuel(s, 8, spiral);
  holdChoice(s, "vale", { item: "lamp", revision: s.revision });
  expect(moves(s)).toContain(observatory);
  expect(backdrop(spiral, s)).toBe("./assets/elysium/gold-spiral-open.png");

  s.items.cloth.holder = "lamp";
  expect(moves(s)).not.toContain(observatory);
  expect(backdrop(spiral, s)).toBe("./assets/elysium/gold-spiral.png");
  s.items.cloth.holder = "pond";
  s = act(s, "move", observatory);
  expect(packRouteOpen(s, spiral, observatory)).toBe(false);
  expect(moves(s)).toContain(spiral);
  expect(moves(s)).toContain(ledge);
});

it("adds the new destination and its chart to an older save without moving its keystone", () => {
  const old = fixture(spiral);
  old.packs.elysium.revision = 1;
  old.items[keystone].holder = voidNode;
  delete old.items[chart];
  delete old.memories[chart];
  delete old.memories[observatory];

  const s = decodeSave(JSON.stringify(old));
  expect(s.packs.elysium.revision).toBe(2);
  expect(s.actors.vale.place).toBe(spiral);
  expect(s.items[keystone].holder).toBe(voidNode);
  expect(s.items[chart].holder).toBe(observatory);
  expect(s.memories[observatory]).toBeDefined();
});
