/**
 * D&D 5e-inspired class definitions
 */

export const CLASSES = {
  fighter: {
    name: 'Fighter',
    hitDice: 10,
    primaryAbility: 'strength',
    savingThrows: ['strength', 'constitution'],
    armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
    weaponProficiencies: ['simple', 'martial'],
    skillChoices: ['acrobatics', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'],
    skillCount: 2,
    spellcasting: null,
    features: {
      1: [{ id: 'fighting_style', name: 'Fighting Style' }, { id: 'second_wind', name: 'Second Wind', uses: { max: 1, recharge: 'short_rest' } }],
      2: [{ id: 'action_surge', name: 'Action Surge', uses: { max: 1, recharge: 'short_rest' } }],
      3: [{ id: 'martial_archetype', name: 'Martial Archetype' }],
      5: [{ id: 'extra_attack', name: 'Extra Attack' }],
    }
  },

  wizard: {
    name: 'Wizard',
    hitDice: 6,
    primaryAbility: 'intelligence',
    savingThrows: ['intelligence', 'wisdom'],
    armorProficiencies: [],
    weaponProficiencies: ['dagger', 'dart', 'sling', 'quarterstaff', 'light_crossbow'],
    skillChoices: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'],
    skillCount: 2,
    spellcasting: { ability: 'intelligence', type: 'full', prepared: true },
    features: {
      1: [{ id: 'arcane_recovery', name: 'Arcane Recovery', uses: { max: 1, recharge: 'long_rest' } }],
      2: [{ id: 'arcane_tradition', name: 'Arcane Tradition' }],
    }
  },

  rogue: {
    name: 'Rogue',
    hitDice: 8,
    primaryAbility: 'dexterity',
    savingThrows: ['dexterity', 'intelligence'],
    armorProficiencies: ['light'],
    weaponProficiencies: ['simple', 'hand_crossbow', 'longsword', 'rapier', 'shortsword'],
    skillChoices: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight_of_hand', 'stealth'],
    skillCount: 4,
    spellcasting: null,
    features: {
      1: [{ id: 'sneak_attack', name: 'Sneak Attack' }, { id: 'thieves_cant', name: "Thieves' Cant" }],
      2: [{ id: 'cunning_action', name: 'Cunning Action' }],
      3: [{ id: 'roguish_archetype', name: 'Roguish Archetype' }],
      5: [{ id: 'uncanny_dodge', name: 'Uncanny Dodge' }],
    }
  },

  cleric: {
    name: 'Cleric',
    hitDice: 8,
    primaryAbility: 'wisdom',
    savingThrows: ['wisdom', 'charisma'],
    armorProficiencies: ['light', 'medium', 'shields'],
    weaponProficiencies: ['simple'],
    skillChoices: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
    skillCount: 2,
    spellcasting: { ability: 'wisdom', type: 'full', prepared: true },
    features: {
      1: [{ id: 'divine_domain', name: 'Divine Domain' }],
      2: [{ id: 'channel_divinity', name: 'Channel Divinity', uses: { max: 1, recharge: 'short_rest' } }],
      5: [{ id: 'destroy_undead', name: 'Destroy Undead' }],
    }
  },

  ranger: {
    name: 'Ranger',
    hitDice: 10,
    primaryAbility: 'dexterity',
    savingThrows: ['strength', 'dexterity'],
    armorProficiencies: ['light', 'medium', 'shields'],
    weaponProficiencies: ['simple', 'martial'],
    skillChoices: ['animal_handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'],
    skillCount: 3,
    spellcasting: { ability: 'wisdom', type: 'half', prepared: false },
    features: {
      1: [{ id: 'favored_enemy', name: 'Favored Enemy' }, { id: 'natural_explorer', name: 'Natural Explorer' }],
      2: [{ id: 'fighting_style', name: 'Fighting Style' }],
      3: [{ id: 'ranger_archetype', name: 'Ranger Archetype' }, { id: 'primeval_awareness', name: 'Primeval Awareness' }],
      5: [{ id: 'extra_attack', name: 'Extra Attack' }],
    }
  },

  bard: {
    name: 'Bard',
    hitDice: 8,
    primaryAbility: 'charisma',
    savingThrows: ['dexterity', 'charisma'],
    armorProficiencies: ['light'],
    weaponProficiencies: ['simple', 'hand_crossbow', 'longsword', 'rapier', 'shortsword'],
    skillChoices: ['any'],
    skillCount: 3,
    spellcasting: { ability: 'charisma', type: 'full', prepared: false },
    features: {
      1: [{ id: 'bardic_inspiration', name: 'Bardic Inspiration', uses: { max: 'charisma', recharge: 'long_rest' } }],
      2: [{ id: 'jack_of_all_trades', name: 'Jack of All Trades' }, { id: 'song_of_rest', name: 'Song of Rest' }],
      3: [{ id: 'bard_college', name: 'Bard College' }, { id: 'expertise', name: 'Expertise' }],
      5: [{ id: 'font_of_inspiration', name: 'Font of Inspiration' }],
    }
  }
};

export const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

export const PROFICIENCY_BY_LEVEL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];

export function getLevelFromXP(xp) {
  for (let i = XP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= XP_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

export function getProficiencyBonus(level) {
  return PROFICIENCY_BY_LEVEL[Math.min(level, 20) - 1];
}
