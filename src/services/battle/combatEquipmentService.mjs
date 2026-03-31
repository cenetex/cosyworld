/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * CombatEquipmentService
 * Integrates equipped items (weapons, armor, accessories) into combat calculations.
 * Works with ItemService to apply equipment bonuses during battle.
 */

/**
 * Weapon type definitions with base stats
 */
export const WEAPON_TYPES = {
  // Light Weapons (DEX-based, finesse)
  dagger: {
    name: 'Dagger',
    emoji: '🗡️',
    damage: { dice: 4, count: 1 },  // 1d4
    type: 'piercing',
    properties: ['finesse', 'light', 'thrown'],
    range: 20,
    statBonus: 'dexterity'
  },
  shortsword: {
    name: 'Shortsword',
    emoji: '⚔️',
    damage: { dice: 6, count: 1 },  // 1d6
    type: 'piercing',
    properties: ['finesse', 'light'],
    statBonus: 'dexterity'
  },
  rapier: {
    name: 'Rapier',
    emoji: '🤺',
    damage: { dice: 8, count: 1 },  // 1d8
    type: 'piercing',
    properties: ['finesse'],
    statBonus: 'dexterity'
  },
  
  // Medium Weapons (STR or DEX)
  longsword: {
    name: 'Longsword',
    emoji: '🗡️',
    damage: { dice: 8, count: 1 },  // 1d8 (or 1d10 versatile)
    type: 'slashing',
    properties: ['versatile'],
    versatileDamage: { dice: 10, count: 1 },
    statBonus: 'strength'
  },
  battleaxe: {
    name: 'Battleaxe',
    emoji: '🪓',
    damage: { dice: 8, count: 1 },  // 1d8 (or 1d10 versatile)
    type: 'slashing',
    properties: ['versatile'],
    versatileDamage: { dice: 10, count: 1 },
    statBonus: 'strength'
  },
  warhammer: {
    name: 'Warhammer',
    emoji: '🔨',
    damage: { dice: 8, count: 1 },  // 1d8 (or 1d10 versatile)
    type: 'bludgeoning',
    properties: ['versatile'],
    versatileDamage: { dice: 10, count: 1 },
    statBonus: 'strength'
  },
  
  // Heavy Weapons (STR-based, two-handed)
  greatsword: {
    name: 'Greatsword',
    emoji: '⚔️',
    damage: { dice: 6, count: 2 },  // 2d6
    type: 'slashing',
    properties: ['heavy', 'two-handed'],
    statBonus: 'strength'
  },
  greataxe: {
    name: 'Greataxe',
    emoji: '🪓',
    damage: { dice: 12, count: 1 },  // 1d12
    type: 'slashing',
    properties: ['heavy', 'two-handed'],
    statBonus: 'strength'
  },
  maul: {
    name: 'Maul',
    emoji: '🔨',
    damage: { dice: 6, count: 2 },  // 2d6
    type: 'bludgeoning',
    properties: ['heavy', 'two-handed'],
    statBonus: 'strength'
  },
  
  // Ranged Weapons
  shortbow: {
    name: 'Shortbow',
    emoji: '🏹',
    damage: { dice: 6, count: 1 },  // 1d6
    type: 'piercing',
    properties: ['ranged', 'two-handed'],
    range: 80,
    statBonus: 'dexterity'
  },
  longbow: {
    name: 'Longbow',
    emoji: '🏹',
    damage: { dice: 8, count: 1 },  // 1d8
    type: 'piercing',
    properties: ['ranged', 'heavy', 'two-handed'],
    range: 150,
    statBonus: 'dexterity'
  },
  crossbow: {
    name: 'Crossbow',
    emoji: '🎯',
    damage: { dice: 8, count: 1 },  // 1d8
    type: 'piercing',
    properties: ['ranged', 'loading'],
    range: 80,
    statBonus: 'dexterity'
  },
  
  // Simple Weapons
  club: {
    name: 'Club',
    emoji: '🏏',
    damage: { dice: 4, count: 1 },  // 1d4
    type: 'bludgeoning',
    properties: ['light'],
    statBonus: 'strength'
  },
  quarterstaff: {
    name: 'Quarterstaff',
    emoji: '🪄',
    damage: { dice: 6, count: 1 },  // 1d6 (or 1d8 versatile)
    type: 'bludgeoning',
    properties: ['versatile'],
    versatileDamage: { dice: 8, count: 1 },
    statBonus: 'strength'
  },
  mace: {
    name: 'Mace',
    emoji: '🔱',
    damage: { dice: 6, count: 1 },  // 1d6
    type: 'bludgeoning',
    properties: [],
    statBonus: 'strength'
  },
  
  // Unarmed
  unarmed: {
    name: 'Unarmed Strike',
    emoji: '👊',
    damage: { dice: 4, count: 1 },  // 1d4 + STR mod (Monk-style, more variance than flat 1)
    type: 'bludgeoning',
    properties: [],
    statBonus: 'strength'
    // V9: Removed baseDamage so dice are actually rolled (avg 2.5 vs flat 1)
  },
  
  // Magic/Special
  staff_of_power: {
    name: 'Staff of Power',
    emoji: '🪄',
    damage: { dice: 6, count: 1 },
    type: 'bludgeoning',
    properties: ['magical', 'versatile'],
    versatileDamage: { dice: 8, count: 1 },
    attackBonus: 2,
    damageBonus: 2,
    statBonus: 'intelligence'
  }
};

/**
 * Armor type definitions
 */
export const ARMOR_TYPES = {
  // Light Armor
  padded: {
    name: 'Padded Armor',
    emoji: '🧥',
    acBase: 11,
    maxDexBonus: null,  // No limit
    stealthDisadvantage: true,
    category: 'light'
  },
  leather: {
    name: 'Leather Armor',
    emoji: '🧥',
    acBase: 11,
    maxDexBonus: null,
    stealthDisadvantage: false,
    category: 'light'
  },
  studded_leather: {
    name: 'Studded Leather',
    emoji: '🧥',
    acBase: 12,
    maxDexBonus: null,
    stealthDisadvantage: false,
    category: 'light'
  },
  
  // Medium Armor
  hide: {
    name: 'Hide Armor',
    emoji: '🦺',
    acBase: 12,
    maxDexBonus: 2,
    stealthDisadvantage: false,
    category: 'medium'
  },
  chain_shirt: {
    name: 'Chain Shirt',
    emoji: '🦺',
    acBase: 13,
    maxDexBonus: 2,
    stealthDisadvantage: false,
    category: 'medium'
  },
  scale_mail: {
    name: 'Scale Mail',
    emoji: '🦺',
    acBase: 14,
    maxDexBonus: 2,
    stealthDisadvantage: true,
    category: 'medium'
  },
  breastplate: {
    name: 'Breastplate',
    emoji: '🛡️',
    acBase: 14,
    maxDexBonus: 2,
    stealthDisadvantage: false,
    category: 'medium'
  },
  half_plate: {
    name: 'Half Plate',
    emoji: '🛡️',
    acBase: 15,
    maxDexBonus: 2,
    stealthDisadvantage: true,
    category: 'medium'
  },
  
  // Heavy Armor
  ring_mail: {
    name: 'Ring Mail',
    emoji: '⚔️',
    acBase: 14,
    maxDexBonus: 0,
    stealthDisadvantage: true,
    category: 'heavy',
    strengthRequired: 0
  },
  chain_mail: {
    name: 'Chain Mail',
    emoji: '⚔️',
    acBase: 16,
    maxDexBonus: 0,
    stealthDisadvantage: true,
    category: 'heavy',
    strengthRequired: 13
  },
  splint: {
    name: 'Splint Armor',
    emoji: '🛡️',
    acBase: 17,
    maxDexBonus: 0,
    stealthDisadvantage: true,
    category: 'heavy',
    strengthRequired: 15
  },
  plate: {
    name: 'Plate Armor',
    emoji: '🛡️',
    acBase: 18,
    maxDexBonus: 0,
    stealthDisadvantage: true,
    category: 'heavy',
    strengthRequired: 15
  },
  
  // No armor
  unarmored: {
    name: 'Unarmored',
    emoji: '👕',
    acBase: 10,
    maxDexBonus: null,
    stealthDisadvantage: false,
    category: 'none'
  }
};

/**
 * Shield definitions
 */
export const SHIELD_TYPES = {
  shield: {
    name: 'Shield',
    emoji: '🛡️',
    acBonus: 2
  },
  tower_shield: {
    name: 'Tower Shield',
    emoji: '🛡️',
    acBonus: 3,
    attackPenalty: -1
  }
};

export class CombatEquipmentService {
  /**
   * @param {Object} deps
   * @param {Object} deps.logger - Logging service
   * @param {Object} deps.itemService - Item data service
   * @param {Object} deps.diceService - Dice rolling service
   */
  constructor({ logger, itemService, diceService }) {
    this.logger = logger || console;
    this.itemService = itemService;
    this.diceService = diceService;
  }

  /**
   * Get the equipped weapon for an avatar
   * @param {Object} avatar - Avatar object
   * @returns {Object|null} Weapon data with combat stats
   */
  async getEquippedWeapon(avatar) {
    if (!this.itemService) {
      return this._getDefaultWeapon();
    }

    try {
      const items = await this.itemService.getAvatarItems?.(avatar._id || avatar.id);
      if (!items || items.length === 0) {
        return this._getDefaultWeapon();
      }

      // Find equipped weapon
      const equippedWeapon = items.find(item => 
        item.equipped && 
        (item.type === 'weapon' || item.slot === 'weapon' || item.slot === 'mainhand')
      );

      if (!equippedWeapon) {
        return this._getDefaultWeapon();
      }

      return this._parseWeaponItem(equippedWeapon);
    } catch (e) {
      this.logger.warn?.(`[CombatEquipment] Failed to get weapon for ${avatar?.name}: ${e.message}`);
      return this._getDefaultWeapon();
    }
  }

  /**
   * Get the equipped armor for an avatar
   * @param {Object} avatar - Avatar object
   * @returns {Object} Armor data with AC calculation
   */
  async getEquippedArmor(avatar) {
    if (!this.itemService) {
      return this._getDefaultArmor();
    }

    try {
      const items = await this.itemService.getAvatarItems?.(avatar._id || avatar.id);
      if (!items || items.length === 0) {
        return this._getDefaultArmor();
      }

      // Find equipped armor
      const equippedArmor = items.find(item => 
        item.equipped && 
        (item.type === 'armor' || item.slot === 'armor' || item.slot === 'body')
      );

      // Find equipped shield
      const equippedShield = items.find(item => 
        item.equipped && 
        (item.type === 'shield' || item.slot === 'shield' || item.slot === 'offhand')
      );

      const armor = equippedArmor ? this._parseArmorItem(equippedArmor) : this._getDefaultArmor();
      const shield = equippedShield ? this._parseShieldItem(equippedShield) : null;

      return {
        ...armor,
        shield,
        totalACBonus: (shield?.acBonus || 0) + (armor.acBonus || 0)
      };
    } catch (e) {
      this.logger.warn?.(`[CombatEquipment] Failed to get armor for ${avatar?.name}: ${e.message}`);
      return this._getDefaultArmor();
    }
  }

  /**
   * Calculate weapon damage
   * @param {Object} weapon - Weapon object from getEquippedWeapon
   * @param {Object} stats - Avatar stats
   * @param {boolean} isCritical - Whether this is a critical hit
   * @returns {number} Total damage rolled
   */
  rollWeaponDamage(weapon, stats, isCritical = false) {
    if (!weapon) weapon = this._getDefaultWeapon();

    const { dice, count } = weapon.damage;
    let totalDamage = 0;

    // Roll damage dice
    const diceCount = isCritical ? count * 2 : count;
    for (let i = 0; i < diceCount; i++) {
      if (weapon.baseDamage) {
        totalDamage += weapon.baseDamage;
      } else {
        totalDamage += this.diceService?.rollDie?.(dice) || Math.ceil(Math.random() * dice);
      }
    }

    // Add stat modifier
    const statValue = stats?.[weapon.statBonus] || 10;
    const statMod = Math.floor((statValue - 10) / 2);
    totalDamage += statMod;

    // Add weapon bonus
    if (weapon.damageBonus) {
      totalDamage += weapon.damageBonus;
    }

    return Math.max(1, totalDamage);
  }

  /**
   * Calculate weapon attack bonus
   * @param {Object} weapon - Weapon object from getEquippedWeapon
   * @param {Object} stats - Avatar stats
   * @returns {number} Total attack modifier
   */
  getAttackBonus(weapon, stats) {
    if (!weapon) weapon = this._getDefaultWeapon();

    // Stat modifier
    const statValue = stats?.[weapon.statBonus] || 10;
    const statMod = Math.floor((statValue - 10) / 2);

    // Weapon attack bonus (magical weapons)
    const weaponBonus = weapon.attackBonus || 0;

    return statMod + weaponBonus;
  }

  /**
   * Calculate total armor class
   * @param {Object} armor - Armor object from getEquippedArmor
   * @param {Object} stats - Avatar stats
   * @returns {number} Total AC
   */
  calculateAC(armor, stats) {
    if (!armor) armor = this._getDefaultArmor();

    const dexMod = Math.floor(((stats?.dexterity || 10) - 10) / 2);

    // Apply DEX modifier with cap if applicable
    let effectiveDexMod = dexMod;
    if (armor.maxDexBonus !== null && armor.maxDexBonus !== undefined) {
      effectiveDexMod = Math.min(dexMod, armor.maxDexBonus);
    }

    // Base AC + DEX + shield
    let totalAC = armor.acBase + effectiveDexMod;
    
    if (armor.shield?.acBonus) {
      totalAC += armor.shield.acBonus;
    }

    // Armor bonus (magical armor)
    if (armor.acBonus) {
      totalAC += armor.acBonus;
    }

    return totalAC;
  }

  /**
   * Check if avatar has stealth disadvantage from armor
   * @param {Object} armor - Armor object from getEquippedArmor
   * @returns {boolean}
   */
  hasStealthDisadvantage(armor) {
    return armor?.stealthDisadvantage || false;
  }

  /**
   * Get weapon description for display
   * @param {Object} weapon - Weapon object
   * @returns {string}
   */
  getWeaponDescription(weapon) {
    if (!weapon) return 'Unarmed (1 + STR)';
    
    const { dice, count } = weapon.damage;
    const diceStr = count > 1 ? `${count}d${dice}` : `d${dice}`;
    const bonusStr = weapon.damageBonus ? ` +${weapon.damageBonus}` : '';
    const attackBonusStr = weapon.attackBonus ? ` (+${weapon.attackBonus} hit)` : '';
    
    return `${weapon.emoji} ${weapon.name} (${diceStr}${bonusStr} ${weapon.type})${attackBonusStr}`;
  }

  // ============ Private Methods ============

  /**
   * Get default weapon (unarmed)
   * @private
   */
  _getDefaultWeapon() {
    return {
      ...WEAPON_TYPES.unarmed,
      id: 'unarmed'
    };
  }

  /**
   * Get default armor (unarmored)
   * @private
   */
  _getDefaultArmor() {
    return {
      ...ARMOR_TYPES.unarmored,
      id: 'unarmored',
      shield: null
    };
  }

  /**
   * Parse weapon item from inventory into combat format
   * @private
   */
  _parseWeaponItem(item) {
    // Check if item references a known weapon type
    const baseType = item.weaponType || item.baseType || item.subtype;
    const template = WEAPON_TYPES[baseType] || null;

    if (template) {
      return {
        ...template,
        id: item._id || item.id,
        name: item.name || template.name,
        attackBonus: (template.attackBonus || 0) + (item.attackBonus || 0),
        damageBonus: (template.damageBonus || 0) + (item.damageBonus || 0),
        // Override damage if item specifies
        damage: item.damage || template.damage
      };
    }

    // Custom weapon from item data
    return {
      id: item._id || item.id,
      name: item.name || 'Unknown Weapon',
      emoji: item.emoji || '⚔️',
      damage: item.damage || { dice: 6, count: 1 },
      type: item.damageType || 'slashing',
      properties: item.properties || [],
      statBonus: item.statBonus || 'strength',
      attackBonus: item.attackBonus || 0,
      damageBonus: item.damageBonus || 0
    };
  }

  /**
   * Parse armor item from inventory into combat format
   * @private
   */
  _parseArmorItem(item) {
    const baseType = item.armorType || item.baseType || item.subtype;
    const template = ARMOR_TYPES[baseType] || null;

    if (template) {
      return {
        ...template,
        id: item._id || item.id,
        name: item.name || template.name,
        acBonus: item.acBonus || 0  // Magical armor bonus
      };
    }

    // Custom armor from item data
    return {
      id: item._id || item.id,
      name: item.name || 'Unknown Armor',
      emoji: item.emoji || '🛡️',
      acBase: item.acBase || item.ac || 10,
      maxDexBonus: item.maxDexBonus ?? null,
      stealthDisadvantage: item.stealthDisadvantage || false,
      category: item.category || 'light',
      acBonus: item.acBonus || 0
    };
  }

  /**
   * Parse shield item from inventory into combat format
   * @private
   */
  _parseShieldItem(item) {
    const baseType = item.shieldType || item.baseType || item.subtype;
    const template = SHIELD_TYPES[baseType] || SHIELD_TYPES.shield;

    return {
      ...template,
      id: item._id || item.id,
      name: item.name || template.name,
      acBonus: (template.acBonus || 2) + (item.acBonus || 0)
    };
  }
}

export default CombatEquipmentService;
