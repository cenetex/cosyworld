import { createHash } from "node:crypto";
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
];
const fields = (kind, target) => ({
  [kind === "move" ? "target" : "item"]: target,
});

for (const opening of [false, true])
  it(`opens the Radio entrance only while the key is carried (opening ${opening})`, () => {
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
    expect(trace).toEqual(route); // Six reached transitions, not six random attempts.
    expect(world.packs.ratiradio.flags).toEqual({});
    expect(world.items[key].holder).toBe(kitchen);
    // Left behind with the key, the entrance is shut again from outside.
    expect(
      legalActions(world).some((a) => a.kind === "move" && a.target === kitchen),
    ).toBe(false);
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
  for (const [index, step] of fixture.steps.entries()) {
    const request = { ...step.request, world };
    const before = structuredClone(request);
    // The recorded journey re-entered the kitchen without the key, on the
    // latched entrance. Today the entrance follows the key (R1): the recorded
    // re-entries, Vale's at step 7 and Mara's at step 14, are not offered.
    if ([7, 14].includes(index)) {
      expect(step.request.action.target).toBe(kitchen);
      const view = dispatchShared({ ...request, op: "view" });
      expect(view.actions).not.toContainEqual(step.request.action);
      expect(play(structuredClone(world), step.request.action).ok).toBe(false);
      continue;
    }
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
  expect(reached).toBe(13);
  expect(world.items[key].holder).toBe(kitchen);
  expect(world.packs.ratiradio.flags).toEqual({});
  expect(world.actors.mara.place).toBe("station");
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
const sha = (value) => createHash("sha256").update(value).digest("hex");
const digest = (world) => sha(JSON.stringify(sorted(world)));
const ruleFile = (name) =>
  readFileSync(
    new URL(`../v2/orchestrator-rust/src/card_shared/${name}`, import.meta.url),
  );
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
// The plays to add before local command `index`.
const localLockPlays = (index) =>
  ({
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
function assertReturn(world, at, added = 0) {
  const radio = world.packs.ratiradio;
  expect(!!radio.flags["raven-awake"]).toBe(at >= 59);
  expect(radio.receipts[receipt]).toBe(at >= 59 ? 55 + added : undefined);
  if (at >= 59) expect(radio.met[raven]).toBe(55 + added);
  if (at >= 60) expect(world.items[glass].holder).toBe("vale");
  if (at >= 68) {
    expect(world.actors.vale.place).toBe(home);
    expect(world.actors[raven].place).toBe("pond"); // Returning does not summon Raven home.
    expect(world.items[figurine].holder).toBe(home);
    expect(radio.flags["listening-open"]).toBe(true); // frozen rules-131 content latches it
  }
  if (at >= 79) {
    expect(world.actors.mara.place).toBe(home);
    expect(world.items.mask.holder).toBe("mara");
    expect(
      world.conversations.some(
        (c) => c.actors.includes("mara") && c.actors.includes(raven),
      ),
    ).toBe(false);
  }
  const milestone = ravenTrace.milestones.find((m) => m.afterOperation === at);
  if (milestone) {
    expect([world.turn, world.revision]).toEqual([
      milestone.turn + added,
      milestone.revision + added,
    ]);
    // RATi's wander follows the turn, which the added plays shift.
    if (!added)
      expect(world.actors["ratiradio-rati"].place).toBe(milestone.ratiPlace);
    for (const [item, holder] of Object.entries(milestone.holders))
      expect(world.items[item].holder).toBe(holder);
  }
}

// Only the frozen rules-131 replay runs. Replaying that recorded trace on the
// current rules (the old "current agreement" variant) was deleted: rules 133
// put the Raven Figurine in a locked box at the cottage, so the recorded
// plays are no longer offered. The current-rules journey is the local route
// test below, played from createWorld.
it(
    `reaches Raven's awakening and second-traveler return (frozen 131)`,
    { timeout: 30000 },
    () => {
      const engine = currentSharedEngine(131);
      const run = (request) =>
        JSON.parse(engine.cardShared(JSON.stringify(request)));
      let world = structuredClone(ravenTrace.initial);
      if (
        ruleFile("engine.rs")
          .toString()
          .includes('const VERSION: &str = "full-card-world/131"')
      )
        expect(digest(world)).toBe(ravenTrace.initialSha256);
      {
        expect(sha(ruleFile("engine-v131.js"))).toBe(ravenTrace.engineSha256);
        expect(
          sha(
            readFileSync(
              new URL(
                "./fixtures/card-content-rules-131.json",
                import.meta.url,
              ),
            ),
          ),
        ).toBe(ravenTrace.contentSha256);
        expect(digest(world)).toBe(ravenTrace.initialSha256);
      }
      let fork;
      for (const [index, step] of ravenTrace.steps.entries()) {
        const request = { ...step.request, world },
          before = structuredClone(request);
        if (request.op === "play")
          expect(run({ ...request, op: "view" }).actions).toContainEqual(
            request.action,
          );
        const result = run(request);
        expect(request).toEqual(before);
        expect(result.ok, result.error).toBe(true);
        expect(digest(result.world)).toBe(step.worldSha256);
        world = sorted(result.world);
        assertReturn(world, index + 1);
        if (index === 57) fork = structuredClone(world);
        // Raven's wander is a function of the turn.
        if (index >= 60 && index <= 63)
          expect(world.actors[raven].place).toBe(
            ["ratiradio-dispatch-window", kitchen, "station", "pond"][
              index - 60
            ],
          );
        if (index === 69)
          expect(
            run({ ...request, op: "view", world }).actions.some(
              (a) => a.kind === "move" && a.target === "clearing",
            ),
          ).toBe(false);
      }
      expect(ravenTrace.steps).toHaveLength(81);
      for (const request of [
        { op: "play", action: ravenTrace.steps[58].request.action },
        { op: "hold", choice: { item: null, revision: world.revision - 1 } },
      ]) {
        const input = {
            ...ravenTrace.steps.at(-1).request,
            ...request,
            actor: "vale",
            world,
          },
          before = structuredClone(input);
        expect(run(input).ok).toBe(false);
        expect(input).toEqual(before);
      }
      // Deposit history alone is insufficient. RATi need not be present.
      for (const [index, step] of ravenTrace.negativeFork.steps.entries()) {
        const request = { ...step.request, world: fork },
          before = structuredClone(request);
        expect(run({ ...request, op: "view" }).actions).toContainEqual(
          request.action,
        );
        const result = run(request);
        expect(result.ok, result.error).toBe(true);
        expect(digest(result.world)).toBe(step.worldSha256);
        expect(request).toEqual(before);
        fork = sorted(result.world);
        expect(!!fork.packs.ratiradio.flags["raven-awake"]).toBe(index === 13);
        if (index === 12)
          expect(fork.actors["ratiradio-rati"].place).toBe(
            "ratiradio-dispatch-window",
          );
      }
      expect(fork.packs.ratiradio.receipts[receipt]).toBe(68);
      expect(fork.actors["ratiradio-rati"].place).toBe(kitchen);
    },
  );

it("reaches a local Raven return using the local NPC route and reloads every play", () => {
  let world = createWorld({ seed: 92 }),
    met,
    awakened,
    added = 0;
  for (const [index, command] of ravenTrace.localRoute.commands.entries()) {
    if (skipped.has(index)) continue;
    for (const [kind, to] of localLockPlays(index)) {
      const action = legalActions(world).find(
        (a) => a.kind === kind && (a.item === to || a.target === to),
      );
      expect(action, `${kind} ${to}`).toBeDefined();
      const result = play(world, action, world.revision);
      expect(result.ok, result.error).toBe(true);
      world = reload(result.state);
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
      const rest = legalActions(world).find((a) => a.kind === "wait" && !a.sleep);
      world = reload(play(world, rest, world.revision).state);
      added++;
    }
    const before = structuredClone(world),
      request = structuredClone(command);
    if (command.op === "play")
      expect(legalActions(world), `command ${index}`).toContainEqual(command.action);
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
