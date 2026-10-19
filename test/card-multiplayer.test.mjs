import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  join,
  legalActions,
  play,
  rest,
  standoffFor,
} from "../v2/card-game/core/world.mjs";
import { plan } from "../v2/card-game/core/planner.mjs";
import { carried, generateQuest } from "../v2/card-game/core/goals.mjs";

const shore = JSON.parse(
  readFileSync(new URL("../v2/card-game/seeds/shore.json", import.meta.url)),
);
const next = (x) => (Math.imul(x, 1664525) + 1013904223) >>> 0;
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
const wait = (s, actor) => act(s, find(s, actor, "wait"));

// Players and one resident in one room, with an item each.
function room(players, extra = {}) {
  const ids = players.map((name) => name.toLowerCase());
  return createWorld({
    id: "room",
    places: [
      { id: "yard", name: "Yard", exits: ["lane"] },
      { id: "lane", name: "Lane", exits: ["yard"] },
    ],
    avatars: [
      ...players.map((name, i) => ({
        id: ids[i],
        name,
        role: "player",
        place: "yard",
      })),
      { id: "res", name: "Res", role: "resident", place: "yard" },
    ],
    items: [
      ...ids.map((id) => ({ id: `${id}-thing`, name: "Thing", holder: id })),
      { id: "res-thing", name: "Thing", holder: "res" },
    ],
    ...extra,
  });
}

describe("multiplayer in the card core", () => {
  it("keeps a resident at one player's pace however many players are near", () => {
    let s = room(["Ana", "Bo", "Cy"]);
    let acted = 0;
    for (let i = 0; i < 30; i++) {
      s = wait(s, ["ana", "bo", "cy"][i % 3]);
      if (s.avatars.res.heard === 0) acted += 1;
    }
    expect(acted).toBe(10);
    s = rest(s, "cy").state;
    acted = 0;
    for (let i = 0; i < 20; i++) {
      s = wait(s, ["ana", "bo"][i % 2]);
      if (s.avatars.res.heard === 0) acted += 1;
    }
    expect(acted).toBe(10);
  });

  it("lets players exchange only by an offer and its acceptance", () => {
    let s = room(["Ana", "Bo"]);
    const swap = find(s, "ana", "offer", {
      item: "ana-thing",
      receive: "bo-thing",
    });
    s = act(s, swap);
    expect(carried(s, "ana")).toContain("ana-thing");
    const accept = find(s, "bo", "accept", { target: "ana" });
    s = act(s, accept);
    expect(carried(s, "ana")).toContain("bo-thing");
    expect(carried(s, "bo")).toContain("ana-thing");
    expect(s.offers).toEqual([]);
    expect(play(s, accept).ok).toBe(false);
    // An offer lapses when the offering player walks away.
    s = act(s, find(s, "ana", "offer", { target: "bo" }));
    s = act(s, find(s, "ana", "move", { item: null, target: "lane" }));
    expect(s.offers).toEqual([]);
    expect(find(s, "bo", "accept")).toBeUndefined();
  });

  it("protects a threatened player until it answers", () => {
    let s = room(["Ana", "Bo"]);
    s = act(s, find(s, "ana", "threaten", { target: "bo" }));
    expect(find(s, "ana", "attack")).toBeUndefined();
    s = wait(s, "bo");
    expect(find(s, "ana", "attack", { target: "bo" })).toBeTruthy();
    // A player who never answers keeps everything when the standoff lapses.
    let t = room(["Ana", "Bo"]);
    t = act(t, find(t, "ana", "threaten", { target: "bo" }));
    for (let i = 0; i < 12; i++) t = wait(t, "ana");
    expect(standoffFor(t, "bo")).toBeUndefined();
    expect(carried(t, "bo")).toEqual(["bo-thing"]);
  });

  it("leaves a sleeping player and its items alone until it plays", () => {
    let s = room(["Ana", "Bo"]);
    s = act(s, find(s, "ana", "threaten", { target: "bo" }));
    s = rest(s, "bo").state;
    expect(standoffFor(s, "bo")).toBeUndefined();
    const kinds = legalActions(s, "ana")
      .filter((a) => a.target === "bo" || a.receive === "bo-thing")
      .map((a) => a.kind);
    expect(kinds).toEqual([]);
    expect(rest(s, "bo").ok).toBe(false);
    for (const id of ["ana", "res"]) {
      const q = generateQuest(structuredClone(s), id);
      expect(JSON.stringify(q.steps)).not.toMatch(/bo-thing|"bo"/);
    }
    const before = structuredClone(s.avatars.bo);
    for (let i = 0; i < 40; i++) s = act(s, plan(s, "ana").action);
    expect(s.avatars.bo).toEqual(before);
    s = act(s, find(s, "bo", "wait"));
    expect(s.avatars.bo.asleep).toBe(false);
    expect(s.log.some((e) => e.text === "Bo wakes.")).toBe(true);
  });

  it("lets a player join a running world", () => {
    let s = createWorld(shore);
    for (let i = 0; i < 20; i++) s = act(s, plan(s, "vale").action);
    const joined = join(s, { id: "ash", name: "Ash", place: "pond" });
    expect(joined.ok).toBe(true);
    s = joined.state;
    expect(s.avatars.ash.progress.current.steps.length).toBeGreaterThan(0);
    expect(join(s, { id: "ash", name: "Ash", place: "pond" }).ok).toBe(false);
    expect(join(s, { id: "eve", name: "Eve", place: "nowhere" }).ok).toBe(
      false,
    );
    for (let i = 0; i < 20; i++)
      s = act(s, plan(s, i % 2 ? "ash" : "vale").action);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("keeps a shared shore fair and replayable with uneven players", () => {
    const run = (k) => {
      let s = createWorld(shore);
      for (const [id, name, place] of [
        ["ash", "Ash", "pond"],
        ["bee", "Bee", "attic"],
        ["cal", "Cal", "station"],
      ])
        s = join(s, { id, name, place }).state;
      const players = ["vale", "ash", "bee", "cal"];
      const quests = {},
        plays = {};
      let x = (k * 2654435761) >>> 0;
      for (let t = 0; t < 600; t++) {
        x = next(x);
        // Uneven turns: Vale plays most, Cal often leaves and comes back.
        const p = players[[0, 0, 0, 1, 1, 2, 3][x % 7]];
        if (p === "cal" && (x >>> 4) % 9 === 0 && !s.avatars.cal.asleep) {
          const held = carried(s, "cal");
          s = rest(s, "cal").state;
          for (let i = 0; i < 20; i++) {
            const q = players[i % 3];
            s = act(s, plan(s, q).action);
          }
          expect(carried(s, "cal")).toEqual(held);
          continue;
        }
        plays[p] = (plays[p] || 0) + 1;
        const acts = legalActions(s, p);
        s = act(
          s,
          (x >>> 9) % 4 ? plan(s, p).action : acts[(x >>> 12) % acts.length],
        );
      }
      for (const id of Object.keys(s.avatars))
        quests[id] = s.avatars[id].progress.program;
      return { s, quests, plays };
    };
    const a = run(1);
    expect(encodeSave(a.s)).toBe(encodeSave(run(1).s));
    // Each player finishes quests with its own plays, however often the others play.
    for (const k of [1, 2, 3]) {
      const { quests, plays } = k === 1 ? a : run(k);
      for (const id of ["vale", "ash", "bee"])
        expect(quests[id], `run ${k} ${id}`).toBeGreaterThanOrEqual(
          Math.floor(plays[id] / 40),
        );
    }
  }, 60_000);
});
