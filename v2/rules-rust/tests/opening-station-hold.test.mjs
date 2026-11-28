import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const opening = [
  "move:vale::pond",
  "move:vale::station",
  "read:vale:keeper-log:",
  "accept:vale::keeper",
  "move:vale::pond",
  "move:vale::station",
];

test("Station hand choices charge the visit once and preserve the private menu", async () => {
  const { pinned, wasm } = await reducers();
  const hold = (world, item) => ({
    ...seats,
    op: "hold",
    world,
    choice: { item, revision: world.revision },
  });
  const play = (world, action) => ({ ...seats, op: "play", world, action });
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  let sample;
  let viewSample;
  for (const seed of [undefined, 0, 17, 99, 4242]) {
    const created = run({ op: "create", seed }).world;
    for (const sorted of [false, true]) {
      const saved = (world) =>
        sorted
          ? {
              ...world,
              actors: Object.fromEntries(
                Object.entries(world.actors).toSorted(),
              ),
            }
          : world;
      let world = run(hold(saved(created), null)).world;
      for (const action of opening)
        world = run(play(saved(world), action)).world;
      assert.equal(world.turn, 5);
      assert.equal(world.actors.vale.heldItem, "cloth");
      assert.equal(world.items.lamp.fuel, 12);
      sample = hold(saved(world), "lamp");
      const actions = run({
        ...seats,
        op: "view",
        world: saved(world),
      }).actions;
      const checked = new Set();
      let cloth;
      for (const item of ["lamp", "cloth", null, "lamp", "lamp"]) {
        const request = hold(saved(world), item);
        const expected = run(request);
        const actual = wasm(request);
        const label = `${seed}/${sorted}/${world.actors.vale.heldItem}/${item}`;
        const field = Object.keys(expected.world).find(
          (key) =>
            !isDeepStrictEqual(actual?.world?.[key], expected.world[key]),
        );
        assert.ok(isDeepStrictEqual(actual, expected), `${label}/${field}`);
        assert.deepEqual(Object.keys(actual).sort(), ["ok", "world"]);
        assert.equal(actual.world.revision, world.revision + 1, label);
        assert.equal(actual.world.turn, world.turn, label);
        assert.equal(actual.world.eventSeq, world.eventSeq, label);
        assert.equal(actual.world.actors.vale.heldItem, item, label);
        const { fuel, fuelRooms, fuelPlace, fuelVisit, lit } =
          actual.world.items.lamp;
        assert.deepEqual(
          { fuel, fuelRooms, fuelPlace, fuelVisit, lit },
          {
            fuel: 8,
            fuelRooms: 2,
            fuelPlace: "station",
            fuelVisit: true,
            lit: item === "lamp",
          },
          label,
        );
        world = expected.world;
        if (item === "cloth") cloth = world;
        if (checked.has(item)) continue;
        checked.add(item);
        for (const present of [["vale"], []]) {
          const viewRequest = {
            ...seats,
            op: "view",
            world: saved(world),
            present,
          };
          const view = wasm(viewRequest);
          assert.ok(
            isDeepStrictEqual(view, run(viewRequest)),
            `${label}/view/${present.length}`,
          );
          assert.equal(view.room, "station");
          assert.deepEqual(view.exits, ["pond", "behind-station"]);
          assert.deepEqual(view.actions, actions);
          const keys = view.actions.map(({ key }) => key);
          for (const to of view.exits)
            for (const carry of ["", "lamp", "cloth"])
              assert.ok(keys.includes(`move:vale:${carry}:${to}`));
          assert.equal(view.world.actors.vale.heldItem, item);
          assert.deepEqual(view.world.presentActors, present);
          assert.deepEqual(view.world.memories.vale, world.memories.vale);
          assert.equal(view.world.memories.moth.learning, undefined);
          assert.equal(view.world.memories.moth.subjects, undefined);
          assert.equal(view.events, undefined);
          if (item === "lamp" && present.length) viewSample = viewRequest;
        }
      }
      if (seed === 17) {
        for (const key of [
          "move:vale::pond",
          "move:vale:lamp:pond",
          "move:vale:cloth:pond",
        ]) {
          const moved = run(play(saved(cloth), key));
          const called = run(play(saved(moved.world), "drop:vale:lamp:pond"));
          assert.equal(called.world.items.lamp.fuel, 4, key);
          assert.deepEqual(
            called.exits,
            ["station", "attic", "greek-ship"],
            key,
          );
        }
      }
    }
  }

  for (const mutate of [
    (request) => request.choice.revision--,
    (request) => (request.choice.item = "oil"),
    (request) => (request.present = []),
    (request) => (request.world.items.cloth.holder = "moth"),
    (request) => (request.world.log.at(-1).accepted = false),
    (request) => delete request.world.actors["greek-guard"].guarding,
  ]) {
    const forged = structuredClone(sample);
    mutate(forged);
    assert.equal(wasm(forged), null);
  }
  for (const mutate of [
    (world) =>
      (world.actors.ghost = { ...world.actors.mara, place: "station" }),
    (world) => (world.items.lamp.fuelVisit = false),
    (world) => (world.log.at(-1).accepted = false),
  ]) {
    const forged = structuredClone(viewSample);
    mutate(forged.world);
    assert.equal(wasm(forged), null);
  }
  const pack = JSON.parse(
    await readFile(
      new URL(
        "../../orchestrator-rust/src/card_shared/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const greek = pack.files["v2/card-game/packs.json"].packs.find(
    ({ id }) => id === "greek-drama",
  );
  greek.avatars["greek-helen-egypt"].sealed.at = "station";
  assert.equal(wasm(viewSample, JSON.stringify(pack)), null);
});
