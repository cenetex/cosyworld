import test from "node:test";
import assert from "node:assert/strict";
import { beats, pause, repeatsOpening, unfinished } from "../src/beats.mjs";
import { readConfig } from "../src/config.mjs";
import { emptyState } from "../src/channel.mjs";
import { createRoom, createStats, record, tick } from "../src/room.mjs";

const config = readConfig({ ORCHESTRATOR_URL: "https://cosyworld.example" });
const cast = [
  { id: "rati", name: "RATi", portrait: "/card-game/assets/lonely-forest/rati.png" },
  { id: "skull", name: "Skull", portrait: "/card-game/assets/lonely-forest/skull.png" },
];
const LONG =
  "The kettle is on and the cups are by the window. The door sticks in the rain, so lean on it. " +
  "Come and sit by the warm fire when you are all in.";

function human(id, at, content) {
  return { id, createdTimestamp: at, content, author: { bot: false }, member: { displayName: "Mara" } };
}

test("a long line splits at sentence ends into at most three beats", () => {
  assert.deepEqual(beats("Come in. Sit down."), ["Come in. Sit down."]);
  const parts = beats(LONG);
  assert.equal(parts.length, 3);
  assert.equal(parts.join(" "), LONG);
  assert.ok(parts.every((part) => /[.!?]$/.test(part)));
  assert.equal(beats(`${LONG} ${LONG}`).length, 3);
  assert.deepEqual(beats("a".repeat(200)), ["a".repeat(200)]);
});

test("pauses scale with length and stay between one and four seconds", () => {
  assert.equal(pause("Hi."), 1000);
  assert.equal(pause("a".repeat(60)), 2100);
  assert.equal(pause("a".repeat(500)), 4000);
});

test("unfinished lines end in an ellipsis, a dash, a comma, or a word", () => {
  for (const text of ["And then", "Wait…", "Well...", "I mean -", "So—", "First,"]) assert.ok(unfinished(text), text);
  for (const text of ["Come in.", "Who?", "Go!", "Night 🌙", "“Yes.”"]) assert.ok(!unfinished(text), text);
});

test("a repeated opening matches the first words of the resident's last five lines", () => {
  const ring = [
    { resident: "rati", text: "Oh, the kettle is on." },
    { resident: "skull", text: "Well I never did." },
  ];
  assert.ok(repeatsOpening(ring, "rati", "Oh the kettle is cold now."));
  assert.ok(!repeatsOpening(ring, "rati", "Well I never did."));
  assert.ok(!repeatsOpening(ring, "rati", "Oh, the."));
  const old = [{ resident: "rati", text: "Oh the kettle is on." }, ...Array(5).fill({ resident: "rati", text: "Something else here." })];
  assert.ok(!repeatsOpening(old, "rati", "Oh the kettle again."));
});

function fixture() {
  const room = createRoom("g1", "c1");
  room.webhookId = "hook";
  record(room, human("m1", 0, "RATi, can I come in?"), "hook", cast);
  return { room, rooms: new Map([["c1", room]]), state: emptyState() };
}

function run(room, rooms, state, replies, extra = {}) {
  const bodies = [];
  const sent = [];
  const pauses = [];
  const stats = createStats();
  const logs = [];
  let n = 0;
  const done = tick({
    rooms,
    state,
    now: 9000,
    config,
    cast,
    lines: async (body) => {
      bodies.push(body);
      const text = replies.shift();
      return text ? { lines: [{ id: "rati", text }] } : { lines: [], reason: "no-speaker" };
    },
    send: async (target, payload) => {
      sent.push(payload.content);
      n += 1;
      return { id: `s${n}`, createdTimestamp: 9000 + n };
    },
    save: () => {},
    sleep: async (ms) => pauses.push(ms),
    log: (line) => logs.push(line),
    stats,
    ...extra,
  });
  return { done, bodies, sent, pauses, stats, logs };
}

test("a long line posts as beats with pauses between them", async () => {
  const { room, rooms, state } = fixture();
  const { done, sent, pauses } = run(room, rooms, state, [LONG]);
  await done;
  assert.equal(sent.length, 3);
  assert.equal(pauses.length, 2);
  assert.ok(pauses.every((ms) => ms >= 1000 && ms <= 4000));
  assert.deepEqual(room.messages.slice(1).map((entry) => entry.resident), ["rati", "rati", "rati"]);
});

test("an unfinished line goes on at most twice, as the same resident", async () => {
  const { room, rooms, state } = fixture();
  const { done, bodies, sent, stats } = run(room, rooms, state, ["Come in, but", "mind the step, and", "the cat", "never"]);
  await done;
  assert.deepEqual(sent, ["Come in, but", "mind the step, and", "the cat"]);
  assert.equal(bodies.length, 3);
  assert.equal(bodies[0].continuing, undefined);
  assert.deepEqual(bodies.slice(1).map((body) => body.continuing), ["rati", "rati"]);
  assert.deepEqual(bodies[1].messages.at(-1), { resident: "rati", text: "Come in, but" });
  assert.equal(bodies[1].addressed, null);
  assert.equal(stats.continued, 2);
  assert.equal(state.guilds.g1.replies, 3);
  assert.equal(room.busy, false);
});

test("a finished line goes on only at the low rate, and a silent answer ends the turn", async () => {
  const { room, rooms, state } = fixture();
  const never = run(room, rooms, state, ["Come in.", "More."]);
  await never.done;
  assert.equal(never.bodies.length, 1);
  const again = fixture();
  const asked = run(again.room, again.rooms, again.state, ["Come in."], { random: () => 0 });
  await asked.done;
  assert.equal(asked.bodies.length, 2);
  assert.deepEqual(asked.sent, ["Come in."]);
  assert.equal(asked.stats.continued, 0);
});

test("a new human message cancels a pending continuation", async () => {
  const { room, rooms, state } = fixture();
  let release;
  let signal;
  const sent = [];
  const done = tick({
    rooms,
    state,
    now: 9000,
    config,
    cast,
    lines: (body, abort) => {
      if (!body.continuing) return Promise.resolve({ lines: [{ id: "rati", text: "Come in, but" }] });
      signal = abort;
      return new Promise((resolve) => (release = resolve));
    },
    send: async (target, payload) => sent.push(payload.content),
    save: () => {},
  });
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  record(room, human("m2", 9500, "wait, who is that"), "hook", cast);
  assert.equal(signal.aborted, true);
  release({ lines: [{ id: "rati", text: "the step." }] });
  await done;
  assert.deepEqual(sent, ["Come in, but"]);
  assert.equal(room.busy, false);
});

test("a repeated opening is flagged and still posted", async () => {
  const { room, rooms, state } = fixture();
  room.messages.unshift({ id: "r0", at: 0, text: "Oh the kettle is on.", resident: "rati" });
  const { done, sent, stats, logs } = run(room, rooms, state, ["Oh the kettle is cold."]);
  await done;
  assert.deepEqual(sent, ["Oh the kettle is cold."]);
  assert.deepEqual(stats.flags, { "repeated-opening": 1 });
  assert.ok(logs.includes("flag repeated-opening resident=rati guild=g1 channel=c1"));
});
