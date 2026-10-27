import {
  summonTransport,
  moveTransport,
} from "../v2/card-game/pack-transport.mjs";
import { crossings } from "../v2/card-game/pack-registry.mjs";
import { crossingOpen, fixtureSounding } from "../v2/card-game/pack-rules.mjs";
import { senses } from "../v2/card-game/world.mjs";
const gate = (id) => crossings.find((c) => c.id === id);
const greekShipPresent = (s) =>
  crossingOpen(s, gate("pond-greek-harbor"), senses);
const shipSignalPhase = (s) => s.crossings["pond-greek-harbor"].phase;
const clearingReturnOpen = (s) =>
  crossingOpen(s, gate("clearing-pond"), senses);
const clockRinging = (s) => fixtureSounding(s, "steam-clock");
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  createWorld,
  legalActions,
  exits,
  play,
  encodeSave,
  decodeSave,
  validateWorld,
  addLog,
  plan,
} from "../v2/card-game/world.mjs";
import { availableCards, cardPlay, playLabel } from "../v2/card-game/cards.mjs";
import { currentScene } from "../v2/card-game/scene.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";

function pond({ lit = true, fuel = 12, place = "pond" } = {}) {
  const s = createWorld({ opening: true });
  s.opening.crossed = true;
  s.opening.met.moth = 0;
  s.locations.attic.anchored = true;
  s.actors.vale.place = place;
  s.actors.moth.place = "station";
  s.items.lamp.holder = "vale";
  s.items.lamp.lit = lit;
  s.items.lamp.fuel = fuel;
  s.items.cloth.holder = "vale";
  s.items.bell.holder = "vale";
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
const cycle = (s) => uncover(cover(s));
const summon = (s) => cycle(cycle(s));
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

test("lighting the lamp alone never summons a ship", () => {
  let s = pond({ lit: false });
  visible(s, false);
  s = act(s, "light", "lamp");
  assert.equal(shipSignalPhase(s), 0);
  visible(s, false);
});
test("a burning lamp summons the ship after cover, uncover, cover, uncover", () => {
  let s = pond();
  visible(s, false);
  for (const [fn, phase] of [
    [cover, 1],
    [uncover, 2],
    [cover, 3],
    [uncover, 4],
  ]) {
    s = fn(s);
    assert.equal(shipSignalPhase(s), phase);
    visible(s, phase === 4);
  }
  assert.equal(s.items.cloth.holder, "vale");
  assert.equal(s.items.lamp.lit, true);
  assert.equal(s.items.lamp.fuel, 8);
  assert.equal(
    s.log.filter((e) => /first flash|once more|signal complete/i.test(e.text))
      .length,
    0,
  );
});
test("actual card pairs cover, then the Black cloth card uncovers", () => {
  let s = pond();
  for (let i = 0; i < 2; i++) {
    const c = cardPlay(s, ["cloth", "lamp"]).action;
    assert.equal(c.kind, "cover");
    s = play(s, c).state;
    const u = cardPlay(s, ["cloth"]).action;
    assert.equal(u.kind, "take");
    assert.equal(u.item, "cloth");
    assert.equal(playLabel(u), "Uncover");
    s = play(s, u).state;
  }
  visible(s, true);
});
test("two covers without the corresponding uncovers cannot count", () => {
  const initial = pond();
  const a = cardPlay(initial, ["cloth", "lamp"]).action;
  const s = play(initial, a).state;
  assert.equal(play(s, a).ok, false);
  assert.equal(shipSignalPhase(s), 1);
  visible(s, false);
});
test("uncovering a lamp already covered in a legacy save is not a complete cycle", () => {
  let s = pond();
  s.items.cloth.holder = "lamp";
  s = uncover(s);
  assert.equal(shipSignalPhase(s), 0);
  s = cycle(s);
  assert.equal(shipSignalPhase(s), 2);
  visible(s, false);
});
test("covering an unlit lamp twice does not count", () => {
  const s = summon(pond({ lit: false }));
  assert.equal(shipSignalPhase(s), 0);
  visible(s, false);
});
test("signals at the station cannot summon a ship at the pond", () => {
  const s = summon(pond({ place: "station" }));
  assert.equal(shipSignalPhase(s), 0);
  visible(s, false);
});
test("lighting a covered lamp does not fabricate its first cover", () => {
  let s = cover(pond({ lit: false }));
  s = act(s, "light", "lamp");
  s = uncover(s);
  assert.equal(shipSignalPhase(s), 0);
  visible(s, false);
});
test("each partial phase survives reload without granting an extra flash", () => {
  let s = pond();
  for (const [fn, phase] of [
    [cover, 1],
    [uncover, 2],
    [cover, 3],
    [uncover, 4],
  ]) {
    s = fn(s);
    const before = encodeSave(s);
    s = reload(s);
    assert.equal(encodeSave(s), before);
    assert.equal(shipSignalPhase(s), phase);
    visible(s, phase === 4);
  }
});
test("inspection never advances the signal or spends fuel", () => {
  const s = cycle(pond()),
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
test("a rejected stale-revision uncover cannot advance a saved signal", () => {
  let s = cover(pond());
  const a = cardPlay(s, ["cloth"]).action,
    revision = s.revision;
  s = cover(uncover(s));
  const before = encodeSave(s);
  assert.equal(play(s, a, revision).ok, false);
  assert.equal(encodeSave(s), before);
  assert.equal(shipSignalPhase(s), 3);
  visible(s, false);
});
test("generated dialogue cannot summon the ship or increment the ritual", () => {
  const s = cycle(pond()),
    ctx = narrativeContext(s);
  const written = applyGeneratedText(s, ctx, {
    revision: ctx.revision,
    model: "fixture",
    entries: ctx.entities.map(({ id }) => ({
      id,
      text: "A ship has arrived after a second flash.",
    })),
  });
  assert.equal(shipSignalPhase(written), 2);
  visible(written, false);
});
test("waiting between flashes preserves progress but continues fuel consumption", () => {
  let s = cycle(pond());
  s = act(s, "wait");
  assert.equal(shipSignalPhase(s), 2);
  s = cycle(s);
  visible(s, true);
  assert.equal(s.items.lamp.fuel, 7);
});
test("putting out the lamp resets a partial signal", () => {
  let s = cycle(pond());
  s = act(s, "snuff", "lamp");
  assert.equal(shipSignalPhase(s), 0);
  s = cycle(s);
  visible(s, false);
});
test("running dry before the last uncover resets the signal", () => {
  for (const fuel of [1, 2, 3]) {
    const s = summon(pond({ fuel }));
    assert.equal(s.items.lamp.fuel, 0);
    assert.equal(shipSignalPhase(s), 0);
    visible(reload(s), false);
  }
});
test("a ship stays after the final uncover uses the last fuel", () => {
  let s = summon(pond({ fuel: 4 }));
  assert.equal(s.items.lamp.fuel, 0);
  assert.equal(s.items.lamp.lit, false);
  visible(s, true);
  for (let i = 0; i < 6; i++) s = act(s, "wait");
  visible(reload(s), true);
  s = act(s, "move", null, "greek-ship");
  assert.equal(s.actors.vale.place, "greek-ship");
});
test("leaving the pond interrupts a half-completed ritual", () => {
  let s = cycle(pond());
  s = act(s, "move", null, "station");
  assert.equal(shipSignalPhase(s), 0);
  s = act(s, "move", null, "pond");
  s = cycle(s);
  assert.equal(shipSignalPhase(s), 2);
  visible(s, false);
});
test("a summoned ship waits through bells and changes to the lamp", () => {
  let s = summon(pond());
  s = act(s, "ring", "bell");
  visible(s, true);
  s = act(s, "snuff", "lamp");
  visible(s, true);
  for (let i = 0; i < 3; i++) s = act(s, "wait");
  visible(reload(s), true);
});
test("boarding and disembarking move the ship between shores", () => {
  let s = summon(pond());
  s = act(s, "move", null, "greek-ship");
  assert.equal(shipSignalPhase(s), 0);
  assert.equal(s.transports["greek-ship"].dock, "pond");
  assert.deepEqual(
    availableCards(s).filter((id) =>
      ["pond", "greek-harbor", "greek-ship"].includes(id),
    ),
    ["greek-ship", "greek-harbor"],
  );
  assert.equal(playLabel(cardPlay(s, ["greek-harbor"]).action), "Disembark");
  s = reload(act(s, "wait"));
  assert.equal(s.actors.vale.place, "greek-ship");
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
  s = act(s, "move", null, "pond");
  assert.equal(s.transports["greek-ship"].dock, "pond");
  visible(reload(s), true);
});
test("a further signal leaves the waiting ship available", () => {
  let s = summon(pond());
  s = cycle(s);
  assert.equal(shipSignalPhase(s), 2);
  visible(s, true);
});
test("covering and uncovering the bell is not a lamp signal", () => {
  let s = pond();
  for (let i = 0; i < 2; i++) {
    s = act(s, "cover", "cloth", "bell");
    s = act(s, "take", "cloth");
  }
  assert.equal(shipSignalPhase(s), 0);
  visible(s, false);
});
test("earlier saves get an unsummoned pond and keep their history and belongings", () => {
  const old = pond();
  delete old.locations.pond.shipSignal;
  const s = decodeSave(JSON.stringify(old));
  assert.equal(shipSignalPhase(s), 0);
  assert.deepEqual(s.items, old.items);
  assert.deepEqual(s.packs, old.packs);
  assert.deepEqual(s.memories, old.memories);
  visible(s, false);
});
test("invalid saved signal phases fail validation", () => {
  for (const value of [-1, 5, 2.5, "3", null, {}, []]) {
    const s = pond();
    s.crossings["pond-greek-harbor"].phase = value;
    assert.throws(() => validateWorld(s));
    assert.throws(() => decodeSave(JSON.stringify(s)));
  }
});
test("the narration does not expose a partial ritual or claim a ship is present", () => {
  const s = cycle(pond()),
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

// NPCs can fulfil their own meetings before the player knows the witness.
import { enableMotives } from "../v2/card-game/motives.mjs";
test("the ship crossing preserves an NPC receipt for a witness Vale has not met", () => {
  let s = enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
    personalQuests: true,
  });
  s = act(s, "light", "lamp");
  s = act(s, "move", null, "pond");
  s.items.cloth.holder = "pond";
  // Pip meets the keeper out of sight while Vale works the lamp signal.
  s.actors.moth.place = "station";
  s.items.oil.holder = "moth";
  s.items.lamp.fuel = 12;
  assert.equal(s.opening.met.keeper, undefined);
  s = summon(s);
  s = act(s, "drop", "cloth", "pond");
  s = act(s, "move", null, "greek-ship");
  s = act(s, "move", null, "greek-harbor");
  s = act(s, "snuff", "lamp");
  const receipt = s.log.find(
    (e) => e.kind === "quest" && e.actorId === "moth" && e.step === 1,
  );
  assert(receipt);
  assert.deepEqual(receipt.fulfillment.avatars, ["keeper"]);
  assert.equal(s.opening.met.keeper, undefined);
  assert.deepEqual(reload(s), s);
});

test("filling the lamp supplies enough oil for lighting and the whole ritual", () => {
  let s = pond({ lit: false, fuel: 0 });
  s.items.oil.holder = "vale";
  s.items.bell.holder = "pond";
  s = act(s, "refill", "oil");
  s = act(s, "refill", "oil");
  s = act(s, "light", "lamp");
  s = summon(s);
  assert.equal(s.items.lamp.fuel, 3);
  visible(s, true);
});

test("Pip brings the signaled ship from Greece to a waiting player", () => {
  let s = summon(pond());
  summonTransport(s, "greek-ship", "greek-harbor");
  s.items.lamp.lit = false;
  s.actors.moth.place = "greek-harbor";
  s.items.lamp.holder = "pond";
  assert.equal(plan(s, "moth").action.target, "greek-ship");
  s = act(s, "wait");
  assert.equal(s.actors.moth.place, "greek-ship");
  assert.equal(s.transports["greek-ship"].destination, "pond");
  assert.equal(shipSignalPhase(s), 0);
  visible(s, false);
  s = reload(s);
  s = act(s, "wait");
  assert.equal(s.actors.moth.place, "pond");
  visible(s, true);
  s = act(s, "move", null, "greek-ship");
  assert.equal(s.transports["greek-ship"].destination, "greek-harbor");
});

test("a recall waits for the last passenger to finish the current trip", () => {
  const s = summon(pond());
  s.actors.moth.place = "greek-ship";
  s.actors.keeper.place = "greek-ship";
  s.transports["greek-ship"] = {
    version: 2,
    dock: "pond",
    destination: "greek-harbor",
    recall: null,
  };
  summonTransport(s, "greek-ship", "pond");
  assert.equal(s.transports["greek-ship"].destination, "greek-harbor");
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
      s.actors.vale.place = "greek-ship";
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

test("older occupied ship saves keep their destination and regain the departure dock", () => {
  for (const destination of ["pond", "greek-harbor"]) {
    const old = pond();
    old.actors.vale.place = "greek-ship";
    old.transports["greek-ship"] = { dock: null, destination, recall: "pond" };
    const upgraded = decodeSave(JSON.stringify(old));
    assert.deepEqual(upgraded.transports["greek-ship"], {
      version: 2,
      dock: destination === "pond" ? "greek-harbor" : "pond",
      destination,
      recall: "pond",
    });
    assert.deepEqual(upgraded.actors, old.actors);
    assert.deepEqual(upgraded.items, old.items);
    assert.deepEqual(upgraded.log, old.log);
    assert.deepEqual(reload(upgraded), upgraded);
  }
});

test("a validated human already aboard keeps the saved voyage", () => {
  const old = pond();
  old.actors.vale.place = "greek-ship";
  old.transports["greek-ship"].destination = "pond";
  const upgraded = reload(old);
  assert.equal(upgraded.crossings["pond-greek-harbor"].discovered, true);
  assert.deepEqual(upgraded.transports, old.transports);
  assert.deepEqual(upgraded.actors, old.actors);
  assert.deepEqual(reload(upgraded), upgraded);
  assert(exits(upgraded, "greek-ship", "vale").includes("pond"));
  const invalid = pond();
  invalid.transports["greek-ship"].dock = "pond";
  invalid.crossings["pond-greek-harbor"].phase = 4;
  assert.throws(() => decodeSave(JSON.stringify(invalid)));
});

test("an old NPC voyage preserves the first-signal lock after landing and reload", () => {
  for (const destination of ["pond", "greek-harbor"]) {
    let s = pond();
    s.actors.moth.place = "greek-ship";
    s.transports["greek-ship"].dock =
      destination === "pond" ? "greek-harbor" : "pond";
    s.transports["greek-ship"].destination = destination;
    s.items.lamp.holder = destination;
    s = reload(s);
    assert.equal(s.crossings["pond-greek-harbor"].discovered, false);
    s = act(s, "wait");
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
  for (const phase of [0, 1, 2, 3, 4]) {
    const old = pond();
    old.packs["greek-drama"].revision = 1;
    old.crossings["pond-greek-harbor"] = {
      phase,
      until: 0,
      discovered: phase === 4,
    };
    delete old.transports;
    delete old.memories["greek-ship"];
    const s = decodeSave(JSON.stringify(old));
    assert.equal(shipSignalPhase(s), phase);
    visible(s, phase === 4);
    assert.deepEqual(s.log, old.log);
    assert.deepEqual(s.items, old.items);
    assert.deepEqual(reload(s), s);
  }
});
