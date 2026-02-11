/**
 * D&D 5e-inspired spell definitions
 */

export const SPELL_SLOTS = {
  full: {
    1: { 1: 2 },
    2: { 1: 3 },
    3: { 1: 4, 2: 2 },
    4: { 1: 4, 2: 3 },
    5: { 1: 4, 2: 3, 3: 2 },
    6: { 1: 4, 2: 3, 3: 3 },
    7: { 1: 4, 2: 3, 3: 3, 4: 1 },
    8: { 1: 4, 2: 3, 3: 3, 4: 2 },
    9: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 },
    10: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 },
  },
  half: {
    2: { 1: 2 },
    3: { 1: 3 },
    4: { 1: 3 },
    5: { 1: 4, 2: 2 },
    6: { 1: 4, 2: 2 },
    7: { 1: 4, 2: 3 },
    8: { 1: 4, 2: 3 },
    9: { 1: 4, 2: 3, 3: 2 },
    10: { 1: 4, 2: 3, 3: 2 },
  }
};

export const SPELLS = {
  // Cantrips
  fire_bolt: {
    name: 'Fire Bolt',
    level: 0,
    school: 'evocation',
    classes: ['wizard'],
    castingTime: 'action',
    range: 120,
    duration: 'instant',
    attack: 'ranged_spell',
    damage: { dice: 10, count: 1, type: 'fire', cantripScaling: true },
    description: 'Hurl a mote of fire at a creature.'
  },

  sacred_flame: {
    name: 'Sacred Flame',
    level: 0,
    school: 'evocation',
    classes: ['cleric'],
    castingTime: 'action',
    range: 60,
    duration: 'instant',
    save: 'dexterity',
    damage: { dice: 8, count: 1, type: 'radiant', cantripScaling: true },
    description: 'Flame descends on a creature you can see.'
  },

  vicious_mockery: {
    name: 'Vicious Mockery',
    level: 0,
    school: 'enchantment',
    classes: ['bard'],
    castingTime: 'action',
    range: 60,
    duration: 'instant',
    save: 'wisdom',
    damage: { dice: 4, count: 1, type: 'psychic', cantripScaling: true },
    effect: 'disadvantage_next_attack',
    description: 'You unleash a string of insults laced with magic.'
  },

  // Level 1
  magic_missile: {
    name: 'Magic Missile',
    level: 1,
    school: 'evocation',
    classes: ['wizard'],
    castingTime: 'action',
    range: 120,
    duration: 'instant',
    autoHit: true,
    damage: { dice: 4, count: 3, modifier: 3, type: 'force' },
    upcast: { extraDarts: 1 },
    description: 'Three darts of magical force unerringly strike.'
  },

  cure_wounds: {
    name: 'Cure Wounds',
    level: 1,
    school: 'evocation',
    classes: ['cleric', 'bard', 'ranger'],
    castingTime: 'action',
    range: 'touch',
    duration: 'instant',
    healing: { dice: 8, count: 1, addMod: true },
    upcast: { extraDice: 1 },
    description: 'A creature you touch regains hit points.'
  },

  healing_word: {
    name: 'Healing Word',
    level: 1,
    school: 'evocation',
    classes: ['cleric', 'bard'],
    castingTime: 'bonus_action',
    range: 60,
    duration: 'instant',
    healing: { dice: 4, count: 1, addMod: true },
    upcast: { extraDice: 1 },
    description: 'A creature you can see regains hit points.'
  },

  bless: {
    name: 'Bless',
    level: 1,
    school: 'enchantment',
    classes: ['cleric'],
    castingTime: 'action',
    range: 30,
    duration: 60,
    concentration: true,
    targets: 3,
    effect: 'blessed',
    upcast: { extraTargets: 1 },
    description: 'You bless up to three creatures.'
  },

  hunters_mark: {
    name: "Hunter's Mark",
    level: 1,
    school: 'divination',
    classes: ['ranger'],
    castingTime: 'bonus_action',
    range: 90,
    duration: 3600,
    concentration: true,
    effect: 'hunters_mark',
    bonusDamage: { dice: 6, count: 1, type: 'force' },
    description: 'You mark a creature as your quarry.'
  },

  shield: {
    name: 'Shield',
    level: 1,
    school: 'abjuration',
    classes: ['wizard'],
    castingTime: 'reaction',
    range: 'self',
    duration: 6,
    effect: { acBonus: 5 },
    description: '+5 AC until start of your next turn.'
  },

  // Level 2
  hold_person: {
    name: 'Hold Person',
    level: 2,
    school: 'enchantment',
    classes: ['wizard', 'cleric', 'bard'],
    castingTime: 'action',
    range: 60,
    duration: 60,
    concentration: true,
    save: 'wisdom',
    effect: 'paralyzed',
    upcast: { extraTargets: 1 },
    description: 'A humanoid must succeed on a save or be paralyzed.'
  },

  spiritual_weapon: {
    name: 'Spiritual Weapon',
    level: 2,
    school: 'evocation',
    classes: ['cleric'],
    castingTime: 'bonus_action',
    range: 60,
    duration: 60,
    attack: 'melee_spell',
    damage: { dice: 8, count: 1, addMod: true, type: 'force' },
    upcast: { extraDamage: { perSlot: 2, dice: 8, count: 1 } },
    description: 'Create a floating weapon that attacks.'
  },

  // Level 3
  fireball: {
    name: 'Fireball',
    level: 3,
    school: 'evocation',
    classes: ['wizard'],
    castingTime: 'action',
    range: 150,
    duration: 'instant',
    save: 'dexterity',
    aoe: { type: 'sphere', radius: 20 },
    damage: { dice: 6, count: 8, type: 'fire' },
    upcast: { extraDice: 1 },
    description: 'A bright streak explodes into flame.'
  },

  mass_healing_word: {
    name: 'Mass Healing Word',
    level: 3,
    school: 'evocation',
    classes: ['cleric', 'bard'],
    castingTime: 'bonus_action',
    range: 60,
    duration: 'instant',
    targets: 6,
    healing: { dice: 4, count: 1, addMod: true },
    upcast: { extraDice: 1 },
    description: 'Up to six creatures regain hit points.'
  }
};

export function getCantripDamage(level) {
  if (level >= 17) return 4;
  if (level >= 11) return 3;
  if (level >= 5) return 2;
  return 1;
}

export function getSpellSlots(casterType, level) {
  return SPELL_SLOTS[casterType]?.[level] || {};
}
