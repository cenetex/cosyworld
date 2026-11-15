const NUMBERS = {
  DISCORD_POLL_MS: 10000,
  DISCORD_QUIET_MS: 45000,
  DISCORD_ADDRESSED_QUIET_MS: 8000,
  DISCORD_AMBIENT_MESSAGES: 6,
  DISCORD_AMBIENT_QUIET_MS: 120000,
  DISCORD_AMBIENT_COOLDOWN_MS: 1800000,
  DISCORD_MIN_REPLY_GAP_MS: 60000,
  DISCORD_DAILY_REPLIES: 100,
  DISCORD_DENSITY_WINDOW: 6,
  DISCORD_DENSITY_MAX: 2,
  DISCORD_CONTEXT_MESSAGES: 12,
  DISCORD_CAST_REFRESH_MS: 3600000,
};

function number(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function readConfig(env = {}) {
  const config = {
    DISCORD_TOKEN: env.DISCORD_TOKEN || "",
    COSYWORLD_BOT_TOKEN: env.COSYWORLD_BOT_TOKEN || "",
    ORCHESTRATOR_URL: (env.ORCHESTRATOR_URL || "http://127.0.0.1:3102").replace(/\/+$/, ""),
    DISCORD_STATE_FILE: env.DISCORD_STATE_FILE || "./discord-state.json",
    DISCORD_CHANNEL_NAME: env.DISCORD_CHANNEL_NAME || "lonely-forest",
    DISCORD_PACK: env.DISCORD_PACK || "lonely-forest",
  };
  for (const [key, fallback] of Object.entries(NUMBERS)) {
    config[key] = number(env[key], fallback);
  }
  return config;
}
