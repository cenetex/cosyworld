import { crossings } from "../v2/card-game/pack-registry.mjs";
import { crossingOpen } from "../v2/card-game/pack-rules.mjs";
import { senses } from "../v2/card-game/world.mjs";
const gate = (id) => crossings.find((c) => c.id === id);
const greekShipPresent = (s) =>
  crossingOpen(s, gate("pond-greek-harbor"), senses);
const clearingReturnOpen = (s) =>
  crossingOpen(s, gate("clearing-pond"), senses);
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  createWorld,
  legalActions,
  play,
  exits,
  encodeSave,
  currentActor,
} from "../v2/card-game/world.mjs";
import { needsVoyage, sailTo } from "./helpers/voyage.mjs";
import {
  availableCards,
  cardChoices,
  playLabel,
} from "../v2/card-game/cards.mjs";
import {
  currentScene,
  locationOverlay,
  locationVariant,
  backdrop,
} from "../v2/card-game/scene.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { endStandoff } from "./helpers/standoff.mjs";

function clearing() {
  const s = createWorld();
  s.actors.vale.place = "clearing";
  s.crossings["pond-clearing"].discovered = true;
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
  // Cover, then uncover, the lit lamp: the whole ship signal. Pip's threat
  // over the lamp is talked down, so the room is not locked.
  return endStandoff(
    act(act(s, "cover", "lamp", "cloth"), "take", null, "cloth"),
  );
}
function act(s, kind, target, item) {
  s = endStandoff(s);
  if (kind === "move" && item === null && needsVoyage(s, currentActor(s), target))
    return sailTo(s, target);
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

test("the arrived ship stays available across lamp states", () => {
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
    assert(greekShipPresent(s));
    assert(availableCards(s).includes("greek-ship"));
  }
});
test("the arrived ship stays at its dock when the lamp changes hands", () => {
  const s = pond();
  s.items.lamp.holder = "moth";
  assert(greekShipPresent(s));
  s.actors.moth.place = "station";
  assert(greekShipPresent(s));
});
test("the arrived ship stays through nearby and distant bells", () => {
  for (const holder of ["pond", "clearing"]) {
    const s = pond();
    s.items.bell.holder = holder;
    s.items.bell.ringing = 2;
    assert(greekShipPresent(s));
  }
  const s = pond();
  s.items.bell.holder = "station";
  s.items.bell.ringing = 2;
  assert(greekShipPresent(s));
  s.crossings["pond-clearing"].discovered = true;
  s.packs["badger-forest"].sounds["steam-clock"] = s.turn + 2;
  assert(greekShipPresent(s));
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
            assert.equal(availableCards(s).includes("greek-ship"), visible);
            assert.equal(
              locationVariant(s, "pond") === "pond-greek-harbor",
              visible,
            );
            assert.equal(Boolean(locationOverlay(s, "pond")), visible);
            assert.equal(
              currentScene(s).variant === "pond-greek-harbor",
              visible,
            );
            assert.equal(currentScene(s).background, backdrop("pond"));
          }
});
test("ship variant never leaks into another location", () => {
  const s = pond();
  for (const [id, variant] of [
    ["station", "base"],
    ["attic", "attic-dark"],
    ["clearing", "base"],
  ]) {
    assert.equal(locationVariant(s, id), variant);
    assert.equal(locationOverlay(s, id), null);
  }
  assert.equal(locationVariant(s, "greek-harbor"), "base:clear-coast");
  assert.equal(locationOverlay(s, "greek-harbor"), null);
});
test("a previously selected ship offer is rechecked against its dock", () => {
  const s = pond();
  const a = legalActions(s).find(
    (a) => a.kind === "move" && a.target === "greek-ship",
  );
  assert.equal(playLabel(a), "Board");
  s.transports["greek-ship"].dock = "greek-harbor";
  assert.equal(play(s, a).ok, false);
});
test("return from Greece remains available without the entry lamp", () => {
  let s = pond();
  s = act(s, "move", "greek-ship", null);
  s = act(s, "move", "greek-harbor", null);
  s.items.lamp.lit = false;
  assert(exits(s, "greek-harbor", "vale").includes("greek-ship"));
  s = act(s, "move", "greek-ship", null);
  s = act(s, "move", "pond", null);
  assert.equal(s.actors.vale.place, "pond");
  assert(greekShipPresent(s));
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
    if (s.actors.vale.place === "pond") assert.match(facts, /ship waits/);
    else if (clearingReturnOpen(s))
      assert.match(facts, /opens onto Black pond/);
    else assert.match(facts, /Moss lies between the roots/);
  }
});
