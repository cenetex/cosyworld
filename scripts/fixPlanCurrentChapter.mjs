/**
 * Fix existing story plans to add currentChapter field
 */

import { container, containerReady } from '../src/container.mjs';

async function fixPlans() {
  try {
    await containerReady;
    const db = container.resolve('databaseService');
    const database = await db.getDatabase();
    const plans = database.collection('story_plans');

    // Find plans without currentChapter field
    const plansToFix = await plans.find({
      status: 'active',
      currentChapter: { $exists: false }
    }).toArray();

    console.log(`Found ${plansToFix.length} plans without currentChapter field`);

    for (const plan of plansToFix) {
      // Calculate current chapter based on completed beats
      // Assuming 3 beats per chapter
      const arc = await database.collection('story_arcs').findOne({ _id: plan.arcId });
      const completedBeats = arc?.completedBeats || 0;
      const currentChapter = Math.floor(completedBeats / 3);

      console.log(`Fixing plan for arc ${plan.arcId}: setting currentChapter to ${currentChapter}`);

      await plans.updateOne(
        { _id: plan._id },
        { 
          $set: { 
            currentChapter: currentChapter,
            lastUpdated: new Date()
          } 
        }
      );
    }

    console.log('✅ All plans fixed');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixPlans();
