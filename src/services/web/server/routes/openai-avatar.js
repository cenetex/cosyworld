/**
 * OpenAI-compatible Avatar API (Swarm Avatar API compatible)
 *
 * Implements:
 * - GET  /v1/models
 * - GET  /v1/models/:model_id
 * - POST /v1/chat/completions
 *
 * Auth:
 * - Authorization: Bearer sk-rati-...
 *
 * Note: This implementation uses simple in-memory energy tracking by default.
 */

import express from 'express';
import crypto from 'crypto';

const DEFAULT_ENERGY_MAX = 10;
const DEFAULT_ENERGY_REFILL_RATE = 1;
const DEFAULT_ENERGY_REFILL_INTERVAL_MINUTES = 60;
const DEFAULT_COST_TEXT = 1;
const DEFAULT_COST_AUDIO = 2;

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function parseBearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h) return null;
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function toErrorResponse(message, type, code) {
  return {
    error: {
      message: String(message || 'Error'),
      type: String(type || 'server_error'),
      code: code == null ? null : String(code),
    },
  };
}

function sendError(res, status, message, type, code) {
  res.status(status).json(toErrorResponse(message, type, code));
}

function normalizeAvatarModelId(model) {
  const m = String(model || '').trim();
  if (!m) return null;
  if (m.toLowerCase().startsWith('avatar:')) return m;
  return `avatar:${m}`;
}

function modelIdToAvatarKey(modelId) {
  const raw = String(modelId || '').trim();
  if (!raw) return null;
  const withoutPrefix = raw.toLowerCase().startsWith('avatar:') ? raw.slice('avatar:'.length) : raw;
  return withoutPrefix.trim();
}

function toSlug(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  // Keep it simple but stable: letters/numbers/dashes
  return s
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
}

function estimateTokens(text) {
  const t = String(text || '');
  return Math.max(1, Math.ceil(t.length / 4));
}

// In-memory state (per-process)
const energyStateByKeyHash = new Map();

function getEnergyConfigFromEnv() {
  return {
    max: Number(process.env.AVATAR_API_ENERGY_MAX || DEFAULT_ENERGY_MAX),
    refillRate: Number(process.env.AVATAR_API_ENERGY_REFILL_RATE || DEFAULT_ENERGY_REFILL_RATE),
    refillIntervalMinutes: Number(
      process.env.AVATAR_API_ENERGY_REFILL_INTERVAL_MINUTES || DEFAULT_ENERGY_REFILL_INTERVAL_MINUTES
    ),
    costs: {
      text: Number(process.env.AVATAR_API_ENERGY_COST_TEXT || DEFAULT_COST_TEXT),
      audio: Number(process.env.AVATAR_API_ENERGY_COST_AUDIO || DEFAULT_COST_AUDIO),
    },
  };
}

function refillEnergyIfNeeded(state, cfg) {
  const intervalMs = Math.max(1, cfg.refillIntervalMinutes) * 60_000;
  const now = Date.now();

  if (!state.nextRefillAtMs) {
    state.nextRefillAtMs = now + intervalMs;
    return state;
  }

  if (now < state.nextRefillAtMs) return state;

  const elapsed = now - state.nextRefillAtMs;
  const intervalsPassed = 1 + Math.floor(elapsed / intervalMs);
  const gained = intervalsPassed * Math.max(0, cfg.refillRate);

  state.current = Math.min(cfg.max, Number(state.current || 0) + gained);
  state.nextRefillAtMs = state.nextRefillAtMs + intervalsPassed * intervalMs;
  return state;
}

function toEnergyResponse(state, cfg, { includeCosts } = {}) {
  const now = Date.now();
  const nextMinutes = Math.max(0, Math.ceil((state.nextRefillAtMs - now) / 60_000));
  const base = {
    current: Number(state.current ?? cfg.max),
    max: Number(cfg.max),
    refill_rate: Number(cfg.refillRate),
    next_refill_minutes: nextMinutes,
  };
  if (includeCosts) base.costs = { ...cfg.costs };
  return base;
}

async function resolveApiKeyRecord({ db, apiKey }) {
  // 1) DB lookup (if collection exists)
  try {
    const hash = sha256Hex(apiKey);
    const doc = await db.collection('avatar_api_keys').findOne({ keyHash: hash });
    if (doc) return { source: 'db', record: doc };
  } catch {
    // ignore (collection may not exist yet)
  }

  // 2) Env-based keys: AVATAR_API_KEYS as JSON array or comma-separated
  const raw = process.env.AVATAR_API_KEYS || process.env.AVATAR_OPENAI_API_KEYS || '';
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const match = parsed.find((k) => k && k.key && String(k.key) === String(apiKey));
      if (match) return { source: 'env', record: match };
    }
  } catch {
    // fall back to comma-separated
    const keys = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (keys.includes(apiKey)) return { source: 'env', record: { key: apiKey, scope: '*' } };
  }

  return null;
}

function scopeAllowsAvatar(scope, avatarKey) {
  if (!scope) return true;
  const s = String(scope).trim();
  if (!s || s === '*') return true;

  // Accept either "avatar:rati" or "rati"
  const target = modelIdToAvatarKey(s);
  return target === String(avatarKey || '').trim().toLowerCase();
}

async function findAvatarByModel({ db, services, modelId }) {
  const avatarKey = modelIdToAvatarKey(modelId);
  if (!avatarKey) return null;

  // Prefer avatarService if available (handles IDs/names)
  const avatarService = services?.avatarService;
  if (avatarService?.getAvatarByName) {
    try {
      // Try exact name first, then slug-ish fallback
      const exact = await avatarService.getAvatarByName(avatarKey);
      if (exact) return exact;
    } catch {
      // ignore
    }
  }

  // DB fallback: case-insensitive name match
  const re = new RegExp(`^${avatarKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const doc = await db.collection('avatars').findOne({ name: re });
  return doc || null;
}

function toModelListItem(avatar) {
  const created = avatar?.createdAt ? Math.floor(new Date(avatar.createdAt).getTime() / 1000) : nowSeconds();
  const name = avatar?.name || 'Unknown';
  const modelId = `avatar:${toSlug(name) || String(name).toLowerCase()}`;

  return {
    id: modelId,
    object: 'model',
    created,
    owned_by: 'cosyworld',
    capabilities: { voice: false },
    avatar: {
      name,
      description: avatar?.description || avatar?.personality || '',
      profile_image: avatar?.profile_image || avatar?.thumbnailUrl || avatar?.imageUrl || null,
    },
  };
}

function toModelDetails(avatar, energy) {
  const name = avatar?.name || 'Unknown';
  const modelId = `avatar:${toSlug(name) || String(name).toLowerCase()}`;

  return {
    id: modelId,
    object: 'model',
    capabilities: { voice: false },
    avatar: {
      id: toSlug(name) || String(name).toLowerCase(),
      name,
      description: avatar?.description || avatar?.personality || '',
      profile_image: avatar?.profile_image || avatar?.thumbnailUrl || avatar?.imageUrl || null,
      character_reference: avatar?.character_reference || null,
      platforms: avatar?.platforms || { telegram: null, twitter: null, discord: null },
      voice: avatar?.voice || null,
      sticker_pack: avatar?.sticker_pack || null,
    },
    energy,
  };
}

function buildSystemPrompt({ avatar, promptService, db }) {
  if (promptService?.getFullSystemPrompt) {
    return promptService.getFullSystemPrompt(avatar, db);
  }
  if (promptService?.getBasicSystemPrompt) {
    return promptService.getBasicSystemPrompt(avatar);
  }
  const name = avatar?.name || 'this avatar';
  const personality = avatar?.personality || '';
  const description = avatar?.description || '';
  return `You are ${name}. ${personality} ${description}`.trim();
}

export default function createOpenAIAvatarRouter(db, services = {}) {
  const router = express.Router();

  // Auth + energy middleware
  router.use(async (req, res, next) => {
    try {
      const apiKey = parseBearerToken(req);
      if (!apiKey) {
        return sendError(res, 401, 'Missing or invalid API key', 'authentication_error', 'missing_api_key');
      }
      if (!String(apiKey).startsWith('sk-rati-')) {
        return sendError(res, 401, 'Invalid API key', 'authentication_error', 'invalid_api_key');
      }

      const keyRecord = await resolveApiKeyRecord({ db, apiKey });
      if (!keyRecord) {
        return sendError(res, 401, 'Invalid API key', 'authentication_error', 'invalid_api_key');
      }

      const keyHash = sha256Hex(apiKey);
      const cfg = getEnergyConfigFromEnv();

      let state = energyStateByKeyHash.get(keyHash);
      if (!state) {
        state = {
          current: cfg.max,
          nextRefillAtMs: Date.now() + cfg.refillIntervalMinutes * 60_000,
        };
      }

      state = refillEnergyIfNeeded(state, cfg);
      energyStateByKeyHash.set(keyHash, state);

      req.avatarApi = {
        apiKey,
        keyHash,
        scope: keyRecord?.record?.scope || '*',
        energyCfg: cfg,
        energyState: state,
      };

      next();
    } catch (e) {
      services?.logger?.error?.('[openai-avatar] auth middleware error:', e);
      return sendError(res, 500, 'Internal error', 'server_error', 'server_error');
    }
  });

  // GET /v1/models
  router.get('/v1/models', async (req, res) => {
    try {
      const { scope, energyCfg, energyState } = req.avatarApi;

      const avatars = await db
        .collection('avatars')
        .find({}, { projection: { name: 1, description: 1, personality: 1, imageUrl: 1, thumbnailUrl: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .limit(1000)
        .toArray();

      const filtered = avatars.filter((a) => scopeAllowsAvatar(scope, toSlug(a?.name || '')));
      const data = filtered.map(toModelListItem);

      res.json({
        object: 'list',
        data,
        energy: toEnergyResponse(energyState, energyCfg, { includeCosts: false }),
      });
    } catch (e) {
      services?.logger?.error?.('[openai-avatar] GET /v1/models failed:', e);
      return sendError(res, 500, 'Internal error', 'server_error', 'server_error');
    }
  });

  // GET /v1/models/:model_id
  router.get('/v1/models/:modelId', async (req, res) => {
    try {
      const modelId = decodeURIComponent(req.params.modelId);
      const { scope, energyCfg, energyState } = req.avatarApi;

      const avatarKey = modelIdToAvatarKey(modelId)?.toLowerCase();
      if (!scopeAllowsAvatar(scope, avatarKey)) {
        return sendError(res, 403, "API key doesn't have access to this avatar", 'permission_error', 'permission_denied');
      }

      const avatar = await findAvatarByModel({ db, services, modelId });
      if (!avatar) {
        return sendError(res, 404, 'Avatar not found', 'not_found', 'not_found');
      }

      const energy = toEnergyResponse(energyState, energyCfg, { includeCosts: true });
      res.json(toModelDetails(avatar, energy));
    } catch (e) {
      services?.logger?.error?.('[openai-avatar] GET /v1/models/:id failed:', e);
      return sendError(res, 500, 'Internal error', 'server_error', 'server_error');
    }
  });

  // POST /v1/chat/completions
  router.post('/v1/chat/completions', async (req, res) => {
    try {
      const body = req.body || {};
      const requestedModel = normalizeAvatarModelId(body.model);
      const messages = Array.isArray(body.messages) ? body.messages : null;

      if (!requestedModel) {
        return sendError(res, 400, 'Missing required field: model', 'invalid_request_error', 'missing_model');
      }
      if (!messages) {
        return sendError(res, 400, 'Missing required field: messages', 'invalid_request_error', 'missing_messages');
      }

      const includeAudio = Boolean(body.include_audio);

      // Scope check
      const { scope, energyCfg, energyState } = req.avatarApi;
      const avatarKey = modelIdToAvatarKey(requestedModel)?.toLowerCase();
      if (!scopeAllowsAvatar(scope, avatarKey)) {
        return sendError(res, 403, "API key doesn't have access to this avatar", 'permission_error', 'permission_denied');
      }

      // Feature check
      if (includeAudio) {
        return sendError(res, 400, 'Audio is not supported for this server', 'invalid_request_error', 'audio_not_supported');
      }

      const cost = includeAudio ? energyCfg.costs.audio : energyCfg.costs.text;
      if (Number(energyState.current || 0) < cost) {
        return sendError(res, 402, 'Not enough energy to process request', 'insufficient_energy', 'insufficient_energy');
      }

      const avatar = await findAvatarByModel({ db, services, modelId: requestedModel });
      if (!avatar) {
        return sendError(res, 404, 'Avatar not found', 'not_found', 'not_found');
      }

      // Deduct energy
      energyState.current = Math.max(0, Number(energyState.current || 0) - cost);
      energyStateByKeyHash.set(req.avatarApi.keyHash, energyState);

      // Build persona system prompt
      const personaPrompt = await buildSystemPrompt({ avatar, promptService: services.promptService, db });

      // Normalize incoming OpenAI messages to {role, content}
      const cleanedMessages = messages
        .map((m) => ({ role: m?.role, content: m?.content }))
        .filter((m) => m && typeof m.role === 'string')
        .map((m) => ({ ...m, content: m.content == null ? '' : String(m.content) }));

      const finalMessages = [{ role: 'system', content: personaPrompt }, ...cleanedMessages];

      // Select underlying LLM model (avatar.model if configured)
      const providerModel = avatar?.model && String(avatar.model).toLowerCase() !== 'none' ? avatar.model : undefined;

      const temperature = typeof body.temperature === 'number' ? body.temperature : undefined;
      const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : undefined;

      const aiService = services.aiService;
      if (!aiService?.chat) {
        return sendError(res, 500, 'AI service not available', 'server_error', 'ai_service_unavailable');
      }

      const env = await aiService.chat(finalMessages, {
        ...(providerModel ? { model: providerModel } : {}),
        ...(temperature != null ? { temperature } : {}),
        ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
        returnEnvelope: true,
      });

      if (env?.error) {
        services?.logger?.warn?.('[openai-avatar] AI error:', env.error);
        return sendError(res, 500, env.error.message || 'AI request failed', 'server_error', env.error.code || 'ai_error');
      }

      const content = String(env?.text || '').trim();

      const rawUsage = env?.raw?.usage || {};
      const promptTokens = Number(rawUsage.prompt_tokens || rawUsage.input_tokens || 0) || estimateTokens(JSON.stringify(finalMessages));
      const completionTokens = Number(rawUsage.completion_tokens || rawUsage.output_tokens || 0) || estimateTokens(content);
      const totalTokens = Number(rawUsage.total_tokens || 0) || promptTokens + completionTokens;

      const response = {
        id: `chatcmpl-${crypto.randomBytes(12).toString('hex')}`,
        object: 'chat.completion',
        created: nowSeconds(),
        model: requestedModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content,
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
        },
      };

      res.json(response);
    } catch (e) {
      services?.logger?.error?.('[openai-avatar] POST /v1/chat/completions failed:', e);
      return sendError(res, 500, 'Internal error', 'server_error', 'server_error');
    }
  });

  return router;
}
