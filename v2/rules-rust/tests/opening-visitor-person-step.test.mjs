import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const sequences = [
  ["wait:vale::", "wait:vale::"],
  ["drop:vale:lamp:attic", "take:vale:lamp:"],
];

function capturePursuit(source) {
  const boundary = "      return readPlan(s, actor);";
  assert.equal(source.split(boundary).length, 2);
  return source.replace(
    boundary,
    `      const chosen = readPlan(s, actor);
      const resident = s.actors[actor];
      const target = s.actors[resident.want?.target]?.place;
      if (s.turn === (s.began || 0) + 2 && unplayedAvatar(s, actor) &&
          resident.want?.kind === "person" && !resident.want.step &&
          target && target !== resident.place) {
        const step = readRouteBetween(s, resident.place, target, actor)?.[1] ?? null;
        globalThis.pursuits.push({ actor, step, action: chosen.action.key,
          world: structuredClone(s) });
      }
      return chosen;`,
  );
}

test("unplayed visitors use the first step on the pinned projected route", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(capturePursuit);
  const moved = new Set();
  let noRoute = 0;
  for (const options of [
    {}, { seed: 2 }, { seed: 17 }, { seed: 4242 }, { seed: 4294967295 },
    { seed: 17, history: true },
  ]) {
    const created = pinned({ op: "create", ...options });
    assert.equal(created.ok, true, created.error);
    for (const [first, second] of sequences) {
      const started = pinned({ ...seats, op: "play", world: created.world, action: first });
      assert.equal(started.ok, true, started.error);
      reference.pursuits = [];
      const completed = JSON.parse(reference.cardShared(JSON.stringify({
        ...seats, op: "play", world: started.world, action: second,
      })));
      assert.equal(completed.ok, true, completed.error);
      assert.ok(reference.pursuits.length > 3);
      for (const pursuit of reference.pursuits) {
        const { world, actor, step, action } = JSON.parse(JSON.stringify(pursuit));
        const actual = wasm({ op: "visitor_person_step", world, actor });
        assert.deepEqual(actual, { ok: true, step }, JSON.stringify({ options, second, actor }));
        if (step) {
          assert.equal(action, `move:${actor}::${step}`);
          moved.add(action);
        } else {
          noRoute++;
        }
      }
    }
  }
  for (const action of [
    "move:ash::willows-camp",
    "move:orin::willows-bank",
    "move:nell::forest-cottage",
  ]) assert.ok(moved.has(action), action);
  assert.ok(noRoute > 0);
});
