import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const key = "course:vale::greek-harbor";
const primary = "opening_pond_ship_course";
const depart = "opening_pond_ship_course_depart";

function captureCourse(source) {
  const action =
    "    const respondent = perform(next, exact, round2, residents2);";
  const sailed = "    settleVoyageCargo(next, voyages, nameOf2, worldLine);";
  assert.equal(source.split(action).length, 2);
  assert.equal(source.split(sailed).length, 2);
  return source
    .replace(
      action,
      "$&\n    if (next.turn === 9) globalThis.course = structuredClone(next);",
    )
    .replace(
      sailed,
      "    if (next.turn === 9) globalThis.departed = structuredClone(next);\n$&",
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
  let sample, setting;
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
        const boarded = play(
          world,
          ["move", "vale", item, "greek-ship"].join(":"),
        );
        if (canonical) boarded.actors = sorted(boarded.actors);
        const request = {
          ...seats,
          op: "play",
          world: boarded,
          action: canonical ? { key } : key,
          revision: boarded.revision,
        };
        const reply = run(request);
        const course = captured("course");
        const sailed = captured("departed");
        const label = JSON.stringify({ seed, canonical, item });
        sample = { ...request, op: primary };
        assert.ok(
          isDeepStrictEqual(wasm(sample), { ok: true, world: course }),
          label,
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
        assert.deepEqual(reply.events, [course.log.at(-1), sailed.log.at(-1)]);
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
  const wrongCourse = structuredClone(setting.world);
  wrongCourse.transports["greek-ship"].destination = "pond";
  assert.equal(wasm({ ...setting, world: wrongCourse }), null);
});
