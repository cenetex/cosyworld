import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { emptyState } from "../src/channel.mjs";
import { noteSoon } from "../src/coordinator.mjs";
import { createRoom, createStats, record, tick } from "../src/room.mjs";

const config = readConfig({ ORCHESTRATOR_URL: "https://cosyworld.example", DISCORD_COORDINATE_INLINE_MS: "20" });
const cast = [
  { id: "rati", name: "RATi" },
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

function notes(owed, speak = "none") {
  return { choice: { topic: "gin", goal: "talk about gin", summary: "Ash and Bea talk with RATi.", owed, speak } };
}

function fixture(answers) {
  const room = createRoom("g1", "c1");
  room.webhookId = "hook";
  const fixed = { room, rooms: new Map([["c1", room]]), state: emptyState(), stats: createStats(), asked: [], logs: [], calls: [] };
  fixed.coordinate = async (body, signal) => {
    fixed.calls.push(body);
    const next = answers.shift();
    if (next === "hang") return new Promise((resolve) => signal.addEventListener("abort", () => resolve(null)));
    return next;
  };
  return fixed;
}

async function beat(fixed, now, text = "Mm.") {
  await tick({
    rooms: fixed.rooms,
    state: fixed.state,
    now,
    config,
    cast,
    lines: async (body) => {
      fixed.asked.push(body.addressed);
      return { lines: [{ id: body.addressed ?? "rati", text }] };
    },
    send: async () => ({ id: `s${now}`, createdTimestamp: now }),
    save: () => {},
    log: (line) => fixed.logs.push(line),
    stats: fixed.stats,
    coordinate: fixed.coordinate,
  });
}

function hear(fixed, ...args) {
  record(fixed.room, say(...args), "hook", cast, fixed.stats);
}

test("the coordinator says RATi is owed after Bea's reply and after Ash's late line", async () => {
  const fixed = fixture([notes("rati", "rati"), notes("RATi", "rati")]);
  hear(fixed, "m1", 0, "RATi, do you like tea?", A);
  await beat(fixed, 2000, "With honey, always.");
  hear(fixed, "m2", 20000, "pour him gin instead", B, "m1");
  await beat(fixed, 22000, "One small glass.");
  hear(fixed, "m3", 22000 + 240000, "maple syrup gin", A);
  await beat(fixed, 22000 + 242000, "That sounds like a dare.");
  assert.deepEqual(fixed.asked, ["rati", "rati", "rati"]);
  assert.equal(fixed.calls.length, 2);
  assert.equal(fixed.calls[1].notes.topic, "gin");
  assert.deepEqual(fixed.calls[1].messages.at(-1), { author: "Ash", text: "maple syrup gin" });
  assert.ok(fixed.logs.includes("decision act=reply reason=conversation-owed guild=g1 channel=c1"));
  assert.ok(fixed.logs.includes("coordinator update owed=rati speak=rati topic=3 goal=14 summary=27 guild=g1 channel=c1"));
  assert.ok(fixed.logs.every((line) => !line.includes("gin") && !line.includes("Ash")));
  assert.deepEqual(fixed.stats.coordinator, { updates: 2 });
});

test("a person owed the next line keeps the resident quiet", async () => {
  const fixed = fixture([notes("Ash")]);
  hear(fixed, "m1", 0, "RATi, hello", A);
  await beat(fixed, 2000, "Hello.");
  hear(fixed, "m2", 10000, "ash you should come by later", B);
  await beat(fixed, 12000);
  assert.deepEqual(fixed.asked, ["rati"]);
  assert.equal(fixed.stats.skips["conversation-owed-human"], 1);
  assert.ok(fixed.logs.some((line) => line.startsWith("coordinator update owed=person ")));
});

test("a bad coordinator answer keeps the old notes and falls back to the rules", async () => {
  const fixed = fixture([{ choice: { topic: "", goal: "g", summary: "s", owed: "rati", speak: "rati" } }]);
  hear(fixed, "m1", 0, "RATi, hello", A);
  await beat(fixed, 2000, "Hello.");
  const old = { topic: "tea", goal: "chat", summary: "Ash greets RATi.", owed: "none" };
  fixed.room.talks.rati.notes = old;
  fixed.room.talks.rati.notedAt = 2000;
  hear(fixed, "m2", 10000, "and how are you", A);
  await beat(fixed, 12000);
  assert.deepEqual(fixed.room.talks.rati.notes, old);
  assert.deepEqual(fixed.asked, ["rati", "rati"]);
  assert.deepEqual(fixed.stats.coordinator, { misses: 1, fallbacks: 1 });
});

test("stale notes get an inline call that falls back when it misses its deadline, fresh notes do not", async () => {
  const fixed = fixture(["hang"]);
  hear(fixed, "m1", 0, "RATi, hello", A);
  await beat(fixed, 2000, "Hello.");
  hear(fixed, "m2", 10000, "and the kettle", A);
  const started = Date.now();
  await beat(fixed, 12000);
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(fixed.asked, ["rati", "rati"]);
  assert.ok(fixed.logs.includes("coordinator miss reason=timeout guild=g1 channel=c1"));
  fixed.room.talks.rati.notes = { topic: "tea", goal: "chat", summary: "s", owed: "none" };
  fixed.room.talks.rati.notedAt = 99999999;
  hear(fixed, "m3", 20000, "anyway", A);
  await beat(fixed, 22000);
  assert.equal(fixed.calls.length, 1);
  assert.equal(fixed.stats.skips["conversation-owed-human"], 1);
});

test("notes refresh off the reply path, once after a burst", async () => {
  const fixed = fixture([notes("rati")]);
  const pending = [];
  const timers = { setTimeout: (fn) => pending.push(fn), clearTimeout: () => pending.splice(0, pending.length - 1) };
  hear(fixed, "m1", 0, "RATi, hello", A);
  const deps = { config, cast, coordinate: fixed.coordinate, stats: fixed.stats, log: () => {} };
  noteSoon(fixed.room, deps, timers);
  hear(fixed, "m2", 1000, "are you there", A);
  noteSoon(fixed.room, deps, timers);
  assert.equal(fixed.calls.length, 0);
  pending.at(-1)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixed.calls.length, 1);
  assert.equal(fixed.room.talks.rati.notes.owed, "rati");
  assert.equal(fixed.room.talks.rati.notedAt, 1000);
});
