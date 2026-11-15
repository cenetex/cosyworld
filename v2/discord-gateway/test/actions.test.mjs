import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { emptyState } from "../src/channel.mjs";
import { createRoom, createStats, reaction, record, summary, tick } from "../src/room.mjs";

const config = readConfig({ ORCHESTRATOR_URL: "https://cosyworld.example" });
const cast = [
  { id: "rati", name: "RATi" },
  { id: "skull", name: "Skull" },
];

function human(id, at, content, user = "u1") {
  return { id, createdTimestamp: at, content, author: { id: user, bot: false }, member: { displayName: "Mara" } };
}

function fixture() {
  const room = createRoom("g1", "c1");
  room.webhookId = "hook";
  return { room, rooms: new Map([["c1", room]]), state: emptyState(), stats: createStats() };
}

function beat({ room, rooms, state, stats }, now, reply = null, extra = {}) {
  const calls = [];
  const reactions = [];
  const done = tick({
    rooms,
    state,
    now,
    config,
    cast,
    lines: async (body) => {
      calls.push(body);
      return reply ? { lines: [{ id: "rati", text: reply }] } : { lines: [], reason: "no-speaker" };
    },
    send: async () => ({ id: `s${now}`, createdTimestamp: now }),
    react: async (target, messageId, emoji) => reactions.push([messageId, emoji]),
    save: () => {},
    stats,
    ...extra,
  });
  return done.then(() => ({ calls, reactions }));
}

test("each resident reacts from its own small set", () => {
  assert.ok(["☕", "🌿", "✨"].includes(reaction("rati", "123")));
  assert.ok(["💀", "🕯️", "👀"].includes(reaction("skull", "123")));
  assert.equal(reaction("rati", "123"), reaction("rati", "123"));
  assert.equal(reaction("stranger", "1"), "🌲");
});

test("a low-signal message to a focused resident gets a reaction, not a line", async () => {
  const fixed = fixture();
  record(fixed.room, human("m1", 0, "RATi, the kettle?"), "hook", cast, fixed.stats);
  await beat(fixed, 9000, "It is on.");
  record(fixed.room, human("m2", 20000, "ty"), "hook", cast, fixed.stats);
  const { calls, reactions } = await beat(fixed, 22000);
  assert.equal(calls.length, 0);
  assert.deepEqual(reactions, [["m2", reaction("rati", "m2")]]);
  assert.deepEqual(fixed.stats.actions, { speak: 1, react: 1 });
  assert.equal(fixed.room.talks.rati.last, 22000);
  record(fixed.room, human("m3", 400000, "lol", "u2"), "hook", cast, fixed.stats);
  const stranger = await beat(fixed, 410000);
  assert.deepEqual(stranger.reactions, []);
  assert.equal(fixed.stats.actions.silent, 1);
});

test("reactions are capped per minute and a failed reaction is counted", async () => {
  const fixed = fixture();
  fixed.room.talks = { rati: { members: ["h:u1"], last: 0, spoke: 0 } };
  for (let n = 1; n <= 4; n += 1) {
    record(fixed.room, human(`m${n}`, n * 2000, "ok"), "hook", cast, fixed.stats);
    await beat(fixed, n * 2000 + 1500);
  }
  assert.equal(fixed.stats.actions.react, 3);
  assert.equal(fixed.stats.skips["reaction-cap"], 1);
  record(fixed.room, human("m9", 70000, "ok"), "hook", cast, fixed.stats);
  await beat(fixed, 72000, null, {
    react: async () => {
      throw new Error("missing permission");
    },
  });
  assert.equal(fixed.stats.failures.react, 1);
});

test("an addressed message always speaks, even when residents fill the window", async () => {
  const fixed = fixture();
  fixed.room.messages.push(
    { id: "r1", at: 0, text: "One.", resident: "rati" },
    { id: "r2", at: 1, text: "Two.", resident: "skull" },
  );
  record(fixed.room, human("m1", 2, "RATi, again?"), "hook", cast, fixed.stats);
  const { calls } = await beat(fixed, 9000, "Again.");
  assert.equal(calls[0].addressed, "rati");
  assert.equal(fixed.stats.actions.speak, 1);
});

test("the summary counts actions, rates, and lines nobody answered", async () => {
  const fixed = fixture();
  record(fixed.room, human("m1", 0, "RATi, the path?"), "hook", cast, fixed.stats);
  await beat(fixed, 9000, "Left, then");
  record(fixed.room, human("m2", 9000 + 60000, "thanks RATi"), "hook", cast, fixed.stats);
  assert.equal(fixed.stats.answered, 1);
  await beat(fixed, 9000 + 61500, "Mind the roots.");
  await beat(fixed, 9000 + 61500 + 300001);
  assert.equal(fixed.stats.ignored, 1);
  assert.equal(
    summary(fixed.stats),
    "summary replies=2 actions=continue:2,speak:2 continuation=1.00 reactions=0.00 exchanges=0 ignored=0.50 flags=none conversation=none coordinator=none skips=none failures=none",
  );
});
