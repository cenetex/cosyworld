import "./helpers/still-cast.mjs";
import { describe, expect, it } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";

function scene() {
  const s = createWorld({ packScopes: { "greek-drama": "full" } });
  s.packs["greek-drama"].met["greek-creon"] = 0;
  s.actors.vale.place = s.actors["greek-creon"].place = "greek-palace";
  for (const item of Object.values(s.items))
    if (["vale", "greek-creon"].includes(item.holder))
      item.holder = "greek-palace";
  s.items["greek-creon-writ"].holder = "vale";
  s.items["greek-decree"].holder = "greek-creon";
  return s;
}

describe("card names in action sentences", () => {
  it("does not stack articles or possessives in the screenshot trade", () => {
    const s = scene();
    const trade = legalActions(s).find(a =>
      a.kind === "trade" && a.item === "greek-creon-writ" &&
      a.receive === "greek-decree");
    expect(trade.text).toBe(
      "Vale trades Creon's Writ for the Burial Decree with Creon.");
    const result = play(s, trade);
    expect(result.ok).toBe(true);
    // Creon wants his decree: refusal must keep custody and use offer wording.
    const event = result.state.log.find(e =>
      e.actorId === "vale" && e.verb === "trade");
    expect(event.text).toBe(
      "Vale offers Creon's Writ for the Burial Decree with Creon. Creon declines.");
    expect(result.state.items["greek-creon-writ"].holder).toBe("vale");
    expect(result.state.items["greek-decree"].holder).toBe("greek-creon");
  });

  it("uses the same noun phrase for asking, giving, taking and putting down", () => {
    const s = scene();
    let actions = legalActions(s);
    expect(actions.find(a => a.kind === "ask" && a.item === "greek-decree").text)
      .toBe("Vale asks Creon for the Burial Decree.");
    expect(actions.find(a => a.kind === "give" && a.item === "greek-creon-writ" && a.target === "greek-creon").text)
      .toBe("Vale gives Creon's Writ to Creon.");
    expect(actions.find(a => a.kind === "drop" && a.item === "greek-creon-writ").text)
      .toBe("Vale puts Creon's Writ in Theban Palace Forecourt.");
    s.items["greek-creon-writ"].holder = "greek-palace";
    actions = legalActions(s);
    expect(actions.find(a => a.kind === "take" && a.item === "greek-creon-writ").text)
      .toBe("Vale takes Creon's Writ.");
  });
});
