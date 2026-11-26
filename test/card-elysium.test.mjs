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
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { elysiumScatterLandings } from "../v2/card-game/world/elysium-travel.mjs";
import { setLampFuel } from "../v2/scripts/card-browser-helpers.mjs";

const id = (name) => `elysium-${name}`;
const voidNode = id("void-001"),
  exitNode = id("void-002"),
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

function enter() {
  let s = fixture("station");
  s.turn = s.revision = DAYLIGHT_TURNS;
  s.items[wayfinder].holder = "station";
  s = act(s, "take", wayfinder);
  return act(s, "move", voidNode);
}

it("scatters the Wayfinder deterministically in ordinary reachable rooms", () => {
  const seen = new Set();
  for (const seed of [1, 2, 3, 4]) {
    const s = createWorld({ seed });
    const { holder } = s.items[wayfinder];
    expect(["pond", "station"]).toContain(holder);
    expect(createWorld({ seed }).items[wayfinder].holder).toBe(holder);
    expect(decodeSave(encodeSave(s)).items[wayfinder].holder).toBe(holder);
    seen.add(holder);
  }
  expect(seen.size).toBe(2);

  const s = fixture("station");
  s.items["ratiradio-station-key"].holder = "vale";
  expect(elysiumScatterLandings(s, "vale")).toEqual(
    expect.arrayContaining(["pond", "station", "ratiradio-staff-kitchen"]),
  );
});

it("opens Void 001 only to the traveler with the Wayfinder in hand at night", () => {
  const pack = packDefinition("elysium");
  expect(pack.entry).toBe(voidNode);
  expect(Object.keys(pack.places)).toEqual(
    expect.arrayContaining([
      voidNode,
      ledge,
      spiral,
      observatory,
      ...Array.from({ length: 6 }, (_, index) => id(`void-00${index + 2}`)),
    ]),
  );
  let s = fixture("station");
  s.items[wayfinder].holder = "station";
  s = act(s, "take", wayfinder);
  expect(moves(s)).not.toContain(voidNode);
  expect(exits(s, "pond", "vale")).not.toContain(voidNode);
  s.turn = s.revision = DAYLIGHT_TURNS * 2 - 1;
  holdChoice(s, "vale", { item: null, revision: s.revision });
  expect(moves(s)).not.toContain(voidNode);
  holdChoice(s, "vale", { item: wayfinder, revision: s.revision });
  expect(
    legalActions(s).some(
      (a) => a.kind === "accompany" && a.destination === voidNode,
    ),
  ).toBe(false);
  s = act(s, "move", voidNode);
  expect(s.actors.vale.place).toBe(voidNode);
  expect(s.turn).toBe(DAYLIGHT_TURNS * 2);
  expect(moves(s)).not.toContain("pond");
  for (const number of [2, 3, 4, 7, 6, 5, 3, 2])
    s = act(s, "move", id(`void-00${number}`));
});

it("uses a night crossing from the Pond without reopening its retired filament", () => {
  const s = fixture();
  s.turn = s.revision = DAYLIGHT_TURNS;
  s.items[wayfinder].holder = "vale";
  holdChoice(s, "vale", { item: wayfinder, revision: s.revision });
  const move = legalActions(s).find((a) => a.kind === "move" && a.target === voidNode);
  const result = play(s, move, s.revision);
  expect(result.ok, result.error).toBe(true);
  expect(result.state.actors.vale.place).toBe(voidNode);
  expect(result.state.crossings["pond-elysium-void-001"].discovered).toBe(false);
  expect(result.state.crossings).toEqual(decodeSave(encodeSave(result.state)).crossings);
  expect(moves(result.state)).not.toContain("pond");
});

it("opens each filament with what it asks for, and keeps it only while that holds", () => {
  let s = enter();
  expect(s.items[wayfinder].holder).toBe("vale");
  expect(moves(s)).toContain(ledge);
  expect(moves(s)).not.toContain(spiral);

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

it("lets the Wayfinder holder leave an underway ship without interrupting its voyage", () => {
  let s = fixture("greek-ship");
  s.turn = s.revision = DAYLIGHT_TURNS;
  s.items[wayfinder].holder = "vale";
  s.crossings["pond-greek-harbor"].discovered = true;
  Object.assign(s.transports["greek-ship"], {
    phase: "sea",
    dock: "pond",
    destination: "greek-harbor",
    since: s.turn,
  });
  holdChoice(s, "vale", { item: wayfinder, revision: s.revision });
  s = act(s, "move", voidNode);
  expect(s.items[wayfinder].holder).toBe("vale");
  expect(s.transports["greek-ship"]).toMatchObject({
    phase: "docked",
    dock: "greek-harbor",
    riders: [],
  });
});

it("scatters an abandoned Wayfinder when the last traveler leaves", () => {
  let s = act(enter(), "drop", wayfinder);
  expect(s.items[wayfinder].holder).toBe(voidNode);
  s = act(s, "move", exitNode);
  expect(s.items[wayfinder].holder).toBe(voidNode);
  s = act(s, "move", "station");
  expect(["station", "pond"]).toContain(s.items[wayfinder].holder);

  const world = dispatchShared({
    op: "create",
    save: encodeSave(enter()),
  }).world;
  world.actors.rue.place = exitNode;
  world.items["ratiradio-station-key"].holder = "vale";
  const request = {
    world,
    actor: "vale",
    claimed: ["vale", "rue"],
    present: [],
  };
  expect(
    dispatchShared({ ...request, op: "presence", present: ["rue"] }).world
      .items[wayfinder].holder,
  ).toBe("vale");
  expect(
    dispatchShared({ ...request, op: "validate" }).world.items[wayfinder]
      .holder,
  ).toBe("vale");
  expect(["station", "pond"]).toContain(
    dispatchShared({ ...request, op: "presence" }).world.items[wayfinder]
      .holder,
  );
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
  old.crossings["pond-elysium-void-001"].discovered = true;
  old.crossings["elysium-void-001-pond"].discovered = true;
  delete old.items[chart];
  delete old.memories[chart];
  delete old.memories[observatory];

  const s = decodeSave(JSON.stringify(old));
  expect(s.packs.elysium.revision).toBe(packDefinition("elysium").revision);
  expect(s.actors.vale.place).toBe(spiral);
  expect(s.items[keystone].holder).toBe(voidNode);
  expect(s.items[chart].holder).toBe(observatory);
  expect(s.memories[observatory]).toBeDefined();
  expect(s.crossings["pond-elysium-void-001"].discovered).toBe(false);
  expect(s.crossings["elysium-void-001-pond"].discovered).toBe(false);
});
