/**
 * @fileoverview Metrics collection and aggregation service for monitoring system health
 * @module services/monitoring/metricsService
 */

/**
 * MetricsService - Centralized metrics collection and reporting
 * 
 * Provides a unified interface for collecting, aggregating, and querying metrics
 * across all services. Supports counters, gauges, histograms, and timers.
 * 
 * @class
 */
export class MetricsService {
  /**
   * Creates a new MetricsService instance
   * @param {Object} params - Constructor parameters
   * @param {Object} params.logger - Logger instance
   * @param {Object} params.databaseService - Database service for persistence
   */
  constructor({ logger, databaseService }) {
    this.logger = logger;
    this.databaseService = databaseService;
    
    // In-memory metrics storage
    this.metrics = new Map();
    
    // Service health status
    this.serviceHealth = new Map();
    
    // Start time for uptime tracking
    this.startTime = Date.now();
    
    this.logger?.info?.('[MetricsService] Initialized');
  }

  /**
   * Initialize the metrics service
   */
  async initialize() {
    this.logger?.info?.('[MetricsService] Starting initialization');
    
    // Set up periodic persistence (every 60 seconds)
    this.persistInterval = setInterval(() => {
      this.persistMetrics().catch(err => 
        this.logger?.error?.('[MetricsService] Failed to persist metrics:', err)
      );
    }, 60000);
    
    this.logger?.info?.('[MetricsService] Initialized successfully');
  }

  /**
   * Increment a counter metric
   * @param {string} service - Service name (e.g., 'xService', 'telegramService')
   * @param {string} metric - Metric name (e.g., 'posts_successful', 'errors')
   * @param {number} [value=1] - Amount to increment by
   */
  increment(service, metric, value = 1) {
    const key = `${service}.${metric}`;
    const current = this.metrics.get(key) || { type: 'counter', value: 0, lastUpdated: Date.now() };
    current.value += value;
    current.lastUpdated = Date.now();
    this.metrics.set(key, current);
  }

  /**
   * Set a gauge metric (absolute value)
   * @param {string} service - Service name
   * @param {string} metric - Metric name
   * @param {number} value - Current value
   */
  gauge(service, metric, value) {
    const key = `${service}.${metric}`;
    this.metrics.set(key, {
      type: 'gauge',
      value,
      lastUpdated: Date.now()
    });
  }

  /**
   * Record a timing metric (for histograms)
   * @param {string} service - Service name
   * @param {string} metric - Metric name
   * @param {number} durationMs - Duration in milliseconds
   */
  timing(service, metric, durationMs) {
    const key = `${service}.${metric}`;
    const current = this.metrics.get(key) || {
      type: 'histogram',
      values: [],
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
      lastUpdated: Date.now()
    };
    
    current.values.push(durationMs);
    current.count++;
    current.sum += durationMs;
    current.min = Math.min(current.min, durationMs);
    current.max = Math.max(current.max, durationMs);
    current.lastUpdated = Date.now();
    
    // Keep only last 100 values to prevent memory growth
    if (current.values.length > 100) {
      current.values = current.values.slice(-100);
    }
    
    this.metrics.set(key, current);
  }

  /**
   * Create a timer for measuring operation duration
   * @param {string} service - Service name
   * @param {string} metric - Metric name
   * @returns {Function} Function to call when operation completes
   */
  startTimer(service, metric) {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.timing(service, metric, duration);
      return duration;
    };
  }

  /**
   * Record service health status
   * @param {string} service - Service name
   * @param {Object} health - Health information
   * @param {string} health.status - 'healthy' | 'degraded' | 'unhealthy'
   * @param {string} [health.message] - Status message
   * @param {Object} [health.details] - Additional details
   */
  recordHealth(service, health) {
    this.serviceHealth.set(service, {
      ...health,
      timestamp: Date.now()
    });
  }

  /**
   * Get metrics for a specific service
   * @param {string} service - Service name
   * @returns {Object} Service metrics
   */
  getServiceMetrics(service) {
    const metrics = {};
    const prefix = `${service}.`;
    
    for (const [key, value] of this.metrics.entries()) {
      if (key.startsWith(prefix)) {
        const metricName = key.substring(prefix.length);
        
        if (value.type === 'histogram') {
          metrics[metricName] = {
            count: value.count,
            sum: value.sum,
            min: value.min === Infinity ? 0 : value.min,
            max: value.max === -Infinity ? 0 : value.max,
            avg: value.count > 0 ? value.sum / value.count : 0,
            p95: this._calculatePercentile(value.values, 0.95),
            p99: this._calculatePercentile(value.values, 0.99)
          };
        } else {
          metrics[metricName] = value.value;
        }
      }
    }
    
    return metrics;
  }

  /**
   * Get all metrics grouped by service
   * @returns {Object} All metrics
   */
  getAllMetrics() {
    const result = {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      services: {}
    };
    
    // Group metrics by service
    for (const [key, value] of this.metrics.entries()) {
      const [service, metric] = key.split('.');
      if (!result.services[service]) {
        result.services[service] = {};
      }
      
      if (value.type === 'histogram') {
        result.services[service][metric] = {
          count: value.count,
          avg: value.count > 0 ? value.sum / value.count : 0,
          min: value.min === Infinity ? 0 : value.min,
          max: value.max === -Infinity ? 0 : value.max,
          p95: this._calculatePercentile(value.values, 0.95),
          p99: this._calculatePercentile(value.values, 0.99)
        };
      } else {
        result.services[service][metric] = value.value;
      }
    }
    
    return result;
  }

  /**
   * Get health status for all services
   * @returns {Object} Health status
   */
  getHealthStatus() {
    const health = {
      status: 'healthy',
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      services: {}
    };
    
    let hasUnhealthy = false;
    let hasDegraded = false;
    
    for (const [service, status] of this.serviceHealth.entries()) {
      health.services[service] = status;
      
      if (status.status === 'unhealthy') {
        hasUnhealthy = true;
      } else if (status.status === 'degraded') {
        hasDegraded = true;
      }
    }
    
    // Overall system health
    if (hasUnhealthy) {
      health.status = 'unhealthy';
    } else if (hasDegraded) {
      health.status = 'degraded';
    }
    
    return health;
  }

  /**
   * Calculate percentile from an array of values
   * @private
   * @param {number[]} values - Array of values
   * @param {number} percentile - Percentile (0-1)
   * @returns {number} Percentile value
   */
  _calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Persist metrics to database
   * @private
   */
  async persistMetrics() {
    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection('metrics_snapshots');
      
      const snapshot = {
        timestamp: Date.now(),
        uptime: Date.now() - this.startTime,
        metrics: this.getAllMetrics(),
        health: this.getHealthStatus()
      };
      
      await collection.insertOne(snapshot);
      
      // Clean up old snapshots (keep last 24 hours)
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      await collection.deleteMany({ timestamp: { $lt: cutoff } });
      
      this.logger?.debug?.('[MetricsService] Persisted metrics snapshot');
    } catch (error) {
      this.logger?.error?.('[MetricsService] Failed to persist metrics:', error);
    }
  }

  /**
   * Get historical metrics
   * @param {number} [duration=3600000] - Duration in ms (default: 1 hour)
   * @returns {Promise<Array>} Historical snapshots
   */
  async getHistoricalMetrics(duration = 3600000) {
    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection('metrics_snapshots');
      
      const cutoff = Date.now() - duration;
      const snapshots = await collection
        .find({ timestamp: { $gte: cutoff } })
        .sort({ timestamp: 1 })
        .toArray();
      
      return snapshots;
    } catch (error) {
      this.logger?.error?.('[MetricsService] Failed to get historical metrics:', error);
      return [];
    }
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset() {
    this.metrics.clear();
    this.serviceHealth.clear();
    this.startTime = Date.now();
    this.logger?.info?.('[MetricsService] Metrics reset');
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
    }
    
    // Final persistence
    await this.persistMetrics();
    
    this.logger?.info?.('[MetricsService] Cleaned up');
  }
}
