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
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

// Consistent color palette
const COLORS = {
  SUCCESS: 0x10B981,
  ERROR: 0xEF4444,
  INFO: 0x3B82F6,
  WARNING: 0xF59E0B,
  MUTED: 0x6B7280
};

// Safe fallback emoji for buttons
const DEFAULT_AVATAR_EMOJI = '👤';

export class PartyTool extends BasicTool {
  constructor({ logger, partyService, characterService, avatarService, questService, tutorialQuestService }) {
    super();
    this.logger = logger || console;
    this.partyService = partyService;
    this.characterService = characterService;
    this.avatarService = avatarService;
    this.questService = questService;
    this.tutorialQuestService = tutorialQuestService;

    this.name = 'party';
    this.parameters = '<action> [options]';
    this.description = 'Manage D&D party: create, invite, kick, rename';
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
          enum: ['create', 'invite', 'kick', 'leave', 'list', 'role', 'rename'],
          description: 'Action to perform'
        },
        name: {
          type: 'string',
          description: 'Party name (for create/rename)'
        },
        target: {
          type: 'string',
          description: 'Target avatar name (for invite/kick)'
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
          if (params.length > 1) {
            return await this._addMemberByName(avatar, params.slice(1), message);
          }
          return await this._showInviteMenu(avatar, message);
        case 'kick':
          return await this._showKickMenu(avatar);
        case 'leave':
          return await this._leave(avatar);
        case 'list':
          return await this._list(avatar);
        case 'role':
          return await this._setRole(avatar, params);
        case 'rename':
          return await this._rename(avatar, params);
        case 'add':
          // Direct add by avatar ID (from button)
          return await this._addMember(avatar, params, message);
        case 'remove':
          // Direct remove by avatar ID (from button)
          return await this._removeMember(avatar, params);
        case undefined:
        case '':
          return await this._showMenu(avatar, message);
        default:
          // Check if it's an avatar name to invite
          if (action) {
            return await this._addMemberByName(avatar, params, message);
          }
          return await this._showMenu(avatar, message);
      }
    } catch (error) {
      this.logger.error('[PartyTool] Error:', error);
      return this._errorEmbed(error.message);
    }
  }

  /**
   * Show party menu with current status and action buttons
   */
  async _showMenu(avatar, _message) {
    const sheet = await this.characterService?.getSheet?.(avatar._id);
    
    if (!sheet?.partyId) {
      // Not in a party - show create option
      const response = {
        embeds: [{
          title: '👥 Party',
          description: `**${avatar.name}** is not in a party yet.`,
          color: COLORS.MUTED,
          fields: [{
            name: '🚀 Get Started',
            value: 'Create a party to adventure with others!',
            inline: false
          }]
        }]
      };
      
      const buttons = createActionMenu([
        { id: 'dnd_party_create', label: 'Create Party', emoji: '👥', style: 'Success' }
      ]);
      
      return addEmbedTextSummary(addComponentsToResponse(response, buttons));
    }
    
    // In a party - show party info with management buttons
    return await this._list(avatar);
  }

  _errorEmbed(message) {
    return {
      embeds: [{
        title: '👥 Party Error',
        description: message,
        color: COLORS.ERROR
      }]
    };
  }

  async _create(avatar, params) {
    const name = (Array.isArray(params) && params.length > 1) 
      ? params.slice(1).join(' ') 
      : (params.name || `${avatar.name}'s Party`);
    
    const party = await this.partyService.createParty(avatar._id, name);

    // Trigger quest progress
    await this.questService?.onEvent?.(avatar._id, 'party_ready');
    await this.tutorialQuestService?.onEvent?.(avatar._id, 'party_created');
    
    const response = {
      embeds: [{
        title: '👥 Party Formed!',
        description: `**${name}** has been created!`,
        color: COLORS.SUCCESS,
        fields: [
          { name: '👑 Leader', value: avatar.name, inline: true },
          { name: '📊 Size', value: `1/${party.maxSize}`, inline: true }
        ],
        footer: { text: 'Invite members or enter a dungeon!' }
      }]
    };
    
    const buttons = createActionMenu([
      { id: 'dnd_party_invite', label: 'Invite Member', emoji: '➕', style: 'Primary' },
      { id: 'dnd_dungeon_enter', label: 'Enter Dungeon', emoji: '🏰', style: 'Success' }
    ]);
    
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  /**
   * Show invite menu with recently active avatars in the channel
   */
  async _showInviteMenu(avatar, message) {
    const sheet = await this.characterService?.getSheet?.(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party. Create one first!`);
    }

    const party = await this.partyService.getParty(sheet.partyId);
    if (!party) {
      return this._errorEmbed('Party not found.');
    }

    if (!party.leaderId.equals(avatar._id)) {
      return this._errorEmbed('Only the party leader can invite members.');
    }

    if (party.members.length >= party.maxSize) {
      return this._errorEmbed('Party is full!');
    }

    // Get recently active avatars in this channel
    const channelAvatars = await this.avatarService.getAvatarsInChannel(message.channelId, message.guildId);
    const excludedIds = new Set(party.members.map(m => String(m.avatarId)));
    const recentAvatars = channelAvatars
      .filter(av => !excludedIds.has(String(av._id)))
      .sort((a, b) => {
        const aTime = new Date(a.lastActiveAt || 0).getTime();
        const bTime = new Date(b.lastActiveAt || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 10);

    // Filter out avatars already in ANY party
    const availableAvatars = [];
    for (const av of recentAvatars) {
      const avSheet = await this.characterService?.getSheet?.(av._id);
      if (!avSheet?.partyId) {
        availableAvatars.push(av);
      }
    }

    if (availableAvatars.length === 0) {
      const response = {
        embeds: [{
          title: '👥 Invite Member',
          description: 'No available avatars found in this channel.\n\nAvatars must be active in this channel and not already in a party.',
          color: COLORS.WARNING
        }]
      };
      const buttons = createActionMenu([
        { id: 'dnd_party_menu', label: 'Back', emoji: '◀️', style: 'Secondary' }
      ]);
      return addEmbedTextSummary(addComponentsToResponse(response, buttons));
    }

    // Create buttons for each available avatar (max 5 per row, max 4 rows = 20)
    const rows = [];
    const maxAvatars = Math.min(availableAvatars.length, 20);
    
    for (let i = 0; i < maxAvatars; i += 5) {
      const row = new ActionRowBuilder();
      const chunk = availableAvatars.slice(i, i + 5);
      
      for (const av of chunk) {
        // Use default emoji - avatar emojis are often invalid for Discord buttons
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`dnd_party_add_${av._id}`)
            .setLabel(av.name.substring(0, 25))
            .setEmoji(DEFAULT_AVATAR_EMOJI)
            .setStyle(ButtonStyle.Primary)
        );
      }
      rows.push(row);
    }

    // Add back button
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dnd_party_menu')
        .setLabel('Back')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
    ));

    const response = {
      embeds: [{
        title: '👥 Invite Member',
        description: `Select an avatar to invite to **${party.name}**:`,
        color: COLORS.INFO,
        fields: [{
          name: '📊 Party Size',
          value: `${party.members.length}/${party.maxSize}`,
          inline: true
        }],
        footer: { text: 'Only avatars not in a party can be invited' }
      }],
      components: rows
    };

    return addEmbedTextSummary(response);
  }

  /**
   * Add a member directly by avatar ID (from button click)
   */
  async _addMember(avatar, params, _message) {
    const targetId = params[1];
    if (!targetId) {
      return this._errorEmbed('No avatar specified.');
    }

    const sheet = await this.characterService?.getSheet?.(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party.`);
    }

    const party = await this.partyService.getParty(sheet.partyId);
    if (!party.leaderId.equals(avatar._id)) {
      return this._errorEmbed('Only the party leader can invite members.');
    }

    // Get target avatar
    const target = await this.avatarService.getAvatarById(targetId);
    
    if (!target) {
      return this._errorEmbed('Avatar not found.');
    }

    // Check target is not in a party
    const targetSheet = await this.characterService?.getSheet?.(target._id);
    if (targetSheet?.partyId) {
      return this._errorEmbed(`${target.name} is already in a party.`);
    }

    // Add to party
    await this.partyService.invite(sheet.partyId, target._id);

    const response = {
      embeds: [{
        title: '✅ Member Joined!',
        description: `**${target.name}** joined **${party.name}**!`,
        color: COLORS.SUCCESS,
        fields: [
          { name: '📊 Party Size', value: `${party.members.length + 1}/${party.maxSize}`, inline: true }
        ]
      }]
    };
    
    const buttons = createActionMenu([
      { id: 'dnd_party_invite', label: 'Invite More', emoji: '➕', style: 'Primary' },
      { id: 'dnd_party_menu', label: 'Party Menu', emoji: '👥', style: 'Secondary' }
    ]);
    
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  /**
   * Add member by name (from command)
   */
  async _addMemberByName(avatar, params, message) {
    const targetName = params.join(' ');
    
    const sheet = await this.characterService?.getSheet?.(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party. Create one first!`);
    }

    const party = await this.partyService.getParty(sheet.partyId);
    if (!party.leaderId.equals(avatar._id)) {
      return this._errorEmbed('Only the party leader can invite members.');
    }

    const target = await this.avatarService.getAvatarByName(targetName, { guildId: message.guildId });
    if (!target) {
      return this._errorEmbed(`Could not find avatar: ${targetName}`);
    }

    const targetSheet = await this.characterService?.getSheet?.(target._id);
    if (targetSheet?.partyId) {
      return this._errorEmbed(`${target.name} is already in a party.`);
    }

    await this.partyService.invite(sheet.partyId, target._id);

    return {
      embeds: [{
        title: '✅ Member Joined!',
        description: `**${target.name}** joined **${party.name}**!`,
        color: COLORS.SUCCESS
      }]
    };
  }

  /**
   * Show kick/remove menu with current party members
   */
  async _showKickMenu(avatar) {
    const sheet = await this.characterService?.getSheet?.(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party.`);
    }

    const party = await this.partyService.getPartyWithAvatars(sheet.partyId);
    if (!party) {
      return this._errorEmbed('Party not found.');
    }

    if (!party.leaderId.equals(avatar._id)) {
      return this._errorEmbed('Only the party leader can remove members.');
    }

    // Filter out the leader (can't kick yourself)
    const kickableMembers = party.members.filter(m => !m.avatarId.equals(avatar._id));

    if (kickableMembers.length === 0) {
      const response = {
        embeds: [{
          title: '👥 Remove Member',
          description: 'No other members in the party to remove.',
          color: COLORS.WARNING
        }]
      };
      const buttons = createActionMenu([
        { id: 'dnd_party_menu', label: 'Back', emoji: '◀️', style: 'Secondary' }
      ]);
      return addEmbedTextSummary(addComponentsToResponse(response, buttons));
    }

    // Create buttons for each kickable member
    const rows = [];
    const maxMembers = Math.min(kickableMembers.length, 20);
    
    for (let i = 0; i < maxMembers; i += 5) {
      const row = new ActionRowBuilder();
      const chunk = kickableMembers.slice(i, i + 5);
      
      for (const m of chunk) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`dnd_party_remove_${m.avatarId}`)
            .setLabel((m.avatar?.name || 'Unknown').substring(0, 25))
            .setEmoji('🚫')
            .setStyle(ButtonStyle.Danger)
        );
      }
      rows.push(row);
    }

    // Add back button
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dnd_party_menu')
        .setLabel('Back')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
    ));

    const response = {
      embeds: [{
        title: '👥 Remove Member',
        description: `Select a member to remove from **${party.name}**:`,
        color: COLORS.WARNING
      }],
      components: rows
    };

    return addEmbedTextSummary(response);
  }

  /**
   * Remove a member by avatar ID (from button click)
   */
  async _removeMember(avatar, params) {
    const targetId = params[1];
    if (!targetId) {
      return this._errorEmbed('No member specified.');
    }

    const sheet = await this.characterService?.getSheet?.(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party.`);
    }

    const party = await this.partyService.getParty(sheet.partyId);
    if (!party.leaderId.equals(avatar._id)) {
      return this._errorEmbed('Only the party leader can remove members.');
    }

    // Get target avatar name before removing
    const target = await this.avatarService.getAvatarById(targetId);
    const targetName = target?.name || 'Unknown';

    // Remove from party
    await this.partyService.kickMember(sheet.partyId, targetId);

    const response = {
      embeds: [{
        title: '👋 Member Removed',
        description: `**${targetName}** was removed from the party.`,
        color: COLORS.MUTED
      }]
    };
    
    const buttons = createActionMenu([
      { id: 'dnd_party_menu', label: 'Party Menu', emoji: '👥', style: 'Secondary' }
    ]);
    
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  async _leave(avatar) {
    const result = await this.partyService.leave(avatar._id);

    if (result.dissolved) {
      return addEmbedTextSummary({
        embeds: [{
          title: '👥 Party Disbanded',
          description: `**${avatar.name}** disbanded the party.`,
          color: COLORS.MUTED
        }]
      });
    }
    return addEmbedTextSummary({
      embeds: [{
        title: '👋 Left Party',
        description: `**${avatar.name}** left the party.`,
        color: COLORS.MUTED
      }]
    });
  }

  async _list(avatar) {
    const sheet = await this.characterService?.getSheet?.(avatar._id);
    if (!sheet?.partyId) {
      const response = {
        embeds: [{
          title: '👥 No Party',
          description: `${avatar.name} is not in a party.`,
          color: COLORS.MUTED
        }]
      };
      const buttons = createActionMenu([
        { id: 'dnd_party_create', label: 'Create Party', emoji: '👥', style: 'Success' }
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
        color: COLORS.INFO,
        fields: [
          { name: '📊 Members', value: `${party.members.length}/${party.maxSize}`, inline: true },
          { name: '💰 Shared Gold', value: `${party.sharedGold}`, inline: true },
          { name: '🎭 Roster', value: memberList || 'No members', inline: false }
        ]
      }]
    };
    
    // Build action buttons based on role
    const actions = [];
    
    if (isLeader) {
      // Leader gets management buttons
      if (party.members.length < party.maxSize) {
        actions.push({ id: 'dnd_party_invite', label: 'Invite', emoji: '➕', style: 'Primary' });
      }
      if (party.members.length > 1) {
        actions.push({ id: 'dnd_party_kick', label: 'Remove', emoji: '🚫', style: 'Danger' });
      }
      actions.push({ id: 'dnd_party_rename', label: 'Rename', emoji: '✏️', style: 'Secondary' });
      actions.push({ id: 'dnd_dungeon_enter', label: 'Dungeon', emoji: '🏰', style: 'Success' });
    }
    
    // Everyone can set their role or leave
    actions.push({ id: 'dnd_party_roles', label: 'Set Role', emoji: '🎭', style: 'Secondary' });
    actions.push({ id: 'dnd_party_leave', label: 'Leave', emoji: '🚪', style: 'Danger' });
    
    const buttons = createActionMenu(actions);
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  async _rename(avatar, params) {
    const newName = (Array.isArray(params) && params.length > 1) 
      ? params.slice(1).join(' ') 
      : null;

    const sheet = await this.characterService?.getSheet?.(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party.`);
    }

    const party = await this.partyService.getParty(sheet.partyId);
    if (!party.leaderId.equals(avatar._id)) {
      return this._errorEmbed('Only the party leader can rename the party.');
    }

    if (!newName) {
      return {
        embeds: [{
          title: '✏️ Rename Party',
          description: `Current name: **${party.name}**\n\nTo rename, use:\n\`👥 party rename New Party Name\``,
          color: COLORS.INFO
        }]
      };
    }

    // Update party name
    await this.partyService.renameParty(sheet.partyId, newName);

    const response = {
      embeds: [{
        title: '✅ Party Renamed',
        description: `Party renamed to **${newName}**!`,
        color: COLORS.SUCCESS
      }]
    };
    
    const buttons = createActionMenu([
      { id: 'dnd_party_menu', label: 'Party Menu', emoji: '👥', style: 'Secondary' }
    ]);
    
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }

  async _setRole(avatar, params) {
    const role = params[1] || params.role;
    if (!['tank', 'healer', 'dps', 'support'].includes(role)) {
      // Show role selection menu
      const response = {
        embeds: [{
          title: '🎭 Select Role',
          description: 'Choose your role in the party:',
          color: COLORS.INFO,
          fields: [
            { name: '🛡️ Tank', value: 'Protect allies, draw enemy attention', inline: true },
            { name: '💚 Healer', value: 'Restore HP, remove debuffs', inline: true },
            { name: '⚔️ DPS', value: 'Deal damage, defeat enemies', inline: true },
            { name: '✨ Support', value: 'Buff allies, debuff enemies', inline: true }
          ]
        }]
      };
      
      const buttons = createActionMenu([
        { id: 'dnd_party_role_tank', label: 'Tank', emoji: '🛡️' },
        { id: 'dnd_party_role_healer', label: 'Healer', emoji: '💚' },
        { id: 'dnd_party_role_dps', label: 'DPS', emoji: '⚔️' },
        { id: 'dnd_party_role_support', label: 'Support', emoji: '✨' },
        { id: 'dnd_party_menu', label: 'Back', emoji: '◀️', style: 'Secondary' }
      ]);
      
      return addEmbedTextSummary(addComponentsToResponse(response, buttons));
    }

    const sheet = await this.characterService?.getSheet?.(avatar._id);
    if (!sheet?.partyId) {
      return this._errorEmbed(`${avatar.name} is not in a party.`);
    }

    await this.partyService.setRole(sheet.partyId, avatar._id, role);

    const roleEmojis = { tank: '🛡️', healer: '💚', dps: '⚔️', support: '✨' };
    const response = {
      embeds: [{
        title: `${roleEmojis[role]} Role Assigned`,
        description: `**${avatar.name}** is now the party **${role}**!`,
        color: COLORS.SUCCESS
      }]
    };
    
    const buttons = createActionMenu([
      { id: 'dnd_party_menu', label: 'Party Menu', emoji: '👥', style: 'Secondary' }
    ]);
    
    return addEmbedTextSummary(addComponentsToResponse(response, buttons));
  }
}
