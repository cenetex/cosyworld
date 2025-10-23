/**
 * Test Story System - Chapter-Based Generation
 * 
 * Tests the storytelling system with new features:
 * 1. Channel summary-based world context
 * 2. Evolving story plan generation
 * 3. Chapter generation (3 beats per chapter)
 * 4. Plan evolution between chapters
 * 5. Media generation and posting
 */

import { container, containerReady } from '../src/container.mjs';

async function testStorySystemMVP() {
  console.log('='.repeat(60));
  console.log('TESTING STORY SYSTEM MVP');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Wait for container to be ready
    console.log('⏳ Waiting for container initialization...');
    await containerReady;
    console.log('✅ Container ready');
    console.log('');

    // Resolve services
    const worldContext = container.resolve('worldContextService');
    const storyPlanner = container.resolve('storyPlannerService');
    const storyState = container.resolve('storyStateService');
    const storyPosting = container.resolve('storyPostingService');
    const channelSummary = container.resolve('channelSummaryService');
    const storyPlan = container.resolve('storyPlanService');
    const aiService = container.resolve('aiService');
    
    console.log('✅ All story services resolved');
    console.log('');

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
      console.log(`   - Meta-summary: ${context.metaSummary.substring(0, 100)}...`);
    }
    
    if (context.avatars && context.avatars.length > 0) {
      console.log(`   - Sample avatar: ${context.avatars[0].name} ${context.avatars[0].emoji || ''}`);
    }
    
    if (context.locations && context.locations.length > 0) {
      console.log(`   - Sample location: ${context.locations[0].name}`);
    }
    
    console.log('✅ World context with channel summaries retrieved successfully');
    console.log('');

    // Test 2: Check if we should create an arc
    console.log('🎭 TEST 2: Checking arc creation conditions...');
    const shouldCreate = await storyPlanner.shouldStartNewArc();
    console.log(`   - Should create new arc: ${shouldCreate}`);
    console.log('');

    // Test 3: Create a test arc with evolving plan
    console.log('📖 TEST 3: Creating test story arc with evolving plan...');
    const arc = await storyPlanner.createNewArc({
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
    const plan = await storyPlan.getPlan(arc._id);
    if (plan) {
      console.log(`   - Story plan created with ${plan.chapters.length} chapters`);
      console.log(`   - Overall theme: ${plan.overallTheme}`);
      console.log(`   - Current chapter: ${plan.currentChapter + 1}/${plan.chapters.length}`);
      if (plan.chapters[0]) {
        console.log(`   - First chapter: "${plan.chapters[0].title}"`);
        console.log(`     ${plan.chapters[0].summary}`);
      }
    }
    
    console.log('✅ Story arc with evolving plan created');
    console.log('');

    // Test 4: Activate the arc
    console.log('🚀 TEST 4: Activating arc...');
    await storyState.updateArcStatus(arc._id, 'active');
    console.log('✅ Arc activated');
    console.log('');

    // Test 5: Generate and post next CHAPTER (3 beats)
    console.log('🎬 TEST 5: Generating and posting next CHAPTER (3 beats)...');
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
      
      // Post each beat in the chapter
      for (let i = 0; i < beats.length; i++) {
        const beat = beats[i];
        console.log(`   📄 Beat ${i + 1}/${beats.length}:`);
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
      
      // Check if plan evolved
      const updatedPlan = await storyPlan.getPlan(arc._id);
      if (updatedPlan) {
        console.log(`   📋 Story plan status:`);
        console.log(`      - Current chapter: ${updatedPlan.currentChapter + 1}/${updatedPlan.chapters.length}`);
        console.log(`      - Plan version: ${updatedPlan.version}`);
        if (updatedPlan.evolutionHistory && updatedPlan.evolutionHistory.length > 0) {
          console.log(`      - Plan has evolved ${updatedPlan.evolutionHistory.length} time(s)`);
        }
      }
    }
    
    console.log('');

    // Test 6: Get statistics
    console.log('📈 TEST 6: Getting statistics...');
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
    console.log('Next steps:');
    console.log('1. Visit http://localhost:3000/stories to view the story');
    console.log('2. Check your Telegram channel for the posted page');
    console.log('3. Check your X/Twitter feed for the posted page');
    console.log('4. Run this script again to generate the next page');
    console.log('5. Start the scheduler to automate: POST /api/admin/story/scheduler/start');
    console.log('');
    console.log(`Arc ID for reference: ${arc._id}`);
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
testStorySystemMVP()
  .then(() => {
    console.log('Test script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
