# D&D Expansion: Parties & Campaigns

## PartyService

```javascript
class PartyService {
  async createParty(leaderId, name) {
    const sheet = await this.characterService.getSheet(leaderId);
    
    const party = {
      name,
      leaderId: toObjectId(leaderId),
      members: [{
        avatarId: toObjectId(leaderId),
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
    
    const result = await this.collection().insertOne(party);
    await this.characterService.setParty(leaderId, result.insertedId);
    
    return party;
  }

  async invite(partyId, avatarId) {
    const party = await this.getParty(partyId);
    if (party.members.length >= party.maxSize) {
      throw new Error('Party is full');
    }
    
    const sheet = await this.characterService.getSheet(avatarId);
    if (!sheet) throw new Error('No character sheet');
    if (sheet.partyId) throw new Error('Already in a party');
    
    await this.collection().updateOne(
      { _id: partyId },
      { $push: { members: { avatarId: toObjectId(avatarId), sheetId: sheet._id, role: 'dps', joinedAt: new Date() } } }
    );
    
    await this.characterService.setParty(avatarId, partyId);
  }

  async setRole(partyId, avatarId, role) {
    await this.collection().updateOne(
      { _id: partyId, 'members.avatarId': toObjectId(avatarId) },
      { $set: { 'members.$.role': role } }
    );
  }

  async distributeXP(partyId, totalXP) {
    const party = await this.getParty(partyId);
    const xpEach = Math.floor(totalXP / party.members.length);
    
    for (const member of party.members) {
      await this.characterService.awardXP(member.avatarId, xpEach);
    }
    
    return { xpEach, memberCount: party.members.length };
  }
}
```

## Loot Distribution

```javascript
async distributeLoot(partyId, itemId) {
  const party = await this.getParty(partyId);
  const item = await this.itemService.getItem(itemId);
  
  // Send loot roll message
  const message = await this.postLootRoll(party.channelId, item);
  
  // Wait for reactions (30 seconds)
  const rolls = await this.collectLootRolls(message, party.members, 30000);
  
  // Determine winner
  // Need > Greed > Pass
  // Within same tier, highest roll wins
  const needRolls = rolls.filter(r => r.type === 'need').sort((a, b) => b.roll - a.roll);
  const greedRolls = rolls.filter(r => r.type === 'greed').sort((a, b) => b.roll - a.roll);
  
  const winner = needRolls[0] || greedRolls[0];
  
  if (winner) {
    await this.itemService.transferItem(itemId, winner.avatarId);
    await this.announceLootWinner(party.channelId, item, winner);
  } else {
    // All passed - add to shared inventory
    await this.addToSharedInventory(partyId, itemId);
  }
}
```

## CampaignService

```javascript
class CampaignService {
  async createCampaign(partyId, name, chapters) {
    const campaign = {
      name,
      chapters: chapters.map((ch, i) => ({
        id: i + 1,
        name: ch,
        status: i === 0 ? 'active' : 'locked',
        completedAt: null
      })),
      currentChapter: 1,
      worldState: {
        npcsAlive: [],
        npcsKilled: [],
        locationsDiscovered: [],
        majorDecisions: []
      },
      partyId: toObjectId(partyId),
      lastPlayedAt: new Date(),
      createdAt: new Date()
    };
    
    const result = await this.collection().insertOne(campaign);
    await this.partyService.setCampaign(partyId, result.insertedId);
    
    return campaign;
  }

  async recordDecision(campaignId, decision, impact) {
    await this.collection().updateOne(
      { _id: campaignId },
      { 
        $push: { 
          'worldState.majorDecisions': { 
            decision, 
            chapter: (await this.getCampaign(campaignId)).currentChapter,
            impact 
          } 
        },
        $set: { lastPlayedAt: new Date() }
      }
    );
  }

  async completeChapter(campaignId) {
    const campaign = await this.getCampaign(campaignId);
    const current = campaign.currentChapter;
    const next = current + 1;
    
    await this.collection().updateOne(
      { _id: campaignId },
      {
        $set: {
          [`chapters.${current - 1}.status`]: 'completed',
          [`chapters.${current - 1}.completedAt`]: new Date(),
          [`chapters.${next - 1}.status`]: 'active',
          currentChapter: next,
          lastPlayedAt: new Date()
        }
      }
    );
  }

  async getSessionSummary(campaignId) {
    const campaign = await this.getCampaign(campaignId);
    const party = await this.partyService.getParty(campaign.partyId);
    
    // Get XP gained this session, loot, etc.
    // Generate AI summary
    return this.dmService.generateSessionSummary(campaign, party);
  }
}
```

## Discord Commands

| Command | Action |
|---------|--------|
| `/party create <name>` | Create party |
| `/party invite @user` | Invite avatar |
| `/party leave` | Leave party |
| `/party list` | Show members |
| `/party role <@user> <role>` | Set role |
| `/campaign start <name>` | Start campaign |
| `/campaign status` | Show progress |
| `/session end` | End session, get summary |
