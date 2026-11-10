import { expect, it } from "vitest";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import {
  entityActive,
  packDefinition,
  packRouteOpen,
} from "../v2/card-game/pack-registry.mjs";
import {
  encodeSave,
  exits,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { reload } from "./helpers/world-life.mjs";

const cottage = "forest-cottage",
  garden = "forest-garden",
  trail = "forest-trail",
  oak = "forest-oak";
const charm = "forest-wolfprint-charm",
  button = "forest-button-vale",
  scarf = "forest-scarf-vale";
const forest = (w) => w.packs["lonely-forest"];
const toggle = (enable) => ({ kind: "pack", pack: "cottage", enable });

function journey() {
  let world = createLandingWorld(packDefinition("lonely-forest"), 17);
  let reached = 0;
  expect(forest(world).receipts).toEqual({});
  const commit = (action) => {
    const before = structuredClone(world);
    const result = play(world, action, world.revision);
    expect(result.ok, result.error).toBe(true);
    expect(world).toEqual(before);
    const next = result.state;
    expect(next.revision).toBe(before.revision + 1);
    expect(next.turn).toBe(before.turn + Number(action.kind !== "pack"));
    const clone = structuredClone(next);
    expect(validateWorld(clone)).toBe(clone);
    for (const key of ["met", "receipts"])
      for (const [id, turn] of Object.entries(forest(before)[key]))
        expect(forest(next)[key][id]).toBe(turn);
    for (const route of before.openedRoutes || [])
      expect(next.openedRoutes).toContain(route);
    world = reload(next);
    expect(world).toEqual(next);
    expect(legalActions(world)).toEqual(legalActions(next));
    reached++;
    return world;
  };
  const step = (kind, fields = {}) => {
    const action = legalActions(world).find(
      (a) =>
        a.kind === kind &&
        !a.sleep &&
        !a.guards &&
        Object.entries(fields).every(([key, value]) => a[key] === value),
    );
    expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
    return commit(action);
  };
  const reject = (action, stale = false) => {
    const before = structuredClone(world);
    expect(play(world, action, world.revision - Number(stale)).ok).toBe(false);
    expect(world).toEqual(before);
  };
  return {
    step,
    commit,
    reject,
    get world() {
      return world;
    },
    get reached() {
      return reached;
    },
  };
}

for (const ending of ["keep", "give"])
  it(`keeps earned Forest ${ending} evidence through two Cottage dormancies`, () => {
    const run = journey();
    // Same legal seed-17 route as card-forest-consequences, without injected progress.
    for (const [kind, fields] of [
      ["talk", { target: "rati" }],
      ["talk", { target: "rati" }],
      ["move", { target: garden }],
      ["wait"],
      ["move", { target: trail }],
      ["talk", { target: "skull" }],
      ["take", { item: charm }],
      ["move", { target: oak }],
      ["talk", { target: "oak" }],
      ["move", { target: garden }],
      ["move", { target: cottage }],
    ]) {
      run.step(kind, fields);
      if (fields?.target === oak)
        expect(exits(run.world, oak, "vale")).toContain(trail);
    }
    if (ending === "keep") run.step("wait");
    else run.step("give", { item: charm, target: "rati" });
    expect(run.world.turn).toBe(12);
    const earned = structuredClone(forest(run.world));
    expect(earned.met).toMatchObject({ rati: 1, skull: 5, oak: 8 });
    expect(earned.flags["forest-homecoming-shared"]).toBe(true);
    expect([
      earned.receipts["forest-keep-charm"],
      earned.receipts["forest-leave-charm"],
    ]).toEqual(ending === "keep" ? [12, undefined] : [undefined, 12]);
    expect(run.world.openedRoutes).toContain(`${garden}>${trail}`);
    expect(run.world.openedRoutes).not.toContain(`${oak}>${trail}`);
    expect(run.world.items[charm].holder).toBe(
      ending === "keep" ? "vale" : cottage,
    );
    expect(packRouteOpen(run.world, oak, trail)).toBe(false);

    // Shared packs deliberately do not toggle, even with legally earned progress.
    const engine = currentSharedEngine();
    const shared = dispatchShared({
      op: "create",
      save: encodeSave(run.world),
    }).world;
    const before = structuredClone(shared);
    for (const enable of [false, true]) {
      const request = {
        op: "play",
        actor: "vale",
        world: shared,
        action: toggle(enable),
      };
      const result = dispatchShared(request);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Shared worlds keep every pack/);
      expect(JSON.parse(engine.cardShared(JSON.stringify(request)))).toEqual(
        result,
      );
      expect(shared).toEqual(before);
    }

    for (let cycle = 0; cycle < 2; cycle++) {
      run.reject(toggle(false), true);
      run.commit(toggle(false));
      expect(run.world.disabledPacks).toContain("cottage");
      expect(run.world.actors.vale.place).toBe("attic");
      for (const id of [cottage, "rati", charm])
        expect(entityActive(run.world, id)).toBe(false);
      expect(run.world.items[charm].holder).toBe(cottage);
      expect(legalActions(run.world).some((a) => a.target === cottage)).toBe(
        false,
      );
      expect(forest(run.world)).toEqual(earned);
      run.reject(toggle(false));
      // Re-enabling retains the receipt, but does not return the charm to Vale.
      run.commit(toggle(true));
      expect(run.world.disabledPacks).toBeUndefined();
      expect(entityActive(run.world, charm)).toBe(true);
      expect(run.world.items[charm].holder).toBe(cottage);
      expect(forest(run.world)).toEqual(earned);
      run.reject(toggle(true));
      // The gate stays latched, but the Oak's shortcut needs the charm nearby.
      expect(packRouteOpen(run.world, garden, trail)).toBe(true);
      expect(packRouteOpen(run.world, oak, trail)).toBe(false);
      const saved = encodeSave(run.world);
      legalActions(run.world);
      legalActions(run.world);
      expect(encodeSave(run.world)).toBe(saved);
    }
    expect(run.reached).toBe(16);
    expect([run.world.turn, run.world.revision]).toEqual([12, 16]);
  });

it("keeps an earned scarf upgrade without waking its consumed items", () => {
  const run = journey();
  run.step("move", { target: garden });
  for (let i = 0; i < 12; i++) run.step("wait");
  run.step("move", { target: cottage });
  expect(run.world.items[button].holder).toBe(garden);
  run.step("move", { target: garden });
  run.step("take", { item: button });
  run.step("move", { target: cottage });
  run.step("give", { item: button, target: "rati" });
  run.step("take", { item: scarf });
  expect(run.world.turn).toBe(19);
  const earned = structuredClone(forest(run.world));
  expect(earned.receipts).toMatchObject({
    "forest-hide-button-vale": 14,
    "forest-sew-scarf-vale": 18,
    "forest-wear-scarf-vale": 19,
  });
  const check = () => {
    expect(forest(run.world)).toEqual(earned);
    expect(run.world.actors.vale.upgrades).toEqual(["scarf"]);
    expect(run.world.actors.mara.upgrades || []).toEqual([]);
    expect(forest(run.world).flags["forest-scarf-vale-worn"]).toBe(true);
    expect(
      forest(run.world).receipts["forest-wear-scarf-mara"],
    ).toBeUndefined();
    for (const item of [button, scarf]) {
      expect(run.world.items[item]).toEqual({ holder: cottage, history: [] });
      expect(entityActive(run.world, item)).toBe(false);
      expect(legalActions(run.world).some((a) => a.item === item)).toBe(false);
    }
  };
  check();
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const enable of [false, true]) {
      run.commit(toggle(enable));
      check();
    }
  }
  expect(run.reached).toBe(23);
  expect([run.world.turn, run.world.revision]).toEqual([19, 23]);
});
