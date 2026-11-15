import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { readConfig } from "./config.mjs";
import { commandDefinitions, dispatch } from "./commands.mjs";
import { ensureChannel, guildState, loadState, saveState } from "./channel.mjs";
import { createRoom, record, seed, tick } from "./room.mjs";
import { channelLines, fetchCast } from "./orchestrator.mjs";

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
let cast = [];

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
    rooms.delete(channelId);
    webhooks.delete(channelId);
  }
}

async function watch(guild) {
  forget(guild.id);
  const found = await ensureChannel(guild, { state, config, botUserId: client.user.id, log });
  save();
  if (!found) return;
  const room = createRoom(guild.id, found.channel.id);
  room.webhookId = found.webhook.id;
  try {
    const recent = await found.channel.messages.fetch({ limit: 20 });
    seed(room, recent.values(), cast);
  } catch (error) {
    log(`history unavailable in guild ${guild.id}: ${error?.code ?? "error"}`);
  }
  webhooks.set(found.channel.id, found.webhook);
  rooms.set(found.channel.id, room);
}

function poll() {
  void tick({
    rooms,
    state,
    now: Date.now(),
    config,
    cast,
    lines: (body) => channelLines(fetch, config.ORCHESTRATOR_URL, config.COSYWORLD_BOT_TOKEN, body),
    send: (room, payload) => webhooks.get(room.channelId)?.send(payload),
    save,
  });
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
  rooms.delete(channel.id);
  webhooks.delete(channel.id);
  const entry = guildState(state, room.guildId);
  entry.off = true;
  entry.channelId = null;
  save();
  log(`channel removed in guild ${room.guildId}`);
});

client.on(Events.MessageCreate, (message) => {
  const room = rooms.get(message.channelId);
  if (!room) return;
  record(room, message, room.webhookId, cast);
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

client.login(config.DISCORD_TOKEN);
