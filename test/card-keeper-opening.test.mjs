import { test } from "vitest";
import assert from "node:assert/strict";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import { decodeSave, encodeSave, holdChoice, legalActions, nameOf, senses, validateWorld, wantAPI } from "../v2/card-game/world.mjs";
import { settleCrossingUnlocks } from "../v2/card-game/quest-call.mjs";
import { knowledgeFacts, knowsFact } from "../v2/card-game/knowledge.mjs";
import { learnTold } from "../v2/card-game/quest-learn.mjs";
import { besideOwners, tableOwner, tableQuest, tableQuests } from "../v2/card-game/quest-hand.mjs";
import { offerWords } from "../v2/card-game/quest-card.mjs";
import { availableCards, cardPlay } from "../v2/card-game/cards.mjs";
import { fillWants, renewWant } from "../v2/card-game/want.mjs";
import { fillLampFuel } from "../v2/card-game/lamp-state.mjs";
import { recordOf } from "../v2/card-game/world/arcana-record.mjs";
import { seatActors } from "../v2/card-game/human-cast.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { wantFact } from "../v2/card-game/want-talk.mjs";
import { toldWant } from "../v2/card-game/talk-quest.mjs";
import { readPage } from "../v2/card-game/read-view.mjs";
import { publishPipReply } from "./helpers/pip-clue.mjs";
import { act, reload } from "./helpers/play.mjs";

const crossing = "pond-greek-harbor", fact = "quest:keeper:pond";
const choose = (s, item) => holdChoice(s, "vale", { item, revision: s.revision });
const met = (s) => s.log.filter((e) => e.verb === "want_met" && e.ownerId === "keeper");
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
  s = act(act(s, { kind: "move", target: "pond" }), { kind: "talk", target: "moth" });
  assert(!knowsFact(s, "vale", fact));
  s = publishPipReply(s);
  assert.equal(s.knowledge.known.vale[fact].teller, "moth");
  const ids = availableCards(s), table = tableQuests(s, "vale", ids);
  const lead = table.find((t) => t.owner === "keeper");
  assert(!ids.includes("keeper"));
  assert.equal(lead.beside, "moth");
  assert.match(offerWords(lead.quest), /via Pip: Hold Black cloth at Black pond; keep the Lamp burning/u);
  const hidden = offerWords(lead.quest, (id) => id !== "lamp");
  assert.match(hidden, /keep a light burning/u);
  assert.doesNotMatch(hidden, /Lamp/u);
  const undiscovered = offerWords(lead.quest, () => false);
  assert.doesNotMatch(undiscovered, /Black cloth|Black pond|Lamp/u);
  assert.match(undiscovered, /keep a light burning on the ground/u);
  assert.equal(tableOwner(lead.id, s, "vale"), "moth");
  const row = besideOwners(ids, table, s);
  assert(row.indexOf(lead.id) > row.indexOf("moth"));
  const words = knowledgeFacts(s, "vale", nameOf).find((line) => line.includes("call the ship"));
  assert.match(words, /Pip told me this just now at Black pond/u);
  assert.match(words, /The keeper made the request at Empty station/u);
});

test("the fixed Station log teaches the same call without Pip and keeps the lead at the Pond", () => {
  let s = createLandingWorld(null, 23);
  choose(s, null);
  s = act(act(s, { kind: "move", target: "pond" }), { kind: "move", target: "station" });
  const book = "keeper-log";
  assert.equal(s.items[book].holder, "station");
  assert.equal(cardPlay(s, [book]).action?.kind, "read");
  assert(!legalActions(s, "vale").some((a) => a.kind === "take" && a.item === book));
  assert(!knowsFact(s, "vale", fact));
  s.actors.moth.place = "attic";
  const seen = s.eventSeq;
  s = act(s, { kind: "read", item: book });
  const entry = s.log.findLast((e) => e.verb === "read" && e.actorId === "vale");
  assert(!entry.witnesses.includes("moth"));
  assert.deepEqual(s.knowledge.known.vale[fact], {
    kind: "read", teller: null, book, eventSeq: entry.seq, learnedTurn: entry.turn,
  });
  assert.deepEqual(Object.keys(s.knowledge.facts).filter((id) => id.startsWith("quest:keeper:")), [fact]);
  const page = readPage(s, "vale", seen);
  assert.equal(page.author, "The keeper");
  assert.equal(page.claims.length, 2);
  assert.match(page.claims[0], /Black cloth held in hand/u);
  assert.match(page.claims[1], /next call at Black pond/u);
  assert.match(s.knowledge.facts[fact].text, /The keeper wants you to call the ship/u);
  assert.equal(s.items[book].holder, "station");
  assert.equal(s.crossings[crossing].discovered, false);
  assert.equal(met(s).length, 0);

  s = reload(act(s, { kind: "move", target: "pond" }));
  assert.equal(s.knowledge.known.vale[fact].book, book);
  const ids = availableCards(s), table = tableQuests(s, "vale", ids);
  const lead = table.find((entry) => entry.owner === "keeper");
  assert(!ids.includes("moth") && !ids.includes("keeper"));
  assert.equal(lead.beside, "pond");
  assert.equal(lead.quest.readFrom, book);
  assert.equal(tableOwner(lead.id, s, "vale"), "pond");
  assert.match(offerWords(lead.quest), /The keeper via The keeper’s log/u);
  assert(besideOwners(ids, table, s).includes(lead.id));
});

test("an old save gains the fixed log at Station, and a moved log is invalid", () => {
  const old = JSON.parse(encodeSave(createLandingWorld(null, 23)));
  const book = "keeper-log";
  delete old.items[book];
  delete old.memories[book];
  const s = decodeSave(JSON.stringify(old));
  assert.equal(s.items[book].holder, "station");
  assert(s.memories[book]);
  s.items[book].holder = "vale";
  assert.throws(() => validateWorld(s), { check: "item:keeper-log:holder" });
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
  const done = act(s, { kind: "drop", target: "pond", item: "lamp" });
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
});

test("later Talk, custody changes, dawn replacement and reload cannot repay the deed", () => {
  let s = arrangement();
  choose(s, "cloth");
  const receipt = structuredClone(s.actors.keeper.completedQuest);
  s = act(act(s, { kind: "take", item: "lamp" }), { kind: "move", target: "station" });
  s = act(s, { kind: "talk", target: "keeper" });
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
  s = act(act(s, { kind: "take", item: "lamp" }), { kind: "move", target: "station" });
  s = act(s, { kind: "trade", target: "keeper", item: "lamp" });
  const trade = s.log.findLast((e) => e.verb === "trade" && e.actorId === "vale");
  assert.equal(trade.accepted, false);
  assert.equal(trade.reason, "wants-something-else");
  assert.equal(trade.wantId, undefined);
  assert.equal(s.actors.keeper.want, null);
  assert.deepEqual(s.actors.keeper.completedQuest, receipt);
  assert.equal(s.actors.keeper.trust.vale, 1);
  assert.equal(met(s).length, 1);
});

test("a completed call does not pin the keeper as an escort", () => {
  const s = arrangement();
  choose(s, "cloth");
  assert.equal(toldWant(s, "vale", "keeper"), true);
  assert.equal(s.actors.vale.companion, undefined);
  assert.equal(tableQuest(s, "vale", "keeper").quest.completed.by, "vale");
});
