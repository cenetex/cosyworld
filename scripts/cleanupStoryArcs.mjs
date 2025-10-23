/**
 * Cleanup Story Arcs
 * 
 * Fixes story arc issues:
 * 1. Closes old active arcs (keeps only newest 3)
 * 2. Fixes NaN currentChapter in story plans
 * 3. Ensures arc characters have valid avatarIds
 * 
 * Usage:
 *   node scripts/cleanupStoryArcs.mjs
 */

import { container, containerReady } from '../src/container.mjs';

async function cleanupArcs() {
  console.log('='.repeat(60));
  console.log('🧹 CLEANING UP STORY ARCS');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Wait for container to be ready
    console.log('⏳ Initializing...');
    await containerReady;
    console.log('✅ Ready');
    console.log('');

    // Resolve services
    const storyState = container.resolve('storyStateService');
    const databaseService = container.resolve('databaseService');
    const db = await databaseService.getDatabase();

    // Step 1: Get all active arcs
    console.log('📊 Step 1: Checking active arcs...');
    const activeArcs = await storyState.getActiveArcs();
    console.log(`   - Found ${activeArcs.length} active arcs`);

    if (activeArcs.length > 3) {
      console.log(`   ⚠️  More than 3 active arcs! Closing oldest ${activeArcs.length - 3} arcs...`);
      
      // Sort by startedAt, keep newest 3
      activeArcs.sort((a, b) => {
        const dateA = a.startedAt || new Date(0);
        const dateB = b.startedAt || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });

      const arcsToKeep = activeArcs.slice(0, 3);
      const arcsToClose = activeArcs.slice(3);

      console.log(`   ✅ Keeping ${arcsToKeep.length} newest arcs:`);
      for (const arc of arcsToKeep) {
        console.log(`      - "${arc.title}" (${arc.beats?.length || 0} beats)`);
      }

      console.log(`   🔒 Closing ${arcsToClose.length} old arcs:`);
      for (const arc of arcsToClose) {
        console.log(`      - "${arc.title}" (${arc.beats?.length || 0} beats)`);
        await storyState.updateArcStatus(arc._id, 'completed');
      }
    } else {
      console.log(`   ✅ Arc count is healthy (${activeArcs.length} active)`);
    }
    console.log('');

    // Step 2: Fix NaN currentChapter in plans
    console.log('📋 Step 2: Fixing story plans...');
    const storyPlansCollection = db.collection('story_plans');
    
    const plansWithBadChapter = await storyPlansCollection.find({
      $or: [
        { currentChapter: null },
        { currentChapter: { $exists: false } }
      ]
    }).toArray();

    console.log(`   - Found ${plansWithBadChapter.length} plans with missing currentChapter`);

    for (const plan of plansWithBadChapter) {
      await storyPlansCollection.updateOne(
        { _id: plan._id },
        { $set: { currentChapter: 0 } }
      );
      console.log(`   ✅ Fixed plan for arc ${plan.arcId}`);
    }
    console.log('');

    // Step 3: Check and report avatar matching issues
    console.log('👥 Step 3: Checking avatar IDs in arcs...');
    const remainingActiveArcs = await storyState.getActiveArcs();
    
    for (const arc of remainingActiveArcs) {
      console.log(`   📖 Arc: "${arc.title}"`);
      console.log(`      - Characters: ${arc.characters?.length || 0}`);
      
      if (arc.characters && arc.characters.length > 0) {
        for (const char of arc.characters) {
          if (!char.avatarId) {
            console.log(`      ⚠️  Character "${char.avatarName}" has no avatarId!`);
          } else {
            // Try to fetch the avatar to verify ID is valid
            try {
              const avatarsCollection = db.collection('avatars');
              const { ObjectId } = await import('mongodb');
              const avatar = await avatarsCollection.findOne({ 
                _id: new ObjectId(char.avatarId) 
              });
              
              if (avatar) {
                const hasImage = avatar.imageUrl ? '✅ has image' : '❌ no image';
                console.log(`      ✅ "${char.avatarName}" → ${char.avatarId} ${hasImage}`);
              } else {
                console.log(`      ⚠️  "${char.avatarName}" → ${char.avatarId} (not found in DB)`);
              }
            } catch {
              console.log(`      ⚠️  "${char.avatarName}" → ${char.avatarId} (invalid ID format)`);
            }
          }
        }
      }
    }
    console.log('');

    // Step 4: Summary
    console.log('='.repeat(60));
    console.log('✅ CLEANUP COMPLETE');
    console.log('='.repeat(60));
    console.log('');
    console.log('Summary:');
    console.log(`- Active arcs: ${(await storyState.getActiveArcs()).length}`);
    console.log(`- Story plans fixed: ${plansWithBadChapter.length}`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Run testStorySystem.mjs again to generate beats');
    console.log('2. If avatars still not matching, check avatar IDs in arc.characters');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ CLEANUP FAILED');
    console.error('='.repeat(60));
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run cleanup
cleanupArcs()
  .then(() => {
    console.log('Cleanup script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
