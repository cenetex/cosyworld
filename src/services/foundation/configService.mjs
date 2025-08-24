/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_DIR = path.resolve(__dirname, '../config');

export class ConfigService {
  constructor({ logger, secretsService } = {}) {
    this.logger = logger;
    this.secrets = secretsService;

    // Initialize global configuration with defaults from environment variables
    this.config = {
      server: {
        host: process.env.HOST || '0.0.0.0',
        // Support separate dev vs prod ports so both can run simultaneously.
        // Precedence: explicit WEB_PORT (forces both), then environment-specific (DEV_WEB_PORT/PROD_WEB_PORT), then default 3000.
        port: Number((() => {
          const isProd = process.env.NODE_ENV === 'production';
          const explicit = process.env.WEB_PORT || (isProd ? (process.env.PROD_WEB_PORT || process.env.PRODUCTION_WEB_PORT) : (process.env.DEV_WEB_PORT || process.env.DEVELOPMENT_WEB_PORT));
          if (explicit) return explicit;
          // Deterministic separate defaults: prod=3000, dev=3100 so both can run simultaneously
          return isProd ? 3000 : 3100;
        })()),
        baseUrl: process.env.BASE_URL || (() => {
          const isProd = process.env.NODE_ENV === 'production';
          const explicit = process.env.WEB_PORT || (isProd ? (process.env.PROD_WEB_PORT || process.env.PRODUCTION_WEB_PORT) : (process.env.DEV_WEB_PORT || process.env.DEVELOPMENT_WEB_PORT));
          const p = explicit || (isProd ? 3000 : 3100);
          return `http://localhost:${p}`;
        })(),
        publicUrl: process.env.PUBLIC_URL || process.env.BASE_URL || (() => {
          const isProd = process.env.NODE_ENV === 'production';
          const explicit = process.env.WEB_PORT || (isProd ? (process.env.PROD_WEB_PORT || process.env.PRODUCTION_WEB_PORT) : (process.env.DEV_WEB_PORT || process.env.DEVELOPMENT_WEB_PORT));
          const p = explicit || (isProd ? 3000 : 3100);
          return `http://localhost:${p}`;
        })(),
        cors: {
          enabled: true,
          origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s=>s.trim()) : '*',
          credentials: false
        },
        session: {
          cookieName: 'authToken',
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax'
        },
        admin: {
          enabled: true,
          loginPath: '/admin/login',
          gateAll: true
        },
  rateLimit: { enabled: process.env.NODE_ENV === 'production', windowMs: 60000, max: 120 }
      },
      prompt: {
        summon: process.env.SUMMON_PROMPT || "Create a twisted avatar, a servant of dark V.A.L.I.S.",
  introduction: process.env.INTRODUCTION_PROMPT || "You've just arrived. Introduce yourself.",
  attack: process.env.ATTACK_PROMPT || "You are {avatar_name}, attacking {target_name} with your abilities.",
  defend: process.env.DEFEND_PROMPT || "You are {avatar_name}, defending against an attack.",
  breed: process.env.BREED_PROMPT || "Describe the fusion of two avatars and the traits the offspring inherits."
      },
      ai: {
        veo: {
          rateLimit: {
            perMinute: Number(process.env.VEO_RATE_PER_MINUTE || process.env.VEO_PER_MINUTE || 2),
            perDay: Number(process.env.VEO_RATE_PER_DAY || process.env.VEO_PER_DAY || 50),
            // Hard global cap to guard against runaway usage; can be overridden via env
            globalCap: Number(process.env.VEO_GLOBAL_DAILY_CAP || process.env.VEO_GLOBAL_DAILY_LIMIT || 3)
          }
        },
        google: {
          apiKey: this.secrets?.get('GOOGLE_API_KEY') || this.secrets?.get('GOOGLE_AI_API_KEY') || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY,
          model: process.env.GOOGLE_AI_MODEL || 'gemini-2.0-flash-001',
          decisionMakerModel: process.env.GOOGLE_AI_DECISION_MAKER_MODEL || 'gemini-2.0-flash',
          structuredModel: process.env.GOOGLE_AI_STRUCTURED_MODEL || 'models/gemini-2.0-flash',
          chatModel: process.env.GOOGLE_AI_CHAT_MODEL || 'gemini-2.0-flash',
          visionModel: process.env.GOOGLE_AI_VISION_MODEL || 'gemini-2.0-flash-001',
          temperature: 0.7,
          maxTokens: 1000,
          topP: 1.0
        },
        openrouter: {
          apiKey: this.secrets?.get('OPENROUTER_API_KEY') || this.secrets?.get('OPENROUTER_API_TOKEN') || process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_TOKEN,
          model: process.env.STRUCTURED_MODEL || 'meta-llama/llama-3.2-3b-instruct',
          decisionMakerModel: process.env.GOOGLE_AI_DECISION_MAKER_MODEL || 'google/gemma-3-4b-it:free',
          structuredModel: process.env.OPENROUTER_STRUCTURED_MODEL || 'openai/gpt-4o',
          chatModel: process.env.OPENROUTER_CHAT_MODEL || 'meta-llama/llama-3.2-1b-instruct',
          visionModel: process.env.OPENROUTER_VISION_MODEL || '"x-ai/grok-2-vision-1212"',
          temperature: 0.8,
          maxTokens: 1000,
          topP: 1.0
        },
        replicate: {
          apiToken: this.secrets?.get('REPLICATE_API_TOKEN') || process.env.REPLICATE_API_TOKEN,
          model: process.env.REPLICATE_MODEL,
          lora_weights: process.env.REPLICATE_LORA_WEIGHTS,
          loraTriggerWord: process.env.REPLICATE_LORA_TRIGGER,
          style: "Cyberpunk, Manga, Anime, Watercolor, Experimental."
        },
      },
      mongo: {
        uri: this.secrets?.get('MONGO_URI') || process.env.MONGO_URI,
        dbName: process.env.MONGO_DB_NAME || 'discord-bot',
        collections: {
          avatars: 'avatars',
          imageUrls: 'image_urls',
          guildConfigs: 'guild_configs'
        }
      },
      webhooks: {}
    };

    this.guildConfigCache = new Map(); // Cache for guild configurations
  }

  static deepMerge(target, source) {
    for (const key of Object.keys(source || {})) {
      const sv = source[key];
      const tv = target[key];
      if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
        target[key] = ConfigService.deepMerge(tv && typeof tv === 'object' ? { ...tv } : {}, sv);
      } else {
        target[key] = sv;
      }
    }
    return target;
  }

  getAIConfig(service = null) {
    if (service) {
      return this.config.ai[service] || this.config.ai.openrouter;
    }
    if (!process.env.AI_SERVICE) {
      console.warn('AI_SERVICE not found in environment variables, using default: openrouter');
    }
    service = service || process.env.AI_SERVICE || 'openrouter';
    if (service === 'replicate') {
      return this.config.ai.replicate;
    }
    if (service === 'openrouter') {
      return this.config.ai.openrouter;
    }
    if (service === 'openai') {
      return this.config.ai.openai;
    }
    if (service === 'ollama') {
      return this.config.ai.ollama;
    }
    if (service === 'google') {
      return this.config.ai.google;
    }
    console.warn(`Unknown AI service: ${service}. Defaulting to openrouter.`);
    return this.config.ai.openrouter;
  }

  // Load global configuration from JSON files
  async loadConfig() {
    try {
      // 1) Load JSON template defaults first
      let merged = {};
      try {
        const defaultConfig = JSON.parse(await fs.readFile(path.join(CONFIG_DIR, 'default.config.json'), 'utf8'));
        merged = ConfigService.deepMerge(merged, defaultConfig);
      } catch {}

      // 2) Merge in the in-code/env-derived defaults so env vars override file defaults
      merged = ConfigService.deepMerge(merged, this.config);

  // 3) Merge environment-specific overrides file if present
      //    Looks for services/config/{NODE_ENV}.config.json and services/config/user.config.json
  const envName = process.env.NODE_ENV || 'development';
      const candidates = [
        path.join(CONFIG_DIR, `${envName}.config.json`),
        path.join(CONFIG_DIR, 'user.config.json')
      ];
      for (const file of candidates) {
        try {
          const content = await fs.readFile(file, 'utf8');
          const json = JSON.parse(content);
          merged = ConfigService.deepMerge(merged, json);
        } catch {}
      }

      // Finalize: enforce deterministic defaults if not explicitly overridden by env vars
      const explicitEnvPort = process.env.WEB_PORT || process.env.PROD_WEB_PORT || process.env.PRODUCTION_WEB_PORT || process.env.DEV_WEB_PORT || process.env.DEVELOPMENT_WEB_PORT;
      if (!explicitEnvPort) {
        if ((process.env.NODE_ENV || 'development') === 'production') {
          merged.server.port = 3000;
          merged.server.baseUrl = merged.server.baseUrl?.replace(/:\d+$/,'') + ':3000';
          merged.server.publicUrl = merged.server.publicUrl?.replace(/:\d+$/,'') + ':3000';
        } else {
          merged.server.port = 3100;
          merged.server.baseUrl = merged.server.baseUrl?.replace(/:\d+$/,'') + ':3100';
          merged.server.publicUrl = merged.server.publicUrl?.replace(/:\d+$/,'') + ':3100';
        }
      }

      // Diagnostic logging (temporarily verbose to trace unexpected port values)
      try {
        const envPortVars = {
          WEB_PORT: process.env.WEB_PORT,
          DEV_WEB_PORT: process.env.DEV_WEB_PORT || process.env.DEVELOPMENT_WEB_PORT,
          PROD_WEB_PORT: process.env.PROD_WEB_PORT || process.env.PRODUCTION_WEB_PORT,
          NODE_ENV: process.env.NODE_ENV
        };
        this.logger?.info?.(`[config] Final server.port=${merged.server.port} (explicitEnvPort=${explicitEnvPort||'none'}) envVars=${JSON.stringify(envPortVars)}`);
      } catch {}

  this.config = merged;
    } catch (error) {
      console.error('Error loading config:', error);
    }
  }

  // Get a specific global configuration key, supporting dot notation
  get(key) {
    if (!key) return undefined;
    const parts = key.split('.');
    let value = this.config;
    for (const part of parts) {
      if (value && Object.prototype.hasOwnProperty.call(value, part)) {
        value = value[part];
      } else {
        return undefined;
      }
    }
    return value;
  }

  // Get Discord-specific configuration
  getDiscordConfig() {
    if (!(this.secrets?.get('DISCORD_BOT_TOKEN') || process.env.DISCORD_BOT_TOKEN)) {
      console.warn('DISCORD_BOT_TOKEN not found in environment variables');
    }
    return {
      botToken: this.secrets?.get('DISCORD_BOT_TOKEN') || process.env.DISCORD_BOT_TOKEN,
      clientId: this.secrets?.get('DISCORD_CLIENT_ID') || process.env.DISCORD_CLIENT_ID,
      webhooks: this.config.webhooks || {}
    };
  }

  // Get default guild configuration
  getDefaultGuildConfig(guildId) {
    return {
      guildId,
      whitelisted: false,
      summonerRole: "🔮",
      summonEmoji: "🔮",
      prompts: {
  summon: this.config.prompt.summon,
  introduction: this.config.prompt.introduction,
  attack: this.config.prompt.attack,
  defend: this.config.prompt.defend,
  breed: this.config.prompt.breed
      },
      toolEmojis: {
        summon: '🔮',
        breed: '🏹',
        attack: '⚔️',
        defend: '🛡️'
      },
      features: {
        breeding: true,
        combat: true,
        itemCreation: true
      },
      viewDetailsEnabled: true,
      enableForumTool: false, // ForumTool disabled by default
      forumToolChannelId: null // Optional channel restriction
    };
  }

  // Merge database guild config with defaults
  mergeWithDefaults(guildConfig, guildId) {
    const defaults = this.getDefaultGuildConfig(guildId);
    const merged = {
      ...defaults,
      ...guildConfig,
      prompts: {
  summon: guildConfig?.prompts?.summon || defaults.prompts.summon,
  introduction: guildConfig?.prompts?.introduction || defaults.prompts.introduction,
  attack: guildConfig?.prompts?.attack || defaults.prompts.attack,
  defend: guildConfig?.prompts?.defend || defaults.prompts.defend,
  breed: guildConfig?.prompts?.breed || defaults.prompts.breed
      },
      toolEmojis: {
        ...defaults.toolEmojis,
        ...(guildConfig?.toolEmojis || {})
      },
      features: {
        ...defaults.features,
        ...(guildConfig?.features || {})
      },
      viewDetailsEnabled: guildConfig?.viewDetailsEnabled !== undefined ? guildConfig.viewDetailsEnabled : defaults.viewDetailsEnabled
    };

    merged.summonEmoji = merged.toolEmojis.summon || '🔮';

    return merged;
  }

  // Get guild configuration with caching
  async getGuildConfig(guildId, forceRefresh = false) {
    if (!guildId) {
      console.warn(`Invalid guild ID: ${guildId}`);
      return this.getDefaultGuildConfig(guildId);
    }

    // Check cache first
    if (!forceRefresh && this.guildConfigCache.has(guildId)) {
      return this.guildConfigCache.get(guildId);
    }

    // Resolve database connection
    let db = this.db || (this.client?.db) || (global.databaseService ? await global.databaseService.getDatabase() : null);
    if (!db) {
      console.warn(`No database connection for guild ${guildId}`);
      return this.getDefaultGuildConfig(guildId);
    }

    try {
      const collection = db.collection(this.config.mongo.collections.guildConfigs);
      const guildConfig = await collection.findOne({ guildId });
      const mergedConfig = this.mergeWithDefaults(guildConfig, guildId);
      this.guildConfigCache.set(guildId, mergedConfig);
      return mergedConfig;
    } catch (error) {
      console.error(`Error fetching guild config for ${guildId}:`, error);
      return this.getDefaultGuildConfig(guildId);
    }
  }

  // Update guild configuration
  async updateGuildConfig(guildId, updates) {
    if (!guildId) throw new Error('guildId is required');

    // Resolve database connection
    let db = this.db || (this.client?.db) || (global.databaseService ? await global.databaseService.getDatabase() : null);
    if (!db) throw new Error('No database connection available');

    try {
      const collection = db.collection(this.config.mongo.collections.guildConfigs);
      const setUpdates = { ...updates, updatedAt: new Date() };
      const result = await collection.updateOne(
        { guildId },
        { $set: setUpdates },
        { upsert: true }
      );

      // Update cache with the latest config
      const newGuildConfig = await collection.findOne({ guildId });
      const mergedConfig = this.mergeWithDefaults(newGuildConfig, guildId);
      this.guildConfigCache.set(guildId, mergedConfig);
      return result;
    } catch (error) {
      console.error(`Error updating guild config for ${guildId}:`, error);
      throw error;
    }
  }

  // Get all guild configurations
  async getAllGuildConfigs(db) {
    db = db || this.db || (this.client?.db) || (global.databaseService ? await global.databaseService.getDatabase() : null);
    if (!db) throw new Error('No database connection available');

    try {
      const collection = db.collection(this.config.mongo.collections.guildConfigs);
      return await collection.find({}).toArray();
    } catch (error) {
      console.error('Error fetching all guild configs:', error);
      throw error;
    }
  }

  // Get guild-specific prompts
  async getGuildPrompts(guildId) {
    const guildConfig = await this.getGuildConfig(guildId);
    return guildConfig.prompts;
  }

  // Validate critical configurations
  validate() {
    if (!this.config.mongo.uri) {
      console.warn('MongoDB URI not configured. Database functionality will be limited.');
    }
    if (!this.config.ai.replicate.apiToken) {
      console.warn('Replicate API token not configured. Image generation will be disabled.');
    }
    return true;
  }
}
