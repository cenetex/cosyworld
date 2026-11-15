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

test("tick sends safe webhook lines with name and portrait", async () => {
  const { room, rooms, state } = fixture();
  record(room, message("m1", 0, "RATi,   can I\ncome in?"), "hook", cast);
  const sent = [];
  const bodies = [];
  let saves = 0;
  await tick({
    rooms,
    state,
    now: 9000,
    config,
    cast,
    lines: async (body) => {
      bodies.push(body);
      return { lines: [{ id: "rati", name: "RATi", text: "Come in." }, { id: "stranger", text: "no" }], reason: null };
    },
    send: async (target, payload) => sent.push({ target: target.channelId, payload }),
    save: () => (saves += 1),
  });
  assert.deepEqual(bodies, [
    {
      pack: "lonely-forest",
      addressed: "rati",
      channel: { active: ["Mara"], residents: [] },
      messages: [{ author: "Mara", text: "RATi, can I come in?" }],
    },
  ]);
  assert.deepEqual(sent, [
    {
      target: "c1",
      payload: {
        content: "Come in.",
        username: "RATi",
        avatarURL: "https://cosyworld.example/card-game/assets/lonely-forest/rati.png",
        allowedMentions: { parse: [] },
      },
    },
  ]);
  assert.equal(room.handledGap, "m1");
  assert.equal(room.lastReplyAt, 9000);
  assert.equal(state.guilds.g1.replies, 1);
  assert.equal(state.guilds.g1.day, "1970-01-01");
  assert.equal(saves, 1);
  const again = [];
  await tick({ rooms, state, now: 200000, config, cast, lines: async () => again.push(1), send: async () => {}, save: () => {} });
  assert.deepEqual(again, []);
});

function failing(reason, calls) {
  return async () => {
    calls.push(1);
    return { lines: [], reason };
  };
}

test("a failing lines call is refunded and retried once", async () => {
  const { room, rooms, state } = fixture();
  record(room, message("m1", 0, "Skull, is the path open?"), "hook", cast);
  const sent = [];
  const calls = [];
  const logs = [];
  const stats = createStats();
  const run = (now) =>
    tick({
      rooms,
      state,
      now,
      config,
      cast,
      lines: failing("busy", calls),
      send: async (target, payload) => sent.push(payload),
      save: () => {},
      log: (line) => logs.push(line),
      stats,
    });
  await run(9000);
  assert.equal(room.handledGap, null);
  assert.equal(room.lastReplyAt, 0);
  assert.equal(state.guilds.g1.replies, 0);
  assert.equal(room.busy, false);
  await run(19000);
  assert.equal(calls.length, 2);
  assert.equal(room.handledGap, "m1");
  assert.equal(state.guilds.g1.replies, 0);
  await run(29000);
  await run(39000);
  assert.equal(calls.length, 2);
  assert.deepEqual(sent, []);
  assert.deepEqual(stats.failures, { busy: 2 });
  assert.deepEqual(logs, [
    "decision act=reply reason=addressed guild=g1 channel=c1",
    "lines failed reason=busy attempt=1 guild=g1 channel=c1",
    "decision act=reply reason=addressed guild=g1 channel=c1",
    "lines failed reason=busy attempt=2 guild=g1 channel=c1",
  ]);
  assert.match(summary(stats), /^summary replies=0 skips=none failures=busy:2 continued=0 exchanges=0 flags=none$/);
});

test("a throwing lines call or send is refunded and keeps the ambient clock", async () => {
  const { room, rooms, state } = fixture();
  record(room, message("m1", 0, "RATi, hello there"), "hook", cast);
  const logs = [];
  await tick({
    rooms,
    state,
    now: 9000,
    config,
    cast,
    lines: async () => {
      throw new Error("down");
    },
    send: async () => {},
    save: () => {},
    log: (line) => logs.push(line),
  });
  assert.equal(room.handledGap, null);
  assert.equal(state.guilds.g1.replies, 0);
  assert.match(logs[1], /reason=error attempt=1/);
  await tick({
    rooms,
    state,
    now: 19000,
    config,
    cast,
    lines: async () => ({ lines: [{ id: "rati", text: "Hi." }] }),
    send: async () => {
      throw new Error("webhook gone");
    },
    save: () => {},
    log: (line) => logs.push(line),
  });
  assert.match(logs.at(-1), /reason=send attempt=2/);
  assert.equal(room.handledGap, "m1");
  assert.equal(state.guilds.g1.replies, 0);
});

test("a posted line is never retried", async () => {
  const { room, rooms, state } = fixture();
  record(room, message("m1", 0, "RATi, hello there"), "hook", cast);
  let calls = 0;
  let sends = 0;
  const stats = createStats();
  const run = (now) =>
    tick({
      rooms,
      state,
      now,
      config,
      cast,
      lines: async () => {
        calls += 1;
        return {
          lines: [
            { id: "rati", text: "One." },
            { id: "skull", text: "Two." },
          ],
          reason: null,
        };
      },
      send: async () => {
        sends += 1;
        if (sends === 2) throw new Error("second failed");
      },
      save: () => {},
      stats,
    });
  await run(9000);
  await run(19000);
  assert.equal(calls, 1);
  assert.equal(room.handledGap, "m1");
  assert.equal(state.guilds.g1.replies, 1);
  assert.equal(stats.replies, 1);
});

test("decisions are logged without message text or names", async () => {
  const { room, rooms, state } = fixture();
  record(room, message("m1", 0, "ok"), "hook", cast);
  const logs = [];
  const stats = createStats();
  await tick({ rooms, state, now: 9000, config, cast, lines: async () => ({ lines: [] }), send: async () => {}, save: () => {}, log: (l) => logs.push(l), stats });
  assert.deepEqual(logs, ["decision act=skip reason=low-signal guild=g1 channel=c1"]);
  assert.deepEqual(stats.skips, { "low-signal": 1 });
  assert.equal(room.handledGap, "m1");
  assert.equal(state.guilds.g1.replies, 0);
});

test("a busy room is not called twice", async () => {
  const { room, rooms, state } = fixture();
  record(room, message("m1", 0, "RATi, hello there"), "hook", cast);
  let release;
  let calls = 0;
  const lines = () => {
    calls += 1;
    return new Promise((resolve) => (release = resolve));
  };
  const first = tick({ rooms, state, now: 9000, config, cast, lines, send: async () => {}, save: () => {} });
  record(room, message("m2", 9500, "RATi, are you there?"), "hook", cast);
  await tick({ rooms, state, now: 200000, config, cast, lines, send: async () => {}, save: () => {} });
  assert.equal(calls, 1);
  release({ lines: [], reason: "busy" });
  await first;
  assert.equal(room.busy, false);
});

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

test("the ring keeps 20 messages and seeding marks the newest gap handled", () => {
  const { room } = fixture();
  const history = Array.from({ length: 25 }, (_, n) => message(`m${n}`, n, `line ${n}`)).reverse();
  seed(room, history, cast);
  assert.equal(room.messages.length, 20);
  assert.equal(room.messages[0].id, "m5");
  assert.equal(room.handledGap, "m24");
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
  assert.equal(nudge(room, other, cast, { delay: 1500, run, timers }), false);
  assert.equal(timers.pending.size, 0);
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

test("being addressed, answering and naming another resident set focus", async () => {
  const { room, rooms, state } = fixture();
  record(room, message("m1", 0, "Is anyone home?", { author: { id: "u1", bot: false } }), "hook", cast);
  assert.deepEqual(room.focus, {});
  record(room, message("m2", 1000, "RATi?", { author: { id: "u1", bot: false } }), "hook", cast);
  assert.deepEqual(room.focus.rati, { target: "h:u1", at: 1000 });
  const sent = [];
  const reply = (text) => async () => ({ lines: [{ id: "rati", text }] });
  const send = async (target, payload) => {
    sent.push(payload.content);
    return { id: `s${sent.length}`, createdTimestamp: 5000 * sent.length };
  };
  await tick({ rooms, state, now: 9000, config, cast, lines: reply("Yes, come in."), send, save: () => {} });
  assert.deepEqual(room.focus.rati, { target: "h:u1", at: 5000 });
  record(room, message("m3", 12000, "thanks, where do I sit?", { author: { id: "u1", bot: false } }), "hook", cast);
  await tick({ rooms, state, now: 20000, config, cast, lines: reply("Skull, move over."), send, save: () => {} });
  assert.deepEqual(sent, ["Yes, come in.", "Skull, move over."]);
  assert.deepEqual(room.focus.rati, { target: "r:skull", at: 10000 });
  assert.deepEqual(room.focus.skull, { target: "r:rati", at: 10000 });
});
