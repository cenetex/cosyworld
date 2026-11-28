import { describe, expect, it } from "vitest";
import { packTalkChoice } from "../v2/card-game/pack-registry.mjs";
import { courseOptions } from "../v2/card-game/pack-transport.mjs";
import { decodeSave, encodeSave, exits } from "../v2/card-game/world.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";

const PACK = "greek-drama";
const COURTYARD = "greek-courtyard";
const DIONE = "greek-baker";
const WHEAT = "greek-wheat";
const WATER = "greek-water-jar";
const BREAD = "greek-bread";
const PROVISIONS = "greek-provisions";
const SHIP = "greek-ship";
const PIRAEUS = "greek-piraeus";
const RECOVER = "greek-dione-recover-wheat";

const recovery = (s) =>
  packTalkChoice(s, { actor: "vale", target: DIONE })?.choiceId === RECOVER;
const bake = (t) =>
  t.move("well").take(WATER).move(COURTYARD)
    .waitFor(DIONE).give(WATER, DIONE)
    .take(BREAD);

function packCargo(t) {
  t.move("gate").take("wine-skin").move(COURTYARD, "harbor");
  t.waitFor("shipmaster").give(BREAD, "shipmaster");
  t.waitFor("shipmaster").give("wine-skin", "shipmaster");
  t.move("well", "palace", "sanctuary").take("figs").move("harbor");
  return t.waitFor("shipmaster").give("figs", "shipmaster").take(PROVISIONS);
}

describe("Dione's wheat recovery", () => {
  it("brings back loose wheat after the first loaf is eaten and bakes with returned water", () => {
    const t = traveler(greekStart());
    expect(recovery(t.s)).toBe(false);
    bake(t);
    expect(recovery(t.s)).toBe(false);
    t.act("eat", { item: BREAD, target: null });
    expect(t.s.items[WHEAT].holder).toBe(PIRAEUS);
    expect(t.s.usedUp).toContain(BREAD);

    const held = structuredClone(t.s);
    held.items[WHEAT].holder = "greek-elder";
    expect(recovery(held)).toBe(false);

    t.waitFor(DIONE);
    expect(recovery(t.s)).toBe(true);
    t.act("talk", { target: DIONE });
    t.s = decodeSave(encodeSave(t.s));
    const firstRecovery = t.s.packs[PACK].receipts[RECOVER];
    expect(t.s.items[WHEAT].holder).toBe(COURTYARD);
    expect(t.s.usedUp).toContain(BREAD);
    expect(recovery(t.s)).toBe(false);

    bake(t);
    expect(t.s.log.findLast(({ verb }) => verb === "craft")).toMatchObject({
      itemId: BREAD,
      consumedIds: [WATER, WHEAT],
    });
    expect(t.s.items[WHEAT].holder).toBe(PIRAEUS);
    t.act("eat", { item: BREAD, target: null });
    t.waitFor(DIONE);
    expect(recovery(t.s)).toBe(true);
    t.act("talk", { target: DIONE });
    t.s = decodeSave(encodeSave(t.s));
    expect(t.s.packs[PACK].receipts[RECOVER]).toBeGreaterThan(firstRecovery);
    expect(t.s.items[WHEAT].holder).toBe(COURTYARD);
    bake(t);
    t.move("gate").trade(BREAD, "guard", "decree");
    t.move("palace").trade("decree", "creon", "creon-writ");
    t.move("gate").waitFor("guard").give("creon-writ", "guard");
    expect(exits(t.s, "greek-gate", "vale")).toContain("greek-battlefield");
    t.move(COURTYARD);
    expect(recovery(t.s)).toBe(false);
  });

  it("can sail after using the first provision load for Helen's beach passage", () => {
    const t = traveler(greekStart()).move("harbor").take("helen-accounts");
    t.move("well").waitFor("elder").give("helen-accounts", "elder");
    packCargo(bake(t)).move(COURTYARD);
    expect(recovery(t.s)).toBe(false);
    t.move("harbor", "troy-beach").waitFor("helen-troy").talk("helen-troy");
    t.take("troy-testimony").waitFor("menelaus-troy");
    t.give("troy-testimony", "menelaus-troy");
    t.s = decodeSave(encodeSave(t.s));

    expect(t.s.packs[PACK].choices["greek-helen-response"]).toBe("passage");
    expect(t.s.usedUp).toContain(PROVISIONS);
    expect(t.s.items[WHEAT].holder).toBe(PIRAEUS);
    expect(exits(t.s, "greek-gate", "vale")).not.toContain("greek-battlefield");
    t.move("harbor", COURTYARD).waitFor(DIONE);
    expect(recovery(t.s)).toBe(true);
    t.act("talk", { target: DIONE });
    packCargo(bake(t));
    expect(t.s.log.findLast(({ verb }) => verb === "craft")).toMatchObject({
      itemId: PROVISIONS,
      consumedIds: [BREAD, "greek-figs", "greek-wine-skin"],
    });

    t.move(SHIP);
    expect(courseOptions(t.s, SHIP, "vale")).not.toContain(PIRAEUS);
    t.drop(PROVISIONS).act("course", { target: PIRAEUS }).act("wait");
    t.act("move", { target: PIRAEUS });
    expect(t.s.actors.vale.place).toBe(PIRAEUS);
    expect(t.s.packs[PACK].choices["greek-helen-response"]).toBe("passage");
  });
});
