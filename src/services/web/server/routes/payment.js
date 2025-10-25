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
