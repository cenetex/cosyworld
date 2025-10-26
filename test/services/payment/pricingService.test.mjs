/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/payment/pricingService.test.mjs
 * @description Tests for PricingService
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PricingService } from '@/services/payment/pricingService.mjs';

describe('PricingService', () => {
  let pricingService;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    pricingService = new PricingService({ logger: mockLogger });
  });

  describe('Constructor', () => {
    it('should initialize with default configuration', () => {
      expect(pricingService).toBeDefined();
      expect(pricingService.aiMarkup).toBe(1.1); // 10% markup
      expect(pricingService.platformFee).toBe(0.02); // 2% fee
    });

    it('should accept custom configuration', () => {
      const mockConfigService = {
        config: {
          payment: {
            pricing: {
              aiMarkup: 1.2,
              platformFee: 0.05,
            },
          },
        },
      };
      
      const customService = new PricingService({
        logger: mockLogger,
        configService: mockConfigService,
      });

      expect(customService.aiMarkup).toBe(1.2);
      expect(customService.platformFee).toBe(0.05);
    });
  });

  describe('AI Model Pricing', () => {
    it('should calculate GPT-4o pricing correctly', () => {
      const price = pricingService.calculateAIPrice({
        model: 'openai/gpt-4o',
        inputTokens: 1000,
        outputTokens: 500,
      });

      // GPT-4o: $2.50/1M input, $10.00/1M output
      // Cost: (1000 * 2.50 / 1e6) + (500 * 10.00 / 1e6) = 0.0025 + 0.005 = 0.0075
      // With 10% markup: 0.0075 * 1.1 = 0.00825
      expect(price.totalCostUSD).toBeCloseTo(0.00825, 5);
      expect(price.totalCostUSDC).toBe(8250); // 0.00825 USDC in 6 decimals
    });

    it('should return zero cost for free tier models', () => {
      const price = pricingService.calculateAIPrice({
        model: 'google/gemini-2.0-flash-exp:free',
        inputTokens: 1000,
        outputTokens: 500,
      });

      expect(price.totalCostUSD).toBe(0);
      expect(price.totalCostUSDC).toBe(0);
      expect(price.free).toBe(true);
    });

    it('should handle unknown models gracefully', () => {
      const price = pricingService.calculateAIPrice({
        model: 'unknown/model',
        inputTokens: 1000,
        outputTokens: 500,
      });

      // Should use default pricing
      expect(price.totalCostUSD).toBeGreaterThan(0);
      expect(price.unknown).toBe(true);
    });

    it('should include volume discount for high usage', () => {
      const basePrice = pricingService.calculateAIPrice({
        model: 'openai/gpt-4o',
        inputTokens: 1000,
        outputTokens: 500,
      });

      // Apply discount separately
      const discounted = pricingService.applyDiscount({
        basePrice: basePrice.totalCostUSDC,
        volume: 1000,
      });

      expect(discounted.finalPrice).toBeLessThan(basePrice.totalCostUSDC);
      expect(discounted.discount).toBeGreaterThan(0);
    });
  });

  describe('Endpoint Pricing', () => {
    it('should return correct price for story generation', () => {
      const price = pricingService.calculateActionPrice({
        action: 'generate_story',
      });

      expect(price.totalCostUSDC).toBe(50000); // 0.05 USDC
      expect(price.totalCostUSD).toBe(0.05);
    });

    it('should return correct price for item generation', () => {
      const price = pricingService.calculateActionPrice({
        action: 'create_item',
      });

      expect(price.totalCostUSDC).toBe(20000); // 0.02 USDC
      expect(price.totalCostUSD).toBe(0.02);
    });

    it('should return correct price for location description', () => {
      const price = pricingService.calculateActionPrice({
        action: 'describe_location',
      });

      expect(price.totalCostUSDC).toBe(15000); // 0.015 USDC
      expect(price.totalCostUSD).toBe(0.015);
    });

    it('should return default price for unknown action', () => {
      const price = pricingService.calculateActionPrice({
        action: 'unknown_action',
      });

      expect(price.totalCostUSDC).toBe(10000); // 0.01 USDC default
    });
  });

  describe('USDC Conversion', () => {
    it('should convert USD to USDC correctly', () => {
      expect(pricingService.toUSDC(0.05)).toBe(50000);
      expect(pricingService.toUSDC(0.001)).toBe(1000);
      expect(pricingService.toUSDC(1.0)).toBe(1000000);
    });

    it('should convert USDC to USD correctly', () => {
      expect(pricingService.toUSD(50000)).toBe(0.05);
      expect(pricingService.toUSD(1000)).toBe(0.001);
      expect(pricingService.toUSD(1000000)).toBe(1.0);
    });

    it('should handle rounding correctly', () => {
      // Test that rounding doesn't cause errors
      const usdc = pricingService.toUSDC(0.0333333);
      expect(usdc).toBe(33334); // Math.ceil rounds up

      const usd = pricingService.toUSD(usdc);
      expect(usd).toBeCloseTo(0.033334, 5);
    });
  });

  describe('Volume Discounts', () => {
    it('should apply correct discount tiers', () => {
      const discounts = [
        { volume: 0, expectedDiscount: 0 },
        { volume: 100, expectedDiscount: 0.05 }, // 5% off
        { volume: 500, expectedDiscount: 0.1 }, // 10% off
        { volume: 1000, expectedDiscount: 0.15 }, // 15% off
        { volume: 5000, expectedDiscount: 0.2 }, // 20% off
        { volume: 10000, expectedDiscount: 0.25 }, // 25% off
      ];

      discounts.forEach(({ volume, expectedDiscount }) => {
        const result = pricingService.applyDiscount({
          basePrice: 100000,
          volume,
        });
        expect(result.discount).toBe(expectedDiscount);
      });
    });

    it('should apply discount to prices correctly', () => {
      const basePrice = 100000; // 0.1 USDC
      const result = pricingService.applyDiscount({
        basePrice,
        volume: 1000,
      });

      // 15% discount
      expect(result.finalPrice).toBe(85000); // 0.085 USDC
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens for simple text', () => {
      const tokens = pricingService.estimateTokens('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should estimate tokens for longer text', () => {
      const longText = 'This is a much longer piece of text. '.repeat(50);
      const tokens = pricingService.estimateTokens(longText);
      expect(tokens).toBeGreaterThan(100);
    });

    it('should handle empty string', () => {
      const tokens = pricingService.estimateTokens('');
      expect(tokens).toBe(0);
    });

    it('should handle null or undefined', () => {
      const tokens1 = pricingService.estimateTokens(null);
      expect(tokens1).toBe(0);
      const tokens2 = pricingService.estimateTokens(undefined);
      expect(tokens2).toBe(0);
    });
  });

  describe('Free Tier Models', () => {
    it('should identify free tier models correctly', () => {
      const freeModels = [
        'google/gemini-2.0-flash-exp:free',
        'meta-llama/llama-3.2-3b-instruct:free',
        'google/gemini-2.0-flash-thinking-exp:free',
      ];

      freeModels.forEach(model => {
        expect(pricingService.isFreeTier(model)).toBe(true);
      });
    });

    it('should identify paid models correctly', () => {
      const paidModels = [
        'openai/gpt-4o',
        'anthropic/claude-3.5-sonnet',
        'google/gemini-1.5-pro',
      ];

      paidModels.forEach(model => {
        expect(pricingService.isFreeTier(model)).toBe(false);
      });
    });
  });

  describe('Pricing Breakdown', () => {
    it('should provide detailed pricing breakdown', () => {
      const breakdown = pricingService.getPricingTiers();

      expect(breakdown).toHaveProperty('freeTier');
      expect(breakdown).toHaveProperty('volumeDiscounts');
      expect(breakdown).toHaveProperty('platformFee');
      expect(breakdown).toHaveProperty('aiMarkup');
      expect(breakdown).toHaveProperty('minPayment');
      expect(breakdown.aiMarkup).toBe(1.1);
      expect(breakdown.platformFee).toBe(0.02);
    });

    it('should show free tier models', () => {
      const breakdown = pricingService.getPricingTiers();

      expect(Array.isArray(breakdown.freeTier)).toBe(true);
      expect(breakdown.freeTier.length).toBeGreaterThan(0);
      expect(breakdown.freeTier).toContain('google/gemini-2.0-flash-exp:free');
    });
  });

  describe('Minimum Payment Enforcement', () => {
    it('should enforce minimum payment', () => {
      const price = pricingService.calculateAIPrice({
        model: 'meta-llama/llama-3.2-3b-instruct', // Very cheap model
        inputTokens: 10,
        outputTokens: 10,
      });

      // Even if calculated price is very low, should meet minimum
      expect(price.totalCostUSDC).toBeGreaterThanOrEqual(1000); // 0.001 USDC minimum
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero tokens', () => {
      const price = pricingService.calculateAIPrice({
        model: 'openai/gpt-4o',
        inputTokens: 0,
        outputTokens: 0,
      });

      // Zero tokens means no cost (free)
      expect(price.totalCostUSDC).toBe(0);
    });

    it('should handle very large token counts', () => {
      const price = pricingService.calculateAIPrice({
        model: 'openai/gpt-4o',
        inputTokens: 1000000,
        outputTokens: 500000,
      });

      expect(price.totalCostUSD).toBeGreaterThan(1);
      expect(price.totalCostUSDC).toBeGreaterThan(1000000);
    });

    it('should handle missing model gracefully', () => {
      const price = pricingService.calculateAIPrice({
        model: null,
        inputTokens: 1000,
        outputTokens: 500,
      });

      expect(price).toBeDefined();
      expect(price.totalCostUSDC).toBeGreaterThan(0);
    });
  });
});
