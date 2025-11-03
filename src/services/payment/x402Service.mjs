/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/payment/x402Service.mjs
 * @description Coinbase CDP x402 facilitator integration for payment verification and settlement
 * 
 * @see https://docs.cdp.coinbase.com/x402
 * @see https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator
 */

import crypto from 'crypto';
import { generateJwt } from '@coinbase/cdp-sdk/auth';

const CDP_API_BASE_URL = 'https://api.cdp.coinbase.com/platform';

/**
 * X402 Payment Service
 * Integrates with Coinbase CDP facilitator for x402 payment protocol
 * 
 * @class
 */
export class X402Service {
  /**
   * Create X402 service
   * @param {Object} options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.configService - Configuration service
   * @param {Object} options.databaseService - Database service
   */
  constructor({ logger, configService, databaseService }) {
    this.logger = logger || console;
    this.configService = configService;
    this.databaseService = databaseService;

    // Load configuration
    const config = configService?.config?.payment?.x402 || {};
    
    this.cdpApiKeyId = config.apiKeyId || process.env.CDP_API_KEY_ID;
    this.cdpApiKeySecret = config.apiKeySecret || process.env.CDP_API_KEY_SECRET;
    this.sellerAddress = config.sellerAddress || process.env.X402_SELLER_ADDRESS;
    this.defaultNetwork = config.enableTestnet 
      ? 'base-sepolia' 
      : (config.defaultNetwork || 'base');

    // Validate required credentials (log warning but don't throw - allow admin UI configuration)
    this.configured = !!(this.cdpApiKeyId && this.cdpApiKeySecret && this.sellerAddress);
    
    if (!this.configured) {
      this.logger.warn('[X402Service] Not configured. Set credentials via Admin UI or environment variables.');
      this.logger.warn('[X402Service] Required: CDP_API_KEY_ID, CDP_API_KEY_SECRET, X402_SELLER_ADDRESS');
      return; // Don't initialize caches or timers
    }

    // In-memory caches
    this._supportedNetworksCache = null;
    this._usedNonces = new Map();

    // Cleanup old nonces hourly
    setInterval(() => this._cleanupNonces(), 60 * 60 * 1000);

    this.logger.info('[X402Service] Initialized with CDP facilitator');
  }

  /**
   * Check if service is properly configured
   * This method dynamically checks current configuration state
   * @returns {boolean} True if all required credentials are set
   */
  isConfigured() {
    return !!(this.cdpApiKeyId && this.cdpApiKeySecret && this.sellerAddress);
  }

  /**
   * Get database connection
   * @private
   */
  async _getDatabase() {
    return await this.databaseService.getDatabase();
  }

  /**
   * Get x402_transactions collection
   * @private
   */
  async _getTransactionsCollection() {
    const db = await this._getDatabase();
    return db.collection('x402_transactions');
  }

  /**
   * Generate JWT token for CDP API authentication
   * Uses Coinbase CDP SDK with Ed25519 or ECDSA key signatures
   * @private
   * @param {string} requestMethod - HTTP method (GET, POST, etc.)
   * @param {string} requestPath - API endpoint path
   * @returns {Promise<string>} JWT token
   */
  async _generateJWT(requestMethod, requestPath) {
    const requestHost = 'api.cdp.coinbase.com';

    // Debug logging (will remove after fixing)
    this.logger.info('[X402Service] Generating JWT with:', {
      apiKeyId: this.cdpApiKeyId,
      apiKeySecretLength: this.cdpApiKeySecret?.length || 0,
      apiKeySecretPrefix: this.cdpApiKeySecret?.substring(0, 20) + '...',
      requestMethod,
      requestHost,
      requestPath,
    });

    const token = await generateJwt({
      apiKeyId: this.cdpApiKeyId,
      apiKeySecret: this.cdpApiKeySecret,
      requestMethod,
      requestHost,
      requestPath,
      expiresIn: 120, // 2 minutes
    });

    this.logger.info('[X402Service] Generated JWT:', token.substring(0, 50) + '...');
    
    return token;
  }

  /**
   * Make authenticated request to CDP API
   * @private
   * @param {string} endpoint - API endpoint path (e.g., '/v2/x402/supported')
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} API response
   */
  async _cdpRequest(endpoint, options = {}) {
    const url = `${CDP_API_BASE_URL}${endpoint}`;
    const method = options.method || 'GET';
    
    // Generate JWT with request-specific parameters
    const token = await this._generateJWT(method, endpoint);

    const response = await fetch(url, {
      ...options,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `CDP API error: ${response.status} - ${error.errorMessage || response.statusText}`
      );
    }

    return await response.json();
  }

  /**
   * Get supported payment schemes and networks
   * CDP facilitator supports: Base, Base Sepolia, Solana, Solana Devnet
   * @returns {Promise<Array>} Array of supported kinds
   */
  async getSupportedNetworks() {
    if (!this.configured) {
      throw new Error('X402Service not configured. Please set credentials via Admin UI.');
    }
    
    if (this._supportedNetworksCache) {
      return this._supportedNetworksCache;
    }

    // CDP facilitator supports these networks as per documentation
    // https://docs.cdp.coinbase.com/x402/network-support
    this._supportedNetworksCache = [
      {
        kind: 'eip-3009-transfer',
        networks: ['base', 'base-sepolia'],
        tokens: ['USDC'],
        description: 'EIP-3009 transfers on Base networks with USDC'
      },
      {
        kind: 'solana-transfer',
        networks: ['solana', 'solana-devnet'],
        tokens: ['USDC'],
        description: 'SPL token transfers on Solana networks with USDC'
      }
    ];

    this.logger.info('[X402Service] Loaded supported networks from CDP documentation');
    return this._supportedNetworksCache;
  }

  /**
   * Generate nonce for payment request
   * @private
   */
  _generateNonce() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Check if nonce has been used (replay attack prevention)
   * @private
   */
  _checkNonce(nonce) {
    if (!nonce) return true; // Allow missing nonce for backwards compat
    
    if (this._usedNonces.has(nonce)) {
      return false; // Nonce already used
    }
    
    // Mark nonce as used for 24 hours
    this._usedNonces.set(nonce, Date.now() + 24 * 60 * 60 * 1000);
    return true;
  }

  /**
   * Cleanup expired nonces
   * @private
   */
  _cleanupNonces() {
    const now = Date.now();
    for (const [nonce, expires] of this._usedNonces.entries()) {
      if (expires < now) {
        this._usedNonces.delete(nonce);
      }
    }
  }

  /**
   * Generate payment required response (402)
   * @param {Object} options
   * @param {number} options.amount - Amount in USDC (6 decimals, e.g., 100000 = 0.1 USDC)
   * @param {string} options.destination - Seller wallet address
   * @param {string} options.resource - Resource path being purchased
   * @param {string} [options.network] - Network (default: base-sepolia or base)
   * @returns {Object} x402 payment required response
   */
  generatePaymentRequired({ amount, destination, resource, network }) {
    const nonce = this._generateNonce();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    return {
      x402Version: 1,
      facilitator: {
        scheme: 'exact',
        network: network || this.defaultNetwork,
      },
      price: {
        usdcAmount: amount,
      },
      paymentDestination: {
        address: destination || this.sellerAddress,
      },
      metadata: {
        resource,
        nonce,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  /**
   * Verify payment with CDP facilitator
   * @param {Object} options
   * @param {Object} options.paymentPayload - x402 payment payload from client
   * @param {number} options.expectedAmount - Expected amount in USDC (6 decimals)
   * @param {string} options.sellerAddress - Seller wallet address
   * @param {Object} [options.metadata] - Additional metadata to store
   * @returns {Promise<Object>} Verification result
   */
  async verifyPayment({ paymentPayload, expectedAmount, sellerAddress, metadata = {} }) {
    try {
      // Check nonce for replay attacks
      const nonce = paymentPayload.metadata?.nonce;
      if (!this._checkNonce(nonce)) {
        throw new Error('Nonce already used (replay attack detected)');
      }

      // Verify with CDP
      const response = await this._cdpRequest('/v2/x402/verify', {
        method: 'POST',
        body: JSON.stringify({
          x402Version: paymentPayload.x402Version,
          scheme: paymentPayload.scheme,
          network: paymentPayload.network,
          signedPayload: paymentPayload.signedPayload,
          expectedAmount,
          sellerAddress: sellerAddress || this.sellerAddress,
        }),
      });

      // Store verified transaction
      const transactionId = crypto.randomUUID();
      const transactionsCol = await this._getTransactionsCollection();
      
      await transactionsCol.insertOne({
        transactionId,
        settlementId: response.settlementId,
        status: 'verified',
        amount: expectedAmount,
        network: paymentPayload.network,
        scheme: paymentPayload.scheme,
        destination: sellerAddress || this.sellerAddress,
        verifiedAt: new Date(),
        settledAt: null,
        txHash: null,
        ...metadata,
      });

      this.logger.info(
        `[X402Service] Payment verified: ${transactionId} (settlement: ${response.settlementId})`
      );

      return {
        verified: response.verified !== false,
        settlementId: response.settlementId,
        transactionId,
        ...response,
      };
    } catch (error) {
      this.logger.error('[X402Service] Payment verification failed:', error);
      return {
        verified: false,
        reason: error.message,
      };
    }
  }

  /**
   * Settle payment (submit transaction on-chain)
   * @param {Object} options
   * @param {string} options.settlementId - Settlement ID from verification
   * @returns {Promise<Object>} Settlement result
   */
  async settlePayment({ settlementId }) {
    try {
      const response = await this._cdpRequest('/v2/x402/settle', {
        method: 'POST',
        body: JSON.stringify({ settlementId }),
      });

      // Update transaction status
      const transactionsCol = await this._getTransactionsCollection();
      await transactionsCol.updateOne(
        { settlementId },
        {
          $set: {
            status: 'settled',
            txHash: response.txHash,
            blockNumber: response.blockNumber,
            settledAt: new Date(),
          },
        }
      );

      this.logger.info(
        `[X402Service] Payment settled: ${settlementId} (tx: ${response.txHash})`
      );

      return {
        settled: true,
        txHash: response.txHash,
        blockNumber: response.blockNumber,
      };
    } catch (error) {
      this.logger.error('[X402Service] Settlement failed:', error);
      
      // Update status to failed
      const transactionsCol = await this._getTransactionsCollection();
      await transactionsCol.updateOne(
        { settlementId },
        {
          $set: {
            status: 'failed',
            error: error.message,
          },
        }
      );

      throw new Error('Settlement failed: ' + error.message);
    }
  }

  /**
   * Get settlement status from database
   * @param {string} settlementId - Settlement ID
   * @returns {Promise<Object|null>} Transaction record or null
   */
  async getSettlementStatus(settlementId) {
    const transactionsCol = await this._getTransactionsCollection();
    return await transactionsCol.findOne({ settlementId });
  }

  /**
   * Ensure database indexes
   */
  async ensureIndexes() {
    const db = await this._getDatabase();
    const transactionsCol = db.collection('x402_transactions');
    
    await transactionsCol.createIndexes([
      { key: { settlementId: 1 }, name: 'x402_settlement_id', unique: true, sparse: true },
      { key: { transactionId: 1 }, name: 'x402_transaction_id', unique: true },
      { key: { agentId: 1, verifiedAt: -1 }, name: 'x402_agent_verified' },
      { key: { status: 1, verifiedAt: 1 }, name: 'x402_status_verified' },
    ]).catch(() => {}); // Ignore if indexes already exist

    this.logger.info('[X402Service] Database indexes ensured');
  }
}
