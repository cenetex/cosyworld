import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { assess, addressedResident, namedIn } from "../src/attention.mjs";

const config = readConfig({});
const cast = [
  { id: "rati", name: "RATi" },
  { id: "skull", name: "Skull" },
];

test("config gives safe defaults and rejects bad numbers", () => {
  assert.equal(config.DISCORD_POLL_MS, 10000);
  assert.equal(config.DISCORD_ADDRESSED_DEBOUNCE_MS, 1500);
  assert.equal(config.DISCORD_TYPING_MS, 8000);
  assert.equal(config.DISCORD_DAILY_REPLIES, 500);
  assert.equal(config.DISCORD_CONTEXT_MESSAGES, 12);
  assert.equal(config.DISCORD_NONE_THRESHOLD, 0.5);
  assert.equal(config.DISCORD_FOLLOW_THRESHOLD, 0.2);
  assert.equal(config.DISCORD_GROUP_REPLIES, 3);
  assert.equal(config.DISCORD_MAX_RESIDENT_RUN, 4);
  assert.equal(config.DISCORD_CHANNEL_NAME, "lonely-forest");
  assert.equal(config.DISCORD_PACK, "lonely-forest");
  assert.equal(config.DISCORD_STATE_FILE, "./discord-state.json");
  const bad = readConfig({ DISCORD_LINE_GAP_MS: "-5", DISCORD_POLL_MS: "soon", DISCORD_DAILY_REPLIES: "7" });
  assert.equal(bad.DISCORD_LINE_GAP_MS, 4000);
  assert.equal(bad.DISCORD_POLL_MS, 10000);
  assert.equal(bad.DISCORD_DAILY_REPLIES, 7);
  assert.equal(readConfig({ ORCHESTRATOR_URL: "https://x.dev/" }).ORCHESTRATOR_URL, "https://x.dev");
});

test("a common-word name needs its capital", () => {
  const keeper = [{ id: "keeper", name: "Keeper" }];
  assert.equal(addressedResident({ text: "Keeper, what time is it?" }, keeper, []), "keeper");
  assert.equal(addressedResident({ text: "ask The Keeper" }, keeper, []), "keeper");
  assert.equal(addressedResident({ text: "the keeper said it was late" }, keeper, []), null);
  assert.equal(addressedResident({ text: "pip, are you there?" }, [{ id: "moth", name: "Pip" }], []), "moth");
});

test("a name inside another word is not a mention", () => {
  assert.equal(addressedResident({ text: "my skullcap is warm" }, cast, []), null);
  assert.equal(addressedResident({ text: "Hi SKULL!" }, cast, []), "skull");
});

test("the vocative wins over cast order, otherwise the first name in the text", () => {
  const both = [
    { id: "rati", name: "RATi" },
    { id: "vale", name: "Vale" },
    { id: "skull", name: "Skull" },
  ];
  const to = (text) => addressedResident({ text }, both, []);
  assert.equal(to("Vale have you met RATi?"), "vale");
  assert.equal(to("hey Vale, is RATi home?"), "vale");
  assert.equal(to("did RATi see the moon, Vale?"), "vale");
  assert.equal(to("I think RATi likes it. Skull: what about you?"), "skull");
  assert.equal(to("I told Vale that RATi was here"), "vale");
  assert.deepEqual(namedIn("Vale have you met RATi?", both), ["vale", "rati"]);
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
  }
  assert.deepEqual(assess("Look at https://example.com it is lovely").risks, []);
  assert.equal(assess("where is the kettle").question, true);
  assert.equal(assess("the kettle sings").question, false);
});

test("a reply to a resident's webhook message counts as addressed", () => {
  const ring = [{ id: "m1", at: 0, resident: "skull", text: "I hear footsteps." }];
  assert.equal(addressedResident({ text: "they are mine, sorry", replyTo: "m1" }, cast, ring), "skull");
});
