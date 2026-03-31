#!/usr/bin/env node
/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * Backfill character sheets for existing avatars that don't have one.
 * Uses AI to generate appropriate class/race/background based on avatar personality.
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'cosyworld8';

// Simple class definitions for HP calculation
const CLASS_HIT_DICE = {
  fighter: 10,
  wizard: 6,
  rogue: 8,
  cleric: 8,
  ranger: 10,
  bard: 8
};

// Race stat bonuses
const RACE_BONUSES = {
  human: { strength: 1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 },
  elf: { dexterity: 2 },
  dwarf: { constitution: 2 },
  halfling: { dexterity: 2 }
};

/**
 * Select class/race/background based on avatar traits (simple heuristic, no AI needed for backfill)
 */
function selectCharacterOptions(avatar) {
  const name = (avatar.name || '').toLowerCase();
  const desc = (avatar.description || '').toLowerCase();
  const personality = (avatar.personality || '').toLowerCase();
  const combined = `${name} ${desc} ${personality}`;

  // Class selection heuristics
  let className = 'fighter';
  if (combined.includes('magic') || combined.includes('wizard') || combined.includes('spell') || combined.includes('arcane')) {
    className = 'wizard';
  } else if (combined.includes('sneak') || combined.includes('thief') || combined.includes('shadow') || combined.includes('cunning')) {
    className = 'rogue';
  } else if (combined.includes('heal') || combined.includes('holy') || combined.includes('divine') || combined.includes('priest')) {
    className = 'cleric';
  } else if (combined.includes('nature') || combined.includes('ranger') || combined.includes('hunt') || combined.includes('forest')) {
    className = 'ranger';
  } else if (combined.includes('music') || combined.includes('song') || combined.includes('perform') || combined.includes('charm')) {
    className = 'bard';
  }

  // Race selection heuristics
  let race = 'human';
  if (combined.includes('elf') || combined.includes('elven') || combined.includes('graceful')) {
    race = 'elf';
  } else if (combined.includes('dwarf') || combined.includes('dwarven') || combined.includes('sturdy') || combined.includes('forge')) {
    race = 'dwarf';
  } else if (combined.includes('halfling') || combined.includes('small') || combined.includes('hobbit') || combined.includes('nimble')) {
    race = 'halfling';
  }

  // Background selection heuristics
  let background = 'soldier';
  if (combined.includes('scholar') || combined.includes('study') || combined.includes('book') || combined.includes('knowledge')) {
    background = 'sage';
  } else if (combined.includes('criminal') || combined.includes('thief') || combined.includes('outlaw')) {
    background = 'criminal';
  } else if (combined.includes('temple') || combined.includes('religious') || combined.includes('faith')) {
    background = 'acolyte';
  } else if (combined.includes('perform') || combined.includes('entertainer') || combined.includes('artist')) {
    background = 'entertainer';
  } else if (combined.includes('hermit') || combined.includes('solitary') || combined.includes('recluse')) {
    background = 'hermit';
  }

  return { className, race, background };
}

async function backfillCharacterSheets() {
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI not found in environment');
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);
  
  try {
    console.log('🔌 Connecting to MongoDB...');
    await client.connect();
    const db = client.db(DB_NAME);
    const avatars = db.collection('avatars');
    const sheets = db.collection('character_sheets');

    // Get all avatar IDs that already have sheets
    const existingSheetAvatarIds = await sheets.distinct('avatarId');

    // Find avatars without character sheets (alive only)
    const avatarsWithoutSheets = await avatars.find({
      status: { $ne: 'dead' },
      _id: { $nin: existingSheetAvatarIds }
    }).toArray();

    console.log(`📊 Found ${avatarsWithoutSheets.length} avatars without character sheets`);

    if (avatarsWithoutSheets.length === 0) {
      console.log('✅ All avatars already have character sheets!');
      return;
    }

    let created = 0;
    let failed = 0;

    for (const avatar of avatarsWithoutSheets) {
      try {
        // Double-check not already created (race condition protection)
        const existing = await sheets.findOne({ avatarId: avatar._id });
        if (existing) {
          console.log(`⏭️ ${avatar.name} already has a sheet (race condition)`);
          continue;
        }

        const { className, race, background } = selectCharacterOptions(avatar);

        // Get avatar stats (or use defaults)
        const stats = avatar.stats || {
          strength: 10,
          dexterity: 10,
          constitution: 10,
          intelligence: 10,
          wisdom: 10,
          charisma: 10
        };

        // Apply racial bonuses
        const bonuses = RACE_BONUSES[race] || {};
        const finalStats = { ...stats };
        for (const [stat, bonus] of Object.entries(bonuses)) {
          finalStats[stat] = (finalStats[stat] || 10) + bonus;
        }

        // Calculate HP
        const conMod = Math.floor(((finalStats.constitution || 10) - 10) / 2);
        const hitDice = CLASS_HIT_DICE[className] || 8;
        const maxHp = Math.max(1, hitDice + conMod);

        // Create the character sheet
        const sheet = {
          avatarId: avatar._id,
          class: className,
          subclass: null,
          race,
          subrace: null,
          background,
          level: 1,
          experience: 0,
          proficiencyBonus: 2,
          hitDice: { current: 1, max: 1, size: hitDice },
          spellcasting: null, // Simplified - no spellcasting for backfill
          features: [],
          proficiencies: {
            armor: [],
            weapons: [],
            saves: [],
            skills: []
          },
          concentration: null,
          partyId: null,
          campaignId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          _backfilled: true
        };

        await sheets.insertOne(sheet);

        // Update avatar stats with racial bonuses and HP
        await avatars.updateOne(
          { _id: avatar._id },
          { 
            $set: { 
              stats: {
                ...finalStats,
                hp: maxHp,
                maxHp: maxHp
              },
              updatedAt: new Date()
            }
          }
        );

        console.log(`✅ Created ${race} ${className} sheet for ${avatar.name}`);
        created++;
      } catch (e) {
        console.error(`❌ Failed to create sheet for ${avatar.name}: ${e.message}`);
        failed++;
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Created: ${created}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📋 Total: ${avatarsWithoutSheets.length}`);

  } catch (e) {
    console.error('❌ Error:', e);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the backfill
backfillCharacterSheets().catch(console.error);
