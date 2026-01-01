# D&D Expansion: Dungeons

## Room Generation

```javascript
class DungeonService {
  ROOM_WEIGHTS = {
    combat: 40,    // 40% chance
    treasure: 20,
    puzzle: 15,
    rest: 10,
    shop: 5,
    empty: 10
  };

  async generateDungeon(partyLevel, difficulty, theme) {
    const roomCount = this.getRoomCount(difficulty); // 5-15
    const rooms = [];
    
    // First room always combat (entrance guards)
    rooms.push(this.createRoom('room_1', 'combat', partyLevel));
    
    // Generate middle rooms
    for (let i = 2; i < roomCount; i++) {
      const type = this.weightedRandom(this.ROOM_WEIGHTS);
      rooms.push(this.createRoom(`room_${i}`, type, partyLevel));
    }
    
    // Last room always boss
    rooms.push(this.createRoom(`room_${roomCount}`, 'boss', partyLevel));
    
    // Generate connections (simple linear + some branches)
    this.connectRooms(rooms);
    
    return {
      name: await this.generateName(theme),
      theme,
      difficulty,
      partyLevel,
      rooms,
      currentRoom: 'room_1',
      status: 'active',
      createdAt: new Date()
    };
  }

  createRoom(id, type, partyLevel) {
    return {
      id,
      type,
      threadId: null,
      cleared: false,
      connections: [],
      encounter: type === 'combat' || type === 'boss' 
        ? this.generateEncounter(type, partyLevel)
        : type === 'treasure'
        ? this.generateTreasure(partyLevel)
        : null
    };
  }
}
```

## Monster Scaling

| Party Level | Easy CR | Medium CR | Hard CR | Boss CR |
|-------------|---------|-----------|---------|---------|
| 1-2 | 1/8 | 1/4 | 1/2 | 1 |
| 3-4 | 1/4 | 1/2 | 1 | 2 |
| 5-6 | 1/2 | 1 | 2 | 4 |
| 7-8 | 1 | 2 | 3 | 5 |

## Encounter Budget

```javascript
// XP budget per encounter
const ENCOUNTER_XP = {
  easy: level => level * 25,
  medium: level => level * 50,
  hard: level => level * 75,
  deadly: level => level * 100
};

// Spend budget on monsters
generateEncounter(type, partyLevel) {
  const budget = type === 'boss' 
    ? ENCOUNTER_XP.deadly(partyLevel) * 4  // Party of 4
    : ENCOUNTER_XP.medium(partyLevel) * 4;
  
  return this.selectMonsters(budget, partyLevel);
}
```

## Discord Thread Flow

```javascript
async enterRoom(dungeonId, roomId) {
  const dungeon = await this.getDungeon(dungeonId);
  const room = dungeon.rooms.find(r => r.id === roomId);
  const party = await this.partyService.getParty(dungeon.partyId);
  
  // Create Discord thread for room
  const thread = await this.discordService.createThread(
    party.channelId,
    `🚪 ${dungeon.name} - ${this.getRoomEmoji(room.type)} Room ${room.id.split('_')[1]}`
  );
  
  // Update room with thread ID
  await this.updateRoom(dungeonId, roomId, { threadId: thread.id });
  
  // Post room description
  const description = await this.dmService.describeRoom(room, dungeon.theme);
  await this.discordService.sendToThread(thread.id, description);
  
  // If combat, start encounter
  if (room.type === 'combat' || room.type === 'boss') {
    await this.startRoomCombat(dungeon, room, party, thread.id);
  }
  
  // If treasure, show loot
  if (room.type === 'treasure') {
    await this.revealTreasure(room, thread.id);
  }
}

async startRoomCombat(dungeon, room, party, threadId) {
  // Get party member avatars
  const avatars = await Promise.all(
    party.members.map(m => this.avatarService.getAvatar(m.avatarId))
  );
  
  // Get monsters from encounter
  const monsters = room.encounter.monsters.map(m => ({
    ...this.monsterService.getMonster(m.id),
    count: m.count
  }));
  
  // Start combat encounter
  await this.combatEncounterService.startEncounter(threadId, avatars, {
    monsters,
    dungeonId: dungeon._id,
    roomId: room.id
  });
}
```

## Room Completion

```javascript
async clearRoom(dungeonId, roomId) {
  const dungeon = await this.getDungeon(dungeonId);
  const room = dungeon.rooms.find(r => r.id === roomId);
  
  // Mark cleared
  await this.updateRoom(dungeonId, roomId, { cleared: true });
  
  // Award XP
  if (room.encounter?.xpValue) {
    const party = await this.partyService.getParty(dungeon.partyId);
    const xpEach = Math.floor(room.encounter.xpValue / party.members.length);
    
    for (const member of party.members) {
      await this.characterService.awardXP(member.avatarId, xpEach);
    }
  }
  
  // Reveal connections
  const exits = room.connections.map(c => {
    const nextRoom = dungeon.rooms.find(r => r.id === c);
    return { id: c, type: nextRoom.type, emoji: this.getRoomEmoji(nextRoom.type) };
  });
  
  // Post exit options
  await this.postExitOptions(room.threadId, exits);
}
```

## Core Monsters (Phase 1 - 20)

| Monster | CR | HP | AC | Attack |
|---------|-----|-----|-----|--------|
| Goblin | 1/4 | 7 | 15 | +4, 1d6+2 |
| Skeleton | 1/4 | 13 | 13 | +4, 1d6+2 |
| Zombie | 1/4 | 22 | 8 | +3, 1d6+1 |
| Wolf | 1/4 | 11 | 13 | +4, 2d4+2 |
| Orc | 1/2 | 15 | 13 | +5, 1d12+3 |
| Giant Spider | 1 | 26 | 14 | +5, 1d8+3 + poison |
| Bugbear | 1 | 27 | 16 | +4, 2d8+2 |
| Ogre | 2 | 59 | 11 | +6, 2d8+4 |
| Minotaur | 3 | 76 | 14 | +6, 2d12+4 |
| Troll | 5 | 84 | 15 | +7, 2d6+4 + regen |
