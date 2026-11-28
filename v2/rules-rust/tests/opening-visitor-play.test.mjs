import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

function captureVisitorPlays(source) {
  const boundary = "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
  assert.equal(source.split(boundary).length, 2);
  return source.replace(
    boundary,
    `      const action = read2 ?? plan(next, id).action;
      const observe = next.turn === 2 && unplayedAvatar(next, id);
      const before = observe ? structuredClone(next) : null;
      perform(next, action, round2, residents2);
      if (observe) globalThis.visitorPlays.push({
        actor: id, action, before, after: structuredClone(next),
      });`,
  );
}

test("second visitor actions preserve pinned quiet arrivals and complete home departures", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(captureVisitorPlays);
  const counts = { move: 0, wait: 0 };
  for (const seed of [undefined, 2, 17, 4242, 4294967295]) {
    const created = pinned({ op: "create", seed });
    assert.equal(created.ok, true, created.error);
    for (const [first, second] of [
      ["wait:vale::", "wait:vale::"],
      ["drop:vale:lamp:attic", "take:vale:lamp:"],
    ]) {
      const started = pinned({ ...seats, op: "play", world: created.world, action: first });
      assert.equal(started.ok, true, started.error);
      reference.visitorPlays = [];
      const completed = JSON.parse(reference.cardShared(JSON.stringify({
        ...seats, op: "play", world: started.world, action: second,
      })));
      assert.equal(completed.ok, true, completed.error);
      const observed = JSON.parse(JSON.stringify(reference.visitorPlays));
      assert.equal(observed.length, 7);
      for (const { actor, action, before, after } of observed) {
        const actual = wasm({ op: "opening_visitor_play", world: before, actor });
        const label = JSON.stringify({ seed, second, actor, action: action.key });
        assert.ok(actual, `unsupported ${label}`);
        assert.ok(isDeepStrictEqual(actual, { ok: true, world: after }), label);
        if (action.kind === "wait") {
          assert.ok(isDeepStrictEqual(after, before), label);
          counts.wait++;
        } else {
          assert.equal(action.kind, "move");
          const event = after.log.at(-1);
          const [, item] = event.witnesses;
          assert.equal(after.items[item].holder, event.fromLocationId);
          assert.deepEqual(after.items[item].history, before.items[item].history);
          assert.equal(after.actors[actor].heldItem, null);
          assert.equal(after.crossings[`${event.fromLocationId}-${event.locationId}`].discovered, true);
          counts.move++;
        }
      }
    }
  }
  assert.deepEqual(counts, { move: 6, wait: 64 });
});
