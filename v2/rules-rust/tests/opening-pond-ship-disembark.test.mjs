import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const ship = "greek-ship";
const harbor = "greek-harbor";
const op = "opening_pond_ship_disembark";
const residentsOp = "opening_ship_disembark_residents";

test("Vale's first disembark matches pinned placement, custody, witnesses and discovery", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine((source) => {
    const primary =
      "    const respondent = perform(next, exact, round2, residents2);";
    const residents = "    const rings2 = next.log.filter(";
    const planned =
      "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
    const settled = "    noteRumours(s, next, wantAPI(next), wantAPI(s));";
    for (const marker of [primary, settled, planned, residents])
      assert.equal(source.split(marker).length, 2);
    return source
      .replace(
        primary,
        `$&
    if (next.turn === 11 && exact.kind === "move" && exact.target === "greek-harbor")
      globalThis.primary = structuredClone(next);`,
      )
      .replace(
        residents,
        "    if (next.turn === 11) globalThis.afterResidents = structuredClone(next);\n$&",
      )
      .replace(
        planned,
        `      const action = read2 ?? plan(next, id).action;
      if (next.turn === 11) globalThis.residentPlans.push([id, action.key]);
      perform(next, action, round2, residents2);`,
      )
      .replace(
        settled,
        "$&\n    if (next.turn === 11) globalThis.settled = structuredClone(next);",
      );
  });
  const run = (request) => {
    const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  const play = (world, action) =>
    run({ ...seats, op: "play", world, action }).world;
  const speech = (world, lines) => ({
    ...seats,
    op: "speech",
    world,
    room: ship,
    lines,
  });
  let sample, adaLanding, settled, captionedSample;
  for (const seed of [undefined, 2, 17, 4242]) {
    for (const ordered of [false, true]) {
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
      ])
        world = play(world, action);
      const lastRoom = seed === 17 && ordered;
      if (lastRoom)
        for (const item of ["lamp", "cloth"])
          world = run({
            ...seats,
            op: "hold",
            world,
            choice: { item, revision: world.revision },
          }).world;
      world = play(world, "move:vale::pond");
      if (ordered)
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
      world = play(world, "drop:vale:lamp:pond");
      assert.equal(world.items.lamp.fuel, lastRoom ? 4 : 8);
      world = play(world, "move:vale:cloth:greek-ship");
      if (ordered) {
        const by = seed === undefined ? "ada" : "vale";
        world = run(
          speech(world, [{ actorId: by, text: "Ready to sail." }]),
        ).world;
      }
      world = play(world, "course:vale::greek-harbor");
      if (ordered) {
        world = run(
          speech(world, [{ entityId: ship, text: "The sails fill." }]),
        ).world;
      }
      world = play(world, "wait:vale::");
      const captions = speech(world, [
        { actorId: "vale", text: "  We made it to the harbor. " },
        { entityId: ship, text: "The hull settles into its berth." },
      ]);
      const spoken = run(captions);
      assert.deepEqual(wasm(captions), spoken);
      assert.equal(spoken.world.revision, world.revision + 1);
      assert.equal(spoken.world.eventSeq, world.eventSeq + 2);
      if (seed === undefined) {
        for (const lines of [
          [{ actorId: "ada", text: "We made it." }],
          [captions.lines[0], captions.lines[0]],
        ]) {
          const rejected = speech(world, lines);
          assert.equal(pinned(rejected).ok, false);
          assert.equal(wasm(rejected), null);
        }
      }
      for (const [prior, cloth] of [world, spoken.world].flatMap((prior) =>
        ["", "cloth"].map((cloth) => [prior, cloth]),
      )) {
        const key = ["move", "vale", cloth, harbor].join(":");
        const request = {
          ...seats,
          op: "play",
          world: prior,
          action: ordered ? { key } : key,
          revision: prior.revision,
        };
        reference.residentPlans = [];
        const reply = run(request);
        assert.ok(
          isDeepStrictEqual(wasm(request), reply),
          `play ${seed} ${ordered} ${key}`,
        );
        const primary = JSON.parse(JSON.stringify(reference.primary));
        sample = { ...request, op };
        if (prior === spoken.world && seed === undefined)
          captionedSample = sample;
        const candidate = wasm(sample);
        const diff = Object.keys(primary).find(
          (field) =>
            !isDeepStrictEqual(candidate?.world[field], primary[field]),
        );
        assert.ok(
          isDeepStrictEqual(candidate, { ok: true, world: primary }),
          `${seed} ${ordered} ${key} ${diff ?? "envelope"}`,
        );
        const event = primary.log.at(-1);
        assert.deepEqual(reply.events[0], event);
        assert.equal(event.seq, prior.eventSeq + 1);
        assert.equal(primary.arrival.seq, event.seq);
        assert.equal(primary.revision, prior.revision + 1);
        if (prior === spoken.world)
          assert.deepEqual(primary.log.slice(-3, -1), spoken.lines);
        assert.equal(event.itemId, cloth || null);
        assert.equal(event.light, false);
        assert.equal(primary.actors.vale.heldItem, "cloth");
        assert.equal(primary.actors.vale.crossed, 3);
        assert.equal(
          primary.items.cloth.history.at(-1),
          "Turn 11: Vale carried it to The Wine-Dark Harbor.",
        );
        assert.deepEqual(primary.items.lamp, world.items.lamp);
        assert.deepEqual(primary.routeKnowledge, world.routeKnowledge);
        assert.deepEqual(primary.crossings["greek-harbor-pond"], {
          discovered: true,
        });
        assert.equal(primary.opening.met["greek-shipmaster"], 11);
        assert.equal(primary.packs["greek-drama"].met["greek-shipmaster"], 11);
        assert.deepEqual(
          primary.transports[ship].riders,
          seed === undefined ? ["ada"] : [],
        );
        assert.equal(primary.actors.ada.place, world.actors.ada.place);
        const afterResidents = JSON.parse(
          JSON.stringify(reference.afterResidents),
        );
        const residentRequest = { op: residentsOp, world: primary };
        const residentReply = wasm(residentRequest);
        assert.ok(
          isDeepStrictEqual(residentReply, { ok: true, world: afterResidents }),
          `residents ${seed} ${ordered} ${key}`,
        );
        const hasAda = seed === undefined;
        const plans = Object.fromEntries(reference.residentPlans);
        assert.deepEqual(Object.keys(plans).sort(), [
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
        for (const [id, plan] of Object.entries(plans)) {
          assert.equal(
            plan,
            hasAda && id === "ada" ? `move:ada::${harbor}` : `wait:${id}::`,
          );
        }
        if (hasAda) {
          adaLanding = residentRequest;
          const followed = afterResidents.log.at(-1);
          assert.equal(followed.actorId, "ada");
          assert.equal(followed.fromLocationId, ship);
          assert.equal(followed.locationId, harbor);
          assert.deepEqual(followed.witnesses, ["ada"]);
          assert.equal(afterResidents.actors.ada.dwellUntil, 40);
          assert.equal(afterResidents.transports[ship].since, 11);
          assert.equal(afterResidents.transports[ship].phase, "docked");
          assert.deepEqual(afterResidents.transports[ship].riders, []);
          assert.deepEqual(reply.events, [event, followed]);
        } else {
          assert.ok(isDeepStrictEqual(primary, afterResidents));
          assert.deepEqual(reply.events, [event]);
        }
        const label = `${seed} ${ordered} ${key}`;
        settled = {
          ...seats,
          op: "opening_greek_harbor_view",
          world: JSON.parse(JSON.stringify(reference.settled)),
          beforeSeq: prior.eventSeq,
        };
        assert.ok(
          isDeepStrictEqual(wasm(settled), reply),
          `Harbor reply ${label}`,
        );
        if (cloth) {
          const spoken = run({
            ...seats,
            op: "speech",
            world: reply.world,
            room: harbor,
            lines: [
              { actorId: "vale", text: "Good to see the shore." },
              {
                actorId: "greek-shipmaster",
                text: "The tides brought you here.",
              },
              { entityId: harbor, text: "Surf washes around the quay." },
            ],
          }).world;
          assert.equal(spoken.eventSeq, reply.world.eventSeq + 3);
          for (const present of [seats.present, []]) {
            const reload = { ...seats, op: "view", world: spoken, present };
            assert.ok(
              isDeepStrictEqual(wasm(reload), run(reload)),
              `Harbor reload ${label} ${present.length}`,
            );
          }
          assert.equal(
            wasm({
              ...seats,
              op: "view",
              world: spoken,
              claimed: [],
              present: [],
            }),
            null,
          );
        }
      }
    }
  }
  assert.equal(wasm({ ...sample, present: [] }), null);
  assert.equal(wasm({ ...sample, revision: sample.revision - 1 }), null);
  assert.equal(wasm({ ...sample, action: `move:vale:lamp:${harbor}` }), null);
  assert.equal(wasm({ ...settled, beforeSeq: settled.beforeSeq - 1 }), null);
  const wrongTablet = structuredClone(settled.world);
  wrongTablet.items["greek-helen-accounts"].holder = "greek-shipmaster";
  assert.equal(wasm({ ...settled, world: wrongTablet }), null);
  for (const mutate of [
    (world) => {
      world.transports[ship].riders = [];
    },
    (world) => {
      world.actors.moth.want.refusals = 1;
    },
    (world) => {
      world.actors.tavi.homeward = true;
    },
  ]) {
    const world = structuredClone(adaLanding.world);
    mutate(world);
    assert.equal(wasm({ ...adaLanding, world }), null);
  }
  for (const mutate of [
    (world) => {
      world.transports[ship].phase = "sea";
    },
    (world) => {
      world.transports[ship].riders = [];
    },
    (world) => {
      delete world.routeKnowledge.vale;
    },
    (world) => {
      world.items.oil.holder = "cloth";
    },
    (world) => {
      world.items.lamp.lit = false;
    },
  ]) {
    const world = structuredClone(sample.world);
    mutate(world);
    assert.equal(wasm({ ...sample, world }), null);
  }
  for (const change of [
    (line) => {
      Object.assign(line, {
        kind: "dialogue",
        actorId: "ada",
        entityId: "ada",
        speaker: "Sage",
      });
    },
    (line) => {
      line.generated = false;
    },
    (line) => {
      line.locationId = harbor;
    },
    (line) => {
      line.text = "  ";
    },
    (line) => {
      line.witnesses = ["vale"];
    },
    (line) => {
      line.seq -= 1;
    },
  ]) {
    const world = structuredClone(captionedSample.world);
    change(world.log.at(-1));
    assert.equal(wasm({ ...captionedSample, world }), null);
  }
});
