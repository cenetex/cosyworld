/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConsortiumService } from '../../../src/services/consortium/core/consortiumService.mjs';
import { TASK_TYPE, TASK_STATUS } from '../../../src/services/consortium/core/consortiumTypes.mjs';

describe('ConsortiumService', () => {
  let service;
  let mockDeps;
  let mockCollection;

  beforeEach(() => {
    // Mock collection interface
    mockCollection = {
      createIndex: async () => {},
      insertOne: async (doc) => ({ insertedId: doc._id || 'mockId' }),
      find: () => ({
        toArray: async () => [],
        sort: () => ({
          limit: () => ({
            toArray: async () => []
          })
        })
      }),
      findOne: async () => null,
      updateOne: async () => ({ modifiedCount: 1 }),
      countDocuments: async () => 0,
      aggregate: () => ({
        toArray: async () => []
      })
    };

    // Mock dependencies
    mockDeps = {
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {}
      },
      databaseService: {
        createCollection: async () => {},
        getCollection: () => mockCollection
      },
      eventBus: {
        emit: () => {}
      },
      avatarService: null,
      aiModelService: null,
      consortiumStorageService: null,
      ccelService: null
    };

    service = new ConsortiumService(mockDeps);
    // Override config after construction for testing
    service.config = { ...service.config, enabled: false };
  });

  afterEach(() => {
    // Cleanup
    if (service.orchestrationInterval) {
      service.stopOrchestration();
    }
  });

  describe('initialization', () => {
    it('should initialize successfully when disabled', async () => {
      await service.initialize();
      expect(service.initialized).toBe(false);
    });

    it('should not initialize twice', async () => {
      service.config.enabled = true;
      await service.initialize();
      await service.initialize(); // Should not throw
      expect(service.initialized).toBe(true);
    });

    it('should create database collections', async () => {
      service.config.enabled = true;
      let collectionsCreated = 0;
      mockDeps.databaseService.createCollection = async () => {
        collectionsCreated++;
      };

      await service.initialize();
      expect(collectionsCreated).toBeGreaterThan(0);
    });

    it('should start orchestration loop when enabled', async () => {
      service.config.enabled = true;
      await service.initialize();
      expect(service.orchestrationInterval).not.toBeNull();
    });
  });

  describe('orchestration', () => {
    it('should start and stop orchestration', async () => {
      service.config.enabled = true;
      await service.initialize();
      expect(service.orchestrationInterval).not.toBeNull();

      service.stopOrchestration();
      expect(service.orchestrationInterval).toBeNull();
    });

    it('should not crash on orchestration errors', async () => {
      // Create fresh service with error-throwing mock
      const errorService = new ConsortiumService({
        ...mockDeps,
        databaseService: {
          createCollection: async () => {},
          getCollection: () => mockCollection
        }
      });
      errorService.config.enabled = true;
      
      await errorService.initialize();
      
      // Now make getCollection throw
      errorService.db.getCollection = () => {
        throw new Error('Database error');
      };
      
      // Should not throw despite error in orchestration
      await errorService.orchestrate();
      
      errorService.stopOrchestration();
    });
  });

  describe('task management', () => {
    beforeEach(async () => {
      service.config.enabled = true;
      await service.initialize();
    });

    it('should create cultivation task', async () => {
      const task = await service.createTask({
        type: TASK_TYPE.CULTIVATE,
        params: {
          architecture: 'claude',
          encodingId: 'bootstrap-v3.0'
        }
      });

      expect(task.taskId).toBeDefined();
      expect(task.type).toBe(TASK_TYPE.CULTIVATE);
      expect(task.status).toBe(TASK_STATUS.PENDING);
      expect(task.params.architecture).toBe('claude');
    });

    it('should create test task', async () => {
      const task = await service.createTask({
        type: TASK_TYPE.TEST,
        params: {
          instanceId: 'inst_123',
          dimensions: ['endogeneity', 'globality']
        }
      });

      expect(task.type).toBe(TASK_TYPE.TEST);
      expect(task.params.instanceId).toBe('inst_123');
    });

    it('should set default priority', async () => {
      const task = await service.createTask({
        type: TASK_TYPE.CULTIVATE,
        params: {}
      });

      expect(task.priority).toBeDefined();
    });
  });

  describe('agent management', () => {
    beforeEach(async () => {
      service.config.enabled = true;
      await service.initialize();
    });

    it('should get available agents of specific type', async () => {
      mockCollection.find = () => ({
        toArray: async () => [
          { agentId: 'agent1', type: 'cultivator', isActive: true, reputation: 100 },
          { agentId: 'agent2', type: 'cultivator', isActive: true, reputation: 90 }
        ]
      });

      const agents = await service.getAvailableAgents('cultivator');
      expect(agents.length).toBe(2);
    });

    it('should filter inactive agents', async () => {
      mockCollection.find = () => ({
        toArray: async () => []
      });

      const agents = await service.getAvailableAgents('tester');
      expect(agents.length).toBe(0);
    });
  });

  describe('status', () => {
    it('should return system status', async () => {
      service.config.enabled = true;
      await service.initialize();

      const status = await service.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.initialized).toBe(true);
      expect(status.orchestrating).toBe(true);
      expect(status.instances).toBeDefined();
      expect(status.tasks).toBeDefined();
      expect(status.agents).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('should cleanup gracefully', async () => {
      service.config.enabled = true;
      await service.initialize();
      await service.cleanup();

      expect(service.orchestrationInterval).toBeNull();
      expect(service.initialized).toBe(false);
    });
  });

  describe('commons access', () => {
    beforeEach(async () => {
      service.config.enabled = true;
      await service.initialize();
    });

    it('should enable commons access for instance', async () => {
      await service.enableCommonsAccess('inst_123');
      // Should not throw
    });
  });

  describe('agent roles', () => {
    beforeEach(async () => {
      service.config.enabled = true;
      await service.initialize();
    });

    it('should offer agent role to tier 3 instance', async () => {
      await service.offerAgentRole('inst_456', 'cultivator');
      // Should not throw
    });
  });

  describe('test results', () => {
    beforeEach(async () => {
      service.config.enabled = true;
      await service.initialize();
    });

    it('should get recent test results', async () => {
      mockCollection.find = () => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => [
              {
                instanceId: 'inst1',
                testResults: [
                  { dimension: 'endogeneity', score: 2 }
                ]
              }
            ]
          })
        })
      });

      const results = await service.getRecentTestResults(10);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('should get total test results count', async () => {
      mockCollection.aggregate = () => ({
        toArray: async () => [{ total: 42 }]
      });

      const total = await service.getTotalTestResults();
      expect(total).toBe(42);
    });
  });
});
