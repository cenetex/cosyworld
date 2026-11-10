import { fillLampFuel, settleLamp } from "../v2/card-game/lamp-state.mjs";
import { roomFuelFromTurns } from "../v2/card-game/lamp-room-fuel.mjs";
import { beforeFuneral } from "./fixtures/card-upgraded-items.mjs";
import { atticOpening, selectLamp } from "./fixtures/card-attic-opening.mjs";
import {
  summonTransport,
  moveTransport,
} from "../v2/card-game/pack-transport.mjs";
import { crossings, packDefinition } from "../v2/card-game/pack-registry.mjs";
import { crossingOpen } from "../v2/card-game/pack-rules.mjs";
import { senses } from "../v2/card-game/world.mjs";
const gate = (id) => crossings.find((c) => c.id === id);
const greekShipPresent = (s) =>
  crossingOpen(s, gate("pond-greek-harbor"), senses);
const shipSignalPhase = (s) => s.crossings["pond-greek-harbor"].phase;
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  legalActions,
  exits,
  play,
  encodeSave,
  decodeSave,
  validateWorld,
  addLog,
  plan,
  holdChoice,
} from "../v2/card-game/world.mjs";
import { availableCards, cardPlay, playLabel } from "../v2/card-game/cards.mjs";
import { currentScene } from "../v2/card-game/scene.mjs";
import { settleHeldItems } from "../v2/card-game/held-item.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";

function pond({ lit = true, fuel = 12, place = "pond" } = {}) {
  const s = atticOpening();
  s.opening.crossed = true;
  s.opening.met.moth = 0;
  s.locations.attic.anchored = true;
  s.actors.vale.place = place;
  s.actors.moth.place = "station";
  s.items.lamp.holder = "vale";
  s.items.lamp.lit = lit;
  Object.assign(s.items.lamp, roomFuelFromTurns(fuel, place));
  s.actors.vale.heldItem = lit ? "lamp" : null;
  settleLamp(s);
  s.items.cloth.holder = "vale";
  s.items.bell.holder = "vale";
  // Pip rests content here instead of pursuing Vale's lamp.
  s.actors.moth.want = null;
  s.actors.moth.metTurn = s.turn;
  settleHeldItems(s);
  addLog(s, "World", "Vale waits beside the water.", { locationId: place });
  return s;
}
function act(s, kind, item, target) {
  const a = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      (item === undefined || a.item === item) &&
      (target === undefined || a.target === target),
  );
  assert(a, `Missing ${kind}:${item}:${target}`);
  const r = play(s, a);
  assert(r.ok, r.error);
  return r.state;
}
const cover = (s) => act(s, "cover", "cloth", "lamp");
const uncover = (s) => act(s, "take", "cloth");
// The grounded lamp and actively held cloth are the current arrangement.
const summon = (s) => {
  if (s.items.cloth.holder !== "vale") s = act(s, "take", "cloth");
  s = selectLamp(s, "cloth");
  if (s.items.lamp.holder === "vale")
    s = act(s, "drop", "lamp", s.actors.vale.place);
  return s;
};
const reload = (s) => decodeSave(encodeSave(s));
function visible(s, yes) {
  assert.equal(greekShipPresent(s), yes);
  assert.equal(availableCards(s).includes("greek-ship"), yes);
  assert.equal(currentScene(s).variant === "pond-greek-harbor", yes);
  assert.equal(Boolean(currentScene(s).overlay), yes);
}

test("the first lamp signal gates both shores for players and residents", () => {
  for (const place of ["pond", "greek-harbor"]) {
    const s = pond({ place });
    for (const actor of ["vale", "moth", "greek-rhapsode"]) {
      s.actors[actor].place = place;
      assert(!exits(s, place, actor).includes("greek-ship"));
      assert(!legalActions(s, actor).some((a) => a.target === "greek-ship"));
      assert.notEqual(plan(s, actor).action.target, "greek-ship");
    }
    const result = play(s, { key: "move:vale::greek-ship" });
    assert.equal(result.ok, false);
    assert.deepEqual(result.state, s);
    assert.deepEqual(reload(s), s);
  }
});

test("a resident at the original dock waits for the first signal", () => {
  let s = pond();
  s.actors.moth.place = "greek-harbor";
  s.items.lamp.holder = "pond";
  for (let turn = 0; turn < 4; turn++) s = act(s, "wait");
  assert.equal(s.transports["greek-ship"].dock, "greek-harbor");
  assert.equal(s.crossings["pond-greek-harbor"].discovered, false);
  assert.notEqual(s.actors.moth.place, "greek-ship");
  visible(s, false);
});

test("a held burning lamp alone never summons a ship", () => {
  const s = selectLamp(pond({ lit: false }), "lamp");
  assert.equal(s.items.lamp.lit, true);
  assert(!legalActions(s).some((a) => ["light", "snuff"].includes(a.kind)));
  visible(s, false);
});
test("placing a fueled lamp while holding cloth summons without spending a room", () => {
  const s = summon(pond());
  visible(s, true);
  assert.equal(s.items.lamp.holder, "pond");
  assert.equal(s.actors.vale.heldItem, "cloth");
  assert.equal(s.items.lamp.lit, true);
  assert.equal(s.items.lamp.fuelRooms, 3);
  assert.equal(shipSignalPhase(s), undefined);
});
test("the actual lamp drop card completes the selected cloth arrangement", () => {
  let s = selectLamp(pond(), "cloth");
  const action = legalActions(s).find(
    (a) => a.kind === "drop" && a.item === "lamp" && a.target === "pond",
  );
  assert(action);
  const result = play(s, action);
  assert(result.ok, result.error);
  visible(result.state, true);
});
test("a repeated drop cannot replay the discovery", () => {
  const s = selectLamp(pond(), "cloth");
  const action = legalActions(s).find(
    (a) => a.kind === "drop" && a.item === "lamp",
  );
  const arrived = play(s, action).state;
  const before = encodeSave(arrived);
  assert.equal(play(arrived, action).ok, false);
  assert.equal(encodeSave(arrived), before);
  visible(arrived, true);
});
test("the retired cover and uncover sequence cannot summon a carried lamp", () => {
  const s = uncover(cover(pond()));
  visible(s, false);
  assert.equal(shipSignalPhase(s), undefined);
});
test("an empty grounded lamp cannot complete the arrangement", () => {
  const s = summon(pond({ fuel: 0 }));
  assert.equal(s.items.lamp.lit, false);
  visible(reload(s), false);
});
test("the same arrangement at the station cannot summon the ship", () => {
  visible(summon(pond({ place: "station" })), false);
});
test("mere cloth possession beside the placed lamp is insufficient", () => {
  let s = selectLamp(pond());
  s = act(s, "drop", "lamp", "pond");
  assert.equal(s.items.cloth.holder, "vale");
  visible(s, false);
  const turn = s.turn;
  s = selectLamp(s, "cloth");
  assert.equal(s.turn, turn);
  visible(s, true);
});
test("unfulfilled arrangement and permanent discovery both survive reload", () => {
  for (const s of [pond(), summon(pond())]) {
    assert.equal(encodeSave(reload(s)), encodeSave(s));
    assert.equal(
      reload(s).crossings["pond-greek-harbor"].discovered,
      s.crossings["pond-greek-harbor"].discovered,
    );
  }
});
test("inspection never changes discovery or spends room fuel", () => {
  const s = cover(pond()),
    before = encodeSave(s);
  for (let i = 0; i < 20; i++) {
    availableCards(s);
    cardPlay(s, ["cloth", "lamp"]);
    currentScene(s);
    narrativeContext(s);
  }
  assert.equal(encodeSave(s), before);
  visible(s, false);
});
test("a stale quiet cloth choice cannot unlock a saved arrangement", () => {
  let s = selectLamp(pond());
  s = act(s, "drop", "lamp", "pond");
  const revision = s.revision;
  s = act(s, "wait");
  const before = encodeSave(s);
  assert.throws(() => holdChoice(s, "vale", { item: "cloth", revision }));
  assert.equal(encodeSave(s), before);
  visible(s, false);
});
test("generated dialogue cannot invent discovery", () => {
  const s = cover(pond()),
    ctx = narrativeContext(s);
  const written = applyGeneratedText(s, ctx, {
    revision: ctx.revision,
    model: "fixture",
    entries: ctx.entities.map(({ id }) => ({
      id,
      text: "A ship has arrived.",
    })),
  });
  visible(written, false);
});
test("waiting does not drain the lamp's current room or revoke discovery", () => {
  let s = summon(pond());
  for (let i = 0; i < 6; i++) s = act(s, "wait");
  assert.equal(s.items.lamp.fuelRooms, 3);
  visible(reload(s), true);
});
test("a discovered ship remains after the lamp runs dry", () => {
  let s = summon(pond({ fuel: 4 }));
  s.items.lamp.fuelRooms = 0;
  settleLamp(s);
  visible(reload(s), true);
  s = act(s, "move", null, "greek-ship");
  assert.equal(s.actors.vale.place, "greek-ship");
});
test("leaving the pond before placing the lamp cannot complete the arrangement", () => {
  let s = selectLamp(pond(), "cloth");
  s = act(s, "move", null, "station");
  s = act(s, "drop", "lamp", "station");
  s = act(s, "move", null, "pond");
  visible(s, false);
});
test("a summoned ship waits through bells and changes to the lamp", () => {
  let s = summon(pond());
  s = act(s, "ring", "bell");
  visible(s, true);
  s = selectLamp(s);
  visible(s, true);
  for (let i = 0; i < 3; i++) s = act(s, "wait");
  visible(reload(s), true);
});
test("boarding and disembarking move the ship between shores", () => {
  let s = summon(pond());
  s = act(s, "move", null, "greek-ship");
  assert.equal(shipSignalPhase(s), undefined);
  assert.equal(s.transports["greek-ship"].dock, "pond");
  assert.deepEqual(
    availableCards(s).filter((id) =>
      ["pond", "greek-harbor", "greek-ship"].includes(id),
    ),
    ["greek-ship", "greek-harbor"],
  );
  // The far shore is a course card; the ship waits at its harbour.
  assert.equal(playLabel(cardPlay(s, ["greek-harbor"]).action), "Set course");
  s = reload(act(s, "wait"));
  assert.equal(s.actors.vale.place, "greek-ship");
  assert.equal(s.transports["greek-ship"].phase, "docked");
  s = act(s, "course", null, "greek-harbor");
  assert.equal(s.transports["greek-ship"].phase, "sea");
  assert.deepEqual(
    availableCards(s).filter((id) =>
      ["pond", "greek-harbor", "greek-ship"].includes(id),
    ),
    ["greek-ship"],
  );
  assert.equal(greekShipPresent(s), false);
  s = reload(act(s, "wait"));
  assert.equal(s.transports["greek-ship"].phase, "arrived");
  assert.equal(playLabel(cardPlay(s, ["greek-harbor"]).action), "Disembark");
  s = act(s, "move", null, "greek-harbor");
  assert.equal(s.transports["greek-ship"].dock, "greek-harbor");
  assert(availableCards(s).includes("greek-ship"));
  s = act(s, "move", null, "greek-ship");
  assert.deepEqual(
    availableCards(s).filter((id) =>
      ["pond", "greek-harbor", "greek-ship"].includes(id),
    ),
    ["greek-ship", "pond"],
  );
  s = act(act(s, "course", null, "pond"), "wait");
  s = act(s, "move", null, "pond");
  assert.equal(s.transports["greek-ship"].dock, "pond");
  visible(reload(s), true);
});
test("reselecting the cloth leaves the discovered ship available", () => {
  let s = summon(pond());
  s = selectLamp(selectLamp(s), "cloth");
  assert.equal(shipSignalPhase(s), undefined);
  visible(s, true);
});
test("covering and uncovering the bell is not a lamp signal", () => {
  let s = pond();
  for (let i = 0; i < 2; i++) {
    s = act(s, "cover", "cloth", "bell");
    s = act(s, "take", "cloth");
  }
  assert.equal(shipSignalPhase(s), undefined);
  visible(s, false);
});
test("earlier saves get an unsummoned pond and keep their history and belongings", () => {
  const old = pond();
  delete old.locations.pond.shipSignal;
  const s = decodeSave(JSON.stringify(old));
  assert.equal(shipSignalPhase(s), undefined);
  assert.deepEqual(s.items, old.items);
  assert.deepEqual(s.packs, old.packs);
  assert.deepEqual(s.memories, old.memories);
  visible(s, false);
});
test("a revision 9 save retires partial marks but preserves discovery", () => {
  // Old partial marks no longer grant progress; completed discovery persists.
  for (const [phase, discovered] of [
    [1, false],
    [2, false],
    [2, true],
    [3, true],
    [4, true],
  ]) {
    const old = pond();
    old.packs["greek-drama"].revision = 9;
    beforeFuneral(old);
    Object.assign(old.crossings["pond-greek-harbor"], { phase, discovered });
    const s = decodeSave(JSON.stringify(old));
    assert.equal(
      s.packs["greek-drama"].revision,
      packDefinition("greek-drama").revision,
    );
    assert.equal(shipSignalPhase(s), undefined);
    assert.equal(s.crossings["pond-greek-harbor"].discovered, discovered);
  }
});
test("invalid saved discovery values fail validation", () => {
  for (const value of [-1, 5, 2.5, "3", null, {}, []]) {
    const s = pond();
    s.crossings["pond-greek-harbor"].discovered = value;
    assert.throws(() => validateWorld(s));
    assert.throws(() => decodeSave(JSON.stringify(s)));
  }
});
test("the narration does not expose a partial ritual or claim a ship is present", () => {
  const s = cover(pond()),
    ctx = narrativeContext(s),
    facts = ctx.entities.find((e) => e.id === "pond").facts;
  assert(
    !facts.some((f) =>
      /Completed lamp signals|cover and uncover|once more|first flash/i.test(f),
    ),
  );
  assert(!facts.some((f) => f.includes("ship waits")));
  visible(s, false);
});

// NPCs can meet their own wants before the player knows the witness.
import { newWant } from "../v2/card-game/want.mjs";
test("the ship crossing preserves a want met beside a resident Vale has not met", () => {
  let s = atticOpening();
  s = selectLamp(s);
  s = act(s, "move", null, "pond");
  s = selectLamp(s, "lamp");
  s.items.cloth.holder = "pond";
  // Pip takes the oil beside the keeper, out of sight of Vale's signal.
  s.actors.moth.place = "station";
  s.items.oil.holder = "station";
  s.actors.moth.want = newWant("item", "oil", s.turn);
  fillLampFuel(s);
  assert.equal(s.opening.met.keeper, undefined);
  s = summon(s);
  s = act(s, "drop", "cloth", "pond");
  s = act(s, "move", null, "greek-ship");
  s = act(act(s, "course", null, "greek-harbor"), "wait");
  s = act(s, "move", null, "greek-harbor");
  s = selectLamp(s);
  const met = s.log.find((e) => e.verb === "want_met" && e.actorId === "moth");
  assert(met);
  assert.deepEqual(met.wantMet, { kind: "item", target: "oil" });
  assert.equal(s.opening.met.keeper, undefined);
  assert.deepEqual(reload(s), s);
});

test("filling the lamp supplies three rooms and the grounded arrangement", () => {
  let s = pond({ lit: false, fuel: 0 });
  s.items.oil.holder = "vale";
  s.items.bell.holder = "pond";
  // Holding the flask with the empty lamp fills it on the next play.
  s = act(s, "wait");
  assert.equal(s.items.lamp.fuel, 12);
  assert.equal(s.items.oil.holder, "station");
  s = summon(s);
  assert.equal(s.items.lamp.fuel, 12);
  visible(s, true);
});

test("Pip brings the signaled ship from Greece to a waiting player", () => {
  let s = summon(pond());
  summonTransport(s, "greek-ship", "greek-harbor");
  s.items.lamp.fuelRooms = 0;
  settleLamp(s);
  s.actors.moth.place = "greek-harbor";
  // Pip, rested, wants to go to the pond.
  delete s.actors.moth.metTurn;
  s.actors.moth.want = newWant("place", "pond", s.turn);
  s.items.lamp.holder = "pond";
  assert.equal(plan(s, "moth").action.target, "greek-ship");
  s = act(s, "wait");
  assert.equal(s.actors.moth.place, "greek-ship");
  assert.equal(shipSignalPhase(s), undefined);
  visible(s, false);
  s = reload(s);
  // Alone aboard, Pip sets the course, rides a round at sea and lands.
  s = act(s, "wait");
  assert.equal(s.transports["greek-ship"].phase, "sea");
  assert.equal(s.transports["greek-ship"].destination, "pond");
  for (let turn = 0; turn < 3 && s.actors.moth.place !== "pond"; turn++)
    s = act(s, "wait");
  assert.equal(s.actors.moth.place, "pond");
  visible(s, true);
  s = act(s, "move", null, "greek-ship");
  assert.deepEqual(
    legalActions(s)
      .filter((a) => a.kind === "course")
      .map((a) => a.target),
    ["greek-harbor"],
  );
});

test("a recall waits for the last passenger to finish the current trip", () => {
  const s = summon(pond());
  s.actors.moth.place = "greek-ship";
  s.actors.keeper.place = "greek-ship";
  s.transports["greek-ship"] = {
    version: 3,
    phase: "arrived",
    dock: "greek-harbor",
    destination: null,
    riders: ["keeper", "moth"],
    since: s.turn,
    recall: null,
  };
  summonTransport(s, "greek-ship", "pond");
  assert.equal(s.transports["greek-ship"].dock, "greek-harbor");
  assert.equal(s.transports["greek-ship"].recall, "pond");
  s.actors.moth.place = "greek-harbor";
  moveTransport(s, "greek-ship", "greek-harbor");
  assert.equal(s.transports["greek-ship"].dock, "greek-harbor");
  assert.deepEqual(reload(s).transports, s.transports);
  s.actors.keeper.place = "greek-harbor";
  moveTransport(s, "greek-ship", "greek-harbor");
  visible(reload(s), true);
});

test("a trusted companion can board and disembark with Vale", () => {
  let s = summon(pond());
  s.actors.moth.place = "pond";
  s.actors.moth.trust.vale = 3;
  const pair = (world, destination) => {
    const a = legalActions(world).find(
      (a) =>
        a.kind === "accompany" &&
        a.target === "moth" &&
        a.destination === destination,
    );
    assert(a);
    const r = play(world, a);
    assert(r.ok, r.error);
    return r.state;
  };
  s = pair(s, "greek-ship");
  assert.equal(s.actors.vale.place, "greek-ship");
  assert.equal(s.actors.moth.place, "greek-ship");
  s = reload(s);
  s = act(act(s, "course", null, "greek-harbor"), "wait");
  s = pair(s, "greek-harbor");
  assert.equal(s.actors.vale.place, "greek-harbor");
  assert.equal(s.actors.moth.place, "greek-harbor");
  assert.equal(s.transports["greek-ship"].dock, "greek-harbor");
  assert.deepEqual(reload(s), s);
});

test("saved ship state names a dock and a valid occupied leg", () => {
  for (const change of [
    (s) => {
      s.transports["greek-ship"].dock = "station";
    },
    (s) => {
      s.transports["greek-ship"].dock = null;
    },
    (s) => {
      s.transports["greek-ship"].destination = "pond";
    },
    (s) => {
      s.transports["greek-ship"].recall = "pond";
    },
    (s) => {
      // A course needs someone aboard; an arrival needs riders.
      Object.assign(s.transports["greek-ship"], {
        phase: "course",
        destination: "pond",
      });
    },
    (s) => {
      s.transports["greek-ship"].phase = "arrived";
    },
    (s) => {
      // Lanes join neighbouring ports only.
      s.actors.vale.place = "greek-ship";
      Object.assign(s.transports["greek-ship"], {
        phase: "sea",
        destination: "greek-athens-harbor",
      });
    },
    (s) => {
      s.transports.extra = { dock: "pond" };
    },
    (s) => {
      s.transports["greek-ship"].version = 99;
    },
  ]) {
    const s = pond();
    change(s);
    assert.throws(() => validateWorld(s));
    assert.throws(() => decodeSave(JSON.stringify(s)));
  }
});

test("older occupied ship saves regain the departure dock and wait there for a course", () => {
  for (const destination of ["pond", "greek-harbor"]) {
    const old = pond();
    old.actors.vale.place = "greek-ship";
    old.transports["greek-ship"] = { dock: null, destination, recall: "pond" };
    const upgraded = decodeSave(JSON.stringify(old));
    assert.deepEqual(upgraded.transports["greek-ship"], {
      version: 3,
      phase: "docked",
      dock: destination === "pond" ? "greek-harbor" : "pond",
      destination: null,
      riders: [],
      since: old.turn,
      recall: "pond",
    });
    assert.deepEqual(
      legalActions(upgraded)
        .filter((a) => a.kind === "course")
        .map((a) => a.target),
      [destination],
    );
    assert.deepEqual(upgraded.actors, old.actors);
    // Moving a carried lamp into the historical ship location settles one room.
    const expectedItems = structuredClone(old.items);
    Object.assign(expectedItems.lamp, {
      fuelRooms: 2,
      fuel: 8,
      fuelPlace: "greek-ship",
      fuelVisit: true,
      lit: true,
    });
    assert.deepEqual(upgraded.items, expectedItems);
    assert.equal(upgraded.items.lamp.holder, old.items.lamp.holder);
    assert.deepEqual(upgraded.log, old.log);
    assert.deepEqual(reload(upgraded), upgraded);
  }
});

test("a validated human already aboard keeps the saved voyage", () => {
  const old = pond();
  old.actors.vale.place = "greek-ship";
  const upgraded = reload(old);
  assert.equal(upgraded.crossings["pond-greek-harbor"].discovered, true);
  assert.deepEqual(upgraded.transports, old.transports);
  assert.deepEqual(upgraded.actors, old.actors);
  assert.deepEqual(reload(upgraded), upgraded);
  assert(exits(upgraded, "greek-ship", "vale").includes("pond"));
  const invalid = pond();
  invalid.transports["greek-ship"].dock = "pond";
  invalid.crossings["pond-greek-harbor"].discovered = 4;
  assert.throws(() => decodeSave(JSON.stringify(invalid)));
});

test("an old NPC voyage preserves the first-signal lock after landing and reload", () => {
  for (const destination of ["pond", "greek-harbor"]) {
    let s = pond();
    s.actors.moth.place = "greek-ship";
    Object.assign(s.transports["greek-ship"], {
      phase: "sea",
      dock: destination === "pond" ? "greek-harbor" : "pond",
      destination,
    });
    s.items.lamp.holder = destination;
    // An obsolete lamp hand must not fall back to cloth on shore.
    s.actors.vale.heldItem = null;
    s = reload(s);
    assert.equal(s.crossings["pond-greek-harbor"].discovered, false);
    s = act(act(s, "wait"), "wait");
    assert.equal(s.actors.moth.place, destination);
    s = reload(s);
    assert.equal(s.crossings["pond-greek-harbor"].discovered, false);
    assert(!exits(s, destination, "moth").includes("greek-ship"));
    assert(!exits(s, destination, "vale").includes("greek-ship"));
  }
});

test("legacy ship validation runs before the boarding migration", () => {
  for (const change of [
    (s) => {
      s.transports["greek-ship"].destination = "station";
    },
    (s) => {
      s.transports["greek-ship"].dock = "pond";
    },
    (s) => {
      s.transports["greek-ship"].recall = "station";
    },
    (s) => {
      s.actors.vale.place = "pond";
    },
  ]) {
    const old = pond();
    old.actors.vale.place = "greek-ship";
    old.transports["greek-ship"] = {
      dock: null,
      destination: "greek-harbor",
      recall: null,
    };
    change(old);
    assert.throws(() => decodeSave(JSON.stringify(old)));
  }
});

test("older completed signals become a waiting ship and retain their history", () => {
  const context = vm.createContext({});
  vm.runInContext(
    readFileSync(
      new URL(
        "../v2/orchestrator-rust/src/card_shared/engine-v9.js",
        import.meta.url,
      ),
      "utf8",
    ),
    context,
  );
  for (const phase of [0, 1, 2, 3, 4]) {
    // The frozen engine supplies the pre-expansion cast and objects. Remove
    // its ship fields to exercise the earlier transport migration.
    const old = JSON.parse(
      context.cardShared(JSON.stringify({ op: "create" })),
    ).world;
    delete old.opening;
    old.actors.vale.place = "pond";
    old.packs["greek-drama"].revision = 1;
    beforeFuneral(old);
    old.crossings["pond-greek-harbor"] = {
      phase,
      until: 0,
      discovered: phase === 4,
    };
    delete old.transports;
    delete old.memories["greek-ship"];
    const s = decodeSave(JSON.stringify(old));
    // The arrangement has no partial signal marks; old discovery survives.
    assert.equal(shipSignalPhase(s), undefined);
    visible(s, phase === 4);
    assert.deepEqual(s.log, old.log);
    // The save upgrade drops the old flask's dose count; one flask fills one lamp.
    delete old.items.oil.doses;
    for (const [id, item] of Object.entries(old.items)) {
      if (id === "lamp") {
        const { fuel, lit, ...oldPhysical } = item;
        const {
          fuelRooms,
          fuelPlace,
          fuelVisit,
          fuel: projection,
          lit: currentLight,
          ...physical
        } = s.items.lamp;
        assert.deepEqual(physical, oldPhysical);
        assert.equal(projection, fuelRooms * 4);
        assert.equal(s.items.lamp.fuelRooms, Math.ceil(item.fuel / 4));
      } else assert.deepEqual(s.items[id], item);
    }
    assert.deepEqual(reload(s), s);
  }
});
