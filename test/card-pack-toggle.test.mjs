// A pack switches off and on mid-world (rules 98): its own content sleeps
// as it is, and everyone and everything from elsewhere in it is scattered.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { questsOf } from "../v2/card-game/want.mjs";

const [SEA, HOPPY, COTTAGE, SHORE] = ["sea", "hoppy", "cottage", "shore"];
const off = (pack) => ({ kind: "pack", pack, enable: false });
const on = (pack) => ({ kind: "pack", pack, enable: true });
const reload = (s) => decodeSave(encodeSave(s));
function world(edit = () => {}) {
  const s = createWorld({ seed: 7, packScopes: { "greek-drama": "full" } });
  Object.assign(s.actors.vale, { place: "greek-well" });
  s.actors.keeper.place = s.actors.moth.place = "greek-well";
  s.items.lamp.holder = "vale";
  s.items.oil.holder = s.items.bell.holder = "greek-well";
  edit(s);
  return reload(s);
}
const ok = (result) => {
  expect(result.error).toBeUndefined();
  return result.state;
};

describe("switching a pack off and on (rules 98)", () => {
  it("scatters others from its places, the same way every time", () => {
    const s = world();
    expect(s.disabledPacks).toBeUndefined();
    const after = ok(play(s, off(SEA)));
    expect(after.disabledPacks).toEqual([SEA]);
    // The player comes out where the pack's way opens; the rest spread.
    expect(after.actors.vale.place).toBe("pond");
    expect(after.items.lamp.holder).toBe("vale");
    // Dealt round the Sea's ways out: the pond and the Hoppy Cat jetty.
    const at = ["keeper", "moth"].map((id) => after.actors[id].place);
    expect(at.sort()).toEqual(["hoppycat-signal-jetty", "pond"]);
    expect(play(world(), off(SEA)).state).toEqual(after);
    expect(reload(after)).toEqual(after);
  });

  it("keeps its own content dormant and returns it as it was", () => {
    const s = world((w) => (w.items["greek-water-jar"].holder = "vale"));
    const before = structuredClone(s.actors["greek-elder"]);
    const quiet = ok(play(s, off(SEA)));
    expect(entityActive(quiet, "greek-well")).toBe(false);
    expect(entityActive(quiet, "greek-elder")).toBe(false);
    // Carried away, its thing stays with its holder, unseen.
    expect(quiet.items["greek-water-jar"].holder).toBe("vale");
    expect(entityActive(quiet, "greek-water-jar")).toBe(false);
    const back = ok(play(reload(quiet), on(SEA)));
    expect(back.actors["greek-elder"]).toEqual(before);
    expect(entityActive(back, "greek-water-jar")).toBe(true);
    expect(back.actors.vale.place).toBe("pond");
  });

  it("ends a fight there and sets aside quests that name it", () => {
    const each = (v) => ({ keeper: v, "greek-elder": v });
    const w = ok(play(world(), legalActions(world())[0]));
    w.actors["greek-elder"].place = w.actors.keeper.place = "greek-well";
    Object.assign(w.peaceUntil, each(0));
    const [challenger, defender] = Object.keys(each());
    const fight = { challenger, defender, location: "greek-well", item: null };
    w.standoffs = [{ ...fight, answered: false, opened: w.turn }];
    for (const field of ["guarding", "struck", "steppedBack"])
      w.standoffs[0][field] = each(false);
    w.standoffs[0].resolve = each(4);
    const want = (target) => ({ kind: "item", target, refusals: 0, since: 0 });
    w.actors.moth.want = want("greek-water-jar");
    w.actors.moth.under = [want("lamp")];
    // Vale in the fight may not switch; once out of it, the fight ends.
    const vale = { ...w.standoffs[0], challenger: "vale" };
    const busy = reload({ ...w, standoffs: [vale] });
    expect(play(busy, off(SEA)).error).toMatch(/Not during a fight/);
    const after = ok(play(reload(w), off(SEA)));
    expect(after.standoffs).toEqual([]);
    // Set aside as it is, with nothing redrawn.
    expect(questsOf(after, "moth").map((q) => q.target)).toEqual([
      "lamp",
      "greek-water-jar",
    ]);
    expect(after.actors.moth.gaveUp).toBeUndefined();
  });

  it("switches the shore off: the first pack on takes everyone in", () => {
    const s = world((w) => {
      w.actors.vale.place = w.items.cloth.holder = "attic";
      Object.assign(w.items.lamp, { holder: "attic", lit: true });
    });
    const moves = (w) => legalActions(w).map((a) => a.target);
    // Cosy Cottage's entry, the lit attic, goes with it.
    expect(moves(s)).toContain("forest-cottage");
    expect(moves(ok(play(s, off(COTTAGE))))).not.toContain("forest-cottage");
    const quiet = ok(play(s, off(SHORE)));
    expect(quiet.actors.vale.place).toBe("forest-cottage");
    for (const id of ["keeper", "lamp", "attic"])
      expect(entityActive(quiet, id)).toBe(false);
    expect(moves(quiet)).not.toContain("attic");
    // Then the Sea; Hoppy Cat, entered only from the Sea, stays on and
    // takes in the last arrivals at its jetty.
    const sea = ok(play(reload(quiet), off(COTTAGE)));
    expect(sea.actors.vale.place).toBe("greek-harbor");
    const last = ok(play(sea, off(SEA)));
    expect(last.actors.vale.place).toBe("hoppycat-signal-jetty");
  });

  it("waits for the first crossing to switch the shore off", () => {
    const opening = createWorld({ opening: true, seed: 3 });
    expect(play(opening, off(SHORE)).error).toMatch(/first crossing/);
  });

  it("keeps one pack on, and shared worlds as they are", () => {
    const s = world();
    expect(play(s, off("badger-forest")).error).toMatch(/Only a world pack/);
    // Another pack's ship at a dock that goes quiet puts in at home.
    const ship = world((w) => {
      w.actors.vale.place = "greek-ship";
      const at = { phase: "arrived", dock: "hoppycat-signal-jetty" };
      Object.assign(w.transports["greek-ship"], at, { riders: ["vale"] });
    });
    const home = ok(play(ship, off(HOPPY)));
    expect(home.transports["greek-ship"].dock).toBe("greek-harbor");
    expect(home.actors.vale.place).toBe("greek-harbor");
    let w = ok(play(s, off(SEA)));
    for (const id of [HOPPY, SHORE]) w = ok(play(w, off(id)));
    expect(play(w, off(COTTAGE)).error).toMatch(/One world pack/);
    expect(play(w, off(SEA)).error).toMatch(/off already/);
    const { world: shared } = dispatchShared({
      op: "create",
      save: encodeSave(s),
    });
    const asked = dispatchShared({
      op: "play",
      world: shared,
      actor: "vale",
      action: off(SEA),
    });
    expect(asked.error).toMatch(/Shared worlds keep every/);
  });

  it("is a rules 98 rule: rules 96 keeps the pack awake", () => {
    // Vale in a pack switched off: rules 98 refuses the world, 96 ignores it.
    const quiet = JSON.parse(encodeSave(world()));
    quiet.disabledPacks = [SEA];
    const file = (f) =>
      readFileSync(`v2/orchestrator-rust/src/card_shared/${f}`, "utf8");
    const create = (version) => {
      const cardContent = JSON.parse(file("content.json"));
      const context = vm.createContext({ structuredClone, cardContent });
      vm.runInContext(file(`engine-v${version}.js`), context);
      const request = { op: "create", save: JSON.stringify(quiet) };
      return JSON.parse(context.cardShared(JSON.stringify(request)));
    };
    expect(create(96).ok).not.toBe(false);
    expect(create(98).ok).toBe(false);
  });
});
