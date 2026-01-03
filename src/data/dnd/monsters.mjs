/**
 * D&D 5e-inspired monster definitions
 * 
 * Seed data is loaded from monsters.json and exported for use across the application.
 * The MonsterService seeds these into the database on startup.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const monsterData = require('./monsters.json');

export const MONSTERS = monsterData.monsters;
export const MONSTER_TRAITS = monsterData.traits;

export function getMonstersByCR(cr) {
  return Object.entries(MONSTERS).filter(([, m]) => m.cr === cr).map(([id, m]) => ({ id, ...m }));
}

export function calculateEncounterXP(monsters) {
  return monsters.reduce((sum, m) => sum + (MONSTERS[m.id]?.xp || 0) * (m.count || 1), 0);
}
