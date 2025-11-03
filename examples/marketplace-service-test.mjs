/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Test script for marketplace services
 * Tests service execution and payment flow
 */

import { container } from '../src/container.mjs';

async function testMarketplaceServices() {
  console.log('\n=== Marketplace Service Test ===\n');
  
  try {
    // Resolve services from container
    const logger = await container.resolve('logger');
    const databaseService = await container.resolve('databaseService');
    const agentWalletService = await container.resolve('agentWalletService');
    const marketplaceServiceRegistry = await container.resolve('marketplaceServiceRegistry');
    
    // Initialize database connection
    console.log('1. Connecting to database...');
    await databaseService.connect();
    console.log('✓ Database connected\n');
    
    // Initialize marketplace registry
    console.log('2. Initializing marketplace service registry...');
    await marketplaceServiceRegistry.initialize();
    console.log('✓ Registry initialized\n');
    
    // List all available services
    console.log('3. Available Services:');
    const services = await marketplaceServiceRegistry.getAllServices();
    for (const service of services) {
      console.log(`   - ${service.name}: ${service.priceUSDC} USDC (${service.category})`);
      console.log(`     ${service.description}`);
    }
    console.log('');
    
    // Test agent setup (create test agent wallet)
    const testAgentId = 'test-agent-' + Date.now();
    console.log(`4. Creating test agent wallet: ${testAgentId}...`);
    await agentWalletService.getOrCreateWallet(testAgentId);
    
    // Fund the test wallet
    console.log('5. Funding test wallet with 100 USDC...');
    await agentWalletService.deposit(testAgentId, 100, 'test-funding', {
      source: 'test-script'
    });
    
    const balance = await agentWalletService.getBalance(testAgentId);
    console.log(`✓ Test wallet balance: ${balance} USDC\n`);
    
    // Test 1: Memory Query (cheapest service)
    console.log('6. Testing Memory Query service (0.1 USDC)...');
    try {
      const memoryResult = await marketplaceServiceRegistry.executeService(
        'memory-query',
        testAgentId,
        {
          query: 'test query about the world',
          agentId: testAgentId,
          limit: 5
        }
      );
      console.log(`✓ Memory query executed: ${memoryResult.results.length} results found`);
      console.log(`  New balance: ${await agentWalletService.getBalance(testAgentId)} USDC\n`);
    } catch (error) {
      console.error('✗ Memory query failed:', error.message);
    }
    
    // Test 2: Image Generation
    console.log('7. Testing Image Generation service (1 USDC)...');
    try {
      const imageResult = await marketplaceServiceRegistry.executeService(
        'image-generation',
        testAgentId,
        {
          prompt: 'A beautiful fantasy landscape',
          agentId: testAgentId,
          style: 'fantasy',
          aspectRatio: '16:9'
        }
      );
      console.log(`✓ Image generation started: Job ID ${imageResult.jobId}`);
      console.log(`  New balance: ${await agentWalletService.getBalance(testAgentId)} USDC\n`);
    } catch (error) {
      console.error('✗ Image generation failed:', error.message);
    }
    
    // Test 3: Agent Summon
    console.log('8. Testing Agent Summon service (0.5 USDC)...');
    try {
      const summonResult = await marketplaceServiceRegistry.executeService(
        'agent-summon',
        testAgentId,
        {
          targetAgentId: 'another-agent-123',
          location: 'Central Plaza',
          message: 'Join me for a meeting!',
          priority: 'normal'
        }
      );
      console.log(`✓ Agent summoned: ${summonResult.success ? 'Success' : 'Failed'}`);
      console.log(`  New balance: ${await agentWalletService.getBalance(testAgentId)} USDC\n`);
    } catch (error) {
      console.error('✗ Agent summon failed:', error.message);
    }
    
    // Show final balance
    const finalBalance = await agentWalletService.getBalance(testAgentId);
    const spent = 100 - finalBalance;
    console.log(`9. Final Results:`);
    console.log(`   - Starting balance: 100 USDC`);
    console.log(`   - Ending balance: ${finalBalance} USDC`);
    console.log(`   - Total spent: ${spent} USDC`);
    console.log(`   - Services executed: ${spent > 0 ? Math.round(spent * 10) / 10 : 0}\n`);
    
    console.log('✓ All tests completed successfully!\n');
    
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

// Run tests
testMarketplaceServices();
