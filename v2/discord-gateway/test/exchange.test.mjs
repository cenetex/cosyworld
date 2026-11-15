import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { emptyState } from "../src/channel.mjs";
import { createRoom, createStats, record, tick } from "../src/room.mjs";

const config = readConfig({ ORCHESTRATOR_URL: "https://cosyworld.example", DISCORD_CONTINUE_RATE: "0" });
const cast = [
  { id: "rati", name: "RATi" },
  { id: "skull", name: "Skull" },
  { id: "oak", name: "Oak" },
];

function human(id, at, content) {
  return { id, createdTimestamp: at, content, author: { id: "u1", bot: false }, member: { displayName: "Mara" } };
}

function fixture(text = "RATi, is anyone else awake?") {
  const room = createRoom("g1", "c1");
  room.webhookId = "hook";
  record(room, human("m1", 0, text), "hook", cast);
  return { room, rooms: new Map([["c1", room]]), state: emptyState() };
}

function run({ room, rooms, state }, script, extra = {}) {
  const bodies = [];
  const sent = [];
  const pauses = [];
  const stats = createStats();
  const done = tick({
    rooms,
    state,
    now: 9000,
    config,
    cast,
    lines: async (body) => {
      bodies.push(body);
      const next = script.shift();
      return next ? { lines: [{ id: next[0], text: next[1] }] } : { lines: [] };
    },
    send: async (target, payload) => {
      sent.push(`${payload.username}: ${payload.content}`);
      return { id: `s${sent.length}`, createdTimestamp: Date.now() };
    },
    save: () => {},
    sleep: async (ms) => pauses.push(ms),
    random: () => 0.1,
    stats,
    ...extra,
  });
  return { done, bodies, sent, pauses, stats };
}

const TALK = [
  ["rati", "Skull, did you hear that?"],
  ["skull", "Only the wind, RATi."],
  ["rati", "Then the wind has boots."],
  ["skull", "Boots or not, I stay put."],
  ["rati", "Fine, stay by the door."],
  ["skull", "One more than the budget."],
];

test("a named resident answers, the pair goes back and forth, and stops at the budget", async () => {
  const fixed = fixture();
  const { done, bodies, sent, pauses, stats } = run(fixed, [...TALK]);
  await done;
  assert.equal(sent.length, 5);
  assert.equal(sent[1], "Skull: Only the wind, RATi.");
  assert.deepEqual(bodies.slice(1).map((body) => body.addressed), ["skull", "rati", "skull", "rati"]);
  assert.deepEqual(bodies[1].messages.at(-1), { resident: "rati", text: "Skull, did you hear that?" });
  assert.ok(pauses.every((ms) => ms >= 5000 && ms <= 15000));
  assert.equal(stats.exchanges, 1);
  assert.equal(fixed.state.guilds.g1.replies, 5);
  assert.equal(fixed.room.busy, false);
});

test("odds fall with each line", async () => {
  const { done, sent } = run(fixture(), [...TALK], { random: () => 0.5 });
  await done;
  assert.equal(sent.length, 3);
});

test("a line that names nobody starts no exchange", async () => {
  const { done, sent, stats } = run(fixture(), [["rati", "I am awake."], ...TALK]);
  await done;
  assert.equal(sent.length, 1);
  assert.equal(stats.exchanges, 0);
});

test("another resident named by the person may follow the one addressed", async () => {
  const { done, bodies, sent } = run(fixture("Skull have you met RATi?"), [
    ["skull", "I have not."],
    ["rati", "We met at the gate."],
  ]);
  await done;
  assert.equal(bodies[0].addressed, "skull");
  assert.equal(bodies[1].addressed, "rati");
  assert.deepEqual(sent, ["Skull: I have not.", "RATi: We met at the gate."]);
});

test("a human message ends the exchange and wins the floor", async () => {
  const fixed = fixture();
  let poke = null;
  const sleep = async () => poke?.();
  const result = run(fixed, [...TALK], { sleep });
  let rounds = 0;
  poke = () => {
    rounds += 1;
    if (rounds === 2) record(fixed.room, human("m2", 20000, "wait, I am here too"), "hook", cast);
  };
  await result.done;
  assert.equal(result.sent.length, 2);
  assert.equal(fixed.room.busy, false);
});

test("an echo stops the exchange", async () => {
  const { done, sent, stats } = run(fixture(), [
    ["rati", "Skull, did you hear that?"],
    ["skull", "Skull, did you hear that?"],
  ]);
  await done;
  assert.equal(sent.length, 1);
  assert.deepEqual(stats.flags, { "exchange-echo": 1 });
});

test("a pair cools down and resident exchanges are capped per hour", async () => {
  const fixed = fixture();
  await run(fixed, [...TALK.slice(0, 2)]).done;
  record(fixed.room, human("m2", 60000, "RATi, again?"), "hook", cast);
  const again = run(fixed, [["rati", "Skull, again?"], ["skull", "Yes."]], { now: 70000 });
  await again.done;
  assert.equal(again.sent.length, 1);
  const capped = fixture();
  const one = { ...config, DISCORD_EXCHANGES_PER_HOUR: 1 };
  await run(capped, [...TALK.slice(0, 2)], { config: one }).done;
  record(capped.room, human("m2", 60000, "RATi, and Oak?"), "hook", cast);
  const other = run(capped, [["rati", "Oak, are you up?"], ["oak", "Barely."]], { config: one, now: 70000 });
  await other.done;
  assert.equal(other.sent.length, 1);
});

test("an ambient chime-in starts no exchange unless self exchanges are on", async () => {
  const quiet = () => {
    const room = createRoom("g1", "c1");
    room.webhookId = "hook";
    for (let n = 1; n <= 6; n += 1) record(room, human(`m${n}`, 0, `the river is loud ${n}`), "hook", cast);
    return { room, rooms: new Map([["c1", room]]), state: emptyState() };
  };
  const off = run(quiet(), [...TALK], { now: 6000000 });
  await off.done;
  assert.equal(off.sent.length, 1);
  const on = run(quiet(), [...TALK], { now: 6000000, config: { ...config, DISCORD_SELF_EXCHANGES: 1 } });
  await on.done;
  assert.equal(on.sent.length, 5);
});
