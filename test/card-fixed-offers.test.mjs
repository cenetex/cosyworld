import { describe, expect, it } from "vitest";
import {
  createWorld,
  canTrade,
  decodeSave,
  encodeSave,
  expects,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";

// Vale holds the cloth and the lamp; the keeper holds the bell at the station.
function table() {
  const s = createWorld();
  s.actors.keeper.place = "station";
  s.items.cloth.holder = "vale";
  s.items.lamp.holder = "vale";
  s.items.bell.holder = "keeper";
  return s;
}
// Pip, who cares nothing for the bell, is here while Vale holds it.
function bellForPip() {
  const s = createWorld();
  s.actors.moth.place = "station";
  s.items.bell.holder = "vale";
  return s;
}
const find = (s, kind, item, extra = {}) =>
  legalActions(s).find(
    (a) =>
      a.kind === kind &&
      a.item === item &&
      Object.entries(extra).every(([k, v]) => a[k] === v),
  );
const facts = (s, id, action) =>
  narrativeContext(s, action)
    .entities.find((e) => e.id === id)
    .facts.join(" ");

describe("Give and Trade are always offered", () => {
  it("offers Give and Trade whether or not the other side would agree", () => {
    const s = table();
    for (const item of ["cloth", "lamp"]) {
      const give = find(s, "give", item, { target: "keeper" });
      expect(give, `give ${item}`).toBeDefined();
      const trade = find(s, "trade", item, { receive: "bell" });
      expect(trade, `trade ${item}`).toBeDefined();
    }
    // Some of these offers would be refused, and they are still shown.
    expect(
      legalActions(s).some(
        (a) => ["give", "trade"].includes(a.kind) && !expects(s, a),
      ),
    ).toBe(true);
  });

  it("commits an accepted trade", () => {
    let s = enableMotives(createWorld());
    s.actors.keeper.place = "station";
    s.items.lamp.holder = "vale";
    s.items.bell.holder = "vale";
    s.items.cloth.holder = "keeper";
    s.items.oil.holder = "keeper";
    const trade = legalActions(s).find(
      (a) => a.kind === "trade" && canTrade(s, "vale", a.item, a.receive),
    );
    expect(trade).toBeDefined();
    expect(expects(s, trade)).toBe(true);
    s = play(s, trade).state;
    expect(s.items[trade.item].holder).toBe("keeper");
    expect(s.items[trade.receive].holder).toBe("vale");
    const entry = s.log.findLast((e) => e.verb === "trade");
    expect(entry.accepted).toBe(true);
    expect(entry.reason).toBeUndefined();
  });

  it("records a refusal with its reason, costs a turn and moves nothing", () => {
    const s = bellForPip();
    const give = find(s, "give", "bell", { target: "moth" });
    expect(expects(s, give)).toBe(false);
    const result = play(s, give);
    expect(result.ok).toBe(true);
    const next = result.state;
    expect(next.turn).toBe(s.turn + 1);
    expect(next.revision).toBe(s.revision + 1);
    expect(next.items.bell.holder).toBe("vale");
    const entry = next.log.findLast((e) => e.verb === "give");
    expect(entry).toMatchObject({
      accepted: false,
      reason: "wants-something-else",
      itemId: "bell",
      targetId: "moth",
    });
    expect(entry.text).toContain("declines");
    expect(decodeSave(encodeSave(next))).toEqual(next);
    // The cast hears the reason so they can say it in dialogue.
    expect(facts(next, "moth", give)).toContain(
      "refused Vale's offer of Bell (refusal: wants-something-else)",
    );
  });

  it("names a grudge when the other side is still annoyed", () => {
    const s = enableMotives(table());
    s.motives.grievances.keeper.push({
      other: "vale",
      kind: "threat",
      reason: "Vale picked a fight.",
      turn: s.turn,
      weight: 3,
    });
    const trade = find(s, "trade", "lamp", { receive: "bell" });
    expect(expects(s, trade)).toBe(false);
    const next = play(s, trade).state;
    expect(next.items.bell.holder).toBe("keeper");
    expect(next.items.lamp.holder).toBe("vale");
    expect(next.log.findLast((e) => e.verb === "trade")).toMatchObject({
      accepted: false,
      reason: "grudge",
    });
    expect(facts(next, "keeper", trade)).toContain("(refusal: grudge)");
  });

  it("commits a code when an ask is refused and briefs it, without canned text", () => {
    const s = enableMotives(table());
    const ask = find(s, "ask", "bell", { target: "keeper" });
    expect(ask).toBeDefined();
    const next = play(s, ask).state;
    expect(next.items.bell.holder).toBe("keeper");
    const entry = next.log.findLast((e) => e.verb === "ask");
    expect(entry).toMatchObject({ accepted: false, reason: "needs-it" });
    expect(entry.text).toMatch(/keeps it for now\.$/);
    expect(decodeSave(encodeSave(next))).toEqual(next);
    expect(facts(next, "keeper", ask)).toContain(
      "refused Vale's request for Bell (refusal: needs-it)",
    );
  });

  it("rejects a refusal reason on any other verb or an accepted play", () => {
    const s = bellForPip();
    const next = play(s, find(s, "give", "bell", { target: "moth" })).state;
    const entry = next.log.findLast((e) => e.verb === "give");
    for (const broken of [
      { ...entry, reason: "bored" },
      { ...entry, accepted: true },
      { ...entry, verb: "talk" },
    ]) {
      const copy = structuredClone(next);
      copy.log[copy.log.indexOf(copy.log.findLast((e) => e.verb === "give"))] =
        broken;
      expect(() => decodeSave(encodeSave(copy))).toThrow();
    }
  });

  it("lets a resident offer trades for its want, some of them refused", () => {
    let s = enableMotives(createWorld());
    for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
    s.items.oil.holder = "keeper";
    s.items.bell.holder = "moth";
    s.items.cloth.holder = "moth";
    s.actors.moth.want = { kind: "item", target: "oil", since: 0, refusals: 0 };
    s.actors.keeper.want = null;
    for (let turn = 0; turn < 12; turn++)
      s = play(s, legalActions(s).find((a) => a.kind === "wait")).state;
    const offers = s.log.filter((e) => e.verb === "trade" && e.actorId === "moth");
    expect(offers.length).toBeGreaterThan(0);
    // An offer the keeper would refuse still costs Pip's turn and counts
    // against its want.
    expect(offers.every((e) => typeof e.accepted === "boolean")).toBe(true);
  });
});
