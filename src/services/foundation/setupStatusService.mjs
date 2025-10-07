/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * SetupStatusService
 * 
 * Manages the application's setup state and determines if first-time configuration is needed.
 * Stores setup completion state in MongoDB to persist across restarts.
 */
export class SetupStatusService {
  constructor({ logger, databaseService, secretsService }) {
    this.logger = logger;
    this.db = null;
    this.databaseService = databaseService;
    this.secrets = secretsService;
    this.collection = null;
  }

  async initialize() {
    try {
      this.db = await this.databaseService.getDatabase();
      this.collection = this.db.collection('system_setup');
      
      // Create index for quick lookup
      await this.collection.createIndex({ key: 1 }, { unique: true });
      
      this.logger?.info?.('[SetupStatus] Initialized');
    } catch (error) {
      this.logger?.error?.('[SetupStatus] Initialization failed:', error.message);
    }
  }

  /**
   * Check if the system has been set up
   * @returns {Promise<Object>} { setupComplete: boolean, adminWallet: string|null, setupDate: Date|null }
   */
  async getSetupStatus() {
    try {
      const doc = await this.collection?.findOne({ key: 'setup_complete' });
      
      if (doc && doc.value === true) {
        return {
          setupComplete: true,
          adminWallet: doc.adminWallet || null,
          setupDate: doc.setupDate || null,
          lastModified: doc.lastModified || null
        };
      }

      // Also check if we have minimum required env vars
      const hasMinimalConfig = this._hasMinimalConfiguration();
      
      return {
        setupComplete: false,
        adminWallet: null,
        setupDate: null,
        hasPartialConfig: hasMinimalConfig
      };
    } catch (error) {
      this.logger?.error?.('[SetupStatus] Failed to get setup status:', error.message);
      return { setupComplete: false, error: error.message };
    }
  }

  /**
   * Check if minimum required configuration exists
   * @private
   */
  _hasMinimalConfiguration() {
    const required = [
      'ENCRYPTION_KEY',
      'MONGO_URI',
      'DISCORD_BOT_TOKEN',
      'DISCORD_CLIENT_ID'
    ];

    const hasAI = process.env.OPENROUTER_API_KEY || 
                  process.env.GOOGLE_API_KEY || 
                  process.env.GOOGLE_AI_API_KEY;

    const hasRequired = required.every(key => {
      const value = process.env[key] || this.secrets?.get?.(key);
      return value && String(value).trim().length > 0;
    });

    return hasRequired && hasAI;
  }

  /**
   * Mark setup as complete
   * @param {string} adminWallet - Phantom wallet address of the admin
   * @returns {Promise<boolean>}
   */
  async markSetupComplete(adminWallet) {
    try {
      await this.collection?.updateOne(
        { key: 'setup_complete' },
        {
          $set: {
            key: 'setup_complete',
            value: true,
            adminWallet: adminWallet,
            setupDate: new Date(),
            lastModified: new Date()
          }
        },
        { upsert: true }
      );

      // Also set ADMIN_WALLET in secrets
      if (adminWallet && this.secrets) {
        await this.secrets.set('ADMIN_WALLET', adminWallet);
        process.env.ADMIN_WALLET = adminWallet;
      }

      this.logger?.info?.('[SetupStatus] Setup marked as complete for admin:', adminWallet);
      return true;
    } catch (error) {
      this.logger?.error?.('[SetupStatus] Failed to mark setup complete:', error.message);
      return false;
    }
  }

  /**
   * Reset setup status (for development or admin reset)
   * @returns {Promise<boolean>}
   */
  async resetSetup() {
    try {
      await this.collection?.deleteOne({ key: 'setup_complete' });
      this.logger?.warn?.('[SetupStatus] Setup status reset - will require re-configuration');
      return true;
    } catch (error) {
      this.logger?.error?.('[SetupStatus] Failed to reset setup:', error.message);
      return false;
    }
  }

  /**
   * Update admin wallet
   * @param {string} newWallet - New admin wallet address
   * @returns {Promise<boolean>}
   */
  async updateAdminWallet(newWallet) {
    try {
      await this.collection?.updateOne(
        { key: 'setup_complete' },
        {
          $set: {
            adminWallet: newWallet,
            lastModified: new Date()
          }
        }
      );

      if (this.secrets) {
        await this.secrets.set('ADMIN_WALLET', newWallet);
        process.env.ADMIN_WALLET = newWallet;
      }

      this.logger?.info?.('[SetupStatus] Admin wallet updated:', newWallet);
      return true;
    } catch (error) {
      this.logger?.error?.('[SetupStatus] Failed to update admin wallet:', error.message);
      return false;
    }
  }

  /**
   * Check if a wallet is the admin wallet
   * @param {string} wallet - Wallet address to check
   * @returns {Promise<boolean>}
   */
  async isAdminWallet(wallet) {
    if (!wallet) return false;

    try {
      const status = await this.getSetupStatus();
      return status.adminWallet === wallet;
    } catch (error) {
      this.logger?.error?.('[SetupStatus] Failed to check admin wallet:', error.message);
      return false;
    }
  }

  /**
   * Get list of required configuration items that are missing
   * @returns {Promise<Array>} List of missing configuration items
   */
  async getMissingConfiguration() {
    const missing = [];
    
    const checks = {
      'ENCRYPTION_KEY': {
        value: process.env.ENCRYPTION_KEY,
        required: true,
        description: 'Encryption key for securing secrets'
      },
      'MONGO_URI': {
        value: process.env.MONGO_URI,
        required: true,
        description: 'MongoDB connection string'
      },
      'DISCORD_BOT_TOKEN': {
        value: process.env.DISCORD_BOT_TOKEN,
        required: true,
        description: 'Discord bot token'
      },
      'DISCORD_CLIENT_ID': {
        value: process.env.DISCORD_CLIENT_ID,
        required: true,
        description: 'Discord client ID'
      },
      'AI_SERVICE': {
        value: process.env.AI_SERVICE || (process.env.OPENROUTER_API_KEY ? 'openrouter' : (process.env.GOOGLE_API_KEY ? 'google' : null)),
        required: true,
        description: 'AI service provider'
      },
      'OPENROUTER_API_KEY': {
        value: process.env.OPENROUTER_API_KEY,
        required: false,
        description: 'OpenRouter API key (if using OpenRouter)'
      },
      'GOOGLE_API_KEY': {
        value: process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY,
        required: false,
        description: 'Google AI API key (if using Google AI)'
      }
    };

    for (const [key, config] of Object.entries(checks)) {
      if (config.required && (!config.value || String(config.value).trim().length === 0)) {
        missing.push({
          key,
          description: config.description,
          required: config.required
        });
      }
    }

    // Check that at least one AI service is configured
    const hasAI = process.env.OPENROUTER_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!hasAI) {
      missing.push({
        key: 'AI_API_KEY',
        description: 'At least one AI service API key (OpenRouter or Google)',
        required: true
      });
    }

    return missing;
  }
}
