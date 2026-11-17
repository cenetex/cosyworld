import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { readConfig } from "./config.mjs";
import { commandDefinitions, dispatch } from "./commands.mjs";
import { ensureChannel, guildState, loadState, saveState } from "./channel.mjs";
import { castOf, createRoom, createStats, record, seed, summary } from "./room.mjs";
import { startHealth } from "./health.mjs";
import { wait } from "./beats.mjs";
import { channelLines, conversationNotes, coordinate, ensureWorld, fetchCast } from "./orchestrator.mjs";
import { heard, hush } from "./turns.mjs";

const config = readConfig(process.env);

if (!config.DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN is required");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
const state = loadState(config.DISCORD_STATE_FILE);
const rooms = new Map();
const webhooks = new Map();
const channels = new Map();
let cast = [];
const stats = createStats();
const startedAt = Date.now();
let lastTickAt = null;

function log(line) {
  console.log(line);
}

function save() {
  try {
    saveState(config.DISCORD_STATE_FILE, state);
  } catch (error) {
    log(`state save failed: ${error?.code ?? "error"}`);
  }
}

async function refreshCast() {
  const next = await fetchCast(fetch, config.ORCHESTRATOR_URL, config.COSYWORLD_BOT_TOKEN, config.DISCORD_PACK);
  if (next) cast = next;
  else log("cast unavailable");
}

async function castFor(room) {
  const next = await fetchCast(fetch, config.ORCHESTRATOR_URL, config.COSYWORLD_BOT_TOKEN, config.DISCORD_PACK, room.guildId);
  if (next) room.cast = next;
  else log(`cast unavailable in guild ${room.guildId}`);
}

async function findWorld(room, again = false) {
  room.soughtAt = Date.now();
  const world = await ensureWorld(fetch, config.ORCHESTRATOR_URL, config.COSYWORLD_BOT_TOKEN, room.guildId);
  if (!world) return log(`world unavailable in guild ${room.guildId}`);
  const first = !room.world;
  room.world = world;
  if (first || again) await castFor(room);
}

function forget(guildId) {
  for (const [channelId, room] of rooms) {
    if (room.guildId !== guildId) continue;
    hush(room);
    rooms.delete(channelId);
    webhooks.delete(channelId);
    channels.delete(channelId);
  }
}

async function watch(guild) {
  forget(guild.id);
  const found = await ensureChannel(guild, { state, config, botUserId: client.user.id, log });
  save();
  if (!found) return;
  const room = createRoom(guild.id, found.channel.id);
  room.webhookId = found.webhook.id;
  await findWorld(room);
  try {
    const recent = await found.channel.messages.fetch({ limit: 100 });
    seed(room, recent.values(), castOf(room, cast));
  } catch (error) {
    log(`history unavailable in guild ${guild.id}: ${error?.code ?? "error"}`);
  }
  webhooks.set(found.channel.id, found.webhook);
  channels.set(found.channel.id, found.channel);
  rooms.set(found.channel.id, room);
}

function jot(body) {
  return conversationNotes(fetch, config.ORCHESTRATOR_URL, config.COSYWORLD_BOT_TOKEN, body);
}

function ask(body, signal) {
  return coordinate(fetch, config.ORCHESTRATOR_URL, config.COSYWORLD_BOT_TOKEN, body, signal);
}

function poll() {
  lastTickAt = Date.now();
}

function turnDeps(room) {
  return {
    config,
    cast: castOf(room, cast),
    state,
    lines: (body, signal) => channelLines(fetch, config.ORCHESTRATOR_URL, config.COSYWORLD_BOT_TOKEN, body, signal),
    send: (room, payload) => webhooks.get(room.channelId)?.send(payload),
    typing: (room) => channels.get(room.channelId)?.sendTyping(),
    save,
    log,
    stats,
    sleep: wait,
    coordinate: ask,
    notes: jot,
  };
}

client.once(Events.ClientReady, async () => {
  try {
    await client.application.commands.set(commandDefinitions());
  } catch (error) {
    log(`command registration failed: ${error?.code ?? "error"}`);
  }
  await refreshCast();
  for (const guild of client.guilds.cache.values()) {
    await watch(guild).catch(() => log(`watch failed in guild ${guild.id}`));
  }
  setInterval(poll, Math.max(1000, config.DISCORD_POLL_MS));
  setInterval(() => log(summary(stats)), 600000);
  setInterval(() => {
    void refreshCast();
    for (const room of rooms.values()) void findWorld(room, true);
  }, Math.max(60000, config.DISCORD_CAST_REFRESH_MS));
  log("Lonely Forest gateway ready");
});

client.on(Events.GuildCreate, async (guild) => {
  guildState(state, guild.id).off = false;
  await watch(guild).catch(() => log(`watch failed in guild ${guild.id}`));
});

client.on(Events.GuildDelete, (guild) => {
  forget(guild.id);
  delete state.guilds[guild.id];
  save();
});

client.on(Events.ChannelDelete, (channel) => {
  const room = rooms.get(channel.id);
  if (!room) return;
  hush(room);
  rooms.delete(channel.id);
  webhooks.delete(channel.id);
  channels.delete(channel.id);
  const entry = guildState(state, room.guildId);
  entry.off = true;
  entry.channelId = null;
  save();
  log(`channel removed in guild ${room.guildId}`);
});

client.on(Events.MessageCreate, (message) => {
  const room = rooms.get(message.channelId);
  if (!room) return;
  if (!room.world && Date.now() - (room.soughtAt ?? 0) > 60000) void findWorld(room);
  const entry = record(room, message, room.webhookId, castOf(room, cast), stats);
  heard(room, entry, turnDeps(room));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const room = [...rooms.values()].find((known) => known.guildId === interaction.guildId);
  const result = dispatch(interaction.commandName, {
    cast: () => castOf(room, cast),
    pack: config.DISCORD_PACK,
    assetBase: config.ORCHESTRATOR_URL,
    world: room?.world,
  });
  try {
    await interaction.reply({
      content: result.content,
      flags: result.ephemeral ? MessageFlags.Ephemeral : undefined,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    log(`reply failed: ${error?.code ?? "error"}`);
  }
});

startHealth(8080, () => ({
  ready: client.isReady(),
  rooms: rooms.size,
  cast: cast.length,
  lastTickAt,
  startedAt,
}));

client.login(config.DISCORD_TOKEN);
