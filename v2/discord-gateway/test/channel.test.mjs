import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../src/config.mjs";
import { TOPIC, emptyState, ensureChannel, loadState, saveState, today } from "../src/channel.mjs";

const config = readConfig({});

function fakeGuild({ channels = [], allowed = true, webhooks = [] } = {}) {
  const created = [];
  const hooks = [];
  const make = (props) => {
    const channel = {
      type: 0,
      ...props,
      fetchWebhooks: async () => new Map(webhooks.map((hook) => [hook.id, hook])),
      createWebhook: async ({ name }) => {
        const hook = { id: `hook-${hooks.length + 1}`, name, owner: { id: "bot" } };
        hooks.push(hook);
        return hook;
      },
    };
    return channel;
  };
  const cache = new Map(channels.map((props) => [props.id, make(props)]));
  return {
    id: "g1",
    members: { me: { permissions: { has: (flag) => allowed && flag === "ManageChannels" } } },
    channels: {
      cache,
      create: async (options) => {
        created.push(options);
        const channel = make({ id: `new-${created.length}`, name: options.name, type: options.type });
        cache.set(channel.id, channel);
        return channel;
      },
    },
    created,
    hooks,
  };
}

function run(guild, state, lines = []) {
  return ensureChannel(guild, { state, config, botUserId: "bot", log: (line) => lines.push(line) });
}

test("uses the stored channel id", async () => {
  const guild = fakeGuild({
    channels: [
      { id: "c1", name: "lonely-forest" },
      { id: "c2", name: "renamed-forest" },
    ],
  });
  const state = emptyState();
  state.guilds.g1 = { channelId: "c2", off: false, day: "", replies: 0 };
  const found = await run(guild, state);
  assert.equal(found.channel.id, "c2");
  assert.equal(guild.created.length, 0);
});

test("finds the channel by name and reuses the bot's webhook", async () => {
  const guild = fakeGuild({
    channels: [
      { id: "v1", name: "lonely-forest", type: 2 },
      { id: "c1", name: "general" },
      { id: "c2", name: "lonely-forest" },
    ],
    webhooks: [
      { id: "other", owner: { id: "someone" } },
      { id: "mine", owner: { id: "bot" } },
    ],
  });
  const state = emptyState();
  const found = await run(guild, state);
  assert.equal(found.channel.id, "c2");
  assert.equal(found.webhook.id, "mine");
  assert.equal(state.guilds.g1.channelId, "c2");
  assert.equal(guild.created.length, 0);
  assert.equal(guild.hooks.length, 0);
});

test("creates the channel once when missing and allowed", async () => {
  const guild = fakeGuild({ channels: [{ id: "c1", name: "general" }] });
  const state = emptyState();
  const first = await run(guild, state);
  assert.equal(guild.created.length, 1);
  assert.deepEqual(guild.created[0], { name: "lonely-forest", type: 0, topic: TOPIC });
  assert.match(TOPIC, /sent to AI models/);
  assert.equal(first.webhook.name, "Lonely Forest");
  const second = await run(guild, state);
  assert.equal(guild.created.length, 1);
  assert.equal(second.channel.id, first.channel.id);
});

test("without Manage Channels it logs and returns null", async () => {
  const guild = fakeGuild({ allowed: false });
  const lines = [];
  assert.equal(await run(guild, emptyState(), lines), null);
  assert.equal(guild.created.length, 0);
  assert.deepEqual(lines, ["missing Manage Channels in guild g1"]);
});

test("without webhooks it logs and returns null", async () => {
  const guild = fakeGuild({ channels: [{ id: "c1", name: "lonely-forest" }] });
  guild.channels.cache.get("c1").fetchWebhooks = async () => {
    throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
  };
  const lines = [];
  assert.equal(await run(guild, emptyState(), lines), null);
  assert.deepEqual(lines, ["missing Manage Webhooks in guild g1: 50013"]);
});

test("off skips the guild", async () => {
  const guild = fakeGuild();
  const state = emptyState();
  state.guilds.g1 = { channelId: null, off: true, day: "", replies: 0 };
  assert.equal(await run(guild, state), null);
  assert.equal(guild.created.length, 0);
});

test("state round-trips through a temp file", () => {
  const dir = mkdtempSync(join(tmpdir(), "lf-state-"));
  try {
    const file = join(dir, "nested", "discord.json");
    assert.deepEqual(loadState(file), emptyState());
    const state = { version: 1, guilds: { g1: { channelId: "c1", off: false, day: today(0), replies: 3 } } };
    saveState(file, state);
    assert.deepEqual(loadState(file), state);
    assert.deepEqual(readdirSync(join(dir, "nested")), ["discord.json"]);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), state);
    assert.equal(today(0), "1970-01-01");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
