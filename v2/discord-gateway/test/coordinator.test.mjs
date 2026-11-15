import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { emptyState } from "../src/channel.mjs";
import { noteSoon, payload, refresh } from "../src/coordinator.mjs";
import { createRoom, createStats, record, summary, tick } from "../src/room.mjs";

const config = readConfig({ ORCHESTRATOR_URL: "https://cosyworld.example", DISCORD_COORDINATE_INLINE_MS: "20" });
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

function jev(respond = {}, owed = null, members = {}) {
  return { answers: { respond, owed, members }, reason: "ok" };
}

function fixture(answers) {
  const room = createRoom("g1", "c1");
  room.webhookId = "hook";
  const fixed = { room, rooms: new Map([["c1", room]]), state: emptyState(), stats: createStats(), asked: [], logs: [], calls: [] };
  fixed.coordinate = async (body) => {
    fixed.calls.push(body);
    const next = answers.shift();
    return next;
  };
  return fixed;
}

async function beat(fixed, now, text = "Mm.", extra = {}) {
  await tick({
    rooms: fixed.rooms,
    state: fixed.state,
    now,
    config,
    cast,
    lines: async (body) => {
      fixed.asked.push(body.addressed);
      return { lines: [{ id: body.addressed ?? "rati", text: `${text} ${fixed.asked.length}.` }] };
    },
    send: async () => ({ id: `s${now}-${fixed.asked.length}`, createdTimestamp: now }),
    save: () => {},
    log: (line) => fixed.logs.push(line),
    stats: fixed.stats,
    coordinate: fixed.coordinate,
    ...extra,
  });
}

function hear(fixed, ...args) {
  record(fixed.room, say(...args), "hook", cast, fixed.stats);
}

test("the addressed resident answers first and Jev adds a second responder", async () => {
  const fixed = fixture([jev({ vale: 0.95, rati: 0.8, skull: 0.1 })]);
  hear(fixed, "m1", 0, "RATi and Vale, have you met?", A);
  await beat(fixed, 2000);
  assert.deepEqual(fixed.asked, ["rati", "vale"]);
  assert.equal(fixed.stats.actions.join, 1);
  const body = fixed.calls[0];
  assert.deepEqual(body.residents.slice(0, 2), ["rati", "vale"]);
  assert.deepEqual(body.state.history[0], { person: "Ash", text: "RATi and Vale, have you met?", ago: 2, named: ["RATi", "Vale"] });
  assert.ok(fixed.logs.includes("coordinator update owed=none respond=vale:0.95,rati:0.80,skull:0.10 members=none guild=g1 channel=c1"));
  assert.ok(fixed.logs.every((line) => !line.includes("met") && !line.includes("Ash")));
});

test("responders are capped and a human message cancels the rest", async () => {
  const many = { ...config, DISCORD_MAX_RESPONDERS: 3 };
  const cut = fixture([jev({ rati: 0.9, vale: 0.8, skull: 0.7 })]);
  hear(cut, "m1", 0, "RATi, everyone, what is that noise?", A);
  let pauses = 0;
  const sleep = async () => {
    pauses += 1;
    if (pauses === 2) hear(cut, "m2", 3000, "never mind", B);
  };
  await beat(cut, 2000, "Mm.", { config: many, sleep });
  assert.deepEqual(cut.asked, ["rati", "vale"]);
  const two = fixture([jev({ rati: 0.9, vale: 0.8, skull: 0.7 })]);
  hear(two, "m1", 0, "RATi, everyone, what is that noise?", A);
  await beat(two, 2000);
  assert.deepEqual(two.asked, ["rati", "vale"]);
});

test("Jev picks who answers a member line and who is owed", async () => {
  const fixed = fixture([jev({ rati: 0.2 }, { choice: "a person", confidence: 0.9 })]);
  hear(fixed, "m1", 0, "RATi, hello", A);
  fixed.room.jev = { answers: {}, at: 0 };
  await beat(fixed, 2000);
  hear(fixed, "m2", 10000, "ash you should come by later", B);
  await beat(fixed, 12000);
  assert.deepEqual(fixed.asked, ["rati"]);
  assert.equal(fixed.stats.skips["conversation-owed-human"], 1);
  assert.ok(fixed.logs.some((line) => line.startsWith("coordinator update owed=person ")));
});

test("membership follows Jev: a resident drifts out, a person comes in", async () => {
  const fixed = fixture([jev({}, null, { rati: 0.1, vale: 0.9, Bea: 0.95, Ash: 0.05 })]);
  hear(fixed, "m1", 0, "RATi, hello", A);
  hear(fixed, "m2", 1000, "evening Vale", B);
  const pending = [];
  noteSoon(fixed.room, { config, cast, coordinate: fixed.coordinate, stats: fixed.stats, log: () => {} }, { setTimeout: (fn) => pending.push(fn), clearTimeout: () => {} });
  pending[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixed.room.talks.rati, undefined);
  assert.deepEqual(fixed.room.talks.vale.members, ["h:ub"]);
});

test("a miss falls back to the rules and the summary warns when every call missed", async () => {
  const fixed = fixture([{ answers: null, reason: "jev-timeout" }]);
  hear(fixed, "m1", 0, "RATi, hello", A);
  fixed.room.jev = { answers: {}, at: 0 };
  await beat(fixed, 2000);
  hear(fixed, "m2", 10000, "and how are you", A);
  await beat(fixed, 12000);
  assert.deepEqual(fixed.asked, ["rati", "rati"]);
  assert.ok(fixed.logs.includes("coordinator miss reason=jev-timeout guild=g1 channel=c1"));
  assert.equal(fixed.stats.coordinator.fallbacks, 1);
  assert.match(summary(fixed.stats), /^coordinator all-missing misses=\d+\nsummary /);
  assert.match(summary(fixed.stats), /^summary /);
});

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
  const fixed = fixture([]);
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
