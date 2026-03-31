/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';
import { buildAvatarQuery } from '../../../services/avatar/helpers/buildAvatarQuery.js';
import { aiModelService } from '../../ai/aiModelService.mjs';
import openrouterModelCatalog from '../../../models.openrouter.config.mjs';
import { isModelRosterAvatar } from '../../avatar/helpers/isModelRosterAvatar.mjs';
import { getAvatarModeFlags, isPureModelOnlyAvatarModes } from '../../avatar/helpers/avatarModeFlags.mjs';

const levenshteinDistance = (a = '', b = '') => {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
};

const MODEL_PROVIDER_LABELS = {
  google: 'Google',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  meta: 'Meta',
  'meta-llama': 'Meta',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  qwen: 'Qwen',
  nvidia: 'NVIDIA',
  'x-ai': 'xAI',
  x: 'xAI',
  deepseek: 'DeepSeek',
  baidu: 'Baidu',
  ai21: 'AI21',
  mistralai: 'Mistral',
  inflection: 'Inflection',
  'agentica-org': 'Agentica',
  'microsoft': 'Microsoft',
  'nomic-ai': 'Nomic AI'
};

const MODEL_PROVIDER_EMOJI = {
  google: '📡',
  openai: '🌀',
  anthropic: '✨',
  meta: '🧠',
  'meta-llama': '🧠',
  cohere: '🧩',
  perplexity: '🔍',
  qwen: '🕊️',
  nvidia: '⚡',
  'x-ai': '🚀',
  x: '🚀',
  deepseek: '🌊',
  baidu: '🐉',
  ai21: '🧮',
  mistralai: '🌬️',
  inflection: '🔶',
  'agentica-org': '🛰️',
  microsoft: '🪟',
  'nomic-ai': '🧭'
};

const MODEL_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:.-]*$/i;

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatSummonsday = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  try {
    return value.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return value.toISOString().split('T')[0];
  }
};

const stripHiddenTags = (text = '') => text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

const formatProviderLabel = (providerId = '') => {
  if (!providerId) return '';
  const lower = providerId.toLowerCase();
  if (MODEL_PROVIDER_LABELS[lower]) return MODEL_PROVIDER_LABELS[lower];
  return providerId
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ')
    .trim();
};

const normalizeModelIdentifier = (value = '') => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!trimmed) return null;
  if (!MODEL_SLUG_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase();
};

const humanizeSlugTokens = (segment = '') => {
  if (!segment) return [];
  return segment
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(token => {
      const lower = token.toLowerCase();
      if (/^[a-z]{1,3}$/.test(lower)) return lower.toUpperCase();
      if (/^[a-z]+$/.test(lower)) return lower.charAt(0).toUpperCase() + lower.slice(1);
      return token;
    });
};

const formatModelDisplayName = (modelId = '') => {
  const normalized = normalizeModelIdentifier(modelId) || (typeof modelId === 'string' ? modelId.trim() : '');
  if (!normalized || !normalized.includes('/')) return null;
  const [providerRaw, restRaw] = normalized.split('/', 2);
  if (!restRaw) return null;
  const [slug, variantRaw] = restRaw.split(':');
  const baseTokens = humanizeSlugTokens(slug);
  const variantTokens = humanizeSlugTokens(variantRaw);
  const displayTokens = [...baseTokens, ...variantTokens].filter(Boolean);
  if (!displayTokens.length) return null;
  const providerLabel = formatProviderLabel(providerRaw);
  const displayName = displayTokens.join(' ');
  return providerLabel ? `${displayName} (${providerLabel})` : displayName;
};

export class SummonTool extends BasicTool {
  constructor({
    discordService,
    mapService,
    avatarService,
    configService,
    databaseService,
    aiService,
    unifiedAIService,
    statService,
    presenceService,
    logger,
  }) {
    super();
    this.discordService = discordService;
    this.mapService = mapService;
    this.avatarService = avatarService;
    this.configService = configService;
    this.databaseService = databaseService;
    this.aiService = aiService;
    this.unifiedAIService = unifiedAIService;
    this.statService = statService;
    this.presenceService = presenceService;
    this.logger = logger;

    this.name = 'summon';
    this.description = 'Summons a new avatar';
    this.emoji = '🔮'; // Default emoji
  // Limit: one summon per user per day (excluding admin override)
  this.DAILY_SUMMON_LIMIT = 18;
    this.replyNotification = true;
    this.cooldownMs = 10 * 1000; // 1 minute cooldown
  }

  /**
   * Returns a static description of the tool.
   * @returns {string} The description.
   */
  getDescription() {
    return 'Summons a new avatar into existence';
  }

  /**
   * Returns the syntax of the tool.
   * @returns {string} The syntax.
   */
  async getSyntax() {
    return `${this.emoji} <avatar name or description>`;
  }

  /**
   * Checks if the user has not exceeded the daily summon limit.
   * @param {string} userId - The ID of the user.
   * @returns {boolean} Whether the user can summon.
   */
  async checkDailySummonLimit(userId) {
    try {
  // Always ensure DB reference (in case called before execute sets this.db)
  this.db = this.db || await this.databaseService.getDatabase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const count = await this.db.collection('daily_summons').countDocuments({ userId, timestamp: { $gte: today } });
      return count < this.DAILY_SUMMON_LIMIT;
    } catch (error) {
      this.logger.error(`Error checking summon limit: ${error.message}`);
      return false;
    }
  }

  /**
   * Tracks a summon event for the user.
   * @param {string} userId - The ID of the user.
   */
  async trackSummon(userId) {
    try {
  this.db = this.db || await this.databaseService.getDatabase();
      await this.db.collection('daily_summons').insertOne({
        userId,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Error tracking summon: ${error.message}`);
    }
  }

  /**
   * Executes the summon command, either summoning an existing avatar or creating a new one.
   * @param {Object} message - The Discord message object.
   * @param {Object} params - Parsed command parameters (e.g., { breed, attributes }).
   * @param {Object} avatar - The current avatar context, if applicable.
   * @returns {string} Result message for logging or further processing.
   */
  async execute(message, params = {}, _avatar) {
    try {
      this.db = await this.databaseService.getDatabase();
      const ensureModel = async (av) => {
        try {
          if (av && !av.model) {
            const picked = await this.aiService.selectRandomModel();
            if (picked) {
              av.model = picked;
              try { await this.avatarService.updateAvatar(av); } catch {}
              this.logger?.info?.(`[AI][SummonTool] assigned model='${picked}' to ${av.name || av._id}`);
            }
          }
        } catch (e) { this.logger?.warn?.(`[AI][SummonTool] ensureModel failed: ${e.message}`); }
        return av?.model;
      };
      // Parse command content robustly: remove leading emoji + optional word 'summon'
      const raw = (message.content || '').trim();
      const content = raw
        .replace(/^<a?:\w+?:\d+>\s*/,'') // custom discord emoji
        .replace(/^\p{Extended_Pictographic}+\s*/u,'') // unicode emoji(s)
        .replace(/^(summon)\s+/i,'')
        .trim();
      const [avatarName] = content.split(/\n|[,.;:]/).map(l => l.trim()).filter(Boolean);

      // If no textual description provided, but an image is attached, switch to image-based summoning
      const hasImageForSummon = !avatarName && message.hasImages && (message.imageDescription || message.primaryImageUrl);
      if (!avatarName && !hasImageForSummon) {
        await this.discordService.replyToMessage(message, 'Provide a name/description or attach an image to summon an avatar.');
        return '-# [ Summon aborted: no description or image provided. ]';
      }

      // Try to sync avatar from configured collections first (if it doesn't exist in DB yet)
      if (avatarName) {
        try {
          const { syncAvatarByNameFromCollections } = await import('../../../services/collections/collectionSyncService.mjs');
          const syncedAvatar = await syncAvatarByNameFromCollections(avatarName);
          if (syncedAvatar) {
            this.logger.info?.(`[SummonTool] Synced ${avatarName} from collection before summoning`);
          }
        } catch (e) {
          this.logger.debug?.(`[SummonTool] Collection sync check failed: ${e.message}`);
          // Continue anyway - not a critical failure
        }
      }

      // Check for existing avatar
  const existingAvatar = avatarName ? await this.avatarService.getAvatarByName(avatarName) : null;
      if (existingAvatar) {
        const alreadyHere = existingAvatar.channelId === message.channel.id;
  // Ensure model is set for any upcoming AI generation
  await ensureModel(existingAvatar);
        // Ensure avatar has an image
        if (!existingAvatar.imageUrl || typeof existingAvatar.imageUrl !== 'string' || existingAvatar.imageUrl.trim() === '') {
          try {
            this.logger.info(`Avatar ${existingAvatar.name} (${existingAvatar._id}) missing imageUrl. Regenerating.`);
            // Pass metadata for proper event emission
            const uploadOptions = {
              source: 'avatar.summon',
              avatarName: existingAvatar.name,
              avatarEmoji: existingAvatar.emoji,
              avatarId: existingAvatar._id,
              prompt: existingAvatar.description,
              context: `${existingAvatar.emoji || '✨'} ${existingAvatar.name} appears — ${existingAvatar.description}`.trim()
            };
            existingAvatar.imageUrl = await this.avatarService.generateAvatarImage(existingAvatar.description, uploadOptions);
            
            // Save the regenerated image to the database immediately
            if (existingAvatar.imageUrl) {
              await this.avatarService.updateAvatar(existingAvatar);
              this.logger.info(`Avatar ${existingAvatar.name} imageUrl saved to database: ${existingAvatar.imageUrl}`);
            }
          } catch (e) {
            this.logger.warn(`Failed to regenerate image for ${existingAvatar.name}: ${e.message}`);
          }
        }
        if (!alreadyHere) {
          // Move avatar to this channel
            await this.mapService.updateAvatarPosition(existingAvatar, message.channel.id);
            existingAvatar.channelId = message.channel.id;
            await this.avatarService.updateAvatar(existingAvatar);
        }
        await this.discordService.reactToMessage(message, existingAvatar.emoji || '🔮');
        
        // Generate greeting from the avatar
        const ai = this.unifiedAIService || this.aiService;
        const corrId = `summon-greeting:${existingAvatar._id}:${Date.now()}`;
        let greeting = null;
        try {
          const greetingPrompt = alreadyHere 
            ? 'Someone summoned you again, but you\'re already here. Respond briefly (under 150 chars).'
            : 'You\'ve just been summoned to a new location. Greet those present briefly (under 150 chars).';
          
          const greetingResult = await ai.chat([
            { 
              role: 'system', 
              content: `You are ${existingAvatar.name}. ${existingAvatar.description}. Personality: ${existingAvatar.personality || existingAvatar.dynamicPersonality || 'Mysterious'}` 
            },
            { role: 'user', content: greetingPrompt }
          ], { model: existingAvatar.model, corrId });
          
          greeting = typeof greetingResult === 'object' && greetingResult?.text ? greetingResult.text : greetingResult;
          // Remove any <think> tags
          if (typeof greeting === 'string') greeting = greeting.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        } catch (e) {
          this.logger.warn(`Failed to generate greeting for ${existingAvatar.name}: ${e.message}`);
          greeting = alreadyHere ? `*${existingAvatar.name} nods in acknowledgment.*` : `*${existingAvatar.name} arrives.*`;
        }
        
        if (alreadyHere) {
          // Resummon in same channel: send greeting then show profile
          if (greeting) {
            await this.discordService.sendAsWebhook(message.channel.id, greeting, existingAvatar);
          }
          try {
            await this.discordService.sendAvatarEmbed(existingAvatar, message.channel.id, this.aiService);
          } catch (e) {
            this.logger.warn(`Failed to send avatar embed on resummon: ${e.message}`);
          }
          return `-# ${this.emoji} [ ${existingAvatar.name} is already here. Showing profile. ]`;
        } else {
          // Arrival: send greeting and mini embed
          setTimeout(async () => {
            if (greeting) {
              await this.discordService.sendAsWebhook(message.channel.id, greeting, existingAvatar);
            }
            await this.discordService.sendMiniAvatarEmbed(existingAvatar, message.channel.id, `${existingAvatar.name} arrives.`);
          }, 800);
          return `-# ${this.emoji} [ ${existingAvatar.name} moves to this location. ]`;
        }
        if (!avatar) {
          const friendlyName = formatModelDisplayName(normalized);
          if (friendlyName) {
            try {
              avatar = await this.avatarService.getAvatarByName(friendlyName, { guildId });
            } catch (err) {
              this.logger?.debug?.(`[SummonTool] direct friendly lookup failed: ${err?.message}`);
            }
          }
        }
        return avatar;
      };

      const findClosestModelAvatar = async (query, guildId) => {
        if (!query) return null;
        const normalized = normalizeModelIdentifier(query);
        if (normalized) {
          const direct = await findModelAvatarForModelId(normalized, guildId);
          if (direct) return direct;
        }

        const db = await this.avatarService._db();
        const baseFilters = {
          status: { $ne: 'dead' },
          isPartial: { $ne: true },
          tags: 'model-roster'
        };

        const fetchRosterAvatars = async (extraFilters = {}) => {
          const rosterQuery = buildAvatarQuery({ ...baseFilters, ...extraFilters });
          try {
            return await db.collection(this.avatarService.AVATARS_COLLECTION)
              .find(rosterQuery)
              .project({
                name: 1,
                model: 1,
                tags: 1,
                description: 1,
                guildId: 1,
                stats: 1,
                emoji: 1,
                imageUrl: 1,
                summoner: 1,
                createdAt: 1,
                summonsday: 1
              })
              .toArray();
          } catch (err) {
            this.logger?.debug?.(`[SummonTool] roster lookup failed: ${err?.message}`);
            return [];
          }
        };

        let rosterAvatars = [];
        if (guildId) {
          rosterAvatars = await fetchRosterAvatars({ guildId });
          if (!Array.isArray(rosterAvatars) || rosterAvatars.length === 0) {
            rosterAvatars = await fetchRosterAvatars({ guildId: 'global' });
          }
        }
        if (!Array.isArray(rosterAvatars) || rosterAvatars.length === 0) {
          rosterAvatars = await fetchRosterAvatars();
        }

        if (!Array.isArray(rosterAvatars) || rosterAvatars.length === 0) return null;

        const target = query.trim().toLowerCase();
        const targetTokens = target.split(/\s+/).filter(Boolean);
        let bestMatch = null;
        let bestScore = Infinity;

        const evaluate = (candidate, weight = 1) => {
          if (!candidate) return;
          const name = String(candidate.name || candidate.model || '').toLowerCase();
          if (!name) return;
          const containsTarget = target && name.includes(target);
          const containsToken = targetTokens.some(token => token.length >= 3 && name.includes(token));
          const startsWithToken = targetTokens.some(token => token.length >= 3 && name.startsWith(token));
          let distance = levenshteinDistance(name, target) * weight;
          if (containsTarget) distance *= 0.05;
          else if (startsWithToken) distance *= 0.1;
          else if (containsToken) distance *= 0.25;
          if (distance < bestScore) {
            bestScore = distance;
            bestMatch = candidate;
          }
        };

        for (const avatar of rosterAvatars) {
          evaluate(avatar, 1);
          if (avatar.model) {
            evaluate({ ...avatar, name: avatar.model }, 0.8);
            const display = formatModelDisplayName(avatar.model);
            if (display) evaluate({ ...avatar, name: display }, 0.7);
            const providerSlug = avatar.model.split('/', 2)[1] || '';
            if (providerSlug) evaluate({ ...avatar, name: providerSlug.replace(/[:_-]+/g, ' ') }, 0.9);
          }
        }

        if (!bestMatch) return null;
        if (bestMatch.isPartial) return null;

        try {
          if (bestMatch.model && this.openrouterModelCatalogService?.modelExists) {
            const ok = await this.openrouterModelCatalogService.modelExists(bestMatch.model, { refreshIfNeeded: false });
            if (!ok) return null;
          }
        } catch {}

        return bestMatch;
      };

      const pickRandomModelAvatar = async (guildId) => {
        const baseFilters = {
          status: { $ne: 'dead' },
          model: { $exists: true },
          isPartial: { $ne: true },
          tags: 'model-roster'
        };
        const trySample = async filters => {
          try {
            const avatars = await this.avatarService.getAllAvatars({ filters, limit: 10 });
            if (!Array.isArray(avatars) || !avatars.length) return null;

            // Prefer roster avatars whose model still exists in the OpenRouter catalog.
            for (const av of avatars) {
              if (!av?.model) continue;
              try {
                if (this.openrouterModelCatalogService?.modelExists) {
                  const ok = await this.openrouterModelCatalogService.modelExists(av.model, { refreshIfNeeded: false });
                  if (!ok) continue;
                }
              } catch {}
              return av;
            }

            return avatars[0] || null;
          } catch (err) {
            this.logger?.debug?.(`[SummonTool] random model avatar fetch failed: ${err?.message}`);
            return null;
          }
        };

        let avatar = null;
        if (guildId) {
          avatar = await trySample({ ...baseFilters, guildId });
        }
        if (!avatar) {
          avatar = await trySample(baseFilters);
        }
        return avatar;
      };

  const ensureModelRosterAvatar = async (modelId, { guildId: lookupGuildId } = {}) => {
        const normalized = normalizeModelIdentifier(modelId);
        if (!normalized) return null;

        // Hard block: never create roster avatars for models that aren't in OpenRouter.
        try {
          if (this.openrouterModelCatalogService?.assertModelExists) {
            await this.openrouterModelCatalogService.assertModelExists(normalized);
          }
        } catch {
          return null;
        }

        const existing = await findModelAvatarForModelId(normalized, lookupGuildId);
        if (existing) {
          await ensureAvatarStatsAndSummonsday(existing);
          return { avatar: existing, created: false };
        }

        const displayName = formatModelDisplayName(normalized) || normalized;
        const providerKey = normalized.split('/', 1)[0]?.toLowerCase?.() || '';
        const emoji = MODEL_PROVIDER_EMOJI[providerKey] || '💠';
        const description = await describeModelAppearance(normalized, displayName);
        const personality = '';
        const creationDate = new Date();
        const stats = this.statService.generateStatsFromDate(creationDate);
        const summonsday = formatSummonsday(creationDate);

        const baseDoc = {
          name: displayName,
          emoji,
          description,
          personality,
          model: normalized,
          channelId: null,
          guildId: lookupGuildId || 'global',
          summoner: 'system:model-roster',
          stats,
          summonsday,
          lives: 3,
          status: 'alive',
          createdAt: creationDate,
          updatedAt: creationDate,
          tags: ['model-roster']
        };

        let insertedAvatar = null;
        try {
          const db = await this.avatarService._db();
          const res = await db.collection(this.avatarService.AVATARS_COLLECTION).insertOne(baseDoc);
          insertedAvatar = { ...baseDoc, _id: res.insertedId };
          
          // Generate image asynchronously - don't block avatar creation
          (async () => {
            try {
              const uploadOptions = {
                source: 'avatar.model-roster',
                avatarId: insertedAvatar._id?.toString?.(),
                avatarName: insertedAvatar.name,
                avatarEmoji: insertedAvatar.emoji,
                prompt: insertedAvatar.description,
                context: `${insertedAvatar.emoji || '💠'} ${insertedAvatar.name} embodies its core form.`.trim()
              };
              const imageUrl = await this.avatarService.generateAvatarImage(insertedAvatar.description, uploadOptions);
              if (imageUrl) {
                insertedAvatar.imageUrl = imageUrl;
                await db.collection(this.avatarService.AVATARS_COLLECTION).updateOne(
                  { _id: insertedAvatar._id },
                  { $set: { imageUrl } }
                );
              }
            } catch (imgErr) {
              this.logger?.warn?.(`[SummonTool] Model roster image generation failed for ${displayName}: ${imgErr?.message}`);
            }
          })();
        } catch (err) {
          if (err?.code === 11000) {
            const dup = await findModelAvatarForModelId(normalized, lookupGuildId);
            if (dup) {
              await ensureAvatarStatsAndSummonsday(dup);
              return { avatar: dup, created: false };
            }
          }
          this.logger?.error?.(`[SummonTool] Failed to seed model roster avatar for ${normalized}: ${err?.message}`);
          return null;
        }

        await ensureAvatarStatsAndSummonsday(insertedAvatar);
        return { avatar: insertedAvatar, created: true };
      };
      
      // Handle params passed from AI tool calling (array of arguments)
      // If params has content, use it instead of message.content
      let paramContent = '';
      if (Array.isArray(params) && params.length > 0 && typeof params[0] === 'string' && params[0].trim()) {
        paramContent = params[0].trim();
      } else if (typeof params === 'object' && !Array.isArray(params) && (params.name || params.description)) {
        paramContent = (params.name || params.description || '').trim();
      }
      
      // Parse command content robustly: remove leading emoji + optional word 'summon'
      const raw = paramContent || (message.content || '').trim();
      const content = raw
        .replace(/^<a?:\w+?:\d+>\s*/,'') // custom discord emoji
        .replace(/^\p{Extended_Pictographic}+\s*/u,'') // unicode emoji(s)
        .replace(/^(summon)\s+/i,'')
        .trim();
      const slugCandidate = content.match(/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:.-]*/)?.[0] || null;
  let requestedModelId = normalizeModelIdentifier(slugCandidate);
      let avatarName = null;
      if (requestedModelId) {
        avatarName = slugCandidate.trim();
      } else {
        const [firstToken] = content.split(/\n|[,.;:]/).map(l => l.trim()).filter(Boolean);
        avatarName = firstToken || '';
      }
      const guildId = message.guildId || message.guild?.id;

      // If no textual description provided, but an image is attached, switch to image-based summoning
      const hasImageForSummon = !avatarName && message.hasImages && (message.imageDescription || message.primaryImageUrl);
      
      const guildConfig = await this.configService.getGuildConfig(guildId, true);
      const guildAvatarModes = guildConfig?.avatarModes || {};
      const { allowOnChain, allowCollection, allowFree, allowPureModel } = getAvatarModeFlags(guildAvatarModes);
      const _onChainDisabled = !allowOnChain;
      const collectionDisabled = !allowCollection;
      const freeSummonsDisabled = Boolean(guildId) && !allowFree;
      const allowModelSummons = allowPureModel;
      const pureModelOnly = isPureModelOnlyAvatarModes(guildAvatarModes);

      // Always check for existing avatar by name FIRST, before trying to resolve to a catalog model
      let existingAvatar = null;
      if (avatarName) {
        existingAvatar = await this.avatarService.getAvatarByName(avatarName, { guildId });
        
        // If avatar not found in DB and collection mode is enabled, try to sync from collections
        if (!existingAvatar && !collectionDisabled) {
          try {
            const { syncAvatarByNameFromCollections } = await import('../../../services/collections/collectionSyncService.mjs');
            const syncedAvatar = await syncAvatarByNameFromCollections(avatarName, guildId, {
              logger: this.logger,
              databaseService: this.databaseService,
              aiService: this.unifiedAIService || this.aiService,
              unifiedAIService: this.unifiedAIService,
            });
            if (syncedAvatar) {
              this.logger.info?.(`[SummonTool] Synced ${avatarName} from collection`);
              existingAvatar = syncedAvatar;
            }
          } catch (e) {
            this.logger.debug?.(`[SummonTool] Collection sync failed: ${e.message}`);
          }
        }
        
        // Note: We no longer discard existing avatars based on type restrictions.
        // If an avatar exists by name, we should find and use it regardless of its type.
        // Type restrictions (freeSummonsDisabled, pureModelOnly, etc.) only apply to CREATING new avatars.
      }

      // Only try to resolve to a catalog model if we didn't find an existing avatar
      if (!existingAvatar && !requestedModelId && avatarName) {
        if (this._shouldResolveCatalogModel({ requestedModelId, avatarName, freeSummonsDisabled, pureModelOnly, allowModelSummons })) {
          const catalogLookup = resolveCatalogModelId(avatarName);
          if (catalogLookup) {
            requestedModelId = catalogLookup;
          }
        }
      }

      if (existingAvatar) {
        const handled = await respondWithExistingAvatar(existingAvatar);
        if (handled) return handled;
      }

      if (requestedModelId) {
        try {
          if (this.openrouterModelCatalogService?.assertModelExists) {
            requestedModelId = await this.openrouterModelCatalogService.assertModelExists(requestedModelId);
          }
        } catch {
          await this.discordService.replyToMessage(
            message,
            `That model doesn't exist in the OpenRouter catalog: ${requestedModelId}`
          );
          requestedModelId = null;
        }

        if (requestedModelId) {
          const ensured = await ensureModelRosterAvatar(requestedModelId, { guildId });
          if (ensured?.avatar) {
            const preface = ensured.created
              ? `${ensured.avatar.name} manifests its core form, summoned straight from the model roster.`
              : null;
            const handled = await respondWithExistingAvatar(ensured.avatar, {
              preface,
              enforceModelName: true,
              requestedModelId
            });
            if (handled) return handled;
          }
        }
      }

      if (freeSummonsDisabled) {
        if (allowModelSummons) {
          let fallbackAvatar = avatarName ? await findClosestModelAvatar(avatarName, guildId) : null;
          if (fallbackAvatar) {
            const handled = await respondWithExistingAvatar(fallbackAvatar, {
              preface: `Summoning new avatars is disabled here, so I'm recalling ${fallbackAvatar.name} from the model roster.`,
              enforceModelName: Boolean(requestedModelId),
              requestedModelId
            });
            if (handled) return handled;
          }

          if (!fallbackAvatar) {
            const catalogModelId = resolveCatalogModelId(avatarName || requestedModelId || '');
            if (catalogModelId) {
              const ensured = await ensureModelRosterAvatar(catalogModelId, { guildId });
              fallbackAvatar = ensured?.avatar || null;
              if (fallbackAvatar) {
                const handled = await respondWithExistingAvatar(fallbackAvatar, {
                  preface: `Summoning new avatars is disabled here, so ${fallbackAvatar.name} answers from the model roster.`,
                  enforceModelName: true,
                  requestedModelId: fallbackAvatar.model
                });
                if (handled) return handled;
              }
            }
          }

          fallbackAvatar = await pickRandomModelAvatar(guildId);
          if (fallbackAvatar) {
            const handled = await respondWithExistingAvatar(fallbackAvatar, {
              preface: avatarName
                ? `Summoning is limited to catalog avatars. Couldn't find "${avatarName}", so ${fallbackAvatar.name} answers instead.`
                : `${fallbackAvatar.name} materialises from the model roster.`,
              enforceModelName: Boolean(requestedModelId),
              requestedModelId
            });
            if (handled) return handled;
          }

          await this.discordService.replyToMessage(
            message,
            'Summoning is limited to catalog avatars, but none were available to match that request.'
          );
          return { message: '-# [ Summon disabled: server configuration blocks free-form avatars. ]', notify: false };
        }

        await this.discordService.replyToMessage(
          message,
          'Summoning is disabled for this server. An admin can enable it in the Avatar Modes settings.'
        );
        return { message: '-# [ Summon disabled: server configuration blocks free-form avatars. ]', notify: false };
      }

      if (!freeSummonsDisabled && (pureModelOnly || !allowFree)) {
        let fallbackModel = avatarName ? await findClosestModelAvatar(avatarName, guildId) : null;
        if (!fallbackModel && avatarName) {
          const catalogModelId = resolveCatalogModelId(avatarName);
          if (catalogModelId) {
            const ensured = await ensureModelRosterAvatar(catalogModelId, { guildId });
            fallbackModel = ensured?.avatar || null;
          }
        }

        if (!fallbackModel) {
          fallbackModel = await pickRandomModelAvatar(guildId);
        }

        if (fallbackModel) {
          const handled = await respondWithExistingAvatar(fallbackModel, {
            preface: 'This server is limited to pure model avatars, so a roster avatar steps forward instead.',
            enforceModelName: true,
            requestedModelId: fallbackModel.model
          });
          if (handled) return handled;
        }
        await this.discordService.replyToMessage(
          message,
          'Summoning is restricted to curated model avatars here. Try referencing a specific model from the roster.'
        );
        return '-# [ Summon blocked: pure model roster only. ]';
      }

      if (!avatarName && !hasImageForSummon) {
        const randomAvatar = await pickRandomModelAvatar(guildId);
        if (randomAvatar) {
          const handled = await respondWithExistingAvatar(randomAvatar, {
            preface: `${randomAvatar.name} answers the call of the crystal.`
          });
          if (handled) return handled;
        }
        await this.discordService.replyToMessage(message, 'Provide a name, description, or image to guide the summon.');
        return '-# [ Summon aborted: no description or image provided. ]';
      }

      const breed = Boolean(params.breed);

      // Check summon limit (bypass for specific user ID, e.g., admin)
      const canSummon = message.author.id === '1175877613017895032' || (await this.checkDailySummonLimit(message.author.id));
      if (!canSummon) {
        // Friendly singular message (avoid spam)
        await this.discordService.replyToMessage(message, `You've already summoned an avatar today. (Daily limit: ${this.DAILY_SUMMON_LIMIT})`);
        return '-# [ Summon rejected: daily limit reached. ]';
      }

      // Get guild configuration
      const guildId = message.guildId || message.guild?.id;
      const guildConfig = await this.configService.getGuildConfig(guildId, true);
      let summonPrompt = guildConfig?.prompts?.summon || 'Create an avatar with the following description:';
  let _arweavePrompt = null;
      if (summonPrompt.match(/^(https:\/\/.*\.arweave\.net\/|ar:\/\/)/)) {
  _arweavePrompt = summonPrompt;
  summonPrompt = null;
      }
      // Generate stats for the avatar
      const creationDate = new Date();
      const stats = this.statService.generateStatsFromDate(creationDate);

      // Prepare avatar creation data
      const displayAuthor = message.author.displayName || message.author.username || 'Unknown Summoner';
      let prompt;
      let imageUrlOverride = null;
      if (hasImageForSummon) {
        const desc = message.imageDescription || 'Use the attached image as primary inspiration.';
        const imgUrl = message.primaryImageUrl || (Array.isArray(message.imageUrls) ? message.imageUrls[0] : null);
        imageUrlOverride = imgUrl || null;
        prompt = (summonPrompt ? `Avatar Stats: ${JSON.stringify(stats)} \n\n${summonPrompt}` : `Avatar Stats: ${JSON.stringify(stats)}`) +
          `\n\nDesign an avatar based on this image described as: "${desc}"${imgUrl ? ` (image: ${imgUrl})` : ''}.` +
          `\nThe summoner is ${displayAuthor}. Name the avatar appropriately and align personality to the image.`;
      } else {
        prompt = (summonPrompt ? `Avatar Stats: ${JSON.stringify(stats)} \n\n${summonPrompt}` : `Avatar Stats: ${JSON.stringify(stats)}`) +
          `\n\nDesign an avatar with the above stats based on this message from ${displayAuthor}:\n\n\t${content}`;
      }
      const avatarData = {
        prompt,
        channelId: message.channel.id,
        imageUrl: imageUrlOverride
      };

      // Create new avatar
      const createdAvatar = await this.avatarService.createAvatar(avatarData);
      const wasExisting = createdAvatar?._existing === true;
      if (!createdAvatar) {
        await this.discordService.replyToMessage(message, 'Failed to create avatar. Try a more detailed description.');
        return '-# [ Failed to create avatar. The description may be too vague. ]';
      }

      if (!wasExisting) {
        // Only set initial stats & timestamps for brand new avatars
        createdAvatar.stats = stats;
        createdAvatar.createdAt = creationDate;
        createdAvatar.channelId = message.channel.id;
        await this.avatarService.updateAvatar(createdAvatar);
        await ensureModel(createdAvatar);
      } else {
        // Ensure channel/location sync for existing avatar name collision
        if (createdAvatar.channelId !== message.channel.id) {
          await this.mapService.updateAvatarPosition(createdAvatar, message.channel.id);
          createdAvatar.channelId = message.channel.id;
          await this.avatarService.updateAvatar(createdAvatar);
        }
        await this.discordService.reactToMessage(message, createdAvatar.emoji || '🔮');
        // Provide a lightweight acknowledgement instead of full intro/embed
        try {
          await ensureModel(createdAvatar);
          const ai2 = this.unifiedAIService || this.aiService;
          const corrId = `resummon:${createdAvatar._id}:${Date.now()}`;
          const briefResult = await ai2.chat([
            { role: 'system', content: `You are ${createdAvatar.name}, ${createdAvatar.description}. Keep response under 120 characters.` },
            { role: 'user', content: 'Someone attempted to summon you again, but you already exist. Acknowledge succinctly.' }
          ], { model: createdAvatar.model, corrId });
          let brief = typeof briefResult === 'object' && briefResult?.text ? briefResult.text : briefResult;
          try { if (typeof brief === 'string') brief = brief.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); } catch {}
          await this.discordService.sendAsWebhook(message.channel.id, brief || `${createdAvatar.name} is already among you.`, createdAvatar);
        } catch (e) {
          this.logger.warn(`Re‑summon brief response failed: ${e.message}`);
        }
        return `-# ${this.emoji} [ Existing avatar ${createdAvatar.name} referenced; avoided duplicate introduction. ]`;
      }

      if (!createdAvatar || !createdAvatar.name) {
        await this.discordService.replyToMessage(message, 'Failed to create avatar. Try a more detailed description.');
        return '-# [ Failed to create avatar. The description may be too vague. ]';
      }

      // Generate introduction
  await ensureModel(createdAvatar);
      const introPrompt = guildConfig?.prompts?.introduction || 'You\'ve just arrived. Introduce yourself.';
  const ai3 = this.unifiedAIService || this.aiService;
  const introCorrId = `intro:${createdAvatar._id}:${Date.now()}`;
  let introResult = await ai3.chat(
        [
          {
            role: 'system',
            content: `You are ${createdAvatar.name}, described as: ${createdAvatar.description}. Your personality is: ${createdAvatar.personality}.`,
          },
          { role: 'user', content: introPrompt },
        ],
        { model: createdAvatar.model, corrId: introCorrId }
      );
  let intro = typeof introResult === 'object' && introResult?.text ? introResult.text : introResult;
      // Safety scrub in case provider leaked <think>
      try { if (typeof intro === 'string') intro = intro.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); } catch {}
      // Extract <think> tags from intro, store as thoughts & strip before sending
      try {
        const thinkRegex = /<think>(.*?)<\/think>/gs;
        const thoughts = [];
        const cleanedIntro = intro.replace(thinkRegex, (m, inner) => { thoughts.push(inner.trim()); return ''; }).trim();
        if (thoughts.length) {
          createdAvatar.thoughts = createdAvatar.thoughts || [];
            // Prepend new thoughts, keep only most recent 20
          thoughts.forEach(t => t && createdAvatar.thoughts.unshift({ content: t, timestamp: Date.now(), guildName: message.guild?.name || 'Unknown' }));
          createdAvatar.thoughts = createdAvatar.thoughts.slice(0, 20);
        }
        intro = cleanedIntro || '(The avatar arrives silently, deep in thought.)';
      } catch (e) {
        this.logger.warn(`Failed to process <think> tags in intro: ${e.message}`);
      }
      createdAvatar.dynamicPersonality = intro; // use cleaned intro as initial dynamic personality snapshot

      // Initialize avatar and react
      await this.avatarService.initializeAvatar(createdAvatar, message.channel.id);
      // Presence priority: mark start session & grant guaranteed early turns
      try {
        if (this.presenceService?.startSession) {
          await this.presenceService.startSession(message.channel.id, `${createdAvatar._id}`);
          await this.presenceService.grantNewSummonTurns(message.channel.id, `${createdAvatar._id}`, 3);
        }
      } catch (e) { this.logger?.warn?.(`Failed to grant new summon priority: ${e.message}`); }

      // Ensure avatar's position is updated in the mapService
      await this.mapService.updateAvatarPosition(createdAvatar, message.channel.id);

      // Track summon if not breeding
      if (!breed) await this.trackSummon(message.author.id);

      // Send final response
      setImmediate(async () => {
        // Send profile and introduction
        await this.discordService.sendAsWebhook(message.channel.id, createdAvatar.imageUrl, createdAvatar);
        await this.discordService.sendAsWebhook(message.channel.id, intro, createdAvatar);
        await this.discordService.sendAvatarEmbed(createdAvatar, message.channel.id, this.aiService);
        // Ensure avatar has correct channelId before response
        createdAvatar.channelId = message.channel.id;
        await this.discordService.reactToMessage(message, createdAvatar.emoji || '🔮');
       });
      return `-# ${this.emoji} [ ${createdAvatar.name} has been summoned into existence. ]`;
    } catch (error) {
      this.logger.error(`Summon error: ${error.message}`);
      this.logger.debug(`${error.stack}`);
      await this.discordService.reactToMessage(message, '❌');
      return `-# [ ❌ Error: Failed to summon: ${error.message} ]`;
    }
  }
}
