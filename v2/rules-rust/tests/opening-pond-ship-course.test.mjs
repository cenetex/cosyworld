import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const key = "course:vale::greek-harbor";
const primary = "opening_pond_ship_course";
const depart = "opening_pond_ship_course_depart";
const residents = "opening_ship_course_residents";
const beforeSailing = "opening_ship_course_before_sailing";
const afterSailing = "opening_ship_course_after_sailing";

function captureCourse(source) {
  const action =
    "    const respondent = perform(next, exact, round2, residents2);";
  const sailed = "    settleVoyageCargo(next, voyages, nameOf2, worldLine);";
  const after = "    const rings2 = next.log.filter(";
  const stops = "    const worldLine = (text2, locationId) => addLog(next,";
  const preWants = "    reviseStalledWants(\n      next,";
  const late =
    "    if (dayOf(next) !== dayOf(s)) dailyRumours(next, wantAPI(next));";
  const plan =
    "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
  for (const cut of [action, sailed, after, plan, stops, preWants, late])
    assert.equal(source.split(cut).length, 2);
  return source
    .replace(
      after,
      "    if (next.turn === 9) globalThis.afterResidents = structuredClone(next);\n$&",
    )
    .replace(
      plan,
      `      const chosen = read2 ?? plan(next, id).action;
      if (next.turn === 9) globalThis.plans.push([id,chosen.key,Boolean(read2 || beginLearning(next,chosen) || transportArrival(next,id) || packWaitChoice(next,id) || chosen.sleep || chosen.guards)]);
      perform(next, chosen, round2, residents2);`,
    )
    .replace(
      action,
      "$&\n    if (next.turn === 9) globalThis.course = structuredClone(next);",
    )
    .replace(
      sailed,
      "    if (next.turn === 9) globalThis.departed = structuredClone(next);\n$&",
    )
    .replace(
      stops,
      "    if (next.turn === 9) globalThis.afterStops = structuredClone(next);\n$&",
    )
    .replace(
      preWants,
      "    if (next.turn === 9) globalThis.beforeWants = structuredClone(next);\n$&",
    )
    .replace(
      late,
      "$&\n    if (next.turn === 9) globalThis.finished = structuredClone(next);",
    );
}

test("the first Course matches the pinned action and departure", async () => {
  const { wasm } = await reducers();
  const reference = currentSharedEngine(captureCourse);
  const run = (request) => {
    const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  const play = (world, action) =>
    run({ ...seats, op: "play", world, action }).world;
  const captured = (name) => JSON.parse(JSON.stringify(reference[name]));
  const sorted = (entries) =>
    Object.fromEntries(Object.entries(entries).toSorted());
  let sample, setting, underway;
  for (const seed of [undefined, 2, 17, 4242]) {
    for (const canonical of [false, true]) {
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
      if (canonical) world.actors = sorted(world.actors);
      world = play(world, "drop:vale:lamp:pond");
      for (const item of ["", "cloth"]) {
        let boarded = play(
          world,
          ["move", "vale", item, "greek-ship"].join(":"),
        );
        const boardingSeq = boarded.eventSeq;
        if (item === "cloth") {
          boarded = run({
            ...seats,
            op: "speech",
            world: boarded,
            room: "greek-ship",
            lines: [
              { actorId: "vale", text: "The deck feels quiet." },
              ...(seed === undefined
                ? [{ actorId: "ada", text: "The water carries us." }]
                : []),
              { entityId: "greek-ship", text: "The hull creaks softly." },
            ],
          }).world;
          boarded = run({
            ...seats,
            op: "speech",
            world: boarded,
            present: [],
            lines: [
              { entityId: "greek-ship", text: "Ripples spread from the hull." },
            ],
          }).world;
          assert.equal(
            boarded.eventSeq,
            boardingSeq + 3 + Number(seed === undefined),
          );
        }
        if (canonical) boarded.actors = sorted(boarded.actors);
        const request = {
          ...seats,
          op: "play",
          world: boarded,
          action: canonical ? { key } : key,
          revision: boarded.revision,
        };
        reference.plans = [];
        const reply = run(request);
        const course = captured("course");
        const sailed = captured("departed");
        const label = JSON.stringify({ seed, canonical, item });
        sample = { ...request, op: primary };
        assert.ok(
          isDeepStrictEqual(wasm(sample), { ok: true, world: course }),
          label,
        );
        const waiting = captured("afterResidents");
        assert.deepEqual(waiting, course);
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
          isDeepStrictEqual(wasm({ op: residents, world: course }), {
            ok: true,
            world: waiting,
          }),
          `${label} residents`,
        );
        const ready = captured("afterStops");
        assert.deepEqual(ready, waiting);
        assert.ok(
          isDeepStrictEqual(wasm({ op: beforeSailing, world: waiting }), {
            ok: true,
            world: ready,
          }),
          `${label} roaming, life and stops`,
        );
        setting = { op: depart, world: course };
        assert.ok(
          isDeepStrictEqual(wasm(setting), { ok: true, world: sailed }),
          label,
        );
        assert.equal(course.transports["greek-ship"].phase, "course");
        assert.deepEqual(sailed.transports["greek-ship"], {
          ...course.transports["greek-ship"],
          phase: "sea",
        });
        assert.deepEqual(sailed.arrival, boarded.arrival);
        const beforeWants = captured("beforeWants");
        assert.deepEqual(beforeWants, sailed);
        const finished = captured("finished");
        underway = { op: afterSailing, before: boarded, world: beforeWants };
        assert.ok(
          isDeepStrictEqual(wasm(underway), { ok: true, world: finished }),
          `${label} wants and visit speech`,
        );
        assert.deepEqual(finished.actors.keeper.contact, {
          moth: [9, 0],
          vale: [7, 0],
        });
        assert.deepEqual(
          finished.actors.vale.waitSpeech,
          boarded.actors.vale.waitSpeech,
        );
        assert.deepEqual(reply.events, [course.log.at(-1), sailed.log.at(-1)]);
        assert.equal(course.log.at(-1).seq, boarded.eventSeq + 1);
        assert.deepEqual(reply.exits, []);
        assert.deepEqual(
          course.log.at(-1).witnesses,
          seed === undefined ? ["vale", "ada", "cloth"] : ["vale", "cloth"],
        );
      }
    }
  }
  assert.equal(wasm({ ...sample, present: [] }), null);
  assert.equal(wasm({ ...sample, revision: sample.revision - 1 }), null);
  assert.equal(wasm({ ...sample, action: "course:vale::pond" }), null);
  const other = structuredClone(sample.world);
  other.actors.ada.place = "greek-ship";
  assert.equal(wasm({ ...sample, world: other }), null);
  const wrongCaption = structuredClone(sample.world);
  wrongCaption.log.at(-1).speaker = "Unwitnessed speaker";
  assert.equal(wasm({ ...sample, world: wrongCaption }), null);
  const unwitnessed = structuredClone(setting.world);
  unwitnessed.log.at(-2).cast.push("ada");
  assert.equal(wasm({ ...setting, world: unwitnessed }), null);
  const mislabeled = structuredClone(setting.world);
  mislabeled.log.at(-2).speaker = "Unwitnessed speaker";
  assert.equal(wasm({ ...setting, world: mislabeled }), null);
  const wrongCourse = structuredClone(setting.world);
  wrongCourse.transports["greek-ship"].destination = "pond";
  assert.equal(wasm({ ...setting, world: wrongCourse }), null);
  for (const change of [
    (world) => {
      world.transports["greek-ship"].phase = "sea";
    },
    (world) => {
      world.actors.moth.want.refusals = 1;
    },
    (world) => {
      world.actors.tavi.dwellUntil = 9;
    },
  ]) {
    const world = structuredClone(setting.world);
    change(world);
    assert.equal(wasm({ op: residents, world }), null);
  }
  assert.equal(wasm({ op: beforeSailing, world: underway.world }), null);
  const sleeping = structuredClone(setting.world);
  sleeping.actors.moth.sleeping = { place: "station", since: 8, until: 10 };
  assert.equal(wasm({ op: beforeSailing, world: sleeping }), null);
  for (const change of [
    (world) => {
      world.log.at(-1).text = "The ship docks.";
    },
    (world) => {
      world.transports["greek-ship"].riders.push("vale");
    },
    (world) => {
      world.actors.keeper.contact.moth = [7, 0];
    },
  ]) {
    const world = structuredClone(underway.world);
    change(world);
    assert.equal(wasm({ ...underway, world }), null);
  }
});
