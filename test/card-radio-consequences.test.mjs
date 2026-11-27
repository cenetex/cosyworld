import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  holdChoice,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { act, reload } from "./helpers/world-life.mjs";

// Match serde_json's object-key order at the real Rust request boundary.
const sorted = (value) =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sorted(value[key])]),
        )
      : value;

const key = "ratiradio-station-key",
  kitchen = "ratiradio-staff-kitchen",
  entrancePlace = "behind-station";
const route = [
  ["move", "pond"],
  ["take", key],
  ["move", "station"],
  ["move", entrancePlace],
  ["move", kitchen],
  ["drop", key],
  ["move", entrancePlace],
];
const fields = (kind, target) => ({
  [kind === "move" ? "target" : "item"]: target,
});
// Today's route has one more room between the two locations in old traces.
const needsEntranceLeg = (world, actor, action) => {
  if (action?.kind !== "move") return false;
  const from = world.actors[actor].place;
  return (from === "station" && action.target === kitchen) ||
    (from === kitchen && action.target === "station");
};

for (const opening of [false, true])
  it(`opens the Radio entrance only while the key is carried or inside (opening ${opening})`, () => {
    let world = createWorld({ seed: 17, opening });
    if (opening)
      holdChoice(world, "vale", { item: null, revision: world.revision });
    const initial = structuredClone(world),
      trace = [];
    let firstMet;
    for (const [kind, target] of route) {
      const before = structuredClone(world);
      const next = act(world, kind, fields(kind, target));
      expect(world).toEqual(before);
      validateWorld(structuredClone(next)); // Never trust encodeSave's cached validity.
      trace.push([kind, target]);
      world = reload(next);
      expect(legalActions(world)).toEqual(legalActions(next));
      if (world.opening?.met.keeper !== undefined) {
        firstMet ??= world.opening.met.keeper;
        expect(world.opening.met.keeper).toBe(firstMet);
      }
      if (kind === "take") expect(world.items[key].holder).toBe("vale");
    }
    expect(trace).toEqual(route);
    expect(world.packs.ratiradio.flags).toEqual({});
    expect(world.items[key].holder).toBe(kitchen);
    // The key lies inside the station, so the entrance stays open from
    // outside; carried off, it shuts.
    const enter = (w) =>
      legalActions(w).some((a) => a.kind === "move" && a.target === kitchen);
    expect(enter(world)).toBe(true);
    const away = structuredClone(world);
    away.items[key].holder = "pond";
    expect(enter(away)).toBe(false);
    expect(world.items[key].history.some((s) => s.includes("Vale takes"))).toBe(
      true,
    );
    expect(world.packs.ratiradio.flags["raven-awake"]).toBeUndefined();
    // The next gate still needs its condition; station entry alone is no full return.
    expect(
      legalActions(world).some(
        (a) => a.kind === "move" && a.target === "ratiradio-dispatch-window",
      ),
    ).toBe(false);
    const saved = encodeSave(world);
    for (const action of [
      { kind: "give", item: key, target: "ratiradio-rati" },
      { kind: "drop", item: key },
      { kind: "move", target: "ratiradio-dispatch-window" },
    ]) {
      expect(play(world, action, world.revision).ok).toBe(false);
      expect(encodeSave(world)).toBe(saved);
    }
    expect(play(world, legalActions(world)[0], world.revision - 1).ok).toBe(
      false,
    );
    expect(encodeSave(world)).toBe(saved);
    let replay = initial;
    for (const [kind, target] of trace)
      replay = act(replay, kind, fields(kind, target));
    expect(replay).toEqual(world);
    expect(decodeSave(saved)).toEqual(world);
  });

it("agrees between today's source and compiled JS through the reachable trace", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/radio-entry-rules-130.json", import.meta.url),
    ),
  );
  const engine = currentSharedEngine();
  let world = dispatchShared({
    op: "create",
    seed: 17,
    save: encodeSave(createWorld({ opening: true, seed: 17 })),
  }).world;
  world = sorted(world);
  const replay = (request) => {
    const before = structuredClone(request);
    const result = dispatchShared(request);
    expect(request).toEqual(before);
    expect(result.ok, result.error).toBe(true);
    expect(JSON.parse(engine.cardShared(JSON.stringify(request)))).toEqual(
      result,
    );
    validateWorld(structuredClone(result.world));
    world = sorted(reload(result.world));
    expect(dispatchShared({ ...request, op: "view", world })).toEqual(
      dispatchShared({ ...request, op: "view", world: result.world }),
    );
  };
  let entranceLegs = 0;
  for (const [index, step] of fixture.steps.entries()) {
    const { actor, action: recorded } = step.request;
    let action = recorded;
    // The recorded journey re-entered without the key. The key still lies
    // inside RATiRadio, so the door stays open without a saved flag.
    if ([7, 14].includes(index)) {
      expect(action.target).toBe(kitchen);
      expect(world.items[key].holder).toBe(kitchen);
    }
    if (needsEntranceLeg(world, actor, recorded)) {
      const actions = () => dispatchShared({ ...step.request, op: "view", world }).actions;
      const via = actions().find((a) => a.kind === "move" && a.target === entrancePlace);
      expect(via).toBeDefined();
      replay({ ...step.request, world, action: via });
      action = actions().find((a) => a.key === recorded.key);
      expect(action).toBeDefined();
      entranceLegs++;
    }
    replay({ ...step.request, world, ...(action && { action }) });
  }
  expect(entranceLegs).toBe(4);
  expect(world.items[key].holder).toBe(kitchen);
  expect(world.packs.ratiradio.flags).toEqual({});
  expect(world.actors.mara.place).toBe(kitchen);
});

// Fresh seed 92, no opening or injected custody/encounters. Shared successors
// use serde's key order; the local trace deliberately retains its own NPC order.
const ravenTrace = JSON.parse(
  readFileSync(
    new URL("./fixtures/raven-return-rules-131.json", import.meta.url),
  ),
);
const home = "ratiradio-listening-room",
  raven = "ratiradio-raven";
const figurine = "ratiradio-raven-figurine";
const receipt = "ratiradio-return-things";
// The frozen journey was recorded before the Thermos and Booth locks (#2605),
// and when RATi's first three doors latched open. Current rules replay it with
// the plays those doors need, since each now follows its item and a traveler
// carries three things: the entrance opens for a carried Station Key (it is
// put down inside the kitchen and picked up again to go out and back), the
// Dispatch Window opens for a held Red Beanie (kept in hand until the last
// return, then carried out and back in with the glass), and the Thermos is
// set down at the Dispatch Window and stays there. A Talk with RATi holding
// the figurine opens the Booth. `added` counts the extra plays, so each turn
// and revision shifts by that many.
const thermos = "ratiradio-thermos",
  beanie = "ratiradio-red-beanie",
  stationKey = "ratiradio-station-key",
  glass = "ratiradio-glass";
// Recorded plays the live doors make unnecessary or impossible: leaving the
// key in the kitchen, and setting the beanie and Thermos down in the
// Listening Room.
const skipped = new Set([37, 44, 45]);
// Meet the keeper at the station, then return to Pip's pond.
const localRoutePlays = (index) =>
  ({
    11: [["move", "station"]],
    12: [["move", "pond"]],
    38: [["drop", glass]],
    41: [
      ["drop", stationKey],
      ["take", glass],
    ],
    42: [["drop", thermos]],
    48: [["take", stationKey]],
    55: [["talk", "ratiradio-rati"]],
    57: [["drop", beanie]],
    59: [["take", beanie]],
  })[index] ?? [];
const recordedPlacement = {
  [beanie]: "station",
  [thermos]: "clearing",
  [figurine]: "forest-cottage",
  [glass]: "greek-harbor",
};
it("reaches a local Raven return using the local NPC route and reloads every play", () => {
  let world = createWorld({ seed: 92 }),
    met,
    awakened,
    added = 0;
  for (const [id, place] of Object.entries(recordedPlacement))
    world.items[id].holder = place;
  for (const [index, recorded] of ravenTrace.localRoute.commands.entries()) {
    if (skipped.has(index)) continue;
    let command = recorded;
    for (const [kind, to] of localRoutePlays(index)) {
      const action = legalActions(world).find(
        (a) => a.kind === kind && (a.item === to || a.target === to),
      );
      expect(action, `${kind} ${to}`).toBeDefined();
      const result = play(world, action, world.revision);
      expect(result.ok, result.error).toBe(true);
      world = reload(result.state);
      added++;
    }
    if (needsEntranceLeg(world, "vale", recorded.action)) {
      world = reload(act(world, "move", { target: entrancePlace }));
      const action = legalActions(world).find((a) => a.key === recorded.action.key);
      expect(action).toBeDefined();
      command = { ...recorded, action };
      added++;
    }
    // Residents dwell where they arrive (rules 133), so a recorded play can
    // come before the resident it needs is in place: Wait until it is
    // offered, never for a fixed number of turns.
    for (
      let waits = 0;
      command.op === "play" &&
      waits < 120 &&
      !legalActions(world).some(
        (a) => JSON.stringify(a) === JSON.stringify(command.action),
      );
      waits++
    ) {
      const rest = legalActions(world).find(
        (a) => a.kind === "wait" && !a.sleep,
      );
      world = reload(play(world, rest, world.revision).state);
      added++;
    }
    const before = structuredClone(world),
      request = structuredClone(command);
    if (command.op === "play")
      expect(legalActions(world), `command ${index}`).toContainEqual(
        command.action,
      );
    let result;
    if (command.op === "hold") {
      const next = structuredClone(world);
      holdChoice(
        next,
        "vale",
        command.choice.revision === undefined
          ? command.choice
          : { ...command.choice, revision: world.revision },
      );
      result = { ok: true, state: next };
    } else
      result = play(
        world,
        command.action,
        command.revision === undefined ? undefined : world.revision,
      );
    expect(result.ok, result.error).toBe(true);
    expect(world).toEqual(before);
    expect(command).toEqual(request);
    validateWorld(structuredClone(result.state));
    world = reload(result.state);
    expect(world).toEqual(result.state);
    expect(legalActions(world)).toEqual(legalActions(result.state));
    const radio = world.packs.ratiradio;
    expect(!!radio.flags["raven-awake"]).toBe(index >= 57);
    if (index >= 57) {
      awakened ??= radio.receipts[receipt];
      met ??= radio.met[raven];
      expect([radio.receipts[receipt], radio.met[raven]]).toEqual([
        awakened,
        met,
      ]);
    }
  }
  expect(ravenTrace.localRoute.commands).toHaveLength(67);
  // Her walk to the pond takes as long as the residents dwell: wait for it.
  for (
    let waits = 0;
    world.actors[raven].place !== "pond" && waits < 160;
    waits++
  ) {
    const rest = legalActions(world).find((a) => a.kind === "wait" && !a.sleep);
    world = reload(play(world, rest, world.revision).state);
    added++;
  }
  expect(world.turn).toBeGreaterThanOrEqual(63 + added - skipped.size);
  expect(world.items[glass].holder).toBe("vale");
  expect(world.items[figurine].holder).toBe(home);
  expect(world.actors.vale.place).toBe(home);
  expect(world.actors[raven].place).toBe("pond");
});
