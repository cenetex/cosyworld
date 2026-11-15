import "./helpers/no-dwell.mjs";
import { describe, expect, it } from "vitest";
import { gone, usedUp } from "../v2/card-game/item-use.mjs";
import {
  avoidsStandoffs,
  entityActive,
  neverBack,
  packOf,
} from "../v2/card-game/pack-registry.mjs";
import { packDiscovered } from "../v2/card-game/pack-rules.mjs";
import { heldOf, newWant, questsOf } from "../v2/card-game/want.mjs";
import { settleStops } from "../v2/card-game/world/stops.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  movesTo,
  play,
  questOffers,
  questPreviews,
  validateWorld,
} from "../v2/card-game/world.mjs";

import { journeyWorlds } from "./helpers/journey.mjs";
import { questCards } from "./journeys/quest-cards.mjs";

const ID = "listener";
const reload = (world) => decodeSave(encodeSave(world));
const call = (world, extra = {}) => {
  world.actors.vale.arcana = { proved: [], did: [], calls: 3, ...extra };
  return world;
};
function act(world, test) {
  const action = legalActions(world, "vale").find(test);
  expect(action).toBeDefined();
  const result = play(world, action, world.revision, "vale");
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
const wait = (world) => act(world, (a) => a.kind === "wait" && !a.sleep);
const beside = (world) => {
  world.actors.vale.place = world.actors[ID].place;
  return world;
};
const settle = (world, moves) =>
  settleStops(world, { distance: (_, to) => moves[to] ?? null, arrive() {} });

describe("the Listener", () => {
  it("is a hub resident that joins a world saved before it", () => {
    const fresh = createWorld({ seed: 5 });
    const old = JSON.parse(encodeSave(fresh));
    delete old.actors[ID];
    delete old.peaceUntil[ID];
    delete old.memories[ID];
    for (const actor of Object.values(old.actors)) delete actor.trust[ID];
    const loaded = decodeSave(JSON.stringify(old));
    expect(loaded.actors[ID]).toMatchObject({ place: "pond", want: null });
    for (const other of Object.keys(loaded.actors))
      if (other !== ID) expect(loaded.actors[other].trust[ID]).toBe(0);
    expect(validateWorld(loaded)).toBe(loaded);
  });

  it("is met where it appears in a world still keeping its opening ledger", () => {
    let world = call(reload(journeyWorlds(questCards).met));
    expect(world.opening.met[ID]).toBeUndefined();
    world = wait(world);
    expect(world.actors[ID].place).toBe(world.actors.vale.place);
    expect(world.opening.met[ID]).toBeDefined();
    world = act(world, (a) => a.kind === "talk" && a.target === ID);
    expect(world.actors.vale.arcana.spread?.[0]).toMatchObject({ face: "down" });
  });

  it("stays away while nobody is called", () => {
    let world = createWorld({ seed: 5 });
    expect(entityActive(world, ID)).toBe(false);
    world.actors.vale.arcana = { proved: [], did: [], calls: 2 };
    expect(entityActive(world, ID)).toBe(false);
    world = reload(call(world));
    expect(entityActive(world, ID)).toBe(true);
  });

  it("comes to the live stop nearest the one it calls", () => {
    let world = call(createWorld({ seed: 5 }));
    world.actors[ID].place = "greek-harbor";
    expect(movesTo(world, "vale", "pond")).toBe(1);
    world = wait(world);
    expect(world.actors[ID].place).toBe("pond");
    const near = call(createWorld({ seed: 5 }));
    settle(near, { pond: 4, "willows-landing": 1, "greek-harbor": 2 });
    expect(near.actors[ID].place).toBe("willows-landing");
    const off = call(createWorld({ seed: 5 }));
    off.disabledPacks = ["sea", "hoppy"];
    off.actors[ID].place = "willows-landing";
    settle(off, { "greek-harbor": 0, "hoppycat-signal-jetty": 0 });
    expect(off.actors[ID].place).toBe("pond");
  });

  it("logs its arrival where the caller stands", () => {
    let world = call(createWorld({ seed: 5 }));
    world.actors[ID].place = "greek-harbor";
    world.actors.vale.place = "pond";
    world = wait(world);
    expect(world.actors[ID].place).toBe("pond");
    expect(
      world.log.some(
        (line) => line.kind === "narration" && line.actorId === ID,
      ),
    ).toBe(true);
  });

  it("never moves away from a traveler beside it", () => {
    let world = beside(call(createWorld({ seed: 5 })));
    settle(world, { "willows-landing": 0 });
    expect(world.actors[ID].place).toBe("pond");
    world = wait(world);
    expect(world.actors[ID].place).toBe("pond");
  });

  it("has no want, and Talk with it gives no quest", () => {
    let world = beside(call(createWorld({ seed: 5 })));
    world = act(world, (a) => a.kind === "talk" && a.target === ID);
    for (let i = 0; i < 3; i++) world = wait(world);
    expect(world.actors[ID].want).toBeNull();
    expect(questOffers(world, "vale")).toEqual([]);
    expect(questsOf(world, "vale")).toEqual([]);
  });

  it("is never in a standoff and is never asked along", () => {
    const world = beside(call(createWorld({ seed: 5 })));
    expect(avoidsStandoffs(ID)).toBe(true);
    const kinds = legalActions(world, "vale")
      .filter((a) => a.target === ID)
      .map((a) => a.kind);
    expect(kinds).toContain("talk");
    expect(kinds).not.toContain("accompany");
    expect(kinds).not.toContain("threaten");
    expect(kinds).not.toContain("attack");
  });

  it("refuses a Give while it sells nothing", () => {
    const world = beside(call(createWorld({ seed: 5 })));
    world.items.lamp.holder = "vale";
    const next = act(
      world,
      (a) => a.kind === "give" && a.item === "lamp" && a.target === ID,
    );
    expect(next.items.lamp.holder).toBe("vale");
    expect(gone(next, "lamp")).toBe(false);
  });

  it("takes any thing for good while it sells, a story thing too", () => {
    let world = beside(call(createWorld({ seed: 5 }), { sale: true }));
    world.items.bell.holder = "vale";
    world.actors.moth.want = newWant("item", "bell", world.turn);
    world = reload(world);
    world = act(
      world,
      (a) => a.kind === "give" && a.item === "bell" && a.target === ID,
    );
    expect(gone(world, "bell")).toBe(true);
    expect(usedUp(world, "bell")).toBe(true);
    expect(neverBack(world, "bell")).toBe(true);
    expect(world.log.find((line) => line.gone)?.gone).toEqual(["bell"]);
    world = wait(world);
    expect(world.actors.moth.want?.target).not.toBe("bell");
    expect(validateWorld(reload(world))).toBeTruthy();
  });

  it("deals a spread for the price and leaves once nobody calls it", () => {
    let world = beside(call(createWorld({ seed: 5 }), { sale: true }));
    world.items.bell.holder = "vale";
    world = act(
      world,
      (a) => a.kind === "give" && a.item === "bell" && a.target === ID,
    );
    const record = world.actors.vale.arcana;
    expect(record.sale).toBeUndefined();
    expect(record.spread.length).toBeGreaterThan(0);
    delete record.calls;
    world = wait(world);
    expect(entityActive(world, ID)).toBe(false);
    expect(validateWorld(reload(world))).toBeTruthy();
  });

  it("offers three fetch quests to empty hands, only of things found", () => {
    let world = beside(call(createWorld({ seed: 5 }), { sale: true }));
    for (const item of Object.values(world.items))
      if (item.holder === "vale") item.holder = "pond";
    const offers = questOffers(world, "vale");
    expect(offers).toHaveLength(3);
    for (const offer of offers) {
      expect(offer.id).toBe(`quest:listener:${offer.want.target}`);
      expect(offer.want.step).toEqual({ verb: "give", to: ID });
      const pack = packOf(offer.want.target);
      expect(!pack || packDiscovered(world, pack.id)).toBe(true);
    }
    world = wait(world);
    expect(heldOf(world.actors.vale)).toEqual([]);
    for (let i = 0; i < 3; i++) {
      const q = questPreviews(world).find((q) => q.kind === "listener");
      world = act(world, (a) => a.key === q.action.key);
    }
    expect(heldOf(world.actors.vale).map((w) => w.from).sort()).toEqual(
      offers.map((o) => o.id).sort(),
    );
    expect(validateWorld(reload(world))).toBeTruthy();
    const target = heldOf(world.actors.vale)[0].target;
    world.items[target].holder = "vale";
    world = act(
      world,
      (a) => a.kind === "give" && a.item === target && a.target === ID,
    );
    expect(gone(world, target)).toBe(true);
  });
});
