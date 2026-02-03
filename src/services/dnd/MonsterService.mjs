/**
 * MonsterService - Dynamic monster bestiary with AI generation
 * 
 * Features:
 * - Database-backed monster storage with tag-based querying
 * - Bonding curve for new monster generation probability
 * - AI-generated monsters with custom images
 * - Seed initial monsters from static data
 * 
 * @module services/dnd/MonsterService
 */

import { MONSTERS, MONSTER_TRAITS } from '../../data/dnd/monsters.mjs';

const rand01 = () => Math.random();

/**
 * Default monster tags for categorization
 */
export const MONSTER_TAGS = {
  habitats: ['crypt', 'cave', 'forest', 'sewers', 'ruins', 'castle', 'swamp', 'mountain', 'desert', 'underwater'],
  types: ['undead', 'beast', 'humanoid', 'monstrosity', 'elemental', 'fiend', 'aberration', 'construct', 'dragon', 'giant'],
  roles: ['minion', 'brute', 'skirmisher', 'artillery', 'controller', 'elite', 'boss']
};

/**
 * CR to level approximation for tag-based filtering
 */
export const CR_TO_LEVEL_MAP = {
  0: 1, 0.125: 1, 0.25: 1, 0.5: 1,
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5,
  6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
  11: 11, 12: 12, 13: 13, 14: 14, 15: 15,
  16: 16, 17: 17, 18: 18, 19: 19, 20: 20
};

/**
 * Static monster tag assignments for seeding
 */
const STATIC_MONSTER_TAGS = {
  goblin: { habitats: ['cave', 'ruins', 'forest'], type: 'humanoid', role: 'minion' },
  skeleton: { habitats: ['crypt', 'ruins', 'castle'], type: 'undead', role: 'minion' },
  zombie: { habitats: ['crypt', 'ruins', 'sewers'], type: 'undead', role: 'brute' },
  wolf: { habitats: ['forest', 'mountain', 'cave'], type: 'beast', role: 'skirmisher' },
  giant_rat: { habitats: ['sewers', 'cave', 'ruins'], type: 'beast', role: 'minion' },
  kobold: { habitats: ['cave', 'ruins', 'mountain'], type: 'humanoid', role: 'minion' },
  orc: { habitats: ['cave', 'mountain', 'ruins'], type: 'humanoid', role: 'brute' },
  hobgoblin: { habitats: ['cave', 'ruins', 'castle'], type: 'humanoid', role: 'skirmisher' },
  gnoll: { habitats: ['desert', 'ruins', 'forest'], type: 'humanoid', role: 'brute' },
  giant_spider: { habitats: ['cave', 'forest', 'sewers'], type: 'beast', role: 'controller' },
  bugbear: { habitats: ['cave', 'forest', 'ruins'], type: 'humanoid', role: 'brute' },
  harpy: { habitats: ['mountain', 'ruins', 'forest'], type: 'monstrosity', role: 'controller' },
  ghoul: { habitats: ['crypt', 'ruins', 'sewers'], type: 'undead', role: 'skirmisher' },
  ogre: { habitats: ['cave', 'swamp', 'mountain'], type: 'giant', role: 'brute' },
  gargoyle: { habitats: ['castle', 'ruins', 'mountain'], type: 'elemental', role: 'brute' },
  werewolf: { habitats: ['forest', 'ruins', 'cave'], type: 'monstrosity', role: 'elite' },
  minotaur: { habitats: ['ruins', 'cave'], type: 'monstrosity', role: 'elite' },
  basilisk: { habitats: ['cave', 'ruins', 'desert'], type: 'monstrosity', role: 'controller' },
  owlbear: { habitats: ['forest', 'cave'], type: 'monstrosity', role: 'brute' },
  ettin: { habitats: ['mountain', 'cave', 'ruins'], type: 'giant', role: 'elite' },
  troll: { habitats: ['swamp', 'cave', 'mountain'], type: 'giant', role: 'elite' },
  wraith: { habitats: ['crypt', 'ruins', 'castle'], type: 'undead', role: 'elite' },
  young_dragon: { habitats: ['mountain', 'cave', 'ruins'], type: 'dragon', role: 'boss' }
};

export class MonsterService {
  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.databaseService - Database service for MongoDB operations
   * @param {Object} deps.schemaService - Schema service for AI structured output
   * @param {Object} deps.aiService - AI service for image generation
   * @param {Object} [deps.logger] - Optional logger
   */
  constructor({ databaseService, schemaService, aiService, logger }) {
    this.databaseService = databaseService;
    this.schemaService = schemaService;
    this.aiService = aiService;
    this.logger = logger;
    this._indexesCreated = false;
  }

  /**
   * Get the monsters collection with indexes
   * @returns {Promise<Collection>}
   */
  async collection() {
    const db = await this.databaseService.getDatabase();
    const col = db.collection('monsters');

    if (!this._indexesCreated) {
      try {
        await col.createIndexes([
          { key: { monsterId: 1 }, unique: true, sparse: true },
          { key: { 'tags.habitats': 1 } },
          { key: { 'tags.type': 1 } },
          { key: { 'tags.role': 1 } },
          { key: { cr: 1 } },
          { key: { 'tags.habitats': 1, 'tags.type': 1, cr: 1 } }
        ]);
        this._indexesCreated = true;
      } catch (err) {
        this.logger?.warn?.('[MonsterService] Index creation failed:', err.message);
      }
    }

    return col;
  }

  /**
   * Seed the database with static monsters if not already present
   * @returns {Promise<{ seeded: number, existing: number }>}
   */
  async seedStaticMonsters() {
    const col = await this.collection();
    let seeded = 0;
    let existing = 0;

    for (const [monsterId, monster] of Object.entries(MONSTERS)) {
      const exists = await col.findOne({ monsterId });
      if (exists) {
        existing++;
        continue;
      }

      const tags = STATIC_MONSTER_TAGS[monsterId] || {
        habitats: ['cave'],
        type: 'monstrosity',
        role: 'minion'
      };

      const doc = {
        monsterId,
        name: monster.name,
        emoji: monster.emoji,
        description: this._generateDefaultDescription(monster),
        imageUrl: null,
        cr: monster.cr,
        xp: monster.xp,
        stats: monster.stats,
        attacks: monster.attacks,
        traits: monster.traits || [],
        immunities: monster.immunities || [],
        vulnerabilities: monster.vulnerabilities || [],
        tags: {
          habitats: tags.habitats,
          type: tags.type,
          role: tags.role
        },
        isGenerated: false,
        usageCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await col.insertOne(doc);
      seeded++;
      this.logger?.info?.(`[MonsterService] Seeded monster: ${monster.name}`);
    }

    return { seeded, existing };
  }

  /**
   * Generate a default description for static monsters
   * @private
   */
  _generateDefaultDescription(monster) {
    const traits = monster.traits?.map(t => MONSTER_TRAITS[t]?.name || t).join(', ');
    return `A CR ${monster.cr} creature with ${monster.stats.hp} HP and ${monster.stats.ac} AC. ${traits ? `Known for: ${traits}.` : ''}`;
  }

  /**
   * Get all monsters matching the specified tags
   * @param {Object} filters - Tag filters
   * @param {string[]} [filters.habitats] - Habitat tags (OR match)
   * @param {string} [filters.type] - Creature type (exact match)
   * @param {string} [filters.role] - Combat role (exact match)
   * @param {number} [filters.minCR] - Minimum challenge rating
   * @param {number} [filters.maxCR] - Maximum challenge rating
   * @param {number} [filters.targetLevel] - Target party level (maps to CR range)
   * @param {number} [filters.maxXP] - Maximum XP value (for budget-constrained selection)
   * @returns {Promise<Object[]>} Array of matching monsters
   */
  async getMonstersByTags(filters = {}) {
    const col = await this.collection();
    const query = {};

    // Habitat filter (any match)
    if (filters.habitats?.length) {
      query['tags.habitats'] = { $in: filters.habitats };
    }

    // Type filter (exact match)
    if (filters.type) {
      query['tags.type'] = filters.type;
    }

    // Role filter (exact match)
    if (filters.role) {
      query['tags.role'] = filters.role;
    }

    // V5 FIX: XP budget filter (for budget-constrained encounters)
    // This takes priority over CR range if specified
    if (filters.maxXP !== undefined) {
      query.xp = { $lte: filters.maxXP };
    } else if (filters.minCR !== undefined || filters.maxCR !== undefined) {
      // CR range filter
      query.cr = {};
      if (filters.minCR !== undefined) query.cr.$gte = filters.minCR;
      if (filters.maxCR !== undefined) query.cr.$lte = filters.maxCR;
    } else if (filters.targetLevel !== undefined) {
      // Map level to appropriate CR range
      const crRange = this._levelToCRRange(filters.targetLevel);
      query.cr = { $gte: crRange.min, $lte: crRange.max };
    }

    const monsters = await col.find(query).toArray();
    return monsters;
  }

  /**
   * Map party level to appropriate CR range
   * @private
   */
  _levelToCRRange(level) {
    // General guideline: party can handle CR = level for medium difficulty
    // Easy: CR = level - 2, Hard: CR = level + 2, Deadly: CR = level + 4
    return {
      min: Math.max(0, level - 2),
      max: level + 2
    };
  }

  /**
   * Select a monster for an encounter using bonding curve probability
   * 
   * Algorithm:
   * 1. Get all monsters matching the tags
   * 2. Calculate probability of generating new: P(new) = 1 / (n + 1)
   *    - 0 monsters → 100% new
   *    - 1 monster → 50% new
   *    - 2 monsters → 33% new
   *    - n monsters → 1/(n+1) new
   * 3. Either generate a new monster or select from existing
   * 
   * @param {Object} filters - Tag filters (same as getMonstersByTags)
   * @param {Object} [options] - Selection options
   * @param {boolean} [options.forceNew=false] - Force generate a new monster
   * @param {boolean} [options.forceExisting=false] - Force select from existing
   * @returns {Promise<{ monster: Object, isNew: boolean }>}
   */
  async selectMonsterForEncounter(filters = {}, options = {}) {
    const existingMonsters = await this.getMonstersByTags(filters);
    const n = existingMonsters.length;

    // Calculate probability of new monster: 1/(n+1)
    const probNew = 1 / (n + 1);
    const roll = rand01();

    // Log the selection decision
    this.logger?.debug?.(`[MonsterService] Selection: ${n} existing monsters, P(new)=${(probNew * 100).toFixed(1)}%, rolled=${(roll * 100).toFixed(1)}%`);

    // Decision: generate new or select existing
    let shouldGenerateNew = roll < probNew;
    
    // Apply overrides
    if (options.forceNew) shouldGenerateNew = true;
    if (options.forceExisting && n > 0) shouldGenerateNew = false;

    if (shouldGenerateNew || n === 0) {
      // Generate a new monster
      const newMonster = await this.generateMonster(filters);
      return { monster: newMonster, isNew: true };
    }

    // Select a random existing monster (weighted by inverse usage count for variety)
    const selected = this._selectWeightedByUsage(existingMonsters);
    
    // Increment usage count
    const col = await this.collection();
    await col.updateOne(
      { _id: selected._id },
      { $inc: { usageCount: 1 }, $set: { updatedAt: new Date() } }
    );

    return { monster: selected, isNew: false };
  }

  /**
   * Select a monster weighted by inverse usage (less-used monsters more likely)
   * @private
   */
  _selectWeightedByUsage(monsters) {
    if (monsters.length === 1) return monsters[0];

    // Calculate weights (inverse of usage count + 1)
    const weights = monsters.map(m => 1 / (m.usageCount + 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    // Weighted random selection
    let roll = rand01() * totalWeight;
    for (let i = 0; i < monsters.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return monsters[i];
    }

    return monsters[monsters.length - 1];
  }

  /**
   * Generate a new monster using AI
   * @param {Object} filters - Tags to apply to the new monster
   * @param {Object} [options] - Generation options
   * @param {boolean} [options.generateImage=true] - Whether to generate an image
   * @returns {Promise<Object>} The generated monster document
   */
  async generateMonster(filters = {}, options = { generateImage: true }) {
    // Build generation prompt based on filters
    const prompt = this._buildGenerationPrompt(filters);

    // Define the monster schema for structured output
    // All properties must be in 'required' for strict JSON mode
    const schema = {
      name: 'dnd-monster',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Unique, evocative monster name' },
          description: { type: 'string', description: '2-3 sentence vivid description' },
          emoji: { type: 'string', description: 'Single emoji representing the monster' },
          cr: { type: 'number', description: 'Challenge rating (0.125, 0.25, 0.5, or 1-20)' },
          xp: { type: 'number', description: 'XP value based on CR' },
          hp: { type: 'number', description: 'Hit points (typically CR * 15 + 10)' },
          ac: { type: 'number', description: 'Armor class (typically 10-20)' },
          speed: { type: 'number', description: 'Movement speed in feet' },
          str: { type: 'number', description: 'Strength score (3-20)' },
          dex: { type: 'number', description: 'Dexterity score (3-20)' },
          con: { type: 'number', description: 'Constitution score (3-20)' },
          int: { type: 'number', description: 'Intelligence score (3-20)' },
          wis: { type: 'number', description: 'Wisdom score (3-20)' },
          cha: { type: 'number', description: 'Charisma score (3-20)' },
          attackName: { type: 'string', description: 'Primary attack name' },
          attackBonus: { type: 'number', description: 'Attack bonus (+3 to +10)' },
          damageDice: { type: 'number', description: 'Damage die size (4, 6, 8, 10, 12)' },
          damageDiceCount: { type: 'number', description: 'Number of damage dice (1-4)' },
          damageModifier: { type: 'number', description: 'Damage modifier (1-5)' },
          damageType: { type: 'string', description: 'Damage type (slashing, piercing, bludgeoning, fire, etc.)' },
          trait1: { type: 'string', description: 'First special ability or trait' },
          trait2: { type: 'string', description: 'Second special ability or trait, use empty string if none' },
          immunity: { type: 'string', description: 'Damage immunity if any (poison, fire, etc.) or "none"' },
          vulnerability: { type: 'string', description: 'Damage vulnerability if any or "none"' }
        },
        required: ['name', 'description', 'emoji', 'cr', 'xp', 'hp', 'ac', 'speed',
          'str', 'dex', 'con', 'int', 'wis', 'cha',
          'attackName', 'attackBonus', 'damageDice', 'damageDiceCount', 'damageModifier', 'damageType',
          'trait1', 'trait2', 'immunity', 'vulnerability'],
        additionalProperties: false
      }
    };

    this.logger?.info?.(`[MonsterService] Generating new monster for: ${JSON.stringify(filters)}`);

    let result;
    try {
      result = await this.schemaService.executePipeline({ prompt, schema });
      // Coerce numeric fields in case AI returns strings
      result = this._coerceNumericFields(result);
    } catch (err) {
      this.logger?.error?.(`[MonsterService] AI generation failed:`, err);
      // Fallback to a random existing monster or generic creature
      return this._createFallbackMonster(filters);
    }

    // Transform flat AI output to monster document
    const monster = {
      monsterId: this._generateMonsterId(result.name),
      name: result.name,
      emoji: result.emoji || '👾',
      description: result.description,
      imageUrl: null,
      cr: result.cr,
      xp: result.xp || this._crToXP(result.cr),
      stats: {
        hp: result.hp,
        ac: result.ac,
        speed: result.speed || 30,
        str: result.str,
        dex: result.dex,
        con: result.con,
        int: result.int,
        wis: result.wis,
        cha: result.cha
      },
      attacks: [{
        name: result.attackName,
        bonus: result.attackBonus,
        damage: {
          dice: result.damageDice,
          count: result.damageDiceCount,
          modifier: result.damageModifier,
          type: result.damageType
        }
      }],
      traits: [result.trait1, result.trait2].filter(Boolean),
      immunities: result.immunity && result.immunity !== 'none' ? [result.immunity] : [],
      vulnerabilities: result.vulnerability && result.vulnerability !== 'none' ? [result.vulnerability] : [],
      tags: {
        habitats: filters.habitats || ['cave'],
        type: filters.type || 'monstrosity',
        role: filters.role || 'minion'
      },
      isGenerated: true,
      usageCount: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Clamp stats based on role to ensure balance
    this._clampMonsterStatsByRole(monster, filters.role);

    // Generate image if requested
    if (options.generateImage) {
      try {
        monster.imageUrl = await this._generateMonsterImage(monster);
      } catch (err) {
        this.logger?.warn?.(`[MonsterService] Image generation failed:`, err.message);
      }
    }

    // Store in database
    const col = await this.collection();
    const insertResult = await col.insertOne(monster);
    monster._id = insertResult.insertedId;

    this.logger?.info?.(`[MonsterService] Generated new monster: ${monster.name} (CR ${monster.cr})`);
    return monster;
  }

  /**
   * Build AI prompt for monster generation
   * @private
   */
  _buildGenerationPrompt(filters) {
    const parts = ['Generate a unique D&D 5e-style monster in JSON format'];

    if (filters.habitats?.length) {
      parts.push(`found in ${filters.habitats.join(' or ')} environments`);
    }

    if (filters.type) {
      parts.push(`of type "${filters.type}"`);
    }

    if (filters.role) {
      const roleDesc = {
        minion: 'weak but numerous (AC 8-11, low HP)',
        brute: 'strong melee fighter with high HP (AC 12-14)',
        skirmisher: 'mobile hit-and-run attacker (AC 13-15)',
        artillery: 'ranged attacker (AC 10-13)',
        controller: 'uses debuffs and area control (AC 12-14)',
        elite: 'powerful single threat (AC 14-17)',
        boss: 'legendary creature suitable as a climactic encounter (AC 15-18)'
      };
      parts.push(`serving as a ${filters.role} (${roleDesc[filters.role] || filters.role})`);
    }

    // V5 FIX: Add XP constraint to prevent generating over-budget monsters
    if (filters.maxXP !== undefined) {
      // Map XP to appropriate CR
      const crForXP = this._xpToCR(filters.maxXP);
      parts.push(`with CR ${crForXP} or less (max ${filters.maxXP} XP)`);
    } else if (filters.minCR !== undefined && filters.maxCR !== undefined) {
      parts.push(`with Challenge Rating between ${filters.minCR} and ${filters.maxCR}`);
    } else if (filters.targetLevel !== undefined) {
      const crRange = this._levelToCRRange(filters.targetLevel);
      parts.push(`appropriate for a level ${filters.targetLevel} party (CR ${crRange.min}-${crRange.max})`);
    }

    // Add explicit stat guidance based on CR/role
    parts.push('. IMPORTANT: For CR 0.25-1 minions, use AC 8-11 and HP 7-22. Make it creative and memorable, with unique abilities that fit its theme. Balance stats appropriately for the CR. All numeric fields must be numbers, not strings.');

    return parts.join(' ');
  }

  /**
   * Map XP to approximate CR (inverse of _crToXP)
   * @private
   */
  _xpToCR(xp) {
    if (xp <= 25) return 0.125;
    if (xp <= 50) return 0.25;
    if (xp <= 100) return 0.5;
    if (xp <= 200) return 1;
    if (xp <= 450) return 2;
    if (xp <= 700) return 3;
    if (xp <= 1100) return 4;
    if (xp <= 1800) return 5;
    return Math.floor(xp / 500); // Rough approximation for higher CRs
  }

  /**
   * Generate a unique monster ID from name
   * @private
   */
  _generateMonsterId(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const suffix = Date.now().toString(36).slice(-4);
    return `${base}_${suffix}`;
  }

  /**
   * Convert CR to XP value
   * @private
   */
  _crToXP(cr) {
    const xpByCR = {
      0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
      1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800,
      6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
      11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
      16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000
    };
    return xpByCR[cr] || Math.floor(cr * 200);
  }

  /**
   * Generate an image for a monster
   * @private
   */
  async _generateMonsterImage(monster) {
    const imagePrompt = `Fantasy creature portrait: ${monster.description}. ${monster.name}, a ${monster.tags.type} monster. Dark fantasy art style, dramatic lighting.`;

    // Try schemaService first, fallback to aiService
    if (this.schemaService?.generateImage) {
      return await this.schemaService.generateImage(imagePrompt, '1:1', {
        purpose: 'monster',
        category: 'dungeon',
        tags: ['monster', monster.tags?.type || 'creature', monster.name?.toLowerCase()].filter(Boolean),
        metadata: { 
          monsterId: monster._id?.toString(),
          monsterName: monster.name,
          monsterType: monster.tags?.type,
          cr: monster.challengeRating
        },
        useCache: true,
        cacheChance: 0.5 // 50% chance to reuse - monsters should be more varied
      });
    }

    if (this.aiService?.generateImageViaOpenRouter) {
      const result = await this.aiService.generateImageViaOpenRouter(imagePrompt);
      return result?.url || null;
    }

    this.logger?.warn?.('[MonsterService] No image generation service available');
    return null;
  }

  /**
   * Get or generate an image for a monster
   * If the monster already has an imageUrl, return it
   * Otherwise generate a new image and persist it to the database
   * @param {Object} monster - The monster document
   * @returns {Promise<string|null>} The image URL
   */
  async getOrGenerateImage(monster) {
    // Already has an image
    if (monster.imageUrl) {
      return monster.imageUrl;
    }

    // Generate new image
    this.logger?.debug?.(`[MonsterService] Generating image for ${monster.name}`);
    const imageUrl = await this._generateMonsterImage(monster);

    if (imageUrl && monster._id) {
      // Persist to database
      try {
        const col = await this.collection();
        await col.updateOne(
          { _id: monster._id },
          { $set: { imageUrl, updatedAt: new Date() } }
        );
        this.logger?.debug?.(`[MonsterService] Persisted image for ${monster.name}`);
      } catch (err) {
        this.logger?.warn?.(`[MonsterService] Failed to persist image for ${monster.name}:`, err.message);
      }
    }

    return imageUrl;
  }

  /**
   * Coerce numeric fields from strings to numbers
   * Some AI models return numbers as strings despite schema specification
   * @private
   */
  _coerceNumericFields(result) {
    const numericFields = [
      'cr', 'xp', 'hp', 'ac', 'speed',
      'str', 'dex', 'con', 'int', 'wis', 'cha',
      'attackBonus', 'damageDice', 'damageDiceCount', 'damageModifier'
    ];

    const coerced = { ...result };
    for (const field of numericFields) {
      if (coerced[field] !== undefined && typeof coerced[field] === 'string') {
        const parsed = parseFloat(coerced[field]);
        if (!isNaN(parsed)) {
          coerced[field] = parsed;
        }
      }
    }
    return coerced;
  }

  /**
   * Clamp monster stats based on role to ensure encounter balance
   * Prevents AI from generating overpowered minions or underpowered bosses
   * @private
   */
  _clampMonsterStatsByRole(monster, role) {
    if (!monster?.stats) return;
    if (!role) return;

    // Role-based AC and HP ranges
    const roleLimits = {
      minion: { acMin: 8, acMax: 11, hpMin: 4, hpMax: 22 },
      brute: { acMin: 11, acMax: 14, hpMin: 20, hpMax: 80 },
      skirmisher: { acMin: 12, acMax: 15, hpMin: 15, hpMax: 60 },
      artillery: { acMin: 10, acMax: 13, hpMin: 10, hpMax: 50 },
      controller: { acMin: 11, acMax: 14, hpMin: 15, hpMax: 60 },
      elite: { acMin: 13, acMax: 17, hpMin: 40, hpMax: 150 },
      boss: { acMin: 14, acMax: 19, hpMin: 80, hpMax: 300 }
    };

    const limits = roleLimits[role] || roleLimits.minion;

    // Clamp AC
    if (monster.stats.ac < limits.acMin) {
      monster.stats.ac = limits.acMin;
    } else if (monster.stats.ac > limits.acMax) {
      monster.stats.ac = limits.acMax;
    }

    // Clamp HP
    if (monster.stats.hp < limits.hpMin) {
      monster.stats.hp = limits.hpMin;
    } else if (monster.stats.hp > limits.hpMax) {
      monster.stats.hp = limits.hpMax;
    }
  }

  /**
   * Create a fallback monster when AI generation fails
   * @private
   */
  _createFallbackMonster(filters) {
    const cr = filters.targetLevel ? Math.max(0.25, filters.targetLevel - 1) : 1;
    const fallback = {
      monsterId: `unknown_creature_${Date.now().toString(36)}`,
      name: 'Unknown Creature',
      emoji: '👾',
      description: 'A strange creature lurking in the shadows.',
      imageUrl: null,
      cr,
      xp: this._crToXP(cr),
      stats: { hp: 20, ac: 12, speed: 30, str: 12, dex: 12, con: 12, int: 8, wis: 10, cha: 8 },
      attacks: [{ name: 'Strike', bonus: 4, damage: { dice: 6, count: 1, modifier: 2, type: 'slashing' } }],
      traits: [],
      immunities: [],
      vulnerabilities: [],
      tags: {
        habitats: filters.habitats || ['cave'],
        type: filters.type || 'monstrosity',
        role: filters.role || 'minion'
      },
      isGenerated: true,
      usageCount: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    return fallback;
  }

  /**
   * Get a monster by ID
   * @param {string} monsterId - The monster's unique ID
   * @returns {Promise<Object|null>}
   */
  async getMonster(monsterId) {
    const col = await this.collection();
    return col.findOne({ monsterId });
  }

  /**
   * Get a monster by MongoDB ObjectId
   * @param {ObjectId|string} id - The MongoDB _id
   * @returns {Promise<Object|null>}
   */
  async getMonsterById(id) {
    const col = await this.collection();
    const { ObjectId } = await import('mongodb');
    return col.findOne({ _id: typeof id === 'string' ? new ObjectId(id) : id });
  }

  /**
   * Update a monster
   * @param {string} monsterId - Monster ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object|null>}
   */
  async updateMonster(monsterId, updates) {
    const col = await this.collection();
    const result = await col.findOneAndUpdate(
      { monsterId },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    return result;
  }

  /**
   * Delete a monster
   * @param {string} monsterId - Monster ID
   * @returns {Promise<boolean>}
   */
  async deleteMonster(monsterId) {
    const col = await this.collection();
    const result = await col.deleteOne({ monsterId });
    return result.deletedCount > 0;
  }

  /**
   * Get monster statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    const col = await this.collection();
    const total = await col.countDocuments();
    const generated = await col.countDocuments({ isGenerated: true });
    const static_ = await col.countDocuments({ isGenerated: false });
    const avgUsage = await col.aggregate([
      { $group: { _id: null, avg: { $avg: '$usageCount' } } }
    ]).toArray();

    return {
      total,
      generated,
      static: static_,
      averageUsage: avgUsage[0]?.avg || 0
    };
  }

  /**
   * Get all unique tag values in use
   * @returns {Promise<Object>}
   */
  async getUsedTags() {
    const col = await this.collection();
    
    const habitats = await col.distinct('tags.habitats');
    const types = await col.distinct('tags.type');
    const roles = await col.distinct('tags.role');

    return { habitats, types, roles };
  }

  /**
   * Calculate encounter XP for a group of monsters
   * @param {Object[]} monsters - Array of monster documents with optional count
   * @returns {number} Total XP value
   */
  calculateEncounterXP(monsters) {
    return monsters.reduce((sum, m) => sum + (m.xp || 0) * (m.count || 1), 0);
  }
}
