/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

/**
 * Setup routes for first-time application configuration
 * Accessible without authentication until setup is complete
 */
export default function createSetupRouter(services) {
  const router = express.Router();
  const { logger, setupStatusService, secretsService, configService } = services;

  /**
   * Check if setup is required
   * GET /api/setup/status
   */
  router.get('/status', async (req, res) => {
    try {
      const status = await setupStatusService.getSetupStatus();
      const missing = await setupStatusService.getMissingConfiguration();
      
      res.json({
        setupComplete: status.setupComplete,
        adminWallet: status.adminWallet,
        setupDate: status.setupDate,
        requiresSetup: !status.setupComplete || missing.length > 0,
        missingConfig: missing
      });
    } catch (error) {
      logger?.error?.('[Setup API] Status check failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Get current configuration (masked)
   * GET /api/setup/config
   */
  router.get('/config', async (req, res) => {
    try {
      const maskSecret = (v) => {
        if (!v || v.length < 12) return '***';
        return v.substring(0, 8) + '***' + v.substring(v.length - 4);
      };

      const config = {
        encryption: {
          hasKey: !!process.env.ENCRYPTION_KEY,
          keyLength: process.env.ENCRYPTION_KEY?.length || 0
        },
        mongo: {
          uri: process.env.MONGO_URI ? maskSecret(process.env.MONGO_URI) : null,
          dbName: process.env.MONGO_DB_NAME || 'cosyworld8',
          configured: !!process.env.MONGO_URI
        },
        discord: {
          botToken: process.env.DISCORD_BOT_TOKEN ? maskSecret(process.env.DISCORD_BOT_TOKEN) : null,
          clientId: process.env.DISCORD_CLIENT_ID || null, // Not a secret
          configured: !!(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CLIENT_ID)
        },
        ai: {
          service: process.env.AI_SERVICE || 'openrouter',
          openrouter: {
            apiKey: process.env.OPENROUTER_API_KEY ? maskSecret(process.env.OPENROUTER_API_KEY) : null,
            model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-pro', // Not a secret
            chatModel: process.env.OPENROUTER_CHAT_MODEL || process.env.OPENROUTER_MODEL || null,
            visionModel: process.env.OPENROUTER_VISION_MODEL || process.env.OPENROUTER_MODEL || null,
            structuredModel: process.env.OPENROUTER_STRUCTURED_MODEL || process.env.OPENROUTER_MODEL || null,
            configured: !!process.env.OPENROUTER_API_KEY
          },
          google: {
            apiKey: (process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY) ? maskSecret(process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY) : null,
            model: process.env.GOOGLE_AI_MODEL || 'gemini-2.5-flash', // Not a secret
            configured: !!(process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY)
          }
        },
        optional: {
          replicate: { 
            configured: !!process.env.REPLICATE_API_TOKEN,
            model: process.env.REPLICATE_LORA_WEIGHTS || process.env.REPLICATE_MODEL || null,
            baseModel: process.env.REPLICATE_BASE_MODEL || process.env.REPLICATE_MODEL || 'black-forest-labs/flux-dev-lora',
            loraWeights: process.env.REPLICATE_LORA_WEIGHTS || process.env.REPLICATE_MODEL || null,
            loraTrigger: process.env.REPLICATE_LORA_TRIGGER || process.env.LORA_TRIGGER_WORD || null
          },
          s3: { 
            configured: !!(process.env.S3_API_ENDPOINT && process.env.S3_API_KEY),
            endpoint: process.env.S3_API_ENDPOINT || null,
            uploadBaseUrl: process.env.UPLOAD_API_BASE_URL || null,
            cloudfrontDomain: process.env.CLOUDFRONT_DOMAIN || null
          },
          twitter: { 
            configured: !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET),
            clientId: process.env.X_CLIENT_ID || null,
            callbackUrl: process.env.X_CALLBACK_URL || 'http://localhost:3000/api/xauth/callback'
          },
          helius: { 
            configured: !!process.env.HELIUS_API_KEY 
          }
        }
      };

      res.json(config);
    } catch (error) {
      logger?.error?.('[Setup API] Config retrieval failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Generate encryption key
   * POST /api/setup/generate-key
   */
  router.post('/generate-key', (req, res) => {
    try {
      const key = crypto.randomBytes(32).toString('hex');
      res.json({ key });
    } catch (error) {
      logger?.error?.('[Setup API] Key generation failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Verify Phantom wallet signature
   * POST /api/setup/verify-wallet
   * Body: { wallet, message, signature }
   */
  router.post('/verify-wallet', async (req, res) => {
    try {
      const { wallet, message, signature } = req.body;

      if (!wallet || !message || !signature) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Verify the signature
      const publicKey = bs58.decode(wallet);
      const messageBytes = new TextEncoder().encode(message);
      
      // Signature comes as base64 from frontend
      const signatureBytes = Buffer.from(signature, 'base64');

      const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);

      if (!valid) {
        return res.status(401).json({ error: 'Invalid signature', valid: false });
      }

      res.json({ valid: true, wallet });
    } catch (error) {
      logger?.error?.('[Setup API] Wallet verification failed:', error);
      res.status(500).json({ error: error.message, valid: false });
    }
  });

  /**
   * Save configuration and complete setup
   * POST /api/setup/complete
   * Body: { config, adminWallet, signature, message }
   */
  router.post('/complete', express.json({ limit: '5mb' }), async (req, res) => {
    try {
      const { config, adminWallet, signature, message } = req.body;

      // Verify admin wallet signature
      if (!adminWallet || !signature || !message) {
        return res.status(400).json({ error: 'Admin wallet authentication required' });
      }

      const publicKey = bs58.decode(adminWallet);
      const messageBytes = new TextEncoder().encode(message);
      
      // Signature comes as base64 from frontend
      const signatureBytes = Buffer.from(signature, 'base64');
      
      const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);

      if (!valid) {
        return res.status(401).json({ error: 'Invalid admin wallet signature' });
      }

      // If an admin wallet is already registered and it's different, block completion
      try {
        const status = await setupStatusService.getSetupStatus();
        // Prefer DB-registered admin wallet; fallback to secrets/env
        const secretsAdmin = await secretsService.getAsync?.('ADMIN_WALLET').catch?.(() => undefined) || null;
        const envAdmin = process.env.ADMIN_WALLET || null;
        const knownAdmin = status.adminWallet || secretsAdmin || envAdmin || null;
        if (knownAdmin && knownAdmin !== adminWallet) {
          return res.status(403).json({ 
            error: 'Setup is already registered to a different admin wallet. Please log in with the registered admin wallet to continue.',
            code: 'ADMIN_WALLET_CONFLICT'
          });
        }
      } catch (e) {
        logger?.warn?.('[Setup API] Admin wallet pre-check failed:', e?.message || e);
      }

      // Save configuration
      await saveConfiguration(config, secretsService, logger);

      // Mark setup as complete with admin wallet
      await setupStatusService.markSetupComplete(adminWallet);

      logger?.info?.('[Setup API] Setup completed by admin:', adminWallet);

      res.json({ 
        success: true, 
        message: 'Configuration saved successfully! You can now use the application.',
        requiresRestart: false,
        redirectTo: '/admin'
      });
    } catch (error) {
      logger?.error?.('[Setup API] Setup completion failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Update single configuration value
   * POST /api/setup/update
   * Body: { key, value, adminWallet, signature, message }
   * Requires admin authentication
   */
  router.post('/update', express.json(), async (req, res) => {
    try {
      const { key, value, adminWallet, signature, message } = req.body;

      // Verify admin wallet
      if (!adminWallet || !signature || !message) {
        return res.status(401).json({ error: 'Admin authentication required' });
      }

      const isAdmin = await setupStatusService.isAdminWallet(adminWallet);
      if (!isAdmin) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      // Verify signature
      const publicKey = bs58.decode(adminWallet);
      const messageBytes = new TextEncoder().encode(message);
      
      // Signature comes as base64 from frontend
      const signatureBytes = Buffer.from(signature, 'base64');
      
      const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);

      if (!valid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Update configuration
      await secretsService.set(key, value);
      process.env[key] = value;

      logger?.info?.(`[Setup API] Configuration updated: ${key} by ${adminWallet}`);

      res.json({ success: true, message: `${key} updated successfully` });
    } catch (error) {
      logger?.error?.('[Setup API] Update failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Reset configuration (development/admin only)
   * POST /api/setup/reset
   * Body: { adminWallet, signature, message, confirm: 'RESET' }
   */
  router.post('/reset', express.json(), async (req, res) => {
    try {
      const { adminWallet, signature, message, confirm } = req.body;

      if (confirm !== 'RESET') {
        return res.status(400).json({ error: 'Must confirm reset with "RESET"' });
      }

      // Verify admin wallet
      const isAdmin = await setupStatusService.isAdminWallet(adminWallet);
      if (!isAdmin) {
        return res.status(403).json({ error: 'Not authorized - admin only' });
      }

      // Verify signature
      const publicKey = bs58.decode(adminWallet);
      const messageBytes = new TextEncoder().encode(message);
      
      // Signature comes as base64 from frontend
      const signatureBytes = Buffer.from(signature, 'base64');
      
      const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);

      if (!valid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Reset setup status
      await setupStatusService.resetSetup();

      logger?.warn?.(`[Setup API] Configuration reset initiated by admin: ${adminWallet}`);

      res.json({ 
        success: true, 
        message: 'Configuration reset. Please complete setup again.' 
      });
    } catch (error) {
      logger?.error?.('[Setup API] Reset failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

/**
 * Save configuration to secrets service and environment
 * @private
 */
async function saveConfiguration(config, secretsService, logger) {
  const useExisting = (value, envKey, fallback = undefined) => {
    if (value === 'KEEP_EXISTING') {
      return process.env[envKey] ?? fallback;
    }
    if (value === undefined || value === null) {
      return fallback;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return fallback;
      }
      return trimmed;
    }
    return value;
  };

  // Build environment variables
  const envVars = {
    // Core - keep existing values if KEEP_EXISTING is specified
    ENCRYPTION_KEY: config.encryption?.key === 'KEEP_EXISTING' ? process.env.ENCRYPTION_KEY : (config.encryption?.key || process.env.ENCRYPTION_KEY),
    SERVER_SECRET_KEY: config.encryption?.serverKey === 'KEEP_EXISTING' ? process.env.SERVER_SECRET_KEY : (config.encryption?.serverKey || process.env.SERVER_SECRET_KEY || crypto.randomBytes(32).toString('hex')),
    
    // MongoDB
    MONGO_URI: config.mongo?.uri === 'KEEP_EXISTING' ? process.env.MONGO_URI : (config.mongo?.uri || process.env.MONGO_URI),
    MONGO_DB_NAME: config.mongo?.dbName || 'cosyworld8',
    
    // Discord
    DISCORD_BOT_TOKEN: config.discord?.botToken === 'KEEP_EXISTING' ? process.env.DISCORD_BOT_TOKEN : (config.discord?.botToken || process.env.DISCORD_BOT_TOKEN),
    DISCORD_CLIENT_ID: config.discord?.clientId || process.env.DISCORD_CLIENT_ID,
    
    // AI Service
    AI_SERVICE: config.ai?.service || 'openrouter',
    
    // OpenRouter
    ...(((config.ai?.openrouter?.apiKey && config.ai.openrouter.apiKey !== 'KEEP_EXISTING') || (config.ai?.openrouter?.apiKey === 'KEEP_EXISTING' && process.env.OPENROUTER_API_KEY) || process.env.OPENROUTER_API_KEY) && {
      OPENROUTER_API_KEY: config.ai?.openrouter?.apiKey === 'KEEP_EXISTING' ? process.env.OPENROUTER_API_KEY : (config.ai?.openrouter?.apiKey || process.env.OPENROUTER_API_KEY),
      OPENROUTER_MODEL: config.ai?.openrouter?.model || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-pro',
      OPENROUTER_CHAT_MODEL: config.ai?.openrouter?.chatModel || config.ai?.openrouter?.model || process.env.OPENROUTER_CHAT_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-pro',
      OPENROUTER_VISION_MODEL: config.ai?.openrouter?.visionModel || config.ai?.openrouter?.model || process.env.OPENROUTER_VISION_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-pro',
      OPENROUTER_STRUCTURED_MODEL: config.ai?.openrouter?.structuredModel || config.ai?.openrouter?.model || process.env.OPENROUTER_STRUCTURED_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-pro'
    }),
    
    // Google AI
    ...(((config.ai?.google?.apiKey && config.ai.google.apiKey !== 'KEEP_EXISTING') || (config.ai?.google?.apiKey === 'KEEP_EXISTING' && (process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY)) || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY) && {
      GOOGLE_API_KEY: config.ai?.google?.apiKey === 'KEEP_EXISTING' ? (process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY) : (config.ai?.google?.apiKey || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY),
      GOOGLE_AI_MODEL: config.ai?.google?.model || process.env.GOOGLE_AI_MODEL || 'gemini-2.5-flash'
    }),
    
    // Optional services
    
    ...(config.optional?.s3?.endpoint && {
      S3_API_ENDPOINT: config.optional.s3.endpoint,
      S3_API_KEY: config.optional.s3.apiKey === 'KEEP_EXISTING' ? process.env.S3_API_KEY : (config.optional.s3.apiKey || process.env.S3_API_KEY || ''),
      UPLOAD_API_BASE_URL: config.optional.s3.uploadBaseUrl || process.env.UPLOAD_API_BASE_URL || '',
      CLOUDFRONT_DOMAIN: config.optional.s3.cloudfrontDomain || process.env.CLOUDFRONT_DOMAIN || ''
    }),
    
    ...(config.optional?.twitter?.clientId && {
      X_CLIENT_ID: config.optional.twitter.clientId,
      X_CLIENT_SECRET: config.optional.twitter.clientSecret === 'KEEP_EXISTING' ? process.env.X_CLIENT_SECRET : (config.optional.twitter.clientSecret || process.env.X_CLIENT_SECRET || ''),
      X_CALLBACK_URL: config.optional.twitter.callbackUrl || process.env.X_CALLBACK_URL || 'http://localhost:3000/api/xauth/callback'
    }),
    
    ...(config.optional?.helius?.apiKey && {
      HELIUS_API_KEY: config.optional.helius.apiKey === 'KEEP_EXISTING' ? process.env.HELIUS_API_KEY : config.optional.helius.apiKey,
      NFT_API_PROVIDER: 'helius',
      NFT_CHAIN: 'solana'
    }),
    
    // App settings
    NODE_ENV: config.nodeEnv || process.env.NODE_ENV || 'production',
    BASE_URL: config.baseUrl || process.env.BASE_URL || 'http://localhost:3000',
    PUBLIC_URL: config.publicUrl || config.baseUrl || process.env.PUBLIC_URL || 'http://localhost:3000'
  };

  const replicateCfg = config.optional?.replicate || null;
  if (replicateCfg) {
    const replicateVars = {};

    const resolvedToken = useExisting(replicateCfg.apiToken, 'REPLICATE_API_TOKEN');
    if (resolvedToken) {
      replicateVars.REPLICATE_API_TOKEN = resolvedToken;
    }

    const resolvedBaseModel = useExisting(replicateCfg.baseModel, 'REPLICATE_BASE_MODEL', process.env.REPLICATE_BASE_MODEL || 'black-forest-labs/flux-dev-lora');
    if (resolvedBaseModel) {
      replicateVars.REPLICATE_BASE_MODEL = resolvedBaseModel;
    }

    const loraSource = replicateCfg.loraWeights ?? replicateCfg.model;
    const resolvedLoraWeights = useExisting(loraSource, 'REPLICATE_LORA_WEIGHTS', process.env.REPLICATE_LORA_WEIGHTS || process.env.REPLICATE_MODEL);
    if (resolvedLoraWeights) {
      replicateVars.REPLICATE_LORA_WEIGHTS = resolvedLoraWeights;
      replicateVars.REPLICATE_MODEL = resolvedLoraWeights;
    }

    const resolvedTrigger = useExisting(replicateCfg.loraTrigger ?? replicateCfg.loraTriggerWord, 'REPLICATE_LORA_TRIGGER', process.env.REPLICATE_LORA_TRIGGER || process.env.LORA_TRIGGER_WORD);
    if (resolvedTrigger) {
      replicateVars.REPLICATE_LORA_TRIGGER = resolvedTrigger;
      replicateVars.LORA_TRIGGER_WORD = resolvedTrigger;
    }

    Object.assign(envVars, replicateVars);
  }

  // Save to secrets service
  for (const [key, value] of Object.entries(envVars)) {
    if (value !== undefined && value !== null && value !== '') {
      await secretsService.set(key, String(value));
      process.env[key] = String(value);
    }
  }

  logger?.info?.('[Setup] Configuration saved to secrets service');
}
