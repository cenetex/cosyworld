/**
 * Story CLI
 * 
 * Command-line interface for managing story generation.
 * 
 * Usage:
 *   node scripts/story-cli.mjs              # Generate next chapter (3 beats) for active arc
 *   node scripts/story-cli.mjs --reset      # Start a new story arc
 *   node scripts/story-cli.mjs --force      # Force create new arc (bypass timing restrictions)
 *   node scripts/story-cli.mjs --help       # Show this help
 */

import { container, containerReady } from '../src/container.mjs';

// Parse command line arguments
const args = process.argv.slice(2);
const shouldReset = args.includes('--reset');
const forceCreate = args.includes('--force');
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  console.log(`
Story CLI - Manage story generation for CosyWorld

Usage:
  node scripts/story-cli.mjs [options]

Options:
  (none)      Generate next chapter (3 beats) for active arc
  --reset     Start a new story arc
  --force     Force create new arc (bypass timing restrictions)
  --help, -h  Show this help message

Examples:
  node scripts/story-cli.mjs              # Continue existing story
  node scripts/story-cli.mjs --force      # Force new arc creation
  node scripts/story-cli.mjs --reset      # Start fresh story

Note: Each chapter contains exactly 3 beats (story posts).
Recommended: 1 chapter per day for optimal pacing.
`);
  process.exit(0);
}

async function generateNextPage() {
  console.log('='.repeat(60));
  if (shouldReset) {
    console.log('🔄 RESETTING STORY');
  } else if (forceCreate) {
    console.log('⚡ FORCE CREATING NEW ARC');
  } else {
    console.log('📖 GENERATING NEXT CHAPTER');
  }
  console.log('='.repeat(60));
  console.log('');

  try {
    // Wait for container to be ready
    console.log('⏳ Initializing...');
    await containerReady;
    console.log('✅ Ready');
    console.log('');

    // Resolve services
    const storyPlanner = container.resolve('storyPlannerService');
    const storyState = container.resolve('storyStateService');
    const storyPosting = container.resolve('storyPostingService');
    const storyPlan = container.resolve('storyPlanService');
    const worldContext = container.resolve('worldContextService');
    const aiService = container.resolve('aiService');

    // Test 1: Get world context with channel summaries
    console.log('📊 TEST 1: Getting world context with channel summaries...');
    const context = await worldContext.getWorldContext({
      includeChannelSummaries: true,
      includeMetaSummary: true,
      includeAvatars: true,
      includeLocations: true,
      includeItems: true,
      avatarLimit: 10,
      locationLimit: 5,
      itemLimit: 5
    }, aiService);
    
    console.log(`   - Found ${context.summary.totalAvatars} avatars`);
    console.log(`   - Found ${context.summary.totalLocations} locations`);
    console.log(`   - Found ${context.summary.totalItems} items`);
    console.log(`   - Found ${context.summary.opportunityCount} story opportunities`);
    
    if (context.channelSummaries && context.channelSummaries.length > 0) {
      console.log(`   - Found ${context.channelSummaries.length} channel summaries`);
      for (const summary of context.channelSummaries) {
        console.log(`     • ${summary.platform}: ${summary.channelName} (${summary.messageCount} messages)`);
      }
    }
    
    if (context.metaSummary) {
      const summaryText = context.metaSummary.summary || JSON.stringify(context.metaSummary);
      console.log(`   - Meta-summary: ${summaryText.substring(0, 100)}...`);
      if (context.metaSummary.keyThemes && context.metaSummary.keyThemes.length > 0) {
        console.log(`   - Key themes: ${context.metaSummary.keyThemes.join(', ')}`);
      }
    }
    
    if (context.avatars && context.avatars.length > 0) {
      console.log(`   - Sample avatar: ${context.avatars[0].name} ${context.avatars[0].emoji || ''}`);
    }
    
    if (context.locations && context.locations.length > 0) {
      console.log(`   - Sample location: ${context.locations[0].name}`);
    }
    
    console.log('✅ World context with channel summaries retrieved successfully');
    console.log('');

    // Test 2: Check for existing active arc or create new one
    console.log('🎭 TEST 2: Looking for existing active arc...');
    const activeArcs = await storyState.getActiveArcs();
    let arc = activeArcs.length > 0 ? activeArcs[0] : null;
    
    if (arc) {
      console.log(`   ✅ Found existing active arc: "${arc.title}"`);
      console.log(`   - Theme: ${arc.theme}`);
      console.log(`   - Emotional tone: ${arc.emotionalTone}`);
      console.log(`   - Current beats: ${arc.beats?.length || 0}/${arc.plannedBeats}`);
      console.log(`   - Characters: ${arc.characters?.length || 0}`);
      
      // Check current plan
      const plan = await storyPlan.getActivePlan(arc._id);
      if (plan) {
        const currentChapter = plan.currentChapter ?? 0;
        console.log(`   - Current chapter: ${currentChapter + 1}/${plan.plannedChapters?.length || 0}`);
        if (plan.plannedChapters && plan.plannedChapters[currentChapter]) {
          console.log(`   - Next chapter: "${plan.plannedChapters[currentChapter].title}"`);
        }
      }
    } else {
      console.log('   - No active arc found, checking if we should create one...');
      const shouldCreate = forceCreate || await storyPlanner.shouldStartNewArc();
      
      if (forceCreate && !shouldCreate) {
        console.log(`   - Force flag enabled: bypassing timing restrictions`);
      } else {
        console.log(`   - Should create new arc: ${shouldCreate}`);
      }
      
      if (shouldCreate) {
        console.log('');
        console.log('📖 Creating new story arc with evolving plan...');
        arc = await storyPlanner.createNewArc({
          theme: 'discovery'
        });
        
        console.log(`   - Created arc: "${arc.title}"`);
        console.log(`   - Theme: ${arc.theme}`);
        console.log(`   - Emotional tone: ${arc.emotionalTone}`);
        console.log(`   - Planned beats: ${arc.plannedBeats}`);
        console.log(`   - Characters: ${arc.characters?.length || 0}`);
        
        if (arc.characters && arc.characters.length > 0) {
          for (const char of arc.characters.slice(0, 3)) {
            console.log(`     • ${char.avatarName} (${char.role})`);
          }
        }
        
        // Check if plan was created
        const plan = await storyPlan.getActivePlan(arc._id);
        if (plan) {
          const currentChapter = plan.currentChapter ?? 0;
          console.log(`   - Story plan created with ${plan.plannedChapters?.length || 0} chapters`);
          console.log(`   - Overall theme: ${plan.overallTheme}`);
          console.log(`   - Current chapter: ${currentChapter + 1}/${plan.plannedChapters?.length || 0}`);
          if (plan.plannedChapters && plan.plannedChapters[0]) {
            console.log(`   - First chapter: "${plan.plannedChapters[0].title}"`);
            console.log(`     ${plan.plannedChapters[0].summary}`);
          }
        }
        
        console.log('✅ Story arc with evolving plan created');
        console.log('');
        
        // Activate the arc
        console.log('🚀 Activating arc...');
        await storyState.updateArcStatus(arc._id, 'active');
        console.log('✅ Arc activated');
      } else {
        console.log('❌ No active arc and conditions not met for creating new arc');
        process.exit(0);
      }
    }
    console.log('');

    // Test 3: Generate and post next CHAPTER (1 page = 3 beats)
    console.log('🎬 TEST 3: Generating and posting next CHAPTER (1 page = 3 beats)...');
    console.log(`   - Current arc: "${arc.title}"`);
    console.log(`   - Current beats: ${arc.beats?.length || 0}/${arc.plannedBeats}`);
    console.log('   ⚠️  This will generate media for 3 beats and post to social platforms!');
    console.log('   Press Ctrl+C within 5 seconds to abort...');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const result = await storyPlanner.progressArc(arc._id);
    
    if (!result) {
      console.log('   ⚠️  Arc completed or error occurred');
    } else {
      const { arc: updatedArc, chapter, beats } = result;
      
      console.log(`   - Generated chapter: "${chapter.title}"`);
      console.log(`   - Total beats in chapter: ${beats.length}`);
      console.log('');
      
      // Get the newly added beats from the updated arc (last N beats where N = chapter size)
      const arcBeats = updatedArc.beats || [];
      const newBeats = arcBeats.slice(-beats.length);
      
      // Post each beat in the chapter
      for (let i = 0; i < newBeats.length; i++) {
        const beat = newBeats[i];
        console.log(`   📄 Beat ${i + 1}/${newBeats.length}:`);
        console.log(`      - Sequence: ${beat.sequenceNumber}`);
        console.log(`      - Type: ${beat.type}`);
        console.log(`      - Description: ${beat.description}`);
        console.log(`      - Visual prompt: ${beat.visualPrompt.substring(0, 80)}...`);
        
        // Post the beat
        console.log(`      - Posting beat to social platforms...`);
        const postResult = await storyPosting.postBeat(updatedArc, beat);
        
        if (postResult.success) {
          console.log(`      ✅ Beat posted successfully`);
          console.log(`      - Media URL: ${postResult.mediaUrl}`);
          console.log(`      - Caption: ${postResult.caption.substring(0, 80)}...`);
          
          if (postResult.posts.telegramMessageId) {
            console.log(`      - Telegram: Message ${postResult.posts.telegramMessageId}`);
          }
          
          if (postResult.posts.xTweetId) {
            console.log(`      - X: ${postResult.posts.xTweetUrl}`);
          }
        } else {
          console.log(`      ⚠️  Posting failed: ${postResult.error}`);
        }
        
        console.log('');
        
        // Wait a bit between posts to avoid rate limits
        if (i < beats.length - 1) {
          console.log('      ⏳ Waiting 3 seconds before next beat...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      // Show updated arc status
      console.log(`   📖 Arc progress:`);
      console.log(`      - Total beats generated: ${updatedArc.beats?.length || 0}/${updatedArc.plannedBeats}`);
      console.log(`      - Completed beats: ${updatedArc.completedBeats || 0}`);
      console.log(`      - Status: ${updatedArc.status}`);
      
      // Check if plan evolved
      const updatedPlan = await storyPlan.getActivePlan(arc._id);
      if (updatedPlan) {
        const currentChapter = updatedPlan.currentChapter ?? 0;
        console.log(`   📋 Story plan status:`);
        console.log(`      - Current chapter: ${currentChapter + 1}/${updatedPlan.plannedChapters?.length || 0}`);
        console.log(`      - Plan version: ${updatedPlan.version}`);
        if (updatedPlan.evolutionHistory && updatedPlan.evolutionHistory.length > 0) {
          console.log(`      - Plan has evolved ${updatedPlan.evolutionHistory.length} time(s)`);
        }
      }
    }
    
    console.log('');

    // Test 4: Get statistics
    console.log('📈 TEST 4: Getting statistics...');
    const stats = await storyState.getStatistics();
    console.log(`   - Total arcs: ${stats.totalArcs}`);
    console.log(`   - Active arcs: ${stats.activeArcs}`);
    console.log(`   - Completed arcs: ${stats.completedArcs}`);
    console.log(`   - Average duration: ${stats.averageArcDurationDays} days`);
    console.log('✅ Statistics retrieved');
    console.log('');

    console.log('='.repeat(60));
    console.log('✅ ALL TESTS COMPLETED SUCCESSFULLY');
    console.log('='.repeat(60));
    console.log('');
    console.log('📚 CHAPTER-BASED STORY SYSTEM SUMMARY:');
    console.log('   - System uses channel summaries from Discord, Telegram, and X');
    console.log('   - Stories are planned with evolving chapter structure');
    console.log('   - Each chapter contains exactly 3 beats (1 page)');
    console.log('   - Plans evolve after each chapter based on world changes');
    console.log('   - Script continues existing story arc instead of creating new one');
    console.log('   - Recommended: 1 chapter (3 beats) published per day');
    console.log('');
    console.log('Next steps:');
    console.log('1. Visit http://localhost:3000/stories to view the story');
    console.log('2. Check your Telegram channel for the posted beats');
    console.log('3. Check your X/Twitter feed for the posted beats');
    console.log('4. Generate next chapter: node scripts/story-cli.mjs');
    console.log('5. Start the scheduler to automate: POST /api/admin/story/scheduler/start');
    console.log('   (Scheduler will generate 1 chapter per day automatically)');
    console.log('');
    console.log('Commands:');
    console.log('  node scripts/story-cli.mjs         # Continue existing story');
    console.log('  node scripts/story-cli.mjs --force # Force create new arc');
    console.log('  node scripts/story-cli.mjs --help  # Show help');
    console.log('');
    console.log(`Arc ID: ${arc._id}`);
    console.log(`Arc progress: ${arc.beats?.length || 0}/${arc.plannedBeats} beats`);
    console.log(`Story URL: http://localhost:3000/stories`);
    console.log(`LAN URL: http://10.117.1.123:3000/stories (from laptop on same WiFi)`);
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ TEST FAILED');
    console.error('='.repeat(60));
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run tests
generateNextPage()
  .then(() => {
    console.log('Test script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
