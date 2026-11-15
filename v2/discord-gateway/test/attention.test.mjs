import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { assess, addressee, addressedResident, decide } from "../src/attention.mjs";

const config = readConfig({});
const cast = [
  { id: "rati", name: "RATi" },
  { id: "skull", name: "Skull" },
];
const MIN = 60000;

function human(id, at, text, extra = {}) {
  return { id, at, author: "Mara", text, ...extra };
}

function resident(id, at, who, text) {
  return { id, at, resident: who, text };
}

function room(messages, extra = {}) {
  return { messages, handledGap: null, lastReplyAt: 0, lastAmbientAt: 0, ...extra };
}

const day = { replies: 0 };

test("config gives safe defaults and rejects bad numbers", () => {
  assert.equal(config.DISCORD_POLL_MS, 10000);
  assert.equal(config.DISCORD_QUIET_MS, 45000);
  assert.equal(config.DISCORD_ADDRESSED_QUIET_MS, 1500);
  assert.equal(config.DISCORD_ADDRESSED_DEBOUNCE_MS, 1500);
  assert.equal(config.DISCORD_ADDRESSED_REPLY_GAP_MS, 5000);
  assert.equal(config.DISCORD_TYPING_MS, 8000);
  assert.equal(config.DISCORD_AMBIENT_MESSAGES, 6);
  assert.equal(config.DISCORD_AMBIENT_QUIET_MS, 120000);
  assert.equal(config.DISCORD_AMBIENT_COOLDOWN_MS, 1800000);
  assert.equal(config.DISCORD_MIN_REPLY_GAP_MS, 60000);
  assert.equal(config.DISCORD_DAILY_REPLIES, 100);
  assert.equal(config.DISCORD_DENSITY_WINDOW, 6);
  assert.equal(config.DISCORD_DENSITY_MAX, 2);
  assert.equal(config.DISCORD_CONTEXT_MESSAGES, 12);
  assert.equal(config.DISCORD_CAST_REFRESH_MS, 3600000);
  assert.equal(config.DISCORD_CHANNEL_NAME, "lonely-forest");
  assert.equal(config.DISCORD_PACK, "lonely-forest");
  assert.equal(config.DISCORD_STATE_FILE, "./discord-state.json");
  const bad = readConfig({ DISCORD_QUIET_MS: "-5", DISCORD_POLL_MS: "soon", DISCORD_DAILY_REPLIES: "7" });
  assert.equal(bad.DISCORD_QUIET_MS, 45000);
  assert.equal(bad.DISCORD_POLL_MS, 10000);
  assert.equal(bad.DISCORD_DAILY_REPLIES, 7);
  assert.equal(readConfig({ ORCHESTRATOR_URL: "https://x.dev/" }).ORCHESTRATOR_URL, "https://x.dev");
});

test("too little quiet waits", () => {
  const messages = [human("m1", 0, "Is anyone in the cottage?")];
  assert.equal(decide(room(messages), day, 10000, config, cast).act, "wait");
  assert.equal(decide(room(messages), day, 46000, config, cast).act, "reply");
});

test("one reply per gap", () => {
  const messages = [human("m1", 0, "Is anyone in the cottage?")];
  const handled = room(messages, { handledGap: "m1" });
  const decision = decide(handled, day, 100000, config, cast);
  assert.equal(decision.act, "wait");
  assert.equal(decision.reason, "handled");
});

test("residents in 2 of the last 6 skip unaddressed, addressed still replies", () => {
  const base = [
    human("m1", 0, "hello there friends"),
    resident("m2", 1, "rati", "The kettle is on."),
    resident("m3", 2, "skull", "I hear footsteps."),
  ];
  const plain = room([...base, human("m4", 3, "Is the path open?")]);
  assert.equal(decide(plain, day, 100000, config, cast).reason, "density");
  assert.equal(decide(plain, day, 100000, config, cast).act, "skip");
  const named = room([...base, human("m4", 3, "Skull, is the path open?")]);
  const decision = decide(named, day, 100000, config, cast);
  assert.equal(decision.act, "reply");
  assert.equal(decision.addressed, "skull");
});

test("addressed replies after 1.5 s while unaddressed waits until 45 s", () => {
  const named = room([human("m1", 0, "rati where are you")]);
  assert.equal(decide(named, day, 1000, config, cast).act, "wait");
  assert.equal(decide(named, day, 1500, config, cast).act, "reply");
  const plain = room([human("m1", 0, "Where is the cottage?")]);
  assert.equal(decide(plain, day, 9000, config, cast).act, "wait");
  assert.equal(decide(plain, day, 45000, config, cast).act, "reply");
});

test("a name inside another word is not a mention", () => {
  assert.equal(addressedResident({ text: "my skullcap is warm" }, cast, []), null);
  assert.equal(addressedResident({ text: "Hi SKULL!" }, cast, []), "skull");
});

test("addressed messages use a 5 s reply gap, others keep the 60 s gap", () => {
  const start = 100 * MIN;
  const named = room([human("m1", start, "RATi, can I come in?")], { lastReplyAt: start });
  assert.equal(decide(named, day, start + 3000, config, cast).reason, "reply-gap");
  assert.equal(decide(named, day, start + 5000, config, cast).act, "reply");
  const plain = room([human("m1", start - MIN, "Is the path open?")], { lastReplyAt: start });
  assert.equal(decide(plain, day, start + 30000, config, cast).act, "wait");
  assert.equal(decide(plain, day, start + 30000, config, cast).reason, "reply-gap");
  assert.equal(decide(plain, day, start + MIN, config, cast).act, "reply");
});

test("the daily cap skips", () => {
  const messages = [human("m1", 0, "RATi, can I come in?")];
  const decision = decide(room(messages), { replies: 100 }, MIN, config, cast);
  assert.equal(decision.act, "skip");
  assert.equal(decision.reason, "daily-cap");
});

test("ambient replies only after 6 human messages, 120 s of quiet and the cooldown", () => {
  const five = [1, 2, 3, 4, 5].map((n) => human(`m${n}`, 0, `the river is loud today ${n}`));
  const start = 100 * MIN;
  assert.equal(decide(room(five), day, start, config, cast).reason, "ambient-motion");
  const six = [...five, human("m6", 0, "the river is loud today 6")];
  assert.equal(decide(room(six), day, 60000, config, cast).act, "wait");
  assert.equal(decide(room(six), day, 60000, config, cast).reason, "ambient-quiet");
  const ready = decide(room(six), day, start, config, cast);
  assert.equal(ready.act, "reply");
  assert.equal(ready.ambient, true);
  const cooling = room(six, { lastAmbientAt: start - 60000 });
  assert.equal(decide(cooling, day, start, config, cast).reason, "ambient-cooldown");
  const afterResident = [...six, resident("r1", 0, "rati", "Hush."), human("m7", 0, "the river is loud today 7")];
  assert.equal(decide(room(afterResident), day, start, config, cast).reason, "ambient-motion");
});

test("low-signal, URL-only, commands and promo skip", () => {
  for (const [text, risk] of [
    ["lol", "low-signal"],
    ["ok ty", "low-signal"],
    ["https://example.com/page", "url-only"],
    ["/who", "command"],
    ["!roll", "command"],
    ["Join discord.gg/abc for prizes", "promo"],
    ["Free Nitro for everyone here today", "promo"],
    ["big AIRDROP soon friends", "promo"],
  ]) {
    assert.ok(assess(text).risks.includes(risk), text);
    const decision = decide(room([human("m1", 0, text)]), day, 100 * MIN, config, cast);
    assert.equal(decision.act, "skip", text);
  }
  assert.deepEqual(assess("Look at https://example.com it is lovely").risks, []);
  assert.equal(assess("where is the kettle").question, true);
  assert.equal(assess("the kettle sings").question, false);
});

test("a resident's last message never triggers", () => {
  const messages = [human("m1", 0, "RATi?"), resident("m2", 1, "rati", "Yes?")];
  const decision = decide(room(messages), day, 100 * MIN, config, cast);
  assert.equal(decision.act, "wait");
  assert.equal(decision.reason, "resident-last");
  assert.equal(decide(room([]), day, 100 * MIN, config, cast).act, "wait");
});

test("a reply to a resident's webhook message counts as addressed", () => {
  const messages = [
    resident("m1", 0, "skull", "I hear footsteps."),
    human("m2", 0, "they are mine, sorry", { replyTo: "m1" }),
  ];
  const decision = decide(room(messages), day, 9000, config, cast);
  assert.equal(decision.act, "reply");
  assert.equal(decision.addressed, "skull");
});

test("a follow-up from the same person keeps the address, another person breaks it", () => {
  const messages = [human("m1", 0, "RATi, can I"), human("m2", 0, "come in?")];
  assert.equal(addressee(messages, cast), "rati");
  assert.equal(decide(room(messages), day, 1500, config, cast).addressed, "rati");
  const broken = [...messages, { id: "m3", at: 0, author: "Jun", text: "hello all" }];
  assert.equal(addressee(broken, cast), null);
  const long = [human("m1", 0, "RATi, hi"), human("m2", 0, "one"), human("m3", 0, "two"), human("m4", 0, "three")];
  assert.equal(addressee(long, cast), null);
  assert.equal(addressee([resident("r1", 0, "rati", "Yes?")], cast), null);
});
