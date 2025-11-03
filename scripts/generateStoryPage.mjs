/**
 * Story Page Generator
 * 
 * Generates the next page (3 beats) of the active story arc.
 * 
 * Usage:
 *   node scripts/testStorySystem.mjs          # Generate next page
 *   node scripts/testStorySystem.mjs --reset  # Reset and start new story
 */

import { container, containerReady } from '../src/container.mjs';

// Check for --reset flag
const shouldReset = process.argv.includes('--reset');

async function generateNextPage() {
  console.log('='.repeat(60));
  console.log(shouldReset ? '🔄 RESETTING & CREATING NEW STORY' : '📖 GENERATING NEXT PAGE');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Wait for container to be ready
    console.log('⏳ Initializing...');
    await containerReady;
    console.log('✅ Ready\n');

    // Resolve services
    const storyPlanner = container.resolve('storyPlannerService');
    const storyState = container.resolve('storyStateService');
    const storyPosting = container.resolve('storyPostingService');
    const storyPlan = container.resolve('storyPlanService');

    let arc;

    if (shouldReset) {
      // Reset: Complete all active arcs and create a new one
      console.log('🗑️  Completing existing active arcs...');
      const activeArcs = await storyState.getActiveArcs();
      for (const activeArc of activeArcs) {
        await storyState.updateArcStatus(activeArc._id, 'completed');
        console.log(`   ✅ Completed arc: "${activeArc.title}"`);
      }
      console.log('');

      // Create new arc
      console.log('📖 Creating new story arc...');
      const shouldCreate = await storyPlanner.shouldStartNewArc();
      
      if (!shouldCreate) {
        console.log('❌ Cannot create new arc (cooldown period or other conditions not met)');
        console.log('   Try again later or manually adjust the lastArcCreated timestamp');
        process.exit(0);
      }

      arc = await storyPlanner.createNewArc({ theme: 'discovery' });
      console.log(`   ✅ Created: "${arc.title}"`);
      console.log(`   - Theme: ${arc.theme}`);
      console.log(`   - Tone: ${arc.emotionalTone}`);
      console.log(`   - Planned beats: ${arc.plannedBeats}`);
      console.log(`   - Characters: ${arc.characters?.length || 0}`);
      
      // Activate the arc
      await storyState.updateArcStatus(arc._id, 'active');
      console.log(`   ✅ Arc activated\n`);
    } else {
      // Normal mode: Find existing active arc
      console.log('🔍 Looking for active arc...');
      const activeArcs = await storyState.getActiveArcs();
      arc = activeArcs.length > 0 ? activeArcs[0] : null;
      
      if (!arc) {
        console.log('❌ No active arc found');
        console.log('   Run with --reset to create a new story');
        process.exit(0);
      }

      console.log(`   ✅ Found: "${arc.title}"`);
      console.log(`   - Progress: ${arc.beats?.length || 0}/${arc.plannedBeats} beats`);
      console.log(`   - Completed: ${arc.completedBeats || 0} beats`);
      
      // Check if arc is already complete
      if (arc.beats?.length >= arc.plannedBeats) {
        console.log('   ⚠️  Arc has reached planned beats');
        console.log('   Run with --reset to start a new story');
        process.exit(0);
      }
      
      // Show plan info
      const plan = await storyPlan.getActivePlan(arc._id);
      if (plan) {
        const currentChapter = plan.currentChapter ?? 0;
        console.log(`   - Current chapter: ${currentChapter + 1}/${plan.plannedChapters?.length || 0}`);
      }
      console.log('');
    }

    // Generate next chapter (3 beats)
    console.log('🎬 Generating next chapter (3 beats)...');
    console.log('   ⚠️  This will generate media and post to social platforms!');
    console.log('   Press Ctrl+C within 3 seconds to abort...\n');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const result = await storyPlanner.progressArc(arc._id);
    
    if (!result) {
      console.log('❌ Failed to generate chapter (arc may be complete or error occurred)');
      process.exit(1);
    }

    const { arc: updatedArc, chapter, beats } = result;
    
    console.log(`✅ Generated chapter: "${chapter.title}"`);
    console.log(`   - Beats in chapter: ${beats.length}\n`);
    
    // Post each beat
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      console.log(`📄 Beat ${i + 1}/${beats.length} (sequence ${beat.sequenceNumber}):`);
      console.log(`   - Type: ${beat.type}`);
      console.log(`   - Description: ${beat.description.substring(0, 80)}...`);
      
      // Post the beat
      console.log(`   - Generating media and posting...`);
      const postResult = await storyPosting.postBeat(updatedArc, beat);
      
      if (postResult.success) {
        console.log(`   ✅ Posted successfully`);
        console.log(`   - Media: ${postResult.mediaUrl}`);
      } else {
        console.log(`   ❌ Posting failed: ${postResult.error}`);
      }
      
      console.log('');
      
      // Wait between posts
      if (i < beats.length - 1) {
        console.log('   ⏳ Waiting 3 seconds...\n');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    // Show updated status
    console.log('📊 Updated Arc Status:');
    console.log(`   - Total beats: ${updatedArc.beats?.length || 0}/${updatedArc.plannedBeats}`);
    console.log(`   - Completed: ${updatedArc.completedBeats || 0}`);
    console.log(`   - Status: ${updatedArc.status}`);
    
    const updatedPlan = await storyPlan.getActivePlan(arc._id);
    if (updatedPlan) {
      const currentChapter = updatedPlan.currentChapter ?? 0;
      console.log(`   - Chapter: ${currentChapter + 1}/${updatedPlan.plannedChapters?.length || 0}`);
      console.log(`   - Plan version: ${updatedPlan.version}`);
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('✅ PAGE GENERATION COMPLETE');
    console.log('='.repeat(60));
    console.log('');
    console.log('Next steps:');
    console.log('1. Visit http://localhost:3000/stories to view the story');
    console.log('2. Run this script again to generate the next page');
    console.log('3. Use --reset flag to start a new story');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ ERROR');
    console.error('='.repeat(60));
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the script
generateNextPage()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
