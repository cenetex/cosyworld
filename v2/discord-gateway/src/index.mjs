import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { readConfig } from "./config.mjs";
import { commandDefinitions, dispatch } from "./commands.mjs";
import { ensureChannel, guildState, loadState, saveState } from "./channel.mjs";
import { calm, createRoom, createStats, nudge, record, seed, summary, tick } from "./room.mjs";
import { startHealth } from "./health.mjs";
import { wait } from "./beats.mjs";
import { channelLines, coordinate, fetchCast } from "./orchestrator.mjs";
import { noteSoon } from "./coordinator.mjs";

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

function forget(guildId) {
  for (const [channelId, room] of rooms) {
    if (room.guildId !== guildId) continue;
    calm(room);
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
  room.talkMs = config.DISCORD_TALK_MS;
  try {
    const recent = await found.channel.messages.fetch({ limit: 20 });
    seed(room, recent.values(), cast);
  } catch (error) {
    log(`history unavailable in guild ${guild.id}: ${error?.code ?? "error"}`);
  }
  webhooks.set(found.channel.id, found.webhook);
  channels.set(found.channel.id, found.channel);
  rooms.set(found.channel.id, room);
}

function run(targets, now = Date.now()) {
  lastTickAt = Date.now();
  void tick({
    rooms: targets,
    state,
    now,
    config,
    cast,
    lines: (body, signal) => channelLines(fetch, config.ORCHESTRATOR_URL, config.COSYWORLD_BOT_TOKEN, body, signal),
    send: (room, payload) => webhooks.get(room.channelId)?.send(payload),
    typing: (room) => channels.get(room.channelId)?.sendTyping(),
    save,
    log,
    stats,
    sleep: wait,
    random: Math.random,
    coordinate: ask,
  });
}

function ask(body, signal) {
  return coordinate(fetch, config.ORCHESTRATOR_URL, config.COSYWORLD_BOT_TOKEN, body, signal);
}

function poll() {
  run(rooms);
}

function answerNow(room) {
  if (rooms.get(room.channelId) !== room) return;
  const last = room.messages.at(-1);
  const quiet = (last?.at ?? 0) + config.DISCORD_ADDRESSED_QUIET_MS;
  run(new Map([[room.channelId, room]]), Math.max(Date.now(), quiet));
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
  setInterval(() => void refreshCast(), Math.max(60000, config.DISCORD_CAST_REFRESH_MS));
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
  calm(room);
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
  const entry = record(room, message, room.webhookId, cast);
  nudge(room, entry, cast, { delay: config.DISCORD_ADDRESSED_DEBOUNCE_MS, run: answerNow });
  noteSoon(room, { config, cast, coordinate: ask, stats, log });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const result = dispatch(interaction.commandName, {
    cast: () => cast,
    pack: config.DISCORD_PACK,
    assetBase: config.ORCHESTRATOR_URL,
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
