/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * SpellService - Handles spell casting and resolution
 */

import { SPELLS, getCantripDamage } from '../../data/dnd/spells.mjs';
import { DiceService } from '../battle/diceService.mjs';

export class SpellService {
  constructor({ characterService, avatarService, statusEffectService, logger }) {
    this.characterService = characterService;
    this.avatarService = avatarService;
    this.statusEffectService = statusEffectService;
    this.diceService = new DiceService();
    this.logger = logger;
  }

  getSpell(spellId) {
    return SPELLS[spellId] || null;
  }

  async castSpell(casterId, spellId, slotLevel, targetIds, _context = {}) {
    const sheet = await this.characterService.getSheet(casterId);
    if (!sheet) throw new Error('No character sheet found');

    const spell = this.getSpell(spellId);
    if (!spell) throw new Error(`Unknown spell: ${spellId}`);

    // Validate caster can use this spell
    if (!sheet.spellcasting) throw new Error('Not a spellcaster');

    const isCantrip = spell.level === 0;
    const knownSpells = [...(sheet.spellcasting.cantrips || []), ...(sheet.spellcasting.known || [])];
    
    if (!knownSpells.includes(spellId)) {
      throw new Error('Spell not known');
    }

    // Consume spell slot if not cantrip
    if (!isCantrip) {
      if (!slotLevel || slotLevel < spell.level) {
        throw new Error(`Requires at least a level ${spell.level} slot`);
      }
      await this.characterService.consumeSpellSlot(casterId, slotLevel);
    }

    // Calculate spell stats
    const caster = await this.avatarService.getAvatarById(casterId);
    const spellAbility = sheet.spellcasting.ability;
    const abilityMod = Math.floor(((caster.stats?.[spellAbility] || 10) - 10) / 2);
    const spellAttack = abilityMod + sheet.proficiencyBonus;
    const spellDC = 8 + abilityMod + sheet.proficiencyBonus;

    // Resolve spell effects
    const results = await this._resolveSpell(spell, slotLevel || 0, targetIds, {
      spellAttack,
      spellDC,
      abilityMod,
      casterLevel: sheet.level,
      casterId
    });

    this.logger?.info?.(`[SpellService] ${caster.name} cast ${spell.name}`);
    return { spell, slotLevel, results };
  }

  async _resolveSpell(spell, slotLevel, targetIds, stats) {
    const results = [];
    const upcastLevels = Math.max(0, slotLevel - spell.level);

    for (const targetId of targetIds) {
      const target = await this.avatarService.getAvatarById(targetId);
      if (!target) continue;

      const result = { targetId, targetName: target.name };

      // Attack roll spells
      if (spell.attack) {
        const roll = this.diceService.rollDie(20);
        const total = roll + stats.spellAttack;
        const targetAC = 10 + Math.floor(((target.stats?.dexterity || 10) - 10) / 2);
        
        result.attackRoll = roll;
        result.total = total;
        result.targetAC = targetAC;
        result.hit = total >= targetAC;
        result.critical = roll === 20;

        if (result.hit && spell.damage) {
          result.damage = this._rollDamage(spell, upcastLevels, result.critical, stats.casterLevel);
          result.damageType = spell.damage.type;
        }
      }

      // Auto-hit spells (magic missile)
      if (spell.autoHit && spell.damage) {
        result.hit = true;
        result.damage = this._rollDamage(spell, upcastLevels, false, stats.casterLevel);
        result.damageType = spell.damage.type;
      }

      // Save spells
      if (spell.save) {
        const saveMod = Math.floor(((target.stats?.[spell.save] || 10) - 10) / 2);
        const saveRoll = this.diceService.rollDie(20) + saveMod;
        
        result.saveRoll = saveRoll;
        result.saveDC = stats.spellDC;
        result.saved = saveRoll >= stats.spellDC;

        if (spell.damage) {
          let damage = this._rollDamage(spell, upcastLevels, false, stats.casterLevel);
          if (result.saved) damage = Math.floor(damage / 2);
          result.damage = damage;
          result.damageType = spell.damage.type;
        }

        if (spell.effect && !result.saved) {
          result.effectApplied = spell.effect;
        }
      }

      // Healing spells
      if (spell.healing) {
        result.healing = this._rollHealing(spell, upcastLevels, stats.abilityMod);
      }

      // Buff effects
      if (spell.effect && typeof spell.effect === 'string' && !spell.save) {
        result.effectApplied = spell.effect;
      }

      results.push(result);
    }

    return results;
  }

  _rollDamage(spell, upcastLevels, critical, casterLevel) {
    const damage = spell.damage;
    let count = damage.count;
    let dice = damage.dice;

    // Cantrip scaling
    if (damage.cantripScaling) {
      count = getCantripDamage(casterLevel);
    }

    // Upcast damage
    if (upcastLevels > 0 && spell.upcast?.extraDice) {
      count += upcastLevels * spell.upcast.extraDice;
    }

    // Critical doubles dice
    if (critical) count *= 2;

    let total = 0;
    for (let i = 0; i < count; i++) {
      total += this.diceService.rollDie(dice);
    }

    // Add modifier if specified
    if (damage.modifier) total += damage.modifier;

    return total;
  }

  _rollHealing(spell, upcastLevels, abilityMod) {
    const healing = spell.healing;
    let count = healing.count;

    if (upcastLevels > 0 && spell.upcast?.extraDice) {
      count += upcastLevels * spell.upcast.extraDice;
    }

    let total = 0;
    for (let i = 0; i < count; i++) {
      total += this.diceService.rollDie(healing.dice);
    }

    if (healing.addMod) total += abilityMod;

    return Math.max(1, total);
  }

  getSpellsForClass(className, maxLevel = 9) {
    return Object.entries(SPELLS)
      .filter(([, spell]) => spell.classes.includes(className) && spell.level <= maxLevel)
      .map(([id, spell]) => ({ id, ...spell }));
  }

  getCantripsForClass(className) {
    return this.getSpellsForClass(className, 0);
  }
}
