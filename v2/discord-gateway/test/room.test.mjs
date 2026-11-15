import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { emptyState } from "../src/channel.mjs";
import { calm, createRoom, createStats, nudge, record, requestBody, seed, summary, tick } from "../src/room.mjs";

const config = readConfig({ ORCHESTRATOR_URL: "https://cosyworld.example" });
const cast = [
  { id: "rati", name: "RATi", portrait: "/card-game/assets/lonely-forest/rati.png" },
  { id: "skull", name: "Skull", portrait: "/card-game/assets/lonely-forest/skull.png" },
];

function message(id, at, content, extra = {}) {
  return {
    id,
    createdTimestamp: at,
    content,
    author: { bot: false, username: "mara_1" },
    member: { displayName: "Mara" },
    ...extra,
  };
}

function fixture() {
  const room = createRoom("g1", "c1");
  room.webhookId = "hook";
  return { room, rooms: new Map([["c1", room]]), state: emptyState() };
}

test("bot and foreign webhook messages are dropped", () => {
  const { room } = fixture();
  assert.equal(record(room, message("b1", 0, "beep", { author: { bot: true, username: "Other" } }), "hook", cast), null);
  assert.equal(
    record(room, message("w1", 0, "hello", { webhookId: "elsewhere", author: { bot: true, username: "RATi" } }), "hook", cast),
    null,
  );
  assert.equal(record(room, message("e1", 0, "   "), "hook", cast), null);
  assert.deepEqual(room.messages, []);
});

test("the bot's own webhook messages count as resident lines", () => {
  const { room } = fixture();
  const entry = record(
    room,
    message("w1", 5, "The kettle is on.", { webhookId: "hook", author: { bot: true, username: "RATi" } }),
    "hook",
    cast,
  );
  assert.deepEqual(entry, { id: "w1", at: 5, text: "The kettle is on.", replyTo: null, resident: "rati" });
});

test("the ring keeps 150 messages and seeding marks the newest gap handled", () => {
  const { room } = fixture();
  const history = Array.from({ length: 155 }, (_, n) => message(`m${n}`, n, `line ${n}`)).reverse();
  seed(room, history, cast);
  assert.equal(room.messages.length, 150);
  assert.equal(room.messages[0].id, "m5");
  assert.equal(room.handledGap, "m154");
  assert.equal(room.messages[0].author, "Mara");
  assert.equal(record(room, message("x", 30, "hi", { member: null, author: { username: "a\u0007b" } }), "hook", cast).author, "a b");
  const long = record(room, message("y", 31, "🌲".repeat(500), { member: { displayName: "🦊".repeat(40) } }), "hook", cast);
  assert.equal(Array.from(long.text).length, 400);
  assert.equal(Array.from(long.author).length, 32);
  assert.equal(long.author, "🦊".repeat(32));
});

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    pending,
    setTimeout: (fn, ms) => {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
    fire() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, { fn }] of due) fn();
    },
  };
}

test("an addressed message ticks its room after the debounce, without the poll", async () => {
  const { room, rooms, state } = fixture();
  const timers = fakeTimers();
  const ticks = [];
  const sent = [];
  const run = (target) =>
    ticks.push(
      tick({
        rooms: new Map([[target.channelId, target]]),
        state,
        now: 1500,
        config,
        cast,
        lines: async () => ({ lines: [{ id: "rati", text: "Come in." }] }),
        send: async (target, payload) => sent.push(payload.content),
        save: () => {},
      }),
    );
  const plain = record(room, message("m0", 0, "the river is loud"), "hook", cast);
  assert.equal(nudge(room, plain, cast, { delay: 1500, run, timers }), false);
  assert.equal(timers.pending.size, 0);
  const first = record(room, message("m1", 0, "RATi, can I"), "hook", cast);
  assert.equal(nudge(room, first, cast, { delay: 1500, run, timers }), true);
  const more = record(room, message("m2", 0, "come in?"), "hook", cast);
  assert.equal(nudge(room, more, cast, { delay: 1500, run, timers }), true);
  assert.equal(timers.pending.size, 1);
  const other = record(room, message("m3", 0, "the river is loud", { member: { displayName: "Jun" } }), "hook", cast);
  assert.equal(nudge(room, other, cast, { delay: 1500, run, timers }), true);
  assert.equal(timers.pending.size, 1);
  const again = record(room, message("m4", 0, "RATi, can I come in?"), "hook", cast);
  nudge(room, again, cast, { delay: 1500, run, timers });
  assert.equal(timers.pending.size, 1);
  assert.equal([...timers.pending.values()][0].ms, 1500);
  timers.fire();
  await Promise.all(ticks);
  assert.equal(ticks.length, 1);
  assert.deepEqual(sent, ["Come in."]);
  assert.equal(room.handledGap, "m4");
});

test("a nudge waits while the room is busy and can be calmed", () => {
  const { room } = fixture();
  const timers = fakeTimers();
  let runs = 0;
  const entry = record(room, message("m1", 0, "Skull, hello?"), "hook", cast);
  nudge(room, entry, cast, { delay: 1500, run: () => (runs += 1), timers });
  room.busy = true;
  timers.fire();
  assert.equal(runs, 0);
  assert.equal(timers.pending.size, 1);
  room.busy = false;
  timers.fire();
  assert.equal(runs, 1);
  nudge(room, entry, cast, { delay: 1500, run: () => (runs += 1), timers });
  calm(room, timers);
  assert.equal(timers.pending.size, 0);
  assert.equal(room.nudge, null);
});

test("typing starts with the answer, repeats, and stops when the line posts", async () => {
  const { room, rooms, state } = fixture();
  record(room, message("m1", 0, "RATi, can I come in?"), "hook", cast);
  const fast = { ...config, DISCORD_TYPING_MS: 10 };
  const events = [];
  let release;
  const running = tick({
    rooms,
    state,
    now: 9000,
    config: fast,
    cast,
    lines: () => new Promise((resolve) => (release = resolve)),
    send: async () => events.push("send"),
    typing: () => {
      events.push("typing");
      throw new Error("typing failed");
    },
    save: () => {},
  });
  assert.deepEqual(events, ["typing"]);
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.ok(events.filter((event) => event === "typing").length >= 3);
  release({ lines: [{ id: "rati", text: "Come in." }] });
  await running;
  const settled = events.length;
  assert.equal(events.at(-1), "send");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(events.length, settled);
  assert.equal(state.guilds.g1.replies, 1);
});

test("typing stops when the attempt fails, and rejected typing never breaks it", async () => {
  const { room, rooms, state } = fixture();
  record(room, message("m1", 0, "RATi, can I come in?"), "hook", cast);
  let typed = 0;
  await tick({
    rooms,
    state,
    now: 9000,
    config: { ...config, DISCORD_TYPING_MS: 5 },
    cast,
    lines: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { lines: [], reason: "timeout" };
    },
    send: async () => {},
    typing: async () => {
      typed += 1;
      throw new Error("no permission");
    },
    save: () => {},
  });
  const after = typed;
  assert.ok(after >= 2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(typed, after);
  assert.equal(room.busy, false);
});

test("a line overtaken by a message to another resident is dropped as handled", async () => {
  const { room, rooms, state } = fixture();
  record(room, message("m1", 0, "RATi, can I come in?"), "hook", cast);
  const sent = [];
  const logs = [];
  const stats = createStats();
  let release;
  const running = tick({
    rooms,
    state,
    now: 9000,
    config,
    cast,
    lines: () => new Promise((resolve) => (release = resolve)),
    send: async (target, payload) => sent.push(payload.content),
    save: () => {},
    log: (line) => logs.push(line),
    stats,
  });
  record(room, message("m2", 9500, "Skull, are you there?"), "hook", cast);
  release({ lines: [{ id: "rati", text: "Come in." }] });
  await running;
  assert.deepEqual(sent, []);
  assert.deepEqual(stats.failures, {});
  assert.deepEqual(stats.skips, { stale: 1 });
  assert.equal(room.handledGap, "m1");
  assert.equal(room.lastReplyAt, 0);
  assert.equal(state.guilds.g1.replies, 0);
  assert.equal(logs.at(-1), "lines dropped reason=stale guild=g1 channel=c1");
  const next = [];
  await tick({
    rooms,
    state,
    now: 11000,
    config,
    cast,
    lines: async (body) => {
      next.push(body.addressed);
      return { lines: [{ id: "skull", text: "Here." }] };
    },
    send: async (target, payload) => sent.push(payload.content),
    save: () => {},
  });
  assert.deepEqual(next, ["skull"]);
  assert.deepEqual(sent, ["Here."]);
});

test("each request carries the channel as seen in memory", () => {
  const room = createRoom("g1", "c1");
  room.messages.push(
    { id: "a", at: 0, text: "Old words.", author: "Jun" },
    { id: "b", at: 700000, text: "One.", resident: "skull" },
    { id: "c", at: 710000, text: "Two.", resident: "rati" },
    { id: "d", at: 720000, text: "Three.", resident: "rati" },
    { id: "e", at: 730000, text: "Hi Mara.", author: "Mara" },
    { id: "f", at: 790000, text: "RATi, who else is here?", author: "Mara" },
  );
  const body = requestBody(room, config, "rati", 800000);
  assert.deepEqual(body.channel, {
    active: ["Mara", "rati", "skull"],
    residents: [
      { id: "skull", lines: ["One."], streak: 0, since: 100 },
      { id: "rati", lines: ["Two.", "Three."], streak: 2, since: 80 },
    ],
    quiet: 60,
  });
});


test("a full daily cap is logged once a day and silences the room", async () => {
  const { room, rooms, state } = fixture();
  state.guilds.g1 = { channelId: "c1", off: false, day: "1970-01-01", replies: config.DISCORD_DAILY_REPLIES };
  const logs = [];
  const stats = createStats();
  const run = (now) => tick({ rooms, state, now, config, cast, lines: async () => ({ lines: [] }), send: async () => {}, save: () => {}, log: (l) => logs.push(l), stats });
  record(room, message("m1", 0, "RATi, hello?"), "hook", cast);
  await run(9000);
  record(room, message("m2", 10000, "RATi, still there?"), "hook", cast);
  await run(19000);
  assert.deepEqual(logs, ["daily-cap reached guild=g1"]);
  assert.equal(stats.skips["daily-cap"], 2);
});
