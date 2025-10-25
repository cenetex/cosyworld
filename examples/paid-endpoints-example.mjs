/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file examples/paid-endpoints-example.mjs
 * @description Example of calling paid AI endpoints with x402 payments
 */

const API_BASE = 'http://localhost:3000';

/**
 * Example: Call the /api/ai/chat endpoint (free tier)
 */
async function testFreeTierChat() {
  console.log('\n1. Testing Free Tier AI Chat (Gemini 2.0 Flash)');
  console.log('─'.repeat(60));

  try {
    const response = await fetch(`${API_BASE}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: 'Write a short poem about a brave knight.',
          },
        ],
        model: 'google/gemini-2.0-flash-exp:free', // Free tier model
      }),
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Success! (Free tier)');
      console.log('Response:', data.response?.substring(0, 200) + '...');
      console.log('Model:', data.model);
      console.log('Free:', data.free);
      console.log('Usage:', data.usage);
    } else {
      console.log('❌ Error:', data.error);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

/**
 * Example: Call the /api/ai/chat endpoint with premium model (requires payment)
 */
async function testPremiumChat() {
  console.log('\n2. Testing Premium AI Chat (GPT-4o - Requires Payment)');
  console.log('─'.repeat(60));

  try {
    const response = await fetch(`${API_BASE}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: 'Write a detailed analysis of medieval combat tactics.',
          },
        ],
        model: 'openai/gpt-4o', // Premium model
        maxTokens: 500,
      }),
    });

    const data = await response.json();

    if (response.status === 402) {
      console.log('💰 Payment Required (as expected)');
      console.log('Amount:', data.payment?.price?.usdcAmount / 1e6, 'USDC');
      console.log('Pricing breakdown:');
      console.log('  - Model:', data.pricing?.model);
      console.log('  - Estimated cost:', `$${data.pricing?.estimatedCost}`);
      console.log('  - Input tokens:', data.pricing?.inputTokens);
      console.log('  - Output tokens:', data.pricing?.outputTokens);
      console.log('  - Free alternative:', data.freeTierAlternative);
      console.log('\n📝 Payment details:', JSON.stringify(data.payment, null, 2));
    } else if (response.ok) {
      console.log('✅ Success! (Payment verified)');
      console.log('Response:', data.response?.substring(0, 200) + '...');
    } else {
      console.log('❌ Error:', data.error);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

/**
 * Example: Generate a story (requires payment)
 */
async function testGenerateStory() {
  console.log('\n3. Testing Story Generation (0.05 USDC)');
  console.log('─'.repeat(60));

  try {
    const response = await fetch(`${API_BASE}/api/ai/generate-story`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'A wizard discovers a forgotten spell in an ancient library',
        model: 'openai/gpt-4o',
        maxTokens: 1000,
      }),
    });

    const data = await response.json();

    if (response.status === 402) {
      console.log('💰 Payment Required');
      console.log('Amount:', data.payment?.price?.usdcAmount / 1e6, 'USDC');
      console.log('Network:', data.payment?.facilitator?.network);
      console.log('Payment destination:', data.payment?.paymentDestination?.address);
      console.log('\n📋 To pay: Include X-x402-Metadata header with signed payment');
    } else if (response.ok) {
      console.log('✅ Success! (Payment verified)');
      console.log('Story:', data.story?.substring(0, 200) + '...');
    } else {
      console.log('❌ Error:', data.error);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

/**
 * Example: Generate an item (requires payment)
 */
async function testGenerateItem() {
  console.log('\n4. Testing Item Generation (0.02 USDC)');
  console.log('─'.repeat(60));

  try {
    const response = await fetch(`${API_BASE}/api/ai/generate-item`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'A sword forged from starlight',
        itemType: 'weapon',
        rarity: 'legendary',
      }),
    });

    const data = await response.json();

    if (response.status === 402) {
      console.log('💰 Payment Required');
      console.log('Amount:', data.payment?.price?.usdcAmount / 1e6, 'USDC');
    } else if (response.ok) {
      console.log('✅ Success! (Payment verified)');
      console.log('Item:', data.item?.substring(0, 200) + '...');
    } else {
      console.log('❌ Error:', data.error);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

/**
 * Example: Describe a location (requires payment)
 */
async function testDescribeLocation() {
  console.log('\n5. Testing Location Description (0.015 USDC)');
  console.log('─'.repeat(60));

  try {
    const response = await fetch(`${API_BASE}/api/ai/describe-location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locationName: 'The Whispering Woods',
        theme: 'dark fantasy',
        mood: 'eerie',
      }),
    });

    const data = await response.json();

    if (response.status === 402) {
      console.log('💰 Payment Required');
      console.log('Amount:', data.payment?.price?.usdcAmount / 1e6, 'USDC');
    } else if (response.ok) {
      console.log('✅ Success! (Payment verified)');
      console.log('Description:', data.description?.substring(0, 200) + '...');
    } else {
      console.log('❌ Error:', data.error);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

/**
 * Example: Get pricing information
 */
async function testGetPricing() {
  console.log('\n6. Testing Pricing Information');
  console.log('─'.repeat(60));

  try {
    const response = await fetch(`${API_BASE}/api/ai/pricing`);
    const data = await response.json();

    if (response.ok) {
      console.log('✅ Pricing Information Retrieved');
      console.log('\nPlatform Configuration:');
      console.log('  - Platform Fee:', (data.tiers?.platformFee * 100).toFixed(0) + '%');
      console.log('  - AI Markup:', (data.tiers?.aiMarkup * 100).toFixed(0) + '%');
      console.log('  - Minimum Payment:', `$${data.tiers?.minPaymentUSD}`);
      
      console.log('\nFree Tier Models:', data.tiers?.freeTier?.length);
      data.tiers?.freeTier?.slice(0, 3).forEach(model => {
        console.log(`  ✓ ${model}`);
      });

      console.log('\nPricing Examples:');
      data.examples?.forEach(example => {
        console.log(`  ${example.model}:`);
        console.log(`    - Cost: $${example.totalCostUSD} (${example.totalCostUSDC / 1e6} USDC)`);
        console.log(`    - Free: ${example.free ? 'Yes' : 'No'}`);
      });

      console.log('\nEndpoint Pricing:');
      Object.entries(data.endpoints || {}).forEach(([endpoint, price]) => {
        console.log(`  - ${endpoint}: ${price}`);
      });
    } else {
      console.log('❌ Error:', data.error);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

/**
 * Run all examples
 */
async function runExamples() {
  console.log('\n' + '='.repeat(60));
  console.log('    PAID AI ENDPOINTS DEMONSTRATION');
  console.log('='.repeat(60));
  console.log('\nTesting x402 payment-protected AI endpoints...');
  console.log('Server:', API_BASE);
  console.log('\nNOTE: Most endpoints will return 402 Payment Required');
  console.log('      This demonstrates the x402 protocol working correctly!');
  console.log('='.repeat(60));

  await testFreeTierChat();
  await testPremiumChat();
  await testGenerateStory();
  await testGenerateItem();
  await testDescribeLocation();
  await testGetPricing();

  console.log('\n' + '='.repeat(60));
  console.log('    DEMONSTRATION COMPLETE');
  console.log('='.repeat(60));
  console.log('\n✨ Paid endpoints are configured and protected with x402!');
  console.log('\n📚 Next Steps:');
  console.log('   1. Configure CDP credentials in Admin UI');
  console.log('   2. Set up seller wallet address');
  console.log('   3. Test with actual payments on Base Sepolia');
  console.log('   4. Build marketplace for agent services\n');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples().catch(error => {
    console.error('\n❌ Demo failed:', error);
    process.exit(1);
  });
}

export { runExamples };
