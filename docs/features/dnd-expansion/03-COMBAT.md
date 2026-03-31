# D&D Expansion: Combat & Magic

## Simplified Combat Rules

### Action Economy (Per Turn)
- **1 Action**: Attack, Cast spell, Dash, Disengage, Hide, Help
- **1 Bonus Action**: If class feature allows
- **Movement**: Ignored (theater of mind)
- **Reaction**: Removed for simplicity

### Attack Resolution
```javascript
// Uses existing BattleService, add proficiency
attackRoll = d20 + abilityMod + proficiencyBonus (if proficient)
hit = attackRoll >= targetAC
damage = weaponDice + abilityMod
```

### Proficiency Integration
```javascript
// In BattleService.attack()
const sheet = await characterService.getSheet(attacker._id);
const profBonus = sheet?.proficiencyBonus || 0;
const isProficient = sheet?.proficiencies.weapons.includes(weaponType);
const attackBonus = strMod + (isProficient ? profBonus : 0);
```

## Spell System

### SpellService

```javascript
class SpellService {
  async castSpell(casterId, spellId, slotLevel, targetIds, context) {
    const sheet = await this.characterService.getSheet(casterId);
    const spell = await this.getSpell(spellId);
    
    // Validate
    if (!sheet.spellcasting) throw new Error('Not a spellcaster');
    if (!sheet.spellcasting.known.includes(spellId)) throw new Error('Spell not known');
    if (spell.level > 0 && sheet.spellcasting.slots[slotLevel].current < 1) {
      throw new Error('No spell slots');
    }
    
    // Consume slot
    if (spell.level > 0) {
      await this.consumeSlot(sheet._id, slotLevel);
    }
    
    // Resolve effect
    const spellMod = this.getSpellMod(sheet);
    const spellDC = 8 + spellMod + sheet.proficiencyBonus;
    const spellAttack = spellMod + sheet.proficiencyBonus;
    
    return this.resolveSpell(spell, slotLevel, targetIds, { spellDC, spellAttack, casterLevel: sheet.level });
  }

  async resolveSpell(spell, slotLevel, targetIds, stats) {
    const results = [];
    const upcast = slotLevel - spell.level;
    
    for (const targetId of targetIds) {
      const target = await this.avatarService.getAvatar(targetId);
      let result = { targetId, targetName: target.name };
      
      // Attack spells
      if (spell.attack) {
        const roll = this.diceService.rollDie(20);
        const total = roll + stats.spellAttack;
        const targetAC = 10 + Math.floor((target.stats.dexterity - 10) / 2);
        result.hit = total >= targetAC;
        result.critical = roll === 20;
        
        if (result.hit && spell.damage) {
          result.damage = this.rollDamage(spell.damage, upcast, result.critical, stats.casterLevel);
          await this.applyDamage(targetId, result.damage);
        }
      }
      
      // Save spells
      if (spell.save) {
        const saveMod = Math.floor((target.stats[spell.save] - 10) / 2);
        const saveRoll = this.diceService.rollDie(20) + saveMod;
        result.saved = saveRoll >= stats.spellDC;
        
        if (spell.damage) {
          let damage = this.rollDamage(spell.damage, upcast, false, stats.casterLevel);
          if (result.saved) damage = Math.floor(damage / 2);
          result.damage = damage;
          if (damage > 0) await this.applyDamage(targetId, damage);
        }
        
        if (spell.effect && !result.saved) {
          await this.statusEffectService.applyEffect(targetId, spell.effect);
          result.effectApplied = spell.effect;
        }
      }
      
      // Healing spells
      if (spell.healing) {
        const healing = this.rollHealing(spell.healing, upcast, stats);
        await this.applyHealing(targetId, healing);
        result.healing = healing;
      }
      
      results.push(result);
    }
    
    return results;
  }
}
```

## Core Spells (Phase 1 - 20 spells)

### Cantrips
| Spell | Class | Effect |
|-------|-------|--------|
| Fire Bolt | Wiz | 1d10 fire, attack |
| Sacred Flame | Clr | 1d8 radiant, DEX save |
| Vicious Mockery | Brd | 1d4 psychic, WIS save, disadvantage |

### Level 1
| Spell | Class | Effect |
|-------|-------|--------|
| Magic Missile | Wiz | 3d4+3 force, auto-hit |
| Shield | Wiz | +5 AC reaction (simplified to bonus action) |
| Cure Wounds | Clr | 1d8+mod healing |
| Healing Word | Clr/Brd | 1d4+mod healing, bonus action |
| Bless | Clr | +1d4 attacks/saves, 3 targets |
| Hunter's Mark | Rgr | +1d6 damage to target |

### Level 2
| Spell | Class | Effect |
|-------|-------|--------|
| Misty Step | Wiz | Teleport (flavor only in theater of mind) |
| Hold Person | Wiz/Clr | Paralyzed, WIS save |
| Spiritual Weapon | Clr | 1d8+mod bonus action attack |

### Level 3
| Spell | Class | Effect |
|-------|-------|--------|
| Fireball | Wiz | 8d6 fire, 20ft radius, DEX half |
| Counterspell | Wiz | Negate spell (removed for simplicity) |
| Mass Healing Word | Clr | 1d4+mod to 6 targets |

## Class Features (Combat-Relevant)

### Fighter
- **Second Wind** (1/short rest): Heal 1d10+level as bonus action
- **Action Surge** (1/short rest): Extra action

### Rogue  
- **Sneak Attack**: +Xd6 when advantage (X = ceil(level/2))
- **Cunning Action**: Bonus action hide

### Wizard
- **Arcane Recovery** (1/long rest): Recover spell slots

### Cleric
- **Channel Divinity** (1/short rest): Domain-specific power

### Ranger
- **Hunter's Mark**: Bonus 1d6 to marked target

### Bard
- **Bardic Inspiration** (CHA/long rest): Ally adds 1d6 to roll

## Integration with CombatEncounterService

```javascript
// Add to combat action handling
async handleCombatAction(encounter, avatarId, action) {
  const sheet = await this.characterService.getSheet(avatarId);
  
  switch (action.type) {
    case 'attack':
      return this.battleService.attack({ attacker, defender, profBonus: sheet?.proficiencyBonus });
    
    case 'spell':
      return this.spellService.castSpell(avatarId, action.spellId, action.slotLevel, action.targets, { encounter });
    
    case 'feature':
      return this.useClassFeature(sheet, action.featureId, action.targets);
  }
}
```
