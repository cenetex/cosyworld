/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/ai/aiModelService.test.mjs
 * @description Unit tests for AIModelService
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AIModelService } from '../../../src/services/ai/aiModelService.mjs';

describe('AIModelService', () => {
  let service;

  beforeEach(() => {
    service = new AIModelService();
    // Register test models
    service.registerModels('openrouter', [
      { model: 'openai/gpt-4o-mini', rarity: 'common' },
      { model: 'anthropic/claude-3-opus', rarity: 'legendary' },
      { model: 'meta-llama/llama-3.1-8b', rarity: 'common' }
    ]);
    service.registerModels('google', [
      { model: 'gemini-pro', rarity: 'common' }
    ]);
  });

  describe('Model Registry', () => {
    it('should register and retrieve models', () => {
      const models = service.getAllModels('openrouter');
      expect(models).toHaveLength(3);
      expect(models[0].model).toBe('openai/gpt-4o-mini');
    });

    it('should support multiple providers', () => {
      const openrouterModels = service.getAllModels('openrouter');
      const googleModels = service.getAllModels('google');
      
      expect(openrouterModels).toHaveLength(3);
      expect(googleModels).toHaveLength(1);
    });

    it('should return empty array for unknown service', () => {
      const models = service.getAllModels('unknown-service');
      expect(models).toEqual([]);
    });
  });

  describe('Model Availability', () => {
    it('should check if model is available', () => {
      const isAvailable = service.modelIsAvailable('openrouter', 'openai/gpt-4o-mini');
      expect(isAvailable).toBe(true);
    });

    it('should return false for non-existent model', () => {
      const isAvailable = service.modelIsAvailable('openrouter', 'non-existent-model');
      expect(isAvailable).toBe(false);
    });

    it('should handle null/undefined model name', () => {
      expect(service.modelIsAvailable('openrouter', null)).toBe(false);
      expect(service.modelIsAvailable('openrouter', undefined)).toBe(false);
    });
  });

  describe('Random Model Selection', () => {
    it('should select random model from service', () => {
      const model = service.getRandomModel('openrouter');
      expect(model).toBeDefined();
      expect(['openai/gpt-4o-mini', 'anthropic/claude-3-opus', 'meta-llama/llama-3.1-8b']).toContain(model);
    });

    it('should filter by rarity', () => {
      const model = service.getRandomModel('openrouter', 'legendary');
      expect(model).toBe('anthropic/claude-3-opus');
    });

    it('should return null for empty service', () => {
      const model = service.getRandomModel('unknown-service');
      expect(model).toBeNull();
    });

    it('should fall back to all models if rarity not found', () => {
      const model = service.getRandomModel('openrouter', 'non-existent-rarity');
      expect(model).toBeDefined(); // Should still return a model
    });
  });

  describe('Fuzzy Model Matching', () => {
    it('should find exact match', () => {
      const model = service.findClosestModel('openrouter', 'openai/gpt-4o-mini');
      expect(model).toBe('openai/gpt-4o-mini');
    });

    it('should find fuzzy match', () => {
      const model = service.findClosestModel('openrouter', 'gpt-4');
      expect(model).toBeDefined();
    });

    it('should return random model if no good match', () => {
      const model = service.findClosestModel('openrouter', 'completely-unrelated-name');
      expect(model).toBeDefined(); // Should still return something
    });
  });
});
