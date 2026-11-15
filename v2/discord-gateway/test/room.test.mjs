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
  assert.equal(body.addressed, "rati");
  assert.equal(body.continuing, undefined);
  assert.deepEqual(body.channel, {
    active: ["Mara", "rati", "skull"],
    residents: [
      { id: "skull", lines: ["One."], streak: 0, since: 100 },
      { id: "rati", lines: ["Two.", "Three."], streak: 2, since: 80 },
    ],
    quiet: 60,
  });
});


test("a resident who spoke last goes on with continuing", () => {
  const room = createRoom("g1", "c1");
  room.messages.push({ id: "a", at: 0, text: "Pip?", author: "Jun" }, { id: "b", at: 1000, text: "Yes, Jun.", resident: "moth" });
  const going = requestBody(room, config, "moth", 2000);
  assert.equal(going.continuing, "moth");
  assert.equal(going.addressed, undefined);
  assert.equal(requestBody(room, config, "rati", 2000).addressed, "rati");
});

const cdn = (name) => `https://cdn.discordapp.com/attachments/1/2/${name}?ex=1&is=2&hm=3`;
const picture = (name, extra = {}) => ({ url: cdn(name), name, contentType: "image/png", size: 1000, ...extra });
const attached = (...files) => new Map(files.map((file, index) => [String(index), file]));

test("image attachments map to images, at most two, from Discord's CDN only", () => {
  const { room } = fixture();
  const only = record(room, message("i1", 0, "", { attachments: attached(picture("a.png")) }), "hook", cast);
  assert.equal(only.text, "");
  assert.deepEqual(only.images, [cdn("a.png")]);
  const mixed = record(
    room,
    message("i2", 1, "look", {
      attachments: attached(
        picture("notes.txt", { contentType: "text/plain" }),
        picture("huge.png", { size: 9 * 1024 * 1024 }),
        { ...picture("x.png"), url: "https://example.com/x.png" },
        { ...picture("y.png"), url: "http://cdn.discordapp.com/attachments/1/2/y.png" },
        picture("b.webp", { contentType: "image/webp" }),
        picture("c.gif", { contentType: undefined }),
        picture("d.jpg", { contentType: "image/jpeg" }),
      ),
    }),
    "hook",
    cast,
  );
  assert.deepEqual(mixed.images, [cdn("b.webp"), cdn("c.gif")]);
  assert.equal(record(room, message("i3", 2, "", { attachments: attached(picture("t.txt", { contentType: "text/plain" })) }), "hook", cast), null);
  assert.equal(record(room, message("i4", 3, "plain"), "hook", cast).images, undefined);
});

test("a request carries at most four images, newest first, and a placeholder for the rest", () => {
  const room = createRoom("g1", "c1");
  room.messages.push(
    { id: "a", at: 0, text: "", images: [cdn("1.png")], author: "Jun" },
    { id: "b", at: 1, text: "old", images: [cdn("2.png")], author: "Jun" },
    { id: "c", at: 2, text: "", images: [cdn("3.png"), cdn("4.png")], author: "Mara" },
    { id: "d", at: 3, text: "RATi, see?", images: [cdn("5.png"), cdn("6.png")], author: "Mara" },
  );
  const { messages } = requestBody(room, config, "rati", 10);
  assert.deepEqual(messages, [
    { author: "Jun", text: "[shares an image]" },
    { author: "Jun", text: "old" },
    { author: "Mara", text: "", images: [cdn("3.png"), cdn("4.png")] },
    { author: "Mara", text: "RATi, see?", images: [cdn("5.png"), cdn("6.png")] },
  ]);
});
