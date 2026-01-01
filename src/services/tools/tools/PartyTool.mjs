/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * PartyTool - D&D party management
 */

import { BasicTool } from '../BasicTool.mjs';

export class PartyTool extends BasicTool {
  constructor({ logger, partyService, characterService, avatarService, discordService, questService }) {
    super();
    this.logger = logger || console;
    this.partyService = partyService;
    this.characterService = characterService;
    this.avatarService = avatarService;
    this.discordService = discordService;
    this.questService = questService;

    this.name = 'party';
    this.parameters = '<action> [options]';
    this.description = 'Manage D&D party: create, invite, leave, list';
    this.emoji = '👥';
    this.replyNotification = true;
    this.cooldownMs = 5000;
  }

  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'invite', 'leave', 'list', 'role'],
          description: 'Action to perform'
        },
        name: {
          type: 'string',
          description: 'Party name (for create)'
        },
        target: {
          type: 'string',
          description: 'Target avatar name (for invite)'
        },
        role: {
          type: 'string',
          enum: ['tank', 'healer', 'dps', 'support'],
          description: 'Role to assign'
        }
      },
      required: ['action']
    };
  }

  async execute(message, params, avatar) {
    const action = params[0] || params.action;

    try {
      switch (action) {
        case 'create':
          return await this._create(avatar, params);
        case 'invite':
          return await this._invite(avatar, params, message);
        case 'leave':
          return await this._leave(avatar);
        case 'list':
          return await this._list(avatar);
        case 'role':
          return await this._setRole(avatar, params);
        default:
          return this._errorEmbed(`Unknown action: ${action}. Use: create, invite, leave, list, role`);
      }
    } catch (error) {
      this.logger.error('[PartyTool] Error:', error);
      return this._errorEmbed(error.message);
    }
  }

  _errorEmbed(message) {
    return {
      embeds: [{
        title: '👥 Party Error',
        description: message,
        color: 0xEF4444 // Red
      }]
    };
  }

  async _create(avatar, params) {
    const name = params[1] || params.name || `${avatar.name}'s Party`;
    
    const party = await this.partyService.createParty(avatar._id, name);

    // Trigger quest progress
    await this.questService?.onEvent?.(avatar._id, 'party_ready');
    
    return {
      embeds: [{
        title: '👥 Party Formed!',
        description: `**${name}** has been created!`,
        color: 0x10B981, // Green
        fields: [
          { name: '👑 Leader', value: avatar.name, inline: true },
          { name: '📊 Size', value: `1/${party.maxSize}`, inline: true }
        ],
        footer: { text: 'Use 👥 party invite <name> to add members' }
      }]
    };
  }

  async _invite(avatar, params, message) {
    const targetName = params[1] || params.target;
    if (!targetName) {
      return this._errorEmbed('Specify who to invite: 👥 party invite <name>');
    }

    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party. Create one first with 👥 party create`);
    }

    const party = await this.partyService.getParty(sheet.partyId);
    if (!party.leaderId.equals(avatar._id)) {
      return this._errorEmbed('Only the party leader can invite members.');
    }

    // Find target avatar
    const target = await this.avatarService.getAvatarByName(targetName, { guildId: message.guildId });
    if (!target) {
      return this._errorEmbed(`Could not find avatar: ${targetName}`);
    }

    await this.partyService.invite(sheet.partyId, target._id);

    return {
      embeds: [{
        title: '✅ Member Joined!',
        description: `**${target.name}** joined **${party.name}**!`,
        color: 0x10B981, // Green
        fields: [
          { name: '📊 Party Size', value: `${party.members.length + 1}/${party.maxSize}`, inline: true }
        ]
      }]
    };
  }

  async _leave(avatar) {
    const result = await this.partyService.leave(avatar._id);

    if (result.dissolved) {
      return {
        embeds: [{
          title: '👥 Party Disbanded',
          description: `**${avatar.name}** disbanded the party.`,
          color: 0x6B7280 // Gray
        }]
      };
    }
    return {
      embeds: [{
        title: '👋 Left Party',
        description: `**${avatar.name}** left the party.`,
        color: 0x6B7280 // Gray
      }]
    };
  }

  async _list(avatar) {
    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party.`);
    }

    const party = await this.partyService.getPartyWithAvatars(sheet.partyId);
    if (!party) {
      return this._errorEmbed('Party not found.');
    }

    const roleEmojis = { tank: '🛡️', healer: '💚', dps: '⚔️', support: '✨' };
    
    const memberList = party.members.map(m => {
      const isLeader = party.leaderId.equals(m.avatarId) ? '👑 ' : '';
      const roleEmoji = roleEmojis[m.role] || '❓';
      const className = m.sheet?.class || 'Unknown';
      const level = m.sheet?.level || 1;
      return `${isLeader}${roleEmoji} **${m.avatar?.name || 'Unknown'}** - L${level} ${className}`;
    }).join('\n');

    return {
      embeds: [{
        title: `👥 ${party.name}`,
        color: 0x3B82F6, // Blue
        fields: [
          { name: '📊 Members', value: `${party.members.length}/${party.maxSize}`, inline: true },
          { name: '💰 Shared Gold', value: `${party.sharedGold}`, inline: true },
          { name: '🎭 Roster', value: memberList || 'No members', inline: false }
        ]
      }]
    };
  }

  async _setRole(avatar, params) {
    const role = params[1] || params.role;
    if (!['tank', 'healer', 'dps', 'support'].includes(role)) {
      return this._errorEmbed('Valid roles: tank, healer, dps, support');
    }

    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party.`);
    }

    await this.partyService.setRole(sheet.partyId, avatar._id, role);

    const roleEmojis = { tank: '🛡️', healer: '💚', dps: '⚔️', support: '✨' };
    return {
      embeds: [{
        title: `${roleEmojis[role]} Role Assigned`,
        description: `**${avatar.name}** is now the party **${role}**!`,
        color: 0x3B82F6 // Blue
      }]
    };
  }
}
