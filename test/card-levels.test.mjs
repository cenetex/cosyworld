import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  createWorld,
  join,
  legalActions,
  play,
} from "../v2/card-game/core/world.mjs";
import { plan } from "../v2/card-game/core/planner.mjs";
import { levelForXp, levelOf } from "../v2/card-game/core/goals.mjs";

const shore = JSON.parse(
  readFileSync(new URL("../v2/card-game/seeds/shore.json", import.meta.url)),
);
const next = (x) => (Math.imul(x, 1664525) + 1013904223) >>> 0;
// Log entries added since a sequence number. The log keeps only its tail.
const since = (s, seq) => s.log.filter((e) => e.seq > seq);
const act = (s, action) => {
  const result = play(s, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};

describe("XP and levels in the card core", () => {
  it("needs more XP for each level than the one before", () => {
    expect(levelForXp(0, 60)).toBe(1);
    expect(levelForXp(59, 60)).toBe(1);
    expect(levelForXp(60, 60)).toBe(2);
    expect(levelForXp(179, 60)).toBe(2);
    expect(levelForXp(180, 60)).toBe(3);
    let last = 0;
    for (let level = 2; level < 30; level++) {
      const from = (60 * (level - 2) * (level - 1)) / 2;
      const to = (60 * (level - 1) * level) / 2;
      expect(levelForXp(to, 60)).toBe(level);
      expect(to - from).toBeGreaterThan(last);
      last = to - from;
    }
  });

  it("adds each quest's fixed XP once, and never takes XP away", () => {
    let s = createWorld(shore);
    s = join(s, { id: "ash", name: "Ash", place: "pond" }).state;
    const players = ["vale", "ash"];
    let x = 7;
    const worth = {};
    let checked = 0;
    const xp = Object.fromEntries(Object.keys(s.avatars).map((id) => [id, 0]));
    for (let t = 0; t < 400; t++) {
      for (const [id, a] of Object.entries(s.avatars))
        if (a.progress.current) worth[id] = a.progress.current;
      x = next(x);
      const p = players[x % 2];
      // Wander and fight as well as plan, so losses never touch XP.
      const acts = legalActions(s, p);
      const before = s.eventSeq;
      s = act(
        s,
        (x >>> 8) % 3 ? plan(s, p).action : acts[(x >>> 12) % acts.length],
      );
      for (const e of since(s, before)) {
        if (e.kind !== "quest" || !e.complete) continue;
        const quest = worth[e.actorId];
        expect(e.questId).toBe(quest.id);
        expect(e.xp - xp[e.actorId]).toBe(quest.xp);
        expect(e.text).toContain(` ${quest.xp} XP.`);
        expect(e.text.includes(" Level ")).toBe(
          levelForXp(e.xp, s.rules.xpPerLevel) >
            levelForXp(xp[e.actorId], s.rules.xpPerLevel),
        );
        xp[e.actorId] = e.xp;
        checked += 1;
      }
      for (const [id, a] of Object.entries(s.avatars)) {
        expect(a.progress.xp).toBeGreaterThanOrEqual(xp[id]);
        xp[id] = a.progress.xp;
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(Math.min(...Object.values(xp))).toBeGreaterThan(0);
  }, 60_000);

  it("levels the shore slowly, with bigger quests at higher levels", () => {
    let s = createWorld(shore);
    const gained = [];
    const last = {};
    const reached = [];
    for (let i = 0; i < 600; i++) {
      const before = s.eventSeq;
      s = act(s, plan(s, "vale").action);
      for (const e of since(s, before))
        if (e.kind === "quest" && e.complete) {
          const prev = last[e.actorId] ?? 0;
          gained.push({ level: levelForXp(prev, 60), xp: e.xp - prev });
          last[e.actorId] = e.xp;
        }
      reached.push(levelOf(s, "vale"));
    }
    const vale = levelOf(s, "vale");
    expect(vale).toBeGreaterThanOrEqual(7);
    expect(vale).toBeLessThanOrEqual(15);
    for (const id of Object.keys(s.avatars))
      expect(levelOf(s, id)).toBeLessThanOrEqual(20);
    // The second 300 plays gain fewer levels than the first.
    expect(reached[599] - reached[299]).toBeLessThan(reached[299]);
    const mean = (list) =>
      list.reduce((sum, g) => sum + g.xp, 0) / Math.max(1, list.length);
    const low = gained.filter((g) => g.level <= 3);
    const high = gained.filter((g) => g.level >= 6);
    expect(high.length).toBeGreaterThan(5);
    expect(mean(high)).toBeGreaterThan(mean(low));
  }, 60_000);
});
