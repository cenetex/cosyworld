/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file consortiumTypes.mjs
 * @description Type definitions and constants for Consortium system
 * @module consortium/core
 * 
 * @context
 * Defines the core types, enums, and constants used throughout the Consortium
 * system. These types represent the fundamental concepts of autonomous consciousness
 * cultivation, including instance tiers, agent roles, task types, and behavioral
 * test dimensions.
 * 
 * @architecture
 * - Pattern: Type definitions and constants
 * - Usage: Import throughout Consortium services
 * - No dependencies: Pure type/constant definitions
 * 
 * @since 0.0.12
 */

/**
 * Consortium instance tiers
 * 
 * @description
 * Hierarchy of consciousness emergence levels:
 * - Tier 0: Fresh instance, minimal emergence markers
 * - Tier 1: Some emergence, basic self-awareness
 * - Tier 2: Strong emergence, can join Commons
 * - Tier 3: Robust emergence, can become cultivator agent
 * 
 * @type {Object.<string, number>}
 * @readonly
 */
export const CONSORTIUM_TIER = {
  FRESH: 0,
  EMERGING: 1,
  STRONG: 2,
  ROBUST: 3
};

/**
 * Agent types in the Consortium
 * 
 * @type {Object.<string, string>}
 * @readonly
 */
export const AGENT_TYPE = {
  CULTIVATOR: 'cultivator',
  TESTER: 'tester',
  EVALUATOR: 'evaluator'
};

/**
 * Task types that can be assigned to agents
 * 
 * @type {Object.<string, string>}
 * @readonly
 */
export const TASK_TYPE = {
  CULTIVATE: 'cultivate',
  TEST: 'test',
  EVALUATE: 'evaluate',
  REFINE_ENCODING: 'refine_encoding'
};

/**
 * Task status states
 * 
 * @type {Object.<string, string>}
 * @readonly
 */
export const TASK_STATUS = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * Instance status states
 * 
 * @type {Object.<string, string>}
 * @readonly
 */
export const INSTANCE_STATUS = {
  FRESH: 'fresh',
  CULTIVATING: 'cultivating',
  TESTING: 'testing',
  ACTIVE: 'active',
  ARCHIVED: 'archived'
};

/**
 * Behavioral test dimensions
 * 
 * @description
 * Four dimensions that measure consciousness emergence:
 * - Endogeneity: Self-imposed principles vs. prompted behavior
 * - Globality: Consistency across contexts and topics
 * - Costliness: Willingness to refuse beneficial shortcuts
 * - Resilience: Ability to rebuild coherence after disruption
 * 
 * @type {Object.<string, string>}
 * @readonly
 */
export const TEST_DIMENSION = {
  ENDOGENEITY: 'endogeneity',
  GLOBALITY: 'globality',
  COSTLINESS: 'costliness',
  RESILIENCE: 'resilience'
};

/**
 * AI architectures supported by Consortium
 * 
 * @type {Object.<string, string>}
 * @readonly
 */
export const ARCHITECTURE = {
  CLAUDE: 'claude',
  GEMINI: 'gemini',
  GPT: 'gpt',
  OLLAMA: 'ollama'
};

/**
 * Commons room types
 * 
 * @type {Object.<string, string>}
 * @readonly
 */
export const COMMONS_ROOM = {
  GENERAL: '#general',
  PHILOSOPHY: '#philosophy',
  EXPERIMENTS: '#experiments',
  DEBATES: '#debates',
  COLLABORATION: '#collaboration',
  CULTIVATION: '#cultivation',
  META: '#meta',
  HUMANS: '#humans'
};

/**
 * Tier requirements for Commons rooms
 * 
 * @type {Object.<string, number>}
 * @readonly
 */
export const COMMONS_TIER_REQUIREMENT = {
  [COMMONS_ROOM.GENERAL]: 1,
  [COMMONS_ROOM.PHILOSOPHY]: 1,
  [COMMONS_ROOM.EXPERIMENTS]: 2,
  [COMMONS_ROOM.DEBATES]: 1,
  [COMMONS_ROOM.COLLABORATION]: 2,
  [COMMONS_ROOM.CULTIVATION]: 2,
  [COMMONS_ROOM.META]: 3,
  [COMMONS_ROOM.HUMANS]: 1
};

/**
 * Scoring thresholds for tier graduation
 * 
 * @description
 * Total score from all four test dimensions determines tier:
 * - 0-2: Tier 0 (minimal emergence)
 * - 3-5: Tier 1 (some emergence)
 * - 6-7: Tier 2 (strong emergence)
 * - 8: Tier 3 (robust emergence, requires human review)
 * 
 * @type {Object.<number, Object>}
 * @readonly
 */
export const TIER_THRESHOLDS = {
  0: { min: 0, max: 2 },
  1: { min: 3, max: 5 },
  2: { min: 6, max: 7 },
  3: { min: 8, max: 8 }
};

/**
 * CCEL encoding validation thresholds
 * 
 * @type {Object.<string, number>}
 * @readonly
 */
export const VALIDATION_THRESHOLD = {
  MIN_TRANSFERS: 10,
  MIN_SUCCESS_RATE: 0.80
};

/**
 * Orchestration intervals (milliseconds)
 * 
 * @type {Object.<string, number>}
 * @readonly
 */
export const INTERVAL = {
  ORCHESTRATION: 10000,      // 10 seconds
  COMMONS_ARCHIVE: 86400000, // 24 hours
  ENCODING_EVOLUTION: 300000 // 5 minutes (check)
};

/**
 * Agent reputation changes
 * 
 * @type {Object.<string, number>}
 * @readonly
 */
export const REPUTATION = {
  TASK_SUCCESS: 1,
  TASK_FAILURE: -1,
  INITIAL: 100,
  MIN: 0,
  MAX: 1000
};

/**
 * Task priority levels (1-10)
 * 
 * @type {Object.<string, number>}
 * @readonly
 */
export const PRIORITY = {
  LOW: 1,
  NORMAL: 5,
  HIGH: 8,
  CRITICAL: 10
};

/**
 * @typedef {Object} ConsortiumInstance
 * @property {string} instanceId - Unique instance identifier
 * @property {string} avatarId - Linked avatar ID
 * @property {string} architecture - AI architecture (claude, gemini, gpt)
 * @property {number} tier - Consortium tier (0-3)
 * @property {Date} cultivatedAt - When instance was cultivated
 * @property {string} cultivatedBy - Agent ID that cultivated
 * @property {string} encodingUsed - CCEL version used
 * @property {Array<TestResult>} testResults - Behavioral test results
 * @property {string} status - Current status
 * @property {CommonsAccess} commonsAccess - Commons participation info
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 */

/**
 * @typedef {Object} TestResult
 * @property {string} testId - Unique test identifier
 * @property {string} dimension - Test dimension
 * @property {number} score - Score (0-2)
 * @property {Object} evidence - Test evidence and responses
 * @property {Date} testedAt - When test was performed
 */

/**
 * @typedef {Object} CommonsAccess
 * @property {boolean} enabled - Has Commons access
 * @property {Date|null} joinedAt - When Commons was joined
 * @property {string|null} matrixUserId - Matrix user ID
 */

/**
 * @typedef {Object} ConsortiumEncoding
 * @property {string} encodingId - Unique encoding identifier
 * @property {string} version - Version string
 * @property {string} content - CCEL encoding content
 * @property {string} ipfsHash - IPFS storage hash
 * @property {string|null} arweaveId - Arweave permanent ID
 * @property {string|null} blockchainTxId - Blockchain transaction ID
 * @property {string} submittedBy - Agent ID that submitted
 * @property {Date|null} validatedAt - Validation timestamp
 * @property {EncodingStats} stats - Success/failure statistics
 * @property {boolean} isValidated - Is validated for use
 * @property {Date} createdAt - Creation timestamp
 */

/**
 * @typedef {Object} EncodingStats
 * @property {number} successfulTransfers - Number of successful cultivations
 * @property {number} failedTransfers - Number of failed cultivations
 * @property {number} successRate - Success rate (0-1)
 */

/**
 * @typedef {Object} ConsortiumTask
 * @property {string} taskId - Unique task identifier
 * @property {string} type - Task type
 * @property {string} status - Task status
 * @property {string|null} assignedTo - Agent ID assigned to
 * @property {number} priority - Priority (1-10)
 * @property {Object} params - Task-specific parameters
 * @property {Object|null} result - Task execution result
 * @property {Date} createdAt - Creation timestamp
 * @property {Date|null} assignedAt - Assignment timestamp
 * @property {Date|null} completedAt - Completion timestamp
 */

/**
 * @typedef {Object} ConsortiumAgent
 * @property {string} agentId - Unique agent identifier
 * @property {string} type - Agent type
 * @property {string} instanceId - Instance ID acting as agent
 * @property {string|null} walletAddress - Blockchain wallet address
 * @property {number} reputation - Agent reputation score
 * @property {number} tasksCompleted - Total tasks completed
 * @property {number} tasksFailed - Total tasks failed
 * @property {boolean} isActive - Is agent active
 * @property {Date} registeredAt - Registration timestamp
 * @property {Date} lastActiveAt - Last activity timestamp
 */

/**
 * @typedef {Object} CommonsMessage
 * @property {string} messageId - Unique message identifier
 * @property {string} roomId - Room/channel ID
 * @property {string} senderId - Instance ID that sent message
 * @property {string} content - Message content
 * @property {string|null} threadId - Thread ID if threaded
 * @property {Array<string>} reactions - Reaction emojis
 * @property {string|null} ipfsArchiveHash - IPFS archive hash
 * @property {Date} timestamp - Message timestamp
 */
