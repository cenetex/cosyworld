import assert from "node:assert/strict";
import { test } from "node:test";
import { entityActive } from "../../card-game/pack-registry.mjs";
import { travels } from "../../card-game/want.mjs";
import { startDwell } from "../../card-game/world/dwell.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const action = "wait:vale::";
const fields = new Set([
  "want",
  "under",
  "content",
  "gaveUp",
  "heardOn",
  "offered",
]);

function wants(world, history = false) {
  const keys = history ? new Set([...fields, "visited", "talked"]) : fields;
  return Object.fromEntries(
    Object.entries(world.actors).map(([id, actor]) => [
      id,
      Object.fromEntries(
        Object.entries(actor).filter(([field]) => keys.has(field)),
      ),
    ]),
  );
}

test("first-wait want clocks and eligible quest state match the full pinned round", async () => {
  const { pinned, wasm } = await reducers();
  for (const options of [
    {},
    { seed: 4242 },
    { seed: 17, hidden: "mara", absent: ["ash"] },
  ]) {
    let { world } = pinned({ op: "create", ...options });
    for (const pick of [false, true]) {
      if (pick) {
        const accepted = pinned({
          ...seats,
          op: "play",
          world,
          action: "accept:vale::box:pond",
        });
        assert.equal(accepted.ok, true, accepted.error);
        world = accepted.world;
      }
      const request = { ...seats, world, action };
      const result = pinned({ ...request, op: "play" });
      assert.equal(result.ok, true, result.error);
      const original = wants(world);
      const after = wants(result.world);
      assert.ok(
        Object.keys(after).filter(
          (id) => original[id].want?.since !== after[id].want?.since,
        ).length >= 13,
      );
      assert.deepEqual(wasm({ ...request, op: "opening_wait_wants" }), {
        ok: true,
        wants: after,
      });
    }
  }
});

test("the first-wait scope declines aged wants, nonzero refusals and a lost quest", async () => {
  const { pinned, wasm } = await reducers();
  const base = { ...seats, action, op: "opening_wait_wants" };
  const history = pinned({ op: "create", history: true }).world;
  assert.equal(wasm({ ...base, world: history }), null);
  const fresh = pinned({ op: "create" }).world;
  const refused = structuredClone(fresh);
  refused.actors["greek-adrastus"].want.refusals = 1;
  assert.equal(wasm({ ...base, world: refused }), null);
  const lost = structuredClone(fresh);
  lost.actors.vale.want = {
    kind: "item",
    target: "greek-bread",
    since: 0,
    refusals: 0,
  };
  lost.gone = ["greek-bread"];
  assert.equal(wasm({ ...base, world: lost }), null);
});

function beforeWantSettlement(world, round) {
  const state = structuredClone(world);
  state.turn += 1;
  for (const event of round.events) {
    const actor = state.actors[event.actorId];
    if (event.verb === "take") {
      state.items[event.itemId].holder = event.actorId;
      actor.heldItem = event.itemId;
    }
    if (event.verb === "move") {
      actor.place = event.locationId;
      startDwell(state, event.actorId);
    }
    if (event.verb === "move" || event.verb === "take") {
      for (const [id, resident] of Object.entries(state.actors)) {
        if (
          (id === event.actorId || travels(id, state)) &&
          entityActive(state, id) &&
          !resident.visited.includes(resident.place)
        ) {
          resident.visited = [...resident.visited, resident.place].slice(-64);
        }
      }
    }
  }
  return state;
}

test("history wait refreshes inactive wants and redraws expired wants in pinned order", async () => {
  const { pinned, wasm } = await reducers();
  for (const options of [
    {},
    { seed: 4242 },
    { seed: 17, hidden: "mara", absent: ["ash"] },
    { seed: 7, homecoming: "tavi" },
    { seed: 42, hidden: "ada", homecoming: "ash" },
  ]) {
    const opening = pinned({ ...options, op: "create", history: true });
    assert.equal(opening.ok, true, opening.error);
    const { world } = opening;
    const round = pinned({ ...seats, op: "play", world, action });
    assert.equal(round.ok, true, round.error);
    const state = beforeWantSettlement(world, round);
    const settled = wants(round.world, true);
    const candidate = wasm({ op: "opening_history_wants", world: state });
    assert.deepEqual(
      candidate,
      { ok: true, wants: settled },
      JSON.stringify(options),
    );
    assert.equal(
      Object.values(settled).filter(
        (actor) => actor.gaveUp?.turn === state.turn,
      ).length,
      39,
    );
    assert.deepEqual(settled.moth.want, world.actors.moth.want);
    assert.equal(settled["greek-adrastus"].want.since, state.turn);
    if (options.homecoming)
      assert.equal(settled[options.homecoming].want.since, state.turn);
  }
});
