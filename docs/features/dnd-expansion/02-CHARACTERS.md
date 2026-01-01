# D&D Expansion: Characters

## Simplified Class List

| Class | Hit Die | Primary | Spellcasting |
|-------|---------|---------|--------------|
| Fighter | d10 | STR/DEX | None (EK: 1/3) |
| Wizard | d6 | INT | Full |
| Rogue | d8 | DEX | None (AT: 1/3) |
| Cleric | d8 | WIS | Full |
| Ranger | d10 | DEX/WIS | Half |
| Bard | d8 | CHA | Full |

**Phase 1**: 6 classes. Add Paladin, Warlock, Barbarian, Monk, Druid, Sorcerer in Phase 2.

## Simplified Race List

| Race | Stat Bonus | Key Trait |
|------|------------|-----------|
| Human | +1 all | Versatile |
| Elf | +2 DEX | Darkvision, Trance |
| Dwarf | +2 CON | Poison resistance |
| Halfling | +2 DEX | Lucky (reroll 1s) |

**Phase 1**: 4 races. Add Dragonborn, Tiefling, Half-Orc, Gnome later.

## CharacterService

```javascript
class CharacterService {
  constructor({ databaseService, avatarService, logger }) {
    this.db = databaseService;
    this.avatarService = avatarService;
    this.sheets = null; // Lazy collection ref
  }

  async getSheet(avatarId) {
    return this.collection().findOne({ avatarId: toObjectId(avatarId) });
  }

  async createCharacter(avatarId, { className, race, background }) {
    const avatar = await this.avatarService.getAvatar(avatarId);
    const classDef = CLASS_DATA[className];
    const raceDef = RACE_DATA[race];
    
    // Apply racial bonuses to avatar stats
    const newStats = this.applyRacialBonuses(avatar.stats, raceDef);
    await this.avatarService.updateStats(avatarId, newStats);
    
    // Create character sheet
    const sheet = {
      avatarId: toObjectId(avatarId),
      class: className,
      subclass: null,
      race,
      subrace: null,
      background,
      level: 1,
      experience: 0,
      proficiencyBonus: 2,
      hitDice: { current: 1, max: 1, size: classDef.hitDice },
      spellcasting: classDef.spellcasting ? this.initSpellcasting(classDef) : null,
      features: this.getClassFeatures(className, 1),
      proficiencies: this.buildProficiencies(classDef, raceDef),
      partyId: null,
      campaignId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await this.collection().insertOne(sheet);
    return sheet;
  }

  async awardXP(avatarId, amount) {
    const sheet = await this.getSheet(avatarId);
    const newXP = sheet.experience + amount;
    const newLevel = this.calculateLevel(newXP);
    
    if (newLevel > sheet.level) {
      await this.levelUp(sheet, newLevel);
    }
    
    await this.collection().updateOne(
      { avatarId: toObjectId(avatarId) },
      { $set: { experience: newXP, updatedAt: new Date() } }
    );
    
    return { newXP, leveledUp: newLevel > sheet.level, newLevel };
  }

  async levelUp(sheet, newLevel) {
    const classDef = CLASS_DATA[sheet.class];
    const newFeatures = this.getClassFeatures(sheet.class, newLevel);
    const newSlots = sheet.spellcasting 
      ? this.getSpellSlots(sheet.class, newLevel) 
      : null;
    
    await this.collection().updateOne(
      { _id: sheet._id },
      { 
        $set: { 
          level: newLevel,
          proficiencyBonus: PROF_BY_LEVEL[newLevel],
          'hitDice.max': newLevel,
          ...(newSlots && { 'spellcasting.slots': newSlots })
        },
        $push: { features: { $each: newFeatures } }
      }
    );
    
    // Increase max HP on avatar
    const hpGain = Math.floor(classDef.hitDice / 2) + 1;
    await this.avatarService.incrementMaxHP(sheet.avatarId, hpGain);
  }

  async rest(avatarId, type) {
    const sheet = await this.getSheet(avatarId);
    const updates = {};
    
    if (type === 'short') {
      // Restore short-rest features
      updates['features.$[f].uses.current'] = { $set: '$features.$[f].uses.max' };
    }
    
    if (type === 'long') {
      // Restore all features + spell slots + hit dice
      updates['hitDice.current'] = sheet.hitDice.max;
      if (sheet.spellcasting) {
        for (const [lvl, slot] of Object.entries(sheet.spellcasting.slots)) {
          updates[`spellcasting.slots.${lvl}.current`] = slot.max;
        }
      }
      // Restore all features
      for (let i = 0; i < sheet.features.length; i++) {
        if (sheet.features[i].uses) {
          updates[`features.${i}.uses.current`] = sheet.features[i].uses.max;
        }
      }
    }
    
    await this.collection().updateOne({ _id: sheet._id }, { $set: updates });
  }
}
```

## XP Thresholds

```javascript
const XP_LEVELS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000
];

const PROF_BY_LEVEL = [
  2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6
];
```

## Discord Creation Flow

```
/character create

→ Select Race [Human] [Elf] [Dwarf] [Halfling]
→ Select Class [Fighter] [Wizard] [Rogue] [Cleric] [Ranger] [Bard]
→ Select Background [Soldier] [Sage] [Criminal] [Acolyte]

✅ Created Level 1 Elf Wizard!
```
