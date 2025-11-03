/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file examples/x402-example.mjs
 * @description Example usage of x402 payment system
 */

import { X402Service } from '../src/services/payment/x402Service.mjs';
import { AgentWalletService } from '../src/services/payment/agentWalletService.mjs';

// Mock services for demonstration
const mockLogger = {
  info: (...args) => console.log('[INFO]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  debug: (...args) => console.log('[DEBUG]', ...args),
};

const mockConfig = {
  config: {
    payment: {
      x402: {
        cdpApiKeyName: process.env.CDP_API_KEY_NAME || 'test-key',
        cdpApiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY || 'test-private-key',
        sellerAddress: process.env.X402_SELLER_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        defaultNetwork: 'base-sepolia',
        enableTestnet: true,
      },
      agentWallets: {
        encryptionKey: process.env.AGENT_WALLET_ENCRYPTION_KEY || 'test-encryption-key-32-bytes-long!!',
        defaultDailyLimit: 100 * 1e6, // 100 USDC
      },
    },
  },
};

// In-memory database simulation
const inMemoryDB = {
  agent_wallets: [],
  wallet_transactions: [],
  x402_transactions: [],
};

const mockDatabase = {
  collection: (name) => ({
    findOne: async (filter) => {
      const collection = inMemoryDB[name] || [];
      return collection.find(doc => 
        Object.keys(filter).every(key => doc[key] === filter[key])
      ) || null;
    },
    insertOne: async (doc) => {
      if (!inMemoryDB[name]) inMemoryDB[name] = [];
      inMemoryDB[name].push(doc);
      console.log(`[DB] Insert into ${name}:`, doc);
      return { insertedId: 'mock-id' };
    },
    updateOne: async (filter, update) => {
      const collection = inMemoryDB[name] || [];
      const doc = collection.find(d => 
        Object.keys(filter).every(key => d[key] === filter[key])
      );
      if (doc && update.$inc) {
        Object.keys(update.$inc).forEach(key => {
          doc[key] = (doc[key] || 0) + update.$inc[key];
        });
      }
      if (doc && update.$set) {
        Object.assign(doc, update.$set);
      }
      console.log(`[DB] Update ${name}:`, filter, update);
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    },
    find: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            toArray: async () => inMemoryDB[name] || [],
          }),
        }),
      }),
    }),
    createIndexes: async () => {},
  }),
};

const mockDatabaseService = {
  getDatabase: async () => mockDatabase,
  collection: mockDatabase.collection,
};

async function demonstrateX402() {
  console.log('\n=== X402 Payment System Demonstration ===\n');

  // 1. Initialize services
  console.log('1. Initializing X402Service...');
  const x402Service = new X402Service({
    logger: mockLogger,
    configService: mockConfig,
    databaseService: mockDatabaseService,
  });
  console.log('   ✅ X402Service initialized\n');

  console.log('2. Initializing AgentWalletService...');
  const walletService = new AgentWalletService({
    logger: mockLogger,
    configService: mockConfig,
    databaseService: mockDatabaseService,
  });
  console.log('   ✅ AgentWalletService initialized\n');

  // 2. Generate payment required response
  console.log('3. Generating payment required (402) response...');
  const paymentRequired = x402Service.generatePaymentRequired({
    amount: 50000, // 0.05 USDC
    resource: '/api/premium-model/chat',
  });
  console.log('   Payment Details:');
  console.log('   - Version:', paymentRequired.x402Version);
  console.log('   - Network:', paymentRequired.facilitator.network);
  console.log('   - Amount:', paymentRequired.price.usdcAmount / 1e6, 'USDC');
  console.log('   - Destination:', paymentRequired.paymentDestination.address);
  console.log('   - Nonce:', paymentRequired.metadata.nonce);
  console.log('   - Expires:', paymentRequired.metadata.expiresAt);
  console.log('   ✅ Payment required response generated\n');

  // 3. Create agent wallet
  console.log('4. Creating wallet for agent...');
  const wallet = await walletService.getOrCreateWallet('agent-001', {
    dailyLimit: 200 * 1e6, // 200 USDC daily limit
  });
  console.log('   Wallet Details:');
  console.log('   - Agent ID:', wallet.agentId);
  console.log('   - Address:', wallet.address);
  console.log('   - Network:', wallet.network);
  console.log('   - Daily Limit:', wallet.dailyLimit / 1e6, 'USDC');
  console.log('   ✅ Wallet created\n');

  // 4. Fund wallet (mock)
  console.log('5. Funding wallet...');
  await walletService.fundWallet('agent-001', 500 * 1e6); // 500 USDC
  const balance = await walletService.getBalance('agent-001');
  console.log('   - Balance:', balance / 1e6, 'USDC');
  console.log('   ✅ Wallet funded\n');

  // 5. Create payment transaction
  console.log('6. Creating payment transaction...');
  const payment = await walletService.createPayment({
    agentId: 'agent-001',
    to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    amount: 50000, // 0.05 USDC
    metadata: {
      purpose: 'API call payment',
      endpoint: '/api/premium-model/chat',
    },
  });
  console.log('   Transaction Details:');
  console.log('   - Transaction ID:', payment.transactionId);
  console.log('   - From:', payment.from);
  console.log('   - To:', payment.to);
  console.log('   - Amount:', payment.amount / 1e6, 'USDC');
  console.log('   - Status:', payment.status);
  console.log('   ✅ Payment transaction created\n');

  // 6. Get transaction history
  console.log('7. Retrieving transaction history...');
  const history = await walletService.getTransactionHistory('agent-001', { limit: 10 });
  console.log('   - Transactions:', history.length);
  console.log('   ✅ Transaction history retrieved\n');

  console.log('=== Demo Complete ===\n');
  console.log('✨ Phase 1 x402 implementation is working!\n');
}

// Run demonstration
demonstrateX402().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
