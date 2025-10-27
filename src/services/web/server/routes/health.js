/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */


import { Router } from 'express';

export default function healthRoutes(db, services = {}) {
  const router = Router();

  /**
   * Basic health check
   * GET /api/health
   */
  router.get('/', async (req, res) => {
    try {
      if (!db) {
        console.error('Health check failed: Database not connected');
        return res.status(503).json({
          status: 'error',
          message: 'Database not connected',
        });
      }
      res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
      console.error('Health check error:', err);
      res.status(503).json({
        status: 'error',
        message: err.message || 'Database not connected',
      });
    }
  });

  /**
   * Detailed health status with metrics
   * GET /api/health/status
   */
  router.get('/status', async (req, res) => {
    try {
      const { metricsService, xService, telegramService } = services;
      
      // Get overall health status
      const health = metricsService?.getHealthStatus() || {
        status: 'unknown',
        services: {}
      };
      
      // Get service-specific health checks
      if (xService?.healthCheck) {
        health.services.xService = await xService.healthCheck();
      }
      
      if (telegramService?.healthCheck) {
        health.services.telegramService = await telegramService.healthCheck();
      }
      
      // Database check
      try {
        await db.command({ ping: 1 });
        health.services.database = {
          service: 'database',
          status: 'healthy'
        };
      } catch (dbErr) {
        health.services.database = {
          service: 'database',
          status: 'unhealthy',
          error: dbErr.message
        };
        health.status = 'unhealthy';
      }
      
      // Set HTTP status based on overall health
      const statusCode = health.status === 'healthy' ? 200 
        : health.status === 'degraded' ? 200 
        : 503;
      
      res.status(statusCode).json(health);
    } catch (err) {
      console.error('Health status check error:', err);
      res.status(503).json({
        status: 'error',
        message: err.message || 'Health check failed',
      });
    }
  });

  /**
   * Get metrics for all services
   * GET /api/health/metrics
   */
  router.get('/metrics', async (req, res) => {
    try {
      const { metricsService } = services;
      
      if (!metricsService) {
        return res.status(503).json({
          error: 'Metrics service not available'
        });
      }
      
      const metrics = metricsService.getAllMetrics();
      res.json(metrics);
    } catch (err) {
      console.error('Metrics fetch error:', err);
      res.status(500).json({
        error: err.message || 'Failed to fetch metrics'
      });
    }
  });

  /**
   * Get metrics for a specific service
   * GET /api/health/metrics/:service
   */
  router.get('/metrics/:service', async (req, res) => {
    try {
      const { metricsService } = services;
      const { service } = req.params;
      
      if (!metricsService) {
        return res.status(503).json({
          error: 'Metrics service not available'
        });
      }
      
      const metrics = metricsService.getServiceMetrics(service);
      res.json({
        service,
        metrics
      });
    } catch (err) {
      console.error('Service metrics fetch error:', err);
      res.status(500).json({
        error: err.message || 'Failed to fetch service metrics'
      });
    }
  });

  /**
   * Get historical metrics
   * GET /api/health/history?duration=3600000
   */
  router.get('/history', async (req, res) => {
    try {
      const { metricsService } = services;
      const duration = parseInt(req.query.duration) || 3600000; // Default 1 hour
      
      if (!metricsService) {
        return res.status(503).json({
          error: 'Metrics service not available'
        });
      }
      
      const history = await metricsService.getHistoricalMetrics(duration);
      res.json({
        duration,
        snapshots: history
      });
    } catch (err) {
      console.error('Historical metrics fetch error:', err);
      res.status(500).json({
        error: err.message || 'Failed to fetch historical metrics'
      });
    }
  });

  return router;
}
