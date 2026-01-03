/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * PartyTool - D&D party management
 */

import { BasicTool } from '../BasicTool.mjs';
import { 
  addComponentsToResponse, 
  addEmbedTextSummary,
  createActionMenu
} from '../dndButtonComponents.mjs';

export class PartyTool extends BasicTool {
  constructor({ logger, partyService, characterService, avatarService, discordService, questService, tutorialQuestService }) {
    super();
    this.logger = logger || console;
    this.partyService = partyService;
    this.characterService = characterService;
    this.avatarService = avatarService;
    this.discordService = discordService;
    this.questService = questService;
    this.tutorialQuestService = tutorialQuestService;

    this.name = 'party';
    this.parameters = '<action> [options]';
    this.description = 'Manage D&D party: create, invite, leave, list';
    this.emoji = '👥';
    this.isDndTool = true;
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
        case undefined:
        case '':
          // No action - show party menu
          return await this._showMenu(avatar);
        default:
          // Check if it's an avatar name to invite
          if (action) {
            return await this._invite(avatar, ['invite', ...params], message);
          }
          return await this._showMenu(avatar);
      }
    } catch (error) {
      this.logger.error('[PartyTool] Error:', error);
      return this._errorEmbed(error.message);
    }
  }

  /**
   * Show party menu with current status and actions
   */
  async _showMenu(avatar) {
    const sheet = await this.characterService?.getSheet?.(avatar._id);
    
    if (!sheet?.partyId) {
      // Not in a party - show create option
      const response = {
        embeds: [{
          title: '👥 Party',
          description: `**${avatar.name}** is not in a party yet.`,
          color: 0x6B7280,
          fields: [{
            name: '🚀 Get Started',
            value: 'Create a party to adventure with others, or go solo!',
            inline: false
          }]
        }]
      };
      
      const buttons = createActionMenu([
        { id: 'dnd_party_create', label: 'Create Party', emoji: '👥', style: 'Success' },
        { id: 'dnd_tutorial_solo', label: 'Go Solo', emoji: '🎭', style: 'Secondary' }
      ]);
      
      return addEmbedTextSummary(addComponentsToResponse(response, buttons));
    }
    
    // In a party - show party info
    return await this._list(avatar);
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
    // Join all params after action for multi-word party names
    const name = (Array.isArray(params) && params.length > 1) 
      ? params.slice(1).join(' ') 
      : (params.name || `${avatar.name}'s Party`);
    
    const party = await this.partyService.createParty(avatar._id, name);

    // Trigger quest progress (both quest systems)
    await this.questService?.onEvent?.(avatar._id, 'party_ready');
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'party_created');
    
    const response = {
      embeds: [{
        title: '👥 Party Formed!',
        description: `**${name}** has been created!`,
        color: 0x10B981, // Green
        fields: [
          { name: '👑 Leader', value: avatar.name, inline: true },
          { name: '📊 Size', value: `1/${party.maxSize}`, inline: true }
        ],
        footer: { text: 'Invite members or enter a dungeon!' }
      }]
    };
    
    // Add action buttons
    const buttons = createActionMenu([
      { id: `dnd_party_list_${party._id}`, label: 'View Party', emoji: '👥' },
      { id: 'dnd_dungeon_enter', label: 'Enter Dungeon', emoji: '🏰' }
    ]);
    
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  async _invite(avatar, params, message) {
    // Join all params after action for multi-word avatar names
    const targetName = (Array.isArray(params) && params.length > 1) 
      ? params.slice(1).join(' ') 
      : params.target;
      
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

    const response = {
      embeds: [{
        title: '✅ Member Joined!',
        description: `**${target.name}** joined **${party.name}**!`,
        color: 0x10B981, // Green
        fields: [
          { name: '📊 Party Size', value: `${party.members.length + 1}/${party.maxSize}`, inline: true }
        ]
      }]
    };
    
    return addEmbedTextSummary(response);
  }

  async _leave(avatar) {
    const result = await this.partyService.leave(avatar._id);

    if (result.dissolved) {
      return addEmbedTextSummary({
        embeds: [{
          title: '👥 Party Disbanded',
          description: `**${avatar.name}** disbanded the party.`,
          color: 0x6B7280 // Gray
        }]
      });
    }
    return addEmbedTextSummary({
      embeds: [{
        title: '👋 Left Party',
        description: `**${avatar.name}** left the party.`,
        color: 0x6B7280 // Gray
      }]
    });
  }

  async _list(avatar) {
    const sheet = await this.characterService.getSheet(avatar._id);
    if (!sheet?.partyId) {
      // Not in party - show create button
      const response = {
        embeds: [{
          title: '👥 No Party',
          description: `${avatar.name} is not in a party.`,
          color: 0x6B7280
        }]
      };
      const buttons = createActionMenu([
        { id: 'dnd_party_create', label: 'Create Party', emoji: '👥' }
      ]);
      return addEmbedTextSummary(addComponentsToResponse(response, buttons));
    }

    const party = await this.partyService.getPartyWithAvatars(sheet.partyId);
    if (!party) {
      return this._errorEmbed('Party not found.');
    }

    const roleEmojis = { tank: '🛡️', healer: '💚', dps: '⚔️', support: '✨' };
    const isLeader = party.leaderId.equals(avatar._id);
    
    const memberList = party.members.map(m => {
      const leaderMark = party.leaderId.equals(m.avatarId) ? '👑 ' : '';
      const roleEmoji = roleEmojis[m.role] || '❓';
      const className = m.sheet?.class || 'Unknown';
      const level = m.sheet?.level || 1;
      return `${leaderMark}${roleEmoji} **${m.avatar?.name || 'Unknown'}** - L${level} ${className}`;
    }).join('\n');

    const response = {
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
    
    // Add contextual buttons
    const actions = [];
    if (isLeader) {
      actions.push({ id: 'dnd_dungeon_enter', label: 'Enter Dungeon', emoji: '🏰' });
    }
    actions.push(
      { id: `dnd_party_role_tank`, label: 'Set Tank', emoji: '🛡️' },
      { id: `dnd_party_role_healer`, label: 'Set Healer', emoji: '💚' },
      { id: `dnd_party_role_dps`, label: 'Set DPS', emoji: '⚔️' },
      { id: 'dnd_party_leave', label: 'Leave', emoji: '🚪', style: 2 } // Secondary
    );
    
    const buttons = createActionMenu(actions);
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
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
    return addEmbedTextSummary({
      embeds: [{
        title: `${roleEmojis[role]} Role Assigned`,
        description: `**${avatar.name}** is now the party **${role}**!`,
        color: 0x3B82F6 // Blue
      }]
    });
  }
}
