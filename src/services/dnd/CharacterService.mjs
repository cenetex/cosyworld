/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * CharacterService - Manages D&D character sheets
 */

import { ObjectId } from 'mongodb';
import { CLASSES, getLevelFromXP, getProficiencyBonus } from '../../data/dnd/classes.mjs';
import { RACES, BACKGROUNDS } from '../../data/dnd/races.mjs';
import { getSpellSlots } from '../../data/dnd/spells.mjs';

export class CharacterService {
  constructor({ databaseService, avatarService, logger }) {
    this.databaseService = databaseService;
    this.avatarService = avatarService;
    this.logger = logger;
    this._collection = null;
  }

  async collection() {
    if (!this._collection) {
      const db = await this.databaseService.getDatabase();
      this._collection = db.collection('character_sheets');
      await this._ensureIndexes();
    }
    return this._collection;
  }

  async _ensureIndexes() {
    try {
      await this._collection.createIndex({ avatarId: 1 }, { unique: true });
      await this._collection.createIndex({ class: 1, level: -1 });
      await this._collection.createIndex({ partyId: 1 });
      await this._collection.createIndex({ campaignId: 1 });
    } catch (e) {
      this.logger?.warn?.('[CharacterService] Index creation:', e.message);
    }
  }

  async getSheet(avatarId) {
    const col = await this.collection();
    return col.findOne({ avatarId: new ObjectId(avatarId) });
  }

  async createCharacter(avatarId, { className, race, background }) {
    const classDef = CLASSES[className];
    const raceDef = RACES[race];
    const bgDef = BACKGROUNDS[background];

    if (!classDef) throw new Error(`Unknown class: ${className}`);
    if (!raceDef) throw new Error(`Unknown race: ${race}`);

    // Check if character already exists
    const existing = await this.getSheet(avatarId);
    if (existing) throw new Error('Character already exists for this avatar');

    // Get avatar and apply racial stat bonuses
    const avatar = await this.avatarService.getAvatarById(avatarId);
    if (!avatar) throw new Error('Avatar not found');

    const newStats = { ...avatar.stats };
    for (const [stat, bonus] of Object.entries(raceDef.statBonuses)) {
      newStats[stat] = (newStats[stat] || 10) + bonus;
    }

    // Build proficiencies
    const proficiencies = {
      armor: [...classDef.armorProficiencies],
      weapons: [...classDef.weaponProficiencies],
      saves: [...classDef.savingThrows],
      skills: bgDef?.skills || []
    };

    // Build initial features
    const features = (classDef.features[1] || []).map(f => ({
      id: f.id,
      name: f.name,
      uses: f.uses ? { current: this._resolveUses(f.uses.max, newStats), max: f.uses.max, recharge: f.uses.recharge } : null
    }));

    // Build spellcasting if applicable
    let spellcasting = null;
    if (classDef.spellcasting) {
      const slots = getSpellSlots(classDef.spellcasting.type, 1);
      spellcasting = {
        ability: classDef.spellcasting.ability,
        type: classDef.spellcasting.type,
        prepared: classDef.spellcasting.prepared,
        slots: Object.fromEntries(
          Object.entries(slots).map(([lvl, max]) => [lvl, { current: max, max }])
        ),
        known: [],
        cantrips: [],
        preparedSpells: classDef.spellcasting.prepared ? [] : null
      };
    }

    const sheet = {
      avatarId: new ObjectId(avatarId),
      class: className,
      subclass: null,
      race,
      subrace: null,
      background,
      level: 1,
      experience: 0,
      proficiencyBonus: 2,
      hitDice: { current: 1, max: 1, size: classDef.hitDice },
      spellcasting,
      features,
      proficiencies,
      partyId: null,
      campaignId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const col = await this.collection();
    await col.insertOne(sheet);

    // Update avatar stats with racial bonuses
    await this.avatarService.updateAvatar(avatarId, { stats: newStats });

    this.logger?.info?.(`[CharacterService] Created ${race} ${className} for avatar ${avatarId}`);
    return sheet;
  }

  _resolveUses(max, stats) {
    if (typeof max === 'number') return max;
    if (typeof max === 'string' && stats[max]) {
      return Math.max(1, Math.floor((stats[max] - 10) / 2));
    }
    return 1;
  }

  async awardXP(avatarId, amount) {
    const sheet = await this.getSheet(avatarId);
    if (!sheet) throw new Error('No character sheet found');

    const newXP = sheet.experience + amount;
    const oldLevel = sheet.level;
    const newLevel = getLevelFromXP(newXP);

    const col = await this.collection();
    await col.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { $set: { experience: newXP, updatedAt: new Date() } }
    );

    if (newLevel > oldLevel) {
      await this._levelUp(sheet, newLevel);
      return { newXP, leveledUp: true, oldLevel, newLevel };
    }

    return { newXP, leveledUp: false, level: oldLevel };
  }

  async _levelUp(sheet, newLevel) {
    const classDef = CLASSES[sheet.class];
    const avatar = await this.avatarService.getAvatarById(sheet.avatarId);

    // Gather new features
    const newFeatures = [];
    for (let lvl = sheet.level + 1; lvl <= newLevel; lvl++) {
      const lvlFeatures = classDef.features[lvl] || [];
      for (const f of lvlFeatures) {
        newFeatures.push({
          id: f.id,
          name: f.name,
          uses: f.uses ? { current: this._resolveUses(f.uses.max, avatar.stats), max: f.uses.max, recharge: f.uses.recharge } : null
        });
      }
    }

    // Update spell slots if spellcaster
    let newSlots = null;
    if (sheet.spellcasting) {
      const slots = getSpellSlots(sheet.spellcasting.type, newLevel);
      newSlots = Object.fromEntries(
        Object.entries(slots).map(([lvl, max]) => [lvl, { current: max, max }])
      );
    }

    // Calculate HP gain
    const hpGain = (newLevel - sheet.level) * (Math.floor(classDef.hitDice / 2) + 1);
    const conMod = Math.floor(((avatar.stats?.constitution || 10) - 10) / 2);
    const totalHpGain = hpGain + conMod * (newLevel - sheet.level);

    const updates = {
      level: newLevel,
      proficiencyBonus: getProficiencyBonus(newLevel),
      'hitDice.max': newLevel,
      updatedAt: new Date()
    };

    if (newSlots) {
      updates['spellcasting.slots'] = newSlots;
    }

    const col = await this.collection();
    await col.updateOne(
      { _id: sheet._id },
      {
        $set: updates,
        $push: { features: { $each: newFeatures } }
      }
    );

    // Increase avatar max HP
    const newMaxHP = (avatar.stats?.hp || 10) + totalHpGain;
    await this.avatarService.updateAvatar(sheet.avatarId, {
      'stats.hp': newMaxHP
    });

    this.logger?.info?.(`[CharacterService] ${sheet.class} leveled up to ${newLevel}`);
  }

  async rest(avatarId, type) {
    const sheet = await this.getSheet(avatarId);
    if (!sheet) throw new Error('No character sheet found');

    const updates = { updatedAt: new Date() };

    if (type === 'long') {
      // Restore all spell slots
      if (sheet.spellcasting?.slots) {
        for (const [lvl, slot] of Object.entries(sheet.spellcasting.slots)) {
          updates[`spellcasting.slots.${lvl}.current`] = slot.max;
        }
      }
      // Restore hit dice (half, minimum 1)
      updates['hitDice.current'] = Math.max(1, Math.floor(sheet.hitDice.max / 2));
    }

    // Restore features based on recharge type
    const rechargeType = type === 'short' ? 'short_rest' : null;
    for (let i = 0; i < sheet.features.length; i++) {
      const f = sheet.features[i];
      if (f.uses && (type === 'long' || f.uses.recharge === rechargeType)) {
        const maxUses = typeof f.uses.max === 'number' ? f.uses.max : 1;
        updates[`features.${i}.uses.current`] = maxUses;
      }
    }

    const col = await this.collection();
    await col.updateOne({ _id: sheet._id }, { $set: updates });

    this.logger?.info?.(`[CharacterService] ${type} rest completed for avatar ${avatarId}`);
    return { type, restored: true };
  }

  async setParty(avatarId, partyId) {
    const col = await this.collection();
    await col.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { $set: { partyId: partyId ? new ObjectId(partyId) : null, updatedAt: new Date() } }
    );
  }

  async setCampaign(avatarId, campaignId) {
    const col = await this.collection();
    await col.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { $set: { campaignId: campaignId ? new ObjectId(campaignId) : null, updatedAt: new Date() } }
    );
  }

  async learnSpell(avatarId, spellId) {
    const sheet = await this.getSheet(avatarId);
    if (!sheet?.spellcasting) throw new Error('Not a spellcaster');

    const col = await this.collection();
    await col.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { $addToSet: { 'spellcasting.known': spellId }, $set: { updatedAt: new Date() } }
    );
  }

  async learnCantrip(avatarId, spellId) {
    const sheet = await this.getSheet(avatarId);
    if (!sheet?.spellcasting) throw new Error('Not a spellcaster');

    const col = await this.collection();
    await col.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { $addToSet: { 'spellcasting.cantrips': spellId }, $set: { updatedAt: new Date() } }
    );
  }

  async consumeSpellSlot(avatarId, slotLevel) {
    const sheet = await this.getSheet(avatarId);
    if (!sheet?.spellcasting?.slots?.[slotLevel]) throw new Error('Invalid spell slot');
    if (sheet.spellcasting.slots[slotLevel].current < 1) throw new Error('No slots remaining');

    const col = await this.collection();
    await col.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { $inc: { [`spellcasting.slots.${slotLevel}.current`]: -1 }, $set: { updatedAt: new Date() } }
    );
  }

  async useFeature(avatarId, featureId) {
    const sheet = await this.getSheet(avatarId);
    if (!sheet) throw new Error('No character sheet found');

    const featureIndex = sheet.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) throw new Error('Feature not found');

    const feature = sheet.features[featureIndex];
    if (feature.uses && feature.uses.current < 1) throw new Error('No uses remaining');

    if (feature.uses) {
      const col = await this.collection();
      await col.updateOne(
        { _id: sheet._id },
        { $inc: { [`features.${featureIndex}.uses.current`]: -1 }, $set: { updatedAt: new Date() } }
      );
    }

    return feature;
  }

  async deleteCharacter(avatarId) {
    const col = await this.collection();
    await col.deleteOne({ avatarId: new ObjectId(avatarId) });
    this.logger?.info?.(`[CharacterService] Deleted character for avatar ${avatarId}`);
  }
}
