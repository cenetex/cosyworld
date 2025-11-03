/**
 * Post beat 1 to generate its missing image
 */

import { container, containerReady } from '../src/container.mjs';

async function postBeat1() {
  try {
    await containerReady;
    const storyState = container.resolve('storyStateService');
    const storyPosting = container.resolve('storyPostingService');

    const arcs = await storyState.getActiveArcs();
    if (arcs.length === 0) {
      console.log('No active arc found');
      process.exit(0);
    }

    const arc = arcs[0];
    const beat1 = arc.beats.find(b => b.sequenceNumber === 1);
    
    if (!beat1) {
      console.log('Beat 1 not found');
      process.exit(0);
    }

    console.log('Found beat 1:', beat1.description.substring(0, 60));
    console.log('Has image:', !!beat1.generatedImageUrl);
    console.log('Has ID:', !!beat1.id);
    
    if (!beat1.generatedImageUrl) {
      console.log('\nPosting beat 1 to generate image...');
      const result = await storyPosting.postBeat(arc, beat1);
      
      if (result.success) {
        console.log('✅ SUCCESS');
        console.log('Media URL:', result.mediaUrl);
        console.log('Caption:', result.caption.substring(0, 80));
      } else {
        console.log('❌ FAILED');
        console.log('Error:', result.error);
      }
    } else {
      console.log('Beat 1 already has an image');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

postBeat1();
