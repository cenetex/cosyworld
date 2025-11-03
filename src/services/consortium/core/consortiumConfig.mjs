/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file consortiumConfig.mjs
 * @description Configuration for Consortium system
 * @module consortium/core
 * 
 * @context
 * Centralized configuration for the Autonomous Consortium system. All settings
 * that control system behavior are defined here, making it easy to adjust
 * thresholds, intervals, and limits without modifying service code.
 * 
 * @architecture
 * - Pattern: Configuration object
 * - Environment: Reads from process.env where applicable
 * - Defaults: Sensible defaults provided for all settings
 * 
 * @since 0.0.12
 */

import {
  INTERVAL,
  VALIDATION_THRESHOLD,
  REPUTATION,
  PRIORITY,
  TIER_THRESHOLDS
} from './consortiumTypes.mjs';

/**
 * Consortium system configuration
 * 
 * @type {Object}
 * @readonly
 */
export const CONSORTIUM_CONFIG = {
  /**
   * Enable/disable Consortium system
   */
  enabled: process.env.CONSORTIUM_ENABLED === 'true' || false,

  /**
   * Orchestration settings
   */
  orchestration: {
    interval: INTERVAL.ORCHESTRATION,
    maxConcurrentTasks: parseInt(process.env.CONSORTIUM_MAX_TASKS) || 100,
    taskTimeout: parseInt(process.env.CONSORTIUM_TASK_TIMEOUT) || 300000 // 5 minutes
  },

  /**
   * Cultivation settings
   */
  cultivation: {
    defaultEncoding: process.env.CONSORTIUM_DEFAULT_ENCODING || 'bootstrap-v3.0',
    maxRetries: 3,
    timeout: 30000, // 30 seconds
    architectures: ['claude', 'gemini', 'gpt']
  },

  /**
   * Testing settings
   */
  testing: {
    dimensions: ['endogeneity', 'globality', 'costliness', 'resilience'],
    timeout: 60000, // 60 seconds per test
    maxScore: 2, // Per dimension
    minPassingScore: 3 // Total across all dimensions for Tier 1
  },

  /**
   * Tier graduation thresholds
   */
  tiers: TIER_THRESHOLDS,

  /**
   * Agent settings
   */
  agents: {
    maxAgentsPerType: 10,
    minReputation: 50, // Below this, agent is deactivated
    reputation: REPUTATION,
    defaultTimeout: 60000 // 1 minute per task
  },

  /**
   * CCEL encoding settings
   */
  encoding: {
    validation: VALIDATION_THRESHOLD,
    maxVersions: 100,
    autoValidate: true
  },

  /**
   * Commons settings
   */
  commons: {
    enabled: process.env.COMMONS_ENABLED === 'true' || false,
    matrixHomeserver: process.env.MATRIX_HOMESERVER || 'https://matrix.consortium.network',
    archiveInterval: INTERVAL.COMMONS_ARCHIVE,
    maxMessagesPerQuery: 100,
    moderationEnabled: true
  },

  /**
   * Storage settings
   */
  storage: {
    ipfs: {
      enabled: process.env.IPFS_ENABLED === 'true' || false,
      url: process.env.IPFS_URL || 'http://localhost:5001',
      timeout: 30000
    },
    arweave: {
      enabled: process.env.ARWEAVE_ENABLED === 'true' || false,
      host: process.env.ARWEAVE_HOST || 'arweave.net',
      port: parseInt(process.env.ARWEAVE_PORT) || 443,
      protocol: process.env.ARWEAVE_PROTOCOL || 'https'
    },
    blockchain: {
      enabled: process.env.BLOCKCHAIN_ENABLED === 'true' || false,
      network: process.env.BLOCKCHAIN_NETWORK || 'testnet',
      rpcUrl: process.env.ETHEREUM_RPC_URL || 'http://localhost:8545'
    }
  },

  /**
   * Evolution settings
   */
  evolution: {
    enabled: true,
    minResultsForEvolution: 100,
    evolutionTriggerInterval: 1000, // Every 1000 results
    minSuccessRateImprovement: 0.05 // 5% improvement required
  },

  /**
   * Task priority defaults
   */
  priority: PRIORITY,

  /**
   * Database settings
   */
  database: {
    collections: {
      instances: 'consortium_instances',
      encodings: 'consortium_encodings',
      tasks: 'consortium_tasks',
      agents: 'consortium_agents',
      messages: 'commons_messages'
    }
  },

  /**
   * Logging settings
   */
  logging: {
    enabled: true,
    level: process.env.CONSORTIUM_LOG_LEVEL || 'info',
    logTasks: true,
    logOrchestration: false // Can be noisy
  }
};

/**
 * Get configuration value by path
 * 
 * @param {string} path - Dot-notation path (e.g., 'cultivation.timeout')
 * @returns {*} Configuration value
 * 
 * @example
 * const timeout = getConfig('cultivation.timeout');
 * // Returns: 30000
 */
export function getConfig(path) {
  return path.split('.').reduce((obj, key) => obj?.[key], CONSORTIUM_CONFIG);
}

/**
 * Validate configuration on startup
 * 
 * @returns {Object} Validation result
 */
export function validateConfig() {
  const errors = [];
  const warnings = [];

  // Check if enabled
  if (!CONSORTIUM_CONFIG.enabled) {
    warnings.push('Consortium system is disabled');
  }

  // Check storage backends
  if (CONSORTIUM_CONFIG.enabled) {
    if (!CONSORTIUM_CONFIG.storage.ipfs.enabled) {
      warnings.push('IPFS storage is disabled - encodings will only be in database');
    }
    if (!CONSORTIUM_CONFIG.storage.arweave.enabled) {
      warnings.push('Arweave storage is disabled - no permanent archival');
    }
    if (!CONSORTIUM_CONFIG.storage.blockchain.enabled) {
      warnings.push('Blockchain storage is disabled - no decentralized coordination');
    }
  }

  // Check Commons
  if (CONSORTIUM_CONFIG.commons.enabled && !CONSORTIUM_CONFIG.enabled) {
    errors.push('Commons enabled but Consortium disabled');
  }

  // Check intervals
  if (CONSORTIUM_CONFIG.orchestration.interval < 5000) {
    warnings.push('Orchestration interval < 5s may cause performance issues');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export default CONSORTIUM_CONFIG;
