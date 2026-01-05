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
import eventBus from '../../utils/eventBus.mjs';

export class CharacterService {
  static _avatarCreatedListener = null;

  constructor({ databaseService, avatarService, unifiedAIService, logger }) {
    this.databaseService = databaseService;
    this.avatarService = avatarService;
    this.aiService = unifiedAIService;
    this.logger = logger;
    this._collection = null;

    // Listen for new avatar creation to auto-generate character sheets
    this._setupEventListeners();
  }

  /**
   * Setup event listeners for auto-generating character sheets
   */
  _setupEventListeners() {
    if (CharacterService._avatarCreatedListener) {
      if (eventBus.off) {
        eventBus.off('AVATAR.CREATED', CharacterService._avatarCreatedListener);
      } else if (eventBus.removeListener) {
        eventBus.removeListener('AVATAR.CREATED', CharacterService._avatarCreatedListener);
      }
    }

    CharacterService._avatarCreatedListener = async (event) => {
      try {
        const avatarId = event.avatarId?.toString?.() || event.avatarId;
        if (!avatarId) return;

        // Auto-generate character sheet for new avatars
        this.logger?.info?.(`[CharacterService] Auto-generating character sheet for new avatar ${event.name || avatarId}`);
        await this.generateCharacterForAvatar(avatarId);
      } catch (e) {
        this.logger?.warn?.(`[CharacterService] Failed to auto-generate character sheet: ${e.message}`);
      }
    };

    eventBus.on('AVATAR.CREATED', CharacterService._avatarCreatedListener);
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
      concentration: null, // H-2: Track active concentration spell { spellId, startedAt, duration }
      partyId: null,
      campaignId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const col = await this.collection();
    await col.insertOne(sheet);

    // H-5 fix: Calculate initial HP based on class hit dice + constitution modifier
    const conMod = Math.floor(((newStats.constitution || 10) - 10) / 2);
    const initialMaxHp = classDef.hitDice + conMod; // Level 1: max hit die + CON mod
    const finalMaxHp = Math.max(1, initialMaxHp); // Ensure at least 1 HP
    
    // Update dungeon_stats as the canonical source of truth for base stats
    // HealthService will compute currentHp from maxHp minus damage modifiers
    await this.avatarService.updateAvatarStats(avatar, {
      ...newStats,
      hp: finalMaxHp,
      maxHp: finalMaxHp
    });

    this.logger?.info?.(`[CharacterService] Created ${race} ${className} for avatar ${avatarId} with ${finalMaxHp} HP`);
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
    const dungeonStats = await this.avatarService.getOrCreateStats?.(avatar);

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
    const conScore = Number.isFinite(avatar.stats?.constitution)
      ? avatar.stats.constitution
      : (Number.isFinite(dungeonStats?.constitution) ? dungeonStats.constitution : 10);
    const conMod = Math.floor((conScore - 10) / 2);
    const levelsGained = newLevel - sheet.level;
    const totalHpGain = hpGain + conMod * levelsGained;

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

    // Increase avatar max HP (do not base on current HP)
    const existingMaxHp = Number.isFinite(avatar?.stats?.maxHp)
      ? avatar.stats.maxHp
      : (Number.isFinite(dungeonStats?.maxHp)
          ? dungeonStats.maxHp
          : (Number.isFinite(dungeonStats?.hp)
              ? dungeonStats.hp
              : (Number.isFinite(avatar?.stats?.hp) ? avatar.stats.hp : 10)));
    const currentHp = Number.isFinite(avatar?.stats?.hp) ? avatar.stats.hp : existingMaxHp;
    const newMaxHP = Math.max(1, existingMaxHp + totalHpGain);
    const newCurrentHp = Math.min(newMaxHP, currentHp + totalHpGain);

    avatar.stats = {
      ...(avatar.stats || {}),
      hp: newCurrentHp,
      maxHp: newMaxHP
    };
    await this.avatarService.updateAvatar(avatar);

    if (dungeonStats) {
      await this.avatarService.updateAvatarStats(avatar, {
        ...dungeonStats,
        hp: newMaxHP,
        maxHp: newMaxHP
      });
    }

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

  /**
   * H-2: Set concentration on a spell
   * @param {string} avatarId - Avatar ID
   * @param {string} spellId - Spell ID being concentrated on
   * @param {number} duration - Duration in seconds (or null for indefinite)
   * @returns {object} Previous concentration if broken, null otherwise
   */
  async setConcentration(avatarId, spellId, duration = null) {
    const sheet = await this.getSheet(avatarId);
    if (!sheet) throw new Error('No character sheet found');
    
    const previousConcentration = sheet.concentration;
    
    const col = await this.collection();
    await col.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { 
        $set: { 
          concentration: { 
            spellId, 
            startedAt: new Date(),
            duration 
          },
          updatedAt: new Date() 
        } 
      }
    );
    
    if (previousConcentration) {
      this.logger?.info?.(`[CharacterService] Avatar ${avatarId} broke concentration on ${previousConcentration.spellId} to concentrate on ${spellId}`);
    } else {
      this.logger?.info?.(`[CharacterService] Avatar ${avatarId} concentrating on ${spellId}`);
    }
    
    return previousConcentration;
  }

  /**
   * H-2: Break concentration (e.g., from damage or casting another concentration spell)
   * @param {string} avatarId - Avatar ID
   * @returns {object} The broken concentration spell, or null if not concentrating
   */
  async breakConcentration(avatarId) {
    const sheet = await this.getSheet(avatarId);
    if (!sheet) throw new Error('No character sheet found');
    
    const brokenConcentration = sheet.concentration;
    if (!brokenConcentration) return null;
    
    const col = await this.collection();
    await col.updateOne(
      { avatarId: new ObjectId(avatarId) },
      { $set: { concentration: null, updatedAt: new Date() } }
    );
    
    this.logger?.info?.(`[CharacterService] Avatar ${avatarId} broke concentration on ${brokenConcentration.spellId}`);
    return brokenConcentration;
  }

  /**
   * H-2: Get current concentration spell
   * @param {string} avatarId - Avatar ID
   * @returns {object|null} Current concentration or null
   */
  async getConcentration(avatarId) {
    const sheet = await this.getSheet(avatarId);
    return sheet?.concentration || null;
  }

  /**
   * H-2: Make a concentration save after taking damage (DC 10 or half damage, whichever is higher)
   * @param {string} avatarId - Avatar ID
   * @param {number} damageTaken - Amount of damage taken
   * @param {number} constitutionMod - Constitution modifier for the save
   * @returns {object} { success, roll, dc, brokenSpell }
   */
  async concentrationSave(avatarId, damageTaken, constitutionMod = 0) {
    const concentration = await this.getConcentration(avatarId);
    if (!concentration) return { success: true, roll: null, dc: null, brokenSpell: null };
    
    const dc = Math.max(10, Math.floor(damageTaken / 2));
    const roll = Math.floor(Math.random() * 20) + 1 + constitutionMod;
    const success = roll >= dc;
    
    let brokenSpell = null;
    if (!success) {
      brokenSpell = await this.breakConcentration(avatarId);
    }
    
    this.logger?.info?.(`[CharacterService] Concentration save: roll ${roll} vs DC ${dc} - ${success ? 'maintained' : 'broken'}`);
    return { success, roll, dc, brokenSpell };
  }

  async deleteCharacter(avatarId) {
    const col = await this.collection();
    await col.deleteOne({ avatarId: new ObjectId(avatarId) });
    this.logger?.info?.(`[CharacterService] Deleted character for avatar ${avatarId}`);
  }

  /**
   * Generate a character sheet for an avatar using AI to determine appropriate class/race/background
   * based on the avatar's personality and description.
   * @param {string} avatarId - Avatar ID
   * @returns {Promise<Object>} The created character sheet
   */
  async generateCharacterForAvatar(avatarId) {
    // Check if already has a sheet
    const existing = await this.getSheet(avatarId);
    if (existing) {
      this.logger?.debug?.(`[CharacterService] Avatar ${avatarId} already has character sheet`);
      return existing;
    }

    const avatar = await this.avatarService.getAvatarById(avatarId);
    if (!avatar) throw new Error('Avatar not found');

    // Get available options
    const classOptions = Object.keys(CLASSES);
    const raceOptions = Object.keys(RACES);
    const backgroundOptions = Object.keys(BACKGROUNDS);

    // Build prompt for AI to select appropriate options
    const prompt = `Based on this character's personality and description, select the most fitting D&D 5e class, race, and background.

Character: ${avatar.name}
Description: ${avatar.description || 'No description'}
Personality: ${avatar.personality || 'Unknown'}
Emoji: ${avatar.emoji || ''}

Available Classes: ${classOptions.join(', ')}
Available Races: ${raceOptions.join(', ')}
Available Backgrounds: ${backgroundOptions.join(', ')}

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"class": "classname", "race": "racename", "background": "backgroundname"}`;

    let className = 'fighter';
    let race = 'human';
    let background = 'soldier';

    if (this.aiService) {
      try {
        const response = await this.aiService.chat([
          { role: 'system', content: 'You are a D&D character creation assistant. You analyze character descriptions and select appropriate class, race, and background. Respond only with valid JSON.' },
          { role: 'user', content: prompt }
        ], { 
          temperature: 0.7,
          model: process.env.STRUCTURED_MODEL 
        });

        const text = typeof response === 'string' ? response : response?.text || response?.content || '';
        
        // Parse JSON from response (handle potential markdown wrapping)
        const jsonMatch = text.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          
          // Validate selections
          if (classOptions.includes(parsed.class?.toLowerCase())) {
            className = parsed.class.toLowerCase();
          }
          if (raceOptions.includes(parsed.race?.toLowerCase())) {
            race = parsed.race.toLowerCase();
          }
          if (backgroundOptions.includes(parsed.background?.toLowerCase())) {
            background = parsed.background.toLowerCase();
          }
          
          this.logger?.info?.(`[CharacterService] AI selected ${race} ${className} (${background}) for ${avatar.name}`);
        }
      } catch (e) {
        this.logger?.warn?.(`[CharacterService] AI character generation failed, using defaults: ${e.message}`);
      }
    }

    // Create the character with selected options
    const sheet = await this.createCharacter(avatarId, { className, race, background });
    this.logger?.info?.(`[CharacterService] Generated character sheet for ${avatar.name}: ${race} ${className}`);
    return sheet;
  }

  /**
   * Get or create a character sheet for an avatar.
   * If no sheet exists, generates one using AI.
   * @param {string} avatarId - Avatar ID
   * @returns {Promise<Object>} The character sheet
   */
  async getOrCreateSheet(avatarId) {
    const existing = await this.getSheet(avatarId);
    if (existing) return existing;
    return await this.generateCharacterForAvatar(avatarId);
  }
}
