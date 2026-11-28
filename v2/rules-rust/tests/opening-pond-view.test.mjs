import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

function success(pinned, request) {
  const response = pinned(request);
  assert.equal(response.ok, true, response.error);
  return response;
}

test("the fresh and historic first pond views preserve pinned offers and private saves", async () => {
  const { pinned, wasm } = await reducers();
  const options = [false, true].flatMap((history) =>
    [undefined, 17, 42, 4_294_967_295].map((seed) => ({ seed, history })),
  );
  for (const { seed, history } of options) {
    const { world: fresh } = success(pinned, { op: "create", seed, history });
    for (const lamp of ["stowed", "dry"]) {
      const world =
        lamp === "stowed"
          ? success(pinned, {
              ...seats,
              op: "hold",
              world: fresh,
              choice: { item: null, revision: fresh.revision },
            }).world
          : structuredClone(fresh);
      if (lamp === "dry")
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      for (const action of ["move:vale::pond", "move:vale:lamp:pond"]) {
        const played = success(pinned, { ...seats, op: "play", world, action });
        assert.equal(played.world.turn, history ? 481 : 1);
        const sleeping = history && seed !== 17;
        assert.equal(Boolean(played.world.actors.moth.sleeping), sleeping);
        assert.equal(
          played.events.some(
            (entry) =>
              entry.actorId === "moth" && entry.text === "Pip falls asleep.",
          ),
          sleeping,
        );
        assert.ok(Object.hasOwn(played.world.memories.moth, "subjects"));
        const spoken = success(pinned, {
          ...seats,
          op: "speech",
          room: "pond",
          world: played.world,
          lines: [
            { actorId: "vale", text: "A narrow shore." },
            { actorId: "moth", text: "Follow me." },
            { entityId: "pond", text: "Dark water breathes." },
          ],
        });
        for (const state of [played.world, spoken.world]) {
          for (const present of [seats.present, []]) {
            const request = { ...seats, present, op: "view", world: state };
            const actual = wasm(request);
            const label = JSON.stringify({
              seed,
              history,
              lamp,
              action,
              present,
              seq: state.eventSeq,
            });
            assert.deepEqual(actual, success(pinned, request), label);
            assert.equal(actual.world.memories.moth.subjects, undefined);
            assert.deepEqual(actual.world.memories.vale, state.memories.vale);
            assert.deepEqual(actual.world.speechVoices.vale, ["vale", "moth"]);
            for (const kind of ["accompany", "ask", "trade"])
              assert.equal(
                actual.actions.some((offer) => offer.kind === kind),
                !sleeping,
              );
            assert.deepEqual(actual.exits, ["station"]);
            assert.ok(
              actual.actions.some((offer) => offer.box === "greek-ship"),
            );
            assert.equal(
              actual.actions.some(
                (offer) => offer.key === "take:vale:elysium-wayfinder:",
              ),
              state.items["elysium-wayfinder"].holder === "pond",
            );
          }
        }
        const busy = structuredClone(played.world);
        busy.actors.keeper.place = "pond";
        assert.equal(wasm({ ...seats, op: "view", world: busy }), null);
        if (sleeping) {
          const missingSleep = structuredClone(played.world);
          missingSleep.log = missingSleep.log.filter(
            (entry) => entry.text !== "Pip falls asleep.",
          );
          assert.equal(
            wasm({ ...seats, op: "view", world: missingSleep }),
            null,
          );
        }
        assert.equal(
          wasm({
            ...seats,
            op: "view",
            world: played.world,
            claimed: ["vale", "mara"],
          }),
          null,
        );
      }
    }
  }
});

test("the pond view keeps the second Move speech cue and private memories", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [17, 2, 4242]) {
    for (const mode of ["stowed", "dry"]) {
      let { world } = success(pinned, { op: "create", seed });
      if (mode === "stowed") {
        ({ world } = success(pinned, {
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        }));
      } else {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      ({ world } = success(pinned, {
        ...seats,
        op: "play",
        world,
        action: "wait:vale::",
      }));
      ({ world } = success(pinned, {
        ...seats,
        op: "speech",
        room: "attic",
        world,
        lines: [{ entityId: "attic", text: "The floor settles." }],
      }));
      const played = success(pinned, {
        ...seats,
        op: "play",
        world,
        action: mode === "stowed" ? "move:vale::pond" : "move:vale:lamp:pond",
      });
      assert.equal(played.world.turn, 2);
      assert.deepEqual(played.world.speechVoices.vale, ["vale", "moth"]);
      assert.deepEqual(played.world.actors.vale.waitSpeech, {
        place: "pond",
        turn: null,
      });
      const spoken = success(pinned, {
        ...seats,
        op: "speech",
        room: "pond",
        world: played.world,
        lines: [
          { actorId: "vale", text: "A narrow shore." },
          { actorId: "moth", text: "Follow me." },
          { entityId: "pond", text: "The ripples spread." },
        ],
      });
      for (const state of [played.world, spoken.world]) {
        for (const present of [seats.present, []]) {
          const request = { ...seats, present, op: "view", world: state };
          const actual = wasm(request);
          const label = JSON.stringify({
            seed,
            mode,
            present,
            seq: state.eventSeq,
          });
          assert.ok(actual, label);
          assert.deepEqual(actual, success(pinned, request), label);
          assert.deepEqual(actual.world.memories.vale, state.memories.vale);
          assert.equal(actual.world.memories.moth.subjects, undefined);
          assert.equal(actual.world.memories.moth.learning, undefined);
        }
      }
      const invalid = structuredClone(played.world);
      invalid.log.find(
        (entry) => entry.verb === "wait" && entry.actorId === "vale",
      ).sleep = true;
      assert.equal(wasm({ ...seats, op: "view", world: invalid }), null);
    }
  }
});
