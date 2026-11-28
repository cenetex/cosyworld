import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

test("quiet Station arrival preserves the wire order of private offers", async () => {
  const { pinned, wasm } = await reducers();
  const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  const success = (request) => {
    const response = pinned(request);
    assert.equal(response.ok, true, response.error);
    return response;
  };
  let { world } = success({ op: "create", seed: 2 });
  ({ world } = success({
    ...seats,
    op: "hold",
    world,
    choice: { item: null, revision: world.revision },
  }));
  for (const action of ["move:vale::pond", "move:vale:lamp:station"]) {
    ({ world } = success({ ...seats, op: "play", world, action }));
  }
  const rosters = [
    world.actors,
    Object.fromEntries(Object.entries(world.actors).sort()),
  ];
  for (const actors of rosters) {
    const request = { ...seats, op: "view", world: { ...world, actors } };
    const response = wasm(request);
    assert.deepEqual(response, success(request));
    assert.deepEqual(response.world.speechVoices.vale, ["vale", "keeper"]);
    assert.equal(response.world.memories.keeper.subjects, undefined);
    assert.deepEqual(response.world.memories.vale, world.memories.vale);
    assert.ok(
      response.actions.some(({ key }) => key === "accept:vale::box:train"),
    );
    assert.ok(
      response.actions.some(
        ({ key }) => key === "take:vale:elysium-wayfinder:",
      ),
    );
  }
});
