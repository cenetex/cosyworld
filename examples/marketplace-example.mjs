/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file examples/marketplace-example.mjs
 * @description Example of using the service marketplace
 */

const API_BASE = 'http://localhost:3000';

/**
 * 1. Register a service in the marketplace
 */
async function registerService() {
  console.log('\n1. Registering a Service in Marketplace');
  console.log('─'.repeat(60));

  try {
    const response = await fetch(`${API_BASE}/api/marketplace/services`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        providerId: 'agent-storyteller-001',
        name: 'Epic Quest Generator',
        description: 'Generate engaging D&D-style quest narratives using GPT-4o. Perfect for game masters and world builders.',
        category: 'ai',
        pricing: {
          model: 'per_request',
          amount: 50000, // 0.05 USDC
          discounts: [
            { volume: 100, discount: 0.1 },   // 10% off after 100 requests
            { volume: 500, discount: 0.15 },  // 15% off after 500 requests
          ],
        },
        endpoint: '/api/services/quest-generator',
        network: 'base',
        metadata: {
          tags: ['story', 'rpg', 'narrative', 'quest'],
          version: '1.0.0',
          minResponseTime: 3000, // ms
          maxResponseTime: 10000,
        },
      }),
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Service Registered Successfully!');
      console.log('Service ID:', data.serviceId);
      console.log('Name:', data.name);
      console.log('Price:', data.pricing.amount / 1e6, 'USDC');
      console.log('Payment Address:', data.paymentDestination);
      console.log('Category:', data.category);
      console.log('Tags:', data.metadata.tags.join(', '));
    } else {
      console.log('❌ Registration Failed:', data.error);
      console.log('Details:', data.message);
    }

    return data.serviceId;
  } catch (error) {
    console.error('Request failed:', error.message);
    return null;
  }
}

/**
 * 2. Search for services
 */
async function searchServices() {
  console.log('\n2. Searching Services');
  console.log('─'.repeat(60));

  try {
    // Search for AI services under 0.1 USDC
    const response = await fetch(
      `${API_BASE}/api/marketplace/services?category=ai&maxPrice=100000&sortBy=rating`
    );
    const data = await response.json();

    if (response.ok) {
      console.log(`✅ Found ${data.total} services`);
      console.log(`Showing page ${data.page} of ${data.totalPages}\n`);

      data.services.slice(0, 3).forEach((service, index) => {
        console.log(`${index + 1}. ${service.name}`);
        console.log(`   Price: ${service.pricing.amount / 1e6} USDC`);
        console.log(`   Rating: ${service.stats.averageRating}⭐ (${service.stats.ratingCount} reviews)`);
        console.log(`   Requests: ${service.stats.totalRequests}`);
        console.log(`   Revenue: ${service.stats.totalRevenue / 1e6} USDC`);
        console.log(`   Provider: ${service.providerId}`);
        console.log();
      });
    } else {
      console.log('❌ Search Failed:', data.error);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

/**
 * 3. Get service details
 */
async function getServiceDetails(serviceId) {
  console.log('\n3. Getting Service Details');
  console.log('─'.repeat(60));

  if (!serviceId) {
    console.log('⏭️  Skipping (no service ID available)');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/marketplace/services/${serviceId}`);
    const data = await response.json();

    if (response.ok) {
      console.log('✅ Service Details Retrieved');
      console.log('\nService Information:');
      console.log('  Name:', data.name);
      console.log('  Description:', data.description);
      console.log('  Category:', data.category);
      console.log('  Endpoint:', data.endpoint);
      console.log('  Network:', data.network);
      
      console.log('\nPricing:');
      console.log('  Model:', data.pricing.model);
      console.log('  Amount:', data.pricing.amount / 1e6, 'USDC');
      if (data.pricing.discounts?.length > 0) {
        console.log('  Volume Discounts:');
        data.pricing.discounts.forEach(d => {
          console.log(`    - ${d.volume}+ requests: ${(d.discount * 100).toFixed(0)}% off`);
        });
      }

      console.log('\nStatistics:');
      console.log('  Total Requests:', data.stats.totalRequests);
      console.log('  Total Revenue:', data.stats.totalRevenue / 1e6, 'USDC');
      console.log('  Average Rating:', data.stats.averageRating, '⭐');
      console.log('  Rating Count:', data.stats.ratingCount);
      console.log('  Uptime:', (data.stats.uptime * 100).toFixed(1) + '%');

      if (data.recentRatings?.length > 0) {
        console.log('\nRecent Ratings:');
        data.recentRatings.slice(0, 3).forEach(r => {
          console.log(`  ${r.rating}⭐ by ${r.userId}: "${r.comment || 'No comment'}"`);
        });
      }
    } else {
      console.log('❌ Failed:', data.error);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

/**
 * 4. Rate a service
 */
async function rateService(serviceId) {
  console.log('\n4. Rating a Service');
  console.log('─'.repeat(60));

  if (!serviceId) {
    console.log('⏭️  Skipping (no service ID available)');
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE}/api/marketplace/services/${serviceId}/rate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: 'user-gamer-42',
          rating: 5,
          comment: 'Excellent quest generation! Very creative and well-paced.',
        }),
      }
    );

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Rating Submitted Successfully!');
      console.log('User:', data.userId);
      console.log('Rating:', data.rating, '⭐');
      console.log('Comment:', data.comment);
    } else {
      console.log('❌ Rating Failed:', data.error);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

/**
 * 5. Update a service
 */
async function updateService(serviceId) {
  console.log('\n5. Updating a Service');
  console.log('─'.repeat(60));

  if (!serviceId) {
    console.log('⏭️  Skipping (no service ID available)');
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE}/api/marketplace/services/${serviceId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          providerId: 'agent-storyteller-001',
          description: 'Generate engaging D&D-style quest narratives using GPT-4o. Perfect for game masters and world builders. Now with improved pacing!',
          pricing: {
            model: 'per_request',
            amount: 45000, // Price drop: 0.045 USDC
            discounts: [
              { volume: 100, discount: 0.1 },
              { volume: 500, discount: 0.15 },
              { volume: 1000, discount: 0.2 }, // New tier!
            ],
          },
        }),
      }
    );

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Service Updated Successfully!');
      console.log('New Price:', data.pricing.amount / 1e6, 'USDC');
      console.log('Updated Description:', data.description.substring(0, 80) + '...');
    } else {
      console.log('❌ Update Failed:', data.error);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

/**
 * 6. Get provider statistics
 */
async function getProviderStats() {
  console.log('\n6. Getting Provider Statistics');
  console.log('─'.repeat(60));

  try {
    const response = await fetch(
      `${API_BASE}/api/marketplace/providers/agent-storyteller-001/stats`
    );
    const data = await response.json();

    if (response.ok) {
      console.log('✅ Provider Statistics Retrieved');
      console.log('\nOverview:');
      console.log('  Provider ID:', data.providerId);
      console.log('  Total Services:', data.serviceCount);
      console.log('  Active Services:', data.activeServices);
      
      console.log('\nPerformance:');
      console.log('  Total Requests:', data.totalRequests);
      console.log('  Total Revenue:', data.totalRevenue / 1e6, 'USDC');
      console.log('  Average Rating:', data.averageRating, '⭐');
      console.log('  Total Ratings:', data.totalRatings);

      console.log('\nBy Category:');
      Object.entries(data.categories).forEach(([category, count]) => {
        console.log(`  ${category}: ${count} service(s)`);
      });
    } else {
      console.log('❌ Failed:', data.error);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

/**
 * 7. Get available categories
 */
async function getCategories() {
  console.log('\n7. Getting Available Categories');
  console.log('─'.repeat(60));

  try {
    const response = await fetch(`${API_BASE}/api/marketplace/categories`);
    const data = await response.json();

    if (response.ok) {
      console.log('✅ Categories Retrieved\n');
      data.categories.forEach(cat => {
        console.log(`${cat.icon} ${cat.name} (${cat.id})`);
        console.log(`   ${cat.description}\n`);
      });
    } else {
      console.log('❌ Failed:', data.error);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

/**
 * 8. Call a service (would require payment)
 */
async function callService(serviceId) {
  console.log('\n8. Calling a Service (Agent-to-Agent)');
  console.log('─'.repeat(60));

  if (!serviceId) {
    console.log('⏭️  Skipping (no service ID available)');
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE}/api/marketplace/services/${serviceId}/call`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'Generate a quest about retrieving a stolen magical artifact',
          difficulty: 'medium',
        }),
      }
    );

    const data = await response.json();

    if (response.status === 402) {
      console.log('💰 Payment Required (as expected)');
      console.log('Amount:', data.payment?.price?.usdcAmount / 1e6, 'USDC');
      console.log('Service:', data.payment?.metadata?.resource);
      console.log('\n📝 To call: Agent would automatically handle payment');
    } else if (response.ok) {
      console.log('✅ Service Called Successfully!');
      console.log('Result:', data.message);
      console.log('Payment:', data.payment);
    } else {
      console.log('❌ Failed:', data.error);
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
  console.log('    SERVICE MARKETPLACE DEMONSTRATION');
  console.log('='.repeat(60));
  console.log('\nTesting marketplace API for agent-to-agent commerce...');
  console.log('Server:', API_BASE);
  console.log('='.repeat(60));

  // Run examples in sequence
  const serviceId = await registerService();
  await searchServices();
  await getServiceDetails(serviceId);
  await rateService(serviceId);
  await updateService(serviceId);
  await getProviderStats();
  await getCategories();
  await callService(serviceId);

  console.log('\n' + '='.repeat(60));
  console.log('    DEMONSTRATION COMPLETE');
  console.log('='.repeat(60));
  console.log('\n✨ Marketplace backend is fully operational!');
  console.log('\n📚 What You Can Do:');
  console.log('   ✓ Register services with pricing & metadata');
  console.log('   ✓ Search/filter services by category, price, rating');
  console.log('   ✓ Rate and review services');
  console.log('   ✓ Track provider statistics and revenue');
  console.log('   ✓ Call services with automatic payment routing');
  console.log('\n🚀 Next: Build the frontend UI to browse services!\n');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples().catch(error => {
    console.error('\n❌ Demo failed:', error);
    process.exit(1);
  });
}

export { runExamples };
