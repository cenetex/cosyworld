import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { payload, refresh } from "../src/coordinator.mjs";
import { createRoom, createStats, record } from "../src/room.mjs";

const config = readConfig({ ORCHESTRATOR_URL: "https://cosyworld.example" });
const cast = [
  { id: "rati", name: "RATi" },
  { id: "vale", name: "Vale" },
  { id: "skull", name: "Skull" },
];
const A = { id: "ua", bot: false };
const B = { id: "ub", bot: false };

function say(id, at, content, author, replyTo = null) {
  return {
    id,
    createdTimestamp: at,
    content,
    author,
    member: { displayName: author === A ? "Ash" : "Bea" },
    reference: replyTo ? { messageId: replyTo } : undefined,
  };
}

function fixture() {
  const room = createRoom("g1", "c1");
  room.webhookId = "hook";
  return { room, stats: createStats(), logs: [] };
}

function hear(fixed, ...args) {
  record(fixed.room, say(...args), "hook", cast, fixed.stats);
}

test("the payload keeps the hour of history and labels replies", () => {
  const room = createRoom("g1", "c1");
  for (let n = 0; n < 160; n += 1) record(room, say(`m${n}`, n * 1000, `line ${n}`, A), "hook", cast);
  record(room, say("r", 200000, "me too", B, "m159"), "hook", cast);
  const body = payload(room, config, cast, 200000);
  assert.equal(body.state.history.length, 150);
  assert.deepEqual(body.state.history.at(-1), { person: "Bea", text: "me too", ago: 0, replyTo: "Ash" });
  assert.deepEqual(body.state.participants.find((p) => p.name === "Bea").talkedTo, ["Ash"]);
  assert.equal(payload(room, config, cast, 200000 + 3600001 + 160000).state.history.length, 0);
});

test("notes refresh off the reply path every few messages and feed the Jev state", async () => {
  const fixed = fixture();
  const sent = [];
  const answers = [{ notes: { topic: "", goal: "g", summary: "s" } }, { notes: { topic: "tea", goal: "share tea", summary: "Ash asks RATi for tea." } }];
  const deps = { config, notes: async (body) => (sent.push(body), answers.shift()), log: (line) => fixed.logs.push(line) };
  for (let n = 1; n <= 3; n += 1) hear(fixed, `m${n}`, n * 1000, `RATi, tea ${n}?`, A);
  await refresh(fixed.room, deps);
  assert.equal(sent.length, 0);
  hear(fixed, "m4", 4000, "RATi, tea?", A);
  await refresh(fixed.room, deps);
  assert.equal(fixed.room.notes, undefined);
  for (let n = 5; n <= 8; n += 1) hear(fixed, `m${n}`, n * 1000, `more tea ${n}`, A);
  await refresh(fixed.room, deps);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].messages.at(-1), { author: "Ash", text: "more tea 8" });
  assert.equal(payload(fixed.room, config, cast, 9000).state.notes.topic, "tea");
  assert.deepEqual(fixed.logs, ["notes miss guild=g1 channel=c1", "notes update topic=3 goal=9 summary=22 guild=g1 channel=c1"]);
});
