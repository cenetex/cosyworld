import { describe, it, expect } from "vitest";
import { setImmediate as yieldToRunner } from "node:timers/promises";
import {
  createWorld,
  expects,
  legalActions,
  plan,
  play,
} from "../v2/card-game/world.mjs";
import { newWant } from "../v2/card-game/want.mjs";

// The resident cast and the traveller who learns the roads.
const cast = ["moth", "keeper", "greek-rhapsode"];
// Every resident meets a want at least this often in loose play.
const WINDOW = 80;
const TURNS = 400;

function longestGaps(seed, opening = false) {
  let x = (seed * 2654435761) >>> 0,
    s = createWorld({ opening });
  const last = Object.fromEntries(cast.map((id) => [id, 0]));
  const gaps = Object.fromEntries(cast.map((id) => [id, 0]));
  return (async () => {
    for (let i = 0; i < TURNS; i++) {
      if (i % 100 === 0) await yieldToRunner();
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      const acts = legalActions(s);
      s = play(s, acts[x % acts.length]).state;
      for (const e of s.log)
        if (
          e.verb === "want_met" &&
          e.turn === s.turn &&
          cast.includes(e.actorId)
        ) {
          gaps[e.actorId] = Math.max(gaps[e.actorId], s.turn - last[e.actorId]);
          last[e.actorId] = s.turn;
        }
    }
    for (const id of cast) gaps[id] = Math.max(gaps[id], TURNS - last[id]);
    return gaps;
  })();
}

describe("the table stays alive", () => {
  it("lets every resident meet a want in each window of loose play", async () => {
    const report = {};
    for (let seed = 1; seed <= 10; seed++) {
      const gaps = await longestGaps(seed);
      report[seed] = gaps;
      for (const id of cast)
        expect(gaps[id], `seed ${seed} ${id}`).toBeLessThanOrEqual(WINDOW);
    }
    expect(Object.keys(report)).toHaveLength(10);
  }, 120_000);

  it("keeps a resident pursuing its want when the player waits", () => {
    let s = createWorld();
    s.actors.moth.place = "station";
    s.items.lamp.holder = "pond";
    s.actors.moth.want = newWant("item", "lamp", 0);
    expect(plan(s, "moth").action).toMatchObject({
      kind: "move",
      target: "pond",
    });
    for (let i = 0; i < 6 && s.items.lamp.holder !== "moth"; i++)
      s = play(
        s,
        legalActions(s).find((a) => a.kind === "wait"),
      ).state;
    expect(s.items.lamp.holder).toBe("moth");
  });

  it("asks before it trades, and trades its least valued spare", () => {
    const s = createWorld();
    s.actors.moth.place = "station";
    s.actors.keeper.place = "station";
    s.items.oil.holder = "keeper";
    s.items.bell.holder = "moth";
    s.items.cloth.holder = "moth";
    s.actors.moth.want = newWant("item", "oil", 0);
    expect(plan(s, "moth").action).toMatchObject({ kind: "ask", item: "oil" });
    s.log.push({
      ...s.log.at(-1),
      seq: s.eventSeq + 1,
      kind: "action",
      verb: "ask",
      actorId: "moth",
      targetId: "keeper",
      itemId: "oil",
      accepted: false,
    });
    s.eventSeq += 1;
    const trade = plan(s, "moth").action;
    expect(trade).toMatchObject({ kind: "trade", receive: "oil" });
    // Pip values the bell least, so it is the spare on offer.
    expect(trade.item).toBe("bell");
  });

  it("keeps whole worlds moving with offers the other side would refuse", async () => {
    let s = createWorld(),
      x = 7;
    let met = 0;
    for (let i = 0; i < 200; i++) {
      if (i % 100 === 0) await yieldToRunner();
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      const acts = legalActions(s).filter(
        (a) => !expects(s, a) || a.kind !== "wait",
      );
      s = play(s, acts[x % acts.length]).state;
      met += s.log.filter(
        (e) => e.verb === "want_met" && e.turn === s.turn,
      ).length;
    }
    expect(met).toBeGreaterThan(10);
  }, 60_000);
});
