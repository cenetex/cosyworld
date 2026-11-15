import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { emptyState } from "../src/channel.mjs";
import { createRoom, createStats, record, summary, tick } from "../src/room.mjs";

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
    save: () => {},
    stats,
    ...extra,
  });
  return done.then(() => ({ calls }));
}

test("a low-signal message stays silent, even to a resident in conversation", async () => {
  const fixed = fixture();
  record(fixed.room, human("m1", 0, "RATi, the kettle?"), "hook", cast, fixed.stats);
  await beat(fixed, 9000, "It is on.");
  record(fixed.room, human("m2", 20000, "ty"), "hook", cast, fixed.stats);
  const { calls } = await beat(fixed, 22000);
  assert.equal(calls.length, 0);
  assert.equal(fixed.stats.skips["low-signal"], 1);
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
    "summary replies=2 actions=continue:2,speak:2 continuation=1.00 exchanges=0 ignored=0.50 flags=none conversation=none coordinator=none skips=none failures=none",
  );
});
