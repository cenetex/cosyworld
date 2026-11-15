import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const TOPIC =
  "Residents of Lonely Forest talk here. Messages here are sent to AI models to write their replies.";
export const WEBHOOK_NAME = "Lonely Forest";
const GUILD_TEXT = 0;

export function emptyState() {
  return { version: 1, guilds: {} };
}

export function loadState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed?.version !== 1 || typeof parsed.guilds !== "object" || !parsed.guilds) {
      return emptyState();
    }
    return parsed;
  } catch {
    return emptyState();
  }
}

export function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state));
  renameSync(temp, file);
}

export function today(now) {
  return new Date(now).toISOString().slice(0, 10);
}

export function guildState(state, guildId) {
  state.guilds[guildId] ??= { channelId: null, off: false, day: "", replies: 0 };
  return state.guilds[guildId];
}

function isText(channel) {
  return channel?.type === GUILD_TEXT;
}

export async function ensureChannel(guild, { state, config, botUserId, log }) {
  const entry = guildState(state, guild.id);
  if (entry.off) {
    log(`guild ${guild.id} is off`);
    return null;
  }
  const channels = [...guild.channels.cache.values()];
  let channel = entry.channelId ? channels.find((c) => c.id === entry.channelId && isText(c)) : null;
  channel ??= channels.find((c) => isText(c) && c.name === config.DISCORD_CHANNEL_NAME) ?? null;
  if (!channel) {
    if (!guild.members.me?.permissions?.has("ManageChannels")) {
      log(`missing Manage Channels in guild ${guild.id}`);
      return null;
    }
    try {
      channel = await guild.channels.create({
        name: config.DISCORD_CHANNEL_NAME,
        type: GUILD_TEXT,
        topic: TOPIC,
      });
    } catch (error) {
      log(`channel create failed in guild ${guild.id}: ${error?.code ?? "error"}`);
      return null;
    }
  }
  entry.channelId = channel.id;
  try {
    const webhooks = [...(await channel.fetchWebhooks()).values()];
    const webhook =
      webhooks.find((hook) => hook.owner?.id === botUserId) ??
      (await channel.createWebhook({ name: WEBHOOK_NAME }));
    return { channel, webhook };
  } catch (error) {
    log(`missing Manage Webhooks in guild ${guild.id}: ${error?.code ?? "error"}`);
    return null;
  }
}
