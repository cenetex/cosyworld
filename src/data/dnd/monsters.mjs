/**
 * D&D 5e-inspired monster definitions
 */

export const MONSTERS = {
  goblin: {
    name: 'Goblin',
    cr: 0.25,
    xp: 50,
    stats: { hp: 7, ac: 15, speed: 30, str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    attacks: [{ name: 'Scimitar', bonus: 4, damage: { dice: 6, count: 1, modifier: 2, type: 'slashing' } }],
    traits: ['nimble_escape'],
    emoji: '👺'
  },

  skeleton: {
    name: 'Skeleton',
    cr: 0.25,
    xp: 50,
    stats: { hp: 13, ac: 13, speed: 30, str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 },
    attacks: [{ name: 'Shortsword', bonus: 4, damage: { dice: 6, count: 1, modifier: 2, type: 'piercing' } }],
    immunities: ['poison'],
    vulnerabilities: ['bludgeoning'],
    emoji: '💀'
  },

  zombie: {
    name: 'Zombie',
    cr: 0.25,
    xp: 50,
    stats: { hp: 22, ac: 8, speed: 20, str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 },
    attacks: [{ name: 'Slam', bonus: 3, damage: { dice: 6, count: 1, modifier: 1, type: 'bludgeoning' } }],
    traits: ['undead_fortitude'],
    immunities: ['poison'],
    emoji: '🧟'
  },

  wolf: {
    name: 'Wolf',
    cr: 0.25,
    xp: 50,
    stats: { hp: 11, ac: 13, speed: 40, str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
    attacks: [{ name: 'Bite', bonus: 4, damage: { dice: 4, count: 2, modifier: 2, type: 'piercing' }, effect: 'knockdown' }],
    traits: ['pack_tactics', 'keen_hearing_smell'],
    emoji: '🐺'
  },

  orc: {
    name: 'Orc',
    cr: 0.5,
    xp: 100,
    stats: { hp: 15, ac: 13, speed: 30, str: 16, dex: 12, con: 16, int: 7, wis: 11, cha: 10 },
    attacks: [{ name: 'Greataxe', bonus: 5, damage: { dice: 12, count: 1, modifier: 3, type: 'slashing' } }],
    traits: ['aggressive'],
    emoji: '👹'
  },

  giant_spider: {
    name: 'Giant Spider',
    cr: 1,
    xp: 200,
    stats: { hp: 26, ac: 14, speed: 30, str: 14, dex: 16, con: 12, int: 2, wis: 11, cha: 4 },
    attacks: [{ name: 'Bite', bonus: 5, damage: { dice: 8, count: 1, modifier: 3, type: 'piercing' }, effect: 'poison_2d8' }],
    traits: ['spider_climb', 'web_sense'],
    emoji: '🕷️'
  },

  bugbear: {
    name: 'Bugbear',
    cr: 1,
    xp: 200,
    stats: { hp: 27, ac: 16, speed: 30, str: 15, dex: 14, con: 13, int: 8, wis: 11, cha: 9 },
    attacks: [{ name: 'Morningstar', bonus: 4, damage: { dice: 8, count: 2, modifier: 2, type: 'piercing' } }],
    traits: ['brute', 'surprise_attack'],
    emoji: '🐻'
  },

  ogre: {
    name: 'Ogre',
    cr: 2,
    xp: 450,
    stats: { hp: 59, ac: 11, speed: 40, str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
    attacks: [{ name: 'Greatclub', bonus: 6, damage: { dice: 8, count: 2, modifier: 4, type: 'bludgeoning' } }],
    emoji: '👤'
  },

  minotaur: {
    name: 'Minotaur',
    cr: 3,
    xp: 700,
    stats: { hp: 76, ac: 14, speed: 40, str: 18, dex: 11, con: 16, int: 6, wis: 16, cha: 9 },
    attacks: [{ name: 'Greataxe', bonus: 6, damage: { dice: 12, count: 2, modifier: 4, type: 'slashing' } }],
    traits: ['charge', 'labyrinthine_recall'],
    emoji: '🐂'
  },

  troll: {
    name: 'Troll',
    cr: 5,
    xp: 1800,
    stats: { hp: 84, ac: 15, speed: 30, str: 18, dex: 13, con: 20, int: 7, wis: 9, cha: 7 },
    attacks: [
      { name: 'Claw', bonus: 7, damage: { dice: 6, count: 2, modifier: 4, type: 'slashing' } },
      { name: 'Bite', bonus: 7, damage: { dice: 6, count: 1, modifier: 4, type: 'piercing' } }
    ],
    traits: ['regeneration', 'keen_smell'],
    emoji: '🧌'
  }
};

export const MONSTER_TRAITS = {
  nimble_escape: { name: 'Nimble Escape', description: 'Disengage or Hide as bonus action' },
  undead_fortitude: { name: 'Undead Fortitude', description: 'On 0 HP, CON save to drop to 1 HP instead' },
  pack_tactics: { name: 'Pack Tactics', description: 'Advantage when ally within 5 ft of target' },
  aggressive: { name: 'Aggressive', description: 'Bonus action to move toward hostile creature' },
  regeneration: { name: 'Regeneration', description: 'Regain 10 HP at start of turn unless fire/acid damage' },
  charge: { name: 'Charge', description: 'Extra 2d8 damage on hit after 10 ft move' }
};

export function getMonstersByCR(cr) {
  return Object.entries(MONSTERS).filter(([, m]) => m.cr === cr).map(([id, m]) => ({ id, ...m }));
}

export function calculateEncounterXP(monsters) {
  return monsters.reduce((sum, m) => sum + (MONSTERS[m.id]?.xp || 0) * (m.count || 1), 0);
}
