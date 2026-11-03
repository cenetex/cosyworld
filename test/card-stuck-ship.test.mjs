// A ship out of cargo with nobody able to sail on goes home (rules 95). The
// Charybdis's cargo lanes out of the Wine-Dark Harbor need the provisions or
// a Hoppy Cat thing aboard. A rider who wants to sail on, with none aboard,
// would wait aboard for ever, and a ship with anyone aboard answers no call.
// After IDLE_ROUNDS with nobody setting a course, the ship puts in at its
// home port (its authored `at`, the harbor), everyone aboard goes ashore,
// and the empty ship answers the next call.
import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { transports } from "../v2/card-game/pack-registry.mjs";
import {
  IDLE_ROUNDS,
  callTransport,
  sendShipHome,
  stuckShip,
} from "../v2/card-game/pack-transport.mjs";
import { openSeas } from "./helpers/open-door.mjs";

const SHIP = "greek-ship",
  BARD = "greek-rhapsode",
  HOME = transports[SHIP].at;
const players = ["vale", "mara"];
const reload = (s) => decodeSave(encodeSave(s));
const ask = (world, actor, op = "view", extra = {}) =>
  dispatchShared({
    world,
    actor,
    op,
    claimed: players,
    present: players,
    ...extra,
  });
function act(world, actor, kind, target) {
  const action = ask(world, actor).actions.find(
    (a) => a.kind === kind && (target === undefined || a.target === target),
  );
  expect(action, `${actor} ${kind} ${target ?? ""}`).toBeDefined();
  const result = ask(world, actor, "play", { action });
  expect(result.ok, result.error).toBe(true);
  return reload(result.world);
}
// After the plea: the provisions lie ashore at the harbor, the ship lies
// there empty, Mara waits at Piraeus and `rider` is aboard.
function stuck(rider) {
  const s = dispatchShared({
    op: "create",
    save: encodeSave(openSeas()),
  }).world;
  s.items["greek-provisions"].holder = HOME;
  for (const a of Object.values(s.actors)) if (a.place === SHIP) a.place = HOME;
  s.actors.vale.place = "greek-courtyard";
  s.actors.mara.place = "greek-piraeus";
  s.actors[rider].place = SHIP;
  if (rider === BARD)
    s.actors[BARD].want = {
      kind: "place",
      target: "hoppycat-signal-jetty",
      since: s.turn,
      refusals: 0,
    };
  Object.assign(s.transports[SHIP], {
    phase: "docked",
    dock: HOME,
    destination: null,
    riders: [],
    since: s.turn,
    recall: null,
  });
  return reload(s);
}
const boards = (s) =>
  ask(s, "mara").actions.some((a) => a.kind === "move" && a.target === SHIP);

describe("a stuck ship goes home", () => {
  it("is the harbor for the Charybdis, from the transport's `at`", () => {
    expect(HOME).toBe("greek-harbor");
  });

  it("puts the Bard ashore at home, and Mara at Piraeus can call the ship", () => {
    let s = stuck(BARD);
    // Not yet: someone aboard may still set a course.
    expect(stuckShip(s, SHIP)).toBe(false);
    const idle = structuredClone(s);
    idle.turn += IDLE_ROUNDS;
    expect(stuckShip(idle, SHIP)).toBe(true);
    // The rule itself: home, the Bard ashore, the empty ship answers a call.
    expect(sendShipHome(idle, SHIP)).toMatchObject({
      kind: "home",
      dock: HOME,
      ashore: [BARD],
    });
    expect(idle.actors[BARD].place).toBe(HOME);
    idle.turn += 1;
    callTransport(idle, "greek-piraeus");
    expect(idle.transports[SHIP].dock).toBe("greek-piraeus");
    // In play: Mara waits at Piraeus until the ship comes, then boards.
    let home = false;
    for (let i = 0; i < 16 && !boards(s); i++) {
      s = act(s, "mara", "wait");
      home ||= s.log.some((e) => /puts in at/u.test(e.text || ""));
    }
    expect(home).toBe(true);
    expect(s.actors[BARD].place).not.toBe(SHIP);
    expect(s.actors[BARD].want?.target).not.toBe("hoppycat-signal-jetty");
    s = act(s, "mara", "move", SHIP);
    expect(s.actors.mara.place).toBe(SHIP);
    expect(s.transports[SHIP].dock).toBe("greek-piraeus");
  });

  it("puts a player ashore the same way", () => {
    let s = stuck("vale");
    for (let i = 0; i < 16 && !boards(s); i++) s = act(s, "mara", "wait");
    expect(s.actors.vale.place).toBe(HOME);
    s = act(s, "mara", "move", SHIP);
    expect(s.actors.mara.place).toBe(SHIP);
  });

  it("sends a ship already stuck in a save from before rules 95 home", () => {
    const saved = JSON.parse(encodeSave(stuck(BARD)));
    delete saved.usedUp;
    saved.turn += IDLE_ROUNDS;
    saved.revision = Math.max(saved.revision, saved.turn);
    const w = decodeSave(JSON.stringify(saved));
    expect(w.actors[BARD].place).toBe(HOME);
    expect(w.transports[SHIP]).toMatchObject({
      phase: "docked",
      dock: HOME,
      riders: [],
    });
    expect(stuckShip(w, SHIP)).toBe(false);
  });
});
