/**
 * @fileoverview Tests for health check endpoints
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import healthRoutes from '@/services/web/server/routes/health.js';

describe('Health Routes', () => {
  let app;
  let mockDb;
  let mockServices;

  beforeEach(() => {
    app = express();
    
    mockDb = {
      command: vi.fn().mockResolvedValue({ ok: 1 }),
    };

    mockServices = {
      metricsService: {
        getAllMetrics: vi.fn().mockReturnValue({
          uptime: 123,
          services: { test: { requests: 10 } },
        }),
        getServiceMetrics: vi.fn().mockReturnValue({ requests: 10 }),
        getHistoricalMetrics: vi.fn().mockResolvedValue([]),
        getHealthStatus: vi.fn().mockReturnValue({
          status: 'healthy',
          services: {},
        }),
      },
      unifiedAIService: {
        activeProvider: 'openrouter',
      },
      xService: {
        healthCheck: vi.fn().mockResolvedValue({
          service: 'xService',
          status: 'healthy',
        }),
      },
      telegramService: {
        healthCheck: vi.fn().mockResolvedValue({
          service: 'telegramService',
          status: 'healthy',
        }),
      },
    };

    app.use('/api/health', healthRoutes(mockDb, mockServices));
  });

  describe('GET /api/health/live', () => {
    it('should return 200 with liveness status', async () => {
      const response = await request(app).get('/api/health/live');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(typeof response.body.uptime).toBe('number');
    });

    it('should always return ok (liveness never fails)', async () => {
      // Even if services are down, liveness should pass
      mockDb.command.mockRejectedValue(new Error('DB down'));
      
      const response = await request(app).get('/api/health/live');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });

  describe('GET /api/health/ready', () => {
    it('should return 200 when all services are healthy', async () => {
      const response = await request(app).get('/api/health/ready');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ready');
      expect(response.body.checks.database.healthy).toBe(true);
      expect(response.body.checks.ai.healthy).toBe(true);
      expect(response.body).toHaveProperty('responseTime');
    });

    it('should return 503 when database is down', async () => {
      mockDb.command.mockRejectedValue(new Error('Connection refused'));

      const response = await request(app).get('/api/health/ready');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not_ready');
      expect(response.body.checks.database.healthy).toBe(false);
      expect(response.body.checks.database.error).toBe('Connection refused');
    });

    it('should return 503 when AI service is missing', async () => {
      mockServices.unifiedAIService = null;

      const response = await request(app).get('/api/health/ready');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not_ready');
      expect(response.body.checks.ai.healthy).toBe(false);
    });

    it('should measure database latency', async () => {
      const response = await request(app).get('/api/health/ready');

      expect(response.status).toBe(200);
      expect(response.body.checks.database.latency).toBeGreaterThanOrEqual(0);
      expect(typeof response.body.checks.database.latency).toBe('number');
    });

    it('should include AI provider information', async () => {
      const response = await request(app).get('/api/health/ready');

      expect(response.status).toBe(200);
      expect(response.body.checks.ai.provider).toBe('openrouter');
    });
  });

  describe('GET /api/health (legacy endpoint)', () => {
    it('should return 200 with connected database', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.database).toBe('connected');
    });

    it('should return 503 when database is not available', async () => {
      app.use('/api/health2', healthRoutes(null, mockServices));
      
      const response = await request(app).get('/api/health2');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('error');
    });

    it('should return 200 even if database command fails (legacy behavior)', async () => {
      // Legacy endpoint only checks if db exists, not if it's actually working
      mockDb.command.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });

  describe('GET /api/health/status', () => {
    it('should return comprehensive health status', async () => {
      const response = await request(app).get('/api/health/status');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.services).toHaveProperty('database');
      expect(response.body.services).toHaveProperty('xService');
      expect(response.body.services).toHaveProperty('telegramService');
    });

    it('should call service health checks', async () => {
      await request(app).get('/api/health/status');

      expect(mockServices.xService.healthCheck).toHaveBeenCalled();
      expect(mockServices.telegramService.healthCheck).toHaveBeenCalled();
    });

    it('should return 503 when database is unhealthy', async () => {
      mockDb.command.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/health/status');

      expect(response.status).toBe(503);
      expect(response.body.services.database.status).toBe('unhealthy');
      expect(response.body.status).toBe('unhealthy');
    });
  });

  describe('GET /api/health/metrics', () => {
    it('should return all metrics', async () => {
      const response = await request(app).get('/api/health/metrics');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('services');
      expect(mockServices.metricsService.getAllMetrics).toHaveBeenCalled();
    });

    it('should return 503 when metrics service is unavailable', async () => {
      const appNoMetrics = express();
      appNoMetrics.use('/api/health', healthRoutes(mockDb, {}));

      const response = await request(appNoMetrics).get('/api/health/metrics');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Metrics service not available');
    });
  });

  describe('GET /api/health/metrics/:service', () => {
    it('should return metrics for specific service', async () => {
      const response = await request(app).get('/api/health/metrics/testService');

      expect(response.status).toBe(200);
      expect(response.body.service).toBe('testService');
      expect(response.body.metrics).toHaveProperty('requests');
      expect(mockServices.metricsService.getServiceMetrics).toHaveBeenCalledWith('testService');
    });
  });

  describe('GET /api/health/history', () => {
    it('should return historical metrics with default duration', async () => {
      const response = await request(app).get('/api/health/history');

      expect(response.status).toBe(200);
      expect(response.body.duration).toBe(3600000); // 1 hour default
      expect(response.body).toHaveProperty('snapshots');
      expect(mockServices.metricsService.getHistoricalMetrics).toHaveBeenCalledWith(3600000);
    });

    it('should accept custom duration parameter', async () => {
      const response = await request(app).get('/api/health/history?duration=1800000');

      expect(response.status).toBe(200);
      expect(response.body.duration).toBe(1800000);
      expect(mockServices.metricsService.getHistoricalMetrics).toHaveBeenCalledWith(1800000);
    });
  });
});
