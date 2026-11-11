import { selectLamp } from "./fixtures/card-attic-opening.mjs";
import { expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave, play, seedRun } from "../v2/card-game/world.mjs";
import { entityActive, packDefinition, packIdOf, validatePackDefinition } from "../v2/card-game/pack-registry.mjs";
import { installItemCycle, settleItemCycle } from "../v2/card-game/pack-items.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
const radio = packDefinition("ratiradio");
const items = Object.keys(radio.items).filter((id) => radio.items[id].scatterOutside);
const holders = (s) => items.map((id) => s.items[id].holder);

it("spreads keepsakes across distinct enabled external worlds, deterministically", () => {
  const seen = new Set();
  for (let seed = 0; seed < 40; seed++) {
    const s = createWorld({ seed }), places = holders(s);
    expect(places).toEqual(holders(createWorld({ seed })));
    expect(new Set(places.map(packIdOf)).size).toBe(items.length);
    for (const p of places) {
      expect(packIdOf(p)).not.toBe("ratiradio");
      expect(entityActive(s, p)).toBe(true);
      seen.add(packIdOf(p));
    }
    expect(s.items["ratiradio-station-key"].holder).toBe("pond");
    expect(holders(decodeSave(encodeSave(s)))).toEqual(places);
  }
  expect([...seen].sort()).toEqual(["badger-forest", "greek-drama", "hoppycat-archive", "hub", "lonely-forest", "willows"]);
});


it("avoids sleeping worlds on installation and never reshuffles when they wake", () => {
  const s = createWorld({ seed: 17 });
  s.disabledPacks = ["sea", "cottage"];
  for (const id of items) s.items[id] = { holder: radio.items[id].holder, history: [] };
  installItemCycle(s);
  for (const p of holders(s)) expect(entityActive(s, p)).toBe(true);
  const before = holders(s);
  delete s.disabledPacks;
  installItemCycle(s);
  expect(holders(s)).toEqual(before);
});

it("evacuates keepsakes when a destination world sleeps, without duplicating them", () => {
  let s = createWorld({ seed: 17 });
  for (const group of ["sea", "cottage"]) {
    const result = play(s, { kind: "pack", pack: group, enable: false });
    expect(result.ok, result.error).toBe(true);
    s = result.state;
  }
  for (const p of holders(s)) {
    expect(entityActive(s, p)).toBe(true);
    expect(packIdOf(p)).not.toBe("ratiradio");
  }
  expect(holders(decodeSave(encodeSave(s)))).toEqual(holders(s));
});

it("returns absent custody outside Radio and leaves intentional Listening Room deposits", () => {
  const s = createWorld({ seed: 17 });
  s.sharedVersion = 1; s.controlledActors = ["vale", "mara"]; s.presentActors = ["vale"];
  s.turn = DAYLIGHT_TURNS * 2;
  s.items[items[0]].holder = "mara";
  s.items[items[1]].holder = "ratiradio-listening-room";
  settleItemCycle(s, String, () => {});
  expect(s.items[items[0]].holder).toBe("pond");
  expect(s.items[items[1]].holder).toBe("ratiradio-listening-room");
});

it("rejects malformed scatter declarations", () => {
  const pack = structuredClone(radio);
  pack.items[items[0]].scatterOutside = "yes";
  expect(() => validatePackDefinition(pack)).toThrow(/scatterOutside/u);
});



it("keeps the Station Key at Black Pond on direct Radio landings", async () => {
  const { createLandingWorld } = await import("../v2/card-game/pack-landing.mjs");
  const s = createLandingWorld(radio, 17);
  expect(s.items["ratiradio-station-key"].holder).toBe("pond");
  for (const p of holders(s)) expect(packIdOf(p)).not.toBe("ratiradio");
});

it("retrieves a naturally scattered Hoppy keepsake via Piraeus, not the retired shortcut", async () => {
  const { legalActions } = await import("../v2/card-game/world.mjs");
  const { endStandoff } = await import("./helpers/standoff.mjs");
  let s = createWorld({ seed: 1 });
  // This journey tests the scattered keepsake and real transport route, not gift refusal.
  s.actors.moth.trust.vale = 1;
  expect(s.items["ratiradio-red-beanie"].holder).toBe("hoppycat-halfway-tea-garden");
  const route = [
    ["take", "hoppycat-red-thread-spool"], ["take", "lamp"], ["move", "pond"],
    ["ask", "cloth"], ["hold", "cloth"], ["drop", "lamp"],
    ["move", "greek-ship"], ["course", "greek-harbor"], ["wait"], ["move", "greek-harbor"],
    ["move", "greek-ship"], ["course", "greek-piraeus"], ["wait"], ["move", "greek-piraeus"],
    ["move", "greek-ship"], ["course", "hoppycat-signal-jetty"], ["wait"],
    ["move", "hoppycat-signal-jetty"], ["move", "hoppycat-halfway-tea-garden"],
    ["drop", "cloth"], ["take", "ratiradio-red-beanie"], ["move", "pond"],
  ];
  for (const [kind, id, target] of route) {
    s = endStandoff(s);
    if (kind === "hold") { s = selectLamp(s, id); continue; }
    const action = legalActions(s).find((a) => a.kind === kind &&
      (!id || a.item === id || a.target === id) && (!target || a.target === target));
    expect(action, `${kind} ${id || ""}`).toBeDefined();
    const result = play(s, action);
    expect(result.ok, result.error).toBe(true);
    s = decodeSave(encodeSave(result.state));
  }
  expect(s.items["ratiradio-red-beanie"].holder).toBe("vale");
  expect(s.actors.vale.place).toBe("pond");
  expect(s.crossings["hoppycat-pond-garden"].discovered).toBe(false);
}, 15000);
