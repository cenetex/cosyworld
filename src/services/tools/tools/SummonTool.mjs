/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { BasicTool } from '../BasicTool.mjs';

export class SummonTool extends BasicTool {
  constructor({
    discordService,
    mapService,
    avatarService,
    configService,
    databaseService,
    aiService,
    doginalCollectionService,
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
    this.doginalCollectionService = doginalCollectionService;
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
            existingAvatar.imageUrl = await this.avatarService.generateAvatarImage(existingAvatar.description);
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
        if (alreadyHere) {
          // Resummon in same channel: show the avatar's full embed for the user
          try {
            await this.discordService.sendAvatarEmbed(existingAvatar, message.channel.id, this.aiService);
          } catch (e) {
            this.logger.warn(`Failed to send avatar embed on resummon: ${e.message}`);
          }
          return `-# ${this.emoji} [ ${existingAvatar.name} is already here. Showing profile. ]`;
        } else {
          // Arrival mini embed
          setTimeout(async () => {
            await this.discordService.sendMiniAvatarEmbed(existingAvatar, message.channel.id, `${existingAvatar.name} arrives.`);
          }, 800);
          return `-# ${this.emoji} [ ${existingAvatar.name} moves to this location. ]`;
        }
      }

      const breed = Boolean(params.breed);

      const doginalHandled = await this.tryDoginalSummon({ message, content, breed });
      if (doginalHandled) return doginalHandled;

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

  async tryDoginalSummon({ message, content, breed }) {
    if (!this.doginalCollectionService) return null;
    const trimmed = (content || '').trim();
    if (!trimmed) return null;
    if (!/doginal|doge/i.test(trimmed)) return null;

    try {
      const tokens = trimmed.split(/\s+/).filter(Boolean);
      if (!tokens.length) return null;

      let collection = null;
      let remainderTokens = [];
      for (let i = tokens.length; i > 0; i--) {
        const candidate = tokens.slice(0, i).join(' ');
        collection = await this.doginalCollectionService.getCollection(candidate);
        if (collection) {
          remainderTokens = tokens.slice(i);
          break;
        }
      }

      if (!collection) return null;

      const remainder = remainderTokens.join(' ').trim();
      let inscriptionNumber = null;
      let inscriptionId = null;
      if (remainder) {
        const numberMatch = remainder.match(/#?\s*(\d{1,7})/);
        if (numberMatch) {
          inscriptionNumber = parseInt(numberMatch[1], 10);
        } else {
          const idMatch = remainder.match(/([a-z0-9_-]{8,})/i);
          if (idMatch) inscriptionId = idMatch[1];
        }
      }

      const { token } = await this.doginalCollectionService.summonToken({
        collection: collection.slug,
        inscriptionNumber,
        inscriptionId,
      });

      const title = token.name || `${collection.name} #${token.inscriptionNumber ?? token.inscriptionId ?? ''}`.trim();
      const imageUrl = this.resolveDoginalImageUrl(token);
      const embed = new EmbedBuilder()
        .setColor('#F7931A')
        .setTitle(title)
        .setDescription(this.formatDoginalTraits(token.traits) || 'A legendary Doginal companion, freshly summoned!')
        .setFooter({ text: `${collection.name} • Dogecoin Inscription`, iconURL: imageUrl || undefined });

      if (imageUrl) {
        embed.setThumbnail(imageUrl);
        embed.setImage(imageUrl);
      }
      if (token.inscriptionNumber != null) {
        embed.addFields({ name: 'Inscription #', value: `#${token.inscriptionNumber}`, inline: true });
      }
      if (token.inscriptionId) {
        embed.addFields({ name: 'Inscription ID', value: token.inscriptionId, inline: true });
      }
      if (Number.isFinite(token.rarity)) {
        embed.addFields({ name: 'Rarity Score', value: token.rarity.toFixed(2), inline: true });
      }
      if (token.lastKnownOwner) {
        embed.addFields({ name: 'Last Known Owner', value: token.lastKnownOwner, inline: false });
      }

      const components = this.buildDoginalLinkComponents(collection, token);

      await this.discordService.sendEmbedAsWebhook(
        message.channel.id,
        embed,
        title,
        imageUrl || undefined,
        components
      );
      await this.discordService.reactToMessage(message, token.emoji || '🐕');

      return `-# ${this.emoji} [ ${title} bounds in from the Doginal Kennel. ]`;
    } catch (error) {
      const status = error?.status || error?.response?.status;
      const msg = status === 404
        ? 'Could not find that Doginal inscription. Try another number?'
        : 'Failed to summon a Doginal companion just now. The kennel door is stuck.';
      this.logger?.warn?.(`[DoginalSummon] failed: ${error?.message || error}`);
      await this.discordService.replyToMessage(message, msg);
      return `-# [ ❌ Doginal summon failed${status === 404 ? ': not found' : ''}. ]`;
    }
  }

  formatDoginalTraits(traits) {
    if (!traits) return '';
    try {
      if (Array.isArray(traits)) {
        return traits.map(t => {
          if (!t) return '';
          if (typeof t === 'string') return t;
          const key = t.trait_type || t.type || t.name || 'Trait';
          const val = t.value || t.trait || t.val || '';
          return `${key}: ${val}`;
        }).filter(Boolean).join('\n');
      }
      if (typeof traits === 'object') {
        return Object.entries(traits).map(([k, v]) => `${k}: ${v}`).join('\n');
      }
      if (typeof traits === 'string') return traits;
    } catch (err) {
      this.logger?.warn?.(`[DoginalSummon] trait formatting failed: ${err.message}`);
    }
    return '';
  }

  buildDoginalLinkComponents(collection, token) {
    const dogeLabsUrl = this.resolveDoginalDogeLabsUrl(collection, token);
    if (!dogeLabsUrl) return [];

    const button = new ButtonBuilder()
      .setLabel('View on Doge Labs')
      .setStyle(ButtonStyle.Link)
      .setURL(dogeLabsUrl);

    return [new ActionRowBuilder().addComponents(button)];
  }

  resolveDoginalDogeLabsUrl(collection, token) {
    const directUrl = this.extractDogeLabsUrl([
      token?.detailsUrl,
      token?.metadata?.detailsUrl,
      token?.links,
      token?.metadata?.links,
      collection?.links,
      collection?.metadata?.links,
    ]);
    if (directUrl) return directUrl;

    const slug = this.normalizeSlug(collection?.slug);
    if (!slug) return null;

    const candidateIds = [
      token?.dogeLabsId,
      token?.metadata?.dogeLabsId,
      token?.metadata?.ordinalId,
      token?.metadata?.inscriptionId,
      token?.metadata?.inscription?.id,
      token?.metadata?.ordinal?.id,
      token?.metadata?.id,
      token?.ordinalId,
      token?.inscriptionOrdinalId,
      token?.metadata?.ordinalsId,
    ];

    for (const raw of candidateIds) {
      const id = this.normalizeOrdinalId(raw);
      if (id) {
        return `https://doge-labs.com/collectible/${slug}/${id}`;
      }
    }

    return null;
  }

  extractDogeLabsUrl(values) {
    const list = Array.isArray(values) ? values : [values];
    for (const value of list) {
      if (!value) continue;
      if (typeof value === 'string') {
        if (this.isDogeLabsUrl(value)) return value.trim();
      } else if (Array.isArray(value)) {
        const nested = this.extractDogeLabsUrl(value);
        if (nested) return nested;
      } else if (typeof value === 'object') {
        const url = value.url || value.href || value.link || null;
        if (this.isDogeLabsUrl(url)) return url.trim();
      }
    }
    return null;
  }

  isDogeLabsUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    try {
      const parsed = new URL(trimmed);
      if (!/^(?:www\.)?doge-labs\.com$/i.test(parsed.hostname)) return false;
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length < 3) return false;
      if (parts[0].toLowerCase() !== 'collectible') return false;
      const candidateId = parts[2];
      return /^[0-9a-f]{64}i\d+$/i.test(candidateId);
    } catch {
      return false;
    }
  }

  normalizeSlug(slug) {
    if (!slug || typeof slug !== 'string') return null;
    return slug.trim().toLowerCase();
  }

  normalizeOrdinalId(value) {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (/^[0-9a-f]{64}i\d+$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    return null;
  }

  resolveDoginalImageUrl(token) {
    const candidates = [];

    const pushCandidate = (value) => {
      if (!value) return;
      if (typeof value === 'string') {
        candidates.push(value.trim());
        return;
      }
      if (typeof value === 'object') {
        const maybe = [
          value.cdnUrl,
          value.sourceUrl,
          value.url,
          value.uri,
          value.href,
          value.src,
          value.original,
        ];
        for (const entry of maybe) {
          if (typeof entry === 'string') candidates.push(entry.trim());
        }
      }
    };

    pushCandidate(token?.image);
    pushCandidate(token?.image?.fallback);
    pushCandidate(token?.cdnUrl);
    pushCandidate(token?.metadata?.cdnUrl);
    pushCandidate(token?.metadata?.image);
    pushCandidate(token?.metadata?.image_url);
    pushCandidate(token?.metadata?.imageUrl);
    pushCandidate(token?.metadata?.media);
    pushCandidate(token?.metadata?.media?.image);
    pushCandidate(token?.metadata?.media?.url);
    pushCandidate(token?.metadata?.media?.uri);
    pushCandidate(token?.metadata?.content?.file);
    pushCandidate(token?.metadata?.content?.url);
    pushCandidate(token?.metadata?.content?.uri);

    for (const candidate of candidates) {
      if (!candidate) continue;
      const normalized = this.normalizeImageUrl(candidate);
      if (normalized) return normalized;
    }

    return null;
  }

  normalizeImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;

    if (/^ipfs:\/\//i.test(trimmed)) {
      return trimmed.replace(/^ipfs:\/\//i, 'https://ipfs.io/ipfs/');
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    return null;
  }
}
