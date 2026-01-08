/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * CastTool - D&D spellcasting
 */

import { BasicTool } from '../BasicTool.mjs';
import { SPELLS } from '../../../data/dnd/spells.mjs';
import { 
  addComponentsToResponse, 
  addEmbedTextSummary,
  createActionMenu
} from '../dndButtonComponents.mjs';

export class CastTool extends BasicTool {
  constructor({ logger, spellService, characterService, avatarService, discordService, questService, tutorialQuestService }) {
    super();
    this.logger = logger || console;
    this.spellService = spellService;
    this.characterService = characterService;
    this.avatarService = avatarService;
    this.discordService = discordService;
    this.questService = questService;
    this.tutorialQuestService = tutorialQuestService;

    this.name = 'cast';
    this.parameters = '<spell> [target] [slot]';
    this.description = 'Cast a spell on a target';
    this.emoji = '🪄';
    this.isDndTool = true;
    this.replyNotification = true;
    this.cooldownMs = 3000;
  }

  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        spell: {
          type: 'string',
          description: 'Spell ID to cast (e.g., fire_bolt, magic_missile)'
        },
        target: {
          type: 'string',
          description: 'Target name'
        },
        slot: {
          type: 'number',
          description: 'Spell slot level (for non-cantrips)'
        }
      },
      required: ['spell']
    };
  }

  _errorEmbed(message) {
    return {
      embeds: [{
        title: '🪄 Spell Error',
        description: message,
        color: 0xEF4444 // Red
      }]
    };
  }

  async execute(message, params, avatar, services) {
    try {
      const spellId = params[0] || params.spell;
      if (!spellId) {
        return await this._listSpells(avatar);
      }

      const ces = services?.combatEncounterService;
      if (!message?.channel?.isThread?.() && ces?.getEncounterByParentChannelId) {
        const parentEncounter = ces.getEncounterByParentChannelId(message.channel.id);
        if (parentEncounter && parentEncounter.state !== 'ended') {
          return `-# [ Combat is active in <#${parentEncounter.channelId}>. ]`;
        }
      }

      const spell = SPELLS[spellId];
      if (!spell) {
        return this._errorEmbed(`Unknown spell: \`${spellId}\`. Use 🪄 cast to see available spells.`);
      }

      // Check if in combat and enforce turn order
      let encounter = null;
      try { encounter = ces?.getEncounter?.(message.channel.id); } catch {}
      if (encounter?.state === 'active') {
        const avatarId = avatar._id || avatar.id;
        if (!ces.isTurn(encounter, avatarId)) {
          return null; // Silent out-of-turn
        }
      }

      // Get target(s)
      const targetName = params[1] || params.target;
      let targetIds = [];
      let combatTarget = null;
      const combatTargetRegistry = services?.combatTargetRegistry;

      if (targetName) {
        if (encounter?.state === 'active' && combatTargetRegistry) {
          const attackerId = String(avatar?._id || avatar?.id || '');
          combatTarget = combatTargetRegistry.resolveTarget(
            message.channel.id,
            targetName,
            { excludeAvatarIds: attackerId ? [attackerId] : [] }
          );
          if (combatTarget) {
            const resolvedId = combatTarget.avatarId || combatTarget.combatantId || combatTarget._id || combatTarget.id;
            if (resolvedId) {
              targetIds = [resolvedId];
            }
          }
        }
        if (targetIds.length === 0) {
          const target = await this.avatarService.getAvatarByName(targetName, { guildId: message.guildId });
          if (!target) {
            return this._errorEmbed(`Could not find target: ${targetName}`);
          }
          targetIds = [target._id];
        }
      } else if (spell.healing || spell.effect) {
        // Self-target for buffs/heals
        const selfTargetId = avatar._id || avatar.id;
        targetIds = [selfTargetId];
        if (encounter?.state === 'active') {
          const selfId = String(avatar?._id || avatar?.id || '');
          combatTarget = encounter.combatants?.find(c => String(c.avatarId) === selfId) || null;
        }
      } else {
        return this._errorEmbed('Specify a target: 🪄 cast <spell> <target>');
      }

      // Determine slot level
      let slotLevel = parseInt(params[2] || params.slot) || spell.level;
      if (spell.level > 0 && slotLevel < spell.level) {
        slotLevel = spell.level;
      }

      const casterId = avatar._id || avatar.id;
      const result = await this.spellService.castSpell(
        casterId,
        spellId,
        slotLevel,
        targetIds,
        { channelId: message.channel.id, encounter }
      );

      // Trigger quest progress for casting spells
      await this.questService?.onEvent?.(casterId, 'spell_cast', { spellId, slotLevel });
      await this.tutorialQuestService?.onEvent?.(casterId, 'spell_cast', { spellId, slotLevel });

      // Complete player action and advance turn if in combat
      if (encounter?.state === 'active' && ces?.completePlayerAction) {
        const targetId = targetIds[0];
        const primary = result.results?.[0] || {};
        const damage = primary.damage;
        const healing = primary.healing;
        await ces.completePlayerAction(message.channel.id, casterId, {
          actionType: 'cast',
          damage,
          healing,
          targetId,
          target: combatTarget || null,
          result
        });
      }

      return this._formatResult(avatar, result);
    } catch (error) {
      this.logger.error('[CastTool] Error:', error);
      return this._errorEmbed(error.message);
    }
  }

  async _listSpells(avatar) {
    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet) {
      return this._errorEmbed(`${avatar.name} has no character sheet.`);
    }
    if (!sheet.spellcasting) {
      return this._errorEmbed(`${avatar.name} is not a spellcaster.`);
    }

    // Trigger quest progress (both quest systems)
    await this.questService?.onEvent?.(avatar._id, 'spells_checked');
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'spells_viewed');

    const cantrips = (sheet.spellcasting.cantrips || [])
      .map(id => SPELLS[id]?.name || id)
      .join(', ') || 'None';

    const known = (sheet.spellcasting.known || [])
      .map(id => {
        const s = SPELLS[id];
        return s ? `${s.name} (L${s.level})` : id;
      })
      .join(', ') || 'None';

    const slots = Object.entries(sheet.spellcasting.slots || {})
      .map(([lvl, s]) => `L${lvl}: ${s.current}/${s.max}`)
      .join(' | ') || 'None';

    // Build spell buttons (up to 10 spells - 2 rows of 5)
    const spellButtons = [];
    const allSpells = [...(sheet.spellcasting.cantrips || []), ...(sheet.spellcasting.known || [])];
    for (const spellId of allSpells.slice(0, 10)) {
      const spell = SPELLS[spellId];
      if (spell) {
        spellButtons.push({
          id: `dnd_cast_${spellId}`,
          label: spell.name.substring(0, 15),
          emoji: spell.damage ? '💥' : spell.healing ? '💚' : '✨',
          style: spell.damage ? 'Danger' : spell.healing ? 'Success' : 'Primary'
        });
      }
    }

    const response = {
      embeds: [{
        title: `🪄 ${avatar.name}'s Spells`,
        color: 0x8B5CF6, // Purple
        fields: [
          { name: '🔮 Cantrips', value: cantrips, inline: false },
          { name: '📖 Known Spells', value: known, inline: false },
          { name: '⚡ Spell Slots', value: slots, inline: false }
        ],
        footer: { text: 'Select a spell to cast' }
      }]
    };

    const buttons = spellButtons.length > 0 ? createActionMenu(spellButtons) : [];
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  _formatResult(caster, { spell, slotLevel, results }) {
    const lines = [];
    
    if (slotLevel > spell.level) {
      lines.push(`*Upcast at level ${slotLevel}*`);
    }

    for (const r of results) {
      if (r.attackRoll !== undefined) {
        const hitText = r.hit ? (r.critical ? '**CRITICAL HIT!**' : 'Hit!') : 'Miss!';
        lines.push(`🎯 ${r.targetName}: ${r.attackRoll} + ${r.total - r.attackRoll} = ${r.total} vs AC ${r.targetAC} - ${hitText}`);
      }

      if (r.saveRoll !== undefined) {
        const saveText = r.saved ? 'Saved!' : 'Failed!';
        lines.push(`🎲 ${r.targetName}: Save ${r.saveRoll} vs DC ${r.saveDC} - ${saveText}`);
      }

      if (r.damage !== undefined) {
        const damageEmoji = r.damageType === 'fire' ? '🔥' : r.damageType === 'radiant' ? '✨' : '💥';
        lines.push(`${damageEmoji} ${r.targetName} takes **${r.damage}** ${r.damageType} damage!`);
      }

      if (r.healing !== undefined) {
        lines.push(`💚 ${r.targetName} heals for **${r.healing}** HP!`);
      }

      if (r.effectApplied) {
        lines.push(`🌀 ${r.targetName} is affected by **${r.effectApplied}**!`);
      }
    }

    // Choose color based on spell type
    let color = 0x3B82F6; // Default blue
    if (spell.damage) color = 0xEF4444; // Red for damage
    if (spell.healing) color = 0x10B981; // Green for healing
    if (spell.effect) color = 0xF59E0B; // Amber for effects

    return {
      embeds: [{
        title: `🪄 ${spell.name}`,
        description: `**${caster.name}** casts **${spell.name}**!`,
        color,
        fields: lines.length > 0 ? [{ name: 'Results', value: lines.join('\n'), inline: false }] : [],
        footer: spell.level > 0 ? { text: `Level ${slotLevel} spell` } : undefined
      }]
    };
  }
}
