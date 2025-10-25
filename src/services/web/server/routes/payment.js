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
      const config = configService.config?.payment || {};
      
      // Return configuration with sensitive data masked if not admin
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

      // Update config service
      if (!configService.config.payment) {
        configService.config.payment = {};
      }

      configService.config.payment.x402 = {
        apiKeyId: apiKeyId || '',
        apiKeySecret: apiKeySecret || '',
        sellerAddress: sellerAddress || '',
        defaultNetwork: defaultNetwork || 'base-sepolia',
        enableTestnet: enableTestnet !== false,
      };

      configService.config.payment.agentWallets = {
        encryptionKey: walletEncryptionKey || '',
        defaultDailyLimit: defaultDailyLimit || 100 * 1e6,
      };

      // Save to database using settings service
      const { settingsService } = services;
      if (settingsService) {
        // Save individual settings
        const settings = [
          { key: 'payment.x402.apiKeyId', value: apiKeyId },
          { key: 'payment.x402.apiKeySecret', value: apiKeySecret },
          { key: 'payment.x402.sellerAddress', value: sellerAddress },
          { key: 'payment.x402.defaultNetwork', value: defaultNetwork },
          { key: 'payment.x402.enableTestnet', value: enableTestnet },
          { key: 'payment.agentWallets.encryptionKey', value: walletEncryptionKey },
          { key: 'payment.agentWallets.defaultDailyLimit', value: defaultDailyLimit },
        ];

        for (const setting of settings) {
          if (setting.value !== undefined && setting.value !== null && setting.value !== '') {
            await settingsService.set(setting.key, setting.value, { scope: 'global' });
          }
        }
      }

      logger.info('[PaymentConfig] Configuration updated');

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
   * GET /api/payment/test-connection
   * Test connection to CDP API
   */
  router.get('/test-connection', async (req, res) => {
    try {
      if (!x402Service) {
        return res.json({ 
          success: false, 
          error: 'x402Service not initialized. Check server logs and restart if needed.' 
        });
      }

      if (!x402Service.configured) {
        return res.json({ 
          success: false, 
          error: 'x402Service not configured. Please enter your CDP credentials and save configuration first.' 
        });
      }

      // Test by fetching supported networks
      const networks = await x402Service.getSupportedNetworks();
      
      res.json({ 
        success: true, 
        networks: networks,
        message: `Successfully connected. ${networks.length} networks available.`
      });
    } catch (error) {
      logger.error('Payment connection test failed:', error);
      res.json({ 
        success: false, 
        error: error.message || 'Connection test failed'
      });
    }
  });

  /**
   * GET /api/payment/stats
   * Get payment statistics
   */
  router.get('/stats', async (req, res) => {
    try {
      const { databaseService } = services;
      const db = await databaseService.getDatabase();

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

      res.json({
        stats: {
          x402Transactions,
          walletTransactions,
          agentWallets,
        },
        recentX402,
        recentWallet,
      });
    } catch (error) {
      logger.error('GET /api/payment/stats failed:', error);
      res.status(500).json({ error: 'Failed to load payment statistics' });
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
