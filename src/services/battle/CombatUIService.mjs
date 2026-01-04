/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import eventBus from '../../utils/eventBus.mjs';

/**
 * CombatUIService
 * 
 * Centralized service for all combat-related Discord UI updates.
 * Ensures embeds always reflect authoritative combat state.
 * 
 * Key responsibilities:
 * - Build and update combat status embeds
 * - Generate action buttons based on turn state
 * - Handle embed message tracking and updates
 * - Listen to combat events for automatic UI sync
 */
export class CombatUIService {
  constructor({ combatEncounterService, discordService, logger }) {
    this.combatEncounterService = combatEncounterService;
    this.discordService = discordService;
    this.logger = logger || console;
    
    // Track active combat embeds: channelId -> { messageId, lastUpdated }
    this.activeEmbeds = new Map();
    
    // Subscribe to combat events
    this._setupEventListeners();
  }

  /**
   * Setup event listeners for automatic UI updates
   * @private
   */
  _setupEventListeners() {
    eventBus.on('combat.turn.started', async ({ channelId }) => {
      try {
        await this.updateCombatEmbed(channelId);
      } catch (e) {
        this.logger?.error?.(`[CombatUI] Failed to update embed on turn start: ${e.message}`);
      }
    });

    eventBus.on('combat.action.completed', async ({ channelId }) => {
      try {
        await this.updateCombatEmbed(channelId);
      } catch (e) {
        this.logger?.error?.(`[CombatUI] Failed to update embed on action: ${e.message}`);
      }
    });

    eventBus.on('combat.hp.changed', async ({ channelId }) => {
      try {
        await this.updateCombatEmbed(channelId);
      } catch (e) {
        this.logger?.error?.(`[CombatUI] Failed to update embed on HP change: ${e.message}`);
      }
    });

    eventBus.on('combat.ended', async ({ channelId }) => {
      try {
        await this.clearCombatEmbed(channelId);
      } catch (e) {
        this.logger?.error?.(`[CombatUI] Failed to clear embed on combat end: ${e.message}`);
      }
    });

    eventBus.on('combat.round.advanced', async ({ channelId }) => {
      try {
        await this.updateCombatEmbed(channelId);
      } catch (e) {
        this.logger?.error?.(`[CombatUI] Failed to update embed on round advance: ${e.message}`);
      }
    });
  }

  /**
   * Post or update the combat status embed
   * ALWAYS reads fresh state from combatEncounterService
   * 
   * @param {string} channelId - Discord channel ID
   * @param {Object} options - Options
   * @param {boolean} options.forceNew - Force posting a new embed
   */
  async updateCombatEmbed(channelId, options = {}) {
    const { forceNew = false } = options;
    
    const encounter = this.combatEncounterService?.getEncounterByChannelId?.(channelId);
    if (!encounter) {
      this.logger?.debug?.(`[CombatUI] No active encounter for channel ${channelId}`);
      this.activeEmbeds.delete(channelId);
      return null;
    }

    const embed = this._buildCombatEmbed(encounter);
    const components = this._buildCombatButtons(encounter);

    const existing = this.activeEmbeds.get(channelId);
    
    if (!forceNew && existing?.messageId) {
      // Try to update existing embed
      try {
        const channel = await this._getChannel(channelId);
        if (channel) {
          const message = await channel.messages.fetch(existing.messageId).catch(() => null);
          if (message) {
            await message.edit({ embeds: [embed], components });
            existing.lastUpdated = Date.now();
            this.logger?.debug?.(`[CombatUI] Updated existing embed ${existing.messageId}`);
            return message;
          }
        }
      } catch (e) {
        this.logger?.debug?.(`[CombatUI] Failed to update existing embed: ${e.message}`);
      }
    }
    
    // Post new embed
    return await this._postNewEmbed(channelId, embed, components);
  }

  /**
   * Post a new combat embed and track it
   * @private
   */
  async _postNewEmbed(channelId, embed, components) {
    try {
      const channel = await this._getChannel(channelId);
      if (!channel) {
        this.logger?.warn?.(`[CombatUI] Could not find channel ${channelId}`);
        return null;
      }

      const message = await channel.send({ embeds: [embed], components });
      
      this.activeEmbeds.set(channelId, {
        messageId: message.id,
        lastUpdated: Date.now()
      });
      
      this.logger?.info?.(`[CombatUI] Posted new combat embed ${message.id} in ${channelId}`);
      return message;
    } catch (e) {
      this.logger?.error?.(`[CombatUI] Failed to post embed: ${e.message}`);
      return null;
    }
  }

  /**
   * Clear combat embed when combat ends
   * @param {string} channelId 
   */
  async clearCombatEmbed(channelId) {
    const existing = this.activeEmbeds.get(channelId);
    if (!existing?.messageId) return;

    try {
      const channel = await this._getChannel(channelId);
      if (channel) {
        const message = await channel.messages.fetch(existing.messageId).catch(() => null);
        if (message) {
          // Update with "combat ended" state instead of deleting
          const endEmbed = new EmbedBuilder()
            .setTitle('⚔️ Combat Ended')
            .setDescription('The battle has concluded.')
            .setColor(0x6B7280)
            .setTimestamp();
          
          await message.edit({ embeds: [endEmbed], components: [] });
        }
      }
    } catch (e) {
      this.logger?.debug?.(`[CombatUI] Failed to clear embed: ${e.message}`);
    }
    
    this.activeEmbeds.delete(channelId);
  }

  /**
   * Build the combat status embed
   * @private
   */
  _buildCombatEmbed(encounter) {
    const currentAvatarId = this.combatEncounterService?.getCurrentTurnAvatarId?.(encounter);
    
    const combatantLines = (encounter.combatants || []).map(c => {
      const normalizedCurrent = this._normalizeId(currentAvatarId);
      const normalizedCombatant = this._normalizeId(c.avatarId || c.id);
      const isCurrent = normalizedCurrent === normalizedCombatant;
      
      const indicator = isCurrent ? '➡️' : '   ';
      const emoji = c.isMonster ? '👹' : (c.isPlayerControlled ? '🧙' : '⚔️');
      
      let hpDisplay;
      if (c.currentHp <= 0) {
        hpDisplay = '💀 DEAD';
      } else {
        const hpPercent = Math.round((c.currentHp / c.maxHp) * 100);
        const hpBar = this._buildHpBar(hpPercent);
        hpDisplay = `${hpBar} ${c.currentHp}/${c.maxHp}`;
      }
      
      const statusIcons = [];
      if (c.isDefending) statusIcons.push('🛡️');
      if (c.statusEffects?.length) {
        for (const effect of c.statusEffects.slice(0, 3)) {
          statusIcons.push(this._getStatusIcon(effect));
        }
      }
      const statusStr = statusIcons.length ? ` ${statusIcons.join('')}` : '';
      
      return `${indicator} ${emoji} **${c.name}**: ${hpDisplay}${statusStr}`;
    }).join('\n');

    const currentTurnName = this._getCurrentTurnName(encounter);
    const turnInfo = currentTurnName ? `\n\n**Current Turn:** ${currentTurnName}` : '';

    return new EmbedBuilder()
      .setTitle(`⚔️ Combat - Round ${encounter.round || 1}`)
      .setDescription((combatantLines || 'No combatants') + turnInfo)
      .setColor(this._getCombatColor(encounter))
      .setFooter({ 
        text: `Turn ${(encounter.currentTurnIndex || 0) + 1}/${encounter.initiativeOrder?.length || 1}` 
      })
      .setTimestamp();
  }

  /**
   * Build combat action buttons
   * @private
   */
  _buildCombatButtons(encounter) {
    if (encounter.state === 'ended' || encounter.state === 'completed') {
      return [];
    }

    const currentCombatant = encounter.combatants?.[encounter.currentTurnIndex];
    if (!currentCombatant) return [];

    // Only show interactive buttons for player-controlled combatants
    if (!currentCombatant.isPlayerControlled) {
      return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('combat_waiting')
          .setLabel(`${currentCombatant.name}'s Turn...`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      )];
    }

    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('combat_take_turn')
          .setLabel('⚔️ Take Your Turn')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('combat_defend')
          .setLabel('🛡️ Defend')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('combat_flee')
          .setLabel('🏃 Flee')
          .setStyle(ButtonStyle.Danger)
      )
    ];
  }

  /**
   * Build HP bar visualization
   * @private
   */
  _buildHpBar(percent) {
    const filled = Math.round(percent / 10);
    const empty = 10 - filled;
    
    let color = '🟩'; // Green
    if (percent <= 25) color = '🟥'; // Red
    else if (percent <= 50) color = '🟨'; // Yellow
    
    return color.repeat(filled) + '⬛'.repeat(empty);
  }

  /**
   * Get status effect icon
   * @private
   */
  _getStatusIcon(effect) {
    const icons = {
      'poison': '🤢',
      'burn': '🔥',
      'freeze': '🧊',
      'stun': '💫',
      'blind': '🙈',
      'buff': '⬆️',
      'debuff': '⬇️',
      'regen': '💚',
      'shield': '🛡️'
    };
    return icons[effect?.type?.toLowerCase?.()] || '✨';
  }

  /**
   * Get embed color based on combat state
   * @private
   */
  _getCombatColor(encounter) {
    if (encounter.state === 'ended') return 0x6B7280; // Gray
    
    const currentCombatant = encounter.combatants?.[encounter.currentTurnIndex];
    if (currentCombatant?.isPlayerControlled) return 0x3B82F6; // Blue - player turn
    if (currentCombatant?.isMonster) return 0xEF4444; // Red - enemy turn
    
    return 0xF59E0B; // Orange - NPC turn
  }

  /**
   * Get current turn combatant name
   * @private
   */
  _getCurrentTurnName(encounter) {
    const combatant = encounter.combatants?.[encounter.currentTurnIndex];
    return combatant?.name || null;
  }

  /**
   * Normalize ID for comparison
   * @private
   */
  _normalizeId(id) {
    if (!id) return null;
    return String(id).toLowerCase().trim();
  }

  /**
   * Get Discord channel by ID
   * @private
   */
  async _getChannel(channelId) {
    try {
      return this.discordService?.client?.channels?.cache?.get(channelId) ||
             await this.discordService?.client?.channels?.fetch(channelId).catch(() => null);
    } catch {
      return null;
    }
  }

  /**
   * Send an ephemeral action menu to a player
   * @param {Object} interaction - Discord interaction
   * @param {Object} encounter - Combat encounter
   * @param {Object} combatant - The combatant taking action
   */
  async sendActionMenu(interaction, encounter, combatant) {
    const validTargets = (encounter.combatants || []).filter(c => 
      c.currentHp > 0 && 
      this._normalizeId(c.avatarId) !== this._normalizeId(combatant.avatarId)
    );

    const embed = new EmbedBuilder()
      .setTitle(`${combatant.name}'s Turn`)
      .setDescription(`Choose your action:\n\n**Valid Targets:**\n${validTargets.map(t => `• ${t.name} (${t.currentHp}/${t.maxHp} HP)`).join('\n') || 'No targets available'}`)
      .setColor(0x3B82F6)
      .setFooter({ text: 'Type /attack <target> or use buttons below' });

    // Build target buttons (max 5 per row, max 25 total)
    const rows = [];
    let currentRow = new ActionRowBuilder();
    let buttonCount = 0;

    for (const target of validTargets.slice(0, 20)) {
      if (buttonCount > 0 && buttonCount % 5 === 0) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder();
      }

      currentRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`attack_target_${this._normalizeId(target.avatarId || target.id)}`)
          .setLabel(`⚔️ ${target.name}`)
          .setStyle(target.isMonster ? ButtonStyle.Danger : ButtonStyle.Secondary)
      );
      buttonCount++;
    }

    if (buttonCount > 0) {
      rows.push(currentRow);
    }

    // Add utility buttons
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('combat_defend_confirm')
        .setLabel('🛡️ Defend')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('combat_use_item')
        .setLabel('🎒 Use Item')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('combat_cancel')
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Secondary)
    ));

    try {
      await interaction.reply({
        embeds: [embed],
        components: rows.slice(0, 5), // Discord limit
        ephemeral: true
      });
    } catch (e) {
      this.logger?.error?.(`[CombatUI] Failed to send action menu: ${e.message}`);
    }
  }

  /**
   * Force refresh embed from current state
   * @param {string} channelId 
   */
  async forceRefresh(channelId) {
    return await this.updateCombatEmbed(channelId, { forceNew: true });
  }

  /**
   * Get tracked embed info for a channel
   * @param {string} channelId 
   */
  getEmbedInfo(channelId) {
    return this.activeEmbeds.get(channelId) || null;
  }

  /**
   * Health check
   */
  async ping() {
    return { 
      ok: true, 
      service: 'CombatUIService',
      activeEmbeds: this.activeEmbeds.size
    };
  }
}
