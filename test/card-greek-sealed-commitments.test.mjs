import { describe, expect, it } from "vitest";
import { availableCards } from "../v2/card-game/cards.mjs";
import { isLockedBox } from "../v2/card-game/locked-box.mjs";
import { sealedWays } from "../v2/card-game/world/geography.mjs";
import { decodeSave, encodeSave, legalActions } from "../v2/card-game/world.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";

const STALL = "greek-acharnae-stall";
const SEAL = "greek-story-aristophanes-acharnians-object";
const DICAEOPOLIS = "greek-story-aristophanes-acharnians-first";
const MEGARIAN = "greek-story-aristophanes-acharnians-second";
const CROSSROADS = "greek-argolid-road";
const ALTAR = "greek-argos-sanctuary";
const JURY = "greek-argive-jury";
const ATREID_ROUTES = [
  ["greek-argos-tomb", "ismene", "sanctuary", CROSSROADS],
  ["greek-mycenae-palace", "creon", "palace", JURY],
  ["greek-argive-farm", "baker", "courtyard", JURY],
];

function expectOffer(world, id, mode) {
  expect(availableCards(world).includes(id), id).toBe(mode !== "gone");
  expect(isLockedBox(world, id), id).toBe(mode === "shut");
  expect(sealedWays(world).some((route) => route.to === id), id).toBe(mode === "shut");
  expect(legalActions(world).some((action) => action.kind === "move" && action.target === id), id)
    .toBe(mode === "passable");
}

describe("sealed Greek ways after a commitment", () => {
  it("removes the market stall's abandoned lock after a private sale", () => {
    const market = traveler(greekStart())
      .move("well").take("water-jar")
      .move("courtyard").waitFor("baker").give("water-jar", "baker").take("bread")
      .move("gate").waitFor("guard").trade("bread", "guard", "decree")
      .move("palace").waitFor("creon").trade("decree", "creon", "creon-writ")
      .move("gate").waitFor("guard").give("creon-writ", "guard")
      .move("battlefield", "cithaeron", "eleusis", "attic-farm", "acharnae");
    expectOffer(market.s, STALL, "shut");

    market.talk(DICAEOPOLIS).take(SEAL);
    const publicSale = traveler(structuredClone(market.s)).give(SEAL, MEGARIAN);
    expectOffer(publicSale.s, STALL, "passable");
    publicSale.act("move", { target: STALL }).act("move", { target: "greek-acharnae" });

    market.give(SEAL, DICAEOPOLIS);
    expectOffer(market.s, STALL, "gone");
    expectOffer(decodeSave(encodeSave(market.s)), STALL, "gone");
  });

  it("keeps the shoreline walk to Corinth and Troezen open before any settlement", () => {
    const t = traveler(greekStart()).move("harbor", CROSSROADS);
    for (const target of [
      ALTAR,
      "greek-corinth",
      "greek-troezen",
      "greek-corinth",
      ALTAR,
      CROSSROADS,
    ])
      t.act("move", { target });
    expect(
      t.s.packs["greek-drama"].choices["greek-atreid-account"],
    ).toBeUndefined();
  });

  it.each(ATREID_ROUTES)(
    "retains only the chosen road to %s",
    (destination, keeper, home, origin) => {
      const road = traveler(greekStart()).move("harbor", CROSSROADS);
      const shutYard = road.fork().move(ALTAR, JURY).s;
      for (const [id, , , from] of ATREID_ROUTES)
        expectOffer(from === CROSSROADS ? road.s : shutYard, id, "shut");

      road
        .take("atreid-record")
        .move(home)
        .waitFor(keeper)
        .give("atreid-record", keeper)
        .move(CROSSROADS);
      const settledYard = road.fork().move(ALTAR, JURY).s;
      for (const [id, , , from] of ATREID_ROUTES)
        expectOffer(
          from === CROSSROADS ? road.s : settledYard,
          id,
          id === destination ? "passable" : "gone",
        );
      road
        .move(origin)
        .act("move", { target: destination })
        .act("move", { target: origin });
    },
  );
});
