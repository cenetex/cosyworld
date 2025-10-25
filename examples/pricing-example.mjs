/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file examples/pricing-example.mjs
 * @description Example usage of PricingService for calculating costs
 */

import { PricingService } from '../src/services/payment/pricingService.mjs';

// Mock services
const mockLogger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
};

const mockConfig = {
  config: {
    payment: {
      pricing: {
        platformFee: 0.02,
        aiMarkup: 1.1,
        minPayment: 1000,
      },
    },
  },
};

async function demonstratePricing() {
  console.log('\n=== PricingService Demonstration ===\n');

  const pricingService = new PricingService({
    logger: mockLogger,
    configService: mockConfig,
  });

  // 1. Calculate AI model pricing
  console.log('1. AI Model Pricing Examples:');
  console.log('─'.repeat(60));

  const gpt4oPrice = pricingService.calculateAIPrice({
    model: 'openai/gpt-4o',
    inputTokens: 1000,
    outputTokens: 500,
  });
  console.log('\nGPT-4o (1,000 input + 500 output tokens):');
  console.log(`  Base Cost: $${gpt4oPrice.baseCostUSD}`);
  console.log(`  With Markup: $${gpt4oPrice.totalCostUSD}`);
  console.log(`  USDC Amount: ${gpt4oPrice.totalCostUSDC} (${gpt4oPrice.totalCostUSDC / 1e6} USDC)`);

  const geminiPrice = pricingService.calculateAIPrice({
    model: 'google/gemini-2.0-flash-exp:free',
    inputTokens: 5000,
    outputTokens: 2000,
  });
  console.log('\nGemini 2.0 Flash Free (5,000 input + 2,000 output tokens):');
  console.log(`  Cost: $${geminiPrice.totalCostUSD} (FREE TIER!)`);
  console.log(`  USDC Amount: ${geminiPrice.totalCostUSDC}`);

  const claudePrice = pricingService.calculateAIPrice({
    model: 'anthropic/claude-3.5-sonnet',
    inputTokens: 2000,
    outputTokens: 1000,
  });
  console.log('\nClaude 3.5 Sonnet (2,000 input + 1,000 output tokens):');
  console.log(`  Base Cost: $${claudePrice.baseCostUSD}`);
  console.log(`  With Markup: $${claudePrice.totalCostUSD}`);
  console.log(`  USDC Amount: ${claudePrice.totalCostUSDC} (${claudePrice.totalCostUSDC / 1e6} USDC)`);

  // 2. Endpoint pricing
  console.log('\n\n2. API Endpoint Pricing:');
  console.log('─'.repeat(60));

  const storyPrice = pricingService.calculateEndpointPrice({
    endpoint: '/api/avatars/:id/generate-story',
  });
  console.log('\nGenerate Story Endpoint:');
  console.log(`  Base Price: ${storyPrice.basePrice / 1e6} USDC`);
  console.log(`  Total: ${storyPrice.totalCostUSDC / 1e6} USDC`);

  const itemPrice = pricingService.calculateEndpointPrice({
    endpoint: '/api/items/generate',
    complexity: 2, // 2x multiplier
  });
  console.log('\nGenerate Item (Complex):');
  console.log(`  Base Price: ${itemPrice.basePrice / 1e6} USDC`);
  console.log(`  Complexity: 2x`);
  console.log(`  Total: ${itemPrice.totalCostUSDC / 1e6} USDC`);

  // 3. Action pricing
  console.log('\n\n3. Agent Action Pricing:');
  console.log('─'.repeat(60));

  const combatPrice = pricingService.calculateActionPrice({
    action: 'combat_turn',
  });
  console.log('\nCombat Turn:');
  console.log(`  Price: ${combatPrice.totalCostUSDC / 1e6} USDC`);

  const imageGenPrice = pricingService.calculateActionPrice({
    action: 'image_generation',
  });
  console.log('\nImage Generation:');
  console.log(`  Price: ${imageGenPrice.totalCostUSDC / 1e6} USDC`);

  // 4. Volume discounts
  console.log('\n\n4. Volume Discounts:');
  console.log('─'.repeat(60));

  const basePrice = 50000; // 0.05 USDC
  const volumes = [0, 100, 500, 1000, 5000, 10000];

  for (const volume of volumes) {
    const discounted = pricingService.applyDiscount({
      basePrice,
      volume,
    });
    console.log(`\nVolume: ${volume} requests`);
    console.log(`  Base: ${discounted.basePrice / 1e6} USDC`);
    console.log(`  Discount: ${(discounted.discount * 100).toFixed(0)}%`);
    console.log(`  Final: ${discounted.finalPrice / 1e6} USDC`);
    if (discounted.savedUSD > 0) {
      console.log(`  Saved: $${discounted.savedUSD.toFixed(4)}`);
    }
  }

  // 5. Complete pricing calculation
  console.log('\n\n5. Complete Pricing Example (Story Generation with GPT-4o):');
  console.log('─'.repeat(60));

  const completePrice = pricingService.calculatePrice({
    type: 'ai',
    details: {
      model: 'openai/gpt-4o',
      inputTokens: 2000,
      outputTokens: 1500,
    },
    agentId: 'agent-123',
    volume: 150, // 150 previous requests this month
  });

  console.log('\nRequest Details:');
  console.log(`  Model: ${completePrice.model}`);
  console.log(`  Input Tokens: ${completePrice.inputTokens}`);
  console.log(`  Output Tokens: ${completePrice.outputTokens}`);
  console.log(`\nCost Breakdown:`);
  console.log(`  Input Cost: $${completePrice.inputCostUSD}`);
  console.log(`  Output Cost: $${completePrice.outputCostUSD}`);
  console.log(`  Base Cost: $${completePrice.baseCostUSD}`);
  console.log(`  With Markup (${(completePrice.markup - 1) * 100}%): $${completePrice.totalCostUSD}`);
  console.log(`  Base USDC: ${completePrice.basePrice / 1e6} USDC`);
  console.log(`\nVolume Discount:`);
  console.log(`  Volume: ${completePrice.volume} requests`);
  console.log(`  Discount: ${(completePrice.discount * 100).toFixed(0)}%`);
  console.log(`  Discount Amount: ${completePrice.discountAmount / 1e6} USDC`);
  console.log(`\nFinal Price: ${completePrice.finalPrice / 1e6} USDC ($${pricingService.toUSD(completePrice.finalPrice)})`);

  // 6. Free tier models
  console.log('\n\n6. Free Tier Models:');
  console.log('─'.repeat(60));
  const freeTierModels = pricingService.getFreeTierModels();
  console.log(`\nAvailable for free (${freeTierModels.length} models):`);
  freeTierModels.slice(0, 5).forEach(model => {
    console.log(`  ✓ ${model}`);
  });
  console.log(`  ... and ${freeTierModels.length - 5} more`);

  // 7. Pricing tiers summary
  console.log('\n\n7. Platform Pricing Tiers:');
  console.log('─'.repeat(60));
  const tiers = pricingService.getPricingTiers();
  console.log(`\nPlatform Configuration:`);
  console.log(`  Platform Fee: ${(tiers.platformFee * 100).toFixed(0)}%`);
  console.log(`  AI Markup: ${(tiers.aiMarkup * 100).toFixed(0)}%`);
  console.log(`  Minimum Payment: $${tiers.minPaymentUSD}`);
  console.log(`\nVolume Discount Tiers:`);
  tiers.volumeDiscounts.forEach(tier => {
    console.log(`  ${tier.threshold}+ requests: ${(tier.discount * 100).toFixed(0)}% off`);
  });

  console.log('\n\n=== Demo Complete ===\n');
  console.log('✨ PricingService is ready for production!\n');
}

// Run demonstration
demonstratePricing().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
