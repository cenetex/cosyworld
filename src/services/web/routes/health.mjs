/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file health.mjs
 * @description Health check endpoints for monitoring and load balancers
 * 
 * Endpoints:
 * - GET /health/live - Liveness probe (is app running?)
 * - GET /health/ready - Readiness probe (can app serve traffic?)
 * - GET /health/status - Detailed metrics for ops dashboards
 */

/**
 * Setup health check routes
 * @param {Object} app - Express application
 * @param {Object} container - Awilix DI container
 */
export function setupHealthRoutes(app, container) {
  /**
   * Liveness probe - Simple check that the application is running
   * Used by Kubernetes/Docker to know if the container is alive
   * 
   * @route GET /health/live
   * @returns {Object} 200 - App is alive
   */
  app.get('/health/live', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  /**
   * Readiness probe - Check if app can serve traffic
   * Used by load balancers to determine if traffic should be routed
   * 
   * @route GET /health/ready
   * @returns {Object} 200 - App is ready to serve traffic
   * @returns {Object} 503 - App is not ready (dependencies unavailable)
   */
  app.get('/health/ready', async (req, res) => {
    const checks = {
      database: { healthy: false, latency: null },
      ai: { healthy: false, provider: null },
      cache: { healthy: false, optional: true },
    };

    const startTime = Date.now();

    try {
      // Check database connection
      try {
        const dbStartTime = Date.now();
        const databaseService = container.resolve('databaseService');
        const db = databaseService.getDatabase();
        await db.admin().ping();
        checks.database.healthy = true;
        checks.database.latency = Date.now() - dbStartTime;
      } catch (error) {
        checks.database.error = error.message;
      }

      // Check AI service availability
      try {
        const aiService = container.resolve('unifiedAIService');
        checks.ai.healthy = !!aiService;
        checks.ai.provider = aiService?.activeProvider || 'unknown';
      } catch (error) {
        checks.ai.error = error.message;
      }

      // Check cache/Redis (optional - won't fail readiness)
      try {
        const cacheService = container.resolve('cacheService');
        if (cacheService?.redis) {
          await cacheService.redis.ping();
          checks.cache.healthy = true;
        }
      } catch (error) {
        // Cache is optional, log but don't fail readiness
        checks.cache.error = error.message;
      }

      // App is ready if critical services (DB and AI) are healthy
      const healthy = checks.database.healthy && checks.ai.healthy;
      const statusCode = healthy ? 200 : 503;

      res.status(statusCode).json({
        status: healthy ? 'ready' : 'not_ready',
        checks,
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      res.status(503).json({
        status: 'error',
        error: error.message,
        checks,
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime,
      });
    }
  });

  /**
   * Detailed status endpoint - Comprehensive metrics for operations dashboards
   * Includes memory usage, uptime, service metrics, and system info
   * 
   * @route GET /health/status
   * @returns {Object} 200 - Detailed status information
   */
  app.get('/health/status', async (req, res) => {
    const startTime = Date.now();

    try {
      const metrics = container.resolve('metricsService');
      const allMetrics = metrics.getAllMetrics();

      // Get environment info (sanitized - no secrets)
      const environment = {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        env: process.env.NODE_ENV || 'development',
      };

      // Memory and CPU info
      const memory = process.memoryUsage();
      const memoryFormatted = {
        rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(memory.external / 1024 / 1024)}MB`,
      };

      // Service status
      const services = {
        database: { status: 'unknown' },
        ai: { status: 'unknown' },
        discord: { status: 'unknown' },
        twitter: { status: 'unknown' },
      };

      try {
        const databaseService = container.resolve('databaseService');
        services.database.status = databaseService ? 'connected' : 'disconnected';
      } catch {}

      try {
        const aiService = container.resolve('unifiedAIService');
        services.ai.status = aiService ? 'available' : 'unavailable';
        services.ai.provider = aiService?.activeProvider;
      } catch {}

      try {
        const discordService = container.resolve('discordService');
        services.discord.status = discordService?.client?.isReady() ? 'connected' : 'disconnected';
      } catch {}

      try {
        const xService = container.resolve('xService');
        services.twitter.status = xService ? 'configured' : 'not_configured';
      } catch {}

      res.json({
        status: 'ok',
        version: process.env.npm_package_version || '0.0.11',
        uptime: Math.round(process.uptime()),
        uptimeFormatted: formatUptime(process.uptime()),
        timestamp: new Date().toISOString(),
        environment,
        memory: memoryFormatted,
        services,
        metrics: allMetrics,
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime,
      });
    }
  });
}

/**
 * Format uptime in human-readable format
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime (e.g., "2d 5h 30m")
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  
  return parts.join(' ') || '0m';
}
