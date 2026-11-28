import assert from "node:assert/strict";
import { test } from "node:test";
import {
  controlledByHuman,
  humanAvatar,
  residentAvatar,
} from "../../card-game/human-cast.mjs";
import {
  isPackActor,
  roamingQuestActor,
} from "../../card-game/pack-registry.mjs";
import { load } from "../../card-game/shared-world.mjs";
import { knownActors } from "../../card-game/world.mjs";
import { reducers } from "./parity.mjs";

function expectedRoster(request, turn) {
  const next = load(request);
  next.turn = turn;
  const known = knownActors(next);
  const here = next.actors.vale.place;
  return {
    ok: true,
    known,
    residents: [
      ...new Set([
        "moth",
        "keeper",
        ...known.filter(
          (id) => id === "boardyai" && !controlledByHuman(next, id),
        ),
        ...known.filter(
          (id) =>
            residentAvatar(next, id) &&
            (next.actors[id].place === here || next.hidden?.actor !== id),
        ),
        ...known.filter(
          (id) =>
            isPackActor(id) &&
            !roamingQuestActor(id) &&
            next.actors[id].place === here,
        ),
      ]),
    ],
  };
}

test("opening residents follow the original saved actor order and seat presence", async () => {
  const { pinned, wasm } = await reducers();
  for (const options of [
    { seed: 4242 },
    { seed: 4242, history: true },
    { seed: 17, history: true, hidden: "mara", absent: ["ash"] },
  ]) {
    const { world } = pinned({ op: "create", ...options });
    const keys = Object.keys(world.actors);
    for (const order of [keys, keys.toSorted(), keys.toReversed()]) {
      const arranged = {
        ...world,
        actors: Object.fromEntries(order.map((id) => [id, world.actors[id]])),
      };
      for (const present of [["vale"], ["vale", "nell"]]) {
        const request = {
          actor: "vale",
          claimed: ["vale", "nell"],
          present,
          world: arranged,
          action: "wait:vale::",
        };
        const result = pinned({ ...request, op: "play" });
        assert.equal(result.ok, true, result.error);
        const actual = wasm({
          ...request,
          op: "opening_wait_roster",
          actorOrder: keys,
        });
        assert.deepEqual(actual, expectedRoster(request, result.world.turn));
        const pickups = result.events
          .filter(
            (event) => event.verb === "take" && humanAvatar(event.actorId),
          )
          .map((event) => event.actorId);
        assert.ok(pickups.length >= 3);
        assert.deepEqual(
          actual.residents.filter((id) => pickups.includes(id)),
          pickups,
        );
      }
    }
  }
});
