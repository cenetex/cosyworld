import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_station_move";

function tracePrimary(source) {
  const marker = "    const sourceSeq = event.seq;";
  assert.equal(source.split(marker).length, 2);
  source = source.replace(
    marker,
    `${marker}
    if (a.actor === "vale" && a.kind === "move" && a.target === "pond" && s.turn === 4)
      globalThis.pondReturn = structuredClone(s);`,
  );
  const drop =
    'a.actor === "vale" && a.kind === "drop" && a.item === "lamp" && here === "pond" && s.turn === 7';
  for (const [target, frame] of [
    ["    const narrateCall = ", "grounded"],
    [
      '    addLog(s, "World", text2, {\n      kind: "action",\n      actorId: a.actor,\n      verb: a.kind,\n      fromLocationId: here,',
      "beforeDropLog",
    ],
    [marker, "afterDropLog"],
  ]) {
    assert.equal(source.split(target).length, 2);
    source = source.replace(
      target,
      `    if (${drop}) globalThis.${frame} = structuredClone(s);\n${target}`,
    );
  }
  const narration = "    narrateCall();";
  assert.equal(source.split(narration).length, 2);
  source = source.replace(
    narration,
    `
    if (${drop}) globalThis.beforeCallNarration = structuredClone(s);
${narration}
    if (${drop}) globalThis.afterCallNarration = structuredClone(s);`,
  );
  const pending = "    const narrate = () => {";
  assert.equal(source.split(pending).length, 2);
  source = source.replace(
    pending,
    `
    if (defer && s.turn === 7 && s.actors.vale.place === "pond" && globalThis.callQueue === undefined)
      globalThis.callQueue = structuredClone(pending);
${pending}`,
  );
  for (const [target, phase] of [
    ["    creditOpened(s, next, actor);", "beforeCredit"],
    ["    for (const id of residents2) {", "afterCredit"],
    ["    const rings2 = next.log.filter(", "afterResidents"],
  ]) {
    assert.equal(source.split(target).length, 2);
    source = source.replace(
      target,
      `    if (next.turn === 7) globalThis.${phase} = structuredClone(next);\n${target}`,
    );
  }
  return source;
}

test("Vale's first return to Pond keeps the accepted Keeper quest and lamp state", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(tracePrimary);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  const play = (world, action) => run({ ...seats, op: "play", world, action });
  let sample;
  let complete;
  let view;
  let calledView;
  for (const [seed, dry, spoken, sorted] of [
    [undefined, false, false, false],
    [0, true, false, true],
    [2, false, true, false],
    [42, true, true, true],
    [4242, false, false, true],
    [4_294_967_295, true, false, false],
  ]) {
    let world = run({ op: "create", seed });
    if (dry)
      Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    else
      world = run({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      });
    world = play(play(world, "move:vale::pond"), "move:vale::station");
    if (spoken)
      world = run({
        ...seats,
        op: "speech",
        world,
        room: "station",
        lines: [{ actorId: "keeper", text: "The platform is quiet." }],
      });
    const read = play(world, "read:vale:keeper-log:");
    const accepted = play(read, "accept:vale::keeper");
    assert.equal(accepted.turn, 3);
    assert.equal(accepted.actors.vale.want.from, "quest:from:keeper");
    if (sorted)
      accepted.actors = Object.fromEntries(
        Object.entries(accepted.actors).toSorted(),
      );
    for (const key of ["move:vale::pond", "move:vale:lamp:pond"]) {
      const request = {
        ...seats,
        op: "play",
        world: accepted,
        action: sorted ? { key } : key,
        revision: accepted.revision,
      };
      reference.pondReturn = undefined;
      const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
      assert.equal(reply.ok, true, reply.error);
      const expected = JSON.parse(JSON.stringify(reference.pondReturn));
      const actual = wasm({ ...request, op });
      const label = `${seed} ${key}`;
      assert.ok(actual?.ok, `unsupported ${label}`);
      const field = Object.keys(expected).find(
        (name) => !isDeepStrictEqual(actual.world[name], expected[name]),
      );
      assert.ok(
        isDeepStrictEqual(actual, { ok: true, world: expected }),
        `${label} ${field ?? "envelope"}`,
      );
      const event = actual.world.log.at(-1);
      assert.deepEqual(event.cast, ["vale"]);
      assert.deepEqual(event.witnesses.slice(0, 3), ["vale", "moth", "keeper"]);
      assert.equal(event.fromLocationId, "station");
      assert.equal(event.itemId, key.includes(":lamp:") ? "lamp" : null);
      assert.deepEqual(actual.world.arrival, {
        seq: event.seq,
        fromLocationId: "station",
        locationId: "pond",
      });
      assert.deepEqual(
        actual.world.actors.vale.want,
        accepted.actors.vale.want,
      );
      assert.deepEqual(
        actual.world.actors.vale.visited,
        accepted.actors.vale.visited,
      );
      assert.equal(actual.world.items.lamp.fuel, accepted.items.lamp.fuel);
      const completed = wasm(request);
      const completedField = Object.keys(reply).find(
        (field) => !isDeepStrictEqual(completed?.[field], reply[field]),
      );
      assert.ok(
        isDeepStrictEqual(completed, reply),
        `${label} complete ${completed ? completedField : "unsupported"}`,
      );
      complete = {
        ...seats,
        op: "opening_pond_return_view",
        beforeSeq: accepted.eventSeq,
        world: { ...reply.world, speechVoices: accepted.speechVoices },
      };
      assert.ok(isDeepStrictEqual(wasm(complete), reply), `complete ${label}`);
      assert.deepEqual(reply.exits, ["station"]);
      assert.deepEqual(reply.world.speechVoices.vale, ["vale"]);
      assert.equal(reply.actions.at(-1).key, "drop:vale:::0");
      assert.ok(reply.actions.every(({ target }) => target !== "moth"));
      const published = run({
        ...seats,
        op: "speech",
        room: "pond",
        world: reply.world,
        lines: [
          { actorId: "vale", text: "The pond is quiet." },
          { entityId: "pond", text: "Rain trembles on the water." },
        ],
      });
      for (const world of [reply.world, published]) {
        for (const present of [seats.present, []]) {
          view = { ...seats, op: "view", world, present };
          const projected = wasm(view);
          const expected = pinned(view);
          assert.ok(
            isDeepStrictEqual(projected, expected),
            `private ${label} ${present.length} ${world === published}`,
          );
          assert.equal(projected.world.memories.moth.learning, undefined);
          assert.deepEqual(projected.world.memories.vale, world.memories.vale);
          assert.ok(!Object.hasOwn(projected, "events"));
        }
      }
      if (key === "move:vale::pond") {
        const withCloth = play(reply.world, "move:vale::station");
        assert.equal(withCloth.actors.vale.heldItem, "cloth");
        const ready = play(withCloth, "move:vale::pond");
        const drop = {
          ...seats,
          op: "play",
          world: ready,
          action: "drop:vale:lamp:pond",
          revision: ready.revision,
        };
        reference.callQueue = undefined;
        const called = JSON.parse(reference.cardShared(JSON.stringify(drop)));
        assert.equal(called.ok, true, called.error);
        const op = "opening_pond_lamp_drop";
        const cut = (phase) => JSON.parse(JSON.stringify(reference[phase]));
        const grounded = wasm({ ...drop, op, phase: "ground" });
        assert.ok(
          isDeepStrictEqual(grounded, { ok: true, world: cut("grounded") }),
          `ground ${label}`,
        );
        const recorded = wasm({
          op,
          phase: "record",
          world: cut("beforeDropLog"),
        });
        assert.ok(
          isDeepStrictEqual(recorded, { ok: true, world: cut("afterDropLog") }),
          `record ${label}`,
        );
        assert.equal(grounded.world.items.lamp.lit, !dry);
        const crossing = wasm({
          op: "opening_pond_call",
          world: cut("grounded"),
        });
        assert.ok(
          isDeepStrictEqual(crossing, {
            ok: true,
            world: cut("beforeDropLog"),
            pending: cut("callQueue"),
          }),
          `signal ${label}`,
        );
        assert.equal(crossing.pending.length, dry ? 0 : sorted ? 1 : 2);
        assert.ok(
          isDeepStrictEqual(recorded.world, cut("beforeCallNarration")),
          `before narration ${label}`,
        );
        const narration = {
          op: "opening_pond_call",
          phase: "narrate",
          world: recorded.world,
          pending: crossing.pending,
        };
        const narrated = wasm(narration);
        assert.ok(
          isDeepStrictEqual(narrated, {
            ok: true,
            world: cut("afterCallNarration"),
          }),
          `narration ${label}`,
        );
        if (crossing.pending.length === 2) {
          assert.equal(
            wasm({ ...narration, pending: [...crossing.pending].reverse() }),
            null,
          );
        }
        if (!dry)
          assert.equal(wasm({ ...narration, world: narrated.world }), null);
        assert.equal(
          wasm({ ...drop, op, phase: "ground", revision: ready.revision - 1 }),
          null,
        );
        if (!dry)
          assert.equal(
            wasm({ op, phase: "record", world: grounded.world }),
            null,
          );
        const tail = { op: "opening_pond_call_tail", before: ready };
        assert.ok(
          isDeepStrictEqual(
            wasm({ ...tail, phase: "credit", world: cut("beforeCredit") }),
            { ok: true, world: cut("afterCredit") },
          ),
          `credit ${label}`,
        );
        const cutAfterResidents = cut("afterResidents");
        const finished = wasm({
          ...tail,
          phase: "finish",
          world: cutAfterResidents,
        });
        assert.ok(finished?.ok, `finish ${label}`);
        for (const field of [
          "playerActorId",
          "heldActors",
          "presentActors",
          "controlledActors",
        ])
          delete finished.world[field];
        assert.ok(
          isDeepStrictEqual(finished.world, called.world),
          `tail ${label}`,
        );
        const request = {
          ...seats,
          op: "opening_pond_call_view",
          world: called.world,
          beforeSeq: ready.eventSeq,
        };
        const signal = called.world.crossings["pond-greek-harbor"];
        assert.equal(signal.discovered, !dry);
        if (dry) {
          assert.equal(wasm(request), null);
        } else {
          assert.ok(isDeepStrictEqual(wasm(request), called), label);
          const spoken = run({
            ...seats,
            op: "speech",
            room: "pond",
            world: called.world,
            lines: [{ actorId: "vale", text: "The ship has come." }],
          });
          for (const [world, present] of [
            [called.world, seats.present],
            [spoken, []],
          ]) {
            calledView = { ...seats, op: "view", world, present };
            assert.ok(
              isDeepStrictEqual(wasm(calledView), pinned(calledView)),
              `ship reload ${label}`,
            );
          }
        }
      }
      sample = request;
    }
    assert.equal(
      wasm({ ...sample, op, world: read, revision: read.revision }),
      null,
    );
  }
  for (const mutate of [
    (world) => {
      delete world.knowledge.known.vale["quest:keeper:pond"];
    },
    (world) => {
      world.actors.moth.place = "pond";
    },
    (world) => {
      world.items.oil.holder = "vale";
    },
  ]) {
    const world = structuredClone(sample.world);
    mutate(world);
    assert.equal(wasm({ ...sample, op, world }), null);
  }
  assert.equal(wasm({ ...sample, op, revision: sample.revision - 1 }), null);
  assert.equal(wasm({ ...complete, beforeSeq: complete.beforeSeq - 1 }), null);
  const wrongDock = structuredClone(calledView.world);
  wrongDock.transports["greek-ship"].dock = "greek-harbor";
  assert.equal(wasm({ ...calledView, world: wrongDock }), null);
  for (const mutate of [
    (world) => {
      delete world.knowledge.known.vale["quest:keeper:pond"];
    },
    (world) => {
      world.actors.moth.place = "pond";
    },
    (world) => {
      world.crossings["pond-greek-harbor"].discovered = true;
    },
    (world) => {
      world.items.lamp.lit = true;
    },
    (world) => {
      world.items["greek-water-jar"].holder = "pond";
    },
  ]) {
    const world = structuredClone(view.world);
    mutate(world);
    assert.equal(wasm({ ...view, world }), null);
  }
});
