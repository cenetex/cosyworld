/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file baseAgent.mjs
 * @description Base class for all Consortium agents
 * @module consortium/agents
 * 
 * @context
 * Abstract base class that all Consortium agents extend. Provides common
 * functionality for task execution, communication, and state management.
 * Agent types (Cultivator, Tester, Evaluator) implement the execute() method
 * with their specific logic.
 * 
 * @architecture
 * - Pattern: Template Method pattern
 * - Abstract method: execute() must be implemented by subclasses
 * - Common functionality: Task management, logging, events
 * 
 * @since 0.0.12
 */

export class BaseAgent {
  /**
   * @param {Object} deps - Dependencies
   * @param {string} deps.agentId - Agent ID
   * @param {string} deps.instanceId - Instance ID acting as agent
   * @param {Object} deps.logger - Logger service
   * @param {Object} deps.db - Database service
   * @param {Object} deps.aiService - AI service
   * @param {Object} deps.eventBus - Event bus
   */
  constructor({ agentId, instanceId, logger, db, aiService, eventBus }) {
    this.agentId = agentId;
    this.instanceId = instanceId;
    this.logger = logger;
    this.db = db;
    this.aiService = aiService;
    this.eventBus = eventBus;
  }

  /**
   * Execute a task (must be implemented by subclasses)
   * 
   * @abstract
   * @async
   * @param {Object} _task - Task to execute
   * @returns {Promise<Object>} Task result
   * @throws {Error} If not implemented
   */
  async execute(_task) {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Log agent action
   * 
   * @protected
   * @param {string} message - Log message
   * @param {Object} [data] - Additional data
   */
  log(message, data = {}) {
    this.logger.info(`[Agent:${this.agentId}] ${message}`, data);
  }

  /**
   * Emit agent event
   * 
   * @protected
   * @param {string} eventName - Event name
   * @param {Object} data - Event data
   */
  emit(eventName, data = {}) {
    this.eventBus.emit(eventName, {
      agentId: this.agentId,
      instanceId: this.instanceId,
      timestamp: Date.now(),
      ...data
    });
  }
}
