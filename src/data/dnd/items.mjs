/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * D&D 5e-inspired item definitions for loot and treasure
 */

/**
 * Item rarity levels with associated value multipliers
 */
export const RARITY = {
  common: { name: 'Common', color: '#9e9e9e', valueMultiplier: 1 },
  uncommon: { name: 'Uncommon', color: '#4caf50', valueMultiplier: 5 },
  rare: { name: 'Rare', color: '#2196f3', valueMultiplier: 25 },
  veryRare: { name: 'Very Rare', color: '#9c27b0', valueMultiplier: 100 },
  legendary: { name: 'Legendary', color: '#ff9800', valueMultiplier: 500 }
};

/**
 * Weapon definitions
 */
export const WEAPONS = {
  dagger: {
    name: 'Dagger',
    type: 'weapon',
    subtype: 'simple',
    damage: { dice: 4, count: 1, type: 'piercing' },
    properties: ['finesse', 'light', 'thrown'],
    range: { normal: 20, long: 60 },
    weight: 1,
    value: 2,
    emoji: '🗡️'
  },
  shortsword: {
    name: 'Shortsword',
    type: 'weapon',
    subtype: 'martial',
    damage: { dice: 6, count: 1, type: 'piercing' },
    properties: ['finesse', 'light'],
    weight: 2,
    value: 10,
    emoji: '⚔️'
  },
  longsword: {
    name: 'Longsword',
    type: 'weapon',
    subtype: 'martial',
    damage: { dice: 8, count: 1, type: 'slashing' },
    properties: ['versatile'],
    versatileDice: 10,
    weight: 3,
    value: 15,
    emoji: '🗡️'
  },
  greataxe: {
    name: 'Greataxe',
    type: 'weapon',
    subtype: 'martial',
    damage: { dice: 12, count: 1, type: 'slashing' },
    properties: ['heavy', 'two-handed'],
    weight: 7,
    value: 30,
    emoji: '🪓'
  },
  shortbow: {
    name: 'Shortbow',
    type: 'weapon',
    subtype: 'simple',
    damage: { dice: 6, count: 1, type: 'piercing' },
    properties: ['ammunition', 'two-handed'],
    range: { normal: 80, long: 320 },
    weight: 2,
    value: 25,
    emoji: '🏹'
  },
  longbow: {
    name: 'Longbow',
    type: 'weapon',
    subtype: 'martial',
    damage: { dice: 8, count: 1, type: 'piercing' },
    properties: ['ammunition', 'heavy', 'two-handed'],
    range: { normal: 150, long: 600 },
    weight: 2,
    value: 50,
    emoji: '🏹'
  },
  staff: {
    name: 'Quarterstaff',
    type: 'weapon',
    subtype: 'simple',
    damage: { dice: 6, count: 1, type: 'bludgeoning' },
    properties: ['versatile'],
    versatileDice: 8,
    weight: 4,
    value: 2,
    emoji: '🪄'
  },
  mace: {
    name: 'Mace',
    type: 'weapon',
    subtype: 'simple',
    damage: { dice: 6, count: 1, type: 'bludgeoning' },
    weight: 4,
    value: 5,
    emoji: '🔨'
  }
};

/**
 * Armor definitions
 */
export const ARMOR = {
  leather: {
    name: 'Leather Armor',
    type: 'armor',
    subtype: 'light',
    ac: 11,
    addDex: true,
    maxDex: null,
    weight: 10,
    value: 10,
    emoji: '🦺'
  },
  studded_leather: {
    name: 'Studded Leather',
    type: 'armor',
    subtype: 'light',
    ac: 12,
    addDex: true,
    maxDex: null,
    weight: 13,
    value: 45,
    emoji: '🦺'
  },
  chain_shirt: {
    name: 'Chain Shirt',
    type: 'armor',
    subtype: 'medium',
    ac: 13,
    addDex: true,
    maxDex: 2,
    weight: 20,
    value: 50,
    emoji: '🛡️'
  },
  scale_mail: {
    name: 'Scale Mail',
    type: 'armor',
    subtype: 'medium',
    ac: 14,
    addDex: true,
    maxDex: 2,
    stealthDisadvantage: true,
    weight: 45,
    value: 50,
    emoji: '🛡️'
  },
  chain_mail: {
    name: 'Chain Mail',
    type: 'armor',
    subtype: 'heavy',
    ac: 16,
    addDex: false,
    strRequired: 13,
    stealthDisadvantage: true,
    weight: 55,
    value: 75,
    emoji: '🛡️'
  },
  plate: {
    name: 'Plate Armor',
    type: 'armor',
    subtype: 'heavy',
    ac: 18,
    addDex: false,
    strRequired: 15,
    stealthDisadvantage: true,
    weight: 65,
    value: 1500,
    emoji: '🛡️'
  },
  shield: {
    name: 'Shield',
    type: 'armor',
    subtype: 'shield',
    acBonus: 2,
    weight: 6,
    value: 10,
    emoji: '🛡️'
  }
};

/**
 * Consumable items (potions, scrolls, etc.)
 */
export const CONSUMABLES = {
  potion_healing: {
    name: 'Potion of Healing',
    type: 'consumable',
    subtype: 'potion',
    effect: { type: 'healing', dice: 4, count: 2, modifier: 2 },
    rarity: 'common',
    value: 50,
    emoji: '🧪'
  },
  potion_greater_healing: {
    name: 'Potion of Greater Healing',
    type: 'consumable',
    subtype: 'potion',
    effect: { type: 'healing', dice: 8, count: 4, modifier: 4 },
    rarity: 'uncommon',
    value: 150,
    emoji: '🧪'
  },
  potion_superior_healing: {
    name: 'Potion of Superior Healing',
    type: 'consumable',
    subtype: 'potion',
    effect: { type: 'healing', dice: 8, count: 8, modifier: 8 },
    rarity: 'rare',
    value: 450,
    emoji: '🧪'
  },
  potion_fire_resistance: {
    name: 'Potion of Fire Resistance',
    type: 'consumable',
    subtype: 'potion',
    effect: { type: 'resistance', damageType: 'fire', duration: 3600 },
    rarity: 'uncommon',
    value: 150,
    emoji: '🔥'
  },
  scroll_fireball: {
    name: 'Scroll of Fireball',
    type: 'consumable',
    subtype: 'scroll',
    spellId: 'fireball',
    spellLevel: 3,
    rarity: 'uncommon',
    value: 200,
    emoji: '📜'
  },
  scroll_cure_wounds: {
    name: 'Scroll of Cure Wounds',
    type: 'consumable',
    subtype: 'scroll',
    spellId: 'cure_wounds',
    spellLevel: 1,
    rarity: 'common',
    value: 50,
    emoji: '📜'
  },
  antidote: {
    name: 'Antidote',
    type: 'consumable',
    subtype: 'potion',
    effect: { type: 'cure', condition: 'poisoned' },
    rarity: 'common',
    value: 50,
    emoji: '💊'
  }
};

/**
 * Treasure and valuable items
 */
export const TREASURE = {
  gold_coins: {
    name: 'Gold Coins',
    type: 'treasure',
    subtype: 'currency',
    stackable: true,
    value: 1,
    emoji: '🪙'
  },
  silver_coins: {
    name: 'Silver Coins',
    type: 'treasure',
    subtype: 'currency',
    stackable: true,
    value: 0.1,
    emoji: '🥈'
  },
  gemstone_small: {
    name: 'Small Gemstone',
    type: 'treasure',
    subtype: 'gem',
    value: 10,
    emoji: '💎'
  },
  gemstone_medium: {
    name: 'Fine Gemstone',
    type: 'treasure',
    subtype: 'gem',
    value: 50,
    emoji: '💎'
  },
  gemstone_large: {
    name: 'Flawless Gemstone',
    type: 'treasure',
    subtype: 'gem',
    value: 100,
    emoji: '💎'
  },
  art_object: {
    name: 'Art Object',
    type: 'treasure',
    subtype: 'art',
    value: 25,
    emoji: '🏺'
  },
  ornate_jewelry: {
    name: 'Ornate Jewelry',
    type: 'treasure',
    subtype: 'jewelry',
    value: 75,
    emoji: '💍'
  }
};

/**
 * Magic items with bonuses
 */
export const MAGIC_ITEMS = {
  sword_plus_1: {
    name: 'Longsword +1',
    type: 'weapon',
    basedOn: 'longsword',
    bonus: 1,
    rarity: 'uncommon',
    value: 500,
    emoji: '⚔️',
    magical: true
  },
  shield_plus_1: {
    name: 'Shield +1',
    type: 'armor',
    basedOn: 'shield',
    bonus: 1,
    rarity: 'uncommon',
    value: 500,
    emoji: '🛡️',
    magical: true
  },
  ring_protection: {
    name: 'Ring of Protection',
    type: 'wondrous',
    slot: 'ring',
    effect: { type: 'ac_bonus', value: 1, saves_bonus: 1 },
    rarity: 'rare',
    value: 3500,
    emoji: '💍',
    magical: true,
    attunement: true
  },
  cloak_elvenkind: {
    name: 'Cloak of Elvenkind',
    type: 'wondrous',
    slot: 'cloak',
    effect: { type: 'advantage', skill: 'stealth' },
    rarity: 'uncommon',
    value: 800,
    emoji: '🧥',
    magical: true,
    attunement: true
  },
  boots_elvenkind: {
    name: 'Boots of Elvenkind',
    type: 'wondrous',
    slot: 'boots',
    effect: { type: 'advantage', skill: 'stealth' },
    rarity: 'uncommon',
    value: 500,
    emoji: '👢',
    magical: true
  },
  bag_of_holding: {
    name: 'Bag of Holding',
    type: 'wondrous',
    slot: 'none',
    effect: { type: 'storage', capacity: 500 },
    rarity: 'uncommon',
    value: 500,
    emoji: '👜',
    magical: true
  },
  amulet_health: {
    name: 'Amulet of Health',
    type: 'wondrous',
    slot: 'neck',
    effect: { type: 'set_stat', stat: 'constitution', value: 19 },
    rarity: 'rare',
    value: 8000,
    emoji: '📿',
    magical: true,
    attunement: true
  }
};

/**
 * Mundane adventuring gear
 */
export const ADVENTURING_GEAR = {
  torch: {
    name: 'Torch',
    type: 'gear',
    subtype: 'light',
    value: 0.01,
    weight: 1,
    emoji: '🔦'
  },
  rope: {
    name: 'Rope (50 ft)',
    type: 'gear',
    subtype: 'exploration',
    value: 1,
    weight: 10,
    emoji: '🪢'
  },
  rations: {
    name: 'Rations (1 day)',
    type: 'gear',
    subtype: 'food',
    value: 0.5,
    weight: 2,
    stackable: true,
    emoji: '🍖'
  },
  lockpicks: {
    name: 'Thieves\' Tools',
    type: 'gear',
    subtype: 'tools',
    value: 25,
    weight: 1,
    emoji: '🔐'
  },
  healers_kit: {
    name: 'Healer\'s Kit',
    type: 'gear',
    subtype: 'tools',
    uses: 10,
    value: 5,
    weight: 3,
    emoji: '🩹'
  }
};

/**
 * All items combined
 */
export const ALL_ITEMS = {
  ...WEAPONS,
  ...ARMOR,
  ...CONSUMABLES,
  ...TREASURE,
  ...MAGIC_ITEMS,
  ...ADVENTURING_GEAR
};

/**
 * Loot tables by dungeon difficulty / party level
 */
export const LOOT_TABLES = {
  // CR 0-1 encounter loot
  easy: {
    gold: { min: 5, max: 20 },
    items: [
      { id: 'potion_healing', weight: 30 },
      { id: 'dagger', weight: 15 },
      { id: 'torch', weight: 20 },
      { id: 'rations', weight: 15 },
      { id: 'silver_coins', weight: 10, count: { min: 5, max: 20 } },
      { id: 'gemstone_small', weight: 10 }
    ],
    dropChance: 0.4
  },
  // CR 1-3 encounter loot
  medium: {
    gold: { min: 15, max: 50 },
    items: [
      { id: 'potion_healing', weight: 25 },
      { id: 'potion_greater_healing', weight: 10 },
      { id: 'shortsword', weight: 10 },
      { id: 'leather', weight: 8 },
      { id: 'scroll_cure_wounds', weight: 12 },
      { id: 'gemstone_small', weight: 15 },
      { id: 'gemstone_medium', weight: 8 },
      { id: 'art_object', weight: 12 }
    ],
    dropChance: 0.5
  },
  // CR 3-5 encounter loot
  hard: {
    gold: { min: 40, max: 120 },
    items: [
      { id: 'potion_greater_healing', weight: 20 },
      { id: 'potion_fire_resistance', weight: 8 },
      { id: 'longsword', weight: 10 },
      { id: 'chain_shirt', weight: 8 },
      { id: 'scroll_fireball', weight: 10 },
      { id: 'gemstone_medium', weight: 12 },
      { id: 'gemstone_large', weight: 8 },
      { id: 'ornate_jewelry', weight: 10 },
      { id: 'boots_elvenkind', weight: 5 },
      { id: 'cloak_elvenkind', weight: 4 },
      { id: 'sword_plus_1', weight: 5 }
    ],
    dropChance: 0.6
  },
  // CR 5+ / boss encounter loot
  deadly: {
    gold: { min: 100, max: 300 },
    items: [
      { id: 'potion_greater_healing', weight: 15 },
      { id: 'potion_superior_healing', weight: 10 },
      { id: 'greataxe', weight: 8 },
      { id: 'plate', weight: 5 },
      { id: 'gemstone_large', weight: 12 },
      { id: 'ornate_jewelry', weight: 10 },
      { id: 'sword_plus_1', weight: 10 },
      { id: 'shield_plus_1', weight: 8 },
      { id: 'ring_protection', weight: 5 },
      { id: 'bag_of_holding', weight: 7 },
      { id: 'amulet_health', weight: 3 }
    ],
    dropChance: 0.8
  }
};

/**
 * Get item by ID from any category
 * @param {string} itemId - The item identifier
 * @returns {Object|null} Item definition or null if not found
 */
export function getItem(itemId) {
  return ALL_ITEMS[itemId] || null;
}

/**
 * Roll for treasure from a loot table
 * @param {string} difficulty - Loot table difficulty (easy, medium, hard, deadly)
 * @param {number} partyLevel - Party level for scaling
 * @param {Function} rollDie - Dice rolling function (from DiceService)
 * @returns {Object} { gold: number, items: Array<{id, name, count}> }
 */
export function rollTreasure(difficulty, partyLevel, rollDie) {
  const table = LOOT_TABLES[difficulty] || LOOT_TABLES.medium;
  
  // Roll gold (scaled by party level)
  const levelMultiplier = 1 + (partyLevel - 1) * 0.2;
  const goldRange = table.gold.max - table.gold.min;
  const baseGold = table.gold.min + rollDie(goldRange + 1) - 1;
  const gold = Math.floor(baseGold * levelMultiplier);
  
  const items = [];
  
  // Roll for item drops
  if (Math.random() < table.dropChance) {
    const totalWeight = table.items.reduce((sum, i) => sum + i.weight, 0);
    let roll = rollDie(totalWeight);
    
    for (const entry of table.items) {
      roll -= entry.weight;
      if (roll <= 0) {
        const item = getItem(entry.id);
        if (item) {
          const count = entry.count 
            ? entry.count.min + rollDie(entry.count.max - entry.count.min + 1) - 1
            : 1;
          items.push({
            id: entry.id,
            name: item.name,
            count,
            value: item.value * count,
            rarity: item.rarity || 'common',
            emoji: item.emoji
          });
        }
        break;
      }
    }
  }
  
  // Small chance for bonus item on harder difficulties
  if ((difficulty === 'hard' || difficulty === 'deadly') && Math.random() < 0.15) {
    const bonusItems = table.items.filter(i => {
      const item = getItem(i.id);
      return item?.rarity && item.rarity !== 'common';
    });
    
    if (bonusItems.length > 0) {
      const bonusEntry = bonusItems[rollDie(bonusItems.length) - 1];
      const bonusItem = getItem(bonusEntry.id);
      if (bonusItem && !items.some(i => i.id === bonusEntry.id)) {
        items.push({
          id: bonusEntry.id,
          name: bonusItem.name,
          count: 1,
          value: bonusItem.value,
          rarity: bonusItem.rarity || 'common',
          emoji: bonusItem.emoji
        });
      }
    }
  }
  
  return { gold, items };
}

/**
 * Get item rarity color for display
 * @param {string} rarity - Rarity level
 * @returns {string} Hex color code
 */
export function getRarityColor(rarity) {
  return RARITY[rarity]?.color || RARITY.common.color;
}
