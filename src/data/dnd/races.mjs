/**
 * D&D 5e-inspired race definitions
 */

export const RACES = {
  human: {
    name: 'Human',
    statBonuses: { strength: 1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 },
    speed: 30,
    traits: ['versatile'],
    languages: ['common', 'choice'],
    description: 'Adaptable and ambitious, humans are the most versatile of all races.'
  },

  elf: {
    name: 'Elf',
    statBonuses: { dexterity: 2 },
    speed: 30,
    traits: ['darkvision', 'fey_ancestry', 'trance', 'keen_senses'],
    languages: ['common', 'elvish'],
    description: 'Elves are a magical people of grace, living in places of ethereal beauty.'
  },

  dwarf: {
    name: 'Dwarf',
    statBonuses: { constitution: 2 },
    speed: 25,
    traits: ['darkvision', 'dwarven_resilience', 'stonecunning'],
    languages: ['common', 'dwarvish'],
    description: 'Bold and hardy, dwarves are known as skilled warriors and craftsmen.'
  },

  halfling: {
    name: 'Halfling',
    statBonuses: { dexterity: 2 },
    speed: 25,
    traits: ['lucky', 'brave', 'nimble'],
    languages: ['common', 'halfling'],
    description: 'Small but capable, halflings prefer peace but are fierce when roused.'
  }
};

export const RACIAL_TRAITS = {
  versatile: { name: 'Versatile', description: '+1 to all ability scores' },
  darkvision: { name: 'Darkvision', description: 'See in dim light within 60 feet as if bright light' },
  fey_ancestry: { name: 'Fey Ancestry', description: 'Advantage on saves vs charmed, immune to magical sleep' },
  trance: { name: 'Trance', description: 'Meditate 4 hours instead of sleeping 8' },
  keen_senses: { name: 'Keen Senses', description: 'Proficiency in Perception' },
  dwarven_resilience: { name: 'Dwarven Resilience', description: 'Advantage on saves vs poison, resistance to poison damage' },
  stonecunning: { name: 'Stonecunning', description: 'Double proficiency on History checks related to stonework' },
  lucky: { name: 'Lucky', description: 'Reroll natural 1s on attack, ability, or save' },
  brave: { name: 'Brave', description: 'Advantage on saves vs frightened' },
  nimble: { name: 'Nimble', description: 'Move through space of larger creatures' }
};

export const BACKGROUNDS = {
  soldier: { name: 'Soldier', skills: ['athletics', 'intimidation'], description: 'War is your life.' },
  sage: { name: 'Sage', skills: ['arcana', 'history'], description: 'Years of study have shaped you.' },
  criminal: { name: 'Criminal', skills: ['deception', 'stealth'], description: 'You have a history of breaking the law.' },
  acolyte: { name: 'Acolyte', skills: ['insight', 'religion'], description: 'You have spent your life in service to a temple.' },
  entertainer: { name: 'Entertainer', skills: ['acrobatics', 'performance'], description: 'You thrive before an audience.' },
  hermit: { name: 'Hermit', skills: ['medicine', 'religion'], description: 'You lived in seclusion for a formative part of your life.' }
};
