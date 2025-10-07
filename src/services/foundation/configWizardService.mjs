/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ConfigWizardService
 * 
 * Launches a minimal configuration wizard server when the app is not yet configured.
 * Provides a browser-based interface for setting up all required environment variables
 * and secrets securely.
 */
export class ConfigWizardService {
  constructor({ logger, secretsService, configService } = {}) {
    this.logger = logger || console;
    this.secrets = secretsService;
    this.config = configService;
    this.server = null;
    this.wizardPort = 3100;
  }

  /**
   * Check if the application has been configured
   * @returns {Object} { configured: boolean, missing: string[], details: string }
   */
  async checkConfigurationStatus() {
    const missing = [];
    const checks = {
      encryption: !process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32,
      mongo: !process.env.MONGO_URI,
      discord: !process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CLIENT_ID,
      ai: !process.env.OPENROUTER_API_KEY && !process.env.GOOGLE_API_KEY
    };

    if (checks.encryption) missing.push('ENCRYPTION_KEY (32+ characters)');
    if (checks.mongo) missing.push('MONGO_URI');
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
          mongo: {
            uri: process.env.MONGO_URI ? this._maskValue(process.env.MONGO_URI) : null,
            dbName: process.env.MONGO_DB_NAME || 'cosyworld8'
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
              apiToken: process.env.REPLICATE_API_TOKEN ? this._maskValue(process.env.REPLICATE_API_TOKEN) : null
            },
            s3: {
              endpoint: process.env.S3_API_ENDPOINT || null,
              apiKey: process.env.S3_API_KEY ? this._maskValue(process.env.S3_API_KEY) : null
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

        res.json({ 
          success: true, 
          message: 'Configuration saved successfully. Please restart the application.' 
        });
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
      res.redirect('/wizard/');
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
║  Please visit: http://localhost:${this.wizardPort}                         ║
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
        if (!data.key || data.key.length < 32) {
          errors.push('Encryption key must be at least 32 characters');
        }
        break;

      case 'mongo':
        if (!data.uri) {
          errors.push('MongoDB URI is required');
        } else if (!data.uri.startsWith('mongodb://') && !data.uri.startsWith('mongodb+srv://')) {
          errors.push('MongoDB URI must start with mongodb:// or mongodb+srv://');
        }
        if (!data.dbName) {
          errors.push('Database name is required');
        }
        break;

      case 'discord':
        if (!data.botToken) {
          errors.push('Discord bot token is required');
        }
        if (!data.clientId) {
          errors.push('Discord client ID is required');
        }
        break;

      case 'ai':
        if (!data.openrouter?.apiKey && !data.google?.apiKey) {
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
    const sections = ['encryption', 'mongo', 'discord', 'ai'];
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
    
    // Build environment variables
    const envVars = {
      // Core
      ENCRYPTION_KEY: config.encryption.key,
      SERVER_SECRET_KEY: config.encryption.serverKey || crypto.randomBytes(32).toString('hex'),
      
      // MongoDB
      MONGO_URI: config.mongo.uri,
      MONGO_DB_NAME: config.mongo.dbName,
      
      // Discord
      DISCORD_BOT_TOKEN: config.discord.botToken,
      DISCORD_CLIENT_ID: config.discord.clientId,
      
      // AI Service
      AI_SERVICE: config.ai.service || 'openrouter',
      
      // OpenRouter
      ...(config.ai.openrouter?.apiKey && {
        OPENROUTER_API_KEY: config.ai.openrouter.apiKey,
        OPENROUTER_MODEL: config.ai.openrouter.model || 'google/gemini-2.5-pro',
        OPENROUTER_CHAT_MODEL: config.ai.openrouter.chatModel || 'google/gemini-2.5-pro',
        OPENROUTER_VISION_MODEL: config.ai.openrouter.visionModel || 'google/gemini-2.5-pro',
        OPENROUTER_STRUCTURED_MODEL: config.ai.openrouter.structuredModel || 'google/gemini-2.5-pro'
      }),
      
      // Google AI
      ...(config.ai.google?.apiKey && {
        GOOGLE_API_KEY: config.ai.google.apiKey,
        GOOGLE_AI_MODEL: config.ai.google.model || 'gemini-2.5-flash'
      }),
      
      // Optional services
      ...(config.optional?.replicate?.apiToken && {
        REPLICATE_API_TOKEN: config.optional.replicate.apiToken,
        REPLICATE_MODEL: config.optional.replicate.model || ''
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

    // Generate .env file content
    const envLines = Object.entries(envVars)
      .filter(([_, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}="${value}"`)
      .join('\n');

    // Save to .env file
    const envPath = path.resolve(process.cwd(), '.env');
    await fs.writeFile(envPath, envLines, 'utf8');
    
    this.logger.info('[wizard] Configuration saved to .env file');

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
        case 'MONGO_URI':
          config.mongo.uri = value;
          break;
        case 'MONGO_DB_NAME':
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
        // ... add more mappings as needed
      }
    }

    return config;
  }
}
