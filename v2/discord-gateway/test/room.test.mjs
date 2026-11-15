import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { createRoom, record, requestBody, seed } from "../src/room.mjs";

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
  return { room };
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

