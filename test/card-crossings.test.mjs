import { test } from "vitest";
import assert from "node:assert/strict";
import {
  createWorld,
  legalActions,
  play,
  exits,
  encodeSave,
  decodeSave,
  validateWorld,
  greekShipPresent,
  clearingReturnOpen,
  clockRinging,
  placeText,
} from "../v2/card-game/world.mjs";
import {
  availableCards,
  cardChoices,
  cardPlay,
  playLabel,
} from "../v2/card-game/cards.mjs";
import {
  currentScene,
  locationOverlay,
  locationVariant,
  backdrop,
} from "../v2/card-game/scene.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";

function clearing() {
  const s = createWorld();
  s.actors.vale.place = "clearing";
  s.steamClock.discovered = true;
  s.items.bell.holder = "clearing";
  return s;
}
function pond() {
  const s = createWorld();
  s.actors.vale.place = "pond";
  s.items.lamp.holder = "vale";
  s.items.lamp.lit = true;
  s.items.lamp.fuel = 12;
  s.items.cloth.holder = "vale";
  let next = s;
  for (let i = 0; i < 2; i++) {
    next = act(next, "cover", "lamp", "cloth");
    next = act(next, "take", null, "cloth");
  }
  return next;
}
function act(s, kind, target, item) {
  const a = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      (target === undefined || a.target === target) &&
      (item === undefined || a.item === item),
  );
  assert(a, `Missing ${kind} ${target ?? ""}`);
  const r = play(s, a);
  assert(r.ok, r.error);
  return r.state;
}
function ringClock(s) {
  return act(s, "ring", "clearing", null);
}

test("remembering the clearing never creates a silent return exit", () => {
  const s = clearing();
  assert.equal(clearingReturnOpen(s), false);
  assert(!exits(s, "clearing", "vale").includes("pond"));
  assert(!availableCards(s).includes("pond"));
  assert.equal(cardPlay(s, ["pond"]).action, null);
  assert.match(placeText(s, "clearing"), /Moss lies between its roots/);
});
test("a hand bell sounding at either end opens the return crossing", () => {
  for (const holder of ["vale", "clearing", "pond"]) {
    const s = clearing();
    s.items.bell.holder = holder;
    s.items.bell.ringing = 2;
    assert(clearingReturnOpen(s));
    assert(availableCards(s).includes("pond"));
  }
});
test("a distant or muffled bell cannot expose the return card", () => {
  const s = clearing();
  s.items.bell.ringing = 2;
  s.items.bell.holder = "station";
  assert(!clearingReturnOpen(s));
  s.items.bell.holder = "clearing";
  s.items.cloth.holder = "bell";
  assert(!clearingReturnOpen(s));
});
test("the clock bell is a reachable local recovery without the hand bell", () => {
  let s = clearing();
  s.items.bell.holder = "station";
  const a = cardChoices(s, "clearing").find((a) => a.kind === "ring");
  assert(a);
  assert.equal(playLabel(a), "Ring the Steam Clock");
  s = ringClock(s);
  assert(clockRinging(s));
  assert(availableCards(s).includes("pond"));
  assert.equal(s.items.bell.ringing, 0);
  assert.equal(s.actors.badger.awake, true);
});
test("clock ringing expires after three following plays", () => {
  let s = ringClock(clearing());
  const stale = legalActions(s).find(
    (a) => a.kind === "move" && a.target === "pond",
  );
  s = act(s, "wait");
  assert(clockRinging(s));
  s = act(s, "wait");
  assert(clockRinging(s));
  s = act(s, "wait");
  assert(!clockRinging(s));
  assert(!availableCards(s).includes("pond"));
  const before = encodeSave(s);
  assert.equal(play(s, stale).ok, false);
  assert.equal(encodeSave(s), before);
});
test("ringing the clock again refreshes the window", () => {
  let s = ringClock(clearing());
  s = act(s, "wait");
  s = ringClock(s);
  assert.equal(s.steamClock.returnRingingUntil, s.turn + 3);
  assert(availableCards(s).includes("pond"));
});
test("the clock does not freeze or refresh the separate hand bell", () => {
  let s = clearing();
  s.items.bell.ringing = 2;
  s = ringClock(s);
  assert.equal(s.items.bell.ringing, 1);
  assert.equal(s.steamClock.returnRingingUntil, s.turn + 3);
});
test("active and silent crossings retain their exact state after reload", () => {
  let s = ringClock(clearing());
  s = act(s, "wait");
  const loaded = decodeSave(encodeSave(s));
  assert.equal(
    loaded.steamClock.returnRingingUntil,
    s.steamClock.returnRingingUntil,
  );
  assert(clearingReturnOpen(loaded));
  s = act(loaded, "wait");
  s = act(s, "wait");
  assert(!clearingReturnOpen(decodeSave(encodeSave(s))));
});
test("legacy saves gain a silent clock without resetting residents or history", () => {
  const s = clearing();
  delete s.steamClock.returnRingingUntil;
  const loaded = decodeSave(JSON.stringify(s));
  assert.equal(loaded.steamClock.returnRingingUntil, 0);
  assert.deepEqual(loaded.items, s.items);
  assert.deepEqual(loaded.actors, s.actors);
  assert.deepEqual(loaded.packs, s.packs);
  assert.deepEqual(loaded.log, s.log);
  assert(!availableCards(loaded).includes("pond"));
});
test("invalid clock deadlines fail save validation", () => {
  for (const value of [-1, 4, 1.5, "3", null]) {
    const s = clearing();
    s.steamClock.returnRingingUntil = value;
    assert.throws(() => validateWorld(s));
  }
});
test("the ship requires a lit fueled uncovered lamp physically at the pond", () => {
  const base = pond();
  assert(greekShipPresent(base));
  for (const change of [
    (s) => (s.items.lamp.lit = false),
    (s) => (s.items.lamp.fuel = 0),
    (s) => (s.items.cloth.holder = "lamp"),
    (s) => (s.items.lamp.holder = "attic"),
    (s) => {
      s.items.lamp.holder = "keeper";
      s.actors.keeper.place = "station";
    },
  ]) {
    const s = structuredClone(base);
    change(s);
    assert(!greekShipPresent(s));
    assert(!availableCards(s).includes("greek-harbor"));
  }
});
test("lamp custody by another resident still follows their real location", () => {
  const s = pond();
  s.items.lamp.holder = "moth";
  assert(greekShipPresent(s));
  s.actors.moth.place = "station";
  assert(!greekShipPresent(s));
});
test("audible bells remove the ship; distant bells do not", () => {
  for (const holder of ["pond", "clearing"]) {
    const s = pond();
    s.items.bell.holder = holder;
    s.items.bell.ringing = 2;
    assert(!greekShipPresent(s));
  }
  const s = pond();
  s.items.bell.holder = "station";
  s.items.bell.ringing = 2;
  assert(greekShipPresent(s));
  s.steamClock.discovered = true;
  s.steamClock.returnRingingUntil = s.turn + 2;
  assert(!greekShipPresent(s));
});
test("ship scene variant, overlay and travel card always agree", () => {
  for (const lit of [true, false])
    for (const fuel of [0, 8])
      for (const lampHere of [true, false])
        for (const ringing of [0, 2])
          for (const covered of [true, false]) {
            const s = pond();
            s.items.lamp.lit = lit;
            s.items.lamp.fuel = fuel;
            s.items.lamp.holder = lampHere ? "vale" : "station";
            s.items.bell.holder = "pond";
            s.items.bell.ringing = ringing;
            if (covered) s.items.cloth.holder = "lamp";
            const visible = greekShipPresent(s);
            assert.equal(availableCards(s).includes("greek-harbor"), visible);
            assert.equal(locationVariant(s, "pond") === "greek-ship", visible);
            assert.equal(Boolean(locationOverlay(s, "pond")), visible);
            assert.equal(currentScene(s).variant === "greek-ship", visible);
            assert.equal(currentScene(s).background, backdrop("pond"));
          }
});
test("ship variant never leaks into another location", () => {
  const s = pond();
  for (const id of ["station", "attic", "clearing", "greek-harbor"]) {
    assert.equal(locationVariant(s, id), "base");
    assert.equal(locationOverlay(s, id), null);
  }
});
test("a previously selected ship offer cannot bypass extinguished light", () => {
  const s = pond();
  const a = legalActions(s).find(
    (a) => a.kind === "move" && a.target === "greek-harbor",
  );
  assert.equal(playLabel(a), "Board the Greek ship");
  s.items.lamp.lit = false;
  assert.equal(play(s, a).ok, false);
});
test("return from Greece remains available without the entry lamp", () => {
  let s = pond();
  s = act(s, "move", "greek-harbor", null);
  s.items.lamp.lit = false;
  assert(exits(s, "greek-harbor", "vale").includes("pond"));
  s = act(s, "move", "pond", null);
  assert.equal(s.actors.vale.place, "pond");
  assert(!greekShipPresent(s));
});
test("inspection cannot advance a bell window or reroll the ship", () => {
  const s = ringClock(clearing());
  const before = encodeSave(s);
  for (let i = 0; i < 12; i++) {
    availableCards(s);
    cardChoices(s, "clearing");
    currentScene(s);
    locationVariant(s, "pond");
    narrativeContext(s);
  }
  assert.equal(encodeSave(s), before);
});
test("narration is given the same current crossing facts as the cards", () => {
  for (const s of [clearing(), ringClock(clearing()), pond()]) {
    const context = narrativeContext(s);
    const local = context.entities.find((e) => e.id === s.actors.vale.place);
    assert(local);
    const facts = local.facts.join(" ");
    if (s.actors.vale.place === "pond") assert.match(facts, /Greek ship/);
    else if (clearingReturnOpen(s))
      assert.match(facts, /opens onto Black pond/);
    else assert.match(facts, /Moss lies between its roots/);
  }
});
