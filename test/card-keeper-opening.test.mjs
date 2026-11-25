import { test } from "vitest";
import assert from "node:assert/strict";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import { decodeSave, encodeSave, holdChoice, legalActions, nameOf, play, senses, validateWorld, wantAPI } from "../v2/card-game/world.mjs";
import { settleCrossingUnlocks } from "../v2/card-game/quest-call.mjs";
import { knowledgeFacts, knowsFact } from "../v2/card-game/knowledge.mjs";
import { learnTold } from "../v2/card-game/quest-learn.mjs";
import { besideOwners, tableOwner, tableQuest, tableQuests } from "../v2/card-game/quest-hand.mjs";
import { offerWords } from "../v2/card-game/quest-card.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import { fillWants, renewWant } from "../v2/card-game/want.mjs";
import { fillLampFuel } from "../v2/card-game/lamp-state.mjs";
import { recordOf } from "../v2/card-game/world/arcana-record.mjs";
import { seatActors } from "../v2/card-game/human-cast.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { wantFact } from "../v2/card-game/want-talk.mjs";
import { pinnedCompanion, toldWant } from "../v2/card-game/talk-quest.mjs";

const crossing = "pond-greek-harbor", fact = "quest:keeper:pond";
const reload = (s) => decodeSave(encodeSave(s));
const choose = (s, item) => holdChoice(s, "vale", { item, revision: s.revision });
const met = (s) => s.log.filter((e) => e.verb === "want_met" && e.ownerId === "keeper");
function act(s, kind, target, item) {
  const a = legalActions(s, "vale").find((a) => a.kind === kind &&
    (target === undefined || a.target === target) && (item === undefined || a.item === item));
  assert(a, `Missing legal ${kind}:${target}:${item}`);
  const r = play(s, a, s.revision, "vale");
  assert(r.ok, r.error);
  return r.state;
}
// Predicate fixtures isolate simultaneous facts; the playable consent trace is separate.
function arrangement() {
  const s = createLandingWorld(null, 23);
  s.opening.crossed = true;
  s.opening.met.moth = 0;
  s.locations.attic.anchored = true;
  s.actors.vale.place = "pond";
  s.actors.moth.place = "station";
  s.items.lamp.holder = "pond";
  fillLampFuel(s);
  s.items.lamp.lit = true;
  s.items.cloth.holder = "vale";
  s.actors.vale.heldItem = "cloth";
  return s;
}

test("Pip tells a sourced, visible keeper lead on the first pond Talk", () => {
  let s = createLandingWorld(null, 23);
  const source = s.knowledge.facts[fact].source;
  const prior = s.log.find((e) => e.seq === source.eventSeq);
  assert.deepEqual([prior.actorId, prior.targetId, prior.locationId, prior.verb], ["keeper", "moth", "station", "talk"]);
  assert.deepEqual(prior.witnesses, ["keeper", "moth"]);
  assert(!knowsFact(s, "vale", fact));
  choose(s, null);
  s = act(act(s, "move", "pond"), "talk", "moth");
  assert.equal(s.knowledge.known.vale[fact].teller, "moth");
  const ids = availableCards(s), table = tableQuests(s, "vale", ids);
  const lead = table.find((t) => t.owner === "keeper");
  assert(!ids.includes("keeper"));
  assert.equal(lead.beside, "moth");
  assert.match(offerWords(lead.quest), /^Pip told you: The keeper asks you to call the ship/u);
  assert.equal(tableOwner(lead.id, s, "vale"), "moth");
  const row = besideOwners(ids, table, s);
  assert(row.indexOf(lead.id) > row.indexOf("moth"));
  const words = knowledgeFacts(s, "vale", nameOf).find((line) => line.includes("call the ship"));
  assert.match(words, /Pip told me this just now at Black pond/u);
  assert.match(words, /The keeper made the request at Empty station/u);
});

test("shared history retains the request with matching source event chronology", () => {
  const s = dispatchShared({ op: "create", seed: 23, history: true }).world;
  const source = s.knowledge.facts[fact].source;
  assert.equal(s.actors.keeper.want.step.verb, "call");
  assert.equal(s.actors.keeper.place, "station");
  assert.equal(s.log.find((e) => e.seq === source.eventSeq).turn, source.turn);
  assert.equal(s.knowledge.known.moth[fact].learnedTurn, source.turn);
  assert.equal(s.knowledge.known.moth[fact].teller, "keeper");
});

test("all four crossing facts must hold for the same actor, even after discovery", () => {
  const missing = [
    (s) => { s.actors.vale.place = "station"; s.actors.moth.place = "pond"; },
    (s) => { s.actors.vale.heldItem = null; },
    (s) => { s.items.lamp.holder = "vale"; },
    (s) => { s.items.lamp.lit = false; },
    (s) => { s.items.lamp.fuel = 0; s.items.lamp.fuelRooms = 0; },
  ];
  for (const discovered of [false, true]) for (const remove of missing) {
    const s = arrangement();
    s.crossings[crossing].discovered = discovered;
    remove(s);
    settleCrossingUnlocks(s, senses);
    assert.equal(s.actors.keeper.completedQuest, undefined);
    assert.equal(s.actors.keeper.want.step.verb, "call");
    assert.equal(met(s).length, 0);
  }
});

test("quiet selection completes an already-docked ship exactly once before learning", () => {
  const s = arrangement();
  s.crossings[crossing].discovered = true;
  s.actors.vale.heldItem = null;
  const turn = s.turn;
  choose(s, "cloth");
  assert.equal(s.turn, turn);
  assert.deepEqual([s.actors.keeper.completedQuest.by, s.actors.keeper.completedQuest.turn], ["vale", turn]);
  assert.equal(s.actors.keeper.level, 2);
  assert.equal(recordOf(s, "vale").calls, 1);
  assert.equal(s.actors.keeper.trust.vale, 1);
  assert(!knowsFact(s, "vale", fact));
  assert.equal(tableQuest(s, "vale", "keeper").quest.completed.by, "vale");
  choose(s, "cloth");
  assert.equal(met(reload(s)).length, 1);
  assert.equal(s.actors.keeper.trust.vale, 1);
});

test("the drop records Vale before Pip can take the Lamp that same turn", () => {
  const s = arrangement();
  s.actors.moth.place = "pond";
  s.items.lamp.holder = "vale";
  const done = act(s, "drop", "pond", "lamp");
  assert.equal(done.items.lamp.holder, "moth");
  assert.equal(done.actors.keeper.completedQuest.by, "vale");
  assert.deepEqual(met(done).map((e) => e.actorId), ["vale"]);
  const drop = done.log.find((e) => e.verb === "drop" && e.itemId === "lamp");
  const take = done.log.find((e) => e.verb === "take" && e.actorId === "moth" && e.itemId === "lamp");
  assert(drop.seq < met(done)[0].seq && met(done)[0].seq < take.seq);
});

test("known helpers receive shared credit without being named as the caller", () => {
  const s = arrangement();
  s.sharedVersion = 1;
  seatActors(s, ["vale", "mara"], ["vale", "mara"]);
  learnTold(s, "keeper", "mara");
  choose(s, "cloth");
  assert.equal(s.actors.keeper.completedQuest.by, "vale");
  assert.deepEqual(met(s).map((e) => e.actorId), ["vale"]);
  assert.equal(recordOf(s, "mara").calls, 1);
  assert.equal(s.actors.keeper.trust.mara, 1);
  assert.equal(s.actors.keeper.level, 2);
  assert.deepEqual(reload(s).actors.keeper.completedQuest, s.actors.keeper.completedQuest);
});

test("later Talk, custody changes, dawn replacement and reload cannot repay the deed", () => {
  let s = arrangement();
  choose(s, "cloth");
  const receipt = structuredClone(s.actors.keeper.completedQuest);
  s = act(act(s, "take", undefined, "lamp"), "move", "station");
  s = act(s, "talk", "keeper");
  assert.equal(s.knowledge.known.vale[fact].teller, "keeper");
  s.turn += 48;
  s.revision += 48;
  fillWants(s, wantAPI(s), true);
  renewWant(s, "keeper", wantAPI(s));
  s = reload(s);
  assert.equal(s.actors.keeper.want, null);
  assert.deepEqual(s.actors.keeper.completedQuest, receipt);
  assert.equal(s.actors.keeper.trust.vale, 1);
  assert.equal(s.actors.keeper.level, 2);
  assert.equal(met(s).length, 1);
  assert.match(offerWords(tableQuest(s, "vale", "keeper").quest), /Vale called the ship/u);
  assert.equal(wantFact(s, "keeper", nameOf, "vale"), "Vale called the ship for me.");
  s.actors.keeper.completedQuest.by = "nobody";
  assert.throws(() => validateWorld(s));
});

test("refuses a trade after the call without treating completion as a live want", () => {
  let s = arrangement();
  choose(s, "cloth");
  const receipt = structuredClone(s.actors.keeper.completedQuest);
  s = act(act(s, "take", undefined, "lamp"), "move", "station");
  s = act(s, "trade", "keeper", "lamp");
  const trade = s.log.findLast((e) => e.verb === "trade" && e.actorId === "vale");
  assert.equal(trade.accepted, false);
  assert.equal(trade.reason, "wants-something-else");
  assert.equal(trade.wantId, undefined);
  assert.equal(s.actors.keeper.want, null);
  assert.deepEqual(reload(s).actors.keeper.completedQuest, receipt);
  assert.equal(s.actors.keeper.trust.vale, 1);
  assert.equal(met(s).length, 1);
});

test("a completed call does not pin the keeper as an escort", () => {
  const s = arrangement();
  choose(s, "cloth");
  assert.equal(toldWant(s, "vale", "keeper"), true);
  assert.equal(pinnedCompanion(s, "vale", "keeper"), false);
  assert.equal(tableQuest(s, "vale", "keeper").quest.completed.by, "vale");
});
