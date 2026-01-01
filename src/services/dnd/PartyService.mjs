/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * PartyService - Manages D&D party groups
 */

import { ObjectId } from 'mongodb';

export class PartyService {
  constructor({ databaseService, characterService, avatarService, logger }) {
    this.databaseService = databaseService;
    this.characterService = characterService;
    this.avatarService = avatarService;
    this.logger = logger;
    this._collection = null;
  }

  async collection() {
    if (!this._collection) {
      const db = await this.databaseService.getDatabase();
      this._collection = db.collection('parties');
      await this._ensureIndexes();
    }
    return this._collection;
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

  async getParty(partyId) {
    const col = await this.collection();
    return col.findOne({ _id: new ObjectId(partyId) });
  }

  async getPartyByMember(avatarId) {
    const col = await this.collection();
    return col.findOne({ 'members.avatarId': new ObjectId(avatarId) });
  }

  async createParty(leaderId, name) {
    const sheet = await this.characterService.getSheet(leaderId);
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

  async invite(partyId, avatarId) {
    const party = await this.getParty(partyId);
    if (!party) throw new Error('Party not found');
    if (party.members.length >= party.maxSize) throw new Error('Party is full');

    const sheet = await this.characterService.getSheet(avatarId);
    if (!sheet) throw new Error('No character sheet');
    if (sheet.partyId) throw new Error('Already in a party');

    // Check not already a member
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

    this.logger?.info?.(`[PartyService] ${avatarId} joined party ${partyId}`);
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
}
