import { expect, it } from "vitest";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import {
  encodeSave,
  humanAvatarIds,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { reload } from "./helpers/world-life.mjs";
const cottage = "forest-cottage",
  garden = "forest-garden";
const button = "forest-button-vale",
  scarf = "forest-scarf-vale";
const forest = (w) => w.packs["lonely-forest"];
const fresh = () => createLandingWorld(packDefinition("lonely-forest"), 17);
// Match serde_json's request-world key order, without changing any state.
const sorted = (v) =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted(v[k])]),
        )
      : v;
// Mirror host session operations; native tests exercise the actual C guard.
function session(reduce) {
  let present = [];
  return (world, command) => {
    const { op, actor } = command;
    if (op === "enter") present = [...present, actor];
    if (op === "leave") present = present.filter((id) => id !== actor);
    const request = {
      ...command,
      world,
      claimed: humanAvatarIds,
      present,
      op:
        op === "claim"
          ? "join"
          : ["enter", "leave"].includes(op)
            ? "presence"
            : op,
    };
    return reduce(request);
  };
}
const worn = (world, turns) => {
  expect(world.actors.vale.upgrades).toEqual(["scarf"]);
  expect(world.actors.mara.upgrades || []).toEqual([]);
  for (const [choice, at] of Object.entries(turns))
    expect(forest(world).receipts[`forest-${choice}-vale`]).toBe(at);
  for (const item of [button, scarf]) {
    expect(world.items[item]).toEqual({ holder: cottage, history: [] });
    expect(entityActive(world, item)).toBe(false);
  }
  expect(forest(world).flags["forest-scarf-vale-worn"]).toBe(true);
  expect(forest(world).receipts["forest-wear-scarf-mara"]).toBeUndefined();
};
// The turns Vale waits in the garden in the shared run. RATi walks out at
// dusk and back after his stay (rules 133), so the meeting is in the cottage
// at turn SHARED_WAITS + 2; the button is hidden by a hash of that turn, and
// 85 is a count whose meeting hides it in the garden.
const SHARED_WAITS = 85;
for (const shared of [false, true])
  it(
    `earns the Forest scarf, retreats and returns without shortcuts (shared ${shared})`,
    () => {
      const engine = shared && currentSharedEngine();
      const hosted = session((request) => {
        const result = dispatchShared(request);
        expect(JSON.parse(engine.cardShared(JSON.stringify(request)))).toEqual(
          result,
        );
        return result;
      });
      let world = fresh(),
        reached = 0;
      expect(world.turn).toBe(0);
      expect(forest(world).receipts).toEqual({});
      if (shared) {
        world = sorted(
          dispatchShared({ op: "create", seed: 17, save: encodeSave(world) })
            .world,
        );
        for (const op of ["claim", "enter"])
          world = sorted(hosted(world, { op, actor: "vale" }).world);
      }
      const view = (w) =>
        shared
          ? hosted(w, { op: "view", actor: "vale" }).actions
          : legalActions(w);
      const step = (kind, fields = {}) => {
        const before = structuredClone(world);
        const action = view(world).find(
          (a) =>
            a.kind === kind &&
            !a.sleep &&
            !a.guards &&
            Object.entries(fields).every(([k, v]) => a[k] === v),
        );
        expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
        const result = shared
          ? hosted(world, { op: "play", actor: "vale", action })
          : play(world, action, world.revision);
        expect(result.ok, result.error).toBe(true);
        expect(world).toEqual(before);
        const next = result.world || result.state;
        validateWorld(structuredClone(next));
        for (const [id, at] of Object.entries(forest(before).met))
          expect(forest(next).met[id]).toBe(at);
        world = reload(next);
        expect(view(world)).toEqual(view(next));
        if (shared) world = sorted(world);
        reached++;
        return action;
      };
      const reject = (action, stale = false) => {
        const before = encodeSave(world);
        const revision = world.revision - Number(stale);
        const result = shared
          ? hosted(world, { op: "play", actor: "vale", action, revision })
          : play(world, action, revision);
        expect(result.ok).toBe(false);
        expect(encodeSave(world)).toBe(before);
      };
      step("move", { target: garden });
      for (let i = 0; i < (shared ? SHARED_WAITS : 12); i++) step("wait");
      step("move", { target: cottage });
      const hidden = world.turn;
      // The hash hides the button in any active place, so it moves with every
      // world change; this test is about the scarf, not where it hides.
      expect(entityActive(world, world.items[button].holder)).toBe(true);
      world.items[button].holder = garden;
      expect(forest(world).receipts["forest-hide-button-vale"]).toBe(hidden);
      step("move", { target: garden });
      step("take", { item: button });
      step("move", { target: cottage });
      const give = step("give", { item: button, target: "rati" });
      const sewn = world.turn;
      reject(give);
      // Leave the sewn scarf unresolved, reload outside, then return for it.
      for (const target of [garden, cottage]) {
        step("move", { target });
        expect(world.actors.vale.upgrades || []).toEqual([]);
        expect(world.items[scarf].holder).toBe(cottage);
        expect(entityActive(world, scarf)).toBe(true);
        expect(entityActive(world, button)).toBe(false);
        expect(forest(world).receipts["forest-sew-scarf-vale"]).toBe(sewn);
        expect(
          forest(world).receipts["forest-wear-scarf-vale"],
        ).toBeUndefined();
      }
      const take = step("take", { item: scarf });
      const turns = {
        "hide-button": hidden,
        "sew-scarf": sewn,
        "wear-scarf": world.turn,
      };
      reject(take);
      reject(view(world)[0], true);
      for (const target of [garden, cottage]) {
        step("move", { target });
        worn(world, turns);
      }
      expect(reached).toBe(shared ? 11 + SHARED_WAITS : 23);
      expect(turns).toEqual(
        shared
          ? {
              "hide-button": SHARED_WAITS + 2,
              "sew-scarf": SHARED_WAITS + 6,
              "wear-scarf": SHARED_WAITS + 9,
            }
          : { "hide-button": 14, "sew-scarf": 18, "wear-scarf": 21 },
      );
      if (shared) {
        for (const op of ["claim", "enter", "leave", "enter"])
          world = sorted(hosted(world, { op, actor: "mara" }).world);
        const before = structuredClone(world);
        const mara = hosted(world, { op: "view", actor: "mara" });
        expect(mara.room).toBe("theatre");
        worn(mara.world, turns);
        expect(world).toEqual(before);
      }
    },
    shared ? 30000 : undefined,
  );
