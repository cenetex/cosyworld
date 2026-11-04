// A pack switches off and on mid-world (rules 97): its own content goes
// dormant as it is, and everyone and everything from elsewhere standing in it
// is scattered to the shore, deterministically.
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

const GREEK = "greek-drama";
const off = (pack) => ({ kind: "pack", pack, enable: false });
const on = (pack) => ({ kind: "pack", pack, enable: true });
const reload = (s) => decodeSave(encodeSave(s));
function world(edit = () => {}) {
  const s = createWorld({ seed: 7, packScopes: { [GREEK]: "full" } });
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

describe("switching a pack off and on (rules 97)", () => {
  it("starts every world with every pack on", () => {
    const s = createWorld({ seed: 1 });
    expect(s.enabledPacks).toEqual([
      GREEK,
      "hoppycat-archive",
      "lonely-forest",
    ]);
    const old = JSON.parse(encodeSave(s));
    delete old.enabledPacks;
    expect(reload(old).enabledPacks).toEqual(s.enabledPacks);
  });

  it("scatters others from its places, the same way every time", () => {
    const s = world();
    const after = ok(play(s, off(GREEK)));
    expect(after.enabledPacks).toEqual(["hoppycat-archive", "lonely-forest"]);
    // The player comes out where the pack's way opens; the rest spread.
    expect(after.actors.vale.place).toBe("pond");
    expect(after.items.lamp.holder).toBe("vale");
    const spots = ["pond", "station", "attic"];
    for (const id of ["keeper", "moth"])
      expect(spots).toContain(after.actors[id].place);
    for (const id of ["oil", "bell"])
      expect(spots).toContain(after.items[id].holder);
    expect(
      new Set(["keeper", "moth"].map((id) => after.actors[id].place)).size,
    ).toBe(2);
    expect(play(world(), off(GREEK)).state).toEqual(after);
    expect(reload(after)).toEqual(after);
  });

  it("keeps its own content dormant and returns it as it was", () => {
    const s = world((w) => (w.items["greek-water-jar"].holder = "vale"));
    const before = structuredClone(s.actors["greek-elder"]);
    const quiet = ok(play(s, off(GREEK)));
    expect(entityActive(quiet, "greek-well")).toBe(false);
    expect(entityActive(quiet, "greek-elder")).toBe(false);
    // Carried away, its thing stays with its holder, unseen.
    expect(quiet.items["greek-water-jar"].holder).toBe("vale");
    expect(entityActive(quiet, "greek-water-jar")).toBe(false);
    const back = ok(play(reload(quiet), on(GREEK)));
    expect(back.actors["greek-elder"]).toEqual(before);
    expect(entityActive(back, "greek-water-jar")).toBe(true);
    // Scattered things stay where they were scattered.
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
    const jar = { kind: "item", target: "greek-water-jar", refusals: 0 };
    w.actors.moth.want = { ...jar, since: w.turn };
    const after = ok(play(reload(w), off(GREEK)));
    expect(after.standoffs).toEqual([]);
    expect(after.actors.moth.want?.target).not.toBe("greek-water-jar");
    expect(questsOf(after, "moth").map((w) => w.target)).toContain(
      "greek-water-jar",
    );
  });

  it("puts another pack's ship in at home when its dock goes quiet", () => {
    const s = world((w) => {
      w.actors.vale.place = "greek-ship";
      Object.assign(w.transports["greek-ship"], {
        phase: "arrived",
        dock: "hoppycat-signal-jetty",
        riders: ["vale"],
      });
    });
    const after = ok(play(s, off("hoppycat-archive")));
    expect(after.transports["greek-ship"]).toMatchObject({
      phase: "docked",
      dock: "greek-harbor",
      riders: [],
    });
    expect(after.actors.vale.place).toBe("greek-harbor");
  });

  it("keeps the shore and one pack on, and shared worlds as they are", () => {
    const s = world();
    expect(play(s, off("badger-forest")).error).toMatch(/Reflected Shore/);
    let w = ok(play(s, off(GREEK)));
    w = ok(play(w, off("hoppycat-archive")));
    expect(play(w, off("lonely-forest")).error).toMatch(/One world pack/);
    expect(play(w, off(GREEK)).error).toMatch(/off already/);
    const shared = dispatchShared({ op: "create", save: encodeSave(s) });
    const asked = dispatchShared({
      op: "play",
      world: shared.world,
      actor: "vale",
      action: off(GREEK),
    });
    expect(asked.error).toMatch(/Shared worlds keep every pack/);
  });

  it("is a rules 97 rule: rules 96 keeps the pack awake", () => {
    // Vale at the well of a pack switched off: rules 97 refuses the world,
    // rules 96 ignores the switch.
    const quiet = JSON.parse(encodeSave(world()));
    quiet.enabledPacks = ["hoppycat-archive", "lonely-forest"];
    const dir = "v2/orchestrator-rust/src/card_shared";
    const file = (path) => readFileSync(`${dir}/${path}`, "utf8");
    const rules = (version) => {
      const context = vm.createContext({
        structuredClone,
        cardContent: JSON.parse(file("content.json")),
      });
      vm.runInContext(file(`engine-v${version}.js`), context);
      return (request) =>
        JSON.parse(context.cardShared(JSON.stringify(request)));
    };
    const create = (version) =>
      rules(version)({ op: "create", save: JSON.stringify(quiet) });
    expect(create(96).ok).not.toBe(false);
    expect(create(97).ok).toBe(false);
  });
});
