import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { emptyState } from "../src/channel.mjs";
import { createRoom, createStats, record, seed, summary, tick } from "../src/room.mjs";

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
    { pack: "lonely-forest", addressed: "rati", messages: [{ author: "Mara", text: "RATi, can I come in?" }] },
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
  assert.match(summary(stats), /^summary replies=0 skips=none failures=busy:2$/);
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
