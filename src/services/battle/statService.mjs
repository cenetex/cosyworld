/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

export class StatService {
  constructor({ databaseService, configService, logger }) {
    this.databaseService = databaseService;
    this.configService = configService;
    this.logger = logger;
  }

  /**
   * Generates stats based on the creation date using d20 rolls with advantage/disadvantage per zodiac sign.
   * @param {Date|string} creationDate - The date the avatar was created.
   * @returns {Object} - Stats object with strength, dexterity, constitution, intelligence, wisdom, charisma, and hp.
   */
  static generateStatsFromDate(creationDate) {
    // Convert creationDate to a Date object if it’s a string
    if (typeof creationDate === 'string') {
      creationDate = new Date(creationDate);
    }

    // Fallback to current date if invalid
    if (!creationDate || isNaN(creationDate.getTime())) {
      console.warn("Invalid creation date, using current date as fallback");
      creationDate = new Date();
    }

    // Extract month (1-12) and day (1-31)
    const month = creationDate.getMonth() + 1;
    const day = creationDate.getDate();

    // Get the zodiac sign
    const zodiacSign = this.getZodiacSign(month, day);

    // Retrieve advantage and disadvantage stats for this sign
    const { advantage, disadvantage } = this.zodiacAdvantages[zodiacSign];

    // Seed the RNG with the full timestamp (milliseconds since epoch)
    const rng = this.seededRandom(creationDate.valueOf());

    // Define the order of stats to ensure consistency
    const statsOrder = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    const stats = {};

    // Generate stats for each attribute
    for (const stat of statsOrder) {
      // Roll two d20s for every stat to keep RNG sequence consistent
      const roll1 = Math.floor(rng() * 20) + 1; // 1 to 20
      const roll2 = Math.floor(rng() * 20) + 1; // 1 to 20

      let statValue;
      if (advantage.includes(stat)) {
        statValue = Math.max(roll1, roll2); // Advantage: take the higher roll
      } else if (disadvantage.includes(stat)) {
        statValue = Math.min(roll1, roll2); // Disadvantage: take the lower roll
      } else {
        statValue = roll1; // Normal: take the first roll
      }

      // Clamp the value to 8-16
      stats[stat] = Math.max(8, Math.min(16, statValue));
    }

    // Calculate HP based on Constitution
    const conMod = Math.floor((stats.constitution - 10) / 2);
    stats.hp = 10 + conMod; // HP ranges from 9 to 13 when con is 8-16

    return stats;
  }
  generateStatsFromDate = StatService.generateStatsFromDate;

  /**
   * Determines the zodiac sign based on month and day.
   * @param {number} month - Month (1-12)
   * @param {number} day - Day (1-31)
   * @returns {string} - Zodiac sign
   */
  static getZodiacSign(month, day) {
    if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return 'Aries';
    if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return 'Taurus';
    if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return 'Gemini';
    if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return 'Cancer';
    if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return 'Leo';
    if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return 'Virgo';
    if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return 'Libra';
    if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return 'Scorpio';
    if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return 'Sagittarius';
    if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return 'Capricorn';
    if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return 'Aquarius';
    return 'Pisces';
  }
  getZodiacSign = StatService.getZodiacSign;

  /**
   * Defines which stats get advantage or disadvantage based on zodiac sign.
   */
  static zodiacAdvantages = {
    'Aries': { advantage: ['strength', 'constitution'], disadvantage: ['wisdom', 'intelligence'] },
    'Taurus': { advantage: ['constitution', 'wisdom'], disadvantage: ['dexterity', 'charisma'] },
    'Gemini': { advantage: ['dexterity', 'intelligence'], disadvantage: ['strength', 'constitution'] },
    'Cancer': { advantage: ['wisdom', 'charisma'], disadvantage: ['strength', 'dexterity'] },
    'Leo': { advantage: ['strength', 'charisma'], disadvantage: ['intelligence', 'wisdom'] },
    'Virgo': { advantage: ['intelligence', 'wisdom'], disadvantage: ['strength', 'charisma'] },
    'Libra': { advantage: ['charisma', 'dexterity'], disadvantage: ['constitution', 'intelligence'] },
    'Scorpio': { advantage: ['constitution', 'intelligence'], disadvantage: ['wisdom', 'charisma'] },
    'Sagittarius': { advantage: ['dexterity', 'charisma'], disadvantage: ['constitution', 'wisdom'] },
    'Capricorn': { advantage: ['constitution', 'intelligence'], disadvantage: ['dexterity', 'charisma'] },
    'Aquarius': { advantage: ['intelligence', 'wisdom'], disadvantage: ['strength', 'constitution'] },
    'Pisces': { advantage: ['wisdom', 'charisma'], disadvantage: ['strength', 'dexterity'] }
  };
  zodiacAdvantages = StatService.zodiacAdvantages;

  /**
   * Creates a seeded RNG function based on a numeric seed.
   * @param {number} seed - The seed value (e.g., timestamp)
   * @returns {Function} - A function that generates random numbers between 0 and 1
   */
  static seededRandom(seed) {
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }
  seededRandom(seed) {
    return StatService.seededRandom(seed);
  }

  /**
   * Validates that all stats are numbers between 8 and 16.
   * @param {Object} stats - The stats object to validate
   * @returns {boolean} - True if valid, false otherwise
   */
  static validateStats(stats) {
    if (!stats) return false;

    const requiredStats = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma', 'hp'];
    return requiredStats.every(stat => 
      typeof stats[stat] === 'number' && 
      stats[stat] >= 8 && 
      stats[stat] <= 16
    );
  }

  validateStats = StatService.validateStats;

  /**
   * Creates a stat modifier for an avatar (e.g., damage, healing, buffs).
   * @param {string} stat - The stat to modify (e.g., 'hp', 'strength')
   * @param {number} value - The value to add (negative for damage/debuff)
   * @param {object} options - { avatarId, duration (ms), source }
   * @returns {Promise<object>} The created modifier document
   */
  async createModifier(stat, value, { avatarId, duration = null, source = null } = {}) {
    if (!this.databaseService) throw new Error('StatService missing databaseService');
    const db = await this.databaseService.getDatabase();
    const now = new Date();
    const expiresAt = duration ? new Date(now.getTime() + duration) : null;
    const modifier = {
      avatarId: typeof avatarId === 'string' ? new ObjectId(avatarId) : avatarId,
      stat,
      value: Math.round(value), // Ensure whole number
      createdAt: now,
      expiresAt,
      source,
    };
    await db.collection('dungeon_modifiers').insertOne(modifier);
    return modifier;
  }

  /**
   * Computes the effective stat value for an avatar (base + all active modifiers).
   * @param {string|ObjectId} avatarId
   * @param {string} stat
   * @returns {Promise<number>} Effective stat value
   */
  async getEffectiveStat(avatarId, stat) {
    if (!this.databaseService) throw new Error('StatService missing databaseService');
    const db = await this.databaseService.getDatabase();
    const baseStats = await db.collection('dungeon_stats').findOne({ avatarId: typeof avatarId === 'string' ? new ObjectId(avatarId) : avatarId });
    const base = baseStats?.[stat] ?? 0;
    const now = new Date();
    const modifiers = await db.collection('dungeon_modifiers').find({
      avatarId: typeof avatarId === 'string' ? new ObjectId(avatarId) : avatarId,
      stat,
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } }
      ]
    }).toArray();
    const totalMod = modifiers.reduce((sum, m) => sum + m.value, 0);
    return base + totalMod;
  }

  /**
   * Returns the total value of all active modifiers for a stat (e.g., total damage counters).
   * Always rounds to whole numbers.
   * @param {string|ObjectId} avatarId
   * @param {string} stat
   * @returns {Promise<number>} Sum of all active modifiers (integer)
   */
  async getTotalModifier(avatarId, stat) {
    if (!this.databaseService) throw new Error('StatService missing databaseService');
    const db = await this.databaseService.getDatabase();
    const now = new Date();
    const modifiers = await db.collection('dungeon_modifiers').find({
      avatarId: typeof avatarId === 'string' ? new ObjectId(avatarId) : avatarId,
      stat,
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } }
      ]
    }).toArray();
    // Always sum as integers
    return modifiers.reduce((sum, m) => sum + Math.round(m.value), 0);
  }
}