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
  kitchen = "ratiradio-staff-kitchen";
const route = [
  ["move", "pond"],
  ["take", key],
  ["move", "station"],
  ["move", kitchen],
  ["drop", key],
  ["move", "station"],
  ["move", kitchen],
];
const fields = (kind, target) => ({
  [kind === "move" ? "target" : "item"]: target,
});

for (const opening of [false, true])
  it(`keeps earned Radio entry without claiming custody (opening ${opening})`, () => {
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
    expect(trace).toEqual(route); // Seven reached transitions, not seven random attempts.
    expect(world.packs.ratiradio.flags).toEqual({ "station-open": true });
    expect(world.items[key].holder).toBe(kitchen);
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

it("preserves the reviewed rules-130 synthetic Radio trace in compiled JS", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/radio-entry-rules-130.json", import.meta.url),
    ),
  );
  const engine = currentSharedEngine(130);
  let world = fixture.initial;
  for (const step of fixture.steps) {
    const request = { ...step.request, world };
    const response = JSON.parse(engine.cardShared(JSON.stringify(request)));
    expect(response.ok, response.error).toBe(true);
    expect(response.world).toEqual(step.world);
    world = sorted(response.world);
  }
  expect(world.items[key].holder).toBe(kitchen);
  expect(world.packs.ratiradio.flags).toEqual({ "station-open": true });
  expect(world.actors.mara.place).toBe(kitchen);
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
  let reached = 0;
  for (const step of fixture.steps) {
    const request = { ...step.request, world };
    const before = structuredClone(request);
    const result = dispatchShared(request);
    expect(request).toEqual(before);
    expect(result.ok, result.error).toBe(true);
    expect(JSON.parse(engine.cardShared(JSON.stringify(request)))).toEqual(
      result,
    );
    validateWorld(structuredClone(result.world));
    world = sorted(reload(result.world));
    expect(dispatchShared({ ...step.request, op: "view", world })).toEqual(
      dispatchShared({ ...step.request, op: "view", world: result.world }),
    );
    reached++;
  }
  expect(reached).toBe(15);
  expect(world.items[key].holder).toBe(kitchen);
  expect(world.packs.ratiradio.flags).toEqual({ "station-open": true });
  expect(world.actors.mara.place).toBe(kitchen);
});
