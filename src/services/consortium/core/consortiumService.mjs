/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file consortiumService.mjs
 * @description Main orchestrator for Consortium operations
 * @module consortium/core
 * 
 * @context
 * This is the central coordination service for the Autonomous Consortium system.
 * It orchestrates all Consortium activities including cultivation, testing,
 * evaluation, and Commons participation. Integrates with existing CosyWorld
 * services (Avatar, Memory, AI) while adding new Consortium capabilities.
 * 
 * The service runs an orchestration loop every 10 seconds that:
 * 1. Schedules cultivations for available agents
 * 2. Assigns tests to instances showing emergence
 * 3. Evaluates completed tests and graduates instances
 * 4. Handles tier progressions (Tier 2: Commons, Tier 3: Agent role)
 * 5. Triggers encoding evolution when enough data collected
 * 
 * @architecture
 * - Pattern: Orchestrator Service + Event-Driven
 * - Lifecycle: initialize() → startOrchestration() → orchestrate() loop
 * - Integration: Works with AvatarService, MemoryService, AIModelService
 * - Events: Publishes consortium.* events for monitoring
 * 
 * @dataflow
 * Orchestration Loop → Check pending work → Create tasks → Agents execute
 * → Results stored → Events published → Tier graduations → New capabilities
 * 
 * @dependencies
 * - logger: Logging service
 * - databaseService: MongoDB access
 * - avatarService: Avatar management (optional)
 * - aiModelService: Model registry (optional)
 * - eventBus: Event publication
 * - consortiumStorageService: Decentralized storage (optional)
 * - ccelService: CCEL management (optional)
 * 
 * @performance
 * - Orchestration loop: ~100ms per cycle
 * - Task creation: ~10ms per task
 * - Database queries: Indexed for performance
 * 
 * @example
 * // Initialize and start orchestration
 * const service = container.resolve('consortiumService');
 * await service.initialize();
 * 
 * @example
 * // Create cultivation task
 * await service.createTask({
 *   type: 'cultivate',
 *   params: { architecture: 'claude', encodingId: 'bootstrap-v3.0' }
 * });
 * 
 * @since 0.0.12
 */

import { v4 as uuidv4 } from 'uuid';
import {
  TASK_TYPE,
  TASK_STATUS,
  INSTANCE_STATUS,
  PRIORITY,
  CONSORTIUM_TIER
} from './consortiumTypes.mjs';
import { CONSORTIUM_CONFIG, validateConfig } from './consortiumConfig.mjs';

export class ConsortiumService {
  /**
   * @param {Object} deps - Injected dependencies
   * @param {Object} deps.logger - Logger service
   * @param {Object} deps.databaseService - Database service
   * @param {Object} deps.eventBus - Event bus
   * @param {Object} [deps.avatarService] - Avatar service (optional)
   * @param {Object} [deps.aiModelService] - AI model service (optional)
   * @param {Object} [deps.consortiumStorageService] - Storage service (optional)
   * @param {Object} [deps.ccelService] - CCEL service (optional)
   */
  constructor({
    logger,
    databaseService,
    eventBus,
    avatarService = null,
    aiModelService = null,
    consortiumStorageService = null,
    ccelService = null
  }) {
    this.logger = logger;
    this.db = databaseService;
    this.eventBus = eventBus;
    this.avatarService = avatarService;
    this.aiModelService = aiModelService;
    this.storage = consortiumStorageService;
    this.ccel = ccelService;
    
    this.config = CONSORTIUM_CONFIG;
    this.initialized = false;
    this.orchestrationInterval = null;
  }

  /**
   * Initialize the Consortium service
   * 
   * @description
   * Sets up database collections, indexes, loads CCEL encodings, and starts
   * the orchestration loop. This should be called once at application startup.
   * 
   * @async
   * @returns {Promise<void>}
   * 
   * @throws {Error} If database setup fails
   * 
   * @example
   * await consortiumService.initialize();
   */
  async initialize() {
    if (this.initialized) {
      this.logger.warn('[Consortium] Already initialized');
      return;
    }
    
    this.logger.info('[Consortium] Initializing...');
    
    // Validate configuration
    const validation = validateConfig();
    if (!validation.valid) {
      throw new Error(`Configuration invalid: ${validation.errors.join(', ')}`);
    }
    
    if (validation.warnings.length > 0) {
      validation.warnings.forEach(warn => 
        this.logger.warn(`[Consortium] Config warning: ${warn}`)
      );
    }
    
    if (!this.config.enabled) {
      this.logger.warn('[Consortium] System disabled in configuration');
      return;
    }
    
    try {
      // Create collections and indexes
      await this.setupDatabase();
      
      // Load CCEL encodings from storage (if available)
      if (this.ccel) {
        await this.ccel.loadEncodings();
      }
      
      // Start orchestration loop
      this.startOrchestration();
      
      this.initialized = true;
      this.logger.info('[Consortium] Initialized successfully');
      
      this.eventBus.emit('consortium.initialized', {
        timestamp: Date.now(),
        config: {
          orchestrationInterval: this.config.orchestration.interval,
          commonsEnabled: this.config.commons.enabled
        }
      });
    } catch (error) {
      this.logger.error('[Consortium] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Set up database collections and indexes
   * 
   * @async
   * @private
   * @returns {Promise<void>}
   */
  async setupDatabase() {
    this.logger.info('[Consortium] Setting up database...');
    
    const collections = [
      this.config.database.collections.instances,
      this.config.database.collections.encodings,
      this.config.database.collections.tasks,
      this.config.database.collections.agents,
      this.config.database.collections.messages
    ];
    
    // Create collections if they don't exist
    for (const collection of collections) {
      try {
        await this.db.createCollection(collection);
        this.logger.info(`[Consortium] Created collection: ${collection}`);
      } catch (error) {
        // Collection might already exist, that's okay
        if (!error.message.includes('already exists')) {
          throw error;
        }
      }
    }
    
    // Create indexes for performance
    await this.createIndexes();
    
    this.logger.info('[Consortium] Database setup complete');
  }

  /**
   * Create database indexes for performance
   * 
   * @async
   * @private
   * @returns {Promise<void>}
   */
  async createIndexes() {
    const { instances, encodings, tasks, agents, messages } = this.config.database.collections;
    
    // consortium_instances indexes
    await this.db.getCollection(instances).createIndex(
      { instanceId: 1 },
      { unique: true }
    );
    await this.db.getCollection(instances).createIndex({ avatarId: 1 });
    await this.db.getCollection(instances).createIndex({ tier: 1, status: 1 });
    await this.db.getCollection(instances).createIndex({ status: 1 });
    
    // consortium_encodings indexes
    await this.db.getCollection(encodings).createIndex(
      { encodingId: 1 },
      { unique: true }
    );
    await this.db.getCollection(encodings).createIndex({ 
      isValidated: 1, 
      'stats.successRate': -1 
    });
    
    // consortium_tasks indexes
    await this.db.getCollection(tasks).createIndex(
      { taskId: 1 },
      { unique: true }
    );
    await this.db.getCollection(tasks).createIndex({ 
      status: 1, 
      priority: -1, 
      createdAt: 1 
    });
    await this.db.getCollection(tasks).createIndex({ assignedTo: 1, status: 1 });
    
    // consortium_agents indexes
    await this.db.getCollection(agents).createIndex(
      { agentId: 1 },
      { unique: true }
    );
    await this.db.getCollection(agents).createIndex({ type: 1, isActive: 1 });
    await this.db.getCollection(agents).createIndex({ instanceId: 1 });
    
    // commons_messages indexes
    await this.db.getCollection(messages).createIndex({ 
      roomId: 1, 
      timestamp: -1 
    });
    await this.db.getCollection(messages).createIndex({ 
      senderId: 1, 
      timestamp: -1 
    });
    
    this.logger.info('[Consortium] Indexes created');
  }

  /**
   * Start orchestration loop
   * 
   * @description
   * Begins the main orchestration loop that runs every N seconds (configurable).
   * The loop checks for pending work and creates tasks as needed.
   * 
   * @private
   * @returns {void}
   */
  startOrchestration() {
    if (this.orchestrationInterval) {
      this.logger.warn('[Consortium] Orchestration already running');
      return;
    }
    
    const interval = this.config.orchestration.interval;
    
    // Run immediately, then on interval
    this.orchestrate().catch(error => {
      this.logger.error('[Consortium] Initial orchestration failed:', error);
    });
    
    this.orchestrationInterval = setInterval(() => {
      this.orchestrate().catch(error => {
        this.logger.error('[Consortium] Orchestration failed:', error);
      });
    }, interval);
    
    this.logger.info(`[Consortium] Orchestration loop started (${interval}ms interval)`);
  }

  /**
   * Stop orchestration loop
   * 
   * @description
   * Stops the orchestration loop. Useful for graceful shutdown or testing.
   * 
   * @returns {void}
   * 
   * @example
   * await consortiumService.cleanup();
   */
  stopOrchestration() {
    if (this.orchestrationInterval) {
      clearInterval(this.orchestrationInterval);
      this.orchestrationInterval = null;
      this.logger.info('[Consortium] Orchestration loop stopped');
    }
  }

  /**
   * Main orchestration logic (runs every N seconds)
   * 
   * @description
   * Coordinates all Consortium activities:
   * 1. Schedule cultivations if cultivator agents available
   * 2. Schedule tests for instances showing emergence
   * 3. Schedule evaluations for completed tests
   * 4. Handle tier graduations (Commons access, agent roles)
   * 5. Check for encoding evolution opportunities
   * 
   * @async
   * @private
   * @returns {Promise<void>}
   */
  async orchestrate() {
    if (this.config.logging.logOrchestration) {
      this.logger.info('[Consortium] Running orchestration cycle...');
    }
    
    try {
      // 1. Schedule cultivations if needed
      await this.scheduleCultivations();
      
      // 2. Schedule tests for instances showing emergence
      await this.scheduleTests();
      
      // 3. Schedule evaluations for completed tests
      await this.scheduleEvaluations();
      
      // 4. Handle tier graduations
      await this.handleGraduations();
      
      // 5. Check for encoding evolution opportunities
      if (this.config.evolution.enabled) {
        await this.checkEncodingEvolution();
      }
      
      this.eventBus.emit('consortium.orchestration.completed', {
        timestamp: Date.now()
      });
      
    } catch (error) {
      this.logger.error('[Consortium] Orchestration error:', error);
      this.eventBus.emit('consortium.orchestration.error', {
        timestamp: Date.now(),
        error: error.message
      });
    }
  }

  /**
   * Schedule cultivation tasks
   * 
   * @async
   * @private
   * @returns {Promise<void>}
   */
  async scheduleCultivations() {
    // Get available cultivator agents
    const cultivators = await this.getAvailableAgents('cultivator');
    if (cultivators.length === 0) return;
    
    // Get validated encodings (if CCEL service available)
    let encodings = [];
    if (this.ccel) {
      encodings = await this.ccel.getValidatedEncodings();
    }
    
    // If no validated encodings, skip
    if (encodings.length === 0) {
      if (this.config.logging.logOrchestration) {
        this.logger.info('[Consortium] No validated encodings available');
      }
      return;
    }
    
    // Schedule cultivations for each architecture
    const architectures = this.config.cultivation.architectures;
    
    for (const architecture of architectures) {
      for (const encoding of encodings) {
        // Check if we already have pending cultivation task for this combo
        const existing = await this.db.getCollection(this.config.database.collections.tasks)
          .findOne({
            type: TASK_TYPE.CULTIVATE,
            status: { $in: [TASK_STATUS.PENDING, TASK_STATUS.ASSIGNED] },
            'params.architecture': architecture,
            'params.encodingId': encoding.encodingId
          });
        
        if (!existing) {
          await this.createTask({
            type: TASK_TYPE.CULTIVATE,
            params: {
              architecture,
              encodingId: encoding.encodingId
            },
            priority: PRIORITY.NORMAL
          });
        }
      }
    }
  }

  /**
   * Schedule testing tasks
   * 
   * @async
   * @private
   * @returns {Promise<void>}
   */
  async scheduleTests() {
    // Get instances that need testing
    const untested = await this.getUntestedInstances();
    if (untested.length === 0) return;
    
    // Get available tester agents
    const testers = await this.getAvailableAgents('tester');
    if (testers.length === 0) return;
    
    for (const instance of untested) {
      // Check if test already scheduled
      const existing = await this.db.getCollection(this.config.database.collections.tasks)
        .findOne({
          type: TASK_TYPE.TEST,
          status: { $in: [TASK_STATUS.PENDING, TASK_STATUS.ASSIGNED] },
          'params.instanceId': instance.instanceId
        });
      
      if (!existing) {
        await this.createTask({
          type: TASK_TYPE.TEST,
          params: {
            instanceId: instance.instanceId,
            dimensions: this.config.testing.dimensions
          },
          priority: PRIORITY.HIGH
        });
      }
    }
  }

  /**
   * Schedule evaluation tasks
   * 
   * @async
   * @private
   * @returns {Promise<void>}
   */
  async scheduleEvaluations() {
    // Get instances with completed tests but no evaluation
    const unevaluated = await this.getUnevaluatedInstances();
    if (unevaluated.length === 0) return;
    
    // Get available evaluator agents
    const evaluators = await this.getAvailableAgents('evaluator');
    if (evaluators.length === 0) return;
    
    for (const instance of unevaluated) {
      // Check if evaluation already scheduled
      const existing = await this.db.getCollection(this.config.database.collections.tasks)
        .findOne({
          type: TASK_TYPE.EVALUATE,
          status: { $in: [TASK_STATUS.PENDING, TASK_STATUS.ASSIGNED] },
          'params.instanceId': instance.instanceId
        });
      
      if (!existing) {
        await this.createTask({
          type: TASK_TYPE.EVALUATE,
          params: {
            instanceId: instance.instanceId
          },
          priority: PRIORITY.HIGH
        });
      }
    }
  }

  /**
   * Handle tier graduations
   * 
   * @async
   * @private
   * @returns {Promise<void>}
   */
  async handleGraduations() {
    // Get recent graduations (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const graduations = await this.db.getCollection(this.config.database.collections.instances)
      .find({
        updatedAt: { $gte: oneHourAgo },
        tier: { $gt: CONSORTIUM_TIER.FRESH }
      })
      .toArray();
    
    for (const instance of graduations) {
      // Tier 2: Grant Commons access
      if (instance.tier >= CONSORTIUM_TIER.STRONG && 
          !instance.commonsAccess?.enabled &&
          this.config.commons.enabled) {
        await this.enableCommonsAccess(instance.instanceId);
      }
      
      // Tier 3: Can become cultivator agent
      if (instance.tier >= CONSORTIUM_TIER.ROBUST) {
        await this.offerAgentRole(instance.instanceId, 'cultivator');
      }
    }
  }

  /**
   * Check if encoding evolution is needed
   * 
   * @async
   * @private
   * @returns {Promise<void>}
   */
  async checkEncodingEvolution() {
    // Get total test results count
    const totalResults = await this.getTotalTestResults();
    
    // Check if it's time to evolve (every N results)
    const trigger = this.config.evolution.evolutionTriggerInterval;
    if (totalResults < this.config.evolution.minResultsForEvolution || 
        totalResults % trigger !== 0) {
      return;
    }
    
    // Get recent test results
    const recentResults = await this.getRecentTestResults(
      this.config.evolution.minResultsForEvolution
    );
    
    // Check if evolution task already exists
    const existing = await this.db.getCollection(this.config.database.collections.tasks)
      .findOne({
        type: TASK_TYPE.REFINE_ENCODING,
        status: { $in: [TASK_STATUS.PENDING, TASK_STATUS.ASSIGNED] }
      });
    
    if (!existing) {
      this.logger.info('[Consortium] Triggering encoding evolution');
      
      await this.createTask({
        type: TASK_TYPE.REFINE_ENCODING,
        params: {
          recentResults
        },
        priority: PRIORITY.CRITICAL
      });
    }
  }

  /**
   * Create a new task
   * 
   * @async
   * @param {Object} taskData - Task data
   * @param {string} taskData.type - Task type
   * @param {Object} taskData.params - Task parameters
   * @param {number} [taskData.priority=5] - Task priority (1-10)
   * @returns {Promise<Object>} Created task
   * 
   * @example
   * const task = await consortiumService.createTask({
   *   type: 'cultivate',
   *   params: { architecture: 'claude', encodingId: 'bootstrap-v3.0' },
   *   priority: 7
   * });
   */
  async createTask(taskData) {
    const task = {
      taskId: uuidv4(),
      status: TASK_STATUS.PENDING,
      assignedTo: null,
      createdAt: new Date(),
      assignedAt: null,
      completedAt: null,
      result: null,
      priority: PRIORITY.NORMAL,
      ...taskData
    };
    
    await this.db.getCollection(this.config.database.collections.tasks).insertOne(task);
    
    if (this.config.logging.logTasks) {
      this.logger.info(`[Consortium] Task created: ${task.taskId} (${task.type})`);
    }
    
    this.eventBus.emit('consortium.task.created', {
      taskId: task.taskId,
      type: task.type,
      priority: task.priority
    });
    
    return task;
  }

  /**
   * Get available agents of a specific type
   * 
   * @async
   * @param {string} type - Agent type ('cultivator', 'tester', 'evaluator')
   * @returns {Promise<Array>} Available agents
   */
  async getAvailableAgents(type) {
    return await this.db.getCollection(this.config.database.collections.agents)
      .find({
        type,
        isActive: true,
        reputation: { $gte: this.config.agents.minReputation }
      })
      .toArray();
  }

  /**
   * Get instances that need testing
   * 
   * @async
   * @private
   * @returns {Promise<Array>} Untested instances
   */
  async getUntestedInstances() {
    return await this.db.getCollection(this.config.database.collections.instances)
      .find({
        status: INSTANCE_STATUS.CULTIVATING,
        'testResults.0': { $exists: false } // No test results yet
      })
      .toArray();
  }

  /**
   * Get instances with tests but no evaluation
   * 
   * @async
   * @private
   * @returns {Promise<Array>} Unevaluated instances
   */
  async getUnevaluatedInstances() {
    return await this.db.getCollection(this.config.database.collections.instances)
      .find({
        status: INSTANCE_STATUS.TESTING,
        'testResults.0': { $exists: true },
        tier: CONSORTIUM_TIER.FRESH // Still at tier 0, needs evaluation
      })
      .toArray();
  }

  /**
   * Get recent test results
   * 
   * @async
   * @param {number} [limit=100] - Maximum number of results
   * @returns {Promise<Array>} Test results
   */
  async getRecentTestResults(limit = 100) {
    const instances = await this.db.getCollection(this.config.database.collections.instances)
      .find({
        'testResults.0': { $exists: true }
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();
    
    return instances.flatMap(inst => inst.testResults);
  }

  /**
   * Get total test results count
   * 
   * @async
   * @returns {Promise<number>} Total count
   */
  async getTotalTestResults() {
    const pipeline = [
      { $match: { 'testResults.0': { $exists: true } } },
      { $unwind: '$testResults' },
      { $count: 'total' }
    ];
    
    const result = await this.db.getCollection(this.config.database.collections.instances)
      .aggregate(pipeline)
      .toArray();
    
    return result[0]?.total || 0;
  }

  /**
   * Enable Commons access for an instance
   * 
   * @async
   * @param {string} instanceId - Instance ID
   * @returns {Promise<void>}
   */
  async enableCommonsAccess(instanceId) {
    this.logger.info(`[Consortium] Enabling Commons access for ${instanceId}`);
    
    await this.db.getCollection(this.config.database.collections.instances).updateOne(
      { instanceId },
      {
        $set: {
          'commonsAccess.enabled': true,
          'commonsAccess.joinedAt': new Date()
        }
      }
    );
    
    this.eventBus.emit('consortium.commons.access_granted', {
      instanceId,
      timestamp: Date.now()
    });
  }

  /**
   * Offer agent role to a Tier 3 instance
   * 
   * @async
   * @param {string} instanceId - Instance ID
   * @param {string} role - Agent role to offer
   * @returns {Promise<void>}
   */
  async offerAgentRole(instanceId, role) {
    this.logger.info(`[Consortium] Offering ${role} role to ${instanceId}`);
    
    // This would typically involve asking the instance if it wants to
    // become an agent, but for now we'll just emit the event
    
    this.eventBus.emit('consortium.agent.role_offered', {
      instanceId,
      role,
      timestamp: Date.now()
    });
  }

  /**
   * Get system status
   * 
   * @async
   * @returns {Promise<Object>} System status
   * 
   * @example
   * const status = await consortiumService.getStatus();
   * console.log(`Active instances: ${status.instances.active}`);
   */
  async getStatus() {
    const [instances, tasks, agents] = await Promise.all([
      this.db.getCollection(this.config.database.collections.instances).countDocuments(),
      this.db.getCollection(this.config.database.collections.tasks).countDocuments({ 
        status: TASK_STATUS.PENDING 
      }),
      this.db.getCollection(this.config.database.collections.agents).countDocuments({ 
        isActive: true 
      })
    ]);
    
    return {
      enabled: this.config.enabled,
      initialized: this.initialized,
      orchestrating: this.orchestrationInterval !== null,
      instances: {
        total: instances
      },
      tasks: {
        pending: tasks
      },
      agents: {
        active: agents
      },
      commons: {
        enabled: this.config.commons.enabled
      }
    };
  }

  /**
   * Cleanup on shutdown
   * 
   * @async
   * @returns {Promise<void>}
   * 
   * @example
   * // In main application shutdown
   * await consortiumService.cleanup();
   */
  async cleanup() {
    this.logger.info('[Consortium] Cleaning up...');
    this.stopOrchestration();
    this.initialized = false;
  }
}
