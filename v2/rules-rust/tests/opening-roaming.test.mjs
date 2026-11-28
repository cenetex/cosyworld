import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const bard = "greek-rhapsode";
const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

function compare(pinned, wasm, world) {
  const request = { ...seats, world, action: "wait:vale::" };
  const expected = pinned({ ...request, op: "play" });
  assert.equal(expected.ok, true, expected.error);
  const event = expected.events.find((entry) => entry.actorId === bard);
  assert.equal(event?.verb, "move");
  const fields = [
    "actorId",
    "fromLocationId",
    "itemId",
    "kind",
    "locationId",
    "speaker",
    "targetId",
    "text",
    "verb",
  ];
  const result = wasm({ ...request, op: "opening_bard_move" });
  assert.deepEqual(result, {
    ok: true,
    actor: expected.world.actors[bard],
    routes: expected.world.routeKnowledge[bard],
    event: Object.fromEntries(fields.map((field) => [field, event[field]])),
  });
  return result;
}

test("a first attic wait moves the bard along the pinned route", async () => {
  const { pinned, wasm } = await reducers();
  for (const options of [
    {},
    { seed: 4242 },
    { seed: 4242, history: true },
    { seed: 17, history: true, hidden: "mara", absent: ["ash"] },
  ]) {
    const world = pinned({ ...options, op: "create" }).world;
    compare(pinned, wasm, world);
  }
});

test("the bard learns visible roads and changes direction for a different want", async () => {
  const { pinned, wasm } = await reducers();
  const world = pinned({ op: "create", seed: 4242 }).world;
  const removed = new Set([
    "greek-harbor>greek-road-thebes",
    "greek-road-thebes>greek-harbor",
  ]);
  world.routeKnowledge[bard] = world.routeKnowledge[bard].filter(
    (edge) => !removed.has(edge.join(">")),
  );
  const learned = compare(pinned, wasm, world);
  assert.equal(learned.routes.length, world.routeKnowledge[bard].length + 2);

  world.actors[bard].want.target =
    "greek-story-aeschylus-suppliant-women-first";
  assert.equal(compare(pinned, wasm, world).actor.place, "greek-argolid-road");

  world.actors[bard].dwellUntil = 2;
  const wait = { ...seats, world, action: "wait:vale::" };
  assert.equal(
    pinned({ ...wait, op: "play" }).world.actors[bard].place,
    "greek-harbor",
  );
  assert.equal(wasm({ ...wait, op: "opening_bard_move" }), null);
});

test("the bard remembers the current roads while dwelling through the next turn", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine((source) => {
    const begin =
      /    for \(const id of roamingActors\) \{\n      if \(controlledByHuman\(next, id\) \|\| id === respondent/;
    const end =
      /    const cast = \[actor, respondent, \.\.\.residents\d*\]\.filter\(Boolean\);/;
    assert.match(source, begin);
    assert.match(source, end);
    return source
      .replace(
        begin,
        "    globalThis.beforeRoaming = structuredClone(next);\n$&",
      )
      .replace(end, "    globalThis.afterRoaming = structuredClone(next);\n$&");
  });
  for (const seed of [undefined, 2, 17, 4242, 4294967295]) {
    const { world } = pinned({ op: "create", seed });
    for (const [first, second] of [
      ["wait:vale::", "wait:vale::"],
      ["drop:vale:lamp:attic", "take:vale:lamp:"],
    ]) {
      let { world: next } = pinned({
        ...seats,
        op: "play",
        world,
        action: first,
      });
      const route = next.routeKnowledge[bard].find(
        ([from]) => from === next.actors[bard].place,
      );
      assert.ok(route);
      next.routeKnowledge[bard] = next.routeKnowledge[bard].filter(
        (e) => e !== route,
      );
      const reply = JSON.parse(
        reference.cardShared(
          JSON.stringify({
            ...seats,
            op: "play",
            world: next,
            action: second,
          }),
        ),
      );
      assert.equal(reply.ok, true, reply.error);
      const before = JSON.parse(JSON.stringify(reference.beforeRoaming));
      const after = JSON.parse(JSON.stringify(reference.afterRoaming));
      const request = { op: "opening_bard_dwell", world: before };
      const result = wasm(request);
      assert.ok(result, `${seed} ${second}`);
      assert.deepEqual(result.world, after);
      assert.equal(after.eventSeq, before.eventSeq);
      assert.equal(
        after.routeKnowledge[bard].length,
        before.routeKnowledge[bard].length + 1,
      );

      before.actors[bard].dwellUntil = before.turn;
      assert.equal(wasm(request), null);
    }
  }
});
