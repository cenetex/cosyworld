import assert from "node:assert/strict";
import { decodeSave, encodeSave } from "../../v2/card-game/world.mjs";
import { dispatchShared } from "../../v2/card-game/shared-world.mjs";
import { packDefinition } from "../../v2/card-game/pack-registry.mjs";
import { questCards, questHistoryCards } from "../../v2/card-game/quest-cards.mjs";
import { questCarried, questHolderActor } from "../../v2/card-game/quest-hands.mjs";
import { knowsFact } from "../../v2/card-game/knowledge.mjs";
import { readingWalk } from "./greek-readings.mjs";

const PACK = "greek-drama";
const HUMANS = ["vale", "mara", "ash"];

// Start the shared fixture where Mara meets the author and the signed record.
// Every take, Talk, road step and reading below uses the shared action path.
export function sharedReturnReading(original, {
  prefix, item, topicId, storyId = `${prefix}-return`, checkArchive = false,
}) {
  const created = dispatchShared({ op: "create", save: encodeSave(original) });
  assert.equal(created.ok, true, created.error);
  let world = created.world;
  world.actors.mara.place = world.actors.vale.place;
  world.actors.ash.place = "greek-courtyard";
  const initial = structuredClone(world), journal = [];
  const key = `${PACK}:${storyId}`;
  const siteId = `${prefix}-homecoming`;
  const choice = `${prefix}-read-home`;
  const topic = packDefinition(PACK).topics.find((entry) => entry.id === topicId);
  assert.ok(topic);
  const prior = structuredClone(world.packs[PACK]);
  const completed = Object.fromEntries(Object.entries(world.quests.records)
    .filter(([, q]) => q.mode === "story" && q.completion)
    .map(([id, q]) => [id, structuredClone(q.completion)]));
  const request = (op, actor, fields = {}) => {
    const command = { op, actor, claimed: HUMANS, present: HUMANS, ...fields };
    const reply = dispatchShared({ ...command, world });
    assert.equal(reply.ok, true, reply.error);
    if (op !== "view") {
      world = reply.world;
      journal.push(structuredClone(command));
    }
    return reply;
  };
  const act = (actor, kind, fields = {}) => {
    const action = request("view", actor).actions.find((candidate) =>
      candidate.kind === kind && Object.entries(fields).every(([k, v]) => candidate[k] === v));
    assert.ok(action, `${actor} ${kind} ${JSON.stringify(fields)}`);
    return request("play", actor, { action, revision: world.revision });
  };
  const pending = (state = world) => {
    const record = state.quests.records[key];
    assert.deepEqual(record.holder, { kind: "item", id: item });
    assert.equal(record.completedTurn, null);
    assert.ok(questHistoryCards(state, "mara").some((q) => q.key === key && q.completedTurn === null));
    assert.equal(questCarried(state, "mara", key), true);
    assert.ok(questCards(state, "mara").some((q) => q.key === key));
  };
  const reload = () => {
    const loaded = decodeSave(encodeSave(world));
    assert.deepEqual(loaded, world);
    world = loaded;
  };
  const earlierEvidence = () => {
    for (const [id, turn] of Object.entries(prior.receipts))
      assert.equal(world.packs[PACK].receipts[id], turn);
    for (const [id, verse] of Object.entries(prior.recitals)) {
      assert.equal(world.packs[PACK].recitals[id].actor, verse.actor);
      if (verse.visit !== null)
        assert.equal(world.packs[PACK].recitals[id].visit, verse.visit);
    }
    for (const [id, evidence] of Object.entries(completed))
      assert.deepEqual(world.quests.records[id].completion, evidence);
  };

  for (const action of request("view", "mara").actions.filter((a) => a.kind === "drop-quest"))
    request("play", "mara", { action });
  assert.equal(questHistoryCards(world, "mara").some((q) => q.key === key), false);
  act("mara", "take", { item });
  assert.equal(questHolderActor(world, world.quests.records[key]), "mara");
  pending();
  reload();
  pending();
  assert.equal(knowsFact(world, "mara", topicId), false);
  const { context } = act("mara", "talk", { target: topic.speaker });
  assert.equal(context.disclosures[0].factId, topicId);
  pending();
  request("speech", "mara", {
    room: world.actors.mara.place,
    disclosures: context.disclosures,
    lines: [
      { actorId: "mara", text: "Please read the signed account for Dione." },
      { actorId: topic.speaker, text: context.disclosures[0].text },
    ],
  });
  assert.equal(knowsFact(world, "mara", topicId), true);
  pending();
  earlierEvidence();
  readingWalk(world, "mara", "greek-courtyard", (_state, kind, fields, actor) => {
    act(actor, kind, fields);
    return world;
  });
  pending();
  assert.equal(world.quests.records[key].participants.includes("mara"), false);
  act("mara", "read", { readingOp: "invite", siteId, invitee: "ash" });
  act("mara", "read", { readingOp: "start", siteId });
  const readingId = `site:${siteId}:mara`;
  assert.equal(world.items[item].holder, "greek-courtyard");
  assert.equal(world.quests.records[key].participants.includes("mara"), true);
  assert.equal(world.quests.records[key].participants.includes("ash"), false);
  pending();
  reload();
  pending();

  if (checkArchive) {
    // An earlier save can retain a valid reading start after its action log
    // has been pruned. Loading it reconstructs the reader's task membership.
    const pruned = structuredClone(world);
    pruned.log = [];
    pruned.quests.records[key].participants = pruned.quests.records[key].participants.filter((id) => id !== "mara");
    pruned.quests.hands.mara = pruned.quests.hands.mara.filter((id) => id !== key);
    delete pruned.quests.focus.mara;
    const restored = decodeSave(JSON.stringify(pruned));
    pending(restored);
    assert.ok(restored.quests.records[key].participants.includes("mara"));
    assert.deepEqual(restored.packs[PACK].poemReadings, world.packs[PACK].poemReadings);
    assert.deepEqual(restored.packs[PACK].recitals, world.packs[PACK].recitals);
    assert.ok(world.packs[PACK].poemReadings.readings[readingId].selection.length > 4);
  }
  while (!world.packs[PACK].poemReadings.readings[readingId].complete) {
    act("mara", "read", { readingOp: "page", readingId });
    if (!world.packs[PACK].poemReadings.readings[readingId].complete) {
      pending();
      reload();
      pending();
    }
  }
  const record = world.quests.records[key];
  assert.equal(record.completedTurn, world.packs[PACK].receipts[choice]);
  assert.equal(record.completion.actorId, "mara");
  assert.equal(world.packs[PACK].recitals[choice].actor, "mara");
  assert.equal(world.packs[PACK].poemReadings.decisions[choice], readingId);
  assert.equal(record.participants.includes("ash"), false);
  earlierEvidence();
  reload();
  if (checkArchive) {
    const evidence = structuredClone(world.quests.records[key]);
    act("ash", "read", { readingOp: "start", siteId });
    assert.deepEqual(world.quests.records[key], evidence);
    assert.equal(questHistoryCards(world, "ash").some((q) => q.key === key), false);
    assert.equal(world.packs[PACK].recitals[choice].actor, "mara");
    reload();
  }
  let replay = structuredClone(initial);
  for (const command of journal) {
    const reply = dispatchShared({ ...command, world: replay });
    assert.equal(reply.ok, true, reply.error);
    replay = reply.world;
  }
  assert.deepEqual(replay, world);
  return world;
}
