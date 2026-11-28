import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const ship = "greek-ship";
const key = "wait:vale::";
const residents = "opening_ship_wait_residents";
const beforeDock = "opening_ship_wait_before_docking";
const afterDock = "opening_ship_wait_after_docking";

function captureWait(source) {
  const primary =
    "    const respondent = perform(next, exact, round2, residents2);";
  const docking = "    settleVoyageCargo(next, voyages, nameOf2, worldLine);";
  const plans =
    "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
  const after = "    const rings2 = next.log.filter(";
  const sailing = "    const voyages = sailTransports(next);";
  const wants = "    reviseStalledWants(\n      next,";
  const late =
    "    if (dayOf(next) !== dayOf(s)) dailyRumours(next, wantAPI(next));";
  const settled = "    noteRumours(s, next, wantAPI(next), wantAPI(s));";
  for (const marker of [
    primary,
    docking,
    plans,
    after,
    sailing,
    wants,
    late,
    settled,
  ])
    assert.equal(source.split(marker).length, 2);
  return source
    .replace(
      plans,
      `      const chosen = read2 ?? plan(next, id).action;
      if (next.turn === 10) globalThis.plans.push([id,chosen.key,Boolean(read2 || beginLearning(next,chosen) || transportArrival(next,id) || packWaitChoice(next,id) || chosen.sleep || chosen.guards)]);
      perform(next, chosen, round2, residents2);`,
    )
    .replace(
      after,
      "    if (next.turn === 10) globalThis.afterResidents = structuredClone(next);\n$&",
    )
    .replace(
      primary,
      "$&\n    if (next.turn === 10) globalThis.waited = structuredClone(next);",
    )
    .replace(
      docking,
      "    if (next.turn === 10) globalThis.docked = structuredClone(next);\n$&",
    )
    .replace(
      sailing,
      "    if (next.turn === 10) globalThis.beforeDock = structuredClone(next);\n$&",
    )
    .replace(
      wants,
      "    if (next.turn === 10) globalThis.beforeWants = structuredClone(next);\n$&",
    )
    .replace(
      late,
      "$&\n    if (next.turn === 10) globalThis.finished = structuredClone(next);",
    )
    .replace(
      settled,
      "    if (next.turn === 10) globalThis.settled = structuredClone(next);\n$&",
    );
}

test("shipboard Wait matches pinned arrival, riders and both learned sea edges", async () => {
  const { wasm } = await reducers();
  const reference = currentSharedEngine(captureWait);
  const captured = (name) => JSON.parse(JSON.stringify(reference[name]));
  const run = (request) => {
    const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  const play = (world, action) =>
    run({ ...seats, op: "play", world, action }).world;
  const preserveActorOrder = (updated, before) => ({
    ...updated,
    actors: Object.fromEntries(
      Object.keys(before.actors).map((id) => [id, updated.actors[id]]),
    ),
  });
  const publish = (world, lines, context = {}) => {
    const request = {
      ...seats,
      ...context,
      op: "speech",
      world,
      room: ship,
      lines,
    };
    const actual = wasm(request);
    assert.ok(
      isDeepStrictEqual(actual, run(request)),
      `speech at ${world.turn}`,
    );
    return preserveActorOrder(actual.world, world);
  };
  let sample, arriving, arrived, completed;
  for (const seed of [undefined, 2, 17, 4242]) {
    for (const [ordered, spoken] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      let world = run({ op: "create", seed }).world;
      world = run({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      }).world;
      for (const action of [
        "move:vale::pond",
        "move:vale::station",
        "read:vale:keeper-log:",
        "accept:vale::keeper",
        "move:vale::pond",
        "move:vale::station",
        "move:vale::pond",
      ])
        world = play(world, action);
      if (ordered)
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
      world = play(world, "drop:vale:lamp:pond");
      world = play(
        world,
        ordered ? "move:vale:cloth:greek-ship" : "move:vale::greek-ship",
      );
      if (ordered && (spoken || seed === 17)) {
        world = publish(world, [
          { entityId: ship, text: "A board creaks beneath the rail." },
        ]);
      }
      world = play(world, "course:vale::greek-harbor");
      if (spoken) {
        world = publish(world, [
          { actorId: "vale", text: "We’re underway." },
          { entityId: ship, text: "The wind catches the rigging." },
        ]);
        world = publish(
          world,
          [{ entityId: ship, text: "Water breaks at the bow." }],
          { present: [] },
        );
        world = publish(
          world,
          [{ actorId: "vale", text: "I can see the harbor." }],
          { claimed: [], present: [] },
        );
      }
      const request = {
        ...seats,
        op: "play",
        world,
        action: ordered ? { key } : key,
        revision: world.revision,
      };
      reference.plans = [];
      const reply = run(request);
      const waited = captured("waited");
      const docked = captured("docked");
      const label = `${seed} ${ordered}/${spoken}`;
      sample = { ...request, op: "opening_pond_ship_wait" };
      const actualWait = wasm(sample);
      assert.ok(
        isDeepStrictEqual(actualWait, { ok: true, world: waited }),
        `waited ${label}`,
      );
      const settled = captured("afterResidents");
      assert.deepEqual(settled, waited);
      assert.deepEqual(reference.plans.map(([id]) => id).toSorted(), [
        "ada",
        "ash",
        "keeper",
        "mara",
        "moth",
        "nell",
        "orin",
        "rue",
        "tavi",
      ]);
      assert.ok(
        reference.plans.every(
          ([id, key, effect]) => key === `wait:${id}::` && !effect,
        ),
      );
      assert.ok(
        isDeepStrictEqual(wasm({ op: residents, world: waited }), {
          ok: true,
          world: settled,
        }),
        `residents ${label}`,
      );
      const beforeTravel = captured("beforeDock");
      assert.deepEqual(beforeTravel, settled);
      assert.ok(
        isDeepStrictEqual(wasm({ op: beforeDock, world: settled }), {
          ok: true,
          world: beforeTravel,
        }),
        `roaming and life ${label}`,
      );
      arriving = {
        ...seats,
        op: "opening_pond_ship_dock",
        world: preserveActorOrder(beforeTravel, world),
      };
      assert.ok(
        isDeepStrictEqual(wasm(arriving), { ok: true, world: docked }),
        `docked ${label}`,
      );
      const beforeWants = captured("beforeWants");
      const finished = captured("finished");
      assert.deepEqual(beforeWants, docked);
      arrived = { op: afterDock, before: world, world: beforeWants };
      assert.ok(
        isDeepStrictEqual(wasm(arrived), { ok: true, world: finished }),
        `wants and visit speech ${label}`,
      );
      assert.deepEqual(finished.actors.keeper.contact, {
        moth: [10, 0],
        vale: [7, 0],
      });
      assert.deepEqual(finished.actors.vale.waitSpeech, {
        place: ship,
        turn: 10,
      });
      assert.deepEqual(reply.events, [waited.log.at(-1), docked.log.at(-1)]);
      assert.deepEqual(
        reply.events.map(({ seq }) => seq),
        [world.eventSeq + 1, world.eventSeq + 2],
      );
      assert.equal(waited.log.at(-2).generated === true, spoken);
      assert.deepEqual(waited.transports[ship], world.transports[ship]);
      assert.deepEqual(waited.actors.vale, world.actors.vale);
      assert.deepEqual(docked.transports[ship], {
        version: 3,
        phase: "arrived",
        dock: "greek-harbor",
        destination: null,
        riders: seed === undefined ? ["ada", "vale"] : ["vale"],
        since: 10,
        recall: null,
      });
      for (const id of docked.transports[ship].riders) {
        assert.equal(docked.actors[id].place, ship);
        assert.deepEqual(docked.routeKnowledge[id], [
          ["sea:greek-harbor", "sea:pond"],
          ["sea:pond", "sea:greek-harbor"],
        ]);
      }
      assert.deepEqual(docked.arrival, world.arrival);
      completed = {
        ...seats,
        op: "opening_pond_ship_wait_view",
        world: captured("settled"),
        beforeSeq: world.eventSeq,
      };
      assert.ok(isDeepStrictEqual(wasm(completed), reply), `reply ${label}`);
      const published = run({
        ...seats,
        op: "speech",
        room: ship,
        world: reply.world,
        lines: [
          { actorId: "vale", text: "We made it." },
          { entityId: ship, text: "The deck settles." },
        ],
      }).world;
      assert.equal(published.eventSeq, reply.world.eventSeq + 2);
      for (const present of [seats.present, []]) {
        const view = { ...seats, op: "view", world: published, present };
        assert.ok(
          isDeepStrictEqual(wasm(view), run(view)),
          `reload ${label} ${present.length}`,
        );
      }
      assert.equal(
        wasm({
          ...seats,
          op: "view",
          world: published,
          claimed: [],
          present: [],
        }),
        null,
      );
    }
  }
  assert.equal(wasm({ ...sample, present: [] }), null);
  assert.equal(wasm({ ...sample, revision: sample.revision - 1 }), null);
  assert.equal(wasm({ ...sample, action: "wait:vale::sleep" }), null);
  assert.equal(
    wasm({ ...completed, beforeSeq: completed.beforeSeq - 1 }),
    null,
  );
  const invalid = structuredClone(completed.world);
  invalid.transports[ship].riders = [];
  assert.equal(wasm({ ...completed, world: invalid }), null);
  for (const mutate of [
    (world) => {
      world.transports[ship].destination = "pond";
    },
    (world) => {
      world.stationExitOrder.push("the-ship-is-not-a-station-road");
    },
    (world) => {
      world.actors.rue.place = ship;
    },
    (world) => {
      world.log.findLast(
        (entry) => entry.turn === 9 && entry.generated !== true,
      ).generated = true;
    },
    (world) => {
      world.log.at(-1).locationId = "pond";
    },
    (world) => {
      world.log.at(-1).seq -= 1;
    },
  ]) {
    const world = structuredClone(sample.world);
    mutate(world);
    assert.equal(wasm({ ...sample, world }), null);
  }
  for (const mutate of [
    (world) => {
      world.transports[ship].riders = ["vale"];
    },
    (world) => {
      world.routeKnowledge.vale = [["attic", "pond"]];
    },
    (world) => {
      world.log.at(-2).locationId = "pond";
    },
  ]) {
    const world = structuredClone(arriving.world);
    mutate(world);
    assert.equal(wasm({ ...arriving, world }), null);
  }
  for (const change of [
    (world) => {
      world.transports[ship].phase = "arrived";
    },
    (world) => {
      world.actors.moth.want.refusals = 1;
    },
    (world) => {
      world.actors.tavi.dwellUntil = 10;
    },
  ]) {
    const world = structuredClone(arriving.world);
    change(world);
    assert.equal(wasm({ op: residents, world }), null);
  }
  assert.equal(wasm({ op: beforeDock, world: arrived.world }), null);
  for (const change of [
    (world) => {
      world.routeKnowledge.vale.pop();
    },
    (world) => {
      world.log.at(-1).text = "The ship casts off.";
    },
    (world) => {
      world.actors.keeper.contact.moth = [8, 0];
    },
  ]) {
    const world = structuredClone(arrived.world);
    change(world);
    assert.equal(wasm({ ...arrived, world }), null);
  }
});
