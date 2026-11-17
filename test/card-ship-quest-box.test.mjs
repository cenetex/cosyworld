import { expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import {
  boxOffer,
  boxesAt,
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  holdChoice,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { availableCards, lockWords } from "../v2/card-game/cards.mjs";
import { offerCard, questCaption } from "../v2/card-game/quest-card.mjs";
import { heldOf } from "../v2/card-game/want.mjs";
import {
  crossings,
  packGroup,
  transports,
} from "../v2/card-game/pack-registry.mjs";

const call = crossings.find((c) => c.unlockWhen),
  SHIP = transports[call.transport].place,
  FROM = `quest:box:${SHIP}`,
  all = () => true;
const act = (s, kind, fields = {}) => {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, JSON.stringify({ kind, ...fields })).toBeTruthy();
  const done = play(s, action, s.revision);
  expect(done.ok, done.error).toBe(true);
  return decodeSave(encodeSave(done.state));
};
const hold = (s, item) => {
  holdChoice(s, "vale", { item, revision: s.revision });
  return decodeSave(encodeSave(s));
};
function atDock({ lamp = "vale", cloth = "vale" } = {}) {
  const s = createWorld();
  s.actors.vale.place = call.from;
  s.actors.vale.heldItem = null;
  s.actors.moth.place = "attic";
  s.actors.keeper.place = "attic";
  s.items.lamp.holder = lamp;
  s.items.cloth.holder = cloth;
  return decodeSave(encodeSave(s));
}
const sources = (s) => heldOf(s.actors.vale).map((w) => w.from);

it("shows an uncalled ship as a shut box at the near end of its crossing", () => {
  const s = atDock({ cloth: "attic" });
  expect(s.crossings[call.id].discovered).toBe(false);
  expect(availableCards(s)).toContain(SHIP);
  expect(exits(s, call.from, "vale")).not.toContain(SHIP);
  expect(
    boxesAt(s, call.from, "vale").find((box) => box.id === SHIP),
  ).toMatchObject({
    kind: "ship",
    open: false,
  });
  expect(lockWords(s, SHIP, all)).toBe(
    "Lay the lit Lamp in Black pond and hold Black cloth",
  );
  expect(lockWords(s, SHIP, (id) => id !== "cloth")).toBe(
    "Lay the lit Lamp in Black pond and find something",
  );
  for (const dock of transports[call.transport].docks.filter(
    (d) => d !== call.from,
  ))
    expect(boxesAt(s, dock, "vale").some((box) => box.id === SHIP)).toBe(false);
});

it("words only what is still unmet", () => {
  expect(lockWords(atDock({ lamp: call.from }), SHIP, all)).toBe(
    "Hold Black cloth",
  );
  const dark = atDock({ lamp: call.from });
  dark.items.lamp.lit = false;
  expect(lockWords(dark, SHIP, all)).toBe(
    "Lay the lit Lamp in Black pond and hold Black cloth",
  );
  const carried = hold(atDock(), "cloth");
  expect(lockWords(carried, SHIP, all)).toBe("Lay the lit Lamp in Black pond");
  const beside = atDock({ cloth: "moth" });
  beside.actors.moth.heldItem = "cloth";
  expect(lockWords(beside, SHIP, all)).toBe(
    "Lay the lit Lamp in Black pond and hold Black cloth",
  );
  beside.actors.moth.place = call.from;
  expect(lockWords(beside, SHIP, all)).toBe("Lay the lit Lamp in Black pond");
});

it("offers its quest by Accept, and doing what it says calls the ship", () => {
  let s = atDock();
  expect(questCaption(offerCard(s, "vale", SHIP))).toBe(
    "Lay the lit Lamp in Black pond",
  );
  s = act(s, "accept", { box: SHIP });
  expect(sources(s)).toEqual([FROM]);
  expect(boxOffer(s, SHIP)).toBeNull();
  s = act(s, "drop", { item: "lamp" });
  expect(sources(s)).toEqual([]);
  expect(s.crossings[call.id].discovered).toBe(false);
  expect(questCaption(offerCard(s, "vale", SHIP))).toBe("Hold Black cloth");
  s = act(s, "accept", { box: SHIP });
  s = hold(s, "cloth");
  expect(s.crossings[call.id].discovered).toBe(true);
  expect(s.transports[call.transport].dock).toBe(call.from);
  expect(sources(s)).toEqual([]);
  expect(s.opened[SHIP]).toEqual(["vale"]);
  expect(lockWords(s, SHIP, all)).toBeNull();
  expect(exits(s, call.from, "vale")).toContain(SHIP);
});

it("credits the box when the quest was never taken, and once only", () => {
  let s = hold(atDock(), "cloth");
  s = act(s, "drop", { item: "lamp" });
  expect(s.opened[SHIP]).toEqual(["vale"]);
  expect(boxOffer(s, SHIP)).toBeNull();
  s = act(s, "take", { item: "lamp" });
  expect(s.crossings[call.id].discovered).toBe(true);
  expect(lockWords(s, SHIP, all)).toBeNull();
});

it("shows no box while the ship's world is switched off", () => {
  const quiet = play(atDock(), {
    kind: "pack",
    pack: packGroup(call.packId),
    enable: false,
  }).state;
  expect(quiet.disabledPacks).toEqual([packGroup(call.packId)]);
  expect(boxesAt(quiet, call.from, "vale").some((box) => box.id === SHIP)).toBe(
    false,
  );
  expect(availableCards(quiet)).not.toContain(SHIP);
});
