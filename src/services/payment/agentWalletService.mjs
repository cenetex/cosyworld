/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/payment/agentWalletService.mjs
 * @description Autonomous agent wallet management with encrypted key storage
 */

import crypto from 'crypto';
import { Wallet } from 'ethers';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits

/**
 * Agent Wallet Service
 * Manages crypto wallets for autonomous agents with encrypted key storage
 * 
 * @class
 */
export class AgentWalletService {
  /**
   * Create agent wallet service
   * @param {Object} options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.configService - Configuration service
   * @param {Object} options.databaseService - Database service
   */
  constructor({ logger, configService, databaseService }) {
    this.logger = logger || console;
    this.configService = configService;
    this.databaseService = databaseService;

    // Load encryption key from config
    const config = configService?.config?.payment?.agentWallets || {};
    const encryptionKey = config.encryptionKey || process.env.AGENT_WALLET_ENCRYPTION_KEY;

    // Mark as configured or not (don't throw - allow admin UI configuration)
    this.configured = !!encryptionKey;

    if (!this.configured) {
      this.logger.warn('[AgentWalletService] Not configured. Set AGENT_WALLET_ENCRYPTION_KEY via Admin UI.');
      this.encryptionKey = null;
      this.defaultDailyLimit = 100 * 1e6; // Default 100 USDC
      return; // Don't initialize encryption
    }

    // Ensure key is correct length (32 bytes for AES-256)
    this.encryptionKey = Buffer.from(
      crypto.createHash('sha256').update(encryptionKey).digest()
    );

    // Spending limits
    this.defaultDailyLimit = config.defaultDailyLimit || 100 * 1e6; // 100 USDC in 6 decimals

    this.logger.info('[AgentWalletService] Initialized with encrypted wallet storage');
  }

  /**
   * Get database connection
   * @private
   */
  async _getDatabase() {
    return await this.databaseService.getDatabase();
  }

  /**
   * Get agent_wallets collection
   * @private
   */
  async _getWalletsCollection() {
    const db = await this._getDatabase();
    return db.collection('agent_wallets');
  }

  /**
   * Get wallet_transactions collection
   * @private
   */
  async _getTransactionsCollection() {
    const db = await this._getDatabase();
    return db.collection('wallet_transactions');
  }

  /**
   * Encrypt private key using AES-256-GCM
   * @private
   * @param {string} privateKey - Private key to encrypt
   * @returns {Object} Encrypted data with iv and authTag
   */
  _encryptPrivateKey(privateKey) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  /**
   * Decrypt private key using AES-256-GCM
   * @private
   * @param {string} encrypted - Encrypted private key
   * @param {string} iv - Initialization vector
   * @param {string} authTag - Authentication tag
   * @returns {string} Decrypted private key
   */
  _decryptPrivateKey(encrypted, iv, authTag) {
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      this.encryptionKey,
      Buffer.from(iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Generate new Ethereum wallet
   * @private
   * @returns {Object} Wallet with address and private key
   */
  _generateWallet() {
    const wallet = Wallet.createRandom();
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
    };
  }

  /**
   * Get or create wallet for agent
   * @param {string} agentId - Agent ID
   * @param {Object} [options]
   * @param {number} [options.dailyLimit] - Daily spending limit in USDC (6 decimals)
   * @returns {Promise<Object>} Wallet info (without private key)
   */
  async getOrCreateWallet(agentId, options = {}) {
    if (!this.configured) {
      throw new Error('AgentWalletService not configured. Please set encryption key via Admin UI.');
    }
    
    const walletsCol = await this._getWalletsCollection();
    
    // Check if wallet exists
    let walletDoc = await walletsCol.findOne({ agentId });
    
    if (walletDoc) {
      this.logger.debug(`[AgentWalletService] Found existing wallet for agent ${agentId}`);
      return {
        agentId: walletDoc.agentId,
        address: walletDoc.address,
        network: walletDoc.network,
        createdAt: walletDoc.createdAt,
        dailyLimit: walletDoc.dailyLimit,
      };
    }

    // Generate new wallet
    this.logger.info(`[AgentWalletService] Creating new wallet for agent ${agentId}`);
    const wallet = this._generateWallet();
    const encryptedKey = this._encryptPrivateKey(wallet.privateKey);

    walletDoc = {
      agentId,
      address: wallet.address,
      network: 'base', // Default to Base network
      encryptedPrivateKey: encryptedKey.encrypted,
      iv: encryptedKey.iv,
      authTag: encryptedKey.authTag,
      dailyLimit: options.dailyLimit || this.defaultDailyLimit,
      dailySpent: 0,
      lastResetDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
      createdAt: new Date(),
    };

    await walletsCol.insertOne(walletDoc);

    this.logger.info(
      `[AgentWalletService] Created wallet ${wallet.address} for agent ${agentId}`
    );

    return {
      agentId: walletDoc.agentId,
      address: walletDoc.address,
      network: walletDoc.network,
      createdAt: walletDoc.createdAt,
      dailyLimit: walletDoc.dailyLimit,
    };
  }

  /**
   * Get wallet private key (for signing transactions)
   * @private
   * @param {string} agentId - Agent ID
   * @param {string} [network='base'] - Network
   * @returns {Promise<string>} Decrypted private key
   */
  async _getPrivateKey(agentId, network = 'base') {
    const walletsCol = await this._getWalletsCollection();
    const walletDoc = await walletsCol.findOne({ agentId, network });

    if (!walletDoc) {
      throw new Error(`No wallet found for agent ${agentId}`);
    }

    // Support both flat and nested privateKey structures
    let encryptedKey, iv, authTag;
    if (walletDoc.privateKey && typeof walletDoc.privateKey === 'object') {
      encryptedKey = walletDoc.privateKey.encrypted;
      iv = walletDoc.privateKey.iv;
      authTag = walletDoc.privateKey.authTag;
    } else {
      encryptedKey = walletDoc.encryptedPrivateKey;
      iv = walletDoc.iv;
      authTag = walletDoc.authTag;
    }

    return this._decryptPrivateKey(encryptedKey, iv, authTag);
  }

  /**
   * Get wallet balance (mock - in production would query blockchain)
   * @param {string} agentId - Agent ID
   * @param {string} [network='base'] - Network (base, base-sepolia, etc.)
   * @returns {Promise<number>} Balance in USDC (6 decimals)
   */
  async getBalance(agentId, network = 'base') {
    const walletsCol = await this._getWalletsCollection();
    const walletDoc = await walletsCol.findOne({ agentId, network });

    if (!walletDoc) {
      return 0;
    }

    // In production, query blockchain balance
    // For now, return mock balance from database
    if (typeof walletDoc.balance === 'object' && walletDoc.balance !== null) {
      return walletDoc.balance.usdc || 0;
    }
    return walletDoc.balance || 0;
  }

  /**
   * Fund wallet (mock - in production would transfer USDC)
   * @param {string} agentId - Agent ID
   * @param {number} amount - Amount in USDC (6 decimals)
   * @param {string} [network='base'] - Network
   * @returns {Promise<Object>} Funding result
   */
  async fundWallet(agentId, amount, network = 'base') {
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    const walletsCol = await this._getWalletsCollection();
    
    const result = await walletsCol.updateOne(
      { agentId, network },
      { 
        $inc: { 'balance.usdc': amount },
        $set: { 'balance.lastUpdated': new Date() }
      }
    );

    if (result && result.matchedCount === 0) {
      // Wallet doesn't exist, create it
      await this.getOrCreateWallet(agentId, network);
      // Fund again after creating
      await walletsCol.updateOne(
        { agentId, network },
        { 
          $inc: { 'balance.usdc': amount },
          $set: { 'balance.lastUpdated': new Date() }
        }
      );
    }

    this.logger.info(
      `[AgentWalletService] Funded wallet for agent ${agentId} with ${amount / 1e6} USDC`
    );

    return {
      success: true,
      amount,
      newBalance: await this.getBalance(agentId, network),
    };
  }

  /**
   * Check and enforce spending limits
   * @private
   * @param {string} agentId - Agent ID
   * @param {number} amount - Amount to spend
   * @returns {Promise<boolean>} Whether spending is allowed
   */
  async _checkSpendingLimit(agentId, amount) {
    const walletsCol = await this._getWalletsCollection();
    const walletDoc = await walletsCol.findOne({ agentId });

    if (!walletDoc) {
      throw new Error(`No wallet found for agent ${agentId}`);
    }

    const today = new Date().toISOString().split('T')[0];
    
    // Reset daily counter if new day
    if (walletDoc.lastResetDate !== today) {
      await walletsCol.updateOne(
        { agentId },
        {
          $set: {
            dailySpent: 0,
            lastResetDate: today,
          },
        }
      );
      walletDoc.dailySpent = 0;
    }

    const newDailySpent = (walletDoc.dailySpent || 0) + amount;
    
    if (newDailySpent > walletDoc.dailyLimit) {
      this.logger.warn(
        `[AgentWalletService] Daily limit exceeded for agent ${agentId}: ` +
        `${newDailySpent / 1e6} > ${walletDoc.dailyLimit / 1e6} USDC`
      );
      return false;
    }

    return true;
  }

  /**
   * Update daily spending
   * @private
   */
  async _updateDailySpending(agentId, amount) {
    const walletsCol = await this._getWalletsCollection();
    await walletsCol.updateOne(
      { agentId },
      { $inc: { dailySpent: amount } }
    );
  }

  /**
   * Create a payment transaction (x402-compatible)
   * @param {Object} options
   * @param {string} options.agentId - Agent ID
   * @param {string} [options.to] - Recipient address
   * @param {string} [options.destination] - Recipient address (alias for to)
   * @param {number} options.amount - Amount in USDC (6 decimals)
   * @param {string} [options.network='base'] - Network
   * @param {Object} [options.metadata] - Additional metadata
   * @returns {Promise<Object>} Signed x402 payment
   */
  async createPayment({ agentId, to, destination, amount, network = 'base', metadata = {} }) {
    const recipient = destination || to;
    
    if (!recipient) {
      throw new Error('Destination address is required');
    }

    // Get wallet info
    const walletsCol = await this._getWalletsCollection();
    const walletDoc = await walletsCol.findOne({ agentId, network });

    if (!walletDoc) {
      throw new Error('Wallet not found');
    }

    // Check balance
    const balance = await this.getBalance(agentId, network);
    if (balance < amount) {
      throw new Error('Insufficient balance');
    }

    // Check spending limit
    const canSpend = await this._checkSpendingLimit(agentId, amount);
    if (!canSpend) {
      throw new Error('Daily spending limit exceeded');
    }

    // Get private key for signing
    const privateKey = await this._getPrivateKey(agentId, network);
    const wallet = new Wallet(privateKey);

    // Create x402-compatible payment payload
    const nonce = crypto.randomUUID();
    const paymentData = {
      from: walletDoc.address,
      to: recipient,
      amount,
      network,
      nonce,
      timestamp: Date.now(),
      ...metadata,
    };

    // Sign the payment data
    const dataHash = crypto.createHash('sha256').update(JSON.stringify(paymentData)).digest('hex');
    const signature = await wallet.signMessage(dataHash);

    // Store transaction
    const transactionsCol = await this._getTransactionsCollection();
    const txId = crypto.randomUUID();
    
    await transactionsCol.insertOne({
      transactionId: txId,
      agentId,
      from: walletDoc.address,
      to: recipient,
      amount,
      network,
      signature,
      dataHash,
      status: 'pending',
      createdAt: new Date(),
      ...metadata,
    });

    // Update daily spending (balance is updated when payment is settled)
    await this._updateDailySpending(agentId, amount);

    this.logger.info(
      `[AgentWalletService] Created payment ${txId} from agent ${agentId} to ${recipient}: ${amount / 1e6} USDC`
    );

    // Return x402-compatible payment structure
    return {
      x402Version: 1,
      scheme: 'exact',
      network,
      signedPayload: signature,
      metadata: {
        agentId,
        nonce,
      },
    };
  }  /**
   * Get transaction history for agent
   * @param {string} agentId - Agent ID
   * @param {Object} [options]
   * @param {number} [options.limit=50] - Max number of transactions
   * @param {number} [options.offset=0] - Number of transactions to skip (alias for skip)
   * @param {number} [options.skip=0] - Number of transactions to skip
   * @param {string} [options.network] - Filter by network
   * @returns {Promise<Array>} Transaction history
   */
  async getTransactionHistory(agentId, options = {}) {
    const transactionsCol = await this._getTransactionsCollection();
    
    const limit = options.limit || 50;
    const skip = options.offset || options.skip || 0;

    const query = { agentId };
    if (options.network) {
      query.network = options.network;
    }

    const transactions = await transactionsCol
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    return transactions;
  }

  /**
   * Ensure database indexes
   */
  async ensureIndexes() {
    const db = await this._getDatabase();
    
    const walletsCol = db.collection('agent_wallets');
    await walletsCol.createIndexes([
      { key: { agentId: 1 }, name: 'wallet_agent_id', unique: true },
      { key: { address: 1 }, name: 'wallet_address', unique: true },
    ]).catch(() => {});

    const transactionsCol = db.collection('wallet_transactions');
    await transactionsCol.createIndexes([
      { key: { transactionId: 1 }, name: 'tx_id', unique: true },
      { key: { agentId: 1, createdAt: -1 }, name: 'tx_agent_created' },
      { key: { from: 1, createdAt: -1 }, name: 'tx_from_created' },
      { key: { to: 1, createdAt: -1 }, name: 'tx_to_created' },
      { key: { status: 1 }, name: 'tx_status' },
    ]).catch(() => {});

    this.logger.info('[AgentWalletService] Database indexes ensured');
  }
}
