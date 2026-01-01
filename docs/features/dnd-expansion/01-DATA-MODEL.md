# D&D Expansion: Data Model

## Collections Overview

```
avatars (existing)          character_sheets (new)
┌──────────────┐            ┌──────────────────┐
│ _id          │───────────▶│ avatarId         │
│ name         │            │ class, race      │
│ stats {}     │            │ level, xp        │
│ imageUrl     │            │ spellSlots {}    │
└──────────────┘            │ partyId ─────────┼──┐
                            └──────────────────┘  │
                                                  │
parties (new)               dungeons (new)        │
┌──────────────┐            ┌──────────────────┐  │
│ _id          │◀───────────┼─ partyId         │◀─┘
│ members []   │            │ rooms []         │
│ leaderId     │            │ currentRoom      │
│ campaignId ──┼──┐         │ status           │
└──────────────┘  │         └──────────────────┘
                  │
campaigns (new)   │
┌──────────────┐  │
│ _id          │◀─┘
│ chapters []  │
│ worldState   │
└──────────────┘
```

## Schema: character_sheets

```javascript
{
  _id: ObjectId,
  avatarId: ObjectId,        // FK to avatars
  
  // Identity
  class: string,             // 'fighter', 'wizard', etc.
  subclass: string | null,   // Unlocked at level 3
  race: string,              // 'elf', 'dwarf', etc.
  subrace: string | null,
  background: string,
  
  // Progression
  level: Number,             // 1-20
  experience: Number,
  proficiencyBonus: Number,  // Derived from level
  
  // Resources
  hitDice: {
    current: Number,
    max: Number,             // = level
    size: Number             // 6, 8, 10, or 12
  },
  
  // Spellcasting (null for non-casters)
  spellcasting: {
    ability: string,         // 'intelligence', 'wisdom', 'charisma'
    slots: {
      1: { current: Number, max: Number },
      2: { current: Number, max: Number },
      // ... up to 9
    },
    known: [string],         // Spell IDs
    cantrips: [string],
    prepared: [string] | null  // For prepared casters
  } | null,
  
  // Features with limited uses
  features: [{
    id: string,
    uses: { current: Number, max: Number } | null,
    recharge: 'short_rest' | 'long_rest' | null
  }],
  
  // Proficiencies (computed from class/race, cached)
  proficiencies: {
    armor: [string],
    weapons: [string],
    skills: [string],
    saves: [string]
  },
  
  // Links
  partyId: ObjectId | null,
  campaignId: ObjectId | null,
  
  // Meta
  createdAt: Date,
  updatedAt: Date
}

// Indexes
{ avatarId: 1 }              // unique
{ class: 1, level: -1 }
{ partyId: 1 }
{ campaignId: 1 }
```

## Schema: parties

```javascript
{
  _id: ObjectId,
  name: string,
  leaderId: ObjectId,        // Avatar ID
  
  members: [{
    avatarId: ObjectId,
    sheetId: ObjectId,       // character_sheets ref
    role: 'tank' | 'healer' | 'dps' | 'support',
    joinedAt: Date
  }],
  
  maxSize: Number,           // Default 4
  sharedGold: Number,
  sharedInventory: [ObjectId],  // Item IDs
  
  // Active content
  dungeonId: ObjectId | null,
  campaignId: ObjectId | null,
  
  createdAt: Date
}

// Indexes
{ leaderId: 1 }
{ 'members.avatarId': 1 }
{ campaignId: 1 }
```

## Schema: dungeons

```javascript
{
  _id: ObjectId,
  name: string,
  theme: string,             // 'crypt', 'cave', 'castle'
  difficulty: 'easy' | 'medium' | 'hard' | 'deadly',
  partyLevel: Number,
  
  rooms: [{
    id: string,
    type: 'combat' | 'treasure' | 'puzzle' | 'boss' | 'rest' | 'shop',
    threadId: string | null, // Discord thread
    cleared: Boolean,
    connections: [string],   // Room IDs
    encounter: Object | null // Monster/loot data
  }],
  
  currentRoom: string,
  partyId: ObjectId,
  status: 'active' | 'completed' | 'abandoned',
  
  createdAt: Date,
  completedAt: Date | null
}

// Indexes
{ partyId: 1 }
{ status: 1, createdAt: -1 }
```

## Schema: campaigns

```javascript
{
  _id: ObjectId,
  name: string,
  
  chapters: [{
    id: Number,
    name: string,
    status: 'locked' | 'active' | 'completed',
    completedAt: Date | null
  }],
  
  currentChapter: Number,
  
  worldState: {
    npcsAlive: [string],
    npcsKilled: [string],
    locationsDiscovered: [string],
    majorDecisions: [{
      decision: string,
      chapter: Number,
      impact: string
    }]
  },
  
  partyId: ObjectId,
  lastPlayedAt: Date,
  createdAt: Date
}

// Indexes
{ partyId: 1 }
{ lastPlayedAt: -1 }
```

## Static Data: spells (seed collection)

```javascript
{
  _id: 'fire_bolt',          // String ID for easy reference
  name: 'Fire Bolt',
  level: 0,
  school: 'evocation',
  classes: ['wizard', 'sorcerer'],
  
  castingTime: 'action',
  range: 120,
  duration: 'instant',
  
  attack: 'ranged_spell',    // or null
  save: null,                // or 'dexterity'
  
  damage: {
    dice: 10,
    count: 1,
    type: 'fire',
    scaling: { 5: 2, 11: 3, 17: 4 }  // Cantrip scaling
  } | null,
  
  healing: null,             // or { dice, count, modifier }
  effect: null,              // or status effect ID
  
  description: 'Hurl a mote of fire'
}
```

## Static Data: monsters (seed collection)

```javascript
{
  _id: 'skeleton',
  name: 'Skeleton',
  cr: 0.25,
  xp: 50,
  
  stats: {
    hp: 13,
    ac: 13,
    speed: 30,
    str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5
  },
  
  attacks: [{
    name: 'Shortsword',
    bonus: 4,
    damage: { dice: 6, count: 1, modifier: 2, type: 'piercing' }
  }],
  
  abilities: [],
  immunities: ['poison'],
  resistances: [],
  vulnerabilities: ['bludgeoning']
}
```

## Query Examples

```javascript
// Get character sheet for avatar
db.character_sheets.findOne({ avatarId: ObjectId('...') })

// Find all wizards level 5+
db.character_sheets.find({ class: 'wizard', level: { $gte: 5 } })

// Get party with member details
db.parties.aggregate([
  { $match: { _id: partyId } },
  { $lookup: { from: 'avatars', localField: 'members.avatarId', foreignField: '_id', as: 'avatarDetails' } }
])

// Active dungeons for a party
db.dungeons.find({ partyId, status: 'active' })
```
