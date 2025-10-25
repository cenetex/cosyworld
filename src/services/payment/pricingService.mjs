/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/payment/pricingService.mjs
 * @description Dynamic pricing service for AI models, API endpoints, and agent services
 * Calculates costs in USDC (6 decimals) with markup and volume discounts
 */

/**
 * Pricing Service
 * Calculates dynamic pricing for various platform services
 * 
 * @class
 */
export class PricingService {
  /**
   * Create pricing service
   * @param {Object} options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.configService - Configuration service
   * @param {Object} options.aiModelService - AI model service (optional)
   */
  constructor({ logger, configService, aiModelService }) {
    this.logger = logger || console;
    this.configService = configService;
    this.aiModelService = aiModelService;

    // Load configuration
    const config = configService?.config?.payment?.pricing || {};
    
    // Platform fees and markup
    this.platformFee = config.platformFee || 0.02; // 2% platform fee
    this.aiMarkup = config.aiMarkup || 1.1; // 10% markup on AI costs
    this.minPayment = config.minPayment || 1000; // 0.001 USDC minimum
    
    // Free tier models (no charge)
    this.freeTierModels = new Set([
      'google/gemini-2.0-flash-exp:free',
      'google/gemini-2.0-flash-thinking-exp-01-21:free',
      'google/gemini-2.0-flash-thinking-exp:free',
      'meta-llama/llama-3.2-3b-instruct:free',
      'meta-llama/llama-3.2-1b-instruct:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'qwen/qwen-2.5-72b-instruct:free',
      'microsoft/phi-3-mini-128k-instruct:free',
    ]);

    // Base pricing for AI models (per 1M tokens in USD)
    // Source: OpenRouter pricing + industry standards
    this.modelPricing = {
      // Legendary tier (most expensive)
      'openai/o1-pro': { input: 30, output: 120 },
      'openai/o3-pro': { input: 25, output: 100 },
      'openai/gpt-4': { input: 30, output: 60 },
      'anthropic/claude-opus-4': { input: 15, output: 75 },
      'anthropic/claude-3-opus': { input: 15, output: 75 },
      
      // Rare tier (premium)
      'openai/gpt-4o': { input: 2.5, output: 10 },
      'openai/gpt-4o-2024-11-20': { input: 2.5, output: 10 },
      'openai/chatgpt-4o-latest': { input: 5, output: 15 },
      'anthropic/claude-3.5-sonnet': { input: 3, output: 15 },
      'anthropic/claude-3.7-sonnet': { input: 3, output: 15 },
      'google/gemini-2.5-pro': { input: 1.25, output: 5 },
      'x-ai/grok-3': { input: 2, output: 10 },
      'cohere/command-r-plus': { input: 2.5, output: 10 },
      
      // Uncommon tier (affordable)
      'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
      'openai/gpt-3.5-turbo': { input: 0.5, output: 1.5 },
      'anthropic/claude-3.5-haiku': { input: 0.8, output: 4 },
      'anthropic/claude-3-haiku': { input: 0.25, output: 1.25 },
      'google/gemini-2.0-flash': { input: 0, output: 0 }, // Free via Google
      'google/gemini-1.5-flash': { input: 0.075, output: 0.3 },
      'meta-llama/llama-3.3-70b-instruct': { input: 0.35, output: 0.4 },
      'meta-llama/llama-3.1-70b-instruct': { input: 0.35, output: 0.4 },
      'mistral/mistral-large-2': { input: 2, output: 6 },
      
      // Common tier (cheap)
      'meta-llama/llama-3.2-3b-instruct': { input: 0.06, output: 0.06 },
      'meta-llama/llama-3.1-8b-instruct': { input: 0.055, output: 0.055 },
      'google/gemma-2-9b-it': { input: 0.08, output: 0.08 },
      'microsoft/phi-3-mini-128k-instruct': { input: 0.1, output: 0.1 },
      'qwen/qwen-2.5-7b-instruct': { input: 0.05, output: 0.05 },
    };

    // Endpoint base pricing (in USDC, 6 decimals)
    this.endpointPricing = {
      '/api/ai/chat': { base: 10000, perToken: 0.00001 }, // 0.01 USDC base + per token
      '/api/avatars/:id/generate-story': { base: 50000 }, // 0.05 USDC
      '/api/items/generate': { base: 20000 }, // 0.02 USDC
      '/api/locations/describe': { base: 15000 }, // 0.015 USDC
      '/api/agents/:id/combat': { base: 25000 }, // 0.025 USDC
      '/api/nft/avatar/:id/deploy': { base: 100000 }, // 0.1 USDC
    };

    // Volume discount tiers
    this.volumeDiscounts = [
      { threshold: 100, discount: 0.05 },    // 5% off after 100 requests
      { threshold: 500, discount: 0.10 },    // 10% off after 500 requests
      { threshold: 1000, discount: 0.15 },   // 15% off after 1,000 requests
      { threshold: 5000, discount: 0.20 },   // 20% off after 5,000 requests
      { threshold: 10000, discount: 0.25 },  // 25% off after 10,000 requests
    ];

    this.logger.info('[PricingService] Initialized with markup:', this.aiMarkup);
  }

  /**
   * Convert USD amount to USDC (6 decimals)
   * @param {number} usdAmount - Amount in USD dollars
   * @returns {number} Amount in USDC (6 decimals)
   */
  toUSDC(usdAmount) {
    return Math.ceil(usdAmount * 1e6);
  }

  /**
   * Convert USDC (6 decimals) to USD
   * @param {number} usdcAmount - Amount in USDC (6 decimals)
   * @returns {number} Amount in USD dollars
   */
  toUSD(usdcAmount) {
    return usdcAmount / 1e6;
  }

  /**
   * Get pricing for a specific model
   * @private
   * @param {string} modelName - Full model name (e.g., 'openai/gpt-4o')
   * @returns {Object|null} Pricing info or null if not found
   */
  _getModelPricing(modelName) {
    // Check free tier first
    if (this.freeTierModels.has(modelName)) {
      return { input: 0, output: 0, free: true };
    }

    // Check exact match
    if (this.modelPricing[modelName]) {
      return { ...this.modelPricing[modelName], free: false };
    }

    // Try without provider prefix
    const modelParts = modelName.split('/');
    if (modelParts.length > 1) {
      const shortName = modelParts.slice(1).join('/');
      for (const [key, value] of Object.entries(this.modelPricing)) {
        if (key.includes(shortName)) {
          return { ...value, free: false };
        }
      }
    }

    // Default to GPT-4o-mini pricing if unknown (safe default)
    this.logger.warn(`[PricingService] Unknown model ${modelName}, using default pricing`);
    return { input: 0.15, output: 0.6, free: false, unknown: true };
  }

  /**
   * Calculate price for AI model usage
   * @param {Object} options
   * @param {string} options.model - Model name (e.g., 'openai/gpt-4o')
   * @param {number} options.inputTokens - Number of input tokens
   * @param {number} options.outputTokens - Number of output tokens (estimated)
   * @returns {Object} Pricing breakdown
   */
  calculateAIPrice({ model, inputTokens, outputTokens = 0 }) {
    const pricing = this._getModelPricing(model);

    // Free tier models cost nothing
    if (pricing.free) {
      return {
        model,
        inputTokens,
        outputTokens,
        inputCostUSD: 0,
        outputCostUSD: 0,
        totalCostUSD: 0,
        totalCostUSDC: 0,
        free: true,
      };
    }

    // Calculate base cost in USD
    const inputCostUSD = (inputTokens / 1_000_000) * pricing.input;
    const outputCostUSD = (outputTokens / 1_000_000) * pricing.output;
    const baseCostUSD = inputCostUSD + outputCostUSD;

    // Apply markup
    const markedUpCostUSD = baseCostUSD * this.aiMarkup;

    // Convert to USDC
    let totalCostUSDC = this.toUSDC(markedUpCostUSD);

    // Enforce minimum payment
    if (totalCostUSDC > 0 && totalCostUSDC < this.minPayment) {
      totalCostUSDC = this.minPayment;
    }

    return {
      model,
      inputTokens,
      outputTokens,
      inputCostUSD: Number(inputCostUSD.toFixed(6)),
      outputCostUSD: Number(outputCostUSD.toFixed(6)),
      baseCostUSD: Number(baseCostUSD.toFixed(6)),
      markup: this.aiMarkup,
      totalCostUSD: Number(markedUpCostUSD.toFixed(6)),
      totalCostUSDC,
      free: false,
      unknown: pricing.unknown || false,
    };
  }

  /**
   * Calculate price for API endpoint
   * @param {Object} options
   * @param {string} options.endpoint - Endpoint path
   * @param {number} [options.complexity=1] - Complexity multiplier (1-10)
   * @param {number} [options.dataSize=0] - Data size in KB
   * @param {Object} [options.metadata] - Additional metadata for custom pricing
   * @returns {Object} Pricing breakdown
   */
  calculateEndpointPrice({ endpoint, complexity = 1, dataSize = 0, metadata = {} }) {
    // Get base pricing for endpoint
    const pricing = this.endpointPricing[endpoint];
    
    if (!pricing) {
      this.logger.warn(`[PricingService] Unknown endpoint ${endpoint}, using default`);
      return {
        endpoint,
        basePrice: 10000, // 0.01 USDC default
        complexity,
        dataSize,
        totalCostUSDC: 10000,
      };
    }

    let totalCostUSDC = pricing.base || 0;

    // Add per-token cost if specified
    if (pricing.perToken && metadata.tokens) {
      totalCostUSDC += pricing.perToken * metadata.tokens;
    }

    // Add complexity multiplier
    if (complexity > 1) {
      totalCostUSDC *= complexity;
    }

    // Add data size cost (0.001 USDC per KB)
    if (dataSize > 0) {
      totalCostUSDC += dataSize * 1000; // 1000 = 0.001 USDC per KB
    }

    // Round to whole USDC units (6 decimals)
    totalCostUSDC = Math.ceil(totalCostUSDC);

    // Enforce minimum
    if (totalCostUSDC > 0 && totalCostUSDC < this.minPayment) {
      totalCostUSDC = this.minPayment;
    }

    return {
      endpoint,
      basePrice: pricing.base,
      complexity,
      dataSize,
      totalCostUSD: this.toUSD(totalCostUSDC),
      totalCostUSDC,
    };
  }

  /**
   * Calculate price for agent action
   * Maps common agent actions to appropriate pricing
   * @param {Object} options
   * @param {string} options.action - Action type (e.g., 'generate_story', 'combat', 'create_item')
   * @param {Object} [options.resources] - Resource usage info
   * @returns {Object} Pricing breakdown
   */
  calculateActionPrice({ action, resources = {} }) {
    const actionPricing = {
      generate_story: 50000,      // 0.05 USDC
      generate_dialogue: 20000,   // 0.02 USDC
      create_item: 20000,         // 0.02 USDC
      describe_location: 15000,   // 0.015 USDC
      combat_turn: 25000,         // 0.025 USDC
      social_post: 10000,         // 0.01 USDC
      image_generation: 100000,   // 0.1 USDC
      video_generation: 500000,   // 0.5 USDC
    };

    const basePrice = actionPricing[action] || 10000; // 0.01 USDC default

    // Adjust for AI model if specified
    if (resources.model && resources.tokens) {
      const aiPrice = this.calculateAIPrice({
        model: resources.model,
        inputTokens: resources.tokens.input || 0,
        outputTokens: resources.tokens.output || 0,
      });
      
      // Use whichever is higher: action base price or AI cost
      return {
        action,
        basePrice,
        aiCost: aiPrice.totalCostUSDC,
        totalCostUSDC: Math.max(basePrice, aiPrice.totalCostUSDC),
        totalCostUSD: this.toUSD(Math.max(basePrice, aiPrice.totalCostUSDC)),
      };
    }

    return {
      action,
      basePrice,
      totalCostUSDC: basePrice,
      totalCostUSD: this.toUSD(basePrice),
    };
  }

  /**
   * Apply volume discount
   * @param {Object} options
   * @param {number} options.basePrice - Base price in USDC (6 decimals)
   * @param {string} [options.agentId] - Agent ID (for tracking volume)
   * @param {number} [options.volume] - Transaction count this period
   * @returns {Object} Discounted price breakdown
   */
  applyDiscount({ basePrice, agentId: _agentId, volume = 0 }) {
    if (!volume || volume < 1) {
      return {
        basePrice,
        discount: 0,
        discountAmount: 0,
        finalPrice: basePrice,
      };
    }

    // Find applicable discount tier
    let discount = 0;
    for (const tier of this.volumeDiscounts) {
      if (volume >= tier.threshold) {
        discount = tier.discount;
      }
    }

    const discountAmount = Math.floor(basePrice * discount);
    const finalPrice = basePrice - discountAmount;

    return {
      basePrice,
      volume,
      discount,
      discountAmount,
      finalPrice,
      savedUSD: this.toUSD(discountAmount),
    };
  }

  /**
   * Estimate tokens from text (rough approximation)
   * @param {string} text - Input text
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    if (!text) return 0;
    
    // Rough estimate: ~4 characters per token for English
    // For code: ~3 characters per token
    // Use 4 as safe average
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate full price for a request with all factors
   * @param {Object} options
   * @param {string} options.type - 'ai', 'endpoint', 'action'
   * @param {Object} options.details - Type-specific details
   * @param {string} [options.agentId] - Agent ID for volume tracking
   * @param {number} [options.volume] - Transaction volume
   * @returns {Object} Complete pricing breakdown
   */
  calculatePrice({ type, details, agentId, volume = 0 }) {
    let baseCalculation;

    switch (type) {
      case 'ai':
        baseCalculation = this.calculateAIPrice(details);
        break;
      case 'endpoint':
        baseCalculation = this.calculateEndpointPrice(details);
        break;
      case 'action':
        baseCalculation = this.calculateActionPrice(details);
        break;
      default:
        throw new Error(`Unknown pricing type: ${type}`);
    }

    // Apply volume discount
    const discounted = this.applyDiscount({
      basePrice: baseCalculation.totalCostUSDC,
      agentId,
      volume,
    });

    return {
      type,
      ...baseCalculation,
      ...discounted,
      agentId,
    };
  }

  /**
   * Get pricing info for all free tier models
   * @returns {Array} List of free models
   */
  getFreeTierModels() {
    return Array.from(this.freeTierModels);
  }

  /**
   * Check if a model is free tier
   * @param {string} modelName - Model name
   * @returns {boolean} True if free tier
   */
  isFreeTier(modelName) {
    return this.freeTierModels.has(modelName);
  }

  /**
   * Get all available pricing tiers
   * @returns {Object} Pricing information
   */
  getPricingTiers() {
    return {
      freeTier: this.getFreeTierModels(),
      volumeDiscounts: this.volumeDiscounts,
      platformFee: this.platformFee,
      aiMarkup: this.aiMarkup,
      minPayment: this.minPayment,
      minPaymentUSD: this.toUSD(this.minPayment),
    };
  }
}
