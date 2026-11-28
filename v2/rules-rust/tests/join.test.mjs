import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

test("opening claims match the complete journal projection of pinned join", async () => {
  const { pinned, wasm } = await reducers();
  const setups = [
    { seed: 0 },
    { seed: 7, hidden: "nell", absent: ["mara"] },
    { seed: 42, history: true, homecoming: "ash" },
    { seed: 4242, hidden: "mara", absent: ["tavi", "rue"] },
  ];
  const progress = [
    undefined,
    { upgrades: ["scarf-gold", "scarf-blue", "scarf-gold"] },
    { xp: 7 },
    { level: 8, xp: 3, upgrades: ["scarf-red"] },
  ];
  for (const [index, setup] of setups.entries()) {
    const created = pinned({ op: "create", ...setup });
    assert.equal(created.ok, true, created.error);
    for (const [seat, actor] of [
      "vale",
      "mara",
      "ash",
      "nell",
      "tavi",
      "rue",
      "orin",
      "ada",
    ].entries()) {
      const present = actor === "vale" ? [] : ["vale"];
      const world = structuredClone(created.world);
      world.actors[actor].upgrades = ["scarf-violet", "scarf-gold"];
      const request = {
        world,
        actor,
        claimed: present,
        present,
        progress: progress[(index + seat) % progress.length],
      };
      const reference = pinned({ ...request, op: "join" });
      assert.equal(reference.ok, true, reference.error);
      assert.ok(Array.isArray(reference.actions));
      assert.ok(reference.profiles);
      const actual = wasm({ ...request, op: "join_state" });
      assert.ok(actual, `${actor} at seed ${setup.seed} was unsupported`);
      const different = Object.keys(reference.world).find(
        (key) => !isDeepStrictEqual(actual.world[key], reference.world[key]),
      );
      assert.ok(
        isDeepStrictEqual(actual, { ok: true, world: reference.world }),
        `${actor} at seed ${setup.seed} differed in ${different ?? "response envelope"}`,
      );
    }
  }
});

test("claiming a reset opening seat keeps the grounded lamp", async () => {
  const { pinned, wasm } = await reducers();
  const seats = { actor: "vale", claimed: [], present: [] };
  const fresh = pinned({ op: "create", seed: 7 }).world;
  const reset = pinned({ ...seats, op: "reset", world: fresh });
  assert.equal(reset.ok, true, reset.error);
  const request = { ...seats, world: reset.world };
  const joined = pinned({ ...request, op: "join" });
  assert.equal(joined.ok, true, joined.error);
  assert.equal(joined.world.items.lamp.holder, "attic");
  assert.ok(
    isDeepStrictEqual(wasm({ ...request, op: "join_state" }), {
      ok: true,
      world: joined.world,
    }),
  );
  const presence = {
    ...request,
    op: "presence",
    claimed: ["vale"],
    present: ["vale"],
    world: joined.world,
  };
  assert.ok(isDeepStrictEqual(wasm(presence), pinned(presence)));
  assert.equal(
    wasm({
      ...presence,
      op: "hold",
      choice: { item: "lamp", revision: joined.world.revision },
    }),
    null,
  );
});

test("declines invalid claim progress and leaves direct join outside the journal ABI", async () => {
  const { pinned, wasm } = await reducers();
  const world = pinned({ op: "create", seed: 7 }).world;
  const request = {
    op: "join_state",
    world,
    actor: "mara",
    claimed: [],
    present: [],
  };
  assert.equal(wasm({ ...request, op: "join" }), null);
  assert.equal(wasm({ ...request, progress: { xp: -1 } }), null);
  assert.equal(wasm({ ...request, progress: { xp: 1, level: 0 } }), null);
  assert.equal(wasm({ ...request, progress: { upgrades: ["Invalid"] } }), null);
});
