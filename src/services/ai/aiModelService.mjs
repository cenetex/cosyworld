import stringSimilarity from 'string-similarity';

// aiModelService.mjs
// Central registry for AI models and random selection logic

/**
 * AIModelService - Service-oriented registry for AI models.
 * Allows multiple independent registries and supports DI.
 */
export class AIModelService {
  constructor() {
    this.modelRegistry = new Map(); // serviceName -> [{ model, rarity, ... }]
  }

  /**
   * Register models for a given service.
   * @param {string} serviceName
   * @param {Array} modelsArray - Array of { model, rarity, ... }
   */
  registerModels(serviceName, modelsArray) {
    this.modelRegistry.set(serviceName, modelsArray);
  }

  /**
   * Get all models for a service.
   */
  getAllModels(serviceName) {
    return this.modelRegistry.get(serviceName) || [];
  }

  /**
   * Select a random model for a service, optionally by rarity.
   */
  getRandomModel(serviceName, rarity) {
    const models = this.getAllModels(serviceName);
    if (!models.length) return null;
    let filtered = models;
    if (rarity) filtered = models.filter(m => m.rarity === rarity);
    if (!filtered.length) filtered = models;
    const idx = Math.floor(Math.random() * filtered.length);
    return filtered[idx].model;
  }

  /**
   * Check if a model is available for a service.
   */
  modelIsAvailable(serviceName, modelName) {
    return this.getAllModels(serviceName).some(m => m.model === modelName.replace(':online', ''));
  }

  /**
   * Fuzzy match a model name for a service.
   */
  findClosestModel(serviceName, modelName) {
    const models = this.getAllModels(serviceName);
    const names = models.map(m => m.model);
    if (names.includes(modelName)) return modelName;
    try {
      const { bestMatch } = stringSimilarity.findBestMatch(modelName, names);
      if (bestMatch.rating > 0.5) return bestMatch.target;
    } catch {}
    return this.getRandomModel(serviceName);
  }
}

// Singleton instance for default usage
export const aiModelService = new AIModelService();
