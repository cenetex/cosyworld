import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { emptyState } from "../src/channel.mjs";
import { attend } from "../src/attention.mjs";
import { createRoom, createStats, record, summary, tick } from "../src/room.mjs";

const config = readConfig({ ORCHESTRATOR_URL: "https://cosyworld.example" });
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

function fixture() {
  const room = createRoom("g1", "c1");
  room.webhookId = "hook";
  return { room, rooms: new Map([["c1", room]]), state: emptyState(), stats: createStats(), asked: [], logs: [] };
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
  });
}

function hear(fixed, ...args) {
  record(fixed.room, say(...args), "hook", cast, fixed.stats);
}

test("a second person who replies to a member, and a late unmentioned line, both reach the resident", async () => {
  const fixed = fixture();
  hear(fixed, "m1", 0, "RATi, do you like tea?", A);
  await beat(fixed, 2000, "With honey, always.");
  hear(fixed, "m2", 10000, "what about gin", A, "s2000");
  await beat(fixed, 12000, "Gin is for later.");
  hear(fixed, "m3", 20000, "he's from bc", B, "m2");
  await beat(fixed, 22000, "Then he knows cold nights.");
  hear(fixed, "m4", 30000, "pour him gin instead", B, "m2");
  await beat(fixed, 32000, "One small glass.");
  hear(fixed, "m5", 32000 + 240000, "maple syrup gin", A);
  await beat(fixed, 32000 + 242000, "That sounds like a dare.");
  assert.deepEqual(fixed.asked, ["rati", "rati", "rati", "rati", "rati"]);
  assert.ok(fixed.logs.includes("decision act=reply reason=conversation-member guild=g1 channel=c1"));
  assert.deepEqual(fixed.room.talks.rati.members, ["h:ua", "h:ub"]);
  assert.match(summary(fixed.stats), /conversation=conversation-member:3/);
});

test("a conversation ends five minutes after its last message", async () => {
  const fixed = fixture();
  hear(fixed, "m1", 0, "RATi, are you there?", A);
  await beat(fixed, 2000, "I am.");
  hear(fixed, "m2", 2000 + 300001, "anyone around", A);
  assert.deepEqual(attend(fixed.room.messages, cast, undefined, fixed.room), { resident: null, reason: null });
  const short = fixture();
  short.room.talkMs = 60000;
  hear(short, "m1", 0, "RATi, are you there?", A);
  await beat(short, 2000, "I am.");
  hear(short, "m2", 2000 + 60001, "and now", A);
  assert.equal(attend(short.room.messages, cast, undefined, short.room).resident, null);
});

test("two people replying to each other are left to talk, unless they ask something", async () => {
  const fixed = fixture();
  hear(fixed, "m1", 0, "RATi, hello", A);
  await beat(fixed, 2000, "Hello, Ash.");
  hear(fixed, "m2", 10000, "hi ash, long time", B, "m1");
  hear(fixed, "m3", 12000, "bea! yes far too long", A, "m2");
  assert.equal(attend(fixed.room.messages, cast, undefined, fixed.room).reason, "conversation-skip-humans-talking");
  await beat(fixed, 14000);
  assert.deepEqual(fixed.asked, ["rati"]);
  assert.equal(fixed.stats.skips["conversation-skip-humans-talking"], 1);
  hear(fixed, "m4", 20000, "so where did you go?", B, "m3");
  assert.deepEqual(attend(fixed.room.messages, cast, undefined, fixed.room), { resident: null, reason: "conversation-unclear", talk: "rati" });
  await beat(fixed, 22000);
  assert.deepEqual(fixed.asked, ["rati", null]);
});

test("with two residents in one conversation, the one who spoke last takes the turn", async () => {
  const fixed = fixture();
  hear(fixed, "m1", 0, "RATi, hi", A);
  await beat(fixed, 2000, "Hi.");
  hear(fixed, "m2", 10000, "Skull, you too", A);
  await beat(fixed, 12000, "Me too.");
  hear(fixed, "m3", 20000, "so what now", A);
  assert.equal(attend(fixed.room.messages, cast, undefined, fixed.room).resident, "skull");
  hear(fixed, "m4", 21000, "RATi, you choose", A);
  assert.equal(attend(fixed.room.messages, cast, undefined, fixed.room).resident, "rati");
});
