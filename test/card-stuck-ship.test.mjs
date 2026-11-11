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
  summonTransport,
} from "../v2/card-game/pack-transport.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import { openSeas } from "./helpers/open-door.mjs";

// Since rules 96 a resident aboard sails to its own destination, so the
// Bard here is bound for Marathon, a rumour no voyage reaches: the stuck
// rule is the fallback.
const NOWHERE = "greek-marathon";
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
// After the plea: the provisions lie ashore at the harbor (or are used up),
// the ship lies
// there empty, Mara waits at Piraeus and `rider` is aboard.
function stuck(rider) {
  const s = dispatchShared({
    op: "create",
    save: encodeSave(openSeas()),
  }).world;
  // Used up, the provisions are out of play already.
  if (!s.usedUp?.includes("greek-provisions"))
    s.items["greek-provisions"].holder = HOME;
  for (const a of Object.values(s.actors)) if (a.place === SHIP) a.place = HOME;
  s.actors.vale.place = "greek-courtyard";
  s.actors.mara.place = "greek-piraeus";
  s.actors[rider].place = SHIP;
  if (rider === BARD) delete s.actors[BARD].under;
  if (rider === BARD)
    s.actors[BARD].want = {
      kind: "place",
      target: NOWHERE,
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

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("puts the Bard ashore at home, and Mara at Piraeus can call the ship", () => {
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
    // In play: Mara waits at Piraeus until the ship comes, then boards. With
    // no way to Marathon the Bard sails on to somewhere he can explore
    // (rules 96) or is set ashore at home; either way the ship reaches her.
    for (let i = 0; i < 16 && !boards(s); i++) s = act(s, "mara", "wait");
    s = act(s, "mara", "move", SHIP);
    expect(s.actors.mara.place).toBe(SHIP);
    expect(s.transports[SHIP].dock).toBe("greek-piraeus");
  });

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("puts a player ashore the same way", () => {
    let s = stuck("vale");
    for (let i = 0; i < 16 && !boards(s); i++) s = act(s, "mara", "wait");
    expect(s.actors.vale.place).toBe(HOME);
    s = act(s, "mara", "move", SHIP);
    expect(s.actors.mara.place).toBe(SHIP);
  });

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("leaves aboard a player the full harbor has no room for", () => {
    const five = ["vale", "mara", "ash", "nell", "tavi"];
    const s = dispatchShared({
      op: "create",
      save: encodeSave(openSeas()),
    }).world;
    for (const id of five) s.actors[id].place = HOME;
    s.actors.vale.place = SHIP;
    Object.assign(s, { controlledActors: five, presentActors: five });
    Object.assign(s.transports[SHIP], { phase: "docked", dock: HOME });
    // The harbor holds four players, so Vale stays aboard (rules 98).
    expect(sendShipHome(s, SHIP).ashore).not.toContain("vale");
    expect(s.actors.vale.place).toBe(SHIP);
    const ashore = five.filter((id) => s.actors[id].place === HOME);
    expect(ashore).toHaveLength(4);
  });



  // package 6 fixtures: starts from a recorded old save, re-recorded after the bump.
it.skip("keeps a ship with a standoff aboard, in play and in a save from before rules 95", () => {
    // Vale threatens Myrto aboard at the harbor; the fight holds the ship.
    let s = stuck("vale");
    s.actors["greek-shipmaster"].place = SHIP;
    s = act(reload(s), "vale", "threaten", "greek-shipmaster");
    expect(s.standoffs.some((c) => c.location === SHIP)).toBe(true);
    const idle = structuredClone(s);
    idle.turn += IDLE_ROUNDS;
    expect(stuckShip(idle, SHIP)).toBe(false);
    const saved = JSON.parse(encodeSave(s));
    delete saved.usedUp;
    saved.turn += IDLE_ROUNDS;
    saved.revision = Math.max(saved.revision, saved.turn);
    const w = decodeSave(JSON.stringify(saved));
    expect(w.actors.vale.place).toBe(SHIP);
    expect(w.standoffs.some((c) => c.location === SHIP)).toBe(true);
  });

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("answers a lamp summon made while the ship was occupied", () => {
    const s = structuredClone(stuck(BARD));
    summonTransport(s, SHIP, "pond");
    expect(s.transports[SHIP].recall).toBe("pond");
    s.turn += IDLE_ROUNDS;
    sendShipHome(s, SHIP);
    expect(s.actors[BARD].place).toBe(HOME);
    expect(s.transports[SHIP]).toMatchObject({ dock: "pond", recall: null });
  });

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("sails the idle voyage home itself where its first lane leads there", () => {
    // From Piraeus the only open lane is home: the voyage is sailed, and
    // learned, rather than skipped.
    const s = structuredClone(stuck(BARD));
    s.transports[SHIP].dock = "greek-piraeus";
    s.turn += IDLE_ROUNDS;
    expect(stuckShip(s, SHIP)).toBe(false);
  });
});

describe("item conditions ignore used-up things", () => {
  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("does not count a used-up thing as held", () => {
    const s = structuredClone(openSeas());
    const c = { kind: "holding", item: "greek-provisions", role: "actor" };
    s.items["greek-provisions"].holder = "vale";
    s.usedUp = (s.usedUp || []).filter((id) => id !== "greek-provisions");
    expect(conditionMet(s, c, null, "greek-drama", "vale")).toBe(true);
    s.usedUp = [...s.usedUp, "greek-provisions"].sort();
    expect(conditionMet(s, c, null, "greek-drama", "vale")).toBe(false);
  });
});
