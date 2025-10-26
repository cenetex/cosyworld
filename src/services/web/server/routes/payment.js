/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/web/server/routes/payment.js
 * @description Payment configuration API routes
 */

import express from 'express';

export default function createPaymentRoutes(services) {
  const router = express.Router();
  const { configService, logger, x402Service } = services;

  /**
   * GET /api/payment/config
   * Get current payment configuration
   */
  router.get('/config', async (req, res) => {
    try {
      // Try to load from database first, fall back to config service
      let config = configService.config?.payment || {};
      
      const { databaseService } = services;
      if (databaseService) {
        try {
          const db = await databaseService.getDatabase();
          const settingsCollection = db.collection('settings');
          
          // Load all payment settings from database
          const paymentSettings = await settingsCollection.find({
            key: { $regex: /^payment\./ },
            scope: 'global'
          }).toArray();
          
          // Build config object from database
          if (paymentSettings.length > 0) {
            config = { x402: {}, agentWallets: {} };
            
            for (const setting of paymentSettings) {
              const parts = setting.key.split('.');
              if (parts[0] === 'payment') {
                if (parts[1] === 'x402') {
                  config.x402[parts[2]] = setting.value;
                } else if (parts[1] === 'agentWallets') {
                  config.agentWallets[parts[2]] = setting.value;
                }
              }
            }
          }
        } catch (dbError) {
          logger.warn('[PaymentConfig] Failed to load from database, using config service:', dbError.message);
        }
      }
      
      // Log what we're returning (for debugging)
      logger.info('[PaymentConfig] GET config - apiKeyId present:', !!config.x402?.apiKeyId);
      logger.info('[PaymentConfig] GET config - apiKeySecret length:', config.x402?.apiKeySecret?.length || 0);
      logger.info('[PaymentConfig] GET config - sellerAddress present:', !!config.x402?.sellerAddress);
      
      // Return configuration with sensitive data masked
      const response = {
        // x402 configuration
        apiKeyId: config.x402?.apiKeyId || process.env.CDP_API_KEY_ID || '',
        apiKeySecret: maskSecret(config.x402?.apiKeySecret || process.env.CDP_API_KEY_SECRET || ''),
        sellerAddress: config.x402?.sellerAddress || process.env.X402_SELLER_ADDRESS || '',
        defaultNetwork: config.x402?.defaultNetwork || 'base-sepolia',
        enableTestnet: config.x402?.enableTestnet !== false,
        
        // Agent wallet configuration
        walletEncryptionKey: maskKey(config.agentWallets?.encryptionKey || process.env.AGENT_WALLET_ENCRYPTION_KEY || ''),
        defaultDailyLimit: config.agentWallets?.defaultDailyLimit || 100 * 1e6, // 100 USDC
      };
      
      res.json(response);
    } catch (error) {
      logger.error('GET /api/payment/config failed:', error);
      res.status(500).json({ error: 'Failed to load payment configuration' });
    }
  });

  /**
   * POST /api/payment/config
   * Save payment configuration
   */
  router.post('/config', async (req, res) => {
    try {
      const {
        apiKeyId,
        apiKeySecret,
        sellerAddress,
        defaultNetwork,
        enableTestnet,
        walletEncryptionKey,
        defaultDailyLimit,
      } = req.body;

      // Validate required fields
      if (apiKeyId && apiKeyId.trim().length < 10) {
        return res.status(400).json({ 
          error: 'CDP API Key ID appears invalid (too short)' 
        });
      }

      // Accept both UUID format and organizations/{orgId}/apiKeys/{keyId} format
      if (apiKeyId) {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(apiKeyId);
        const isPath = /^organizations\/[^/]+\/apiKeys\/[^/]+$/i.test(apiKeyId);
        
        if (!isUUID && !isPath) {
          return res.status(400).json({ 
            error: 'CDP API Key ID must be either UUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) or path format (organizations/{orgId}/apiKeys/{keyId})' 
          });
        }
      }

      if (apiKeySecret && apiKeySecret.length < 20) {
        return res.status(400).json({ 
          error: 'CDP API Key Secret appears invalid (too short)' 
        });
      }

      if (sellerAddress && !sellerAddress.startsWith('0x')) {
        return res.status(400).json({ 
          error: 'Seller address must start with 0x' 
        });
      }

      if (walletEncryptionKey && walletEncryptionKey.length < 32) {
        return res.status(400).json({ 
          error: 'Encryption key must be at least 32 characters' 
        });
      }

      // Update config service in memory
      if (!configService.config.payment) {
        configService.config.payment = {};
      }

      // Trim all string values to remove whitespace
      const trimmedApiKeyId = apiKeyId?.trim();
      const trimmedApiKeySecret = apiKeySecret?.trim();
      const trimmedSellerAddress = sellerAddress?.trim();
      const trimmedDefaultNetwork = defaultNetwork?.trim();
      const trimmedWalletEncryptionKey = walletEncryptionKey?.trim();

      logger.info('[PaymentConfig] Saving configuration (trimmed values)');
      logger.debug('[PaymentConfig] apiKeyId:', trimmedApiKeyId);
      logger.debug('[PaymentConfig] apiKeySecret length:', trimmedApiKeySecret?.length);
      logger.debug('[PaymentConfig] sellerAddress:', trimmedSellerAddress);

      configService.config.payment.x402 = {
        apiKeyId: trimmedApiKeyId || '',
        apiKeySecret: trimmedApiKeySecret || '',
        sellerAddress: trimmedSellerAddress || '',
        defaultNetwork: trimmedDefaultNetwork || 'base-sepolia',
        enableTestnet: enableTestnet !== false,
      };

      configService.config.payment.agentWallets = {
        encryptionKey: trimmedWalletEncryptionKey || '',
        defaultDailyLimit: defaultDailyLimit || 100 * 1e6,
      };

      // Save to database directly
      const { databaseService } = services;
      if (databaseService) {
        try {
          const db = await databaseService.getDatabase();
          const settingsCollection = db.collection('settings');
          
          // Save individual settings as documents
          const settings = [
            { key: 'payment.x402.apiKeyId', value: trimmedApiKeyId },
            { key: 'payment.x402.apiKeySecret', value: trimmedApiKeySecret },
            { key: 'payment.x402.sellerAddress', value: trimmedSellerAddress },
            { key: 'payment.x402.defaultNetwork', value: trimmedDefaultNetwork },
            { key: 'payment.x402.enableTestnet', value: enableTestnet },
            { key: 'payment.agentWallets.encryptionKey', value: trimmedWalletEncryptionKey },
            { key: 'payment.agentWallets.defaultDailyLimit', value: defaultDailyLimit },
          ];

          for (const setting of settings) {
            if (setting.value !== undefined && setting.value !== null && setting.value !== '') {
              await settingsCollection.updateOne(
                { key: setting.key, scope: 'global' },
                { 
                  $set: { 
                    value: setting.value,
                    scope: 'global',
                    updatedAt: new Date()
                  },
                  $setOnInsert: { createdAt: new Date() }
                },
                { upsert: true }
              );
            }
          }
          
          logger.info('[PaymentConfig] Configuration saved to database');
        } catch (dbError) {
          logger.error('[PaymentConfig] Failed to save to database:', dbError);
          // Don't throw - config is still in memory
        }
      }
      
      // Update x402Service with new credentials if it exists
      const { x402Service, agentWalletService } = services;
      if (x402Service && trimmedApiKeyId && trimmedApiKeySecret && trimmedSellerAddress) {
        x402Service.cdpApiKeyId = trimmedApiKeyId;
        x402Service.cdpApiKeySecret = trimmedApiKeySecret;
        x402Service.sellerAddress = trimmedSellerAddress;
        x402Service.defaultNetwork = enableTestnet ? 'base-sepolia' : (trimmedDefaultNetwork || 'base');
        x402Service.configured = true;
        
        // Clear cached networks to force refresh with new credentials
        x402Service._supportedNetworksCache = null;
        
        logger.info('[PaymentConfig] x402Service credentials updated');
      }
      
      // Update agentWalletService with new encryption key if it exists
      if (agentWalletService && trimmedWalletEncryptionKey) {
        const crypto = await import('crypto');
        agentWalletService.encryptionKey = Buffer.from(
          crypto.default.createHash('sha256').update(trimmedWalletEncryptionKey).digest()
        );
        agentWalletService.defaultDailyLimit = defaultDailyLimit || 100 * 1e6;
        agentWalletService.configured = true;
        
        logger.info('[PaymentConfig] AgentWalletService encryption key updated');
      }

      res.json({ 
        success: true, 
        message: 'Payment configuration saved successfully' 
      });
    } catch (error) {
      logger.error('POST /api/payment/config failed:', error);
      res.status(500).json({ error: 'Failed to save payment configuration: ' + error.message });
    }
  });

  /**
   * GET /api/payment/debug
   * Debug endpoint to check actual configuration state
   */
  router.get('/debug', async (req, res) => {
    try {
      const { x402Service, agentWalletService } = services;
      
      res.json({
        x402Service: {
          exists: !!x402Service,
          configured: x402Service?.configured,
          isConfigured: typeof x402Service?.isConfigured === 'function' ? x402Service.isConfigured() : null,
          cdpApiKeyId: x402Service?.cdpApiKeyId ? '(set)' : '(not set)',
          cdpApiKeyIdLength: x402Service?.cdpApiKeyId?.length || 0,
          cdpApiKeySecret: x402Service?.cdpApiKeySecret ? '(set)' : '(not set)',
          cdpApiKeySecretLength: x402Service?.cdpApiKeySecret?.length || 0,
          sellerAddress: x402Service?.sellerAddress ? '(set)' : '(not set)',
          sellerAddressValue: x402Service?.sellerAddress || null,
        },
        agentWalletService: {
          exists: !!agentWalletService,
          configured: agentWalletService?.configured,
          isConfigured: typeof agentWalletService?.isConfigured === 'function' ? agentWalletService.isConfigured() : null,
          encryptionKey: agentWalletService?.encryptionKey ? '(set)' : '(not set)',
        },
      });
    } catch (error) {
      logger.error('GET /api/payment/debug failed:', error);
      res.status(500).json({ error: 'Debug failed: ' + error.message });
    }
  });

  /**
   * GET /api/payment/test-connection
   * Test connection to CDP API by checking configuration
   */
  router.get('/test-connection', async (req, res) => {
    try {
      const { x402Service } = services;
      
      if (!x402Service || !x402Service.configured) {
        return res.status(400).json({ 
          error: 'X402Service not configured. Please configure CDP credentials first.' 
        });
      }

      // Test by getting supported networks (no API call, just returns hardcoded values)
      const networks = await x402Service.getSupportedNetworks();
      
      // Verify we have valid credentials by checking they're set
      const hasApiKeyId = !!x402Service.cdpApiKeyId;
      const hasApiKeySecret = !!x402Service.cdpApiKeySecret;
      const hasSellerAddress = !!x402Service.sellerAddress;
      
      if (!hasApiKeyId || !hasApiKeySecret || !hasSellerAddress) {
        return res.status(400).json({
          error: 'Missing required credentials',
          details: {
            hasApiKeyId,
            hasApiKeySecret,
            hasSellerAddress
          }
        });
      }

      res.json({ 
        success: true, 
        message: 'CDP configuration is valid',
        networks: networks.map(n => ({
          kind: n.kind,
          networks: n.networks,
          tokens: n.tokens
        })),
        config: {
          defaultNetwork: x402Service.defaultNetwork,
          sellerAddress: x402Service.sellerAddress,
        }
      });
    } catch (error) {
      logger.error('Payment connection test failed:', error.message, error);
      res.status(500).json({ 
        error: `Failed to test connection: ${error.message}` 
      });
    }
  });  /**
   * GET /api/payment/stats
   * Get payment statistics
   */
  router.get('/stats', async (req, res) => {
    try {
      const { databaseService, x402Service, agentWalletService } = services;
      const db = await databaseService.getDatabase();

      // Check if services are configured - use dynamic method if available
      const x402Configured = !!(
        x402Service && 
        (typeof x402Service.isConfigured === 'function' ? x402Service.isConfigured() : x402Service.configured) &&
        x402Service.cdpApiKeyId && 
        x402Service.cdpApiKeySecret && 
        x402Service.sellerAddress
      );
      
      const walletConfigured = !!(
        agentWalletService && 
        (typeof agentWalletService.isConfigured === 'function' ? agentWalletService.isConfigured() : agentWalletService.configured) &&
        agentWalletService.encryptionKey
      );

      // Get transaction counts
      const x402Transactions = await db.collection('x402_transactions').countDocuments();
      const walletTransactions = await db.collection('wallet_transactions').countDocuments();
      const agentWallets = await db.collection('agent_wallets').countDocuments();

      // Get recent transactions
      const recentX402 = await db.collection('x402_transactions')
        .find()
        .sort({ verifiedAt: -1 })
        .limit(10)
        .toArray();

      const recentWallet = await db.collection('wallet_transactions')
        .find()
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();

      // Calculate total volume and revenue
      const x402Pipeline = [
        {
          $group: {
            _id: null,
            totalVolume: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ];
      
      const x402Aggregate = await db.collection('x402_transactions')
        .aggregate(x402Pipeline)
        .toArray();
      
      const totalVolume = x402Aggregate[0]?.totalVolume || 0;
      const platformRevenue = totalVolume * 0.02; // 2% platform fee

      // Get transaction counts by status
      const statusCounts = await db.collection('x402_transactions')
        .aggregate([
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ])
        .toArray();

      // Get hourly transaction data (last 24 hours)
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const hourlyData = await db.collection('x402_transactions')
        .aggregate([
          {
            $match: {
              verifiedAt: { $gte: twentyFourHoursAgo }
            }
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d-%H',
                  date: '$verifiedAt'
                }
              },
              count: { $sum: 1 },
              volume: { $sum: '$amount' }
            }
          },
          {
            $sort: { _id: 1 }
          }
        ])
        .toArray();

      res.json({
        configured: {
          x402: x402Configured,
          wallet: walletConfigured,
        },
        stats: {
          x402Transactions,
          walletTransactions,
          agentWallets,
          totalVolume,
          platformRevenue,
        },
        statusCounts,
        hourlyData,
        recentX402,
        recentWallet,
      });
    } catch (error) {
      logger.error('GET /api/payment/stats failed:', error);
      res.status(500).json({ error: 'Failed to load payment statistics' });
    }
  });

  /**
   * GET /api/payment/wallets
   * Get all agent wallets with details
   */
  router.get('/wallets', async (req, res) => {
    try {
      const { databaseService } = services;
      const db = await databaseService.getDatabase();
      
      const { search, limit = 50, page = 1 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build query
      const query = {};
      if (search) {
        query.$or = [
          { agentId: { $regex: search, $options: 'i' } },
          { address: { $regex: search, $options: 'i' } },
        ];
      }

      // Get wallets with transaction stats
      const wallets = await db.collection('agent_wallets')
        .aggregate([
          { $match: query },
          {
            $lookup: {
              from: 'wallet_transactions',
              localField: 'agentId',
              foreignField: 'agentId',
              as: 'transactions'
            }
          },
          {
            $addFields: {
              transactionCount: { $size: '$transactions' },
              totalSpent: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: '$transactions',
                        as: 'tx',
                        cond: { $eq: ['$$tx.type', 'spend'] }
                      }
                    },
                    as: 'tx',
                    in: '$$tx.amount'
                  }
                }
              }
            }
          },
          { $project: { transactions: 0 } }, // Remove full transaction list
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: parseInt(limit) }
        ])
        .toArray();

      // Get total count
      const totalCount = await db.collection('agent_wallets').countDocuments(query);

      res.json({
        wallets,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / parseInt(limit))
        }
      });
    } catch (error) {
      logger.error('GET /api/payment/wallets failed:', error);
      res.status(500).json({ error: 'Failed to load wallets' });
    }
  });

  /**
   * GET /api/payment/wallets/:agentId
   * Get specific wallet details
   */
  router.get('/wallets/:agentId', async (req, res) => {
    try {
      const { databaseService } = services;
      const db = await databaseService.getDatabase();
      const { agentId } = req.params;

      const wallet = await db.collection('agent_wallets').findOne({ agentId });
      
      if (!wallet) {
        return res.status(404).json({ error: 'Wallet not found' });
      }

      // Get recent transactions for this wallet
      const transactions = await db.collection('wallet_transactions')
        .find({ agentId })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();

      // Calculate spending stats
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const dailySpent = transactions
        .filter(tx => tx.type === 'spend' && new Date(tx.createdAt) >= today)
        .reduce((sum, tx) => sum + (tx.amount || 0), 0);

      res.json({
        wallet,
        transactions,
        stats: {
          dailySpent,
          dailyLimit: wallet.dailySpendLimit || 100 * 1e6,
          totalTransactions: transactions.length,
        }
      });
    } catch (error) {
      logger.error('GET /api/payment/wallets/:agentId failed:', error);
      res.status(500).json({ error: 'Failed to load wallet details' });
    }
  });

  /**
   * GET /api/payment/transactions
   * Get paginated transaction list
   */
  router.get('/transactions', async (req, res) => {
    try {
      const { databaseService } = services;
      const db = await databaseService.getDatabase();
      
      const { 
        type = 'all', // 'x402', 'wallet', or 'all'
        status,
        agentId,
        limit = 50, 
        page = 1 
      } = req.query;
      
      const skip = (parseInt(page) - 1) * parseInt(limit);

      let transactions = [];

      if (type === 'x402' || type === 'all') {
        const query = {};
        if (status) query.status = status;
        if (agentId) query.agentId = agentId;

        const x402Txs = await db.collection('x402_transactions')
          .find(query)
          .sort({ verifiedAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();
        
        transactions.push(...x402Txs.map(tx => ({ ...tx, source: 'x402' })));
      }

      if (type === 'wallet' || type === 'all') {
        const query = {};
        if (agentId) query.agentId = agentId;

        const walletTxs = await db.collection('wallet_transactions')
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();
        
        transactions.push(...walletTxs.map(tx => ({ ...tx, source: 'wallet' })));
      }

      // Sort combined transactions by date
      transactions.sort((a, b) => {
        const dateA = new Date(a.verifiedAt || a.createdAt);
        const dateB = new Date(b.verifiedAt || b.createdAt);
        return dateB - dateA;
      });

      // Get total count
      const x402Count = (type === 'x402' || type === 'all') 
        ? await db.collection('x402_transactions').countDocuments({})
        : 0;
      const walletCount = (type === 'wallet' || type === 'all')
        ? await db.collection('wallet_transactions').countDocuments({})
        : 0;
      const totalCount = type === 'all' ? x402Count + walletCount : (x402Count || walletCount);

      res.json({
        transactions: transactions.slice(0, parseInt(limit)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / parseInt(limit))
        }
      });
    } catch (error) {
      logger.error('GET /api/payment/transactions failed:', error);
      res.status(500).json({ error: 'Failed to load transactions' });
    }
  });

  /**
   * GET /api/payment/dashboard
   * Get comprehensive dashboard data in one request
   */
  router.get('/dashboard', async (req, res) => {
    try {
      const { databaseService, x402Service, agentWalletService } = services;
      const db = await databaseService.getDatabase();

      // Check if services are configured - use dynamic method if available
      const x402Configured = !!(
        x402Service && 
        (typeof x402Service.isConfigured === 'function' ? x402Service.isConfigured() : x402Service.configured) &&
        x402Service.cdpApiKeyId && 
        x402Service.cdpApiKeySecret && 
        x402Service.sellerAddress
      );
      
      const walletConfigured = !!(
        agentWalletService && 
        (typeof agentWalletService.isConfigured === 'function' ? agentWalletService.isConfigured() : agentWalletService.configured) &&
        agentWalletService.encryptionKey
      );

      // Run all queries in parallel for better performance
      const [
        x402Count,
        walletCount,
        walletsCount,
        recentX402,
        volumeData,
        statusCounts,
        hourlyData,
        topWallets
      ] = await Promise.all([
        db.collection('x402_transactions').countDocuments(),
        db.collection('wallet_transactions').countDocuments(),
        db.collection('agent_wallets').countDocuments(),
        db.collection('x402_transactions').find().sort({ verifiedAt: -1 }).limit(10).toArray(),
        db.collection('x402_transactions').aggregate([
          { $group: { _id: null, totalVolume: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]).toArray(),
        db.collection('x402_transactions').aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).toArray(),
        db.collection('x402_transactions').aggregate([
          { $match: { verifiedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
          { $group: {
              _id: { $dateToString: { format: '%Y-%m-%d-%H', date: '$verifiedAt' } },
              count: { $sum: 1 },
              volume: { $sum: '$amount' }
            }
          },
          { $sort: { _id: 1 } }
        ]).toArray(),
        db.collection('agent_wallets').find().sort({ balance: -1 }).limit(10).toArray()
      ]);

      const totalVolume = volumeData[0]?.totalVolume || 0;
      const platformRevenue = totalVolume * 0.02;

      res.json({
        configured: {
          x402: x402Configured,
          wallet: walletConfigured,
        },
        overview: {
          totalTransactions: x402Count + walletCount,
          x402Transactions: x402Count,
          walletTransactions: walletCount,
          agentWallets: walletsCount,
          totalVolume,
          platformRevenue,
        },
        statusCounts,
        hourlyData,
        recentTransactions: recentX402,
        topWallets,
      });
    } catch (error) {
      logger.error('GET /api/payment/dashboard failed:', error);
      res.status(500).json({ error: 'Failed to load dashboard data' });
    }
  });

  return router;
}

/**
 * Mask API key secret for display (show only first/last 8 chars)
 */
function maskSecret(secret) {
  if (!secret || secret.length < 16) return secret;
  return secret.substring(0, 8) + '****' + secret.substring(secret.length - 8);
}

/**
 * Mask encryption key (show only first 4 chars)
 */
function maskKey(key) {
  if (!key || key.length < 8) return key;
  return key.substring(0, 4) + '****';
}
