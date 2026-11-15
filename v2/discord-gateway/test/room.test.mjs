import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { emptyState } from "../src/channel.mjs";
import { createRoom, record, seed, tick } from "../src/room.mjs";

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
      return [{ id: "rati", name: "RATi", text: "Come in." }, { id: "stranger", text: "no" }];
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

test("a failing lines call still marks the gap and sends nothing", async () => {
  const { room, rooms, state } = fixture();
  record(room, message("m1", 0, "Skull, is the path open?"), "hook", cast);
  const sent = [];
  await tick({
    rooms,
    state,
    now: 9000,
    config,
    cast,
    lines: async () => {
      throw new Error("down");
    },
    send: async (target, payload) => sent.push(payload),
    save: () => {},
  });
  assert.deepEqual(sent, []);
  assert.equal(room.handledGap, "m1");
  assert.equal(room.busy, false);
  assert.equal(state.guilds.g1.replies, 1);
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
  release([]);
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
