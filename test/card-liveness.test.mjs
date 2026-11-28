import "./helpers/no-dwell.mjs";
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
import { seeded } from "./helpers/play.mjs";
import { transports } from "../v2/card-game/pack-registry.mjs";

const ships = Object.values(transports).map((ship) => ship.place);

describe("the table stays alive", () => {
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
    let s = createWorld();
    const rng = seeded(7);
    let met = 0;
    for (let i = 0; i < 200; i++) {
      if (i % 100 === 0) await yieldToRunner();
      const acts = legalActions(s).filter(
        (a) => !expects(s, a) || a.kind !== "wait",
      );
      s = play(s, acts[rng(acts.length)]).state;
      met += s.log.filter(
        (e) => e.verb === "want_met" && e.turn === s.turn,
      ).length;
    }
    expect(met).toBeGreaterThan(10);
  }, 60_000);
});
