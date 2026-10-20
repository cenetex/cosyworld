import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  handText,
  join,
  legalActions,
  play,
} from "../v2/card-game/core/world.mjs";
import { plan } from "../v2/card-game/core/planner.mjs";
import { carried, desireFor } from "../v2/card-game/core/goals.mjs";
import { knowsItem, visited } from "../v2/card-game/core/knowledge.mjs";

const shore = JSON.parse(
  readFileSync(new URL("../v2/card-game/seeds/shore.json", import.meta.url)),
);
const find = (s, actor, kind, extra = {}) =>
  legalActions(s, actor).find(
    (a) =>
      a.kind === kind && Object.entries(extra).every(([k, v]) => a[k] === v),
  );
const act = (s, action) => {
  const result = play(s, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
// A hub with three branches. Ana is a player; Res is a resident at the hub.
function hub(extra = {}) {
  return createWorld({
    id: "hub",
    places: [
      { id: "hub", name: "Hub", exits: ["east", "north", "west"] },
      { id: "east", name: "East", exits: ["hub"] },
      { id: "north", name: "North", exits: ["hub"] },
      { id: "west", name: "West", exits: ["hub", "far"] },
      { id: "far", name: "Far", exits: ["west"] },
    ],
    avatars: [
      { id: "ana", name: "Ana", role: "player", place: "hub" },
      { id: "res", name: "Res", role: "resident", place: "hub" },
    ],
    items: [
      { id: "cup", name: "Cup", holder: "hub" },
      { id: "coin", name: "Coin", holder: "far", hidden: true },
    ],
    ...extra,
  });
}

// The same hub with two players, so nothing moves unless it is played.
const quiet = (extra = {}) =>
  hub({
    avatars: [
      { id: "ana", name: "Ana", role: "player", place: "hub" },
      { id: "bo", name: "Bo", role: "player", place: "hub" },
    ],
    ...extra,
  });

describe("mystery in the card core", () => {
  it("starts each avatar knowing only where it stands", () => {
    const s = hub();
    const k = s.avatars.res.known;
    expect(Object.keys(k.places).sort()).toEqual(
      ["east", "hub", "north", "west"].sort(),
    );
    expect(visited(s, "res", "hub")).toBe(true);
    expect(visited(s, "res", "east")).toBe(false);
    expect(k.places.far).toBeUndefined();
    expect(knowsItem(s, "res", "cup")).toBe(true);
    expect(knowsItem(s, "res", "coin")).toBe(false);
  });

  it("makes a resident search and explore for what it has not seen", () => {
    let s = hub();
    s.avatars.res.progress.current = {
      id: "quest-res-x",
      name: "A rumor",
      steps: [{ items: ["coin"], location: null, avatars: [] }],
      clues: { coin: "west" },
      xp: 30,
      generated: { turn: 0, item: "coin", owner: "far", partner: null },
    };
    const route = [];
    for (let i = 0; i < 60 && !carried(s, "res").includes("coin"); i++) {
      s = act(s, find(s, "ana", "wait"));
      route.push(s.avatars.res.place);
    }
    expect(carried(s, "res")).toContain("coin");
    // It follows the clue west, finds the far room, and has to search there.
    expect(route.indexOf("west")).toBeLessThan(route.indexOf("far"));
    expect(
      s.log.some((e) => e.verb === "search" && /finds the Coin/.test(e.text)),
    ).toBe(true);
  });

  it("hides an item until someone searches, and shows it once it is held", () => {
    let s = quiet();
    s = act(s, find(s, "ana", "move", { item: null, target: "west" }));
    s = act(s, find(s, "ana", "move", { item: null, target: "far" }));
    expect(find(s, "ana", "take", { item: "coin" })).toBeUndefined();
    s = act(s, find(s, "ana", "search"));
    expect(
      s.log.some((e) => e.verb === "search" && /finds the Coin/.test(e.text)),
    ).toBe(true);
    expect(knowsItem(s, "bo", "coin")).toBe(false);
    s = act(s, find(s, "ana", "take", { item: "coin" }));
    expect(s.items.coin.hidden).toBe(false);
    s = act(s, find(s, "ana", "drop", { item: "coin" }));
    s = join(s, { id: "cy", name: "Cy", place: "far" }).state;
    expect(find(s, "cy", "take", { item: "coin" })).toBeTruthy();
  });

  it("pays for discoveries, and more to the first to find a place", () => {
    let s = hub();
    const xp = () => s.avatars.ana.progress.xp;
    s = act(s, find(s, "ana", "move", { item: null, target: "west" }));
    const first = xp();
    expect(s.places.west.foundBy).toBe("ana");
    expect(first).toBeGreaterThanOrEqual(30);
    expect(
      s.log.some(
        (e) => e.kind === "discovery" && /Ana is the first/.test(e.text),
      ),
    ).toBe(true);
    s = act(s, find(s, "ana", "move", { item: null, target: "hub" }));
    s = act(s, find(s, "ana", "move", { item: null, target: "west" }));
    // A place already visited pays nothing more.
    expect(xp()).toBeLessThan(first + 30);
  });

  it("shares places and recent news by talking, never old sightings", () => {
    let s = quiet();
    s = act(s, find(s, "ana", "move", { item: null, target: "west" }));
    s = act(s, find(s, "ana", "move", { item: null, target: "far" }));
    s = act(s, find(s, "ana", "search"));
    s = act(s, find(s, "ana", "move", { item: null, target: "west" }));
    s = act(s, find(s, "ana", "move", { item: null, target: "hub" }));
    expect(s.avatars.bo.known.places.far).toBeUndefined();
    s = act(s, find(s, "ana", "talk", { target: "bo" }));
    expect(s.avatars.bo.known.places.far.visited).not.toBeNull();
    expect(knowsItem(s, "bo", "coin")).toBe(true);
    // Twelve turns later the same sighting is no longer news.
    let t = quiet();
    t = act(t, find(t, "ana", "move", { item: null, target: "west" }));
    t = act(t, find(t, "ana", "move", { item: null, target: "far" }));
    t = act(t, find(t, "ana", "search"));
    t = act(t, find(t, "ana", "move", { item: null, target: "west" }));
    t = act(t, find(t, "ana", "move", { item: null, target: "hub" }));
    for (let i = 0; i < 14; i++) t = act(t, find(t, "ana", "wait"));
    t = act(t, find(t, "ana", "talk", { target: "bo" }));
    expect(t.avatars.bo.known.places.far).toBeTruthy();
    expect(knowsItem(t, "bo", "coin")).toBe(false);
  });

  it("names unseen things in a goal by their clue", () => {
    const s = hub();
    const h = { items: ["coin"], location: "far", avatars: [] };
    s.avatars.res.progress.current = {
      ...s.avatars.res.progress.current,
      clues: { coin: "west", far: "west" },
    };
    expect(handText(s, h, "res")).toBe(
      "hold something near West · at a place past West · with any company",
    );
    expect(handText(s, h)).toBe("hold Coin · at Far · with any company");
  });

  it("forgets old sightings of items and avatars, never places", () => {
    let s = hub({ rules: { memoryTurns: 5 } });
    s = act(s, find(s, "ana", "move", { item: null, target: "east" }));
    expect(knowsItem(s, "ana", "cup")).toBe(true);
    for (let i = 0; i < 8; i++) s = act(s, find(s, "ana", "wait"));
    expect(knowsItem(s, "ana", "cup")).toBe(false);
    expect(s.avatars.ana.known.places.hub.visited).not.toBeNull();
  });

  it("keeps the shore mysterious, alive, and replayable", () => {
    const run = () => {
      let s = createWorld(shore);
      for (const [id, place] of [
        ["ash", "pond"],
        ["bee", "attic"],
      ])
        s = join(s, { id, name: id, place }).state;
      const players = ["vale", "ash", "bee"];
      const seen = new Set();
      let quests = 0,
        clued = 0;
      for (let i = 0; i < 600; i++) {
        for (const [id, a] of Object.entries(s.avatars)) {
          const q = a.progress.current;
          if (seen.has(`${id}:${q.id}`)) continue;
          seen.add(`${id}:${q.id}`);
          quests += 1;
          if (Object.keys(q.clues ?? {}).length) clued += 1;
        }
        s = act(s, plan(s, players[i % 3]).action);
      }
      return { s, quests, clued };
    };
    const { s, quests, clued } = run();
    // Many goals send an avatar after something it has not seen.
    expect(clued / quests).toBeGreaterThan(0.3);
    expect(s.log.some((e) => e.verb === "search")).toBe(true);
    for (const a of Object.values(s.avatars))
      expect(s.turn - a.progress.marks.at(-1)).toBeLessThan(60);
    expect(desireFor(s, "vale")).toBeTruthy();
    expect(encodeSave(run().s)).toBe(encodeSave(s));
    expect(decodeSave(encodeSave(s))).toEqual(s);
  }, 60_000);
});
