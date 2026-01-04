/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * PartyService - Manages D&D party groups
 */

import { ObjectId } from 'mongodb';
import { DiceService } from '../battle/diceService.mjs';

export class PartyService {
  constructor({ databaseService, characterService, avatarService, itemService, logger }) {
    this.databaseService = databaseService;
    this.characterService = characterService;
    this.avatarService = avatarService;
    this.itemService = itemService;
    this.logger = logger;
    this._collection = null;
    this._inviteCollection = null;
    this._lootRollCollection = null;
    this.diceService = new DiceService();
  }

  async collection() {
    if (!this._collection) {
      const db = await this.databaseService.getDatabase();
      this._collection = db.collection('parties');
      await this._ensureIndexes();
    }
    return this._collection;
  }

  async inviteCollection() {
    if (!this._inviteCollection) {
      const db = await this.databaseService.getDatabase();
      this._inviteCollection = db.collection('party_invites');
      await this._ensureInviteIndexes();
    }
    return this._inviteCollection;
  }

  async lootRollCollection() {
    if (!this._lootRollCollection) {
      const db = await this.databaseService.getDatabase();
      this._lootRollCollection = db.collection('party_loot_rolls');
      await this._ensureLootRollIndexes();
    }
    return this._lootRollCollection;
  }

  async _ensureIndexes() {
    try {
      await this._collection.createIndex({ leaderId: 1 });
      await this._collection.createIndex({ 'members.avatarId': 1 });
      await this._collection.createIndex({ campaignId: 1 });
    } catch (e) {
      this.logger?.warn?.('[PartyService] Index creation:', e.message);
    }
  }

  async _ensureInviteIndexes() {
    try {
      await this._inviteCollection.createIndex({ partyId: 1 });
      await this._inviteCollection.createIndex({ avatarId: 1 });
      await this._inviteCollection.createIndex({ status: 1 });
      await this._inviteCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-cleanup
    } catch (e) {
      this.logger?.warn?.('[PartyService] Invite index creation:', e.message);
    }
  }

  async _ensureLootRollIndexes() {
    try {
      await this._lootRollCollection.createIndex({ partyId: 1, status: 1 });
      await this._lootRollCollection.createIndex({ itemId: 1 }, { unique: true });
      await this._lootRollCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    } catch (e) {
      this.logger?.warn?.('[PartyService] Loot roll index creation:', e.message);
    }
  }

  async _getSheetForParty(avatarId) {
    if (this.characterService?.getOrCreateSheet) {
      return this.characterService.getOrCreateSheet(avatarId);
    }
    if (this.characterService?.getSheet) {
      return this.characterService.getSheet(avatarId);
    }
    return null;
  }

  async getParty(partyId) {
    const col = await this.collection();
    return col.findOne({ _id: new ObjectId(partyId) });
  }

  async getPartyByMember(avatarId) {
    const col = await this.collection();
    return col.findOne({ 'members.avatarId': new ObjectId(avatarId) });
  }

  async createParty(leaderId, name) {
    // Get or create character sheet for leader (auto-generates if missing)
    const sheet = await this._getSheetForParty(leaderId);
    if (!sheet) throw new Error('Leader has no character sheet');
    if (sheet.partyId) throw new Error('Already in a party');

    const party = {
      name,
      leaderId: new ObjectId(leaderId),
      members: [{
        avatarId: new ObjectId(leaderId),
        sheetId: sheet._id,
        role: 'dps',
        joinedAt: new Date()
      }],
      maxSize: 4,
      sharedGold: 0,
      sharedInventory: [],
      dungeonId: null,
      campaignId: null,
      createdAt: new Date()
    };

    const col = await this.collection();
    const result = await col.insertOne(party);
    
    await this.characterService.setParty(leaderId, result.insertedId);

    this.logger?.info?.(`[PartyService] Created party "${name}" led by ${leaderId}`);
    return { ...party, _id: result.insertedId };
  }

  /**
   * Send a party invitation to an avatar (PS-1 fix: proper invitation system)
   * @param {string} partyId - The party to invite to
   * @param {string} avatarId - The avatar to invite
   * @param {string} inviterId - The avatar sending the invitation
   * @returns {Promise<Object>} The created invite
   */
  async sendInvite(partyId, avatarId, inviterId) {
    const party = await this.getParty(partyId);
    if (!party) throw new Error('Party not found');
    if (party.members.length >= party.maxSize) throw new Error('Party is full');

    // Verify inviter is party leader or member
    const isLeader = party.leaderId.equals(new ObjectId(inviterId));
    const isMember = party.members.some(m => m.avatarId.equals(new ObjectId(inviterId)));
    if (!isLeader && !isMember) throw new Error('Only party members can send invites');

    // Get or create character sheet for target avatar (auto-generates if missing)
    const sheet = await this._getSheetForParty(avatarId);
    if (!sheet) throw new Error('No character sheet');
    if (sheet.partyId) throw new Error('Target is already in a party');

    // Check not already a member
    if (party.members.some(m => m.avatarId.equals(new ObjectId(avatarId)))) {
      throw new Error('Already in this party');
    }

    // Check for existing pending invite
    const inviteCol = await this.inviteCollection();
    const existingInvite = await inviteCol.findOne({
      partyId: new ObjectId(partyId),
      avatarId: new ObjectId(avatarId),
      status: 'pending'
    });
    if (existingInvite) throw new Error('Invite already pending');

    // Create the invitation (expires in 24 hours)
    const invite = {
      partyId: new ObjectId(partyId),
      partyName: party.name,
      avatarId: new ObjectId(avatarId),
      inviterId: new ObjectId(inviterId),
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    };

    const result = await inviteCol.insertOne(invite);
    
    this.logger?.info?.(`[PartyService] Invite sent from ${inviterId} to ${avatarId} for party ${partyId}`);
    return { ...invite, _id: result.insertedId };
  }

  /**
   * Accept a party invitation
   * @param {string} avatarId - The avatar accepting the invite
   * @param {string} partyId - The party to join
   * @returns {Promise<Object>} The updated party
   */
  async acceptInvite(avatarId, partyId) {
    const inviteCol = await this.inviteCollection();
    const invite = await inviteCol.findOne({
      partyId: new ObjectId(partyId),
      avatarId: new ObjectId(avatarId),
      status: 'pending'
    });

    if (!invite) throw new Error('No pending invite found');
    if (invite.expiresAt < new Date()) throw new Error('Invite has expired');

    // Verify party still has room
    const party = await this.getParty(partyId);
    if (!party) throw new Error('Party no longer exists');
    if (party.members.length >= party.maxSize) throw new Error('Party is now full');

    const sheet = await this.characterService.getSheet(avatarId);
    if (sheet.partyId) throw new Error('You joined another party');

    // Add member to party
    const col = await this.collection();
    await col.updateOne(
      { _id: party._id },
      {
        $push: {
          members: {
            avatarId: new ObjectId(avatarId),
            sheetId: sheet._id,
            role: 'dps',
            joinedAt: new Date()
          }
        }
      }
    );

    await this.characterService.setParty(avatarId, partyId);

    // Mark invite as accepted
    await inviteCol.updateOne(
      { _id: invite._id },
      { $set: { status: 'accepted', respondedAt: new Date() } }
    );

    this.logger?.info?.(`[PartyService] ${avatarId} accepted invite and joined party ${partyId}`);
    return this.getParty(partyId);
  }

  /**
   * Decline a party invitation
   * @param {string} avatarId - The avatar declining the invite
   * @param {string} partyId - The party invitation to decline
   */
  async declineInvite(avatarId, partyId) {
    const inviteCol = await this.inviteCollection();
    const result = await inviteCol.updateOne(
      { 
        partyId: new ObjectId(partyId), 
        avatarId: new ObjectId(avatarId),
        status: 'pending'
      },
      { $set: { status: 'declined', respondedAt: new Date() } }
    );

    if (result.matchedCount === 0) throw new Error('No pending invite found');
    
    this.logger?.info?.(`[PartyService] ${avatarId} declined invite for party ${partyId}`);
  }

  /**
   * Get all pending invites for an avatar
   * @param {string} avatarId - The avatar to check
   * @returns {Promise<Array>} List of pending invites
   */
  async getPendingInvites(avatarId) {
    const inviteCol = await this.inviteCollection();
    return inviteCol.find({
      avatarId: new ObjectId(avatarId),
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).toArray();
  }

  /**
   * Legacy invite method - now uses the invitation system
   * For backwards compatibility, this immediately adds if inviter is the target (self-join)
   * @deprecated Use sendInvite + acceptInvite instead
   */
  async invite(partyId, avatarId, inviterId = null) {
    // If no inviter specified or inviter is the avatar themselves, use legacy direct add
    if (!inviterId || inviterId === avatarId || String(inviterId) === String(avatarId)) {
      // Legacy behavior for backward compatibility - direct join
      const party = await this.getParty(partyId);
      if (!party) throw new Error('Party not found');
      if (party.members.length >= party.maxSize) throw new Error('Party is full');

      // Get or create character sheet (auto-generates if missing)
      const sheet = await this._getSheetForParty(avatarId);
      if (!sheet) throw new Error('No character sheet');
      if (sheet.partyId) throw new Error('Already in a party');

      if (party.members.some(m => m.avatarId.equals(new ObjectId(avatarId)))) {
        throw new Error('Already in this party');
      }

      const col = await this.collection();
      await col.updateOne(
        { _id: party._id },
        {
          $push: {
            members: {
              avatarId: new ObjectId(avatarId),
              sheetId: sheet._id,
              role: 'dps',
              joinedAt: new Date()
            }
          }
        }
      );

      await this.characterService.setParty(avatarId, partyId);
      this.logger?.info?.(`[PartyService] ${avatarId} joined party ${partyId} (direct)`);
      return;
    }

    // Use new invitation system
    await this.sendInvite(partyId, avatarId, inviterId);
  }

  async leave(avatarId) {
    const party = await this.getPartyByMember(avatarId);
    if (!party) throw new Error('Not in a party');

    const isLeader = party.leaderId.equals(new ObjectId(avatarId));
    const col = await this.collection();

    if (isLeader && party.members.length === 1) {
      // Dissolve party if leader is only member
      await col.deleteOne({ _id: party._id });
      await this.characterService.setParty(avatarId, null);
      this.logger?.info?.(`[PartyService] Party ${party._id} dissolved`);
      return { dissolved: true };
    }

    if (isLeader) {
      // Transfer leadership to next member
      const newLeader = party.members.find(m => !m.avatarId.equals(new ObjectId(avatarId)));
      await col.updateOne(
        { _id: party._id },
        {
          $set: { leaderId: newLeader.avatarId },
          $pull: { members: { avatarId: new ObjectId(avatarId) } }
        }
      );
    } else {
      await col.updateOne(
        { _id: party._id },
        { $pull: { members: { avatarId: new ObjectId(avatarId) } } }
      );
    }

    await this.characterService.setParty(avatarId, null);
    this.logger?.info?.(`[PartyService] ${avatarId} left party ${party._id}`);
    return { dissolved: false };
  }

  /**
   * Kick a member from the party (leader only)
   * @param {string} partyId - The party ID
   * @param {string} avatarId - The avatar to kick
   */
  async kickMember(partyId, avatarId) {
    const party = await this.getParty(partyId);
    if (!party) throw new Error('Party not found');

    // Verify not kicking the leader
    if (party.leaderId.equals(new ObjectId(avatarId))) {
      throw new Error('Cannot kick the party leader');
    }

    // Verify member is in party
    const isMember = party.members.some(m => m.avatarId.equals(new ObjectId(avatarId)));
    if (!isMember) {
      throw new Error('Avatar is not in this party');
    }

    const col = await this.collection();
    await col.updateOne(
      { _id: party._id },
      { $pull: { members: { avatarId: new ObjectId(avatarId) } } }
    );

    await this.characterService.setParty(avatarId, null);
    this.logger?.info?.(`[PartyService] ${avatarId} was kicked from party ${partyId}`);
  }

  async setRole(partyId, avatarId, role) {
    const validRoles = ['tank', 'healer', 'dps', 'support'];
    if (!validRoles.includes(role)) throw new Error('Invalid role');

    const col = await this.collection();
    await col.updateOne(
      { _id: new ObjectId(partyId), 'members.avatarId': new ObjectId(avatarId) },
      { $set: { 'members.$.role': role } }
    );
  }

  async distributeXP(partyId, totalXP) {
    const party = await this.getParty(partyId);
    if (!party) throw new Error('Party not found');

    const xpEach = Math.floor(totalXP / party.members.length);
    const results = [];

    for (const member of party.members) {
      const result = await this.characterService.awardXP(member.avatarId, xpEach);
      results.push({ avatarId: member.avatarId, ...result });
    }

    this.logger?.info?.(`[PartyService] Distributed ${totalXP} XP to ${party.members.length} members`);
    return { xpEach, results };
  }

  async addGold(partyId, amount) {
    const col = await this.collection();
    await col.updateOne(
      { _id: new ObjectId(partyId) },
      { $inc: { sharedGold: amount } }
    );
  }

  async addToInventory(partyId, itemId) {
    const col = await this.collection();
    await col.updateOne(
      { _id: new ObjectId(partyId) },
      { $push: { sharedInventory: new ObjectId(itemId) } }
    );
  }

  async removeFromInventory(partyId, itemId) {
    const col = await this.collection();
    await col.updateOne(
      { _id: new ObjectId(partyId) },
      { $pull: { sharedInventory: new ObjectId(itemId) } }
    );
  }

  async setDungeon(partyId, dungeonId) {
    const col = await this.collection();
    await col.updateOne(
      { _id: new ObjectId(partyId) },
      { $set: { dungeonId: dungeonId ? new ObjectId(dungeonId) : null } }
    );
  }

  async setCampaign(partyId, campaignId) {
    const col = await this.collection();
    await col.updateOne(
      { _id: new ObjectId(partyId) },
      { $set: { campaignId: campaignId ? new ObjectId(campaignId) : null } }
    );

    // Update all member character sheets
    const party = await this.getParty(partyId);
    for (const member of party.members) {
      await this.characterService.setCampaign(member.avatarId, campaignId);
    }
  }

  async getPartyWithAvatars(partyId) {
    const party = await this.getParty(partyId);
    if (!party) return null;

    const avatars = await Promise.all(
      party.members.map(async m => {
        const avatar = await this.avatarService.getAvatarById(m.avatarId);
        const sheet = await this.characterService.getSheet(m.avatarId);
        return { ...m, avatar, sheet };
      })
    );

    return { ...party, members: avatars };
  }

  async createLootRoll({
    partyId,
    itemId,
    channelId,
    messageId = null,
    createdBy = null,
    durationMs = 2 * 60 * 1000
  }) {
    const col = await this.lootRollCollection();
    const now = new Date();
    const rollDoc = {
      partyId: new ObjectId(partyId),
      itemId: new ObjectId(itemId),
      channelId,
      messageId,
      status: 'pending',
      choices: [],
      createdBy: createdBy ? new ObjectId(createdBy) : null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + durationMs),
      resolvedAt: null,
      winner: null
    };

    const result = await col.insertOne(rollDoc);
    return { ...rollDoc, _id: result.insertedId };
  }

  async setLootRollMessage(rollId, messageId) {
    const col = await this.lootRollCollection();
    await col.updateOne(
      { _id: new ObjectId(rollId) },
      { $set: { messageId } }
    );
  }

  async getLootRoll(rollId) {
    const col = await this.lootRollCollection();
    return col.findOne({ _id: new ObjectId(rollId) });
  }

  async submitLootChoice(rollId, avatarId, choice) {
    const normalizedChoice = String(choice || '').toLowerCase();
    if (!['need', 'greed', 'pass'].includes(normalizedChoice)) {
      throw new Error('Invalid loot choice');
    }

    const col = await this.lootRollCollection();
    const roll = await col.findOne({ _id: new ObjectId(rollId) });
    if (!roll) throw new Error('Loot roll not found');
    if (roll.status !== 'pending') return { roll, alreadyResolved: true };

    const avatarObjectId = new ObjectId(avatarId);
    const existing = (roll.choices || []).find(c => String(c.avatarId) === String(avatarObjectId));
    if (existing) {
      return { roll, alreadySubmitted: true, existing };
    }

    const rollValue = normalizedChoice === 'pass' ? null : this.diceService.rollDie(20);
    const entry = {
      avatarId: avatarObjectId,
      choice: normalizedChoice,
      roll: rollValue,
      submittedAt: new Date()
    };

    await col.updateOne(
      { _id: roll._id },
      { $push: { choices: entry } }
    );

    const updated = await col.findOne({ _id: roll._id });
    return { roll: updated, rollValue };
  }

  async resolveLootRoll(rollDoc, { resolvedBy = null } = {}) {
    const col = await this.lootRollCollection();
    const roll = typeof rollDoc === 'string' ? await this.getLootRoll(rollDoc) : rollDoc;
    if (!roll) throw new Error('Loot roll not found');
    if (roll.status === 'resolved') return roll;

    const choices = roll.choices || [];
    const needers = choices.filter(c => c.choice === 'need' && typeof c.roll === 'number');
    const greeders = choices.filter(c => c.choice === 'greed' && typeof c.roll === 'number');
    const candidates = needers.length > 0 ? needers : greeders;

    let winner = null;
    if (candidates.length > 0) {
      const maxRoll = Math.max(...candidates.map(c => c.roll));
      const top = candidates.filter(c => c.roll === maxRoll);
      winner = top.length === 1 ? top[0] : top[Math.floor(Math.random() * top.length)];
    }

    let item = null;
    if (winner && this.itemService) {
      try {
        item = await this.itemService.getItem(roll.itemId);
        if (item) {
          await this.itemService.assignItemToAvatar(winner.avatarId, item);
          await this.removeFromInventory(roll.partyId, roll.itemId);
        }
      } catch (e) {
        this.logger?.warn?.(`[PartyService] Failed to assign loot item: ${e.message}`);
      }
    }

    const update = {
      status: 'resolved',
      resolvedAt: new Date(),
      winner: winner
        ? { avatarId: winner.avatarId, roll: winner.roll, choice: winner.choice }
        : null,
      resolvedBy: resolvedBy ? new ObjectId(resolvedBy) : null
    };

    await col.updateOne({ _id: roll._id }, { $set: update });
    return { ...roll, ...update, item };
  }
}
