const NUMBERS = {
  DISCORD_POLL_MS: 10000,
  DISCORD_ADDRESSED_DEBOUNCE_MS: 1500,
  DISCORD_TYPING_MS: 8000,
  DISCORD_DAILY_REPLIES: 500,
  DISCORD_CONTEXT_MESSAGES: 12,
  DISCORD_CAST_REFRESH_MS: 3600000,
  DISCORD_BEAT_MIN_CHARS: 140,
  DISCORD_COORDINATE_INLINE_MS: 1500,
  DISCORD_DECISION_MESSAGES: 150,
  DISCORD_DECISION_MS: 3600000,
  DISCORD_NOTES_EVERY: 4,
  DISCORD_NEXT_THRESHOLD: 0.5,
  DISCORD_MAX_RESIDENT_RUN: 4,
  DISCORD_LINE_GAP_MS: 4000,
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
