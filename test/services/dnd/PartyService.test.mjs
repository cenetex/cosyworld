/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file test/services/dnd/PartyService.test.mjs
 * @description Comprehensive tests for PartyService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PartyService } from '../../../src/services/dnd/PartyService.mjs';
import { ObjectId } from 'mongodb';

/**
 * Create mock dependencies for PartyService
 */
const createMockDeps = () => {
  const mockCollection = {
    findOne: vi.fn(),
    insertOne: vi.fn(),
    updateOne: vi.fn(),
    deleteOne: vi.fn(),
    createIndex: vi.fn().mockResolvedValue(true),
  };

  const mockDb = {
    collection: vi.fn().mockReturnValue(mockCollection),
  };

  return {
    databaseService: {
      getDatabase: vi.fn().mockResolvedValue(mockDb),
    },
    characterService: {
      getSheet: vi.fn(),
      setParty: vi.fn().mockResolvedValue(true),
      awardXP: vi.fn().mockResolvedValue({ newXP: 100, leveledUp: false }),
    },
    avatarService: {
      getAvatarById: vi.fn().mockResolvedValue({
        _id: new ObjectId('507f1f77bcf86cd799439011'),
        name: 'TestAvatar',
      }),
    },
    itemService: {
      assignItemToAvatar: vi.fn().mockResolvedValue(true),
      getItem: vi.fn()
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    mockCollection,
    mockDb,
  };
};

const createMockSheet = (avatarId, partyId = null) => ({
  _id: new ObjectId(),
  avatarId: new ObjectId(avatarId),
  class: 'fighter',
  level: 3,
  partyId: partyId ? new ObjectId(partyId) : null,
});

const createMockParty = (leaderId, members = [], overrides = {}) => ({
  _id: new ObjectId(),
  name: 'Test Party',
  leaderId: new ObjectId(leaderId),
  members: [
    {
      avatarId: new ObjectId(leaderId),
      sheetId: new ObjectId(),
      role: 'tank',
      joinedAt: new Date(),
    },
    ...members.map((m) => ({
      avatarId: new ObjectId(m.avatarId),
      sheetId: new ObjectId(),
      role: m.role || 'dps',
      joinedAt: new Date(),
    })),
  ],
  maxSize: 4,
  sharedGold: 0,
  sharedInventory: [],
  dungeonId: null,
  campaignId: null,
  createdAt: new Date(),
  ...overrides,
});

describe('PartyService', () => {
  let service;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new PartyService(deps);
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(service.databaseService).toBe(deps.databaseService);
      expect(service.characterService).toBe(deps.characterService);
      expect(service.avatarService).toBe(deps.avatarService);
      expect(service.logger).toBe(deps.logger);
    });
  });

  describe('collection()', () => {
    it('should create collection and indexes on first access', async () => {
      await service.collection();

      expect(deps.databaseService.getDatabase).toHaveBeenCalled();
      expect(deps.mockDb.collection).toHaveBeenCalledWith('parties');
      expect(deps.mockCollection.createIndex).toHaveBeenCalled();
    });

    it('should cache collection after first access', async () => {
      await service.collection();
      await service.collection();

      expect(deps.databaseService.getDatabase).toHaveBeenCalledTimes(1);
    });
  });

  describe('getParty()', () => {
    it('should find a party by partyId', async () => {
      const partyId = new ObjectId();
      const mockParty = createMockParty('507f1f77bcf86cd799439011');
      mockParty._id = partyId;
      deps.mockCollection.findOne.mockResolvedValue(mockParty);

      const result = await service.getParty(partyId.toString());

      expect(result).toEqual(mockParty);
    });

    it('should return null if party not found', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);

      const result = await service.getParty(new ObjectId().toString());

      expect(result).toBeNull();
    });
  });

  describe('getPartyByMember()', () => {
    it('should find party containing a member', async () => {
      const avatarId = '507f1f77bcf86cd799439011';
      const mockParty = createMockParty(avatarId);
      deps.mockCollection.findOne.mockResolvedValue(mockParty);

      const result = await service.getPartyByMember(avatarId);

      expect(result).toEqual(mockParty);
      expect(deps.mockCollection.findOne).toHaveBeenCalledWith({
        'members.avatarId': expect.any(ObjectId),
      });
    });
  });

  describe('createParty()', () => {
    const leaderId = '507f1f77bcf86cd799439011';

    it('should create a party with leader as first member', async () => {
      const sheet = createMockSheet(leaderId);
      deps.characterService.getSheet.mockResolvedValue(sheet);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      const party = await service.createParty(leaderId, 'Heroes Guild');

      expect(party.name).toBe('Heroes Guild');
      expect(party.leaderId.toString()).toBe(leaderId);
      expect(party.members).toHaveLength(1);
      expect(party.members[0].avatarId.toString()).toBe(leaderId);
      expect(party.maxSize).toBe(4);
    });

    it('should set party on leader character sheet', async () => {
      const sheet = createMockSheet(leaderId);
      deps.characterService.getSheet.mockResolvedValue(sheet);
      deps.mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

      await service.createParty(leaderId, 'Heroes Guild');

      expect(deps.characterService.setParty).toHaveBeenCalledWith(
        leaderId,
        expect.any(ObjectId)
      );
    });

    it('should throw if leader has no character sheet', async () => {
      deps.characterService.getSheet.mockResolvedValue(null);

      await expect(service.createParty(leaderId, 'Heroes Guild')).rejects.toThrow(
        'Leader has no character sheet'
      );
    });

    it('should throw if leader already in a party', async () => {
      const sheet = createMockSheet(leaderId, new ObjectId().toString());
      deps.characterService.getSheet.mockResolvedValue(sheet);

      await expect(service.createParty(leaderId, 'Heroes Guild')).rejects.toThrow(
        'Already in a party'
      );
    });
  });

  describe('invite()', () => {
    const partyId = new ObjectId();
    const leaderId = '507f1f77bcf86cd799439011';
    const inviteeId = '507f1f77bcf86cd799439012';

    it('should add member to party', async () => {
      const party = createMockParty(leaderId);
      party._id = partyId;
      deps.mockCollection.findOne.mockResolvedValue(party);
      deps.characterService.getSheet.mockResolvedValue(createMockSheet(inviteeId));
      deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.invite(partyId.toString(), inviteeId);

      expect(deps.mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: party._id },
        expect.objectContaining({
          $push: expect.objectContaining({
            members: expect.objectContaining({
              avatarId: expect.any(ObjectId),
              role: 'dps',
            }),
          }),
        })
      );
      expect(deps.characterService.setParty).toHaveBeenCalledWith(
        inviteeId,
        partyId.toString()
      );
    });

    it('should throw if party not found', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);

      await expect(service.invite(partyId.toString(), inviteeId)).rejects.toThrow(
        'Party not found'
      );
    });

    it('should throw if party is full', async () => {
      const party = createMockParty(
        leaderId,
        [
          { avatarId: '507f1f77bcf86cd799439013' },
          { avatarId: '507f1f77bcf86cd799439014' },
          { avatarId: '507f1f77bcf86cd799439015' },
        ],
        { maxSize: 4 }
      );
      party._id = partyId;
      deps.mockCollection.findOne.mockResolvedValue(party);

      await expect(service.invite(partyId.toString(), inviteeId)).rejects.toThrow(
        'Party is full'
      );
    });

    it('should throw if invitee has no character sheet', async () => {
      const party = createMockParty(leaderId);
      party._id = partyId;
      deps.mockCollection.findOne.mockResolvedValue(party);
      deps.characterService.getSheet.mockResolvedValue(null);

      await expect(service.invite(partyId.toString(), inviteeId)).rejects.toThrow(
        'No character sheet'
      );
    });

    it('should throw if invitee already in a party', async () => {
      const party = createMockParty(leaderId);
      party._id = partyId;
      deps.mockCollection.findOne.mockResolvedValue(party);
      deps.characterService.getSheet.mockResolvedValue(
        createMockSheet(inviteeId, new ObjectId().toString())
      );

      await expect(service.invite(partyId.toString(), inviteeId)).rejects.toThrow(
        'Already in a party'
      );
    });

    it('should throw if already in this party', async () => {
      const party = createMockParty(leaderId);
      party._id = partyId;
      // Leader tries to join their own party
      deps.mockCollection.findOne.mockResolvedValue(party);
      deps.characterService.getSheet.mockResolvedValue(createMockSheet(leaderId));

      await expect(service.invite(partyId.toString(), leaderId)).rejects.toThrow(
        'Already in this party'
      );
    });
  });

  describe('leave()', () => {
    const leaderId = '507f1f77bcf86cd799439011';
    const memberId = '507f1f77bcf86cd799439012';

    it('should remove non-leader member from party', async () => {
      const party = createMockParty(leaderId, [{ avatarId: memberId }]);
      deps.mockCollection.findOne.mockResolvedValue(party);
      deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.leave(memberId);

      expect(result.dissolved).toBe(false);
      expect(deps.mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: party._id },
        { $pull: { members: { avatarId: expect.any(ObjectId) } } }
      );
      expect(deps.characterService.setParty).toHaveBeenCalledWith(memberId, null);
    });

    it('should dissolve party if leader is only member', async () => {
      const party = createMockParty(leaderId);
      deps.mockCollection.findOne.mockResolvedValue(party);
      deps.mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await service.leave(leaderId);

      expect(result.dissolved).toBe(true);
      expect(deps.mockCollection.deleteOne).toHaveBeenCalledWith({ _id: party._id });
    });

    it('should transfer leadership when leader leaves', async () => {
      const party = createMockParty(leaderId, [{ avatarId: memberId }]);
      deps.mockCollection.findOne.mockResolvedValue(party);
      deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.leave(leaderId);

      expect(result.dissolved).toBe(false);
      expect(deps.mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: party._id },
        expect.objectContaining({
          $set: { leaderId: expect.any(ObjectId) },
          $pull: { members: { avatarId: expect.any(ObjectId) } },
        })
      );
    });

    it('should throw if not in a party', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);

      await expect(service.leave(memberId)).rejects.toThrow('Not in a party');
    });
  });

  describe('setRole()', () => {
    it('should set valid role for party member', async () => {
      const partyId = new ObjectId();
      const avatarId = '507f1f77bcf86cd799439011';
      deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.setRole(partyId.toString(), avatarId, 'healer');

      expect(deps.mockCollection.updateOne).toHaveBeenCalledWith(
        {
          _id: expect.any(ObjectId),
          'members.avatarId': expect.any(ObjectId),
        },
        { $set: { 'members.$.role': 'healer' } }
      );
    });

    it('should throw for invalid role', async () => {
      const partyId = new ObjectId();
      const avatarId = '507f1f77bcf86cd799439011';

      await expect(
        service.setRole(partyId.toString(), avatarId, 'invalidrole')
      ).rejects.toThrow('Invalid role');
    });

    it.each(['tank', 'healer', 'dps', 'support'])(
      'should accept valid role: %s',
      async (role) => {
        const partyId = new ObjectId();
        const avatarId = '507f1f77bcf86cd799439011';
        deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

        await expect(
          service.setRole(partyId.toString(), avatarId, role)
        ).resolves.not.toThrow();
      }
    );
  });

  describe('distributeXP()', () => {
    const leaderId = '507f1f77bcf86cd799439011';
    const memberId = '507f1f77bcf86cd799439012';

    it('should distribute XP evenly to all members', async () => {
      const party = createMockParty(leaderId, [{ avatarId: memberId }]);
      deps.mockCollection.findOne.mockResolvedValue(party);

      const result = await service.distributeXP(party._id.toString(), 200);

      expect(result.xpEach).toBe(100); // 200 / 2 members
      expect(result.results).toHaveLength(2);
      expect(deps.characterService.awardXP).toHaveBeenCalledTimes(2);
    });

    it('should throw if party not found', async () => {
      deps.mockCollection.findOne.mockResolvedValue(null);

      await expect(
        service.distributeXP(new ObjectId().toString(), 100)
      ).rejects.toThrow('Party not found');
    });

    it('should floor XP per member', async () => {
      const party = createMockParty(leaderId, [
        { avatarId: memberId },
        { avatarId: '507f1f77bcf86cd799439013' },
      ]);
      deps.mockCollection.findOne.mockResolvedValue(party);

      const result = await service.distributeXP(party._id.toString(), 100);

      expect(result.xpEach).toBe(33); // Math.floor(100 / 3)
    });
  });

  describe('addGold()', () => {
    it('should increment shared gold', async () => {
      const partyId = new ObjectId();
      deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.addGold(partyId.toString(), 50);

      expect(deps.mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: expect.any(ObjectId) },
        { $inc: { sharedGold: 50 } }
      );
    });
  });

  describe('addToInventory()', () => {
    it('should add item to shared inventory', async () => {
      const partyId = new ObjectId();
      const itemId = new ObjectId();
      deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.addToInventory(partyId.toString(), itemId.toString());

      expect(deps.mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: expect.any(ObjectId) },
        { $push: { sharedInventory: expect.any(ObjectId) } }
      );
    });
  });

  describe('setDungeon()', () => {
    it('should set dungeon ID on party', async () => {
      const partyId = new ObjectId();
      const dungeonId = new ObjectId();
      deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.setDungeon(partyId.toString(), dungeonId.toString());

      expect(deps.mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: expect.any(ObjectId) },
        { $set: { dungeonId: expect.any(ObjectId) } }
      );
    });

    it('should clear dungeon ID when null', async () => {
      const partyId = new ObjectId();
      deps.mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.setDungeon(partyId.toString(), null);

      expect(deps.mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: expect.any(ObjectId) },
        { $set: { dungeonId: null } }
      );
    });
  });
});
