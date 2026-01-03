/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * CombatMessagingService
 * Handles all Discord messaging for combat encounters.
 * Posts actions, dialogue, embeds, and webhooks.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

/**
 * Combat message templates
 */
const MESSAGE_TEMPLATES = {
  turnAnnouncement: (name, emoji) => `-# ⚔️ [ ${emoji || ''}${name}'s turn! ]`,
  
  attackHit: (attacker, defender, damage, roll, ac, currentHp, maxHp) => 
    `-# ⚔️ [ ${attacker} attacks ${defender} (HIT: ${roll} vs AC ${ac}) for ${damage} damage! | HP: ${currentHp}/${maxHp} ]`,
  
  attackMiss: (attacker, defender, roll, ac) => 
    `-# 🛡️ [ ${attacker}'s attack misses ${defender}! (${roll} vs AC ${ac}) ]`,
  
  attackCritical: (attacker, defender, damage, currentHp, maxHp) => 
    `-# 💥 [ CRITICAL HIT! ${attacker} devastates ${defender} for ${damage} damage! | HP: ${currentHp}/${maxHp} ]`,
  
  defend: (name) => 
    `-# 🛡️ [ ${name} takes a defensive stance! AC +2 until next turn. ]`,
  
  knockout: (attacker, victim, lives) => 
    `-# 💫 [ ${attacker} knocked out ${victim}! ${lives} lives remaining! ]`,
  
  death: (attacker, victim) => 
    `-# 💀 [ ${attacker} has dealt the final blow! ${victim} has fallen permanently! ☠️ ]`,
  
  flee: {
    success: (name) => `-# 🏃 [ ${name} flees to the Tavern! ]`,
    fail: (name) => `-# 🏃 [ ${name} fails to escape! ]`
  },
  
  roundEnd: (round) => `-# 📋 [ Round ${round} complete ]`,
  
  combatEnd: {
    winner: (name) => `# 🏆 ${name} is victorious!`,
    draw: () => `# ⚔️ The battle ends in a draw!`,
    fled: (name) => `# 🏃 ${name} escaped! Combat ends.`,
    maxRounds: () => `# ⏱️ Combat ends - max rounds reached!`
  }
};

/**
 * Embed colors for different combat states
 */
const EMBED_COLORS = {
  initiative: 0x5865F2,  // Blurple
  attack: 0xFF4757,      // Red
  defend: 0x2ECC71,      // Green
  knockout: 0xE74C3C,    // Dark Red
  victory: 0xF1C40F,     // Gold
  flee: 0x95A5A6,        // Gray
  summary: 0x3498DB      // Blue
};

export class CombatMessagingService {
  /**
   * @param {Object} deps
   * @param {Object} deps.logger - Logging service
   * @param {Object} deps.discordService - Discord client service
   */
  constructor({ logger, discordService }) {
    this.logger = logger || console;
    this.discordService = discordService;
  }

  /**
   * Get Discord channel for an encounter
   * @param {Object} encounter - Combat encounter
   * @returns {Object|null} Discord channel
   */
  getChannel(encounter) {
    return this.discordService?.client?.channels?.cache?.get(encounter?.channelId) || null;
  }

  /**
   * Post content as a webhook (avatar speaking)
   * @param {Object} encounter - Combat encounter
   * @param {Object} avatar - The avatar speaking
   * @param {string} content - Message content
   */
  async postAsWebhook(encounter, avatar, content) {
    if (!content || !avatar) return;
    
    try {
      if (this.discordService?.sendAsWebhook) {
        const webhookData = {
          name: String(avatar.name || avatar.username || 'Unknown'),
          imageUrl: avatar.imageUrl || avatar.image || avatar.avatarUrl || '',
          emoji: avatar.emoji || ''
        };
        await this.discordService.sendAsWebhook(encounter.channelId, content, webhookData);
      }
    } catch (e) {
      this.logger.warn?.(`[CombatMessaging] Webhook post failed: ${e.message}`);
    }
  }

  /**
   * Announce whose turn it is
   * @param {Object} encounter - Combat encounter
   * @param {Object} combatant - Current turn combatant
   */
  async announceTurn(encounter, combatant) {
    const channel = this.getChannel(encounter);
    if (!channel) return;

    try {
      const emoji = combatant.ref?.emoji || '';
      await channel.send({
        content: MESSAGE_TEMPLATES.turnAnnouncement(combatant.name, emoji)
      });
    } catch (e) {
      this.logger.warn?.(`[CombatMessaging] Turn announcement failed: ${e.message}`);
    }
  }

  /**
   * Post combat action result
   * @param {Object} encounter - Combat encounter
   * @param {Object} combatant - Acting combatant
   * @param {Object} action - The action taken
   * @param {Object} result - Action result
   * @param {string} dialogue - Optional character dialogue
   */
  async postCombatAction(encounter, combatant, action, result, dialogue) {
    const channel = this.getChannel(encounter);
    if (!channel) return;

    try {
      let actionMessage = '';

      if (action.type === 'attack' && action.target) {
        const isHit = result?.result === 'hit' || result?.result === 'knockout' || result?.result === 'dead';
        const isCritical = result?.critical;
        
        // Get HP from result (enriched by combatEncounterService) or fallback to target combatant
        const currentHp = result?.currentHp ?? action.target.currentHp ?? '?';
        const maxHp = result?.maxHp ?? action.target.maxHp ?? '?';

        if (isCritical) {
          actionMessage = MESSAGE_TEMPLATES.attackCritical(
            combatant.name, 
            action.target.name, 
            result.damage,
            currentHp,
            maxHp
          );
        } else if (isHit) {
          actionMessage = MESSAGE_TEMPLATES.attackHit(
            combatant.name,
            action.target.name,
            result.damage || 0,
            result.attackRoll ?? '?',
            result.armorClass ?? '?',
            currentHp,
            maxHp
          );
        } else {
          actionMessage = MESSAGE_TEMPLATES.attackMiss(
            combatant.name,
            action.target.name,
            result.attackRoll ?? '?',
            result.armorClass ?? '?'
          );
        }
      } else if (action.type === 'defend') {
        actionMessage = MESSAGE_TEMPLATES.defend(combatant.name);
      }

      // Post action message
      if (actionMessage) {
        await channel.send({ content: actionMessage });
      }

      // Post dialogue as webhook
      if (dialogue) {
        await this.postAsWebhook(encounter, combatant.ref, dialogue);
      }
    } catch (e) {
      this.logger.warn?.(`[CombatMessaging] Post action failed: ${e.message}`);
    }
  }

  /**
   * Post knockout notification
   * @param {Object} encounter - Combat encounter
   * @param {Object} attacker - Attacking combatant
   * @param {Object} victim - Knocked out combatant
   * @param {Object} result - Knockout result
   */
  async postKnockout(encounter, attacker, victim, result) {
    const channel = this.getChannel(encounter);
    if (!channel) return;

    try {
      const message = result.result === 'dead'
        ? MESSAGE_TEMPLATES.death(attacker.name, victim.name)
        : MESSAGE_TEMPLATES.knockout(attacker.name, victim.name, victim.ref?.lives || 0);

      await channel.send({ content: message });
    } catch (e) {
      this.logger.warn?.(`[CombatMessaging] Knockout post failed: ${e.message}`);
    }
  }

  /**
   * Post initiative order embed
   * @param {Object} encounter - Combat encounter
   */
  async postInitiativeOrder(encounter) {
    const channel = this.getChannel(encounter);
    if (!channel) return;

    try {
      const orderList = encounter.combatants
        .sort((a, b) => (b.initiative || 0) - (a.initiative || 0))
        .map((c, i) => {
          const emoji = c.ref?.emoji || '⚔️';
          return `${i + 1}. ${emoji} **${c.name}** (Initiative: ${c.initiative || 0})`;
        })
        .join('\n');

      const embed = new EmbedBuilder()
        .setTitle('⚔️ Combat Begins!')
        .setDescription(`**Initiative Order:**\n${orderList}`)
        .setColor(EMBED_COLORS.initiative)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (e) {
      this.logger.warn?.(`[CombatMessaging] Initiative post failed: ${e.message}`);
    }
  }

  /**
   * Post combat summary with optional video button
   * @param {Object} encounter - Combat encounter
   * @param {Object} options - Summary options
   */
  async postCombatSummary(encounter, options = {}) {
    const channel = this.getChannel(encounter);
    if (!channel) return;

    try {
      // Determine winner
      const alive = (encounter.combatants || []).filter(c => (c.currentHp || 0) > 0);
      const winner = alive.length === 1 ? alive[0] : null;

      let title, description;
      
      switch (encounter.endReason) {
        case 'single_combatant':
          title = MESSAGE_TEMPLATES.combatEnd.winner(winner?.name || 'Unknown');
          description = `${winner?.name} stands victorious after ${encounter.round} rounds!`;
          break;
        case 'flee':
          title = MESSAGE_TEMPLATES.combatEnd.fled(encounter.fleerId || 'Someone');
          description = 'The battle ends as a combatant escapes.';
          break;
        case 'max_rounds':
          title = MESSAGE_TEMPLATES.combatEnd.maxRounds();
          description = `Combat ends after ${encounter.round} rounds without a clear victor.`;
          break;
        default:
          title = MESSAGE_TEMPLATES.combatEnd.draw();
          description = 'The battle ends without a decisive outcome.';
      }

      // Build summary embed
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(winner ? EMBED_COLORS.victory : EMBED_COLORS.summary)
        .addFields(
          ...encounter.combatants.map(c => ({
            name: `${c.ref?.emoji || '⚔️'} ${c.name}`,
            value: `HP: ${c.currentHp}/${c.maxHp}${c.conditions?.includes('unconscious') ? ' (KO)' : ''}`,
            inline: true
          }))
        )
        .setFooter({ text: `${encounter.round} round(s) • ${encounter.endReason}` })
        .setTimestamp();

      // Add video generation button if enabled
      const components = [];
      if (options.enableVideoButton && encounter.battleRecap?.rounds?.length > 0) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`generate_battle_video_${encounter.channelId}`)
            .setLabel('🎬 Generate Battle Recap')
            .setStyle(ButtonStyle.Primary)
        );
        components.push(row);
      }

      await channel.send({ 
        embeds: [embed], 
        components: components.length > 0 ? components : undefined 
      });
    } catch (e) {
      this.logger.warn?.(`[CombatMessaging] Summary post failed: ${e.message}`);
    }
  }

  /**
   * Post flee result
   * @param {Object} encounter - Combat encounter
   * @param {Object} combatant - Fleeing combatant
   * @param {boolean} success - Whether flee succeeded
   */
  async postFleeResult(encounter, combatant, success) {
    const channel = this.getChannel(encounter);
    if (!channel) return;

    try {
      const message = success
        ? MESSAGE_TEMPLATES.flee.success(combatant.name)
        : MESSAGE_TEMPLATES.flee.fail(combatant.name);

      await channel.send({ content: message });
    } catch (e) {
      this.logger.warn?.(`[CombatMessaging] Flee post failed: ${e.message}`);
    }
  }

  /**
   * Post round end notification
   * @param {Object} encounter - Combat encounter
   */
  async postRoundEnd(encounter) {
    const channel = this.getChannel(encounter);
    if (!channel) return;

    try {
      await channel.send({ 
        content: MESSAGE_TEMPLATES.roundEnd(encounter.round) 
      });
    } catch (e) {
      this.logger.warn?.(`[CombatMessaging] Round end post failed: ${e.message}`);
    }
  }

  /**
   * Post fight poster/image at combat start
   * @param {Object} encounter - Combat encounter
   * @param {string} imageUrl - Fight poster URL
   * @param {Object} options - Additional options
   */
  async postFightPoster(encounter, imageUrl, options = {}) {
    const channel = this.getChannel(encounter);
    if (!channel) return;

    try {
      const combatantNames = encounter.combatants.map(c => c.name).join(' vs ');
      
      const embed = new EmbedBuilder()
        .setTitle(`⚔️ ${combatantNames}`)
        .setDescription(options.location ? `Location: ${options.location}` : undefined)
        .setImage(imageUrl)
        .setColor(EMBED_COLORS.attack)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (e) {
      this.logger.warn?.(`[CombatMessaging] Fight poster post failed: ${e.message}`);
    }
  }

  /**
   * Post HP status for all combatants
   * @param {Object} encounter - Combat encounter
   */
  async postHPStatus(encounter) {
    const channel = this.getChannel(encounter);
    if (!channel) return;

    try {
      const statusLines = encounter.combatants.map(c => {
        const emoji = c.ref?.emoji || '⚔️';
        const hpBar = this._generateHPBar(c.currentHp, c.maxHp);
        return `${emoji} ${c.name}: ${hpBar} (${c.currentHp}/${c.maxHp})`;
      }).join('\n');

      await channel.send({ content: `-# ${statusLines}` });
    } catch (e) {
      this.logger.warn?.(`[CombatMessaging] HP status post failed: ${e.message}`);
    }
  }

  /**
   * React to a message
   * @param {Object} message - Discord message
   * @param {string} emoji - Emoji to react with
   */
  async reactToMessage(message, emoji) {
    try {
      if (this.discordService?.reactToMessage) {
        await this.discordService.reactToMessage(message, emoji);
      } else if (message?.react) {
        await message.react(emoji);
      }
    } catch (e) {
      this.logger.debug?.(`[CombatMessaging] Reaction failed: ${e.message}`);
    }
  }

  // ============ Private Methods ============

  /**
   * Generate ASCII HP bar
   * @private
   */
  _generateHPBar(current, max, length = 10) {
    const percent = Math.max(0, Math.min(1, current / max));
    const filled = Math.round(percent * length);
    const empty = length - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }
}

export default CombatMessagingService;
