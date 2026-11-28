import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const key = "accept:vale::box:pond";
const solo = { actor: "vale", claimed: ["vale"], present: ["vale"] };

function success(pinned, request) {
  const result = pinned(request);
  assert.equal(result.ok, true, result.error);
  return result;
}

function view(pinned, wasm, request, title) {
  const expected = success(pinned, request);
  const actual = wasm(request);
  assert.ok(actual, `unsupported ${title}`);
  const changed = Object.keys(expected).filter(
    (field) => !isDeepStrictEqual(actual[field], expected[field]),
  );
  assert.deepEqual(changed, [], title);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  return actual;
}

test("the direct claimed view and lit-attic seat variants match the full pinned response", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [0, 17, 4242, 4_294_967_295]) {
    for (const history of [false, true]) {
      const { world: fresh } = success(pinned, { op: "create", seed, history });
      const title = `seed ${seed}, history ${history}`;
      const direct = view(
        pinned,
        wasm,
        { ...solo, op: "view", world: fresh },
        title,
      );
      assert.equal(direct.actions.at(-1).key, key);
      const { world } = success(pinned, {
        ...solo,
        op: "join",
        actor: "mara",
        world: fresh,
      });
      for (const accepted of [false, true]) {
        const state = accepted
          ? success(pinned, { ...solo, op: "play", world, action: key }).world
          : world;
        for (const present of [[], ["vale"], ["mara"], ["mara", "vale"]]) {
          const request = {
            op: "view",
            actor: "vale",
            claimed: ["mara", "vale"],
            present,
            world: state,
          };
          const projected = view(
            pinned,
            wasm,
            request,
            `${title}, present ${present}, accepted ${accepted}`,
          );
          assert.equal(
            projected.actions.at(-1).key,
            accepted ? "drop:vale:::0" : key,
          );
          assert.deepEqual(projected.world.heldActors, request.claimed);
          assert.deepEqual(projected.world.presentActors, present);
        }
      }
    }
  }
});

test("the view preserves private fields only for the viewer", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = success(pinned, {
    op: "create",
    seed: 4242,
    history: true,
  });
  for (const id of ["vale", "mara"]) {
    Object.assign(world.memories[id], {
      innerLife: {
        persona: `${id}'s private account.`,
        thoughts: [],
        dreams: [],
      },
      reflections: [],
      learning: [],
    });
  }
  const projected = view(
    pinned,
    wasm,
    { ...solo, op: "view", world },
    "private memory",
  );
  assert.deepEqual(projected.world.memories.vale, world.memories.vale);
  assert.deepEqual(
    projected.world.memories.mara.events,
    world.memories.mara.events,
  );
  for (const field of ["innerLife", "reflections", "learning", "subjects"]) {
    assert.ok(Object.hasOwn(world.memories.mara, field));
    assert.ok(!Object.hasOwn(projected.world.memories.mara, field));
  }
});

test("the opening view declines other viewers and changed attic content", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = success(pinned, { op: "create", seed: 17, history: true });
  const request = { ...solo, op: "view", world };
  const content = JSON.parse(
    await readFile(
      new URL(
        "../../orchestrator-rust/src/card_shared/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  content.files["v2/card-game/packs.json"].packs[0].avatars.badger.sealed = {
    at: "attic",
  };
  assert.equal(wasm(request, JSON.stringify(content)), null);
  assert.equal(wasm({ ...request, actor: "mara" }), null);
  assert.equal(wasm({ ...request, claimed: [], present: [] }), null);
});

function stowLamp(pinned, world) {
  return success(pinned, {
    ...solo,
    world,
    op: "hold",
    choice: { item: null, revision: world.revision },
  }).world;
}

test("the stowed lamp view exposes the mirror crossing and legal travel options", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [0, 17, 4242]) {
    for (const history of [false, true]) {
      const { world: fresh } = success(pinned, { op: "create", seed, history });
      const { world: accepted } = success(pinned, {
        ...solo,
        op: "play",
        world: fresh,
        action: key,
      });
      for (const state of [fresh, accepted]) {
        const world = stowLamp(pinned, state);
        for (const present of [["vale"], []]) {
          const request = { ...solo, op: "view", world, present };
          const projected = view(
            pinned,
            wasm,
            request,
            `stowed lamp, seed ${seed}`,
          );
          assert.deepEqual(projected.exits, ["pond"]);
          assert.deepEqual(
            projected.actions.map(({ key }) => key),
            [
              "wait:vale::",
              "move:vale::pond",
              "move:vale:lamp:pond",
              "drop:vale:lamp:attic",
            ],
          );
          assert.equal(projected.world.actors.vale.want, null);
        }
      }
    }
  }
});

test("pond capacity depends on whether Vale is present", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = success(pinned, { op: "create", seed: 17, history: true });
  const stowed = stowLamp(pinned, world);
  const pond = ["mara", "ash", "nell", "tavi"];
  for (const id of pond) stowed.actors[id].place = "pond";
  const request = {
    op: "view",
    world: stowed,
    actor: "vale",
    claimed: ["vale", ...pond],
    present: ["vale", ...pond],
  };
  const present = view(pinned, wasm, request, "present viewer at a full pond");
  assert.deepEqual(present.exits, []);
  assert.deepEqual(
    present.actions.map(({ key }) => key),
    ["wait:vale::", "drop:vale:lamp:attic"],
  );
  const away = view(
    pinned,
    wasm,
    { ...request, present: pond },
    "away viewer at a full pond",
  );
  assert.deepEqual(away.exits, ["pond"]);
});
