import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { summonTransport } from "../v2/card-game/pack-transport.mjs";
import { backdrop, stageOf, travelCard } from "../v2/card-game/scene.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/daylight.mjs";
import { ajaxStart, ajaxMove, ajaxChoice } from "./helpers/greek-ajax.mjs";

const ship = "greek-ship", signal = "pond-greek-harbor";
const players = ["vale", "mara", "ash"];
const reload = (world) => decodeSave(encodeSave(world));
const invited = () => ajaxChoice(ajaxMove(ajaxStart(), "greek-harbor"), "invitation");
const berths = [
  { place: "greek-ajax-landing", origin: "greek-marathon", focus: 80,
    painting: "ajax-landing-ship-at-berth", empty: "greek-drama/ajax-camp", daylight: true },
  { place: "hoppycat-signal-jetty", origin: "greek-piraeus", focus: 90,
    painting: "hoppycat-signal-jetty-ship-at-berth", empty: "hoppycat-archive/hoppycat-signal-jetty", daylight: false },
];
const ask = (world, actor, op = "view", extra = {}) =>
  dispatchShared({ world, actor, op, claimed: players, present: players, ...extra });
function act(world, actor, kind, target) {
  const action = ask(world, actor).actions.find(
    (a) => a.kind === kind && (target === undefined || a.target === target),
  );
  expect(action, `${actor} can ${kind} ${target ?? ""}`).toBeDefined();
  const result = ask(world, actor, "play", { action });
  expect(result.ok, result.error).toBe(true);
  return reload(result.world);
}
function setup(berth, night) {
  const local = berth.daylight ? invited() : createWorld({ packScopes: { "greek-drama": "full" } });
  const world = dispatchShared({ op: "create", save: encodeSave(local) }).world;
  world.turn = world.revision = Math.ceil(world.turn / (2 * DAYLIGHT_TURNS)) * 2 * DAYLIGHT_TURNS + (night ? DAYLIGHT_TURNS : 0);
  for (const actor of Object.values(world.actors))
    if (actor.place === ship) actor.place = berth.origin;
  world.transports[ship].riders = [];
  world.actors.vale.place = world.actors.mara.place = berth.origin;
  world.actors.ash.place = berth.place;
  world.items["greek-provisions"].holder = "vale";
  world.items["hoppycat-halfway-cup"].holder = "vale";
  world.crossings[signal].discovered = true;
  summonTransport(world, ship, berth.origin);
  return reload(world);
}
function checkShore(world, berth, night, docked) {
  const shore = ask(world, "ash").world;
  const file = docked
    ? `greek-drama/${berth.painting}${berth.daylight && night ? "-night" : ""}`
    : `${berth.empty}${berth.daylight ? (night ? "-night" : "-day") : ""}`;
  expect(backdrop(berth.place, shore)).toBe(`./assets/${file}.webp`);
  // The stage shows the ship at its berth; the ship's card shows where it
  // goes, the deck lit for the hour.
  expect(travelCard(shore, ship)).toEqual(docked ? {
    name: "Greek ship", art: `./assets/greek-drama/ship-deck${night ? "-night" : ""}.webp`,
  } : null);
  expect(stageOf(shore, berth.place).focus).toEqual({ x: berth.focus, y: 50 });
}

describe("painted ship berths", () => {
  for (const berth of berths) it.each([false, true])(
    `${berth.place} follows a saved shared voyage (night=%s)`, (night) => {
      let world = setup(berth, night);
      const check = (docked) => checkShore(world, berth, night, docked);
      check(false);
      world = act(world, "vale", "move", ship);
      world = act(world, "mara", "move", ship);
      world = act(world, "vale", "course", berth.place);
      expect(world.transports[ship].phase).toBe("sea");
      check(false);
      world = act(world, "mara", "wait");
      expect(world.transports[ship].phase).toBe("arrived");
      check(true);
      world = act(world, "vale", "move", berth.place);
      check(true); // The second passenger is still aboard.
      world = act(world, "mara", "move", berth.place);
      expect(world.transports[ship].phase).toBe("docked");
      check(true);
      world = act(world, "vale", "move", ship);
      check(true); // Boarding leaves the ship at its berth.
      world = act(world, "vale", "course", berth.origin);
      expect(world.transports[ship].phase).toBe("sea");
      check(false);
    },
  );
  it("keeps the painted berth behind the signal and Trojan invitation", () => {
    for (const berth of berths) {
      const world = setup(berth, false);
      summonTransport(world, ship, berth.place);
      world.crossings[signal].discovered = false;
      checkShore(world, berth, false, false);
      world.crossings[signal].discovered = true;
      checkShore(world, berth, false, true);
      if (berth.daylight) {
        const closed = createWorld({ packScopes: { "greek-drama": "full" } });
        closed.actors.vale.place = berth.place;
        closed.crossings[signal].discovered = true;
        summonTransport(closed, ship, berth.place);
        expect(backdrop(berth.place, closed)).toBe(`./assets/${berth.empty}-day.webp`);
        expect(travelCard(closed, ship)).toBeNull();
      }
    }
  });
});
