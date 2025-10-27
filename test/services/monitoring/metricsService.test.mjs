/**
 * @fileoverview Tests for MetricsService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MetricsService } from '../../../src/services/monitoring/metricsService.mjs';

describe('MetricsService', () => {
  let metricsService;
  let mockLogger;
  let mockDatabaseService;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };

    mockDatabaseService = {
      getDatabase: vi.fn().mockResolvedValue({
        collection: vi.fn().mockReturnValue({
          insertOne: vi.fn().mockResolvedValue({}),
          deleteMany: vi.fn().mockResolvedValue({}),
          find: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue([])
          })
        })
      })
    };

    metricsService = new MetricsService({
      logger: mockLogger,
      databaseService: mockDatabaseService
    });
  });

  afterEach(async () => {
    if (metricsService) {
      await metricsService.cleanup();
    }
  });

  describe('increment', () => {
    it('should increment a counter metric', () => {
      metricsService.increment('testService', 'requests');
      metricsService.increment('testService', 'requests');
      metricsService.increment('testService', 'requests', 3);

      const metrics = metricsService.getServiceMetrics('testService');
      expect(metrics.requests).toBe(5);
    });

    it('should create metric if it does not exist', () => {
      metricsService.increment('newService', 'newMetric');
      
      const metrics = metricsService.getServiceMetrics('newService');
      expect(metrics.newMetric).toBe(1);
    });
  });

  describe('gauge', () => {
    it('should set gauge value', () => {
      metricsService.gauge('testService', 'temperature', 75);
      
      const metrics = metricsService.getServiceMetrics('testService');
      expect(metrics.temperature).toBe(75);
    });

    it('should overwrite previous gauge value', () => {
      metricsService.gauge('testService', 'memory', 100);
      metricsService.gauge('testService', 'memory', 150);
      
      const metrics = metricsService.getServiceMetrics('testService');
      expect(metrics.memory).toBe(150);
    });
  });

  describe('timing', () => {
    it('should record timing metrics', () => {
      metricsService.timing('testService', 'request_duration', 100);
      metricsService.timing('testService', 'request_duration', 200);
      metricsService.timing('testService', 'request_duration', 150);

      const metrics = metricsService.getServiceMetrics('testService');
      expect(metrics.request_duration.count).toBe(3);
      expect(metrics.request_duration.min).toBe(100);
      expect(metrics.request_duration.max).toBe(200);
      expect(metrics.request_duration.avg).toBe(150);
    });

    it('should calculate percentiles', () => {
      // Add 100 values from 1 to 100
      for (let i = 1; i <= 100; i++) {
        metricsService.timing('testService', 'latency', i);
      }

      const metrics = metricsService.getServiceMetrics('testService');
      expect(metrics.latency.p95).toBeGreaterThan(90);
      expect(metrics.latency.p99).toBeGreaterThan(95);
    });
  });

  describe('startTimer', () => {
    it('should measure operation duration', async () => {
      const endTimer = metricsService.startTimer('testService', 'operation');
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const duration = endTimer();
      
      expect(duration).toBeGreaterThanOrEqual(50);
      
      const metrics = metricsService.getServiceMetrics('testService');
      expect(metrics.operation.count).toBe(1);
    });
  });

  describe('recordHealth', () => {
    it('should record service health status', () => {
      metricsService.recordHealth('testService', {
        status: 'healthy',
        message: 'All systems operational'
      });

      const health = metricsService.getHealthStatus();
      expect(health.services.testService.status).toBe('healthy');
      expect(health.services.testService.message).toBe('All systems operational');
    });

    it('should update overall health based on service status', () => {
      metricsService.recordHealth('service1', { status: 'healthy' });
      metricsService.recordHealth('service2', { status: 'degraded' });

      const health = metricsService.getHealthStatus();
      expect(health.status).toBe('degraded');
    });

    it('should mark system unhealthy if any service is unhealthy', () => {
      metricsService.recordHealth('service1', { status: 'healthy' });
      metricsService.recordHealth('service2', { status: 'unhealthy' });

      const health = metricsService.getHealthStatus();
      expect(health.status).toBe('unhealthy');
    });
  });

  describe('getAllMetrics', () => {
    it('should return all metrics grouped by service', () => {
      metricsService.increment('service1', 'requests', 10);
      metricsService.increment('service2', 'requests', 20);
      metricsService.gauge('service1', 'memory', 512);

      const allMetrics = metricsService.getAllMetrics();
      
      expect(allMetrics.services.service1.requests).toBe(10);
      expect(allMetrics.services.service1.memory).toBe(512);
      expect(allMetrics.services.service2.requests).toBe(20);
      expect(allMetrics.uptime).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    it('should clear all metrics', () => {
      metricsService.increment('testService', 'requests', 100);
      metricsService.gauge('testService', 'memory', 512);
      
      metricsService.reset();
      
      const metrics = metricsService.getServiceMetrics('testService');
      expect(Object.keys(metrics).length).toBe(0);
    });
  });

  describe('persistence', () => {
    it('should persist metrics to database', async () => {
      await metricsService.initialize();
      
      metricsService.increment('testService', 'requests', 5);
      
      await metricsService.persistMetrics();
      
      expect(mockDatabaseService.getDatabase).toHaveBeenCalled();
    });
  });
});
