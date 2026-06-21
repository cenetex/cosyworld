/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_BACKEND = 'sqlite';
const DEFAULT_SQLITE_DB_PATH = process.env.NODE_ENV === 'production' ? '/data/cosyworld.sqlite' : 'data/cosyworld.sqlite';
const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27017';
const DEFAULT_MONGO_DB_NAME = 'cosyworld8';

/**
 * ConfigWizardService
 * 
 * Launches a minimal configuration wizard server when the app is not yet configured.
 * Provides a browser-based interface for setting up all required environment variables
 * and secrets securely.
 */
export class ConfigWizardService {
  constructor({ logger, secretsService, configService, setupStatusService } = {}) {
    this.logger = logger || console;
    this.secrets = secretsService;
    this.config = configService;
    this.setupStatus = setupStatusService;
    this.server = null;
    this.wizardPort = Number(process.env.WEB_PORT || process.env.PORT || 3100);
    this.envPath = process.env.ENV_FILE || process.env.CONFIG_ENV_FILE || (
      process.env.NODE_ENV === 'production' && fsSync.existsSync('/data')
        ? '/data/.env'
        : path.resolve(__dirname, '../../../.env')
    );
  }

  /**
   * Check if the application has been configured
   * @returns {Object} { configured: boolean, missing: string[], details: string }
   */
  async checkConfigurationStatus() {
    const missing = [];
    const checks = {
      encryption: !process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32,
      discord: !process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CLIENT_ID,
      ai: !process.env.OPENROUTER_API_KEY && !process.env.GOOGLE_API_KEY
    };

    if (checks.encryption) missing.push('ENCRYPTION_KEY (32+ characters)');
    if (checks.discord) missing.push('DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID');
    if (checks.ai) missing.push('At least one AI provider (OPENROUTER_API_KEY or GOOGLE_API_KEY)');

    const configured = missing.length === 0;
    const details = configured 
      ? 'Application is fully configured'
      : `Missing required configuration: ${missing.join(', ')}`;

    return { configured, missing, details };
  }

  /**
   * Generate a secure encryption key
   * @returns {string} A 64-character hex string (32 bytes)
   */
  generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Start the configuration wizard server
   * @returns {Promise<void>}
   */
  async start() {
    const app = express();
    
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    
    // Serve static wizard files
    const wizardDir = path.resolve(__dirname, '../../wizard');
    app.use('/wizard', express.static(wizardDir));
    app.use('/admin', express.static(wizardDir));

    app.get('/api/health/live', (req, res) => {
      res.json({
        status: 'setup',
        timestamp: new Date().toISOString(),
        uptime: Math.round(process.uptime())
      });
    });

    app.get('/admin/setup', (req, res) => {
      res.sendFile(path.join(wizardDir, 'index.html'));
    });

    // Configuration status endpoint
    app.get('/api/wizard/status', async (req, res) => {
      try {
        const status = await this.checkConfigurationStatus();
        res.json(status);
      } catch (error) {
        this.logger.error('[wizard] Status check failed:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get current configuration (masked)
    app.get('/api/wizard/config', async (req, res) => {
      try {
        const currentConfig = {
          encryption: {
            hasKey: !!process.env.ENCRYPTION_KEY,
            keyLength: process.env.ENCRYPTION_KEY?.length || 0
          },
          storage: {
            backend: process.env.DATA_BACKEND || process.env.STORAGE_DATA_BACKEND || DEFAULT_DATA_BACKEND,
            sqliteDbPath: process.env.SQLITE_DB_PATH || DEFAULT_SQLITE_DB_PATH
          },
          mongo: {
            uri: process.env.MONGO_URI ? this._maskValue(process.env.MONGO_URI) : DEFAULT_MONGO_URI,
            dbName: process.env.MONGO_DB_NAME || DEFAULT_MONGO_DB_NAME
          },
          discord: {
            botToken: process.env.DISCORD_BOT_TOKEN ? this._maskValue(process.env.DISCORD_BOT_TOKEN) : null,
            clientId: process.env.DISCORD_CLIENT_ID || null
          },
          ai: {
            service: process.env.AI_SERVICE || 'openrouter',
            openrouter: {
              apiKey: process.env.OPENROUTER_API_KEY ? this._maskValue(process.env.OPENROUTER_API_KEY) : null,
              model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-pro'
            },
            google: {
              apiKey: process.env.GOOGLE_API_KEY ? this._maskValue(process.env.GOOGLE_API_KEY) : null,
              model: process.env.GOOGLE_AI_MODEL || 'gemini-2.5-flash'
            }
          },
          optional: {
            replicate: {
              apiToken: process.env.REPLICATE_API_TOKEN ? this._maskValue(process.env.REPLICATE_API_TOKEN) : null,
              baseModel: process.env.REPLICATE_BASE_MODEL || 'black-forest-labs/flux-dev-lora',
              model: process.env.REPLICATE_MODEL || process.env.REPLICATE_LORA_WEIGHTS || null,
              loraWeights: process.env.REPLICATE_LORA_WEIGHTS || process.env.REPLICATE_MODEL || null,
              loraTrigger: process.env.REPLICATE_LORA_TRIGGER || process.env.LORA_TRIGGER_WORD || null
            },
            s3: {
              backend: process.env.FILE_STORAGE_BACKEND || process.env.STORAGE_BACKEND || 'local',
              localMediaDir: process.env.LOCAL_MEDIA_DIR || (process.env.NODE_ENV === 'production' ? '/data/media' : 'data/media'),
              endpoint: process.env.S3_API_ENDPOINT || null,
              apiKey: process.env.S3_API_KEY ? this._maskValue(process.env.S3_API_KEY) : null,
              uploadBaseUrl: process.env.UPLOAD_API_BASE_URL || null,
              cloudfrontDomain: process.env.CLOUDFRONT_DOMAIN || null
            },
            crossmint: {
              apiKey: process.env.CROSSMINT_CLIENT_API_KEY ? this._maskValue(process.env.CROSSMINT_CLIENT_API_KEY) : null,
              collectionId: process.env.CROSSMINT_COLLECTION_ID || null
            },
            x: {
              clientId: process.env.X_CLIENT_ID || null,
              clientSecret: process.env.X_CLIENT_SECRET ? this._maskValue(process.env.X_CLIENT_SECRET) : null
            }
          }
        };
        res.json(currentConfig);
      } catch (error) {
        this.logger.error('[wizard] Config retrieval failed:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Generate encryption key
    app.post('/api/wizard/generate-key', (req, res) => {
      try {
        const key = this.generateEncryptionKey();
        res.json({ key });
      } catch (error) {
        this.logger.error('[wizard] Key generation failed:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Validate configuration section
    app.post('/api/wizard/validate', async (req, res) => {
      try {
        const { section, data } = req.body;
        const validation = await this._validateSection(section, data);
        res.json(validation);
      } catch (error) {
        this.logger.error('[wizard] Validation failed:', error);
        res.status(500).json({ error: error.message, valid: false });
      }
    });

    // Save configuration
    app.post('/api/wizard/save', async (req, res) => {
      try {
        const { config } = req.body;
        
        // Validate entire configuration
        const validation = await this._validateFullConfig(config);
        if (!validation.valid) {
          return res.status(400).json({ 
            error: 'Configuration validation failed', 
            details: validation.errors 
          });
        }

        // Save to secrets service and environment
        await this._saveConfiguration(config);

        // Mark setup as complete (if we have setupStatus service)
        if (this.setupStatus) {
          try {
            // Use admin wallet from config or environment
            const adminWallet = config.admin?.wallet || process.env.ADMIN_WALLET || 'system';
            await this.setupStatus.markSetupComplete(adminWallet);
            this.logger.info('[wizard] Setup marked as complete');
          } catch (err) {
            this.logger.warn('[wizard] Could not mark setup complete:', err.message);
          }
        }

        res.json({ 
          success: true, 
          message: 'Configuration saved successfully! Restarting the application...',
          requiresRestart: true
        });

        if (process.env.NODE_ENV === 'production') {
          setTimeout(() => process.exit(0), 750);
        }
      } catch (error) {
        this.logger.error('[wizard] Save failed:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Import from .env file
    app.post('/api/wizard/import-env', async (req, res) => {
      try {
        const { envContent } = req.body;
        const parsed = this._parseEnvFile(envContent);
        res.json({ success: true, config: parsed });
      } catch (error) {
        this.logger.error('[wizard] Import failed:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Redirect root to wizard
    app.get('/', (req, res) => {
      res.redirect('/admin/setup');
    });

    // Start server
    return new Promise((resolve, reject) => {
      this.server = app.listen(this.wizardPort, '0.0.0.0', (err) => {
        if (err) {
          this.logger.error('[wizard] Failed to start:', err);
          reject(err);
        } else {
          this.logger.info(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║  🔧 CONFIGURATION WIZARD                                       ║
║                                                                ║
║  Your application needs to be configured.                     ║
║  Please visit: http://localhost:${this.wizardPort}/admin/setup              ║
║                                                                ║
║  The wizard will guide you through setting up:                ║
║  • Database connection                                         ║
║  • Discord bot credentials                                     ║
║  • AI service API keys                                         ║
║  • Optional integrations                                       ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
          `);
          resolve();
        }
      });
    });
  }

  /**
   * Stop the wizard server
   */
  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.logger.info('[wizard] Server stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Mask sensitive values for display
   * @private
   */
  _maskValue(value) {
    if (!value || value.length < 8) return '***';
    return value.substring(0, 4) + '***' + value.substring(value.length - 4);
  }

  /**
   * Validate a configuration section
   * @private
   */
  async _validateSection(section, data) {
    const errors = [];

    switch (section) {
      case 'encryption':
        // Allow KEEP_EXISTING if key already exists
        if (data.key === 'KEEP_EXISTING') {
          if (!process.env.ENCRYPTION_KEY) {
            errors.push('Cannot keep existing encryption key - none found');
          }
        } else if (!data.key || data.key.length < 32) {
          errors.push('Encryption key must be at least 32 characters');
        }
        break;

      case 'storage': {
        const backend = String(data?.backend || DEFAULT_DATA_BACKEND).toLowerCase();
        if (!['sqlite', 'mongo', 'mongodb'].includes(backend)) {
          errors.push('Storage backend must be sqlite or mongo');
        }
        if (backend === 'sqlite' && !data?.sqliteDbPath) {
          errors.push('SQLite database path is required');
        }
        if (backend === 'mongo' || backend === 'mongodb') {
          const uri = data?.mongoUri || data?.uri || process.env.MONGO_URI || DEFAULT_MONGO_URI;
          if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
            errors.push('MongoDB URI must start with mongodb:// or mongodb+srv://');
          }
        }
        break;
      }

      case 'discord':
        // Allow KEEP_EXISTING for bot token if it already exists
        if (data.botToken === 'KEEP_EXISTING') {
          if (!process.env.DISCORD_BOT_TOKEN) {
            errors.push('Cannot keep existing Discord bot token - none found');
          }
        } else if (!data.botToken) {
          errors.push('Discord bot token is required');
        }
        
        if (!data.clientId) {
          errors.push('Discord client ID is required');
        }
        break;

      case 'ai':
        const hasExistingOpenRouter = data.openrouter?.apiKey === 'KEEP_EXISTING' && process.env.OPENROUTER_API_KEY;
        const hasNewOpenRouter = data.openrouter?.apiKey && data.openrouter.apiKey !== 'KEEP_EXISTING';
        const hasExistingGoogle = data.google?.apiKey === 'KEEP_EXISTING' && (process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY);
        const hasNewGoogle = data.google?.apiKey && data.google.apiKey !== 'KEEP_EXISTING';
        
        if (!hasExistingOpenRouter && !hasNewOpenRouter && !hasExistingGoogle && !hasNewGoogle) {
          errors.push('At least one AI provider API key is required');
        }
        break;
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate the complete configuration
   * @private
   */
  async _validateFullConfig(config) {
    const errors = [];

    // Check all required sections
    const sections = ['encryption', 'storage', 'discord', 'ai'];
    for (const section of sections) {
      const validation = await this._validateSection(section, config[section]);
      if (!validation.valid) {
        errors.push(...validation.errors);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Save configuration to secrets service and generate .env file
   * @private
   */
  async _saveConfiguration(config) {
    const fs = await import('fs/promises');
    
    // Build environment variables, keeping existing values when KEEP_EXISTING is specified
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

    const envVars = {
      // Core
      ENCRYPTION_KEY: config.encryption.key === 'KEEP_EXISTING' ? process.env.ENCRYPTION_KEY : config.encryption.key,
      SERVER_SECRET_KEY: config.encryption.serverKey || process.env.SERVER_SECRET_KEY || crypto.randomBytes(32).toString('hex'),
      
      // Data storage
      DATA_BACKEND: config.storage?.backend || process.env.DATA_BACKEND || DEFAULT_DATA_BACKEND,
      SQLITE_DB_PATH: config.storage?.sqliteDbPath || process.env.SQLITE_DB_PATH || DEFAULT_SQLITE_DB_PATH,
      ...(String(config.storage?.backend || process.env.DATA_BACKEND || DEFAULT_DATA_BACKEND).toLowerCase().startsWith('mongo') && {
        MONGO_URI: config.storage?.mongoUri || config.mongo?.uri || process.env.MONGO_URI || DEFAULT_MONGO_URI,
        MONGO_DB_NAME: config.storage?.mongoDbName || config.mongo?.dbName || process.env.MONGO_DB_NAME || DEFAULT_MONGO_DB_NAME
      }),
      
      // Discord
      DISCORD_BOT_TOKEN: config.discord.botToken === 'KEEP_EXISTING' ? process.env.DISCORD_BOT_TOKEN : config.discord.botToken,
      DISCORD_CLIENT_ID: config.discord.clientId,
      
      // AI Service
      AI_SERVICE: config.ai.service || 'openrouter',
      
      // OpenRouter
      ...(((config.ai.openrouter?.apiKey && config.ai.openrouter.apiKey !== 'KEEP_EXISTING') || (config.ai.openrouter?.apiKey === 'KEEP_EXISTING' && process.env.OPENROUTER_API_KEY)) && {
        OPENROUTER_API_KEY: config.ai.openrouter.apiKey === 'KEEP_EXISTING' ? process.env.OPENROUTER_API_KEY : config.ai.openrouter.apiKey,
        OPENROUTER_MODEL: config.ai.openrouter.model || 'google/gemini-2.5-pro',
        OPENROUTER_CHAT_MODEL: config.ai.openrouter.chatModel || config.ai.openrouter.model || 'google/gemini-2.5-pro',
        OPENROUTER_VISION_MODEL: config.ai.openrouter.visionModel || config.ai.openrouter.model || 'google/gemini-2.5-pro',
        OPENROUTER_STRUCTURED_MODEL: config.ai.openrouter.structuredModel || config.ai.openrouter.model || 'google/gemini-2.5-pro'
      }),
      
      // Google AI
      ...(((config.ai.google?.apiKey && config.ai.google.apiKey !== 'KEEP_EXISTING') || (config.ai.google?.apiKey === 'KEEP_EXISTING' && (process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY))) && {
        GOOGLE_API_KEY: config.ai.google.apiKey === 'KEEP_EXISTING' ? (process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY) : config.ai.google.apiKey,
        GOOGLE_AI_MODEL: config.ai.google.model || 'gemini-2.5-flash'
      }),

      // Optional services
      FILE_STORAGE_BACKEND: config.optional?.s3?.backend || process.env.FILE_STORAGE_BACKEND || 'local',
      LOCAL_MEDIA_DIR: config.optional?.s3?.localMediaDir || process.env.LOCAL_MEDIA_DIR || (process.env.NODE_ENV === 'production' ? '/data/media' : 'data/media'),

      ...(config.optional?.replicate?.apiToken && {
        REPLICATE_API_TOKEN: config.optional.replicate.apiToken
      }),

      ...(config.optional?.s3?.endpoint && {
        S3_API_ENDPOINT: config.optional.s3.endpoint,
        S3_API_KEY: config.optional.s3.apiKey || '',
        UPLOAD_API_BASE_URL: config.optional.s3.uploadBaseUrl || '',
        CLOUDFRONT_DOMAIN: config.optional.s3.cloudfrontDomain || ''
      }),
      
      ...(config.optional?.crossmint?.apiKey && {
        CROSSMINT_CLIENT_API_KEY: config.optional.crossmint.apiKey,
        CROSSMINT_COLLECTION_ID: config.optional.crossmint.collectionId || ''
      }),
      
      ...(config.optional?.x?.clientId && {
        X_CLIENT_ID: config.optional.x.clientId,
        X_CLIENT_SECRET: config.optional.x.clientSecret || '',
        X_CALLBACK_URL: config.optional.x.callbackUrl || 'http://localhost:3000/api/xauth/callback'
      }),
      
      ...(config.optional?.helius?.apiKey && {
        HELIUS_API_KEY: config.optional.helius.apiKey,
        NFT_API_PROVIDER: 'helius',
        NFT_CHAIN: 'solana'
      }),
      
      ...(config.optional?.veo && {
        VEO_RATE_PER_MINUTE: config.optional.veo.ratePerMinute || 5,
        VEO_RATE_PER_DAY: config.optional.veo.ratePerDay || 200,
        VEO_GLOBAL_DAILY_CAP: config.optional.veo.globalDailyCap || 100
      }),
      
      // App settings
      NODE_ENV: config.nodeEnv || 'production',
      BASE_URL: config.baseUrl || 'http://localhost:3000',
      PUBLIC_URL: config.publicUrl || config.baseUrl || 'http://localhost:3000',
      
      // Admin
      ...(config.admin?.wallet && {
        ADMIN_WALLET: config.admin.wallet
      })
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

    // Generate .env file content
    const envLines = Object.entries(envVars)
      .filter(([_, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}="${value}"`)
      .join('\n');

    // Save to .env file
    const envPath = this.envPath;
    await fs.mkdir(path.dirname(envPath), { recursive: true });
    await fs.writeFile(envPath, envLines, 'utf8');
    
    this.logger.info(`[wizard] Configuration saved to ${envPath}`);

    // Also save to secrets service if available
    if (this.secrets) {
      for (const [key, value] of Object.entries(envVars)) {
        if (value) {
          this.secrets.set(key, value);
        }
      }
      this.logger.info('[wizard] Configuration saved to secrets service');
    }
  }

  /**
   * Parse .env file content
   * @private
   */
  _parseEnvFile(content) {
    const lines = content.split('\n');
    const config = {
      encryption: {},
      storage: {},
      mongo: {},
      discord: {},
      ai: { openrouter: {}, google: {} },
      optional: { 
        replicate: {}, 
        s3: {}, 
        crossmint: {}, 
        x: {}, 
        helius: {}, 
        veo: {} 
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const match = trimmed.match(/^([^=]+)=["']?([^"']*)["']?$/);
      if (!match) continue;
      
      const [, key, value] = match;
      
      // Map to config structure
      switch (key) {
        case 'ENCRYPTION_KEY':
          config.encryption.key = value;
          break;
        case 'DATA_BACKEND':
          config.storage.backend = value;
          break;
        case 'SQLITE_DB_PATH':
          config.storage.sqliteDbPath = value;
          break;
        case 'MONGO_URI':
          config.storage.backend = 'mongo';
          config.storage.mongoUri = value;
          config.mongo.uri = value;
          break;
        case 'MONGO_DB_NAME':
          config.storage.mongoDbName = value;
          config.mongo.dbName = value;
          break;
        case 'DISCORD_BOT_TOKEN':
          config.discord.botToken = value;
          break;
        case 'DISCORD_CLIENT_ID':
          config.discord.clientId = value;
          break;
        case 'AI_SERVICE':
          config.ai.service = value;
          break;
        case 'OPENROUTER_API_KEY':
          config.ai.openrouter.apiKey = value;
          break;
        case 'OPENROUTER_MODEL':
          config.ai.openrouter.model = value;
          break;
        case 'GOOGLE_API_KEY':
          config.ai.google.apiKey = value;
          break;
        case 'REPLICATE_API_TOKEN':
          config.optional.replicate.apiToken = value;
          break;
        case 'REPLICATE_BASE_MODEL':
          config.optional.replicate.baseModel = value;
          break;
        case 'REPLICATE_LORA_WEIGHTS':
          config.optional.replicate.loraWeights = value;
          config.optional.replicate.model = value;
          break;
        case 'REPLICATE_MODEL':
          config.optional.replicate.model = value;
          if (!config.optional.replicate.loraWeights) {
            config.optional.replicate.loraWeights = value;
          }
          break;
        case 'REPLICATE_LORA_TRIGGER':
          config.optional.replicate.loraTrigger = value;
          break;
        case 'LORA_TRIGGER_WORD':
          if (!config.optional.replicate.loraTrigger) {
            config.optional.replicate.loraTrigger = value;
          }
          break;
        // ... add more mappings as needed
      }
    }

    return config;
  }
}
